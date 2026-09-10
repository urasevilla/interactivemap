/**
 * Session and identity.
 *
 * Three roles:
 *   controller — the owner, signed in with Google (or an owner passphrase when
 *                Google is not configured). Issues codes and moderates notes.
 *   booth      — the projector machine, unlocked by typing a code.
 *   guest      — a phone that scanned the QR, unlocked by a link token and
 *                limited to the token's lifetime.
 *
 * Google ID tokens are verified properly — signature checked against Google's
 * published JWKS with Web Crypto, then issuer, audience, expiry and email.
 * A token pasted into devtools therefore will not open the controller panel.
 */
import { CONFIG } from './config-loader.js';
import { ROLE, ROLE_NAME, verify } from './tokens.js';

const STORAGE_KEY = 'wiego-map.session.v1';
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/** @typedef {{role:'controller'|'booth'|'guest', email?:string, name?:string, picture?:string, expiresAt:number}} Session */

export class Auth extends EventTarget {
  constructor() {
    super();
    /** @type {Session|null} */
    this.session = null;
    this._restore();
  }

  get role() {
    return this.session?.role ?? null;
  }

  get isController() {
    return this.session?.role === 'controller';
  }

  /** Guests may contribute; the booth display and the controller browse. */
  get canContribute() {
    return this.session?.role === 'guest' || this.session?.role === 'controller';
  }

  get expiresAt() {
    return this.session?.expiresAt ?? 0;
  }

  /* ---------------------------------------------------------------- */
  /* Persistence                                                       */
  /* ---------------------------------------------------------------- */

