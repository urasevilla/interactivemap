/**
 * Access tokens.
 *
 * The site is a static build with no server behind it, so codes have to carry
 * their own proof. A token is `payload || truncated HMAC-SHA256(payload)` under
 * an event secret compiled into the build: any device that has loaded the page
 * can verify a code offline, which is exactly what a booth laptop with flaky
 * conference wifi needs.
 *
 * Threat model, stated plainly: the event secret ships inside the JavaScript
 * bundle, so anyone who can load the site and read its source can also mint
 * codes. This gates a private event against casual access — an unlisted URL
 * that expires — not against a determined attacker. Set FIREBASE in config.js
 * to move code issuance server-side if you need more than that.
 */

/** Crockford-style base32: no I, L, O or U, so codes survive being read aloud. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DECODE = new Map([...ALPHABET].map((c, i) => [c, i]));

export const ROLE = { BOOTH: 1, GUEST: 2 };

const VERSION = 1;
const MAC_BYTES_CODE = 4; // 16-character typed code
const MAC_BYTES_LINK = 16; // full-strength token for QR links

let keyPromise = null;

async function hmacKey(secret) {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }
  return keyPromise;
}

async function sign(secret, payload, length) {
  const key = await hmacKey(secret);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
  return mac.slice(0, length);
}

/** Constant-time comparison, so a wrong code leaks nothing through timing. */
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Layout: version+role (1) | expiry in minutes, big-endian (4) | nonce (n).
 * The booth variant is sized so payload + MAC lands on exactly 80 bits, which
 * base32-encodes to exactly 16 characters with no padding to explain away.
 */
function buildPayload(role, expiresAt, nonceBytes) {
  const payload = new Uint8Array(5 + nonceBytes);
  payload[0] = (VERSION << 4) | (role & 0x0f);
  const minutes = Math.floor(expiresAt / 60000);
  payload[1] = (minutes >>> 24) & 0xff;
  payload[2] = (minutes >>> 16) & 0xff;
  payload[3] = (minutes >>> 8) & 0xff;
  payload[4] = minutes & 0xff;
  crypto.getRandomValues(payload.subarray(5));
  return payload;
}

function readPayload(payload) {
  const version = payload[0] >> 4;
  const role = payload[0] & 0x0f;
  const minutes =
    ((payload[1] << 24) >>> 0) + (payload[2] << 16) + (payload[3] << 8) + payload[4];
  return { version, role, expiresAt: minutes * 60000 };
}

/* ------------------------------------------------------------------ */
/* Base32 for typed codes                                              */
/* ------------------------------------------------------------------ */

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

function fromBase32(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of text) {
    const index = DECODE.get(char);
    if (index === undefined) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Normalizes user input: strips separators, upper-cases, fixes lookalikes. */
export function normalizeCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

export function formatCode(code) {
  return (code.match(/.{1,4}/g) || []).join('-');
}

/* ------------------------------------------------------------------ */
/* Base64url for link tokens                                           */
/* ------------------------------------------------------------------ */

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Mints a typed booth code, e.g. `A7K2-9QXM-4WPD-3RTF`.
 * @param {string} secret  the event secret from config.js
 * @param {number} hours   lifetime in hours
 */
export async function issueBoothCode(secret, hours = 24) {
  const expiresAt = Date.now() + hours * 3600_000;
  const payload = buildPayload(ROLE.BOOTH, expiresAt, 1);
  const mac = await sign(secret, payload, MAC_BYTES_CODE);
  const bytes = new Uint8Array(payload.length + mac.length);
  bytes.set(payload);
  bytes.set(mac, payload.length);
  return { code: formatCode(toBase32(bytes)), expiresAt };
}

/**
 * Mints a guest token for the QR link. Longer MAC, since it is never typed.
 */
export async function issueGuestToken(secret, hours = 24) {
  const expiresAt = Date.now() + hours * 3600_000;
  const payload = buildPayload(ROLE.GUEST, expiresAt, 4);
  const mac = await sign(secret, payload, MAC_BYTES_LINK);
  const bytes = new Uint8Array(payload.length + mac.length);
  bytes.set(payload);
  bytes.set(mac, payload.length);
  return { token: toBase64Url(bytes), expiresAt };
}

/**
 * Verifies either form.
 * @returns {Promise<{ok:true, role:number, expiresAt:number}|{ok:false, reason:string}>}
 */
export async function verify(secret, input, { kind = 'auto' } = {}) {
  if (!secret) return { ok: false, reason: 'no-secret' };

  let bytes = null;
  let macLength = 0;

  const looksLikeLink = kind === 'link' || (kind === 'auto' && /[-_a-z]/.test(String(input)) && String(input).length > 20);

  if (looksLikeLink) {
    bytes = fromBase64Url(String(input).trim());
    macLength = MAC_BYTES_LINK;
  } else {
    const normalized = normalizeCode(input);
    if (normalized.length !== 16) return { ok: false, reason: 'malformed' };
    bytes = fromBase32(normalized);
    macLength = MAC_BYTES_CODE;
  }

  if (!bytes || bytes.length < 6 + macLength) return { ok: false, reason: 'malformed' };

  const payload = bytes.slice(0, bytes.length - macLength);
  const mac = bytes.slice(bytes.length - macLength);
  const expected = await sign(secret, payload, macLength);
  if (!equalBytes(mac, expected)) return { ok: false, reason: 'invalid' };

  const { version, role, expiresAt } = readPayload(payload);
  if (version !== VERSION) return { ok: false, reason: 'version' };
  if (Date.now() > expiresAt) return { ok: false, reason: 'expired', expiresAt };
  if (role !== ROLE.BOOTH && role !== ROLE.GUEST) return { ok: false, reason: 'invalid' };

  return { ok: true, role, expiresAt };
}

/** "23h 14m" / "48m" / "expired" — for the countdown in the header. */
export function formatRemaining(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'expired';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 1) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}
