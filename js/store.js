/**
 * Visitor notes.
 *
 * Two interchangeable backends behind one interface:
 *
 *   LocalStore     localStorage plus a BroadcastChannel, so tabs on one device
 *                  stay in step. This is the default and needs no setup, but a
 *                  note written on a phone never reaches the projector.
 *   FirestoreStore the Firestore REST API — no SDK, no bundler, no CDN script.
 *                  Notes appear on every device within one poll interval.
 *
 * Both emit a `change` event carrying the full, sorted note list.
 */
import { CONFIG, HAS_FIREBASE } from './config-loader.js';

const LOCAL_KEY = 'wiego-map.notes.v1';
const CHANNEL = 'wiego-map.notes';
const POLL_MS = 6000;

/** @typedef {{id:string, a2:string, country:string, text:string, author:string, category:string|null, createdAt:number, approved:boolean, visitorId:string}} Note */

class BaseStore extends EventTarget {
  constructor() {
    super();
    /** @type {Note[]} */
    this.notes = [];
  }

  _emit() {
    this.notes.sort((a, b) => b.createdAt - a.createdAt);
    this.dispatchEvent(new CustomEvent('change', { detail: this.notes }));
  }

  /**
   * The notes that belong on the map.
   *
   * With moderation on, an unapproved note is invisible to everyone — the
   * booth screen included, which is the whole point: the controller sees a new
   * note in the approval prompt and nowhere else until they publish it. The
   * one exception is the visitor who wrote it, who sees their own note marked
   * as awaiting review rather than watching it vanish on submit.
   *
   * @param {{visitorId?: string}} [scope]
   */
  visible(scope = {}) {
    if (!CONFIG.moderateContributions) return this.notes;
    const mine = scope.visitorId;
    return this.notes.filter((n) => n.approved || (mine && n.visitorId === mine));
  }

  /** Notes held back for the controller to approve, oldest first. */
  pending() {
    return this.notes.filter((n) => !n.approved).sort((a, b) => a.createdAt - b.createdAt);
  }

  forCountry(a2, scope) {
    return this.visible(scope).filter((n) => n.a2 === a2);
  }

  countsByCountry(scope) {
    const counts = new Map();
    for (const note of this.visible(scope)) {
      counts.set(note.a2, (counts.get(note.a2) || 0) + 1);
    }
    return counts;
  }
}

/* ------------------------------------------------------------------ */
/* Local                                                               */
/* ------------------------------------------------------------------ */

class LocalStore extends BaseStore {
  constructor() {
    super();
    this.mode = 'local';
    this._read();

    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = () => {
        this._read();
        this._emit();
      };
    } catch {
      this.channel = null;
    }

    /* Another tab in the same browser writing to localStorage. */
    window.addEventListener('storage', (event) => {
      if (event.key === LOCAL_KEY) {
        this._read();
        this._emit();
      }
    });
  }

  async start() {
    this._emit();
  }

  _read() {
    try {
      this.notes = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    } catch {
      this.notes = [];
    }
  }

  _write() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.notes));
    } catch {
      /* Storage full or blocked — the note still lives in memory this session. */
    }
    this.channel?.postMessage('changed');
  }

  async add(note) {
    this.notes.push(note);
    this._write();
    this._emit();
    return note;
  }

  async update(id, patch) {
    const note = this.notes.find((n) => n.id === id);
    if (!note) return;
    Object.assign(note, patch);
    this._write();
    this._emit();
  }

  async remove(id) {
    this.notes = this.notes.filter((n) => n.id !== id);
    this._write();
    this._emit();
  }

  async clear() {
    this.notes = [];
    this._write();
    this._emit();
  }
}

/* ------------------------------------------------------------------ */
/* Firestore over REST                                                 */
/* ------------------------------------------------------------------ */

/** Firestore wraps every scalar in a type tag; these two undo and redo that. */
function toFirestoreFields(note) {
  const fields = {};
  for (const [key, value] of Object.entries(note)) {
    if (value === null || value === undefined) fields[key] = { nullValue: null };
    else if (typeof value === 'number') fields[key] = { integerValue: String(Math.trunc(value)) };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else fields[key] = { stringValue: String(value) };
  }
  return fields;
}

