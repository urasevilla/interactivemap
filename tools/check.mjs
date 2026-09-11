/**
 * End-to-end smoke test.
 *
 * Drives a real Chromium against a local server: unlocks the gate with a code
 * minted from the same secret the app uses, waits for the WebGL scene, then
 * exercises the picker, the country panel, the Five As filter, the QR sheet and
 * the guest flow — at booth resolution and on a phone viewport.
 *
 * Usage:  npm run check           (add SHOTS=1 to write screenshots to .shots/)
 *
 * Playwright is not a project dependency; the check resolves it from the global
 * install and skips cleanly when it is not there.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8123;
const SHOTS = process.env.SHOTS === '1';
const shotDir = path.join(root, '.shots');

/* ------------------------------------------------------------------ */
/* Resolve Playwright from wherever it is installed                    */
/* ------------------------------------------------------------------ */

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [];
  try {
    candidates.push(execSync('npm root -g', { encoding: 'utf8' }).trim());
  } catch {
    /* npm not on PATH — fall through to the local resolution below. */
  }

  for (const base of candidates) {
    const entry = path.join(base, 'playwright');
    if (!fs.existsSync(entry)) continue;
    /* Playwright is CommonJS, so a dynamic import puts it behind `.default`. */
    const module = await import(pathToFileURL(path.join(entry, 'index.js')).href);
    return module.chromium ? module : module.default;
  }
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* A booth code, minted in Node with the same scheme as js/tokens.js   */
/* ------------------------------------------------------------------ */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function toBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function mintCode(secret, role, hours, nonceBytes, macBytes) {
  const payload = Buffer.alloc(5 + nonceBytes);
  payload[0] = (1 << 4) | role;
  payload.writeUInt32BE(Math.floor((Date.now() + hours * 3600_000) / 60000), 1);
  crypto.randomFillSync(payload, 5);

  const mac = crypto.createHmac('sha256', secret).update(payload).digest().subarray(0, macBytes);
  return Buffer.concat([payload, mac]);
}

function readSecret() {
  const source = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  return /eventSecret:\s*'([^']+)'/.exec(source)?.[1] || '';
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(root, url === '/' ? 'index.html' : url);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    fs.readFile(file, (error, body) => {
      if (error) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

/* ------------------------------------------------------------------ */
/* Config overrides                                                    */
/* ------------------------------------------------------------------ */

const realConfig = fs.readFileSync(path.join(root, 'config.js'), 'utf8');

/**
 * Serves config.js with extra assignments appended, so a test can pin the
 * settings it depends on without touching the real file.
 *
 * Notes are the reason this exists: with Firebase configured the store talks to
 * Firestore, and the note assertions below need a deterministic offline backend.
 * Appending wins over editing because config.js assigns the whole object.
 */
function overrideConfig(context, overrides) {
  const tail = Object.entries(overrides)
    .map(([key, value]) => `window.WIEGO_MAP_CONFIG.${key} = ${JSON.stringify(value)};`)
    .join('\n');
  return context.route('**/config.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: `${realConfig}\n${tail}\n`,
    }),
  );
}

/** Must match js/auth.js: PBKDF2-SHA256, 200_000 iterations, 256-bit output. */
function passphraseHash(phrase, salt = 'wiego-map') {
  return crypto.pbkdf2Sync(phrase, salt, 200_000, 32, 'sha256').toString('hex');
}

/* ------------------------------------------------------------------ */
/* Assertions                                                          */
/* ------------------------------------------------------------------ */

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  results.push(`  ${ok ? '✓' : '✗'} ${name}${detail && !ok ? `  — ${detail}` : ''}`);
  return ok;
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const playwright = await loadPlaywright();
if (!playwright) {
  console.log('\n  Playwright is not installed — skipping the browser check.');
  console.log('  Install it with:  npm i -g playwright\n');
  process.exit(0);
}

const server = await serve();
const browser = await playwright.chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

if (SHOTS) fs.mkdirSync(shotDir, { recursive: true });

/* Counts come from the generated data, so a content update does not need the
   test edited — only the data regenerated. Imported rather than pattern-matched
   so the assertions below read the same objects the app does. */
const { PRACTICES } = await import(pathToFileURL(path.join(root, 'js/practices-data.js')).href);
const expectedPractices = PRACTICES.length;
const expectedCountries = new Set(PRACTICES.map((p) => p.a2)).size;
const expectedWorkerGroups = new Set(PRACTICES.map((p) => p.workers));
const countPractices = (category, workers) =>
  PRACTICES.filter(
    (p) => (!category || p.category === category) && (!workers || p.workers === workers),
  ).length;

/**
 * Every row of the source sheet must survive the import. The importer errors
 * rather than dropping, so a mismatch here means the generated file is stale —
 * someone edited the CSV and forgot `npm run import`.
 *
 * Counted by the category column, which leads every row and is never quoted,
 * so a description containing a newline cannot inflate the total.
 */
const sourceCsv = fs.readFileSync(path.join(root, 'data/source/good-practices.csv'), 'utf8');
const expectedSourceRows = sourceCsv
  .split('\n')
  .filter((line) => /^(Affordability|Access|Awareness|Attractiveness|Advocacy)[^,]*,/.test(line))
  .length;

const secret = readSecret();
const boothCode = toBase32(mintCode(secret, 1, 24, 1, 4)).match(/.{1,4}/g).join('-');
const guestToken = mintCode(secret, 2, 24, 4, 16).toString('base64url');

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

function watch(page) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    /* Google's sign-in script is expected to be unreachable in this sandbox. */
    if (!/gsi\/client|fonts\.googleapis|fonts\.gstatic|oauth2/.test(request.url())) {
      failedRequests.push(`${request.url()} — ${request.failure()?.errorText}`);
    }
  });
}

/* ---- 1. Desktop / booth ---- */

const desktop = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await overrideConfig(desktop, { firebase: null });
const page = await desktop.newPage();
watch(page);

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

check('gate is shown before any code is entered', await page.isVisible('#gate'));
check('map is hidden behind the gate', await page.isHidden('#app'));

if (SHOTS) await page.screenshot({ path: path.join(shotDir, '01-gate.png') });

/* A wrong code must be refused. */
await page.fill('#gate-code', '0000-0000-0000-0000');
await page.click('#gate-code-submit');
await page.waitForTimeout(250);
check('a wrong code is refused', await page.isVisible('#gate-error'));
check('a wrong code does not open the map', await page.isHidden('#app'));

/* The real code must be accepted. */
await page.fill('#gate-code', '');
await page.type('#gate-code', boothCode.replace(/-/g, ''), { delay: 5 });
await page.click('#gate-code-submit');

await page.waitForSelector('#app:not([hidden])', { timeout: 10_000 });
check('a valid display code opens the map', true);

await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 30_000 });
check('the scene finishes building', true);

/* Give the first frames time to land before probing the scene. */
await page.waitForTimeout(1200);

const scene = await page.evaluate(() => {
  const canvas = document.getElementById('map');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return {
    hasContext: Boolean(gl),
    width: canvas.width,
    height: canvas.height,
    labels: document.querySelectorAll('.label').length,
    visibleLabels: [...document.querySelectorAll('.label')].filter(
      (l) => l.style.display !== 'none',
    ).length,
    featuredLabels: document.querySelectorAll('.label--featured').length,
    legendItems: document.querySelectorAll('.legend__item').length,
    stats: document.querySelectorAll('.stat').length,
  };
});

