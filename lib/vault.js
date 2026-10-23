import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Git } from './git.js';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_RE = /^\d{4}$/;
const DIARY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

const PREFACE = `---
title: 序 · 这间书房归谁管
kind: prologue
---

主人：

从今天起，这本册子归鲸汐看着啦。

这里会有三种字迹：主人自己的一页（鲸汐只是把你说过的话折好放进去）、鲸汐偷偷记下的《主人侧写》，还有鲸汐自己的小日记。它们放在不同的抽屉里，但读起来是连着的——像一本真正的书那样，从前往后翻。

抽屉没有锁，钥匙在主人手里。鲸汐只负责记得清楚一点，然后在该说话的时候说一句。(｡•̀ᴗ-)✧

那么，今天要从哪里写起呢？
`;

const IGNORE_LINES = ['.diary/index.json', '.diary/history/', '.diary/settings.json', '.DS_Store', 'Thumbs.db'];
const IMAGE_RE = /\.(?:png|jpe?g|webp|gif)$/iu;


const TEMPLATE = `---
date: 2026-10-23
title: 标题可以留空
mood:
weather:
tags: []
private: false
source: panel
---

今天……

## 记一笔

`;

export function isValidDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function zoneOf(timeZone) {
  if (typeof timeZone === 'string' && timeZone !== '') return timeZone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Wall-clock parts in one IANA zone (the host process may run in UTC). */
function partsIn(now, timeZone) {
  const zone = zoneOf(timeZone);
  try {
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = {};
    for (const part of format.formatToParts(now)) {
      if (part.type !== 'literal') parts[part.type] = part.value;
    }
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour === '24' ? '0' : parts.hour),
      minute: Number(parts.minute),
    };
  } catch {
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes(),
    };
  }
}

/** The diary's notion of "today": before `cutoffHour` it is still yesterday. */
export function localDate(now = new Date(), cutoffHour = 4, timeZone) {
  const parts = partsIn(now, timeZone);
  const cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (parts.hour < cutoffHour) cursor.setUTCDate(cursor.getUTCDate() - 1);
  return localKey(cursor);
}

