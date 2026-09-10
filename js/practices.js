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
    label: 'Advocacy & Representation',
    short: 'Advocacy',
    blurb: 'Collective bargaining and representation.',
    detail:
      'Workers’ own organizations negotiate terms, sit on governing boards and act as the administrative bridge between members and the scheme — so informal workers help design what they are asked to join.',
    color: '#FF671F',
    icon: 'megaphone',
  },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

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
    'Informal employment accounts for 56% of the global workforce — up to 66% in Asia-Pacific — and has traditionally fallen outside social security. COVID-19 exposed that gap. The Five As framework guides how countries adapt financing, simplify registration and use technology to move toward universal social protection.',
  stats: [
    { value: '56%', label: 'of the global workforce is in informal employment' },
    { value: '66%', label: 'informal employment in Asia-Pacific' },
    {
      value: String(PRACTICES.length),
      label: `good practices mapped across ${FEATURED.size} countries`,
    },
    { value: '5', label: 'design levers in the “Five As” framework' },
  ],
};

/**
 * A featured country's map colour comes from its first practice; countries with
 * practices in several categories get a striped treatment in the legend instead.
 */
export function categoriesFor(a2) {
  const entry = FEATURED.get(a2);
  if (!entry) return [];
  return [...new Set(entry.practices.map((p) => p.category))];
}

export const DISCLAIMER =
  'Boundaries and names shown do not imply official endorsement or acceptance. Base map: Natural Earth 1:50m Admin 0. Areas shown without a name or flag are subject to unresolved sovereignty questions and are drawn as neutral land.';
