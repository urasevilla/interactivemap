/**
 * Country name labels.
 *
 * Labels are DOM, not WebGL: text stays crisp at any projector resolution and
 * screen readers can reach it. Positions are recomputed each frame from the
 * camera, but the elements themselves are pooled and only touched when their
 * visibility actually changes.
 *
 * Density rules — featured countries are always named, because "which countries
 * have a practice" is the first thing a visitor should be able to read from
 * across the booth. Everything else fades in as you zoom, largest first.
 */
import { CATEGORY_BY_ID, FEATURED, categoriesFor } from './practices.js';

/** Zoom (0 = whole world, 1 = fully in) at which plain labels start appearing. */
const PLAIN_LABEL_ZOOM = 0.3;

/**
 * Below this width the whole world is only ~190px tall, and fourteen name chips
 * cannot be placed anywhere near their own countries — they end up stacked in a
 * column that points at nothing. On a narrow screen the pins carry the map at
 * low zoom and the names arrive once there is room for them.
 */
const COMPACT_WIDTH = 760;
const COMPACT_FEATURED_ZOOM = 0.32;
const COMPACT_PLAIN_ZOOM = 0.62;

/** Minimum gap in CSS pixels between two label centres before one is dropped. */
const COLLISION_PAD = 6;

const clamp = (value, low, high) => (high < low ? (low + high) / 2 : Math.min(Math.max(value, low), high));

export class LabelLayer {
  /**
   * @param {HTMLElement} container
   * @param {import('./map3d.js').WorldMap} map
   */
  constructor(container, map) {
    this.container = container;
    this.map = map;
    this.entries = [];
    this.noteCounts = new Map();
    this._scratch = {};
  }

  /** Builds one pooled element per country, ordered so big countries win ties. */
  build(index) {
    this.container.innerHTML = '';
    this.entries = [];

    const sorted = [...index.countries].sort((a, b) => b.area - a.area);

    for (const record of sorted) {
      if (record.neutral) continue; // unnamed by design — see practices.js

      const country = this.map.countries.get(record.key);
      if (!country) continue;

      const featured = FEATURED.has(record.a2);

      const el = document.createElement('div');
      el.className = `label ${featured ? 'label--featured' : 'label--plain'}`;
      el.style.opacity = '0';
      el.style.display = 'none';

      const inner = document.createElement('span');
      inner.className = 'label__inner';

      if (featured) {
        const category = CATEGORY_BY_ID.get(categoriesFor(record.a2)[0]);
        el.style.setProperty('--c', category.color);

        const flag = document.createElement('img');
        flag.className = 'label__flag';
        flag.src = `assets/flags/${record.a2}.svg`;
        flag.alt = '';
        flag.loading = 'lazy';
        flag.decoding = 'async';
        inner.appendChild(flag);
      }

      const name = document.createElement('span');
      name.className = 'label__name';
      name.textContent = record.name;
      inner.appendChild(name);

      const count = document.createElement('span');
      count.className = 'label__count';
      count.hidden = true;
      inner.appendChild(count);

      el.appendChild(inner);
      this.container.appendChild(el);

      this.entries.push({
        record,
        el,
        countEl: count,
        featured,
        area: record.area,
        anchor: country.anchor,
        country,
        shown: false,
        x: 0,
        y: 0,
      });
    }
  }

  /** Note counts feed the small badge on featured labels. */
  setNoteCounts(counts) {
    this.noteCounts = counts;
    for (const entry of this.entries) {
      const n = counts.get(entry.record.a2) || 0;
      const practices = FEATURED.get(entry.record.a2)?.practices.length || 0;
      const total = practices + n;
      if (entry.featured || n > 0) {
        entry.countEl.hidden = total === 0;
        entry.countEl.textContent = String(total);
      }
    }
  }