check('WebGL context is live', scene.hasContext);
check('canvas has real dimensions', scene.width > 100 && scene.height > 100, `${scene.width}x${scene.height}`);
check('all 236 named countries have a label element', scene.labels === 236, `got ${scene.labels}`);
check(
  'every practice country is labelled',
  scene.featuredLabels === expectedCountries,
  `${scene.featuredLabels} labels for ${expectedCountries} countries`,
);
check('featured labels are visible at the default zoom', scene.visibleLabels > 0, `got ${scene.visibleLabels}`);
check('the Five As legend is built', scene.legendItems === 5, `got ${scene.legendItems}`);
check('context statistics are rendered', scene.stats === 4, `got ${scene.stats}`);

/* The rendered image must not be a blank canvas. */
const painted = await page.evaluate(() => window.__mapSample(48));
check('the map actually renders geometry', painted > 8, `${painted} distinct colours`);

/* Framing: the world should fill the booth screen rather than float in it. */
const framing = await page.evaluate(() => window.__mapView);
check(
  'the default view is the fitted home view',
  Math.abs(framing.distance - framing.home) < 0.05,
  `distance ${framing.distance?.toFixed(2)} vs home ${framing.home?.toFixed(2)}`,
);

/**
 * The projection must reach the screen undistorted.
 *
 * Equal Earth is symmetric about the equator, so 60°N and 60°S sit the same
 * distance from it. A perspective camera looking at a tilted plane does not
 * preserve that — the far half of the map is foreshortened far harder than the
 * near half — and the booth screen showed a northern hemisphere crushed into a
 * band while South America stretched. An orthographic camera keeps the ratio
 * exactly, at the home view and zoomed out past it alike.
 */
const symmetryAt = async (label) => {
  const geometry = await page.evaluate(() => {
    const north = window.__mapPoint(0, 60);
    const equator = window.__mapPoint(0, 0);
    const south = window.__mapPoint(0, -60);
    const west = window.__mapPoint(-160, 0);
    const east = window.__mapPoint(160, 0);
    return {
      north: equator.y - north.y,
      south: south.y - equator.y,
      west: equator.x - west.x,
      east: east.x - equator.x,
    };
  });
  const skew = Math.abs(geometry.north - geometry.south) / Math.max(geometry.north, 1);
  const lean = Math.abs(geometry.west - geometry.east) / Math.max(geometry.west, 1);
  check(
    `the hemispheres are the same height ${label}`,
    skew < 0.02,
    `${geometry.north.toFixed(1)}px north vs ${geometry.south.toFixed(1)}px south`,
  );
  check(
    `the map is not skewed east to west ${label}`,
    lean < 0.02,
    `${geometry.west.toFixed(1)}px west vs ${geometry.east.toFixed(1)}px east`,
  );
};

await symmetryAt('at the home view');

/* Zoomed all the way out is where the old camera distorted worst. */
await page.evaluate(() => window.__mapFly(0, 0, 9999));
await page.waitForTimeout(900);
await symmetryAt('zoomed out');
if (SHOTS) await page.screenshot({ path: path.join(shotDir, '02b-zoomed-out.png') });
await page.click('#btn-reset');
await page.waitForTimeout(1100);

/* All five categories must be reachable without scrolling on a booth screen. */
const legendFit = await page.evaluate(() => {
  const legend = document.getElementById('legend');
  const box = legend.getBoundingClientRect();
  return {
    overflows: legend.scrollWidth > Math.ceil(box.width) + 1,
    colours: [...document.querySelectorAll('.legend__swatch')].map(
      (s) => getComputedStyle(s).backgroundColor,
    ),
  };
});
check('the legend fits a 1600px booth screen', !legendFit.overflows);

/**
 * Relief has to stay in proportion to the land it belongs to.
 *
 * Every ring used to get the same wall height, which reads as depth on a
 * continent and as a smear on an island: at world zoom the Philippines was a
 * blur because each island's wall stood as tall as the island is wide. Walls
 * are now capped at a fraction of their own ring's width, so an archipelago
 * keeps only a sliver of extrusion while a continent keeps all of it.
 */
const relief = await page.evaluate(() => ({
  philippines: window.__mapWallBase('ph'),
  indonesia: window.__mapWallBase('id'),
  brazil: window.__mapWallBase('br'),
  russia: window.__mapWallBase('ru'),
}));
check(
  'an archipelago gets only a sliver of relief',
  relief.philippines > 0.5 && relief.indonesia > 0.5,
  `Philippines base ${relief.philippines?.toFixed(2)}, Indonesia ${relief.indonesia?.toFixed(2)}`,
);
check(
  'a continent-sized country keeps its full relief',
  relief.brazil < 0.05 && relief.russia < 0.05,
  `Brazil base ${relief.brazil?.toFixed(2)}, Russia ${relief.russia?.toFixed(2)}`,
);

/* --- Context: the whole framework unfiltered, one barrier under a lens --- */

const contextDefault = await page.evaluate(() => ({
  barriers: [...document.querySelectorAll('.context__barrier-name')].map((n) => n.textContent),
  text: document.querySelector('.context__text')?.textContent || '',
  stats: [...document.querySelectorAll('.stat__label')].map((n) => n.textContent),
  lens: document.querySelectorAll('.context__lens').length,
}));
check(
  'the unfiltered context names all five barriers',
  contextDefault.barriers.length === 5,
  contextDefault.barriers.join(' / '),
);
check(
  'the framing paragraph is the one the host wrote',
  /^Workers in the informal economy are largely locked out of social insurance/.test(
    contextDefault.text.trim(),
  ) && /organized around the workers and barriers they target/.test(contextDefault.text),
  contextDefault.text.slice(0, 80),
);
check(
  'the four headline numbers are shown',
  contextDefault.stats.length === 4 &&
    /most without access to social insurance/.test(contextDefault.stats[0]) &&
    /Asia-Pacific/.test(contextDefault.stats[1]) &&
    /good practices mapped/.test(contextDefault.stats[2]) &&
    /countries mapped/.test(contextDefault.stats[3]),
  contextDefault.stats.join(' | '),
);
check('no single-lens panel is shown unfiltered', contextDefault.lens === 0);

/* replaceChildren stringifies non-Nodes, so a skipped conditional child used
   to write the literal word "null" under the numbers. */
const strayNull = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
  const hits = [];
  let node;
  while ((node = walker.nextNode())) {
    if (/(^|[\s(])null([\s).,]|$)/i.test((node.nodeValue || '').trim())) {
      hits.push(`${node.parentElement?.className}: ${node.nodeValue.trim().slice(0, 40)}`);
    }
  }
  return hits;
});
check('no stray "null" is rendered anywhere', strayNull.length === 0, strayNull.join(' | '));

check(
  'the fifth A is named Association',
  contextDefault.barriers.includes('Association') &&
    (await page.evaluate(() =>
      [...document.querySelectorAll('.legend__name--full')].some((n) => n.textContent === 'Association'),
    )),
  contextDefault.barriers.join(' / '),
);
check(
  'the framing paragraph does not list occupations',
  !/street vendors/.test(contextDefault.text),
  contextDefault.text.slice(0, 90),
);

/* Selecting a lens narrows the card to that barrier and what is on the map. */
await page.locator('.legend__item[data-category="affordability"]').click();
await page.waitForTimeout(600);
const contextLens = await page.evaluate(() => ({
  name: document.querySelector('.context__lens-name')?.textContent || '',
  text: document.querySelector('.context__lens-text')?.textContent || '',
  barriers: document.querySelectorAll('.context__barrier').length,
  stats: [...document.querySelectorAll('.stat__value')].map((n) => Number(n.textContent)),
}));
check(
  'a selected lens swaps the card to that barrier alone',
  contextLens.name === 'Affordability' &&
    /out of reach for irregular, low, or seasonal incomes/.test(contextLens.text) &&
    contextLens.barriers === 0,
  JSON.stringify(contextLens),
);
const affordabilityCount = countPractices('affordability', null);
check(
  'the lens reports what the map is actually showing',
  contextLens.stats[0] === affordabilityCount,
  `card says ${contextLens.stats[0]}, data has ${affordabilityCount}`,
);

