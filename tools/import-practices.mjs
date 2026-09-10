/**
 * Turns the source spreadsheet into the app's practice data.
 *
 * The authoritative content lives in data/source/good-practices.csv — export the
 * "Good Practices (5As)" sheet as CSV, drop it there, and run:
 *
 *   npm run import
 *
 * A CSV rather than the .xlsx on purpose: it diffs in a pull request, so a
 * content change is reviewable line by line instead of as an opaque binary.
 *
 * Output is js/practices-data.js, which practices.js imports. Text is copied
 * verbatim from the sheet — this script places and classifies, it does not
 * rewrite. Anything it cannot resolve is a hard error rather than a silent drop,
 * because a practice missing from the booth map is invisible until someone
 * notices the country is unlit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const csvPath = path.join(root, 'data/source/good-practices.csv');
const outPath = path.join(root, 'js/practices-data.js');

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** RFC 4180 enough for this: quoted fields, doubled quotes, embedded commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((cell) => cell.trim()));
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()])));
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

/** Sheet category label -> the id used throughout the app. */
const CATEGORY_IDS = {
  Affordability: 'affordability',
  Access: 'access',
  Awareness: 'awareness',
  'Attractiveness / Adequacy': 'adequacy',
  'Advocacy & Representation': 'advocacy',
};

/** Sheet spellings that differ from the Natural Earth names in world-index. */
const COUNTRY_ALIASES = {
  'Viet Nam': 'Vietnam',
  'Lao PDR': 'Laos',
  'Korea, Rep.': 'South Korea',
  'Russian Federation': 'Russia',
  'Egypt, Arab Rep.': 'Egypt',
  'Turkiye': 'Turkey',
  'Türkiye': 'Turkey',
  'Cape Verde': 'Cabo Verde',
  'Ivory Coast': "Côte d'Ivoire",
};

/** Stable id from a country code and the scheme name. */
function makeId(a2, scheme, taken) {
  const slug = scheme
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 4)
    .join('-');
  let id = `${a2}-${slug}`;
  let n = 2;
  while (taken.has(id)) id = `${a2}-${slug}-${n++}`;
  taken.add(id);
  return id;
}

/**
 * A one-line summary for the collapsed card. The sheet's description is often a
 * single dense sentence, so take the first sentence and let the full text carry
 * the rest rather than truncating mid-clause.
 */
function summarize(description) {
  const match = /^(.+?[.!?])(\s|$)/.exec(description);
  const first = match ? match[1] : description;
  return first.length > 40 || !description.includes('.') ? first : description;
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

const index = JSON.parse(fs.readFileSync(path.join(root, 'data/world-index.json'), 'utf8'));
const byName = new Map(index.countries.map((c) => [c.name, c]));

const records = parseCsv(fs.readFileSync(csvPath, 'utf8'));
const errors = [];
const taken = new Set();
const practices = [];

/* Countries with several practices would otherwise stack pins on one point;
   nudging each by a small offset keeps them individually clickable. */
const seenPerCountry = new Map();

for (const [line, record] of records.entries()) {
  const where = `row ${line + 2}`;

  const category = CATEGORY_IDS[record.category];
  if (!category) {
    errors.push(`${where}: unknown 5A category "${record.category}"`);
    continue;
  }

  const name = COUNTRY_ALIASES[record.country] || record.country;
  const country = byName.get(name);
  if (!country) {
    errors.push(`${where}: "${record.country}" is not a country on the map`);
    continue;
  }
  if (!country.a2) {
    errors.push(`${where}: "${record.country}" has no ISO code, so it cannot be featured`);
    continue;
  }

  if (!record.scheme) {
    errors.push(`${where}: no scheme name`);
    continue;
  }
  if (!record.description) {
    errors.push(`${where}: no description`);
    continue;
  }

  const nth = seenPerCountry.get(country.key) || 0;
  seenPerCountry.set(country.key, nth + 1);

  /* Spread repeats around the label anchor on a small ring. */
  const spread = 2.2;
  const angle = (nth * 2 * Math.PI) / 6 + 0.4;
  const lonlat = nth === 0
    ? country.anchor
    : [
        Number((country.anchor[0] + Math.cos(angle) * spread).toFixed(3)),
        Number((country.anchor[1] + Math.sin(angle) * spread * 0.7).toFixed(3)),
      ];

  const facts = [];
  if (record.agency) facts.push(['Implementing agency', record.agency]);
  if (record.impact) facts.push(['Coverage & key features', record.impact]);
  if (record.sources) facts.push(['Source', record.sources]);

  practices.push({
    id: makeId(country.a2, record.scheme, taken),
    country: country.name,
    a2: country.a2,
    lonlat,
    category,
    title: record.scheme,
    summary: summarize(record.description),
    detail: record.description,
    impact: record.impact || null,
    agency: record.agency || null,
    sources: record.sources || null,
    facts,
  });
}

if (errors.length) {
  console.error(`\n  ${errors.length} row(s) could not be imported:\n`);
  for (const error of errors) console.error(`    · ${error}`);
  console.error('\n  Nothing was written. Fix the sheet and run again.\n');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Emit                                                                */
/* ------------------------------------------------------------------ */

const countries = new Set(practices.map((p) => p.a2));
const perCategory = {};
for (const p of practices) perCategory[p.category] = (perCategory[p.category] || 0) + 1;

const banner = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source:    data/source/good-practices.csv
 * Regenerate: npm run import
 *
 * ${practices.length} practices across ${countries.size} countries.
 */`;

fs.writeFileSync(
  outPath,
  `${banner}\n\nexport const PRACTICES = ${JSON.stringify(practices, null, 2)};\n`,
);

console.log(`\n  js/practices-data.js: ${practices.length} practices, ${countries.size} countries`);
for (const [id, n] of Object.entries(perCategory).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(3)}  ${id}`);
}
console.log();
