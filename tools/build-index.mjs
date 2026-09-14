/**
 * Build-time preprocessor.
 *
 * Reads the Natural Earth 1:50m admin-0 TopoJSON shipped in data/ and emits
 * data/world-index.json — a small lookup that the browser needs before it can
 * draw anything: ISO codes, display names, bounding boxes, land area and a
 * label anchor for every feature on the map.
 *
 * Run with:  npm run build:index
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const topo = JSON.parse(fs.readFileSync(path.join(root, 'data/countries-50m.json'), 'utf8'));
const isoCodes = JSON.parse(fs.readFileSync(path.join(root, 'tools/iso-codes.json'), 'utf8'));

/* ------------------------------------------------------------------ */
/* TopoJSON -> rings (a trimmed-down topojson-client, decode only)      */
/* ------------------------------------------------------------------ */

const [kx, ky] = topo.transform.scale;
const [dx, dy] = topo.transform.translate;

function decodeArc(arc) {
  let x = 0;
  let y = 0;
  return arc.map(([ax, ay]) => {
    x += ax;
    y += ay;
    return [x * kx + dx, y * ky + dy];
  });
}

const arcs = topo.arcs.map(decodeArc);

function ringFromIndices(indices) {
  const points = [];
  for (const raw of indices) {
    const reversed = raw < 0;
    const arc = arcs[reversed ? ~raw : raw];
    const segment = reversed ? arc.slice().reverse() : arc;
    // Arcs share endpoints; drop the duplicate when stitching.
    for (let i = points.length ? 1 : 0; i < segment.length; i++) points.push(segment[i]);
  }
  return points;
}

/** Every feature becomes a flat list of outer rings (holes are ignored here). */
function outerRings(geometry) {
  if (geometry.type === 'Polygon') return [ringFromIndices(geometry.arcs[0])];
  if (geometry.type === 'MultiPolygon') return geometry.arcs.map((poly) => ringFromIndices(poly[0]));
  return [];
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Longitudes made continuous across the antimeridian.
 *
 * Russia's main ring runs east from 19°E all the way past 180°, and averaging
 * those raw longitudes put its centroid at 193°E — the Bering Sea, outside the
 * country. That failed the point-in-polygon test and fell through to a grid
 * search over a bounding box spanning the entire globe, which parked the label
 * "Russia" on St Petersburg. Fiji landed in the Atlantic the same way.
 *
 * Accumulating a ±360 offset at each jump makes the ring one continuous run,
 * so area, centroid and the interior tests all agree. The anchor is wrapped
 * back into [-180, 180] on the way out.
 */
function unwrapRing(ring) {
  const out = [ring[0]];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const delta = ring[i][0] - ring[i - 1][0];
    if (delta > 180) offset -= 360;
    else if (delta < -180) offset += 360;
    out.push(offset === 0 ? ring[i] : [ring[i][0] + offset, ring[i][1]]);
  }
  return out;
}

function wrapLongitude(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Signed planar area in square degrees — only ever compared, never reported. */
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(sum) / 2;
}

function ringCentroid(ring) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
    a += f;
  }
  if (!a) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Label anchor: the centroid of the largest ring, nudged onto the polygon when
 * that centroid falls outside it (crescent-shaped countries such as Vietnam or
 * Croatia). Falls back to a grid search over the ring's bounding box.
 */
function labelAnchor(rawRing) {
  /* Every test below runs in the unwrapped frame, so a ring that crosses the
     antimeridian is treated as the one continuous shape it is. */
  const ring = unwrapRing(rawRing);
  const centroid = ringCentroid(ring);
  if (pointInRing(centroid, ring)) return [wrapLongitude(centroid[0]), centroid[1]];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Pick the interior sample furthest from the ring's bounding-box edges.
  const steps = 24;
  let best = centroid;
  let bestScore = -Infinity;
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const p = [minX + ((maxX - minX) * i) / steps, minY + ((maxY - minY) * j) / steps];
      if (!pointInRing(p, ring)) continue;
      const score = Math.min(p[0] - minX, maxX - p[0], p[1] - minY, maxY - p[1]);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return [wrapLongitude(best[0]), best[1]];
}

/* ------------------------------------------------------------------ */
/* Naming and ISO lookup                                               */
/* ------------------------------------------------------------------ */

const byNumeric = new Map(isoCodes.map(([a2, a3, num]) => [String(Number(num)), { a2, a3 }]));

/**
 * Natural Earth abbreviates a handful of names to fit its own labels. The booth
 * screen has room for the full name, so expand the ones that read badly.
 */