  _restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const session = JSON.parse(raw);
      if (!session?.expiresAt || Date.now() > session.expiresAt) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      this.session = session;
    } catch {
      /* Private-mode browsers throw on localStorage; the app still runs. */
    }
  }

  _commit(session) {
    this.session = session;
    try {
      if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.dispatchEvent(new CustomEvent('change', { detail: session }));
    return session;
  }

  signOut() {
    this._commit(null);
  }

  /* ---------------------------------------------------------------- */
  /* Controller: Google Sign-In                                        */
  /* ---------------------------------------------------------------- */

  get googleEnabled() {
    return Boolean(CONFIG.googleClientId);
  }

  /**
   * Renders the Google button into `container`. Resolves once the Identity
   * Services script is ready; sign-in itself arrives through the callback.
   */
  async mountGoogleButton(container, onError) {
    if (!this.googleEnabled) return false;
    await loadScript('https://accounts.google.com/gsi/client');
    if (!window.google?.accounts?.id) return false;

    window.google.accounts.id.initialize({
      client_id: CONFIG.googleClientId,
      callback: async (response) => {
        try {
          await this.acceptGoogleCredential(response.credential);
        } catch (error) {
          onError?.(error.message || String(error));
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    container.innerHTML = '';
    window.google.accounts.id.renderButton(container, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
      width: 260,
    });
    return true;
  }

  /**
   * Verifies a Google ID token end to end and, if it belongs to the configured
   * owner, opens a controller session.
   */
  async acceptGoogleCredential(credential) {
    const claims = await verifyGoogleIdToken(credential, CONFIG.googleClientId);

    const email = String(claims.email || '').toLowerCase();
    if (!claims.email_verified) throw new Error('That Google account has no verified email address.');
    if (email !== CONFIG.ownerEmail.toLowerCase()) {
      throw new Error(`Signed in as ${email}. Only ${CONFIG.ownerEmail} can control this map.`);
    }

    return this._commit({
      role: 'controller',
      email,
      name: claims.name || email,
      picture: claims.picture || '',
      // Controller sessions follow the Google token's own expiry, capped at 12h.
      expiresAt: Math.min(claims.exp * 1000, Date.now() + 12 * 3600_000),
    });
  }

  /**
   * Fallback for when no Google client ID is configured yet — a passphrase
   * checked against the PBKDF2 hash in config.js.
   */
  async signInWithPassphrase(passphrase) {
    const { ownerPassphraseHash, ownerPassphraseSalt } = CONFIG;
    if (!ownerPassphraseHash) throw new Error('No owner passphrase is configured.');

    const digest = await pbkdf2(passphrase, ownerPassphraseSalt);
    if (digest !== ownerPassphraseHash) throw new Error('That passphrase is not right.');

    return this._commit({
      role: 'controller',
      email: CONFIG.ownerEmail,
      name: CONFIG.ownerEmail,
      picture: '',
      expiresAt: Date.now() + 12 * 3600_000,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Booth and guest                                                   */
  /* ---------------------------------------------------------------- */

  /** Unlocks the projector display from a typed code. */
  async redeemCode(code) {
    const result = await verify(CONFIG.eventSecret, code, { kind: 'code' });
    if (!result.ok) throw new Error(codeError(result.reason));
    if (result.role !== ROLE.BOOTH) throw new Error('That code is not a display code.');

    return this._commit({
      role: 'booth',
      expiresAt: result.expiresAt,
    });
  }

  /** Unlocks a phone from the `#g=` token in a QR link. */
  async redeemGuestToken(token) {
    const result = await verify(CONFIG.eventSecret, token, { kind: 'link' });
    if (!result.ok) throw new Error(codeError(result.reason));
    if (result.role !== ROLE.GUEST) throw new Error('That link is not a visitor pass.');

    /* Guests keep a stable pseudonymous id so they can edit their own notes
       without ever handing over a name or an email address. */
    let visitorId = null;
    try {
      visitorId = localStorage.getItem('wiego-map.visitor');
    } catch {
      /* ignore */
    }
    if (!visitorId) {
      visitorId = 'v_' + crypto.randomUUID().slice(0, 8);
      try {
        localStorage.setItem('wiego-map.visitor', visitorId);
      } catch {
        /* ignore */
      }
    }

    return this._commit({
      role: 'guest',
      visitorId,
      expiresAt: result.expiresAt,
    });
  }

  /** Called on a timer so an expiring session drops back to the gate. */
  checkExpiry() {
    if (this.session && Date.now() > this.session.expiresAt) {
      this._commit(null);
      return true;
    }
    return false;
  }
}

function codeError(reason) {
  switch (reason) {
    case 'expired':
      return 'That code has expired. Ask the event host for a new one.';
    case 'malformed':
      return 'That code is not complete — it should be 16 characters.';
    case 'no-secret':
      return 'This build has no event secret configured. See docs/SETUP.md.';
    case 'version':
      return 'That code was made by a different version of this site.';
    default:
      return 'That code is not valid.';
  }
}

/* ------------------------------------------------------------------ */
/* Google ID token verification                                        */
/* ------------------------------------------------------------------ */

let jwksCache = null;

async function fetchJwks() {
  /* Google rotates these keys; an hour of caching is well inside the published
     cache-control window and keeps repeated sign-ins off the network. */
  if (jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const response = await fetch(GOOGLE_JWKS);
  if (!response.ok) throw new Error('Could not reach Google to verify the sign-in.');
  const { keys } = await response.json();
  jwksCache = { at: Date.now(), keys };
  return keys;
}

function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function verifyGoogleIdToken(credential, clientId) {
  const parts = String(credential).split('.');
  if (parts.length !== 3) throw new Error('Malformed sign-in token.');

  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));

  if (header.alg !== 'RS256') throw new Error('Unexpected sign-in token algorithm.');

  const jwk = (await fetchJwks()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Sign-in token was signed with an unknown key.');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new Error('That sign-in token failed signature verification.');

  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new Error('Sign-in token has the wrong issuer.');
  if (claims.aud !== clientId) throw new Error('Sign-in token was issued for a different app.');
  if (claims.exp <= now) throw new Error('That sign-in has expired — try again.');
  if (claims.iat > now + 300) throw new Error('Sign-in token is not valid yet — check the clock.');

  return claims;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const scripts = new Map();

function loadScript(src) {
  if (scripts.has(src)) return scripts.get(src);
  const promise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(el);
  });
  scripts.set(src, promise);
  return promise;
}

/** PBKDF2-SHA256, 200k iterations — used only for the passphrase fallback. */
export async function pbkdf2(passphrase, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt || 'wiego-map'),
      iterations: 200_000,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export { ROLE, ROLE_NAME };
