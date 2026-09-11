/**
 * All DOM rendering: legend, context strip, country picker, country panel,
 * and the three overlay sheets (QR, controller, add-a-note).
 *
 * Every string that originates from a visitor goes in through `textContent` or
 * the `el()` helper's text argument, never through innerHTML — a booth is a
 * public writing surface and the notes are untrusted input.
 */
import { CONFIG } from './config-loader.js';
import {
  CATEGORIES,
  CATEGORY_BY_ID,
  CONTEXT,
  DISCLAIMER,
  FEATURED,
  PRACTICES,
  WORKER_BY_ID,
  WORKER_GROUPS,
  categoriesFor,
  countsFor,
} from './practices.js';
import { renderQr, qrToDataUrl } from './qr.js';
import { formatRemaining } from './tokens.js';
import { notesToCsv } from './store.js';

/* ------------------------------------------------------------------ */
/* Tiny DOM helpers                                                    */
/* ------------------------------------------------------------------ */

/** `el('div.foo', 'text')` / `el('div', {class:'foo'}, [children])` */
export function el(spec, ...rest) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const item of rest) {
    if (item == null || item === false) continue;
    if (typeof item === 'string' || typeof item === 'number') {
      node.appendChild(document.createTextNode(String(item)));
    } else if (Array.isArray(item)) {
      for (const child of item) if (child) node.appendChild(child);
    } else if (item instanceof Node) {
      node.appendChild(item);
    } else {
      for (const [key, value] of Object.entries(item)) {
        if (key === 'class') node.className = value;
        else if (key === 'style') applyStyle(node, value);
        else if (key === 'html') node.innerHTML = value; // only ever author-supplied
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else if (value === true) node.setAttribute(key, '');
        else if (value !== false && value != null) node.setAttribute(key, String(value));
      }
    }
  }
  return node;
}

/**
 * Replaces an element's children, with the same contract as {@link el}:
 * nullish and false entries are skipped, arrays are flattened.
 *
 * replaceChildren stringifies anything that is not a Node, so handing it a
 * `condition ? el(...) : null` writes the literal word "null" onto the page.
 * That is exactly what appeared under the context card's numbers.
 */
export function setChildren(node, ...items) {
  const out = [];
  const add = (item) => {
    if (item == null || item === false) return;
    if (Array.isArray(item)) {
      for (const child of item) add(child);
      return;
    }
    out.push(item instanceof Node ? item : document.createTextNode(String(item)));
  };
  for (const item of items) add(item);
  node.replaceChildren(...out);
}

/**
 * Applies a style object. Custom properties have to go through setProperty —
 * assigning them onto the CSSStyleDeclaration silently does nothing, which is
 * how every category colour on this page once came out the same orange.
 */
function applyStyle(node, styles) {
  for (const [property, value] of Object.entries(styles)) {
    if (property.startsWith('--')) node.style.setProperty(property, value);
    else node.style[property] = value;
  }
}

/** Inline icon set — small enough to keep here rather than fetch as sprites. */
const ICON_PATHS = {
  currency: 'M12 2a1 1 0 011 1v1.1c1.9.3 3.3 1.5 3.5 3.3h-2.1c-.2-.8-1-1.4-2.4-1.4-1.5 0-2.4.6-2.4 1.5 0 .8.6 1.2 2.6 1.7 2.7.6 4.3 1.4 4.3 3.7 0 1.9-1.4 3.2-3.5 3.5V18a1 1 0 11-2 0v-1.6c-2.1-.3-3.6-1.6-3.8-3.5h2.1c.2 1 1.2 1.6 2.7 1.6 1.7 0 2.5-.7 2.5-1.6 0-.9-.7-1.3-2.8-1.8-2.6-.6-4.1-1.5-4.1-3.6 0-1.8 1.4-3.1 3.4-3.4V3a1 1 0 011-1z',
  hand: 'M11 2a1.4 1.4 0 011.4 1.4v6h.8V4.6a1.4 1.4 0 112.8 0v4.8h.8V6.4a1.4 1.4 0 112.8 0v7.2c0 4.1-2.6 7.4-6.6 7.4-3.4 0-5.2-1.7-6.7-4.4l-2-3.6a1.4 1.4 0 012.3-1.6l1.8 2.2V3.4A1.4 1.4 0 0111 2z',
  heart: 'M12 21s-7.5-4.6-9.3-9C1.4 8.6 3 5.2 6.3 4.4c2-.5 4 .3 5.2 1.9 1.2-1.6 3.2-2.4 5.2-1.9 3.3.8 4.9 4.2 3.6 7.6-1.8 4.4-8.3 9-8.3 9z',
  bulb: 'M12 2a7 7 0 00-4 12.7V17a1 1 0 001 1h6a1 1 0 001-1v-2.3A7 7 0 0012 2zM9 19h6v1a1 1 0 01-1 1h-4a1 1 0 01-1-1v-1z',
  megaphone: 'M3 10v4a1 1 0 001 1h2l3.6 4.3A1 1 0 0011.4 19V5a1 1 0 00-1.8-.6L6 9H4a1 1 0 00-1 1zm14.5-1.8a1 1 0 011.4.2 6.6 6.6 0 010 7.2 1 1 0 11-1.6-1.2 4.6 4.6 0 000-4.8 1 1 0 01.2-1.4z',
  chevron: 'M7 10l5 5 5-5z',
  lever: 'M4 12h4l3-7 3 14 3-7h3',
  copy: 'M8 3h9a2 2 0 012 2v11h-2V5H8V3zM5 7h9a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2zm0 2v10h9V9H5z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z',
};

export function icon(name, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.chevron);
  if (name === 'lever') {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(path);
  return svg;
}

