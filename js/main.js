/**
 * Bootstrap and wiring.
 *
 * Flow: resolve a session (guest token in the URL, a stored session, or the
 * gate) → load the geometry → build the scene → wire the UI → run the loop.
 */
import { WorldMap } from './map3d.js';
import { LabelLayer } from './labels.js';
import { Auth, ownerLabel } from './auth.js';
import { createStore, makeNote } from './store.js';
import { CONFIG, HAS_SECRET, siteUrl } from './config-loader.js';
import { issueBoothCode, issueGuestToken, formatCode, formatRemaining, normalizeCode } from './tokens.js';
import { FEATURED, PRACTICES } from './practices.js';
import {
  CountryPanel,
  CountryPicker,
  buildContext,
  buildLegend,
  closeSheet,
  initSheet,
  openAddNote,
  openControllerSheet,
  openQrSheet,
  sheetIsOpen,
  toast,
} from './ui.js';

const auth = new Auth();
const store = createStore();

/** Populated once the geometry loads. */
let map = null;
let labels = null;
let picker = null;
let panel = null;
let index = null;
let lastIssuedCode = null;
let lastGuestLink = null;

/* ================================================================== */
/* Gate                                                                */
/* ================================================================== */

const gate = {
  root: document.getElementById('gate'),
  error: document.getElementById('gate-error'),
};

function showGateError(message) {
  gate.error.textContent = message;
  gate.error.hidden = !message;
}

function setupGate() {
  /* Tabs */
  for (const tab of document.querySelectorAll('[data-gate-tab]')) {
    tab.addEventListener('click', () => {
      const name = tab.dataset.gateTab;
      for (const other of document.querySelectorAll('[data-gate-tab]')) {
        const active = other === tab;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-selected', String(active));
      }
      for (const panelEl of document.querySelectorAll('[data-gate-panel]')) {
        panelEl.classList.toggle('is-active', panelEl.dataset.gatePanel === name);
      }
      showGateError('');
    });
  }

  /* Booth code */
  const codeInput = document.getElementById('gate-code');
  const codeSubmit = document.getElementById('gate-code-submit');

  codeInput.addEventListener('input', () => {
    /* Re-group as the host reads the code out: XXXX-XXXX-XXXX-XXXX. */
    const caretAtEnd = codeInput.selectionStart === codeInput.value.length;
    const normalized = normalizeCode(codeInput.value).slice(0, 16);
    codeInput.value = formatCode(normalized);
    if (caretAtEnd) codeInput.setSelectionRange(codeInput.value.length, codeInput.value.length);
    showGateError('');
  });

  const submitCode = async () => {
    codeSubmit.disabled = true;
    try {
      await auth.redeemCode(codeInput.value);
      showGateError('');
      await enterApp();
    } catch (error) {
      showGateError(error.message);
      codeInput.select();
    } finally {
      codeSubmit.disabled = false;
    }
  };

  codeSubmit.addEventListener('click', submitCode);
  codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submitCode();
  });

  /* Owner sign-in */
  const googleNote = document.getElementById('gate-google-note');
  const passphraseParts = [...document.querySelectorAll('[data-passphrase]')];
  const passphraseInput = document.getElementById('gate-passphrase');
  const passphraseSubmit = document.getElementById('gate-passphrase-submit');

  const hasPassphrase = Boolean(CONFIG.ownerPassphraseHash);
  for (const part of passphraseParts) part.hidden = !hasPassphrase;

  if (auth.googleEnabled) {
    googleNote.textContent = `Only ${ownerLabel()} can control this map.`;

    /* Venues do block accounts.google.com, and the script can also load without
       ever defining the button API. Both end with no button on screen, so say
       what is actually available rather than pointing at a hidden section. */
    const googleUnavailable = () => {
      googleNote.textContent = hasPassphrase
        ? 'Google sign-in could not load — use the owner passphrase below.'
        : 'Google sign-in could not load, and no owner passphrase is configured. ' +
          'Set one with: npm run passphrase';
    };

    auth
      .mountGoogleButton(document.getElementById('gate-google'), showGateError)
      .then((mounted) => {
        if (!mounted) googleUnavailable();
      })
      .catch(googleUnavailable);
  } else {
    googleNote.textContent = hasPassphrase
      ? 'Google sign-in is not configured yet. Use the owner passphrase.'
      : 'No host sign-in is configured. See docs/SETUP.md to add a Google client ID or an owner passphrase.';
  }

  auth.addEventListener('change', (event) => {
    if (event.detail?.role === 'controller') enterApp();
  });

  const submitPassphrase = async () => {
    passphraseSubmit.disabled = true;
    try {
      await auth.signInWithPassphrase(passphraseInput.value);
      showGateError('');
    } catch (error) {
      showGateError(error.message);
    } finally {
      passphraseSubmit.disabled = false;
    }
  };

  passphraseSubmit?.addEventListener('click', submitPassphrase);
  passphraseInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submitPassphrase();
  });

  if (!HAS_SECRET) {
    document.getElementById('gate-mode-note').textContent =
      'No event secret configured — see docs/SETUP.md';
  }
}

