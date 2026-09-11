/**
 * Content model for the booth.
 *
 * The practices themselves are generated from the source spreadsheet into
 * practices-data.js — see tools/import-practices.mjs. This file holds what is
 * hand-authored: the Five As framework, the framing statistics, and the lookups
 * the map and UI build on.
 */
import { PRACTICES } from './practices-data.js';

export { PRACTICES };

/** WIEGO brand palette, from the 2019 Brandbook (Guidelines 2019, p.14). */
export const BRAND = {
  orange: '#FF671F', // Pantone 165 C — primary
  green: '#8E8C13', // Pantone 582 C — primary
  brown: '#8B5B29', // Pantone 464 C — secondary
  darkKhaki: '#5E514D', // Pantone 411 C — secondary
  warmGray: '#796E65', // Pantone 10 C — secondary
  nudeKhaki: '#EFDBB2', // Pantone 7506 C — secondary
};

/**
 * The Five As, named as the source database names them.
 *
 * Two of the five carry WIEGO's primary colours; the other three are accents
 * chosen to stay distinguishable for colour-vision deficiency while sitting
 * inside the brand's warm range.
 */
export const CATEGORIES = [
  {
    id: 'affordability',
    barrier:
      'Contributions indexed to formal salaries are out of reach for irregular, low, or seasonal incomes.',
    label: 'Affordability',
    short: 'Affordability',
    blurb: 'Financial entry barriers reduced.',
    detail:
      'Contribution rates, payment schedules and entry costs are redesigned around irregular, low and seasonal incomes — through subsidies, matching contributions, simplified single payments or a gradual ramp-up to the full rate.',
    color: '#1F5673',
    icon: 'currency',
  },
  {
    id: 'access',
    barrier:
      'Registration and enrollment systems assume a formal employer, ID, or fixed workplace informal workers don’t have.',
    label: 'Access',
    short: 'Access',
    blurb: 'Outreach and registration simplified.',
    detail:
      'Registration and contribution collection are brought to where workers already are — one-stop shops, mobile units, peer agents, phones — instead of requiring a trip to a distant office with documents few workers hold.',
    color: '#8E8C13',
    icon: 'hand',
  },
  {
    id: 'adequacy',
    barrier:
      'Even when workers get in, benefit levels and coverage often don’t match their real risks or needs.',
    label: 'Attractiveness & Adequacy',
    short: 'Adequacy',
    blurb: 'Meaningful, relevant benefits.',
    detail:
      'Benefits are worth contributing for: they match the risks workers actually face, pay out on a timescale workers can feel, and are financed durably enough to keep their promise.',
    color: '#A31D3C',
    icon: 'heart',
  },
  {
    id: 'awareness',
    barrier:
      'Many eligible workers simply don’t know a scheme exists or how to use it.',
    label: 'Awareness',
    short: 'Awareness',
    blurb: 'Proactive information and education.',
    detail:
      'Schemes tell workers they exist, in the languages and channels workers use, and explain what contributions buy — building a lasting culture of social security rather than a one-off campaign.',
    color: '#D6A419',
    icon: 'bulb',
  },
  {
    id: 'advocacy',
    barrier:
      'Without a union or cooperative to organize through, informal workers have no collective voice to negotiate for coverage or hold schemes accountable.',
    label: 'Association',
    short: 'Association',
    blurb: 'Collective bargaining and representation.',
    detail:
      'Workers’ own organizations negotiate terms, sit on governing boards and act as the administrative bridge between members and the scheme — so informal workers help design what they are asked to join.',
    color: '#FF671F',
    icon: 'megaphone',
  },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/**
 * Who each practice is aimed at, as the source database groups them.
 *
 * Kept in step with WORKER_IDS in tools/import-practices.mjs — the importer
 * refuses a row naming a group that is not here, so the two cannot drift.
 */
export const WORKER_GROUPS = [
  { id: 'general', label: 'Informal economy (general)', short: 'Informal economy' },
  { id: 'domestic', label: 'Domestic workers', short: 'Domestic' },
  { id: 'self-employed', label: 'Self-employed / own-account', short: 'Self-employed' },
  { id: 'agricultural', label: 'Agricultural / rural workers', short: 'Agricultural' },
  { id: 'platform', label: 'Platform & gig workers', short: 'Platform & gig' },
];

export const WORKER_BY_ID = new Map(WORKER_GROUPS.map((w) => [w.id, w]));

/** Countries with at least one practice, keyed by lowercase ISO alpha-2. */
export const FEATURED = (() => {
  const map = new Map();
  for (const p of PRACTICES) {
    if (!map.has(p.a2)) map.set(p.a2, { a2: p.a2, country: p.country, practices: [] });
    map.get(p.a2).practices.push(p);
  }
  return map;
})();

/** Headline framing shown in the context strip. */
export const CONTEXT = {
  title: 'Global Good Practices: Extending Social Insurance to Informal and Self-Employed Workers',
  standfirst:
    'Workers in the informal economy are largely locked out of social insurance. Contributions are often unaffordable given irregular incomes, registration systems assume a formal employer, benefits rarely match real needs, and many workers simply don’t know what they’re entitled to. Countries are testing different fixes: matching contributions, mobile registration, portable benefits across jobs, and outreach through worker organizations. This map tracks such practices across countries, organized around the workers and barriers they target.',
  stats: [
    {
      value: '56%',
      label: 'of the global workforce works informally — most without access to social insurance',
    },
    { value: '66%', label: 'in Asia-Pacific' },
    { value: String(PRACTICES.length), label: 'good practices mapped' },
    { value: String(new Set(PRACTICES.map((p) => p.a2)).size), label: 'countries mapped' },
  ],
};

/** Practices matching a category and/or a worker group; null means "any". */
export function practicesMatching(category, workers) {
  return PRACTICES.filter(
    (p) => (!category || p.category === category) && (!workers || p.workers === workers),
  );
}

/** How many practices and countries sit behind a filter, for the context card. */
export function countsFor(category, workers) {
  const matches = practicesMatching(category, workers);
  return { practices: matches.length, countries: new Set(matches.map((p) => p.a2)).size };
}

/**
 * A featured country's map colour comes from its first practice; countries with
 * practices in several categories get a striped treatment in the legend instead.
 */
export function categoriesFor(a2) {
  const entry = FEATURED.get(a2);
  if (!entry) return [];
  return [...new Set(entry.practices.map((p) => p.category))];
}

/** True when a country has a practice matching both filters; null means "any". */
export function countryMatches(a2, category, workers) {
  const entry = FEATURED.get(a2);
  if (!entry) return false;
  return entry.practices.some(
    (p) => (!category || p.category === category) && (!workers || p.workers === workers),
  );
}

export const DISCLAIMER =
  'Boundaries and names shown do not imply official endorsement or acceptance. Base map: Natural Earth 1:50m Admin 0. Areas shown without a name or flag are subject to unresolved sovereignty questions and are drawn as neutral land.';