  /** Called once per frame from the render loop. */
  update() {
    const map = this.map;
    const zoom = map.zoomLevel;
    const filter = map.filter;
    const rect = this.container.getBoundingClientRect();

    /* Featured labels claim their space first, then plain ones fill the gaps —
       so zooming never pushes a practice country's name off the map. */
    const placed = [];
    const candidates = [];
    const compact = rect.width < COMPACT_WIDTH;

    for (const entry of this.entries) {
      const isFeatured = entry.featured;

      if (compact && zoom < (isFeatured ? COMPACT_FEATURED_ZOOM : COMPACT_PLAIN_ZOOM)) {
        this._hide(entry);
        continue;
      }

      /* A filter dims the map; unrelated names would just add noise. */
      if (filter && isFeatured && !categoriesFor(entry.record.a2).includes(filter)) {
        this._hide(entry);
        continue;
      }

      if (!isFeatured) {
        /* Plain labels appear as you zoom in, biggest countries first. The
           threshold slides with area so the map fills gradually. */
        const areaRank = Math.min(1, entry.area / 260);
        const needed = (compact ? COMPACT_PLAIN_ZOOM : PLAIN_LABEL_ZOOM) + (1 - areaRank) * 0.42;
        if (zoom < needed) {
          this._hide(entry);
          continue;
        }
      }

      const screen = map.worldToScreen(
        entry.anchor[0],
        entry.anchor[1],
        entry.country.height + 0.01,
        this._scratch,
      );
      if (!screen.visible || screen.x < -80 || screen.x > rect.width + 80 || screen.y < -40 || screen.y > rect.height + 40) {
        this._hide(entry);
        continue;
      }

      candidates.push({ entry, x: screen.x, y: screen.y, priority: isFeatured ? 0 : 1 });
    }

    candidates.sort((a, b) => a.priority - b.priority || b.entry.area - a.entry.area);

    for (const candidate of candidates) {
      const { entry } = candidate;
      const width = entry.el.offsetWidth || (entry.featured ? 120 : 70);
      const height = entry.el.offsetHeight || 20;

      /* Keep the whole chip on screen — a name clipped by the canvas edge is
         worse than one nudged a few pixels inward. */
      const x = clamp(candidate.x, width / 2 + 6, rect.width - width / 2 - 6);
      const baseY = clamp(candidate.y, height / 2 + 6, rect.height - height / 2 - 6);

      const hits = (px, py) =>
        placed.some(
          (other) =>
            Math.abs(other.x - px) < (other.width + width) / 2 + COLLISION_PAD &&
            Math.abs(other.y - py) < (other.height + height) / 2 + COLLISION_PAD,
        );

      /* Featured labels are never dropped for a collision — losing one would
         hide a practice from the visitor — so they step away from the anchor,
         alternating above and below, until they find clear space. */
      const step = height + COLLISION_PAD;
      const offsets = entry.featured
        ? [0, -step, step, -step * 2, step * 2, -step * 3, step * 3]
        : [0];

      let y = null;
      for (const offset of offsets) {
        const candidateY = clamp(baseY + offset, height / 2 + 6, rect.height - height / 2 - 6);
        if (!hits(x, candidateY)) {
          y = candidateY;
          break;
        }
      }

      if (y === null) {
        /* Every slot taken. On a wide screen a featured label still shows,
           stacked at the last offset, rather than disappearing; on a narrow one
           a chip that far from its country is noise, so it gives way too. */
        if (!entry.featured || compact) {
          this._hide(entry);
          continue;
        }
        y = clamp(baseY + offsets.at(-1), height / 2 + 6, rect.height - height / 2 - 6);
      }

      this._show(entry, x, y);
      placed.push({ x, y, width, height });
    }

    /* Anything still marked shown but not placed this frame must go. */
    for (const entry of this.entries) {
      if (entry.shown && !entry._placedThisFrame) this._hide(entry);
      entry._placedThisFrame = false;
    }
  }

  _show(entry, x, y) {
    entry.el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    entry._placedThisFrame = true;

    if (!entry.shown) {
      entry.shown = true;
      entry.el.style.display = '';
      /* Two frames of layout before the fade, or the transition is skipped. */
      requestAnimationFrame(() => {
        if (entry.shown) entry.el.style.opacity = '1';
      });
    }

    const hot = this.map.selected === entry.record.key || this.map.hovered === entry.record.key;
    entry.el.classList.toggle('label--hot', hot);
  }

  _hide(entry) {
    if (!entry.shown) return;
    entry.shown = false;
    entry.el.style.opacity = '0';
    entry.el.style.display = 'none';
    entry.el.classList.remove('label--hot');
  }
}