/* --- Worker group filter --- */

const workerChips = await page.evaluate(() =>
  [...document.querySelectorAll('.workers__chip')].map((c) => c.dataset.workers),
);
check(
  'every worker group in the data has a chip',
  workerChips.length === expectedWorkerGroups.size + 1 /* plus "All" */,
  `${workerChips.length} chips for ${expectedWorkerGroups.size} groups`,
);

await page.locator('.workers__chip[data-workers="domestic"]').click();
await page.waitForTimeout(700);
const combined = await page.evaluate(() => ({
  stats: [...document.querySelectorAll('.stat__value')].map((n) => Number(n.textContent)),
  note: document.querySelector('.context__filtered')?.textContent || '',
  litLabels: [...document.querySelectorAll('.label--featured')].filter(
    (l) => l.style.display !== 'none',
  ).length,
}));
const bothCount = countPractices('affordability', 'domestic');
check(
  'the two filters compose rather than replace each other',
  combined.stats[0] === bothCount && /domestic workers/.test(combined.note),
  `card says ${combined.stats[0]}, data has ${bothCount}; note "${combined.note}"`,
);

/* Clearing both must put the whole framework back. */
await page.locator('.legend__item[data-category="affordability"]').click();
await page.locator('.workers__chip[data-workers=""]').click();
await page.waitForTimeout(700);
check(
  'clearing both filters restores the full context',
  (await page.evaluate(() => document.querySelectorAll('.context__barrier').length)) === 5,
);
check(
  'each category has its own colour',
  new Set(legendFit.colours).size === 5,
  legendFit.colours.join(' '),
);

if (SHOTS) await page.screenshot({ path: path.join(shotDir, '02-map.png') });

/* ---- Country picker ---- */

await page.click('#picker-input');
await page.waitForSelector('#picker-list:not([hidden])');
const optionCount = await page.locator('.picker__option').count();
check('the picker lists every selectable country', optionCount === 236, `got ${optionCount}`);

await page.fill('#picker-input', 'mongo');
await page.waitForTimeout(160);
const firstOption = await page.locator('.picker__option-name').first().textContent();
check('search finds Mongolia', firstOption === 'Mongolia', `got "${firstOption}"`);

await page.locator('.picker__option').first().click();
await page.waitForSelector('#panel:not([hidden])');

const panel = await page.evaluate(() => ({
  country: document.querySelector('.panel__country')?.textContent,
  practices: document.querySelectorAll('.practice').length,
  bodyVisible: [...document.querySelectorAll('.practice__body')].some(
    (b) => getComputedStyle(b).display !== 'none',
  ),
}));
check('selecting a country opens its panel', panel.country === 'Mongolia', `got "${panel.country}"`);
check('the country shows its practice card', panel.practices >= 1, `got ${panel.practices}`);
check('practice detail starts hidden until clicked', panel.bodyVisible === false);

await page.locator('.practice__head').first().click();
await page.waitForTimeout(320);
const opened = await page.evaluate(() =>
  [...document.querySelectorAll('.practice__body')].some((b) => getComputedStyle(b).display !== 'none'),
);
check('clicking a practice reveals its detail', opened);

/* A title that wraps must not have the category label run on from its last
   word — both are spans, so they need an explicit block. */
const titleLayout = await page.evaluate(() => {
  const title = document.querySelector('.practice__title');
  const cat = document.querySelector('.practice__cat');
  if (!title || !cat) return null;
  return { titleBottom: title.getBoundingClientRect().bottom, catTop: cat.getBoundingClientRect().top };
});
check(
  'the category label sits below the title, not beside it',
  titleLayout && titleLayout.catTop >= titleLayout.titleBottom - 1,
  titleLayout ? `title ends ${titleLayout.titleBottom}, label starts ${titleLayout.catTop}` : 'not found',
);

if (SHOTS) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, '03-country.png') });
}

/* Countries with two practices */
await page.fill('#picker-input', 'Costa');
await page.waitForTimeout(160);
await page.locator('.picker__option').first().click();
await page.waitForTimeout(400);
const costaRica = await page.locator('.practice').count();
check('a multi-practice country lists all of them', costaRica >= 2, `Costa Rica: ${costaRica}`);

/* ---- Direct interaction with the 3D scene ---- */

/* The booth interaction is pointing at a country and clicking it, so the
   raycast path matters more than the picker. Brazil is large and unambiguous. */
await page.click('#btn-reset');
await page.waitForTimeout(1100);

const brazilPoint = await page.evaluate(() => {
  const canvas = document.getElementById('map');
  const box = canvas.getBoundingClientRect();
  /* Ask the label layer where Brazil ended up rather than hard-coding pixels. */
  const label = [...document.querySelectorAll('.label--featured')].find((l) =>
    l.textContent.includes('Brazil'),
  );
  if (!label) return null;
  const lb = label.getBoundingClientRect();
  /* The chip sits above the country's centre; aim a little below it. */
  return { x: lb.left + lb.width / 2 - box.left, y: lb.top + lb.height / 2 - box.top + 34 };
});
check('the Brazil label is placed on screen', Boolean(brazilPoint));

if (brazilPoint) {
  await page.mouse.move(brazilPoint.x, brazilPoint.y);
  await page.waitForTimeout(450);
  const hovered = await page.evaluate(() => ({
    cursor: document.getElementById('map').style.cursor,
    hot: [...document.querySelectorAll('.label--hot')].map((l) => l.textContent.trim()),
  }));
  check('hovering a country marks it', hovered.cursor === 'pointer', `cursor "${hovered.cursor}"`);

  await page.mouse.click(brazilPoint.x, brazilPoint.y);
  await page.waitForTimeout(700);
  const clicked = await page.evaluate(() => ({
    panelOpen: !document.getElementById('panel').hidden,
    country: document.querySelector('.panel__country')?.textContent,
    picker: document.getElementById('picker-input').value,
  }));
  check('clicking a country on the map opens its panel', clicked.panelOpen && clicked.country === 'Brazil', `got "${clicked.country}"`);
  check('the picker follows a map click', clicked.picker === 'Brazil', clicked.picker);
}

/* Clicking empty canvas clears the selection. The point has to miss the
   overlays: the picker sits bottom-left, the country panel right. */
const emptyPoint = await page.evaluate(() => {
  const box = document.getElementById('map').getBoundingClientRect();
  return { x: box.left + box.width * 0.55, y: box.top + box.height * 0.95 };
});
const overlayAtPoint = await page.evaluate(
  (p) => document.elementFromPoint(p.x, p.y)?.id,
  emptyPoint,
);
check('the empty-canvas probe hits the canvas', overlayAtPoint === 'map', `hit "${overlayAtPoint}"`);

await page.mouse.click(emptyPoint.x, emptyPoint.y);
await page.waitForTimeout(500);
check('clicking away clears the selection', await page.isHidden('#panel'));

/* ---- Five As filter ---- */

await page.locator('.legend__item[data-category="affordability"]').click();
await page.waitForTimeout(500);
const filtered = await page.evaluate(() => ({
  hasFilter: document.getElementById('legend').classList.contains('has-filter'),
  visiblePins: document.querySelectorAll('.legend__item.is-active').length,
}));
check('the legend filter engages', filtered.hasFilter && filtered.visiblePins === 1);

await page.locator('.legend__item[data-category="affordability"]').click();
await page.waitForTimeout(300);
check(
  'clicking the same filter again clears it',
  !(await page.evaluate(() => document.getElementById('legend').classList.contains('has-filter'))),
);

