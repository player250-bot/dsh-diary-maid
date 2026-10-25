import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicWrite, isValidDate, localDate, zonedClockSeconds } from './vault.js';

const VERSION = 1;
const RELATIVE = '.diary/saves.json';
const STATUSES = ['active', 'sealed', 'archived'];
const SOURCES = ['created', 'adopted', 'room'];
const LIMITS = Object.freeze({ saves: 500, dates: 400, tags: 5, tag: 20, title: 40, note: 500 });
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

/** A refusal the HTTP layer can forward as-is. `status` follows HTTP semantics. */
export class SavesError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.name = 'SavesError';
    this.status = status;
    if (extra !== undefined && extra !== null) Object.assign(this, extra);
  }
}

function emptyState() {
  return { version: VERSION, updatedAt: null, saves: [], bindings: {}, broken: false, exists: false };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanInline(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function normalizeTitle(value) {
  return cleanInline(value, LIMITS.title);
}

function normalizeNote(value) {
  return typeof value === 'string' ? value.trim().slice(0, LIMITS.note) : '';
}

function normalizeTags(value) {
  const tags = [];
  for (const item of asArray(value)) {
    const tag = cleanInline(item, LIMITS.tag);
    if (tag === '' || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length >= LIMITS.tags) break;
  }
  return tags;
}

function normalizeStatus(value) {
  return STATUSES.includes(value) ? value : 'active';
}

function normalizeSource(value) {
  return SOURCES.includes(value) ? value : 'created';
}

/** Tolerant read: drop dates that no longer parse, keep known keys only. */
function normalizeDates(value) {
  const dates = [];
  for (const item of asArray(value)) {
    if (!isValidDate(item) || dates.includes(item)) continue;
    dates.push(item);
  }
  return dates.sort().slice(0, LIMITS.dates);
}

/** Strict write: an unusable date is a caller error, never silently dropped. */
function requireDates(value) {
  const dates = [];
  for (const item of asArray(value)) {
    if (!isValidDate(item)) throw new SavesError(400, `日期格式不对：${String(item)}`);
    if (!dates.includes(item)) dates.push(item);
  }
  return dates.sort();
}

function normalizeSessionId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!SESSION_RE.test(text)) throw new SavesError(400, '会话编号不对');
  return text;
}

function normalizeStoredSave(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = cleanInline(input.id, 80);
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  if (id === '' || sessionId === '') return null;
  const status = normalizeStatus(input.status);
  return {
    id,
    sessionId,
    title: normalizeTitle(input.title),
    dates: normalizeDates(input.dates),
    status,
    tags: normalizeTags(input.tags),
    note: normalizeNote(input.note),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : '',
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
    sealedAt: typeof input.sealedAt === 'string' && input.sealedAt !== '' ? input.sealedAt : null,
    source: normalizeSource(input.source),
  };
}

function shapeSave(save) {
  return {
    id: save.id,
    sessionId: save.sessionId,
    title: save.title,
    dates: [...save.dates],
    status: save.status,
    tags: [...save.tags],
    note: save.note,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
    sealedAt: save.sealedAt,
    source: save.source,
  };
}

