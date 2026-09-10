/**
 * Reads `config.js` (a plain script that sets `window.WIEGO_MAP_CONFIG`) and
 * fills in defaults. Keeping the editable settings out of the module graph means
 * an event host can change them without touching application code.
 */

const defaults = {
  /**
   * The only Google account allowed to open the controller panel. Set either
   * the address itself or, to keep it out of a public repository and off the
   * page, its SHA-256 digest via `npm run ownerhash`. The hash wins when both
   * are present.
   */
  ownerEmail: '',
  ownerEmailHash: '',

  /** Google OAuth Web client ID. Empty falls back to the owner passphrase. */
  googleClientId: '',

  /** PBKDF2-SHA256 hex digest and salt for the fallback owner passphrase. */
  ownerPassphraseHash: '',
  ownerPassphraseSalt: 'wiego-map',

  /** HMAC secret backing every display code and visitor link. Rotate per event. */
  eventSecret: '',

  /** Default lifetime, in hours, for newly issued codes and visitor links. */
  boothCodeHours: 24,
  guestPassHours: 24,

  /** Public base URL used to build QR links. Empty derives it from the page. */
  publicUrl: '',

  /** Event name shown in the header and on the QR card. */
  eventName: 'WIEGO Booth',

  /** Optional Firebase config; when present, notes sync across devices live. */
  firebase: null,

  /** Hold visitor notes for controller approval before they appear on the map. */
  moderateContributions: false,

  /** Maximum characters in a visitor note. */
  maxNoteLength: 400,
};

const provided = typeof window !== 'undefined' ? window.WIEGO_MAP_CONFIG || {} : {};

export const CONFIG = { ...defaults, ...provided };

/** Absolute origin + path the QR code should point at. */
export function siteUrl() {
  if (CONFIG.publicUrl) return CONFIG.publicUrl.replace(/\/+$/, '');
  const { origin, pathname } = window.location;
  return (origin + pathname).replace(/\/index\.html$/, '/').replace(/\/+$/, '');
}

export const HAS_SECRET = Boolean(CONFIG.eventSecret);
export const HAS_FIREBASE = Boolean(CONFIG.firebase?.projectId);