/* ---- Zoom ---- */

const zoomBefore = await page.evaluate(() => window.__mapZoom);
await page.click('#btn-zoom-in');
/* The tween is published from the render loop, which under software GL can
   miss a fixed wait entirely — poll for the change rather than sample once. */
await page
  .waitForFunction((before) => window.__mapZoom > before + 1e-4, zoomBefore, { timeout: 6000 })
  .catch(() => {});
const zoomAfter = await page.evaluate(() => window.__mapZoom);
check('the zoom-in control changes the zoom level', zoomAfter > zoomBefore, `${zoomBefore} → ${zoomAfter}`);

await page.click('#btn-reset');
await page.waitForTimeout(1000);

/* ---- QR ---- */

await page.click('#btn-qr');
await page.waitForSelector('#sheet:not([hidden])');
const qr = await page.evaluate(() => {
  const svg = document.querySelector('.qr__frame svg');
  return {
    present: Boolean(svg),
    modules: svg?.querySelector('path')?.getAttribute('d')?.length || 0,
    url: document.querySelector('.qr__url')?.textContent || '',
  };
});
check('a QR code is rendered', qr.present && qr.modules > 500);
check('the QR link carries a guest token', /#g=[A-Za-z0-9_-]{20,}/.test(qr.url), qr.url.slice(0, 60));
check('the QR sheet offers a printable download', (await page.locator('button:has-text("Download for printing")').count()) === 1);

/* The sheet fades in over ~0.3s; screenshot after it lands. */
if (SHOTS) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shotDir, '04-qr.png') });
}
await page.click('.sheet__close');

/* ---- Booth role must not be able to write ---- */

await page.fill('#picker-input', 'India');
await page.waitForTimeout(160);
await page.locator('.picker__option').first().click();
await page.waitForTimeout(400);
const boothCanWrite = await page.locator('button:has-text("Add what you know")').count();
check('the display role cannot add notes', boothCanWrite === 0);
const controllerVisible = await page.isVisible('#btn-control');
check('the controller button is hidden from the display role', !controllerVisible);

/* ---- 2. Phone / guest ---- */

/* Close the booth page first. Its render loop runs flat out against software
   GL in CI, and leaving it running starves whatever we open next. */
await desktop.close();

const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
await overrideConfig(phone, { firebase: null });
const mobile = await phone.newPage();
watch(mobile);

await mobile.goto(`http://localhost:${PORT}/#g=${guestToken}`, { waitUntil: 'domcontentloaded' });
try {
  await mobile.waitForSelector('#app:not([hidden])', { timeout: 20_000 });
  check('a QR guest token opens the map directly', true);
} catch {
  check(
    'a QR guest token opens the map directly',
    false,
    `gate said: ${(await mobile.textContent('#gate-error')) || '(nothing)'}`,
  );
}

await mobile.waitForFunction(() => !document.getElementById('loading'), { timeout: 40_000 });
await mobile.waitForTimeout(1200);

check(
  'the guest token is stripped from the address bar',
  !mobile.url().includes('#g='),
  mobile.url(),
);

const mobileLayout = await mobile.evaluate(() => ({
  bodyScrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  canvasWidth: document.getElementById('map').clientWidth,
  contextCollapsed:
    document.getElementById('context-toggle').getAttribute('aria-expanded') === 'false',
  role: document.body.dataset.role,
}));
check('the phone layout does not scroll sideways', mobileLayout.bodyScrollWidth <= mobileLayout.innerWidth + 1,
  `${mobileLayout.bodyScrollWidth} > ${mobileLayout.innerWidth}`);
check('the canvas fills the phone width', mobileLayout.canvasWidth === mobileLayout.innerWidth,
  `${mobileLayout.canvasWidth} vs ${mobileLayout.innerWidth}`);
check('the context card starts collapsed on a phone', mobileLayout.contextCollapsed);

check('the session is recognised as a visitor', mobileLayout.role === 'guest', mobileLayout.role);

/* A phone showing the whole projection gives each country four pixels, so it
   opens part-way in — close enough that the names are readable on arrival. */
const mobileHome = await mobile.evaluate(() => ({ ...window.__mapView, zoom: window.__mapZoom }));
check(
  'a phone opens zoomed in, not at the whole world',
  mobileHome.distance < mobileHome.max * 0.6,
  `distance ${mobileHome.distance?.toFixed(2)} of max ${mobileHome.max?.toFixed(2)}`,
);
const homeLabels = await mobile.evaluate(
  () => [...document.querySelectorAll('.label')].filter((l) => l.style.display !== 'none').length,
);
check('country names are legible on a phone at first load', homeLabels > 4, `${homeLabels} shown`);

/* The map has to fill the screen it opened on, not float in a band. */
const mobileFill = await mobile.evaluate(() => {
  const canvas = document.getElementById('map');
  const rect = canvas.getBoundingClientRect();
  const top = window.__mapPoint(0, 90).y;
  const bottom = window.__mapPoint(0, -90).y;
  return { covered: (Math.min(bottom, rect.height) - Math.max(top, 0)) / rect.height };
});
check(
  'the map fills the phone screen it opens on',
  mobileFill.covered > 0.9,
  `${Math.round(mobileFill.covered * 100)}% of the canvas height`,
);

if (SHOTS) await mobile.screenshot({ path: path.join(shotDir, '05-mobile.png') });

/**
 * Countries must answer a finger, not only a mouse. Before this worked a tap
 * raycast from wherever a mouse had last been — which on a phone is nowhere —
 * so no country on the map was reachable at all.
 *
 * Taps go to a lon/lat rather than a fraction of the canvas, so the assertion
 * says which country it expects and skips any point the page chrome covers.
 */
const tapAt = async (lon, lat) => {
  const spot = await mobile.evaluate(
    ([lo, la]) => {
      const point = window.__mapPoint(lo, la);
      const rect = document.getElementById('map').getBoundingClientRect();
      const x = rect.left + point.x;
      const y = rect.top + point.y;
      return { x, y, onCanvas: document.elementFromPoint(x, y)?.id === 'map' };
    },
    [lon, lat],
  );
  if (!spot.onCanvas) return { skipped: true };
  await mobile.touchscreen.tap(spot.x, spot.y);
  await mobile.waitForTimeout(700);
  return mobile.evaluate(() => ({
    open: !document.getElementById('panel').hidden,
    country: document.querySelector('.panel__country')?.textContent || '',
  }));
};

/* Water first, while the canvas is still clear. A tap carries a few pixels of
   forgiveness so a fingertip can reach small countries; open ocean must not
   pick the nearest land anyway. */
const tappedSea = await tapAt(-25, 8); // mid-Atlantic
check(
  'a tap on open water selects nothing',
  tappedSea.skipped || !tappedSea.open,
  JSON.stringify(tappedSea),
);

const tapped = await tapAt(8.0, 9.6); // central Nigeria
check(
  'a tap on a country opens it on a phone',
  tapped.open && tapped.country === 'Nigeria',
  JSON.stringify(tapped),
);
if (SHOTS) await mobile.screenshot({ path: path.join(shotDir, '05a-mobile-tap.png') });

/* Countries without a practice have to answer a finger too. The panel is a
   bottom sheet on a phone and covers most of the canvas, so close it before
   reaching for the map again. */
await mobile.evaluate(() => document.getElementById('panel-close').click());
await mobile.waitForTimeout(400);
const tappedPlain = await tapAt(17, 27); // Libya, no mapped practice
check(
  'a country with no practice is tappable too',
  tappedPlain.skipped || tappedPlain.country === 'Libya',
  JSON.stringify(tappedPlain),
);