/* ================================================================== */
/* Entering the app                                                    */
/* ================================================================== */

let booted = false;

async function enterApp() {
  gate.root.hidden = true;
  document.getElementById('app').hidden = false;
  document.body.dataset.role = auth.role;

  document.getElementById('btn-control').hidden = !auth.isController;

  updateSessionChip();

  if (booted) return;
  booted = true;

  try {
    await boot();
  } catch (error) {
    console.error(error);
    document.getElementById('loading').innerHTML = '';
    document.getElementById('loading').appendChild(
      Object.assign(document.createElement('p'), {
        className: 'loading__text',
        textContent: `The map could not load: ${error.message}`,
      }),
    );
  }
}

/* ================================================================== */
/* Boot                                                                */
/* ================================================================== */

async function boot() {
  const [topo, worldIndex] = await Promise.all([
    fetch('data/countries-50m.json').then(assertOk),
    fetch('data/world-index.json').then(assertOk),
  ]);
  index = worldIndex;

  const canvas = document.getElementById('map');

  map = new WorldMap(canvas, {
    onSelect: (key, practiceId) => {
      if (!key) {
        panel.close();
        picker.setSelection(null);
        return;
      }
      selectCountry(key, practiceId, { fly: false });
    },
  });

  map.resize();
  map.buildCountries(topo, index);
  map.buildPins(PRACTICES);

  labels = new LabelLayer(document.getElementById('labels'), map);
  labels.build(index);

  /* --- UI --- */

  initSheet();
  buildContext(document.getElementById('context-body'));

  buildLegend(document.getElementById('legend'), (categoryId) => {
    map.setFilter(categoryId);
  });

  picker = new CountryPicker(index, (key) => {
    if (!key) {
      map.select(null);
      panel.close();
      map.resetView();
      return;
    }
    selectCountry(key, null, { fly: true });
  });

  panel = new CountryPanel({
    store,
    auth,
    onAddNote: (a2, country) => {
      openAddNote({
        a2,
        country,
        onSubmit: async ({ text, author, category }) => {
          await store.add(
            makeNote({
              a2,
              country,
              text,
              author,
              category,
              visitorId: auth.session?.visitorId,
            }),
          );
        },
      });
    },
    onClose: () => {
      map.select(null);
      picker.setSelection(null);
    },
  });

  store.addEventListener('change', () => {
    labels.setNoteCounts(store.countsByCountry(auth.isController));
  });
  store.addEventListener('offline', (event) => {
    toast(`Live sync is offline: ${event.detail}`, 'error');
  });
  store.addEventListener('online', () => toast('Live sync reconnected.', 'success'));
  await store.start();

  wireChrome();
  startLoop();

  const loading = document.getElementById('loading');
  loading.classList.add('is-done');
  setTimeout(() => loading.remove(), 500);
}

function assertOk(response) {
  if (!response.ok) throw new Error(`could not load ${response.url.split('/').pop()}`);
  return response.json();
}

/* ================================================================== */
/* Selection                                                           */
/* ================================================================== */

function selectCountry(key, practiceId, { fly }) {
  const record = index.countries.find((c) => c.key === key);
  if (!record) return;

  map.select(key);
  picker.setSelection(key);
  panel.render(record, practiceId);
  if (fly) map.flyToCountry(key);
}

/* ================================================================== */
/* Chrome                                                              */
/* ================================================================== */

function wireChrome() {
  document.getElementById('btn-zoom-in').addEventListener('click', () => map.zoomBy(0.62));
  document.getElementById('btn-zoom-out').addEventListener('click', () => map.zoomBy(1.6));
  document.getElementById('btn-reset').addEventListener('click', () => {
    map.resetView();
    map.select(null);
    picker.setSelection(null);
    panel.close();
  });

  document.getElementById('btn-qr').addEventListener('click', showQr);

  document.getElementById('btn-control').addEventListener('click', () => {
    openControllerSheet({
      auth,
      store,
      siteUrl: siteUrl(),
      currentCode: lastIssuedCode,
      issueCode: async (hours) => {
        lastIssuedCode = await issueBoothCode(CONFIG.eventSecret, hours);
        return lastIssuedCode;
      },
      issueGuestLink: async () => {
        lastGuestLink = null;
        await showQr();
      },
    });
  });

  document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

  document.getElementById('btn-exit').addEventListener('click', () => {
    if (confirm('Sign out and return to the access screen?')) {
      auth.signOut();
      location.reload();
    }
  });

  /* Keyboard shortcuts, for driving the booth without a mouse. */
  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea')) return;

    switch (event.key) {
      case 'Escape':
        if (!sheetIsOpen()) {
          map.select(null);
          picker.setSelection(null);
          panel.close();
        }
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'r':
      case 'R':
        map.resetView();
        break;
      case '+':
      case '=':
        map.zoomBy(0.7);
        break;
      case '-':
      case '_':
        map.zoomBy(1.42);
        break;
      case '/':
        event.preventDefault();
        document.getElementById('picker-input').focus();
        break;
      default:
        break;
    }
  });

  /* A session that runs out drops straight back to the gate. */
  setInterval(() => {
    updateSessionChip();
    if (auth.checkExpiry()) {
      closeSheet();
      toast('Your access has expired.', 'error');
      setTimeout(() => location.reload(), 1600);
    }
  }, 30_000);
}

