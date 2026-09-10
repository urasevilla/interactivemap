/**
 * Content model for the booth.
 *
 * Everything the visitor reads lives here: the framing statistics, the Five As
 * framework, and the seventeen country practices lifted from the source
 * infographic. Text is expanded where the poster had to abbreviate, so a
 * visitor who opens a country gets a paragraph rather than a caption.
 */

export const FRAMEWORK_ID = 'five-as';

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
 * The Five As. Two of the five carry WIEGO's primary colours; the other three
 * are accents chosen to stay distinguishable for colour-vision deficiency while
 * sitting inside the brand's warm range.
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
    id: 'accessibility',
    label: 'Accessibility',
    short: 'Accessibility',
    blurb: 'Outreach and registration simplified.',
    detail:
      'Registration and contribution collection are brought to where workers already are — one-stop shops, mobile units, peer agents, phones — instead of requiring a trip to a distant office with documents few workers hold.',
    color: '#8E8C13',
    icon: 'hand',
  },
  {
    id: 'adequacy',
    label: 'Adequacy & Attractiveness',
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
    label: 'Advocacy & Associations',
    short: 'Advocacy',
    blurb: 'Collective bargaining and representation.',
    detail:
      'Workers’ own organizations negotiate terms, sit on governing boards and act as the administrative bridge between members and the scheme — so informal workers help design what they are asked to join.',
    color: '#FF671F',
    icon: 'megaphone',
  },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Headline framing shown in the context strip. */
export const CONTEXT = {
  title: 'Global Good Practices: Extending Social Insurance to Informal and Self-Employed Workers',
  standfirst:
    'Informal employment accounts for 56% of the global workforce — up to 66% in Asia-Pacific — and has traditionally fallen outside social security. COVID-19 exposed that gap. The Five As framework guides how countries adapt financing, simplify registration and use technology to move toward universal social protection.',
  stats: [
    { value: '56%', label: 'of the global workforce is in informal employment' },
    { value: '66%', label: 'informal employment in Asia-Pacific' },
    { value: '17', label: 'good practices mapped across 14 countries' },
    { value: '5', label: 'design levers in the “Five As” framework' },
  ],
};

/**
 * The practices. `lonlat` positions the map pin; it is a readable point inside
 * the country rather than a precise programme location.
 */
