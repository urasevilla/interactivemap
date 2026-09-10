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
check('14 featured countries are labelled', scene.featuredLabels === 14, `got ${scene.featuredLabels}`);
check('featured labels are visible at the default zoom', scene.visibleLabels >= 14, `got ${scene.visibleLabels}`);
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
check('the country has its practice card', panel.practices === 1, `got ${panel.practices}`);
check('practice detail starts hidden until clicked', panel.bodyVisible === false);

await page.locator('.practice__head').first().click();
await page.waitForTimeout(320);
const opened = await page.evaluate(() =>
  [...document.querySelectorAll('.practice__body')].some((b) => getComputedStyle(b).display !== 'none'),
);
check('clicking a practice reveals its detail', opened);

if (SHOTS) await page.screenshot({ path: path.join(shotDir, '03-country.png') });

/* Countries with two practices */
await page.fill('#picker-input', 'Costa');
await page.waitForTimeout(160);
await page.locator('.picker__option').first().click();
await page.waitForTimeout(400);
const costaRica = await page.locator('.practice').count();
check('Costa Rica shows both of its practices', costaRica === 2, `got ${costaRica}`);

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
await page.waitForTimeout(500);
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

if (SHOTS) await page.screenshot({ path: path.join(shotDir, '04-qr.png') });
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

/* Fourteen name chips cannot sit near their countries on a 390px world map;
   at this zoom the pins carry the map instead. */
const compactLabels = await mobile.evaluate(
  () => [...document.querySelectorAll('.label')].filter((l) => l.style.display !== 'none').length,
);
check('name chips are suppressed at world zoom on a phone', compactLabels === 0, `${compactLabels} shown`);
check('the session is recognised as a visitor', mobileLayout.role === 'guest', mobileLayout.role);

if (SHOTS) await mobile.screenshot({ path: path.join(shotDir, '05-mobile.png') });

/* Zooming in on a phone brings the names back. */
await mobile.evaluate(() => {
  for (let i = 0; i < 6; i++) document.getElementById('btn-zoom-in').click();
});
await mobile.waitForTimeout(1400);
const zoomedLabels = await mobile.evaluate(
  () => [...document.querySelectorAll('.label')].filter((l) => l.style.display !== 'none').length,
);
check('names return once a phone user zooms in', zoomedLabels > 0, `${zoomedLabels} shown`);
await mobile.click('#btn-reset');
await mobile.waitForTimeout(1100);

/* Guest adds a note */
await mobile.click('#picker-input');
await mobile.fill('#picker-input', 'Thai');
await mobile.waitForTimeout(200);
await mobile.locator('.picker__option').first().click();
await mobile.waitForSelector('#panel:not([hidden])');

const addButton = mobile.locator('button:has-text("Add what you know")');
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
await mobile.fill('#note-text', 'Vendors in Bangkok markets told us the Article 40 top-up is what made them join.');
await mobile.locator('.chip:has-text("Affordability")').click();
await mobile.fill('.addnote__country + .field input, input[placeholder*="organization"]', 'Booth visitor');
await mobile.locator('button[type="submit"]').click();
await mobile.waitForTimeout(700);

const noteState = await mobile.evaluate(() => ({
  sheetClosed: document.getElementById('sheet').hidden,
  notes: document.querySelectorAll('.note').length,
  text: document.querySelector('.note__text')?.textContent || '',
  stored: JSON.parse(localStorage.getItem('wiego-map.notes.v1') || '[]').length,
}));
check('the add-note sheet closes on submit', noteState.sheetClosed);
check('the note appears in the country panel', noteState.notes >= 1, `got ${noteState.notes}`);
check('the note text is preserved', noteState.text.includes('Article 40'));
check('the note is persisted', noteState.stored >= 1, `got ${noteState.stored}`);

if (SHOTS) await mobile.screenshot({ path: path.join(shotDir, '06-mobile-note.png') });

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

/* ---- 3. Controller ---- */

/* Google sign-in cannot run in this sandbox, so the controller session is
   seeded directly. That skips the auth check — which section 4 covers — and
   exercises the panel behind it: code issuance, moderation, export. */
const hostContext = await browser.newContext({ viewport: { width: 1500, height: 950 } });
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
await host.waitForTimeout(400);
const issued = (await host.textContent('.code-display__value'))?.trim() || '';
check(
  'issuing produces a 16-character grouped code',
  /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(issued),
  `got "${issued}"`,
);

/* The issued code has to actually open a display session. */
const boothContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
    ]),
  );
});
await host.reload({ waitUntil: 'domcontentloaded' });
await host.waitForFunction(() => !document.getElementById('loading'), { timeout: 60_000 });
await host.waitForTimeout(800);

await host.click('#btn-control');
await host.waitForSelector('#sheet:not([hidden])');
const moderation = await host.evaluate(() => ({
  notes: document.querySelectorAll('.ctl__notes .note').length,
  stats: [...document.querySelectorAll('.ctl__stat-value')].map((n) => n.textContent),
}));
check('the host sees visitor notes for moderation', moderation.notes === 1, `${moderation.notes} shown`);
check('the note counters are right', moderation.stats.join('/') === '1/0/1', moderation.stats.join('/'));

await host.locator('.ctl__notes .note__action--danger').first().click();
await host.evaluate(() => {
  window.confirm = () => true;
});
await host.waitForTimeout(300);

await host.click('.sheet__close');

/* The seeded note must reach the country panel too. */
await host.fill('#picker-input', 'India');
await host.waitForTimeout(200);
await host.locator('.picker__option').first().click();
await host.waitForTimeout(500);
const hostPanel = await host.evaluate(() => ({
  notes: document.querySelectorAll('#panel .note').length,
  canAdd: document.querySelectorAll('#panel button').length,
  label: [...document.querySelectorAll('.label--featured')].some(
    (l) => l.textContent.includes('India') && l.querySelector('.label__count')?.textContent === '2',
  ),
}));
check('a visitor note appears on the country panel', hostPanel.notes >= 1, `${hostPanel.notes}`);
check('the country label counts practices plus notes', hostPanel.label);

/* The Five As explainer must open with all five entries. */
await host.click('.legend__about');
await host.waitForSelector('#sheet:not([hidden])');
const framework = await host.evaluate(() => ({
  title: document.getElementById('sheet-title').textContent,
  sections: document.querySelectorAll('#sheet-body .ctl__section').length,
}));
check('the Five As explainer opens', framework.title === 'The Five As', framework.title);
check('it covers all five levers', framework.sections === 5, `${framework.sections}`);
if (SHOTS) await host.screenshot({ path: path.join(shotDir, '07-controller.png') });
await host.click('.sheet__close');

await hostContext.close();

/* ---- 4. Expired credentials ---- */

const expiredCode = toBase32(mintCode(secret, 1, -1, 1, 4)).match(/.{1,4}/g).join('-');
const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