async function showQr() {
  if (!HAS_SECRET) {
    toast('No event secret is configured, so visitor passes cannot be issued.', 'error');
    return;
  }

  /* Reuse the current pass until it is close to expiry, so the printed QR on
     the stand keeps working through the day. */
  if (!lastGuestLink || lastGuestLink.expiresAt - Date.now() < 30 * 60_000) {
    const { token, expiresAt } = await issueGuestToken(CONFIG.eventSecret, CONFIG.guestPassHours);
    lastGuestLink = { url: `${siteUrl()}/#g=${token}`, expiresAt };
  }

  openQrSheet({
    url: lastGuestLink.url,
    expiresAt: lastGuestLink.expiresAt,
    isController: auth.isController,
    onRegenerate: async () => {
      const { token, expiresAt } = await issueGuestToken(CONFIG.eventSecret, CONFIG.guestPassHours);
      lastGuestLink = { url: `${siteUrl()}/#g=${token}`, expiresAt };
      closeSheet();
      showQr();
      toast('New visitor pass issued.', 'success');
    },
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

function updateSessionChip() {
  const chip = document.getElementById('session-chip');
  if (!auth.session) {
    chip.hidden = true;
    return;
  }

  const labelFor = { controller: 'Host', booth: 'Display', guest: 'Visitor' };
  chip.hidden = false;
  chip.replaceChildren(
    Object.assign(document.createElement('span'), {
      className: `session-chip__dot${auth.role === 'guest' ? ' session-chip__dot--guest' : ''}`,
    }),
    document.createTextNode(labelFor[auth.role] || auth.role),
    Object.assign(document.createElement('span'), {
      className: 'session-chip__time',
      textContent: formatRemaining(auth.expiresAt),
    }),
  );
}

/* ================================================================== */
/* Render loop                                                         */
/* ================================================================== */

function startLoop() {
  /**
   * Samples the framebuffer. A WebGL drawing buffer is cleared once the frame
   * is composited, so the render and the readback have to happen inside one
   * task — which is why this exists rather than the test calling toDataURL.
   * Used by tools/check.mjs to prove the map is not a blank canvas.
   */
  window.__mapSample = (size = 48) => {
    map.renderer.render(map.scene, map.camera);
    const gl = map.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const colours = new Set();
    const stepX = Math.max(1, Math.floor(width / size));
    const stepY = Math.max(1, Math.floor(height / size));
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const i = (y * width + x) * 4;
        colours.add(`${pixels[i] >> 3},${pixels[i + 1] >> 3},${pixels[i + 2] >> 3}`);
      }
    }
    return colours.size;
  };

  const resize = () => map.resize();
  window.addEventListener('resize', resize);
  /* iOS fires no resize on rotation until the viewport settles. */
  window.addEventListener('orientationchange', () => setTimeout(resize, 260));
  new ResizeObserver(resize).observe(document.getElementById('map'));

  const frame = () => {
    map.update();
    labels.update();
    /* Read by tools/check.mjs and handy in the console when tuning the view. */
    window.__mapZoom = map.zoomLevel;
    window.__mapView = { distance: map.distance, home: map.homeDistance, max: map.maxDistance };
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ================================================================== */
/* Entry                                                               */
/* ================================================================== */

(async function start() {
  setupGate();

  /* A QR scan arrives as #g=<token>. Redeem it, then strip it from the address
     bar so the pass is not left in a screenshot or a shared link. */
  const hashToken = /[#&]g=([^&]+)/.exec(location.hash)?.[1];
  if (hashToken) {
    try {
      await auth.redeemGuestToken(decodeURIComponent(hashToken));
      history.replaceState(null, '', location.pathname + location.search);
      await enterApp();
      return;
    } catch (error) {
      history.replaceState(null, '', location.pathname + location.search);
      showGateError(error.message);
    }
  }

  if (auth.session) {
    await enterApp();
    return;
  }

  document.getElementById('gate-code').focus();
})();
