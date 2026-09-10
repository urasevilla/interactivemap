/**
 * Event configuration.
 *
 * This file is deliberately plain: edit it, commit, and GitHub Pages picks the
 * changes up on the next deploy. Nothing here is read at build time.
 *
 * Read docs/SETUP.md before your first event — at minimum, rotate eventSecret
 * and set googleClientId.
 */
window.WIEGO_MAP_CONFIG = {
  /* ------------------------------------------------------------------ *
   * Who controls the map                                                *
   * ------------------------------------------------------------------ */

  // The Google account allowed to open the controller panel.
  //
  // ownerEmailHash keeps the address out of this public repository and off the
  // page — auth.js hashes the verified email claim and compares digests.
  // Regenerate with:  npm run ownerhash -- you@example.com
  //
  // Prefer plaintext instead? Put the address in ownerEmail and leave the hash
  // empty; the hash wins whenever both are set.
  ownerEmail: '',
  ownerEmailHash: '4d8e4717bbc7d29290adb1d5ee80467fdbda0385730ca9855dc780c76f4947fb',

  // Google OAuth 2.0 *Web application* client ID.
  // Create one at https://console.cloud.google.com/apis/credentials and add
  // your Pages origin (e.g. https://urasevilla.github.io) to the list of
  // Authorised JavaScript origins. Leave empty to use the passphrase fallback.
  googleClientId: '379669462580-jqba8m8jmabe3t2kjohiq4ts68mvr3rc.apps.googleusercontent.com',

  // Fallback for before Google sign-in is wired up, or if the venue blocks
  // accounts.google.com. Generate with:  npm run passphrase -- "your phrase"
  // Leaving the hash empty disables the fallback entirely.
  ownerPassphraseHash: 'c50f1289e075284fe4bc4e0dea62500eb811efac22d7164fc30ab13dec7d0c76',
  ownerPassphraseSalt: 'wiego-map',

  /* ------------------------------------------------------------------ *
   * Access codes                                                        *
   * ------------------------------------------------------------------ */

  // HMAC secret behind every display code and visitor pass.
  // ROTATE THIS BEFORE YOUR EVENT:  npm run secret
  // Everyone holding a code from the old secret is locked out the moment you
  // change it, which is exactly what you want between events.
  eventSecret: 'XM4JmBFDIuvIZQS-za85wbqy-wMQ8ds0CuFAnOgtQz4',

  // Default lifetimes, in hours. The controller can override per code.
  boothCodeHours: 24,
  guestPassHours: 24,

  /* ------------------------------------------------------------------ *
   * Presentation                                                        *
   * ------------------------------------------------------------------ */

  eventName: 'WIEGO Booth',

  // Base URL encoded into the QR code. Leave empty to derive it from whatever
  // address the page is currently open at — set it explicitly if you present
  // from a local copy but want phones to hit the published site.
  publicUrl: '',

  // true holds every visitor note until the controller approves it.
  moderateContributions: false,

  maxNoteLength: 400,

  /* ------------------------------------------------------------------ *
   * Live sync (optional)                                                *
   * ------------------------------------------------------------------ */

  // Without this block the map still runs, but visitor notes stay on the device
  // that wrote them. Fill it in to have phones and the projector share notes in
  // real time. See docs/SETUP.md § Live sync.
  firebase: {
    apiKey: 'AIzaSyC2RFMdhMkKla7AcLcDTtJ95hxB-8dEdrA',
    projectId: 'wiego-interactive-map',
    collection: 'notes',
  },
};