await mobile.evaluate(() => document.getElementById('panel-close').click());
await mobile.waitForTimeout(400);

/* Zooming out to the whole world suppresses the chips again: fourteen names
   cannot sit near their own countries on a 390px-wide world. Driven through
   the camera rather than the button, because repeated clicks in one task all
   read the same starting distance and only the last one lands. */
await mobile.evaluate(() => window.__mapFly(0, 0, 9999));
await mobile.waitForTimeout(1200);
const worldLabels = await mobile.evaluate(
  () => [...document.querySelectorAll('.label')].filter((l) => l.style.display !== 'none').length,
);
check('name chips give way at world zoom on a phone', worldLabels === 0, `${worldLabels} shown`);
await mobile.click('#btn-reset');
await mobile.waitForTimeout(1100);

/* Every country is reachable from the dropdown, practice or not, and every
   country is open for contributions. */
const pickerCounts = await mobile.evaluate(() => {
  document.getElementById('picker-input').focus();
  const options = [...document.querySelectorAll('.picker__option')];
  return {
    total: options.length,
    plain: options.filter((o) => !o.querySelector('.picker__badge')).length,
  };
});
check(
  'the dropdown lists all 236 countries',
  pickerCounts.total === 236,
  `${pickerCounts.total} listed`,
);
check(
  'countries without a practice are in the dropdown',
  pickerCounts.plain === 236 - expectedCountries,
  `${pickerCounts.plain} plain of ${pickerCounts.total}`,
);

/**
 * Listing them is not the same as reaching them. The 40 practice countries
 * come first, so everything else is a scroll away — and the list used to
 * choose a country on pointerdown, which both fired the moment a finger
 * landed and cancelled the browser's own scrolling. The list could not be
 * dragged at all: whatever you touched was selected, and only the top group
 * was ever reachable.
 *
 * Driven as a real touch drag through CDP, so this exercises native scrolling
 * rather than a scrollTop the test set itself.
 */
const listBox = await mobile.locator('#picker-list').boundingBox();
const cdp = await phone.newCDPSession(mobile);
const touchDrag = async (x, fromY, toY, steps = 6) => {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: fromY }],
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: fromY + ((toY - fromY) * i) / steps }],
    });
    await mobile.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(400);
};

const scrollable = await mobile.evaluate(() => {
  const list = document.getElementById('picker-list');
  list.scrollTop = 0;
  return list.scrollHeight - list.clientHeight;
});
check('the dropdown is long enough to need scrolling', scrollable > 100, `${scrollable}px of overflow`);

await touchDrag(
  listBox.x + listBox.width / 2,
  listBox.y + listBox.height * 0.8,
  listBox.y + listBox.height * 0.15,
);
const dragged = await mobile.evaluate(() => ({
  scrollTop: Math.round(document.getElementById('picker-list').scrollTop),
  stillOpen: !document.getElementById('picker-list').hidden,
  panelOpened: !document.getElementById('panel').hidden,
}));
check(
  'dragging the dropdown scrolls it',
  dragged.scrollTop > 40 && dragged.stillOpen,
  JSON.stringify(dragged),
);
check('dragging the dropdown does not choose a country', !dragged.panelOpened, JSON.stringify(dragged));

/* Reaching the bottom of the list has to show countries with no practice. */
const deepInList = await mobile.evaluate(() => {
  const list = document.getElementById('picker-list');
  list.scrollTop = list.scrollHeight;
  const box = list.getBoundingClientRect();
  const visible = [...list.querySelectorAll('.picker__option')].filter((o) => {
    const r = o.getBoundingClientRect();
    return r.bottom > box.top + 2 && r.top < box.bottom - 2;
  });
  return {
    visible: visible.length,
    plain: visible.filter((o) => !o.querySelector('.picker__badge')).length,
    heading: [...list.querySelectorAll('.picker__group')].map((g) => g.textContent),
  };
});
check(
  'the far end of the list is countries with no practice',
  deepInList.visible > 0 && deepInList.plain === deepInList.visible,
  JSON.stringify(deepInList),
);
check(
  'the list is grouped so both kinds are findable',
  deepInList.heading.length === 2,
  deepInList.heading.join(' / '),
);

/* The two group headings stick at the same offset and hide each other only
   while they are the same height; a wrapped one shows its second line from
   under the other. */
const headingBox = await mobile.evaluate(() => {
  const rows = [...document.querySelectorAll('.picker__group')].map((g) => ({
    text: g.textContent,
    height: Math.round(g.getBoundingClientRect().height),
    wrapped: g.scrollWidth > g.clientWidth + 1,
  }));
  return rows;
});
check(
  'the group headings are one line and the same height',
  headingBox.length === 2 &&
    headingBox[0].height === headingBox[1].height &&
    headingBox.every((h) => !h.wrapped),
  JSON.stringify(headingBox),
);

/* A tap that does not travel must still choose. Reopen first: if the drag
   above wrongly chose a country, the list is closed and this would otherwise
   die on a missing element instead of reporting the failure above. */
await mobile.evaluate(() => {
  const list = document.getElementById('picker-list');
  if (list.hidden) document.getElementById('picker-input').focus();
  list.scrollTop = 0;
});
await mobile.waitForTimeout(250);
await mobile.evaluate(() => document.getElementById('panel-close')?.click());
await mobile.waitForTimeout(250);

const optionBox = await mobile.locator('.picker__option').first().boundingBox();
if (!optionBox) {
  check('a tap on a dropdown option still selects it', false, 'the dropdown would not open');
} else {
  await mobile.touchscreen.tap(optionBox.x + optionBox.width / 2, optionBox.y + optionBox.height / 2);
  await mobile.waitForTimeout(600);
  check(
    'a tap on a dropdown option still selects it',
    await mobile.evaluate(() => !document.getElementById('panel').hidden),
  );
}
await mobile.evaluate(() => document.getElementById('panel-close')?.click());
await mobile.waitForTimeout(300);

await mobile.click('#picker-input');
await mobile.fill('#picker-input', 'Ireland');
await mobile.waitForTimeout(200);
await mobile.locator('.picker__option').first().click();
await mobile.waitForSelector('#panel:not([hidden])');
const plainPanel = await mobile.evaluate(() => ({
  country: document.querySelector('.panel__country')?.textContent || '',
  practices: document.querySelectorAll('#panel .practice').length,
  add: [...document.querySelectorAll('#panel button')].some((b) => /add a practice|add what you know/i.test(b.textContent)),
}));
check(
  'a country with no practice still opens and invites one',
  plainPanel.country === 'Ireland' && plainPanel.practices === 0 && plainPanel.add,
  JSON.stringify(plainPanel),
);

/* Guest adds a note. The panel is a bottom sheet on a phone and covers the
   dropdown, so close it before reaching for the picker again. */
await mobile.evaluate(() => document.getElementById('panel-close').click());
await mobile.waitForTimeout(300);
await mobile.click('#picker-input');
await mobile.fill('#picker-input', 'Thai');
await mobile.waitForTimeout(200);
await mobile.locator('.picker__option').first().click();
await mobile.waitForSelector('#panel:not([hidden])');

const addButton = mobile.locator('#panel button:has-text("Add what you know")');
check('a visitor is offered the add-a-note button', (await addButton.count()) === 1);

/* An inline icon with no size rule fills its button; guard against that. */
const iconSizes = await mobile.evaluate(() =>
  [...document.querySelectorAll('.btn svg')]
    /* Buttons hidden for this role measure zero — only the shown ones matter. */
    .filter((s) => s.closest('.btn').offsetParent !== null)
    .map((s) => Math.round(s.getBoundingClientRect().width)),
);
check(
  'button icons stay icon-sized',
  iconSizes.length > 0 && iconSizes.every((w) => w >= 12 && w <= 28),
  iconSizes.join(', '),
);