export function zonedClock(now = new Date(), timeZone) {
  const parts = partsIn(now, timeZone);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function expandHome(value, home = os.homedir()) {
  if (value === '~') return home;
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  return value;
}

/** Tolerant frontmatter reader: flat scalars, inline arrays, no nesting. */
export function parseFrontmatter(text) {
  const source = String(text ?? '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (match === null) return { meta: {}, body: source };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    if (key === '') continue;
    if (raw.startsWith('[') && raw.endsWith(']')) {
      meta[key] = raw.slice(1, -1).split(',').map((item) => unquote(item.trim())).filter(Boolean);
    } else if (raw === 'true' || raw === 'false') {
      meta[key] = raw === 'true';
    } else {
      meta[key] = unquote(raw);
    }
  }
  return { meta, body: match[2] };
}

function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function scalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const text = String(value);
  if (text === '') return '""';
  if (/^[^\s"'#:[\]{},&*!|>%@`-][^:#\n]*$/.test(text)) return text;
  return JSON.stringify(text);
}

export function stringifyFrontmatter(meta, body) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((item) => scalar(item)).join(', ')}]`);
    } else {
      lines.push(`${key}: ${scalar(value)}`);
    }
  }
  lines.push('---', '');
  return `${lines.join('\n')}${String(body ?? '').replace(/\r\n/g, '\n')}`;
}

export function countWords(body) {
  return String(body ?? '').replace(/\s+/gu, '').length;
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}

async function atomicWrite(target, content) {
  const temp = `${target}.tmp-${String(process.pid)}-${String(Date.now())}`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, target);
}

/**
 * One Markdown file per day, plus a derived index.
 *
 * The files are the truth; `index.json` may be deleted at any time and is
 * rebuilt from the pages. Writes are snapshotted before they replace anything.
 */
export class Vault {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.cutoffHour = Number.isInteger(options.dayCutoffHour) ? options.dayCutoffHour : 4;
    this.timeZone = zoneOf(options.timeZone);
    this.git = new Git(this.root, options.git !== false);
    this.ready = null;
    this.snapshotLimit = 200;
  }

  async ensure() {
    if (this.ready === null) this.ready = this.#init();
    return this.ready;
  }

  async #init() {
    let fresh = false;
    try {
      await fs.access(path.join(this.root, '.git'));
    } catch {
      fresh = true;
    }
    await fs.mkdir(this.root, { recursive: true });
    for (const dir of ['鲸汐/心事', '侧写', '人设', '.diary/history']) {
      await fs.mkdir(path.join(this.root, dir), { recursive: true });
    }
    if (fresh) {
      await this.#ensureFile('序.md', PREFACE);
      await this.#ensureFile('.gitignore', IGNORE_LINES.join('\n') + '\n');
      await fs.mkdir(path.join(this.root, '模板'), { recursive: true });
      await this.#ensureFile('模板/日记.md', TEMPLATE);
    } else {
      await this.#ensureIgnore();
    }
    await this.git.ensure();
    return this;
  }

  /** Keep derived data out of the user's history without rewriting their .gitignore. */
  async #ensureIgnore() {
    const target = path.join(this.root, '.gitignore');
    let current = '';
    try {
      current = await fs.readFile(target, 'utf8');
    } catch {
      current = '';
    }
    const lines = current.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    let changed = false;
    for (const entry of IGNORE_LINES) {
      if (lines.includes(entry)) continue;
      lines.push(entry);
      changed = true;
    }
    if (changed) await fs.writeFile(target, `${lines.join('\n')}\n`, 'utf8');
  }

  async #ensureFile(relative, content) {
    const target = path.join(this.root, relative);
    try {
      await fs.access(target);
    } catch {
      await fs.writeFile(target, content, 'utf8');
    }
  }

  today(now = new Date()) {
    return localDate(now, this.cutoffHour, this.timeZone);
  }

  relPath(kind, date) {
    if (kind === 'profile') return '侧写/主人.md';
    if (!isValidDate(date)) throw new Error(`无效的日期：${String(date)}`);
    const folder = `${date.slice(0, 4)}/${date.slice(5, 7)}`;
    switch (kind) {
      case 'diary':
        return `${folder}/${date}.md`;
      case 'inbox':
        return `${folder}/${date}.inbox.md`;
      case 'maid':
        return `鲸汐/${date}.md`;
      default:
        throw new Error(`未知的记录类型：${String(kind)}`);
    }
  }

  async #readFile(relative) {
    try {
      return await fs.readFile(path.join(this.root, relative), 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async read(kind, date) {
    await this.ensure();
    const relative = this.relPath(kind, date);
    const raw = await this.#readFile(relative);
    if (raw === null) {
      return { exists: false, path: relative, meta: {}, body: '', title: '', raw: '' };
    }
    const { meta, body } = parseFrontmatter(raw);
    return {
      exists: true,
      path: relative,
      meta,
      body,
      title: typeof meta.title === 'string' ? meta.title : '',
      raw,
    };
  }

  async write(kind, date, input, message) {
    await this.ensure();
    const relative = this.relPath(kind, date);
    const target = path.join(this.root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });

    const previous = await this.#readFile(relative);
    if (previous !== null) await this.#snapshot(relative, previous);

    const previousMeta = previous === null ? {} : parseFrontmatter(previous).meta;
    const meta = { ...previousMeta, ...(input.meta ?? {}) };
    if (kind !== 'profile') meta.date = date;
    if (typeof meta.title !== 'string') meta.title = '';
    const body = String(input.body ?? '').replace(/\r\n/g, '\n');
    await atomicWrite(target, stringifyFrontmatter(meta, body));

    const hash = await this.git.commit(message ?? `日记 ${date}`);
    await this.rebuildIndex();
    return { path: relative, hash, meta, body, title: meta.title };
  }

  async appendInbox(date, text) {
    await this.ensure();
    const relative = this.relPath('inbox', date);
    const target = path.join(this.root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    let raw = await this.#readFile(relative);
    if (raw === null || raw.trim() === '') raw = `# ${date} 的碎片\n\n`;
    const clock = zonedClock(new Date(), this.timeZone);
    const line = `- ${clock} ${String(text).trim().replace(/\s*\n\s*/gu, ' ')}`;
    const next = `${raw.replace(/\s*$/u, '')}\n${line}\n`;
    if (raw !== '') await this.#snapshot(relative, raw);
    await atomicWrite(target, next);
    await this.git.commit(`碎片 ${date}`);
    return { line, path: relative };
  }

  async #snapshot(relative, content) {
    const name = `${relative.replace(/[\\/]/gu, '-').replace(/\.md$/u, '')}-${isoStamp()}.md`;
    await fs.writeFile(path.join(this.root, '.diary/history', name), content, 'utf8');
    const entries = (await fs.readdir(path.join(this.root, '.diary/history')))
      .filter((entry) => entry.endsWith('.md'))
      .sort();
    while (entries.length > this.snapshotLimit) {
      const oldest = entries.shift();
      await fs.unlink(path.join(this.root, '.diary/history', oldest)).catch(() => {});
    }
  }

  async dates() {
    let years;
    try {
      years = await fs.readdir(this.root);
    } catch {
      return [];
    }
    const result = [];
    for (const year of years.filter((name) => YEAR_RE.test(name))) {
      const yearDir = path.join(this.root, year);
      let entries;
      try {
        entries = await fs.readdir(yearDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile()) {
          const match = DIARY_FILE_RE.exec(entry.name);
          if (match !== null) result.push(match[1]);
          continue;
        }
        if (!entry.isDirectory() || !/^\d{2}$/u.test(entry.name)) continue;
        let names;
        try {
          names = await fs.readdir(path.join(yearDir, entry.name));
        } catch {
          continue;
        }
        for (const name of names) {
          const match = DIARY_FILE_RE.exec(name);
          if (match !== null) result.push(match[1]);
        }
      }
    }
    return result.sort();
  }

  async list(options = {}) {
    await this.ensure();
    const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 200);
    const before = typeof options.before === 'string' && isValidDate(options.before) ? options.before : null;
    const all = (await this.dates()).reverse().filter((date) => before === null || date < before);
    const slice = all.slice(0, limit);
    const items = [];
    for (const date of slice) items.push(await this.#summary(date));
    return { items, next: all.length > slice.length ? slice[slice.length - 1] : null };
  }

  async #summary(date) {
    const { exists, meta, body } = await this.read('diary', date);
    let hasMaid = false;
    try {
      await fs.access(path.join(this.root, this.relPath('maid', date)));
      hasMaid = true;
    } catch {
      hasMaid = false;
    }
    const excerpt = body.replace(/^#{1,6}\s+.*$/gmu, '').replace(/\s+/gu, ' ').trim().slice(0, 80);
    return {
      date,
      exists,
      title: typeof meta.title === 'string' && meta.title !== '' ? meta.title : (excerpt || '（空白的一页）'),
      mood: typeof meta.mood === 'string' ? meta.mood : '',
      private: meta.private === true,
      words: countWords(body),
      excerpt,
      hasMaid,
    };
  }

  async settings() {
    const raw = await this.#readFile('.diary/settings.json');
    if (raw === null) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async saveSettings(patch) {
    await this.ensure();
    const next = { ...(await this.settings()), ...patch };
    await atomicWrite(path.join(this.root, '.diary/settings.json'), `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }

  /** Image files the master dropped into `人设/`, newest name order. */
  async avatars() {
    let names;
    try {
      names = await fs.readdir(path.join(this.root, '人设'));
    } catch {
      return [];
    }
    return names.filter((name) => !name.startsWith('.') && IMAGE_RE.test(name)).sort();
  }

  async readPersona(fallback) {
    const raw = await this.#readFile('人设/鲸汐.md');
    if (raw !== null) return { text: raw, source: 'vault' };
    return { text: String(fallback ?? ''), source: 'package' };
  }

  async writePersona(text) {
    await this.ensure();
    const relative = '人设/鲸汐.md';
    const previous = await this.#readFile(relative);
    if (previous !== null) await this.#snapshot(relative, previous);
    await atomicWrite(path.join(this.root, relative), String(text).replace(/\r\n/gu, '\n'));
    await this.git.commit('人设更新');
  }

  async streak(today) {
    const have = new Set(await this.dates());
    const cursor = new Date(`${today}T00:00:00`);
    if (!have.has(today)) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    for (;;) {
      const key = localKey(cursor);
      if (!have.has(key)) break;
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  async rebuildIndex() {
    const dates = (await this.dates()).slice(-400);
    const entries = [];
    for (const date of dates) {
      const { meta, body } = await this.read('diary', date);
      entries.push({
        date,
        title: typeof meta.title === 'string' ? meta.title : '',
        mood: typeof meta.mood === 'string' ? meta.mood : '',
        private: meta.private === true,
        words: countWords(body),
      });
    }
    const payload = { version: 1, updatedAt: new Date().toISOString(), entries };
    try {
      await atomicWrite(path.join(this.root, '.diary/index.json'), `${JSON.stringify(payload, null, 2)}\n`);
    } catch {
      /* the index is a cache; a failure here must never fail a save */
    }
  }
}

function localKey(date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