/** `bindings` is derived from each save's own `dates[]` — never stored as truth. */
function deriveBindings(saves) {
  const bindings = {};
  for (const save of saves) {
    for (const date of save.dates) {
      if (bindings[date] === undefined) bindings[date] = [];
      if (!bindings[date].includes(save.id)) bindings[date].push(save.id);
    }
  }
  return bindings;
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
 * Session saves: one save = one conversation (`sessionId`) + a set of diary days.
 *
 * The table lives in `.diary/saves.json`, outside the vault's git history. It is
 * device-local metadata: losing it only loses the jump from a page back to a
 * chat. `dates[]` is the truth; `bindings` is rebuilt on every write.
 */
export class SaveStore {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.relative = RELATIVE;
    this.file = path.join(this.root, RELATIVE);
    this.cutoffHour = Number.isInteger(options.dayCutoffHour) ? options.dayCutoffHour : 4;
    this.timeZone = typeof options.timeZone === 'string' && options.timeZone !== '' ? options.timeZone : undefined;
    this.limit = LIMITS.saves;
    this.queue = Promise.resolve();
  }

  /** The diary's "today" (4am cutoff), never the browser's clock. */
  today(now = new Date()) {
    return localDate(now, this.cutoffHour, this.timeZone);
  }

  async read() {
    return this.#readRaw();
  }

  async list() {
    return (await this.#readRaw()).saves;
  }

  async create(input = {}) {
    return this.#mutate(async (state) => {
      const sessionId = normalizeSessionId(input.sessionId);
      const existing = state.saves.find((save) => save.sessionId === sessionId);
      if (existing !== undefined) {
        throw new SavesError(409, '这段对话已经绑在一个存档上了', { save: shapeSave(existing) });
      }
      if (state.saves.length >= this.limit) {
        throw new SavesError(409, `存档太多了（上限 ${String(this.limit)} 档）`);
      }
      const now = this.#stamp();
      const date = input.date === undefined || input.date === null || input.date === ''
        ? this.today()
        : input.date;
      if (!isValidDate(date)) throw new SavesError(400, `日期格式不对：${String(date)}`);
      const save = {
        id: this.#newId(date, now),
        sessionId,
        title: normalizeTitle(input.title) || `日记 · ${date}`,
        dates: [date],
        status: 'active',
        tags: normalizeTags(input.tags),
        note: normalizeNote(input.note),
        createdAt: now,
        updatedAt: now,
        sealedAt: null,
        source: normalizeSource(input.source),
      };
      state.saves.push(save);
      await this.#persist(state);
      return { save: shapeSave(save) };
    });
  }

  /** Attach or detach diary days. One save may span many days; one day many saves. */
  async bind(id, patch = {}) {
    return this.#mutate(async (state) => {
      const save = findSave(state, id);
      const add = requireDates(patch.addDates);
      const remove = new Set(requireDates(patch.removeDates));
      const dates = new Set(save.dates.filter((date) => !remove.has(date)));
      for (const date of add) dates.add(date);
      const next = [...dates].sort();
      if (next.length > LIMITS.dates) {
        throw new SavesError(400, `一档最多绑 ${String(LIMITS.dates)} 天`);
      }
      save.dates = next;
      save.updatedAt = this.#stamp();
      await this.#persist(state);
      return { save: shapeSave(save) };
    });
  }

  async update(id, patch = {}) {
    return this.#mutate(async (state) => {
      const save = findSave(state, id);
      if (patch.status !== undefined) {
        if (!STATUSES.includes(patch.status)) throw new SavesError(400, '不认识这个存档状态');
        save.status = patch.status;
        save.sealedAt = patch.status === 'active' ? null : (save.sealedAt ?? this.#stamp());
      }
      if (patch.title !== undefined) save.title = normalizeTitle(patch.title);
      if (patch.tags !== undefined) save.tags = normalizeTags(patch.tags);
      if (patch.note !== undefined) save.note = normalizeNote(patch.note);
      save.updatedAt = this.#stamp();
      await this.#persist(state);
      return { save: shapeSave(save) };
    });
  }

  /** Settle every active save bound to one day. P2 calls this after a final page. */
  async seal(date, options = {}) {
    if (!isValidDate(date)) throw new SavesError(400, `日期格式不对：${String(date)}`);
    return this.#mutate(async (state) => {
      const now = this.#stamp();
      const ids = [];
      for (const save of state.saves) {
        if (save.status !== 'active') continue;
        if (!save.dates.includes(date)) continue;
        if (options.only !== undefined && save.id !== options.only) continue;
        save.status = 'sealed';
        save.sealedAt = now;
        save.updatedAt = now;
        ids.push(save.id);
      }
      if (ids.length > 0) await this.#persist(state);
      return { date, ids, count: ids.length };
    });
  }

  async archive(id) {
    return this.update(id, { status: 'archived' });
  }

  /** Drop one table row. Never touches the conversation or the diary. */
  async remove(id) {
    return this.#mutate(async (state) => {
      const index = state.saves.findIndex((save) => save.id === id);
      if (index < 0) throw new SavesError(404, '找不到这个存档');
      const [save] = state.saves.splice(index, 1);
      await this.#persist(state);
      return { save: shapeSave(save) };
    });
  }

  #stamp() {
    return isoWithOffset(new Date(), this.timeZone);
  }

  #newId(date, stamp) {
    const day = date.replace(/-/gu, '');
    const clock = stamp.slice(11, 19).replace(/:/gu, '');
    return `save-${day}-${clock}-${randomBytes(3).toString('hex')}`;
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
      throw new SavesError(409, '存档表读不出来，先别写，免得把旧档清掉；可以手动备份 .diary/saves.json');
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
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.saves)) {
      return { ...emptyState(), broken: true, exists: true };
    }
    const saves = [];
    const ids = new Set();
    const sessions = new Set();
    for (const item of parsed.saves) {
      const save = normalizeStoredSave(item);
      if (save === null || ids.has(save.id) || sessions.has(save.sessionId)) continue;
      ids.add(save.id);
      sessions.add(save.sessionId);
      saves.push(save);
    }
    return {
      version: VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      saves,
      bindings: deriveBindings(saves),
      broken: false,
      exists: true,
    };
  }

  async #persist(state) {
    const payload = {
      version: VERSION,
      updatedAt: this.#stamp(),
      saves: state.saves.map(shapeSave),
      bindings: deriveBindings(state.saves),
    };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await atomicWrite(this.file, `${JSON.stringify(payload, null, 2)}\n`);
    state.updatedAt = payload.updatedAt;
    state.bindings = payload.bindings;
    state.exists = true;
    return payload;
  }
}

function findSave(state, id) {
  const text = typeof id === 'string' ? id.trim() : '';
  if (text === '') throw new SavesError(400, '缺少存档编号');
  const save = state.saves.find((item) => item.id === text);
  if (save === undefined) throw new SavesError(404, '找不到这个存档');
  return save;
}