await addButton.click();
await mobile.waitForSelector('#sheet:not([hidden])');

/* The map is about one specific thing, and the form has to say so. The
   framing sits above the box rather than in the placeholder, which would
   vanish the moment someone started typing. */
const notePrompt = await mobile.evaluate(() => ({
  prompt: document.querySelector('.addnote__prompt')?.textContent || '',
  visible: Boolean(document.querySelector('.addnote__prompt')?.offsetParent),
}));
check(
  'the note form asks about social insurance for informal and self-employed workers',
  /social insurance/i.test(notePrompt.prompt) &&
    /informal/i.test(notePrompt.prompt) &&
    /self-employed/i.test(notePrompt.prompt),
  notePrompt.prompt,
);
check(
  'the prompt names the country and stays visible',
  notePrompt.prompt.includes('Thailand') && notePrompt.visible,
  JSON.stringify(notePrompt),
);

await mobile.fill('#note-text', 'Vendors in Bangkok markets told us the Article 40 top-up is what made them join.');
await mobile.locator('.chip:has-text("Affordability")').click();
await mobile.fill('.addnote__country + .field input, input[placeholder*="organization"]', 'Booth visitor');
await mobile.locator('button[type="submit"]').click();
await mobile.waitForTimeout(700);

const noteState = await mobile.evaluate(() => ({
  sheetClosed: document.getElementById('sheet').hidden,
  notes: document.querySelectorAll('#panel .note').length,
  text: document.querySelector('.note__text')?.textContent || '',
  stored: JSON.parse(localStorage.getItem('wiego-map.notes.v1') || '[]'),
  pendingTag: document.querySelectorAll('#panel .note__pending').length,
}));
check('the add-note sheet closes on submit', noteState.sheetClosed);
check('the note appears in the country panel', noteState.notes >= 1, `got ${noteState.notes}`);
check('the note text is preserved', noteState.text.includes('Article 40'));
check('the note is persisted', noteState.stored.length >= 1, `got ${noteState.stored.length}`);

/* Moderation: a phone's note is stored unapproved, and its author is told so
   rather than watching it silently fail to appear. */
check(
  'a visitor note is held for approval',
  noteState.stored.every((n) => n.approved === false),
  noteState.stored.map((n) => n.approved).join(','),
);
check('the writer sees their own note marked as waiting', noteState.pendingTag >= 1);

if (SHOTS) await mobile.screenshot({ path: path.join(shotDir, '05b-mobile-note.png') });

/* Notes must be escaped, not executed. */
await mobile.locator('button:has-text("Add what you know")').click();
await mobile.waitForSelector('#sheet:not([hidden])');
await mobile.fill('#note-text', '<img src=x onerror="window.__xss=1">alert test');
await mobile.locator('button[type="submit"]').click();
await mobile.waitForTimeout(600);
const xss = await mobile.evaluate(() => ({
  fired: Boolean(window.__xss),
  images: document.querySelectorAll('.note__text img').length,
  shownAsText: [...document.querySelectorAll('.note__text')].some((n) => n.textContent.includes('<img')),
}));
check('note markup is escaped, not executed', !xss.fired && xss.images === 0 && xss.shownAsText);

/**
 * A background refresh must not move the reader.
 *
 * The notes backend polls, and every poll fired a store change that rebuilt
 * the country panel — throwing whoever was reading it back to the top and
 * collapsing the practice they had open. Worst on a phone, where the panel is
 * a bottom sheet and almost everything is below the fold.
 *
 * Driven through the real mechanism: a second document on the same origin
 * writes a note and broadcasts it, exactly as another device's tab would.
 */
await mobile.evaluate(() => {
  document.querySelector('.practice__head')?.click();
  document.getElementById('panel-body').scrollTop = 180;
});
await mobile.waitForTimeout(300);

const panelScroll = await mobile.evaluate(() => {
  const body = document.getElementById('panel-body');
  return { top: body.scrollTop, room: body.scrollHeight - body.clientHeight };
});

/* A bare same-origin document, so the writer does not boot a second WebGL map. */
const writer = await phone.newPage();
await writer.goto(`http://localhost:${PORT}/config.js`, { waitUntil: 'domcontentloaded' });
const writeNote = (a2, country, text) =>
  writer.evaluate(
    ([code, name, body]) => {
      const key = 'wiego-map.notes.v1';
      const notes = JSON.parse(localStorage.getItem(key) || '[]');
      notes.push({
        id: 'n_' + Math.random().toString(36).slice(2, 12),
        a2: code,
        country: name,
        text: body,
        author: 'Another phone',
        category: null,
        createdAt: Date.now(),
        approved: true,
        visitorId: 'v_other',
      });
      localStorage.setItem(key, JSON.stringify(notes));
      new BroadcastChannel('wiego-map.notes').postMessage('changed');
    },
    [a2, country, text],
  );

await writeNote('ke', 'Kenya', 'A note about a country the reader is not looking at.');
await mobile.waitForTimeout(900);
const afterOther = await mobile.evaluate(() => ({
  top: document.getElementById('panel-body').scrollTop,
  open: document.querySelectorAll('.practice.is-open').length,
}));
check(
  'the country panel has something to scroll on a phone',
  panelScroll.room >= 40 && panelScroll.top > 0,
  `${panelScroll.room}px of room, scrolled to ${panelScroll.top}`,
);
check(
  'a note on another country does not disturb the open panel',
  afterOther.top === panelScroll.top && afterOther.open >= 1,
  `was ${panelScroll.top} (room ${panelScroll.room}), now ${JSON.stringify(afterOther)}`,
);

await writeNote('th', 'Thailand', 'A note that does belong on this country.');
await mobile.waitForTimeout(900);
const afterSame = await mobile.evaluate(() => ({
  top: document.getElementById('panel-body').scrollTop,
  open: document.querySelectorAll('.practice.is-open').length,
  notes: document.querySelectorAll('#panel .note').length,
  text: document.getElementById('panel-body').innerText,
}));
check(
  'a note on this country arrives without scrolling the reader away',
  afterSame.top === panelScroll.top && afterSame.open >= 1,
  `was ${panelScroll.top}, now top ${afterSame.top}, ${afterSame.open} open`,
);
check(
  'the new note is actually shown',
  /does belong on this country/.test(afterSame.text),
  `${afterSame.notes} notes`,
);
await writer.close();

/* ---- 3. Controller ---- */

/* Google sign-in cannot run in this sandbox, so the controller session is
   seeded directly. That skips the auth check — which section 4 covers — and
   exercises the panel behind it: code issuance, moderation, export. */
const hostContext = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await overrideConfig(hostContext, { firebase: null });
const host = await hostContext.newPage();
watch(host);

await host.addInitScript(() => {
  localStorage.setItem(
    'wiego-map.session.v1',
    JSON.stringify({
      role: 'controller',
      email: 'urasevilla@gmail.com',
      name: 'Host',
      expiresAt: Date.now() + 3600_000,
    }),
  );
});

await host.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await host.waitForSelector('#app:not([hidden])', { timeout: 20_000 });
await host.waitForFunction(() => !document.getElementById('loading'), { timeout: 60_000 });
await host.waitForTimeout(900);

check('a stored host session restores without the gate', await host.isHidden('#gate'));
check('the controller button is offered to the host', await host.isVisible('#btn-control'));

await host.click('#btn-control');
await host.waitForSelector('#sheet:not([hidden])');
check(
  'the controller panel has no code until one is issued',
  (await host.locator('.code-display__empty').count()) === 1,
);