const NAME_OVERRIDES = {
  '384': "Côte d'Ivoire",
  '132': 'Cabo Verde',
  '807': 'North Macedonia',
  '203': 'Czechia',
  '748': 'Eswatini',
  'capeVerde': 'Cabo Verde',
  '410': 'South Korea',
  '408': 'North Korea',
  '626': 'Timor-Leste',
  '834': 'Tanzania',
  '68': 'Bolivia',
  '862': 'Venezuela',
  '498': 'Moldova',
  '96': 'Brunei',
  '360': 'Indonesia',
  '418': 'Laos',
  '104': 'Myanmar',
  '242': 'Fiji',
  '583': 'Micronesia',
  '850': 'U.S. Virgin Islands',
  '92': 'British Virgin Islands',
  '140': 'Central African Republic',
  '178': 'Republic of the Congo',
  '180': 'Democratic Republic of the Congo',
  '260': 'French Southern Territories',
  '336': 'Vatican City',
  '531': 'Curaçao',
  '652': 'Saint Barthélemy',
  '663': 'Saint Martin',
  '534': 'Sint Maarten',
  '652b': 'Saint Barthélemy',
  '214': 'Dominican Republic',
  '136': 'Cayman Islands',
  '184': 'Cook Islands',
  '234': 'Faroe Islands',
  '238': 'Falkland Islands',
  '584': 'Marshall Islands',
  '580': 'Northern Mariana Islands',
  '612': 'Pitcairn Islands',
  '90': 'Solomon Islands',
  '796': 'Turks and Caicos Islands',
  '780': 'Trinidad and Tobago',
  '659': 'Saint Kitts and Nevis',
  '662': 'Saint Lucia',
  '670': 'Saint Vincent and the Grenadines',
  '239': 'South Georgia and the South Sandwich Islands',
  '074': 'Bouvet Island',
  '162': 'Christmas Island',
  '166': 'Cocos (Keeling) Islands',
  '334': 'Heard Island and McDonald Islands',
  '581': 'United States Minor Outlying Islands',
  '772': 'Wallis and Futuna',
  '876': 'Wallis and Futuna',
};

/**
 * Natural Earth carries five polygons with no ISO code. They are rendered as
 * neutral land — no label, no flag, absent from the country picker — so the map
 * makes no claim either way. See the disclaimer in the page footer.
 */
const UNCODED = {
  Somaliland: { key: 'x-somaliland', name: 'Somaliland', neutral: true },
  Kosovo: { key: 'x-kosovo', name: 'Kosovo', a2: 'xk', neutral: true },
  'N. Cyprus': { key: 'x-n-cyprus', name: 'Northern Cyprus', neutral: true },
  'Indian Ocean Ter.': { key: 'x-indian-ocean-ter', name: 'Indian Ocean Territories', neutral: true },
  'Siachen Glacier': { key: 'x-siachen', name: 'Siachen Glacier', neutral: true },
};

/* ------------------------------------------------------------------ */
/* Emit                                                                */
/* ------------------------------------------------------------------ */

const entries = [];

for (let index = 0; index < topo.objects.countries.geometries.length; index++) {
  const geometry = topo.objects.countries.geometries[index];
  const neName = geometry.properties?.name ?? 'Unknown';
  const numeric = geometry.id == null ? null : String(Number(geometry.id));
  const iso = numeric ? byNumeric.get(numeric) : null;
  const uncoded = UNCODED[neName];

  const rings = outerRings(geometry);
  if (!rings.length) continue;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let area = 0;
  let largest = rings[0];
  let largestArea = 0;

  for (const ring of rings) {
    /* Measured unwrapped too: a ring spanning the antimeridian has a
       meaningless shoelace area in raw longitudes. */
    const a = ringArea(unwrapRing(ring));
    area += a;
    if (a > largestArea) {
      largestArea = a;
      largest = ring;
    }
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const anchor = labelAnchor(largest);

  entries.push({
    // `index` is the position in the TopoJSON geometry array — the browser uses
    // it to tie a mesh back to this record without re-deriving anything.
    i: index,
    key: uncoded ? uncoded.key : iso ? iso.a2.toLowerCase() : `x-${index}`,
    name: (numeric && NAME_OVERRIDES[numeric]) || uncoded?.name || neName,
    a2: uncoded ? uncoded.a2 ?? null : iso?.a2.toLowerCase() ?? null,
    a3: uncoded ? null : iso?.a3 ?? null,
    num: numeric,
    neutral: Boolean(uncoded),
    bbox: [round(minX), round(minY), round(maxX), round(maxY)],
    anchor: [round(anchor[0]), round(anchor[1])],
    area: Number(area.toFixed(2)),
  });
}

/**
 * One record per key, keeping the largest.
 *
 * Natural Earth carries a few outlying territories as separate features under
 * their parent's ISO code — Ashmore and Cartier Islands under Australia's. Two
 * records sharing a key meant two name chips and two picker entries resolving
 * to the same country, hidden only because both anchors happened to land on
 * the same spot. Uninhabited reefs with no area of their own are not what this
 * map names, so the parent wins and the speck is dropped.
 */
function dropDuplicateKeys(records) {
  const best = new Map();
  const dropped = [];
  for (const record of records) {
    const held = best.get(record.key);
    if (!held) best.set(record.key, record);
    else if (record.area > held.area) {
      best.set(record.key, record);
      dropped.push(held);
    } else dropped.push(record);
  }
  for (const record of dropped) {
    console.log(`  dropped ${record.name} — shares the key "${record.key}"`);
  }
  return records.filter((record) => best.get(record.key) === record);
}

function round(n) {
  return Number(n.toFixed(3));
}

const named = dropDuplicateKeys(entries);
named.sort((a, b) => a.name.localeCompare(b.name, 'en'));

/* No build timestamp. The CI guard regenerates this file and fails on any
   diff, so a date stamp meant the guard failed every day after the day the
   index was committed — testing the calendar rather than the data. Git already
   records when it was generated, and nothing reads the field. */
const out = {
  source: 'Natural Earth 1:50m Admin 0 via world-atlas@2.0.2',
  count: named.length,
  countries: named,
};

fs.writeFileSync(path.join(root, 'data/world-index.json'), JSON.stringify(out));

const labelled = named.filter((e) => !e.neutral).length;
console.log(`world-index.json: ${named.length} features (${labelled} named, ${named.length - labelled} neutral)`);
