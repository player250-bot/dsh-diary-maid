import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite, localDate, zonedClockSeconds } from './vault.js';

const VERSION = 1;
const RELATIVE = '.diary/rooms.json';
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const LIMITS = Object.freeze({ rooms: 2000, title: 60 });

/** A refusal the HTTP layer can forward as-is. `status` follows HTTP semantics. */
export class RoomsError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'RoomsError';
    this.status = status;
  }
}

function emptyState() {
  return { version: VERSION, updatedAt: null, rooms: [], broken: false, exists: false };
}

function cleanInline(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function normalizeSessionId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!SESSION_RE.test(text)) throw new RoomsError(400, '房间编号不对');
  return text;
}

/** Tolerant read: keep the known fields, drop rows that cannot identify a room. */
function normalizeStoredRoom(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  if (sessionId === '' || !SESSION_RE.test(sessionId)) return null;
  return {
    sessionId,
    status: 'archived',
    archivedAt: typeof input.archivedAt === 'string' ? input.archivedAt : '',
    title: cleanInline(input.title, LIMITS.title),
  };
}

function shapeRoom(room) {
  return {
    sessionId: room.sessionId,
    status: 'archived',
    archivedAt: room.archivedAt,
    title: room.title,
  };
}

function offsetOf(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, timeZoneName: 'longOffset' }).formatToParts(now);
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    const match = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(name);
    if (match === null) return '+00:00';
    return `${match[1]}${match[2]}:${match[3]}`;
  } catch {
    return '+00:00';
  }
}

function isoWithOffset(now, timeZone) {
  return `${localDate(now, 0, timeZone)}T${zonedClockSeconds(now, timeZone)}${offsetOf(now, timeZone)}`;
}

/**
 * Room archive: which conversations are folded away from the room list.
 *
 * The table lives in `.diary/rooms.json`, beside `saves.json`: device-local
 * metadata, gitignored, never committed. Presence of a row *is* the archived
 * state; `status` exists so a later P2 can add "snoozed" without a migration.
 *
 * Archiving only writes this table. It never deletes a conversation, never
 * touches a room log, and never commits the vault.
 */
export class RoomStore {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.relative = RELATIVE;
    this.file = path.join(this.root, RELATIVE);
    this.timeZone = typeof options.timeZone === 'string' && options.timeZone !== '' ? options.timeZone : undefined;
    this.limit = LIMITS.rooms;
    this.queue = Promise.resolve();
  }

  async read() {
    return this.#readRaw();
  }

  async list() {
    return (await this.#readRaw()).rooms;
  }

  /** Idempotent: archiving an already-archived room keeps its original stamp. */
  async archive(sessionId, title = '') {
    return this.#mutate(async (state) => {
      const id = normalizeSessionId(sessionId);
      const existing = findRoom(state, id, { required: false });
      if (existing !== null) return { room: shapeRoom(existing), created: false };
      if (state.rooms.length >= this.limit) {
        throw new RoomsError(409, `归档的房间太多了（上限 ${String(this.limit)} 个）`);
      }
      const room = {
        sessionId: id,
        status: 'archived',
        archivedAt: this.#stamp(),
        title: cleanInline(title, LIMITS.title),
      };
      state.rooms.push(room);
      await this.#persist(state);
      return { room: shapeRoom(room), created: true };
    });
  }

  /** Bring one room back. An unknown id is a caller error, never a silent no-op. */
  async restore(sessionId) {
    return this.#mutate(async (state) => {
      const id = normalizeSessionId(sessionId);
      const room = findRoom(state, id, { required: true });
      const index = state.rooms.indexOf(room);
      state.rooms.splice(index, 1);
      await this.#persist(state);
      return { room: { sessionId: id, status: 'active', archivedAt: null, title: room.title } };
    });
  }

  #stamp() {
    return isoWithOffset(new Date(), this.timeZone);
  }

  /** Serialize every mutation so the panel and the tools never interleave writes. */
  #mutate(operation) {
    const run = this.queue.then(() => this.#run(operation), () => this.#run(operation));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async #run(operation) {
    const state = await this.#readRaw();
    if (state.broken) {
      throw new RoomsError(409, '房间表读不出来，先别写，免得把旧记录清掉；可以手动备份 .diary/rooms.json');
    }
    return operation(state);
  }

  async #readRaw() {
    let raw;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return emptyState();
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...emptyState(), broken: true, exists: true };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.rooms)) {
      return { ...emptyState(), broken: true, exists: true };
    }
    const rooms = [];
    const seen = new Set();
    for (const item of parsed.rooms) {
      const room = normalizeStoredRoom(item);
      if (room === null || seen.has(room.sessionId)) continue;
      seen.add(room.sessionId);
      rooms.push(room);
    }
    return {
      version: VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      rooms,
      broken: false,
      exists: true,
    };
  }

  async #persist(state) {
    const payload = {
      version: VERSION,
      updatedAt: this.#stamp(),
      rooms: state.rooms.map(shapeRoom),
    };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await atomicWrite(this.file, `${JSON.stringify(payload, null, 2)}\n`);
    state.updatedAt = payload.updatedAt;
    state.exists = true;
    return payload;
  }
}

function findRoom(state, id, options = {}) {
  const room = state.rooms.find((item) => item.sessionId === id) ?? null;
  if (room === null && options.required === true) throw new RoomsError(404, '这个房间没被归档');
  return room;
}