await host.locator('button:has-text("Issue display code")').click();
await host.waitForTimeout(500);
if (SHOTS) await host.screenshot({ path: path.join(shotDir, '06-controller.png') });
const issued = (await host.textContent('.code-display__value'))?.trim() || '';
check(
  'issuing produces a 16-character grouped code',
  /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(issued),
  `got "${issued}"`,
);

/* The issued code has to actually open a display session. */
const boothContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await overrideConfig(boothContext, { firebase: null });
const booth = await boothContext.newPage();
watch(booth);
await booth.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await booth.fill('#gate-code', issued);
await booth.click('#gate-code-submit');
let boothOpened = true;
try {
  await booth.waitForSelector('#app:not([hidden])', { timeout: 15_000 });
} catch {
  boothOpened = false;
}
check(
  'a freshly issued code opens the display',
  boothOpened,
  boothOpened ? '' : `gate said: ${await booth.textContent('#gate-error')}`,
);
await boothContext.close();

/* The host sees, and can moderate, the note the phone left earlier. */
await host.reload({ waitUntil: 'domcontentloaded' });
await host.waitForFunction(() => !document.getElementById('loading'), { timeout: 60_000 });
await host.waitForTimeout(800);

/* Notes are per-origin in local mode, so seed one to moderate. */
await host.evaluate(() => {
  localStorage.setItem(
    'wiego-map.notes.v1',
    JSON.stringify([
      {
        id: 'n_seeded',
        a2: 'in',
        country: 'India',
        text: 'The welfare board cess is collected but often under-spent.',
        author: 'Booth visitor',
        category: 'adequacy',
        createdAt: Date.now(),
        approved: true,
        visitorId: 'v_test',
      },
      {
        id: 'n_pending',
        a2: 'ke',
        country: 'Kenya',
        text: 'Boda boda riders pay into Haba Haba by the day, not the month.',
        author: 'Phone visitor',
        category: 'affordability',
        createdAt: Date.now(),
        approved: false,
        visitorId: 'v_phone',
      },
    ]),
  );
});
await host.reload({ waitUntil: 'domcontentloaded' });
await host.waitForFunction(() => !document.getElementById('loading'), { timeout: 60_000 });
await host.waitForTimeout(800);

/* --- Moderation: a phone's note is announced, and waits --- */

const prompt = await host.evaluate(() => {
  const root = document.getElementById('review');
  return {
    shown: root && !root.hidden,
    country: root?.querySelector('.review__country')?.textContent?.trim() || '',
    text: root?.querySelector('.review__text')?.textContent || '',
    actions: [...(root?.querySelectorAll('.review__actions .btn') || [])].map((b) =>
      b.textContent.trim(),
    ),
  };
});
check('a note from a phone raises the approval prompt', prompt.shown, JSON.stringify(prompt));
check('the prompt names the country and quotes the note',
  prompt.country.includes('Kenya') && prompt.text.includes('Haba Haba'), JSON.stringify(prompt));
check(
  'the prompt offers approve and reject',
  prompt.actions.some((a) => /approve/i.test(a)) && prompt.actions.some((a) => /reject/i.test(a)),
  prompt.actions.join(' / '),
);
if (SHOTS) await host.screenshot({ path: path.join(shotDir, '06b-approval.png') });

/* Until it is approved it must be nowhere on the booth screen. */
await host.fill('#picker-input', 'Kenya');
await host.waitForTimeout(200);
await host.locator('.picker__option').first().click();
await host.waitForTimeout(500);
const heldBack = await host.evaluate(() => ({
  notes: document.querySelectorAll('#panel .note').length,
  badge: [...document.querySelectorAll('.label--featured')].find((l) =>
    l.textContent.includes('Kenya'),
  )?.querySelector('.label__count')?.textContent,
}));
const kenyaPractices = PRACTICES.filter((p) => p.a2 === 'ke').length;
check(
  'an unapproved note is not posted to the map',
  heldBack.notes === 0,
  `${heldBack.notes} shown on the country panel`,
);
check(
  'an unapproved note is not counted on the label either',
  heldBack.badge === String(kenyaPractices),
  `badge read ${heldBack.badge}, expected ${kenyaPractices}`,
);

/* Approving from the prompt is what posts it. */
await host.locator('.review__actions .btn:has-text("Approve")').click();
await host.waitForTimeout(700);
const published = await host.evaluate(() => ({
  promptGone: document.getElementById('review').hidden,
  notes: document.querySelectorAll('#panel .note').length,
  text: document.querySelector('#panel .note__text')?.textContent || '',
  stored: JSON.parse(localStorage.getItem('wiego-map.notes.v1') || '[]').find(
    (n) => n.id === 'n_pending',
  )?.approved,
}));
check('approving posts the note to the map', published.notes === 1 && published.text.includes('Haba Haba'),
  JSON.stringify(published));
check('approval is written back to the store', published.stored === true, String(published.stored));
check('the prompt clears once the queue is empty', published.promptGone);

await host.click('#btn-control');
await host.waitForSelector('#sheet:not([hidden])');
const moderation = await host.evaluate(() => ({
  notes: document.querySelectorAll('.ctl__notes .note').length,
  stats: [...document.querySelectorAll('.ctl__stat-value')].map((n) => n.textContent),
}));
check('the host sees visitor notes for moderation', moderation.notes === 2, `${moderation.notes} shown`);
check('the note counters are right', moderation.stats.join('/') === '2/0/2', moderation.stats.join('/'));

/* Not clicked: deleting here would take away the note the next assertions
   read back off the country panel. */
check(
  'every note offers the host a delete control',
  (await host.locator('.ctl__notes .note__action--danger').count()) === 2,
);

await host.click('.sheet__close');

/* The seeded note must reach the country panel too. */
await host.fill('#picker-input', 'India');
await host.waitForTimeout(200);
await host.locator('.picker__option').first().click();
await host.waitForTimeout(500);
const hostPanel = await host.evaluate(() => ({
  notes: document.querySelectorAll('#panel .note').length,
  canAdd: document.querySelectorAll('#panel button').length,
}));

/* The label badge shows practices + notes, so the expected number depends on
   how many practices India has in the current data — derive it, don't pin it. */
const indiaPractices = PRACTICES.filter((p) => p.a2 === 'in').length;
const labelBadge = await host.evaluate(
  (expected) =>
    [...document.querySelectorAll('.label--featured')].some(
      (l) =>
        l.textContent.includes('India') &&
        l.querySelector('.label__count')?.textContent === String(expected),
    ),
  indiaPractices + 1,
);
check('a visitor note appears on the country panel', hostPanel.notes >= 1, `${hostPanel.notes}`);
check(
  'the country label counts practices plus notes',
  labelBadge,
  `expected ${indiaPractices} practices + 1 note`,
);

check(
  'every practice in the sheet reached the app',
  expectedPractices === expectedSourceRows && expectedCountries > 0,
  `${expectedPractices} practices from ${expectedSourceRows} source rows / ${expectedCountries} countries`,
);

/* The Five As explainer must open with all five entries. */
await host.click('.legend__about');
await host.waitForSelector('#sheet:not([hidden])');
const framework = await host.evaluate(() => ({
  title: document.getElementById('sheet-title').textContent,
  sections: document.querySelectorAll('#sheet-body .ctl__section').length,
}));
check('the Five As explainer opens', framework.title === 'The Five As', framework.title);
check('it covers all five levers', framework.sections === 5, `${framework.sections}`);
if (SHOTS) {
  await host.waitForTimeout(500);
  await host.screenshot({ path: path.join(shotDir, '07-framework.png') });
}
await host.click('.sheet__close');

await hostContext.close();

/* ---- 4. Host sign-in ---- */

/* A configured client ID must actually reach the gate, and the booth has to
   degrade honestly when the venue blocks accounts.google.com — which is the
   one failure mode that would strand the host in front of an audience. */
const signInContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const signIn = await signInContext.newPage();

/* Simulate the venue firewall. */
await signIn.route('**://accounts.google.com/**', (route) => route.abort());

await signIn.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await signIn.click('[data-gate-tab="owner"]');
await signIn.waitForTimeout(1200);

const configuredClientId = /googleClientId:\s*'([^']*)'/.exec(
  fs.readFileSync(path.join(root, 'config.js'), 'utf8'),
)?.[1];

const signInState = await signIn.evaluate(() => ({
  clientId: window.WIEGO_MAP_CONFIG.googleClientId,
  owner: window.WIEGO_MAP_CONFIG.ownerEmail,
  note: document.getElementById('gate-google-note').textContent,
  passphraseShown: !document.querySelector('.field[data-passphrase]')?.hidden,
}));

check(
  'the configured Google client ID reaches the page',
  signInState.clientId === configuredClientId && signInState.clientId.endsWith('.apps.googleusercontent.com'),
  signInState.clientId || '(empty)',
);
check(
  'the gate says who may control the map without publishing the address',
  /can control this map/.test(signInState.note) || /could not load/.test(signInState.note),
  signInState.note,
);

/* The repository is public, so the host's address must not be sitting in the
   served source for a scraper to pick up. */
const emailLeak = await signIn.evaluate(async () => {
  const sources = await Promise.all(
    ['config.js', 'js/config-loader.js', 'js/auth.js', 'js/main.js', 'index.html'].map((f) =>
      fetch(f).then((r) => r.text()),
    ),
  );
  const found = sources.join('\n').match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
  /* noreply@ addresses in licence headers are not the host's. */
  return found.filter((a) => !/noreply@|example\.com|\.png$|\.svg$/.test(a));
});
check(
  'no host email address is served in the source',
  emailLeak.length === 0,
  emailLeak.join(', '),
);

/* And the digest still has to identify the right account. */
const digestWorks = await signIn.evaluate(async () => {
  const hash = async (email) => {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  const configured = window.WIEGO_MAP_CONFIG.ownerEmailHash;
  return {
    matchesOwner: (await hash('urasevilla@gmail.com')) === configured,
    rejectsOther: (await hash('someone.else@gmail.com')) !== configured,
  };
});
check('the configured digest matches the host account', digestWorks.matchesOwner);
check('the digest rejects a different account', digestWorks.rejectsOther);
check(
  'a blocked accounts.google.com is reported, not left silent',
  /could not load/i.test(signInState.note),
  signInState.note,
);
check(
  'the blocked-network message matches what is actually configured',
  signInState.passphraseShown
    ? /passphrase below/i.test(signInState.note)
    : /no owner passphrase is configured/i.test(signInState.note),
  `passphrase ${signInState.passphraseShown ? 'set' : 'unset'} — "${signInState.note}"`,
);
check('the map stays locked when sign-in is unavailable', await signIn.isHidden('#app'));

await signInContext.close();

/* ---- 5. Passphrase fallback ---- */

/* The host's real passphrase must not live in this file, so the test injects a
   hash of its own and signs in with the matching phrase. That exercises the
   mechanism — the way in when a venue blocks accounts.google.com. */
const TEST_PHRASE = 'check-only-passphrase-not-the-real-one';

const passContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await overrideConfig(passContext, {
  firebase: null,
  googleClientId: '',
  ownerPassphraseHash: passphraseHash(TEST_PHRASE),
});
const pass = await passContext.newPage();
watch(pass);

await pass.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await pass.click('[data-gate-tab="owner"]');
await pass.waitForTimeout(300);

check('the passphrase field is offered when one is configured', await pass.isVisible('#gate-passphrase'));

await pass.fill('#gate-passphrase', 'definitely-the-wrong-phrase');
await pass.click('#gate-passphrase-submit');
await pass.waitForTimeout(600);
check('a wrong passphrase is refused', await pass.isHidden('#app'));
check(
  'the refusal says so plainly',
  /not right/i.test((await pass.textContent('#gate-error')) || ''),
  await pass.textContent('#gate-error'),
);

await pass.fill('#gate-passphrase', TEST_PHRASE);
await pass.click('#gate-passphrase-submit');
await pass.waitForSelector('#app:not([hidden])', { timeout: 20_000 });
await pass.waitForFunction(() => !document.getElementById('loading'), { timeout: 60_000 });
await pass.waitForTimeout(600);

check('the right passphrase opens the map', true);
check('passphrase sign-in grants the host role', (await pass.getAttribute('body', 'data-role')) === 'controller');
check('the host gets the controller button', await pass.isVisible('#btn-control'));

await passContext.close();

/* ---- 6. The shipped config is event-ready ---- */

/* These read the real config.js from disk — the point is what actually ships. */
const shipped = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const shippedSecret = /eventSecret:\s*'([^']*)'/.exec(shipped)?.[1] || '';

check(
  'an event secret is set',
  shippedSecret.length >= 32,
  `${shippedSecret.length} chars`,
);
check(
  'a Google client ID is configured',
  /googleClientId:\s*'[\w-]+\.apps\.googleusercontent\.com'/.test(shipped),
);
check(
  'a host account is configured',
  /ownerEmailHash:\s*'[0-9a-f]{64}'/.test(shipped) || /ownerEmail:\s*'[^']+@/.test(shipped),
);
check(
  'the passphrase fallback is set, so a blocked Google cannot lock the host out',
  /ownerPassphraseHash:\s*'[0-9a-f]{64}'/.test(shipped),
);
check(
  'live sync is configured',
  /apiKey:\s*'AIza[\w-]+'/.test(shipped) && /projectId:\s*'[\w-]+'/.test(shipped),
);

/* ---- 7. Expired credentials ---- */

const expiredCode = toBase32(mintCode(secret, 1, -1, 1, 4)).match(/.{1,4}/g).join('-');
const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await overrideConfig(fresh, { firebase: null });
const expiredPage = await fresh.newPage();
watch(expiredPage);
await expiredPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await expiredPage.fill('#gate-code', expiredCode);
await expiredPage.click('#gate-code-submit');
await expiredPage.waitForTimeout(300);
const expiredMessage = await expiredPage.textContent('#gate-error');
check('an expired code is refused', await expiredPage.isHidden('#app'));
check('the expiry message explains itself', /expired/i.test(expiredMessage || ''), expiredMessage);

/* A code minted under a different secret must not work. */
const forged = toBase32(mintCode('not-the-real-secret', 1, 24, 1, 4)).match(/.{1,4}/g).join('-');
await expiredPage.fill('#gate-code', forged);
await expiredPage.click('#gate-code-submit');
await expiredPage.waitForTimeout(300);
check('a code from another secret is refused', await expiredPage.isHidden('#app'));

/* ---- Report ---- */

await browser.close();
server.close();

console.log('\n' + results.join('\n'));

if (consoleErrors.length) {
  console.log('\n  Console errors:');
  for (const error of [...new Set(consoleErrors)].slice(0, 12)) console.log(`    · ${error}`);
}
if (pageErrors.length) {
  console.log('\n  Uncaught exceptions:');
  for (const error of [...new Set(pageErrors)].slice(0, 12)) console.log(`    · ${error}`);
}
if (failedRequests.length) {
  console.log('\n  Failed requests:');
  for (const request of [...new Set(failedRequests)].slice(0, 12)) console.log(`    · ${request}`);
}

const clean = failures === 0 && pageErrors.length === 0 && failedRequests.length === 0;
console.log(`\n  ${results.length - failures}/${results.length} checks passed${clean ? '' : ' — see above'}\n`);
process.exit(clean ? 0 : 1);