export function flagImg(a2, className = '') {
  const img = el('img', {
    class: className,
    src: a2 ? `assets/flags/${a2}.svg` : 'assets/brand/flag-unknown.svg',
    alt: '',
    loading: 'lazy',
    decoding: 'async',
  });
  img.addEventListener('error', () => {
    img.src = 'assets/brand/flag-unknown.svg';
  }, { once: true });
  return img;
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

let toastTimer = null;

export function toast(message, kind = '') {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.className = `toast${kind ? ` toast--${kind}` : ''}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 3600);
}

/* ------------------------------------------------------------------ */
/* Sheet                                                               */
/* ------------------------------------------------------------------ */

const sheet = {
  root: null,
  title: null,
  body: null,
  lastFocus: null,
};

export function initSheet() {
  sheet.root = document.getElementById('sheet');
  sheet.title = document.getElementById('sheet-title');
  sheet.body = document.getElementById('sheet-body');

  sheet.root.addEventListener('click', (event) => {
    if (event.target.closest('[data-sheet-close]')) closeSheet();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !sheet.root.hidden) closeSheet();
  });
}

export function openSheet(title, content) {
  sheet.lastFocus = document.activeElement;
  sheet.title.textContent = title;
  sheet.body.replaceChildren(content);
  sheet.root.hidden = false;
  /* Move focus in so keyboard and screen-reader users land inside the dialog. */
  requestAnimationFrame(() => {
    const focusable = sheet.body.querySelector(
      'input, textarea, button, select, [tabindex]:not([tabindex="-1"])',
    );
    (focusable || sheet.body).focus?.();
  });
}

export function closeSheet() {
  sheet.root.hidden = true;
  sheet.body.replaceChildren();
  sheet.lastFocus?.focus?.();
}

export const sheetIsOpen = () => !sheet.root?.hidden;

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

export function buildLegend(container, onFilter) {
  container.replaceChildren();

  for (const category of CATEGORIES) {
    const count = PRACTICES.filter((p) => p.category === category.id).length;

    const button = el(
      'button.legend__item',
      {
        type: 'button',
        style: { '--c': category.color },
        'data-category': category.id,
        title: `${category.label} — ${category.blurb} (${count} practices). Click to filter.`,
        'aria-pressed': 'false',
      },
      el('span.legend__swatch', icon(category.icon)),
      el(
        'span.legend__text',
        el('span.legend__name.legend__name--full', category.label),
        el('span.legend__name.legend__name--short', category.short),
        el('span.legend__blurb', category.blurb),
      ),
    );

    button.addEventListener('click', () => {
      const active = !button.classList.contains('is-active');
      for (const other of container.querySelectorAll('.legend__item')) {
        other.classList.remove('is-active');
        other.setAttribute('aria-pressed', 'false');
      }
      if (active) {
        button.classList.add('is-active');
        button.setAttribute('aria-pressed', 'true');
      }
      container.classList.toggle('has-filter', active);
      onFilter(active ? category.id : null);
    });

    container.appendChild(button);
  }

  /* The framework deserves more than a tooltip; this opens the full text. */
  const explain = el(
    'button.legend__about',
    {
      type: 'button',
      title: 'What are the Five As?',
      'aria-label': 'What are the Five As?',
      onclick: openFrameworkSheet,
    },
    '?',
  );
  container.appendChild(explain);
}

/** The Five As in full — the reading a visitor gets if they ask what this is. */
export function openFrameworkSheet() {
  openSheet(
    'The Five As',
    el(
      'div',
      el(
        'p.ctl__hint',
        { style: { marginBottom: '18px' } },
        'Five design levers that decide whether a social insurance scheme actually reaches informal and self-employed workers. Each practice on the map pulls at least one of them.',
      ),
      CATEGORIES.map((category) =>
        el(
          'section.ctl__section',
          { style: { '--c': category.color } },
          el(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
            el(
              'span.legend__swatch',
              { style: { '--c': category.color, background: category.color } },
              icon(category.icon),
            ),
            el('h3.ctl__title', { style: { margin: '0' } }, category.label),
          ),
          el('p.ctl__hint', { style: { marginBottom: '6px', fontWeight: '700', color: 'var(--ink-2)' } }, category.blurb),
          el('p.ctl__hint', { style: { marginBottom: '0' } }, category.detail),
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Context strip                                                       */
/* ------------------------------------------------------------------ */

/**
 * The context strip.
 *
 * Two states. Unfiltered, it carries the framing paragraph, all five barriers,
 * and the headline numbers — the reading a visitor gets before they touch
 * anything. With a lens selected it narrows to that one barrier and what the
 * map is currently showing, so the card answers the question the visitor just
 * asked instead of repeating the whole framework beside a filtered map.
 *
 * @returns {{setLens: (category: string|null, workers: string|null) => void}}
 */
export function buildContext(container) {
  const body = el('div.context__panel');

  const render = (category, workers) => {
    const lens = category ? CATEGORY_BY_ID.get(category) : null;
    const group = workers ? WORKER_BY_ID.get(workers) : null;
    const counts = countsFor(category, workers);

    const showing = el(
      'div.context__stats',
      el(
        'div.stat',
        el('span.stat__value', String(counts.practices)),
        el('span.stat__label', counts.practices === 1 ? 'good practice shown' : 'good practices shown'),
      ),
      el(
        'div.stat',
        el('span.stat__value', String(counts.countries)),
        el('span.stat__label', counts.countries === 1 ? 'country' : 'countries'),
      ),
    );

    if (lens) {
      setChildren(
        body,
        el(
          'div.context__lens',
          { style: { '--c': lens.color } },
          el('span.context__lens-icon', icon(lens.icon)),
          el(
            'div',
            el('h3.context__lens-name', lens.short),
            el('p.context__lens-text', lens.barrier),
          ),
        ),
        group ? el('p.context__filtered', `Filtered to ${group.label.toLowerCase()}.`) : null,
        showing,
      );
      return;
    }

    setChildren(
      body,
      el('p.context__text', CONTEXT.standfirst),
      el(
        'ul.context__barriers',
        CATEGORIES.map((c) =>
          el(
            'li.context__barrier',
            { style: { '--c': c.color } },
            el('span.context__barrier-name', c.short),
            el('span.context__barrier-text', c.barrier),
          ),
        ),
      ),
      group ? el('p.context__filtered', `Filtered to ${group.label.toLowerCase()}.`) : null,
      group
        ? showing
        : el(
            'div.context__stats',
            CONTEXT.stats.map((stat) =>
              el('div.stat', el('span.stat__value', stat.value), el('span.stat__label', stat.label)),
            ),
          ),
    );
  };

  render(null, null);
  container.replaceChildren(body);

  const toggle = document.getElementById('context-toggle');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
  });

  /* Collapsed by default where it would otherwise crowd the map: short booth
     screens, and phones, where it shares the upper band with the legend. */
  if (window.innerHeight < 720 || window.innerWidth < 960) {
    toggle.setAttribute('aria-expanded', 'false');
  }

  document.getElementById('disclaimer').textContent = DISCLAIMER;

  return { setLens: render };
}

/* ------------------------------------------------------------------ */
/* Worker group filter                                                 */
/* ------------------------------------------------------------------ */

/**
 * Which workers a practice is aimed at.
 *
 * A second lens on the same map, alongside the Five As: "show me what has been
 * tried for domestic workers" is the question a visitor from a domestic
 * workers' union actually arrives with. Rendered as chips rather than a select
 * so the counts are visible without opening anything, and so a booth visitor
 * can reach them with one tap.
 */
export function buildWorkerFilter(container, onFilter) {
  const chips = container.querySelector('.workers__chips');
  chips.replaceChildren();

  const all = el(
    'button.workers__chip.is-active',
    { type: 'button', 'data-workers': '', 'aria-pressed': 'true' },
    'All',
  );

  const buttons = [all];
  for (const group of WORKER_GROUPS) {
    const count = PRACTICES.filter((p) => p.workers === group.id).length;
    if (!count) continue;
    buttons.push(
      el(
        'button.workers__chip',
        {
          type: 'button',
          'data-workers': group.id,
          'aria-pressed': 'false',
          title: `${group.label} — ${count} practice${count === 1 ? '' : 's'}`,
        },
        el('span', group.short),
        el('span.workers__count', String(count)),
      ),
    );
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      for (const other of buttons) {
        const active = other === button;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-pressed', String(active));
      }
      onFilter(button.dataset.workers || null);
    });
    chips.appendChild(button);
  }
}

/* ------------------------------------------------------------------ */
/* Country picker                                                      */
/* ------------------------------------------------------------------ */

/** How far a finger may travel on an option and still count as choosing it. */
const PICKER_TAP_SLOP = 10;

export class CountryPicker {
  /**
   * @param {object} index    world-index.json
   * @param {(key:string)=>void} onPick
   */
  constructor(index, onPick) {
    this.onPick = onPick;
    this.input = document.getElementById('picker-input');
    this.list = document.getElementById('picker-list');
    this.flag = document.getElementById('picker-flag');
    this.clearBtn = document.getElementById('picker-clear');
    this.caretBtn = document.getElementById('picker-caret');
    this.activeIndex = -1;
    this.filtered = [];

    /* Neutral features are excluded: they have no agreed name to select. */
    this.all = index.countries
      .filter((c) => !c.neutral)
      .map((c) => ({
        key: c.key,
        name: c.name,
        a2: c.a2,
        featured: FEATURED.has(c.a2),
        /* Fold accents so "cote" finds "Côte d'Ivoire". */
        search: c.name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, ''),
      }));

    this._bind();
  }

  _bind() {
    this.input.addEventListener('focus', () => this.open());
    this.input.addEventListener('input', () => this.open());

    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (this.list.hidden) return this.open();
        this._move(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const choice = this.filtered[this.activeIndex] || this.filtered[0];
        if (choice) this._choose(choice);
      } else if (event.key === 'Escape') {
        this.close();
        this.input.blur();
      }
    });

    this.caretBtn.addEventListener('click', () => {
      if (this.list.hidden) {
        this.input.value = '';
        this.input.focus();
        this.open();
      } else {
        this.close();
      }
    });

    this.clearBtn.addEventListener('click', () => {
      this.setSelection(null);
      this.onPick(null);
    });

    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('#picker')) this.close();
    });
  }

  open() {
    const query = this.input.value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

    this.filtered = query
      ? this.all
          .filter((c) => c.search.includes(query))
          /* Prefix matches first, then featured countries, then alphabetical. */
          .sort((a, b) => {
            const ap = a.search.startsWith(query) ? 0 : 1;
            const bp = b.search.startsWith(query) ? 0 : 1;
            return ap - bp || Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name);
          })
      : [...this.all].sort(
          (a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name),
        );

    this._render(query);
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.activeIndex = -1;
  }

  close() {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.activeIndex = -1;
  }

  _render(query) {
    this.list.replaceChildren();

    if (!this.filtered.length) {
      this.list.appendChild(el('li.picker__empty', 'No country matches that.'));
      return;
    }

    let headed = false;
    let plainHeaded = false;

    for (let i = 0; i < this.filtered.length; i++) {
      const country = this.filtered[i];

      /* Group headings only make sense on the unfiltered list. */
      if (!query) {
        if (country.featured && !headed) {
          this.list.appendChild(el('li.picker__group', 'With a good practice'));
          headed = true;
        } else if (!country.featured && !plainHeaded) {
          this.list.appendChild(el('li.picker__group', 'All other countries'));
          plainHeaded = true;
        }
      }

      const option = el(
        'li.picker__option',
        { role: 'option', 'data-index': String(i), id: `picker-opt-${i}` },
        flagImg(country.a2),
        el('span.picker__option-name', country.name),
        country.featured
          ? el('span.picker__badge', {
              style: { background: CATEGORY_BY_ID.get(categoriesFor(country.a2)[0]).color },
            }, String(FEATURED.get(country.a2).practices.length))
          : null,
      );

      /**
       * A finger landing on an option has to be allowed to become a scroll.
       * Choosing on pointerdown — and calling preventDefault, which also
       * cancels the browser's own touch scrolling — meant this list could
       * never be dragged on a phone: the first country you touched was
       * selected, so only the group at the top was ever reachable.
       *
       * A mouse keeps the old behaviour, because preventDefault there is what
       * holds focus in the input for the keyboard flow.
       */
      let startX = 0;
      let startY = 0;
      let coarse = false;

      option.addEventListener('pointerdown', (event) => {
        coarse = event.pointerType !== 'mouse';
        startX = event.clientX;
        startY = event.clientY;
        if (coarse) return; // the choice lands on pointerup instead
        event.preventDefault();
        this._choose(country);
      });

      /* Touch gets implicit pointer capture, so this fires on the option the
         finger started on even if it drifted. A gesture that travelled was a
         scroll; the browser also sends pointercancel once it takes one over. */
      option.addEventListener('pointerup', (event) => {
        if (!coarse) return;
        const moved = Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY);
        if (moved < PICKER_TAP_SLOP) this._choose(country);
      });

      this.list.appendChild(option);
    }
  }

  _move(delta) {
    const options = [...this.list.querySelectorAll('.picker__option')];
    if (!options.length) return;

    this.activeIndex = (this.activeIndex + delta + this.filtered.length) % this.filtered.length;
    for (const option of options) option.classList.remove('is-active');

    const active = options.find((o) => Number(o.dataset.index) === this.activeIndex);
    if (active) {
      active.classList.add('is-active');
      active.scrollIntoView({ block: 'nearest' });
      this.input.setAttribute('aria-activedescendant', active.id);
    }
  }

  _choose(country) {
    this.setSelection(country);
    this.close();
    this.input.blur();
    this.onPick(country.key);
  }

  /** Reflects a selection made elsewhere (a map click, say) back into the field. */
  setSelection(country) {
    if (!country) {
      this.input.value = '';
      this.flag.hidden = true;
      this.clearBtn.hidden = true;
      return;
    }
    const entry = typeof country === 'string' ? this.all.find((c) => c.key === country) : country;
    if (!entry) return this.setSelection(null);

    this.input.value = entry.name;
    this.flag.src = `assets/flags/${entry.a2}.svg`;
    this.flag.hidden = false;
    this.clearBtn.hidden = false;
  }
}

/* ------------------------------------------------------------------ */
/* Country panel                                                       */
/* ------------------------------------------------------------------ */

export class CountryPanel {
  /**
   * @param {object} deps
   * @param {import('./store.js').createStore} deps.store
   * @param {import('./auth.js').Auth} deps.auth
   * @param {(a2:string, name:string)=>void} deps.onAddNote
   */
  constructor({ store, auth, onAddNote, onClose }) {
    this.store = store;
    this.auth = auth;
    this.onAddNote = onAddNote;

    this.root = document.getElementById('panel');
    this.body = document.getElementById('panel-body');
    this.current = null;
    /** Practice cards the reader has expanded, kept across refreshes. */
    this.open = new Set();

    document.getElementById('panel-close').addEventListener('click', () => {
      this.close();
      onClose?.();
    });

    this.store.addEventListener('change', () => {
      if (!this.current) return;
      /* The notes backend polls every few seconds. Rebuilding the panel on
         every poll threw the reader back to the top of whatever they were
         reading and collapsed the practice they had open — so only rebuild
         when this country's notes have actually changed, and keep their place
         when it happens. */
      const notes = this._noteSignature(this.current.record.a2);
      if (notes === this.current.notes) return;
      this.render(this.current.record, this.current.openPractice, { keepScroll: true });
    });
  }

  close() {
    this.root.hidden = true;
    this.current = null;
    this.open.clear();
  }

  /**
   * @param {object} record          the world-index record for the country
   * @param {string} [openPracticeId] a practice to expand on open
   */
  /** Identifies this country's visible notes, so a poll that changed nothing
      does not rebuild the panel under the reader. */
  _noteSignature(a2) {
    return this.store
      .forCountry(a2, this.auth.noteScope)
      .map((n) => `${n.id}:${n.approved ? 1 : 0}`)
      .join(',');
  }

  /**
   * @param {object} record            the world-index record for the country
   * @param {string} [openPracticeId]  a practice to expand on open
   * @param {{keepScroll?: boolean}} [options] keep the reader's place, for a
   *   refresh they did not ask for
   */
  render(record, openPracticeId, { keepScroll = false } = {}) {
    /* Selecting a country starts at the top; a background refresh does not. */
    const scrollBack = keepScroll ? this.body.scrollTop : 0;
    if (this.current?.record.key !== record.key) this.open.clear();
    if (openPracticeId) this.open.add(openPracticeId);
    this.current = {
      record,
      openPractice: openPracticeId,
      notes: this._noteSignature(record.a2),
    };
    this.root.hidden = false;

    const entry = FEATURED.get(record.a2);
    const practices = entry?.practices || [];
    const notes = this.store.forCountry(record.a2, this.auth.noteScope);
    const primary = practices.length
      ? CATEGORY_BY_ID.get(practices[0].category).color
      : 'var(--wiego-warm-gray)';

    this.root.style.setProperty('--c', primary);

    const parts = [
      el(
        'div.panel__hero',
        { style: { '--c': primary } },
        flagImg(record.a2, 'panel__flag'),
        el('h2.panel__country', record.name),
        el(
          'p.panel__meta',
          practices.length
            ? `${practices.length} good practice${practices.length > 1 ? 's' : ''} · ${[
                ...new Set(practices.map((p) => CATEGORY_BY_ID.get(p.category).label)),
              ].join(' · ')}`
            : 'No mapped practice yet — add what you know.',
        ),
      ),
    ];

    if (practices.length) {
      parts.push(
        el(
          'section.panel__section',
          el('h3.panel__section-title', 'Good practices'),
          practices.map((practice) => this._practiceCard(practice, this.open.has(practice.id))),
        ),
      );
    }

    /* Notes section — the part visitors write. */
    const noteChildren = [
      el(
        'h3.panel__section-title',
        `From the room${notes.length ? ` · ${notes.length}` : ''}`,
      ),
    ];

    if (notes.length) {
      noteChildren.push(...notes.map((note) => this._noteCard(note)));
    } else {
      noteChildren.push(
        el(
          'p.empty',
          this.auth.canContribute && record.a2
            ? 'Nothing added here yet. Be the first to share what you know about this country.'
            : 'Nothing added here yet. Scan the QR code to contribute from your phone.',
        ),
      );
    }

    /* Every country is open for contributions, mapped practice or not — that
       is most of the point of the QR code. The one exception is an area with
       no ISO code: a note filed against a null country cannot be read back or
       exported, and those areas are absent from the picker for the same
       reason they have no agreed name. */
    if (this.auth.canContribute && record.a2) {
      noteChildren.push(
        el(
          'button.btn.btn--secondary.btn--block',
          {
            type: 'button',
            style: { marginTop: '12px' },
            onclick: () => this.onAddNote(record.a2, record.name),
          },
          icon('plus'),
          practices.length ? 'Add what you know' : 'Be the first to add a practice',
        ),
      );
    }

    parts.push(el('section.panel__section', noteChildren));
    this.body.replaceChildren(...parts);
    this.body.scrollTop = scrollBack;
  }

  _practiceCard(practice, open) {
    const category = CATEGORY_BY_ID.get(practice.category);

    const head = el(
      'button.practice__head',
      { type: 'button', 'aria-expanded': String(Boolean(open)) },
      el('span.practice__icon', icon(category.icon)),
      el(
        'span.practice__titles',
        el('span.practice__title', practice.title),
        practice.subtitle ? el('span.practice__subtitle', practice.subtitle) : null,
        el('span.practice__cat', category.label),
      ),
      icon('chevron', 'practice__chev'),
    );

    /* Many source descriptions are a single sentence, in which case the summary
       and the detail are the same text — show it once. */
    const detailAddsSomething =
      practice.detail && practice.detail.trim() !== practice.summary.trim();

    const body = el(
      'div.practice__body',
      el('p.practice__summary', practice.summary),
      detailAddsSomething ? el('p.practice__detail', practice.detail) : null,
      practice.lever
        ? el('div.practice__lever', icon('lever'), el('span', practice.lever))
        : null,
      practice.facts?.length
        ? el(
            'div.facts',
            practice.facts.map(([key, value]) =>
              el('div.facts__row', el('span.facts__key', key), el('span.facts__value', value)),
            ),
          )
        : null,
      practice.note ? el('p.practice__note', practice.note) : null,
    );

    const card = el(
      'article.practice',
      { style: { '--c': category.color }, 'data-practice': practice.id },
      head,
      body,
    );
    if (open) card.classList.add('is-open');

    head.addEventListener('click', () => {
      const nowOpen = !card.classList.contains('is-open');
      card.classList.toggle('is-open', nowOpen);
      head.setAttribute('aria-expanded', String(nowOpen));
      if (nowOpen) this.open.add(practice.id);
      else this.open.delete(practice.id);
      if (this.current) this.current.openPractice = nowOpen ? practice.id : null;
    });

    return card;
  }

  _noteCard(note) {
    const category = note.category ? CATEGORY_BY_ID.get(note.category) : null;

    const meta = el(
      'div.note__meta',
      el('span.note__author', note.author),
      el('span', '·'),
      el('span', new Date(note.createdAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })),
      category
        ? el('span.note__tag', { style: { '--c': category.color, background: category.color } }, category.label)
        : null,
      !note.approved ? el('span.note__tag.note__pending', 'Awaiting the booth') : null,
    );

    /* Controllers moderate; a visitor may withdraw their own note. */
    const actions = [];
    if (this.auth.isController) {
      if (!note.approved) {
        actions.push(
          el('button.note__action', {
            type: 'button',
            onclick: () => this.store.update(note.id, { approved: true }).then(() => toast('Note published.', 'success')),
          }, 'Approve'),
        );
      }
      actions.push(
        el('button.note__action.note__action--danger', {
          type: 'button',
          onclick: () => {
            if (confirm(`Delete this note from ${note.author}?`)) {
              this.store.remove(note.id).then(() => toast('Note deleted.'));
            }
          },
        }, 'Delete'),
      );
    } else if (this.auth.session?.visitorId && note.visitorId === this.auth.session.visitorId) {
      actions.push(
        el('button.note__action.note__action--danger', {
          type: 'button',
          onclick: () => {
            if (confirm('Remove your note?')) this.store.remove(note.id).then(() => toast('Note removed.'));
          },
        }, 'Remove mine'),
      );
    }
    if (actions.length) meta.appendChild(el('span.note__actions', actions));

    return el('article.note', el('p.note__text', note.text), meta);
  }
}

/* ------------------------------------------------------------------ */
/* Approval prompt                                                     */
/* ------------------------------------------------------------------ */

/**
 * The controller's moderation queue, as a popup on the booth screen.
 *
 * With `moderateContributions` on, a note written on a phone is stored but
 * shown to nobody. It reaches the map only when whoever is running the booth
 * approves it here, so this popup is the single place a new contribution
 * announces itself.
 *
 * Modeless on purpose. The booth screen is usually mid-conversation when a
 * note lands, and a modal dialog over the map would mean a visitor's question
 * has to wait for a moderation decision. The map stays fully usable behind it,
 * and "Later" puts a note back in the queue rather than deciding anything.
 */
export class ReviewPrompt {
  /**
   * @param {object} deps
   * @param {import('./store.js').createStore} deps.store
   * @param {(a2:string)=>void} [deps.onShow] jump the map to the note's country
   */
  constructor({ store, onShow }) {
    this.store = store;
    this.onShow = onShow;
    this.root = document.getElementById('review');
    this.current = null;
    /* Ids the controller has waved off this session. They stay in the queue —
       the controller panel still lists them — but stop reopening this popup. */
    this.snoozed = new Set();
  }

  /** Feeds the queue. Call on every store change; safe to call repeatedly. */
  sync(pending) {
    const ids = new Set(pending.map((n) => n.id));
    for (const id of [...this.snoozed]) if (!ids.has(id)) this.snoozed.delete(id);

    this.queue = pending;

    /* Whatever is on screen may have been handled from the controller panel,
       or from another booth machine, between one poll and the next. */
    if (this.current && !ids.has(this.current.id)) this.current = null;

    if (!this.current) {
      this.current = pending.find((n) => !this.snoozed.has(n.id)) || null;
    }
    this._render();
  }

  close() {
    this.current = null;
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  _advance() {
    const next = (this.queue || []).find(
      (n) => n.id !== this.current?.id && !this.snoozed.has(n.id),
    );
    this.current = next || null;
    this._render();
  }

  _render() {
    const note = this.current;
    if (!note) {
      this.root.hidden = true;
      this.root.replaceChildren();
      return;
    }

    const waiting = (this.queue || []).filter((n) => n.id !== note.id).length;
    const category = note.category ? CATEGORY_BY_ID.get(note.category) : null;

    const approve = el(
      'button.btn.btn--primary.btn--sm',
      { type: 'button' },
      'Approve & post',
    );
    approve.addEventListener('click', async () => {
      approve.disabled = true;
      try {
        await this.store.update(note.id, { approved: true });
        toast(`Published to ${note.country || note.a2?.toUpperCase() || 'the map'}.`, 'success');
        this._advance();
      } catch (error) {
        approve.disabled = false;
        toast(error.message || 'Could not publish that note.', 'error');
      }
    });

    const reject = el('button.btn.btn--ghost.btn--sm', { type: 'button' }, 'Reject');
    reject.addEventListener('click', async () => {
      if (!confirm(`Discard this note from ${note.author}? It cannot be recovered.`)) return;
      reject.disabled = true;
      try {
        await this.store.remove(note.id);
        toast('Note discarded.');
        this._advance();
      } catch (error) {
        reject.disabled = false;
        toast(error.message || 'Could not discard that note.', 'error');
      }
    });

    const later = el(
      'button.review__later',
      { type: 'button', 'aria-label': 'Decide later' },
      'Later',
    );
    later.addEventListener('click', () => {
      this.snoozed.add(note.id);
      this._advance();
    });

    const heading = el(
      'div.review__head',
      el('span.review__dot'),
      el('h2.review__title', 'New from a visitor'),
      waiting
        ? el('span.review__queue', `${waiting} more waiting`)
        : null,
      later,
    );

    const country = el(
      'button.review__country',
      {
        type: 'button',
        title: 'Show this country on the map',
        onclick: () => note.a2 && this.onShow?.(note.a2),
      },
      flagImg(note.a2, 'review__flag'),
      el('span', note.country || note.a2?.toUpperCase() || 'Unknown'),
    );

    this.root.replaceChildren(
      heading,
      el(
        'div.review__body',
        country,
        el('p.review__text', note.text),
        el(
          'div.review__meta',
          el('span.review__author', note.author),
          category
            ? el(
                'span.note__tag',
                { style: { '--c': category.color, background: category.color } },
                category.label,
              )
            : null,
        ),
      ),
      el('div.review__actions', approve, reject),
    );
    this.root.hidden = false;
  }
}

/* ------------------------------------------------------------------ */
/* Add-a-note form                                                     */
/* ------------------------------------------------------------------ */

/**
 * @param {object} options
 * @param {boolean} [options.held] true when this note will wait for the
 *   controller's approval — the writer is told so rather than watching it
 *   fail to appear.
 */
export function openAddNote({ a2, country, onSubmit, defaultAuthor = '', held = false }) {
  const textarea = el('textarea', {
    id: 'note-text',
    maxlength: String(CONFIG.maxNoteLength),
    placeholder: 'A scheme, a barrier, a number, a question…',
  });

  /**
   * The question the note is answering, kept above the box rather than inside
   * it as placeholder text. A placeholder disappears the moment someone starts
   * typing — exactly when the framing still matters — and this map is about
   * one specific thing, not notes on a country in general.
   */
  const prompt = el(
    'span.addnote__prompt',
    `How is social insurance being extended to informal or self-employed workers in ${country}?`,
  );

  const counter = el('div.addnote__counter', `0 / ${CONFIG.maxNoteLength}`);
  textarea.addEventListener('input', () => {
    counter.textContent = `${textarea.value.length} / ${CONFIG.maxNoteLength}`;
    counter.classList.toggle('is-over', textarea.value.length >= CONFIG.maxNoteLength);
  });

  const author = el('input.field__input', {
    type: 'text',
    maxlength: '60',
    placeholder: 'Your name or organization (optional)',
    value: defaultAuthor,
  });

  let category = null;
  const chips = el(
    'div.chips',
    CATEGORIES.map((c) => {
      const chip = el('button.chip', { type: 'button', style: { '--c': c.color } }, c.label);
      chip.addEventListener('click', () => {
        const active = category !== c.id;
        for (const other of chips.querySelectorAll('.chip')) other.classList.remove('is-active');
        chip.classList.toggle('is-active', active);
        category = active ? c.id : null;
      });
      return chip;
    }),
  );

  const submit = el('button.btn.btn--primary.btn--block', { type: 'submit' }, 'Add to the map');

  const form = el(
    'form',
    { onsubmit: (event) => event.preventDefault() },
    el(
      'div.addnote__country',
      flagImg(a2),
      el(
        'div',
        el('div.addnote__country-name', country),
        el(
          'div.field__hint',
          { style: { margin: '0' } },
          held
            ? 'The booth reviews notes before they go on the map'
            : 'Your note will appear on this country',
        ),
      ),
    ),
    el('label.field', el('span.field__label', 'Your note'), prompt, textarea),
    counter,
    el(
      'div.field',
      { style: { marginTop: '10px' } },
      el('span.field__label', 'Which of the Five As? (optional)'),
      chips,
    ),
    el('label.field', { style: { marginTop: '14px' } }, el('span.field__label', 'Attribution'), author),
    el('div', { style: { marginTop: '16px' } }, submit),
  );

  form.addEventListener('submit', async () => {
    const text = textarea.value.trim();
    if (text.length < 3) {
      toast('Write a little more before adding it.', 'error');
      textarea.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Adding…';
    try {
      await onSubmit({ a2, country, text, author: author.value, category });
      closeSheet();
      toast(
        held
          ? 'Thank you — your note is with the host for review.'
          : 'Thank you — your note is on the map.',
        'success',
      );
    } catch (error) {
      toast(error.message || 'Could not add that note.', 'error');
      submit.disabled = false;
      submit.textContent = 'Add to the map';
    }
  });

  openSheet(`Add to ${country}`, form);
}

/* ------------------------------------------------------------------ */
/* QR sheet                                                            */
/* ------------------------------------------------------------------ */

export function openQrSheet({ url, expiresAt, isController, onRegenerate }) {
  const frame = el('div.qr__frame');
  frame.appendChild(renderQr(url, { size: 264 }));

  const urlBox = el('div.qr__url', { title: url }, url);

  const content = el(
    'div.qr',
    frame,
    el(
      'p.qr__caption',
      CONFIG.moderateContributions
        ? 'Scan to open this map on your phone and add what you know about any country. ' +
          'Notes reach the map once the host approves them here.'
        : 'Scan to open this map on your phone and add what you know about any country.',
    ),
    expiresAt
      ? el('p.qr__expiry', `Visitor passes from this code last ${formatRemaining(expiresAt)} longer.`)
      : null,
    el(
      'div.qr__link',
      urlBox,
      el(
        'button.btn.btn--secondary.btn--sm',
        {
          type: 'button',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast('Link copied.', 'success');
            } catch {
              /* Clipboard is blocked outside a secure context — select instead. */
              const range = document.createRange();
              range.selectNodeContents(urlBox);
              getSelection().removeAllRanges();
              getSelection().addRange(range);
              toast('Press Ctrl/Cmd+C to copy.');
            }
          },
        },
        icon('copy'),
        'Copy',
      ),
    ),
    el(
      'div.ctl__row',
      { style: { justifyContent: 'center' } },
      el(
        'button.btn.btn--secondary.btn--sm',
        {
          type: 'button',
          onclick: () => {
            /* A vector file prints crisply at whatever size the stand needs. */
            const link = el('a', {
              href: qrToDataUrl(renderQr(url, { size: 1024 })),
              download: 'wiego-map-visitor-qr.svg',
            });
            document.body.appendChild(link);
            link.click();
            link.remove();
          },
        },
        'Download for printing',
      ),
      isController
        ? el(
            'button.btn.btn--ghost.btn--sm',
            { type: 'button', onclick: onRegenerate },
            'Issue a fresh pass',
          )
        : null,
    ),
  );

  openSheet('Visitor QR code', content);
}

/* ------------------------------------------------------------------ */
/* Controller sheet                                                    */
/* ------------------------------------------------------------------ */

export function openControllerSheet({ auth, store, issueCode, issueGuestLink, currentCode, siteUrl }) {
  let hours = CONFIG.boothCodeHours;

  const codeValue = el(
    'div.code-display__value',
    currentCode ? currentCode.code : el('span.code-display__empty', 'No display code issued yet'),
  );
  const codeExpiry = el(
    'p.ctl__hint',
    { style: { margin: '0 0 12px' } },
    currentCode ? `Expires in ${formatRemaining(currentCode.expiresAt)}.` : '',
  );

  const copyCode = el(
    'button.btn.btn--secondary.btn--sm',
    {
      type: 'button',
      disabled: !currentCode,
      onclick: async () => {
        if (!currentCode) return;
        try {
          await navigator.clipboard.writeText(currentCode.code);
          toast('Code copied.', 'success');
        } catch {
          toast('Copy failed — read it off the screen.');
        }
      },
    },
    icon('copy'),
    'Copy',
  );

  const hourPills = el(
    'div.pill-group',
    [4, 12, 24, 72].map((h) => {
      const pill = el('button.pill', { type: 'button' }, h >= 24 ? `${h / 24}d` : `${h}h`);
      if (h === hours) pill.classList.add('is-active');
      pill.addEventListener('click', () => {
        hours = h;
        for (const other of hourPills.querySelectorAll('.pill')) other.classList.remove('is-active');
        pill.classList.add('is-active');
      });
      return pill;
    }),
  );

  const generate = el(
    'button.btn.btn--primary.btn--sm',
    {
      type: 'button',
      onclick: async () => {
        const issued = await issueCode(hours);
        currentCode = issued;
        codeValue.replaceChildren(document.createTextNode(issued.code));
        codeExpiry.textContent = `Expires in ${formatRemaining(issued.expiresAt)}.`;
        copyCode.disabled = false;
        toast('New display code issued.', 'success');
      },
    },
    'Issue display code',
  );

  /* --- Notes moderation --- */

  const notesBox = el('div.ctl__notes');
  const stats = el('div.ctl__stats');

  const renderNotes = () => {
    const all = store.notes;
    const pending = all.filter((n) => !n.approved);

    stats.replaceChildren(
      el('div.ctl__stat', el('span.ctl__stat-value', String(all.length)), el('span.ctl__stat-label', 'notes')),
      el('div.ctl__stat', el('span.ctl__stat-value', String(pending.length)), el('span.ctl__stat-label', 'awaiting review')),
      el(
        'div.ctl__stat',
        el('span.ctl__stat-value', String(new Set(all.map((n) => n.a2)).size)),
        el('span.ctl__stat-label', 'countries'),
      ),
    );

    if (!all.length) {
      notesBox.replaceChildren(el('p.empty', 'No visitor notes yet.'));
      return;
    }

    notesBox.replaceChildren(
      ...all.slice(0, 60).map((note) =>
        el(
          'article.note',
          el('p.note__text', note.text),
          el(
            'div.note__meta',
            el('span.note__author', note.author),
            el('span', '·'),
            el('span', note.country || note.a2?.toUpperCase() || ''),
            !note.approved ? el('span.note__tag.note__pending', 'Pending') : null,
            el(
              'span.note__actions',
              !note.approved
                ? el('button.note__action', {
                    type: 'button',
                    onclick: () => store.update(note.id, { approved: true }),
                  }, 'Approve')
                : null,
              el('button.note__action.note__action--danger', {
                type: 'button',
                onclick: () => {
                  if (confirm('Delete this note?')) store.remove(note.id);
                },
              }, 'Delete'),
            ),
          ),
        ),
      ),
    );
  };

  renderNotes();
  const onChange = () => renderNotes();
  store.addEventListener('change', onChange);

  const content = el(
    'div',
    /* --- Display code --- */
    el(
      'section.ctl__section',
      el('h3.ctl__title', 'Display code'),
      el(
        'p.ctl__hint',
        'Type this into the projector machine to unlock the map. It stops working when it expires, so issue a fresh one for each event.',
      ),
      el('div.code-display', codeValue),
      codeExpiry,
      el('div.ctl__row', hourPills, generate, copyCode),
    ),

    /* --- Visitor QR --- */
    el(
      'section.ctl__section',
      el('h3.ctl__title', 'Visitor passes'),
      el(
        'p.ctl__hint',
        `Print or project the QR code. Each phone that scans it gets a ${CONFIG.guestPassHours}-hour pass to browse the map and add notes.`,
      ),
      el(
        'div.ctl__row',
        el(
          'button.btn.btn--primary.btn--sm',
          { type: 'button', onclick: issueGuestLink },
          'Show visitor QR code',
        ),
      ),
    ),

    /* --- Moderation --- */
    el(
      'section.ctl__section',
      el('h3.ctl__title', 'Visitor notes'),
      el(
        'p.ctl__hint',
        store.mode === 'firestore'
          ? 'Notes sync live across every device at the event.'
          : 'This build has no live sync configured, so notes stay on the device that wrote them. See docs/SETUP.md § Live sync.',
      ),
      stats,
      el(
        'div.ctl__row',
        { style: { marginBottom: '12px' } },
        el(
          'button.btn.btn--secondary.btn--sm',
          {
            type: 'button',
            onclick: () => downloadFile('wiego-map-notes.csv', notesToCsv(store.notes), 'text/csv'),
          },
          'Export CSV',
        ),
        el(
          'button.btn.btn--secondary.btn--sm',
          {
            type: 'button',
            onclick: () =>
              downloadFile('wiego-map-notes.json', JSON.stringify(store.notes, null, 2), 'application/json'),
          },
          'Export JSON',
        ),
        el(
          'button.btn.btn--danger.btn--sm',
          {
            type: 'button',
            onclick: async () => {
              if (!confirm('Delete every visitor note? This cannot be undone.')) return;
              await store.clear();
              toast('All notes cleared.');
            },
          },
          'Clear all',
        ),
      ),
      notesBox,
    ),

    /* --- Session --- */
    el(
      'section.ctl__section',
      el('h3.ctl__title', 'This session'),
      el(
        'p.ctl__hint',
        `Signed in as ${auth.session?.email || 'host'}. Public address: ${siteUrl}`,
      ),
      el(
        'div.ctl__row',
        el(
          'button.btn.btn--ghost.btn--sm',
          {
            type: 'button',
            onclick: () => {
              store.removeEventListener('change', onChange);
              closeSheet();
              auth.signOut();
            },
          },
          'Sign out',
        ),
      ),
    ),
  );

  openSheet('Controller', content);
}

/** Triggers a browser download of generated text. */
function downloadFile(filename, text, type) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