function fromFirestoreDocument(doc) {
  const out = { _name: doc.name };
  for (const [key, wrapper] of Object.entries(doc.fields || {})) {
    if ('integerValue' in wrapper) out[key] = Number(wrapper.integerValue);
    else if ('booleanValue' in wrapper) out[key] = wrapper.booleanValue;
    else if ('nullValue' in wrapper) out[key] = null;
    else out[key] = wrapper.stringValue ?? '';
  }
  return out;
}

class FirestoreStore extends BaseStore {
  constructor(config) {
    super();
    this.mode = 'firestore';
    this.config = config;
    this.collection = config.collection || 'notes';
    this.base = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
    this.online = true;
  }

  _url(path = '') {
    return `${this.base}/${this.collection}${path}?key=${encodeURIComponent(this.config.apiKey)}`;
  }

  async start() {
    await this.refresh();
    /* The REST surface has no streaming, so poll. Six seconds is invisible at a
       booth and keeps well inside Firestore's free read quota for one event. */
    this._timer = setInterval(() => this.refresh(), POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.refresh();
    });
  }

  stop() {
    clearInterval(this._timer);
  }

  async refresh() {
    try {
      const response = await fetch(`${this._url()}&pageSize=300`);
      if (!response.ok) throw new Error(`Firestore responded ${response.status}`);
      const body = await response.json();
      this.notes = (body.documents || []).map(fromFirestoreDocument);
      if (!this.online) {
        this.online = true;
        this.dispatchEvent(new CustomEvent('online'));
      }
      this._emit();
    } catch (error) {
      if (this.online) {
        this.online = false;
        this.dispatchEvent(new CustomEvent('offline', { detail: error.message }));
      }
    }
  }

  async add(note) {
    /* Show it immediately; the next poll reconciles with the server copy. */
    this.notes.push(note);
    this._emit();

    const response = await fetch(`${this._url()}&documentId=${encodeURIComponent(note.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFirestoreFields(note) }),
    });
    if (!response.ok) {
      this.notes = this.notes.filter((n) => n.id !== note.id);
      this._emit();
      throw new Error('Could not save that note — check the connection and try again.');
    }
    return note;
  }

  async update(id, patch) {
    const note = this.notes.find((n) => n.id === id);
    if (!note) return;
    const merged = { ...note, ...patch };
    delete merged._name;

    const mask = Object.keys(patch)
      .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
      .join('&');
    const response = await fetch(`${this._url(`/${encodeURIComponent(id)}`)}&${mask}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFirestoreFields(patch) }),
    });
    if (!response.ok) throw new Error('Could not update that note.');

    Object.assign(note, patch);
    this._emit();
  }

  async remove(id) {
    const response = await fetch(this._url(`/${encodeURIComponent(id)}`), { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error('Could not delete that note.');
    this.notes = this.notes.filter((n) => n.id !== id);
    this._emit();
  }

  async clear() {
    const ids = this.notes.map((n) => n.id);
    for (const id of ids) {
      await fetch(this._url(`/${encodeURIComponent(id)}`), { method: 'DELETE' }).catch(() => {});
    }
    this.notes = [];
    this._emit();
  }
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

export function createStore() {
  return HAS_FIREBASE ? new FirestoreStore(CONFIG.firebase) : new LocalStore();
}

/**
 * Builds a note. Text is trimmed and capped; the UI escapes it on render.
 *
 * `approved` may be forced true by the caller — the controller writing on the
 * booth machine is the moderator, so holding their own note for their own
 * approval would only be a prompt to click twice.
 */
export function makeNote({ a2, country, text, author, category, visitorId, approved }) {
  return {
    id: 'n_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20),
    a2,
    country,
    text: String(text).trim().slice(0, CONFIG.maxNoteLength),
    author: String(author || '').trim().slice(0, 60) || 'Anonymous visitor',
    category: category || null,
    createdAt: Date.now(),
    approved: approved === true || !CONFIG.moderateContributions,
    visitorId: visitorId || 'anon',
  };
}

/** Exports the current notes as CSV for the post-event write-up. */
export function notesToCsv(notes) {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = ['id', 'country', 'iso2', 'category', 'author', 'note', 'created', 'approved'];
  const rows = notes.map((n) =>
    [
      n.id,
      n.country,
      n.a2,
      n.category || '',
      n.author,
      n.text,
      new Date(n.createdAt).toISOString(),
      n.approved ? 'yes' : 'pending',
    ]
      .map(escape)
      .join(','),
  );
  return [header.join(','), ...rows].join('\r\n');
}