export const PRACTICES = [
  {
    id: 'de-ksk',
    country: 'Germany',
    a2: 'de',
    lonlat: [10.4, 51.1],
    category: 'adequacy',
    title: 'Künstlersozialversicherung',
    subtitle: 'Artists’ Social Insurance',
    summary:
      'A tripartite model that treats self-employed artists like employees: the artist pays roughly half, the businesses that commission their work pay a levy, and the federal government tops up the rest.',
    detail:
      'Self-employed artists, writers, musicians and journalists are covered for pension, health and long-term care insurance through the Künstlersozialkasse. The artist contributes about 50% — the same share an employee would pay — while businesses that use artistic services pay a levy (the Künstlersozialabgabe) of about 30%, and a federal subsidy covers the remaining 20%. The design solves the central problem of self-employment: there is no single employer to carry the other half of the contribution, so the law spreads that half across everyone who commissions the work.',
    lever: 'Splits the “missing employer share” between the users of the work and the state.',
    facts: [
      ['Artist’s share', '≈ 50%'],
      ['Levy on commissioning businesses', '≈ 30%'],
      ['Federal subsidy', '≈ 20%'],
      ['Covers', 'Pension, health and long-term care'],
    ],
    note: 'The source infographic printed 30 / 30 / 20, which totals 80%. The figures above are the published Künstlersozialkasse split.',
  },
  {
    id: 'mn-onestop',
    country: 'Mongolia',
    a2: 'mn',
    lonlat: [103.0, 46.8],
    category: 'accessibility',
    title: 'One-Stop Shops & Mobile Services',
    summary:
      'Mobile units drive 21 government services out to herders across the steppe, and contributions can be settled in livestock or raw materials rather than cash.',
    detail:
      'Herders live far from any social insurance office, and their income arrives seasonally in kind rather than monthly in cash. Mongolia answered both problems at once. One-stop shops bundle registration and contribution collection with other government services, and mobile units carry 21 of those services directly to remote soums. Contributions can be settled against livestock or raw materials, so a herder does not have to hold cash on the day the payment falls due.',
    lever: 'Takes the office to the worker, and accepts the form of income the worker actually has.',
    facts: [
      ['Services in the mobile package', '21'],
      ['Target group', 'Herders in remote districts'],
      ['Payment in kind', 'Livestock and raw materials accepted'],
    ],
  },
  {
    id: 'id-perisai',
    country: 'Indonesia',
    a2: 'id',
    lonlat: [117.0, -1.5],
    category: 'accessibility',
    title: 'PERISAI',
    subtitle: 'Peer-to-peer registration agents',
    summary:
      'Trained community “activators” register their own neighbours and collect contributions — trust travels through people the worker already knows.',
    detail:
      'PERISAI recruits members of a community as licensed agents — activators — who register other members of that same community into BPJS Ketenagakerjaan, the national employment social security scheme, and collect their contributions. Agents earn a commission on the business they bring in. Because the person doing the registering is a neighbour rather than an official, the scheme clears the trust barrier that defeats most top-down outreach to informal workers.',
    lever: 'Uses existing social ties as the distribution network.',
    facts: [
      ['Mechanism', 'Commissioned community agents'],
      ['Scheme', 'BPJS Ketenagakerjaan'],
      ['Barrier addressed', 'Trust and distance'],
    ],
  },
  {
    id: 'th-article40',
    country: 'Thailand',
    a2: 'th',
    lonlat: [101.0, 15.1],
    category: 'affordability',
    title: 'Article 40 Co-Contributions',
    summary:
      'A voluntary scheme for informal workers where the government matches part of every contribution, cutting the real price of joining.',
    detail:
      'Article 40 of the Social Security Act opens voluntary membership to workers outside formal employment, with the state paying a matching subsidy alongside the worker’s own contribution. Members choose between benefit packages at different price points. The matching subsidy is what makes the arithmetic work: the worker sees a low monthly figure, while the benefit is funded at a level that is actually worth having.',
    lever: 'Government matching lowers the price a worker faces without lowering the benefit.',
    facts: [
      ['Membership', 'Voluntary'],
      ['Government role', 'Matching co-contribution'],
      ['Choice', 'Tiered benefit packages'],
    ],
  },
  {
    id: 'ph-mandate',
    country: 'Philippines',
    a2: 'ph',
    lonlat: [122.0, 12.5],
    category: 'advocacy',
    title: 'Legislative Mandate for Representation',
    summary:
      'The law reserves a seat: one Social Security Commissioner must specifically represent informal sector workers.',
    detail:
      'Rather than leaving informal workers’ representation to goodwill, Philippine law requires that a Commissioner on the Social Security Commission represent the informal sector. Representation is therefore structural — it survives changes of government and cannot be quietly dropped. Informal workers have a standing voice at the table where contribution rates, benefit design and coverage rules are actually decided.',
    lever: 'Puts representation in statute rather than in practice.',
    facts: [
      ['Instrument', 'Statutory requirement'],
      ['Body', 'Social Security Commission'],
      ['Effect', 'A permanent informal-sector seat'],
    ],
  },
  {
    id: 'pt-dependent',
    country: 'Portugal',
    a2: 'pt',
    lonlat: [-8.0, 39.7],
    category: 'affordability',
    title: 'Risk-Sharing for “Economically Dependent” Workers',
    summary:
      'Where one client accounts for most of a self-employed worker’s income, that client pays a contribution of 7–10% — the employer share, by another name.',
    detail:
      'Portuguese law recognizes the “economically dependent” self-employed worker: someone nominally independent whose income comes overwhelmingly from a single contracting entity. Where a client benefits from a substantial share of a worker’s output, that client owes a contribution of 7% to 10% of the income paid. The rule attacks disguised employment directly — a business cannot shed its social security obligations simply by reclassifying its workforce as contractors.',
    lever: 'Assigns the employer share to whoever is actually benefiting from the work.',
    facts: [
      ['Contribution by the contracting entity', '7% – 10%'],
      ['Trigger', 'Economic dependence on one client'],
      ['Target', 'Disguised employment'],
    ],
  },
  {
    id: 'cr-ccss',
    country: 'Costa Rica',
    a2: 'cr',
    lonlat: [-84.2, 10.4],
    category: 'affordability',
    title: 'CCSS Matching Subsidies',
    summary:
      'State matching is inversely proportional to income: the less a worker earns, the larger the government’s share of their contribution.',
    detail:
      'The Caja Costarricense de Seguro Social subsidizes contributions from independent workers on a sliding scale that runs the opposite way to income. Lower-income workers receive a higher government match; as declared income rises, the subsidy tapers. Affordability is therefore built into the contribution schedule itself rather than handled by exemptions, and workers are not pushed out of the scheme by a flat rate they cannot meet.',
    lever: 'Progressive subsidy — the match is largest where the need is greatest.',
    facts: [
      ['Subsidy shape', 'Inversely proportional to income'],
      ['Administered by', 'CCSS'],
      ['Covers', 'Independent and self-employed workers'],
    ],
  },
  {
    id: 'cr-collective',
    country: 'Costa Rica',
    a2: 'cr',
    lonlat: [-83.4, 9.6],
    category: 'advocacy',
    title: 'Collective Insurance Agreements',
    summary:
      'Rural cooperatives negotiate contribution rates for their members and then act as the administrative interface with the scheme.',
    detail:
      'Under collective insurance agreements, an association or rural cooperative negotiates terms on behalf of its members and then handles enrolment and contribution collection itself. Two problems dissolve at once: the scheme deals with one organized counterparty instead of thousands of scattered individuals, and members get a rate and a process shaped by people who understand how their income actually arrives.',
    lever: 'Workers’ organizations become both the bargaining agent and the collection channel.',
    facts: [
      ['Negotiating party', 'Cooperatives and associations'],
      ['Role', 'Rate negotiation plus administration'],
      ['Reach', 'Rural and agricultural members'],
    ],
  },
  {
    id: 'dz-casnos',
    country: 'Algeria',
    a2: 'dz',
    lonlat: [2.6, 28.2],
    category: 'affordability',
    title: 'CASNOS Gradual Scale-Up',
    summary:
      'New members ramp up to the full contribution over three years, giving a business time to grow into the cost.',
    detail:
      'CASNOS, the social insurance fund for the non-salaried, phases new entrants in over three years rather than charging the full rate from day one. The reasoning is behavioural as much as financial: the moment of registration is exactly when a micro-enterprise has least spare cash, and a full-rate demand at that moment is what makes workers walk away. A gradual scale-up converts a cliff into a slope.',
    lever: 'Spreads the cost of entry across the period when the business is least able to pay.',
    facts: [
      ['Scale-up period', '3 years'],
      ['Applies to', 'New entrants'],
      ['Fund', 'CASNOS (non-salaried workers)'],
    ],
  },
  {
    id: 'uy-monotax',
    country: 'Uruguay',
    a2: 'uy',
    lonlat: [-56.0, -32.8],
    category: 'affordability',
    title: 'Social Monotax',
    summary:
      'One payment covers tax and social security together, stepping up from 25% to 100% of the full rate across four years.',
    detail:
      'The monotributo social merges tax and social security contributions into a single payment made to a single office. For new entrants the amount steps up over four years — 25%, then 50%, 75% and finally 100% of the full contribution. Registration stops being a choice between paying tax and paying for social protection: one transaction buys both, and the ramp gives a new micro-business time to reach the full rate.',
    lever: 'A single simplified payment, phased in over four years.',
    facts: [
      ['Step-up', '25% → 50% → 75% → 100%'],
      ['Period', '4 years'],
      ['Consolidates', 'Tax and social security in one payment'],
    ],
  },
  {
    id: 'br-simples',
    country: 'Brazil',
    a2: 'br',
    lonlat: [-51.0, -12.0],
    category: 'affordability',
    title: 'Simples Nacional & MEI',
    summary:
      'Micro-entrepreneurs register once, pay one consolidated monthly amount, and contribute at a reduced rate.',
    detail:
      'Simples Nacional consolidates federal, state and municipal taxes with social security into a single monthly payment. The Microempreendedor Individual (MEI) status sits inside it for the smallest businesses, with a reduced contribution rate and registration that can be completed online in minutes. Formalization becomes cheaper and faster than staying informal — which is the only condition under which voluntary formalization happens at scale.',
    lever: 'Makes the formal route the path of least resistance.',
    facts: [
      ['Payment', 'One consolidated monthly amount'],
      ['MEI', 'Reduced rate for micro-entrepreneurs'],
      ['Registration', 'Online, same-day'],
    ],
  },
  {
    id: 'tn-ahmini',
    country: 'Tunisia',
    a2: 'tn',
    lonlat: [9.5, 34.1],
    category: 'accessibility',
    title: 'AHMINI (“Protect Me”) App',
    summary:
      'A voice-activated mobile app lets rural women agricultural workers register and pay social security without needing to read or travel.',
    detail:
      'AHMINI — “protect me” in Arabic — was built for rural women in agriculture, many of whom cannot read and live far from any social security office. The app is voice-activated, so registration and contribution payments work through speech rather than forms, and payments settle over mobile money. Two exclusions are removed at once: literacy and distance. Registration takes minutes on a phone the worker already owns.',
    lever: 'Voice interface removes literacy as a condition of coverage.',
    facts: [
      ['Interface', 'Voice-activated mobile app'],
      ['Target group', 'Rural women agricultural workers'],
      ['Removes', 'Literacy and travel barriers'],
    ],
  },
  {
    id: 'cv-casa',
    country: 'Cabo Verde',
    a2: 'cv',
    lonlat: [-23.6, 15.1],
    category: 'accessibility',
    title: 'Casa do Cidadão',
    subtitle: 'Citizen’s House one-stop hubs',
    summary:
      'Simplified hubs where registering a micro-enterprise and enrolling in social security happen in the same visit.',
    detail:
      'Casa do Cidadão brings business registration and social security enrolment into one place, physical and online. A micro-entrepreneur completes both in a single visit rather than making separate trips to separate agencies with overlapping paperwork. Every removed step is a point at which a worker would otherwise have dropped out of the process.',
    lever: 'Collapses two bureaucracies into one counter.',
    facts: [
      ['Model', 'One-stop citizen service hub'],
      ['Bundles', 'Micro-enterprise registration + social security'],
      ['Channels', 'In person and online'],
    ],
  },
  {
    id: 'cv-outreach',
    country: 'Cabo Verde',
    a2: 'cv',
    lonlat: [-24.6, 16.2],
    category: 'awareness',
    title: 'Multi-Channel Outreach',
    summary:
      'INPS runs proactive outreach through TV, radio and newspapers — and puts social security into the primary school curriculum.',
    detail:
      'The Instituto Nacional de Previdência Social does not wait to be found. It runs continuous outreach across television, radio and print, and social protection is taught in primary schools. The curriculum work is the long game: children who grow up understanding what social security is become adults who expect to be covered, and who ask why if they are not.',
    lever: 'Treats awareness as a generational investment, not a campaign.',
    facts: [
      ['Channels', 'TV, radio, newspapers'],
      ['Long-term channel', 'Primary school curriculum'],
      ['Institution', 'INPS'],
    ],
  },
  {
    id: 'in-cwb',
    country: 'India',
    a2: 'in',
    lonlat: [79.6, 22.9],
    category: 'adequacy',
    title: 'Construction Welfare Boards',
    summary:
      'A 2% cess on construction projects funds welfare benefits for construction workers — financing follows the industry, not the individual employer.',
    detail:
      'Construction workers move between sites and contractors constantly, so no single employer can be held responsible for their social protection. India’s answer taxes the activity instead of the employment relationship: a cess of up to 2% is levied on the cost of construction projects, and tripartite Welfare Boards use the proceeds to fund benefits — accident cover, maternity, pensions, education and housing assistance. The levy travels with the industry, so a worker’s entitlement does not reset every time the job changes.',
    lever: 'Sector-wide levy replaces the employer contribution for a mobile workforce.',
    facts: [
      ['Cess', 'Up to 2% of construction cost'],
      ['Governed by', 'Tripartite Welfare Boards'],
      ['Benefits', 'Accident, maternity, pension, education, housing'],
    ],
  },
  {
    id: 'zm-spirework',
    country: 'Zambia',
    a2: 'zm',
    lonlat: [27.8, -13.5],
    category: 'adequacy',
    title: 'SPIREWORK / ECIS Pilots',
    summary:
      'Pilots pair short-term payouts such as weather index insurance with long-term benefits, timed to seasonal income.',
    detail:
      'Long-horizon benefits are a hard sell to a worker whose income is seasonal and whose risks are immediate. These pilots combine both: short-term protection — weather index insurance that pays out when the rains fail — alongside long-term savings and pension benefits, with contribution schedules aligned to when farming and informal income actually arrives. The near-term payout is what makes the long-term promise credible.',
    lever: 'Pairs an immediate, visible payout with long-term accumulation.',
    facts: [
      ['Short-term', 'Weather index insurance'],
      ['Long-term', 'Savings and pension benefits'],
      ['Timing', 'Aligned to seasonal income'],
    ],
  },
  {
    id: 'zm-napsa',
    country: 'Zambia',
    a2: 'zm',
    lonlat: [30.0, -15.5],
    category: 'awareness',
    title: 'NAPSA Roadshows',
    summary:
      'Simplified pamphlets and community roadshows build what the scheme calls a nationwide “culture of social security”.',
    detail:
      'The National Pension Scheme Authority takes its message into markets and communities directly, with roadshows and plain-language pamphlets that explain what a contribution buys. The stated goal is a national culture of social security — the shift from social protection as something the state might provide to something workers actively expect and claim.',
    lever: 'Sustained face-to-face outreach in plain language.',
    facts: [
      ['Formats', 'Community roadshows, simplified pamphlets'],
      ['Institution', 'NAPSA'],
      ['Goal', 'A nationwide “culture of social security”'],
    ],
  },
];

/** Countries with at least one practice, keyed by lowercase ISO alpha-2. */
export const FEATURED = (() => {
  const map = new Map();
  for (const p of PRACTICES) {
    if (!map.has(p.a2)) map.set(p.a2, { a2: p.a2, country: p.country, practices: [] });
    map.get(p.a2).practices.push(p);
  }
  return map;
})();

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
