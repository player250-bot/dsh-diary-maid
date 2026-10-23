import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault, expandHome, isValidDate, parseFrontmatter } from './vault.js';

const PREFIX = '/dsh-diary';
const API = `${PREFIX}/api`;
const MAX_BODY = 1024 * 1024;
const KINDS = new Set(['diary', 'maid']);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_RE = /\.(?:png|jpe?g|webp|gif)$/iu;

let personaFallback;

async function defaultPersona() {
  if (personaFallback === undefined) {
    try {
      personaFallback = await fs.readFile(path.join(PACKAGE_ROOT, 'persona/鲸汐.md'), 'utf8');
    } catch {
      personaFallback = '';
    }
  }
  return personaFallback;
}

class HttpError extends Error {
  constructor(status, message, allow) {
    super(message);
    this.status = status;
    this.allow = allow;
  }
}

/**
 * Host half of 鲸汐 · 日记女仆.
 *
 * Owns the vault (Markdown files + git history) and exposes a small same-origin
 * JSON API for the panel. Every route delegates to the connection service's
 * admission fence, so the diary is exactly as reachable as the rest of DSH.
 */
export function apply(ctx, config = {}) {
  const vaultPath = path.resolve(expandHome(String(config.vaultPath ?? '~/dsh-diary')));
  const vault = new Vault(vaultPath, {
    git: config.git !== false,
    dayCutoffHour: Number.isInteger(config.dayCutoffHour) ? config.dayCutoffHour : 4,
    timeZone: typeof config.timeZone === 'string' ? config.timeZone : undefined,
  });

  ctx.inject(['webServer', 'connection'], (scoped) => {
    const guard = (handler) => async (req, res) => {
      if (rejected(scoped, req, res)) return;
      try {
        await handler(req, res);
      } catch (error) {
        if (res.headersSent) return;
        const status = Number.isInteger(error?.status) ? error.status : 500;
        if (Array.isArray(error?.allow)) res.setHeader('allow', error.allow.join(', '));
        sendJson(res, status, { ok: false, error: messageOf(error) });
      }
    };

    const routes = [
      [`${API}/state`, handleState],
      [`${API}/entries`, handleEntries],
      [`${API}/entry`, handleEntry],
      [`${API}/inbox`, handleInbox],
      [`${API}/history`, handleHistory],
      [`${API}/revert`, handleRevert],
      [`${API}/profile`, handleProfile],
      [`${API}/maid`, handleMaid],
      [`${API}/settings`, handleSettings],
      [`${API}/persona`, handlePersona],
      [`${API}/avatar`, handleAvatar],
      [`${PREFIX}/assets/portrait.jpg`, serveAsset('assets/persona/鲸汐-立绘.jpg', 'image/jpeg')],
      [`${PREFIX}/assets/sticker.png`, serveAsset('assets/persona/鲸汐-表情包.png', 'image/png')],
      [`${PREFIX}/assets/icon.svg`, serveAsset('icon.svg', 'image/svg+xml')],
    ];

    for (const [routePath, handler] of routes) {
      scoped.effect(
        () => scoped.webServer.register({ kind: 'exact', path: routePath, handler: guard(handler) }),
        `dsh-diary-maid:${routePath}`,
      );
    }

    async function handleState(req, res) {
      requireMethod(req, res, ['GET']);
      await vault.ensure();
      const today = vault.today();
      const entry = await vault.read('diary', today);
      const count = (await vault.dates()).length;
      const settings = await vault.settings();
      const [streak, branch, remote, dirty] = await Promise.all([
        vault.streak(today),
        vault.git.branch(),
        vault.git.remote(),
        vault.git.dirty(),
      ]);
      sendJson(res, 200, {
        ok: true,
        vault: vault.root,
        today,
        exists: entry.exists,
        count,
        streak,
        git: {
          enabled: vault.git.enabled,
          available: vault.git.available,
          branch,
          remote,
          dirty,
        },
        avatarUrl: typeof settings.avatar === 'string' && settings.avatar !== ''
          ? `${API}/avatar?name=${encodeURIComponent(settings.avatar)}`
          : `${PREFIX}/assets/portrait.jpg`,
        assets: {
          portrait: `${PREFIX}/assets/portrait.jpg`,
          sticker: `${PREFIX}/assets/sticker.png`,
          icon: `${PREFIX}/assets/icon.svg`,
        },
      });
    }

    async function handleEntries(req, res) {
      requireMethod(req, res, ['GET']);
      const url = new URL(req.url, 'http://localhost');
      const page = await vault.list({
        limit: url.searchParams.get('limit') ?? undefined,
        before: url.searchParams.get('before') ?? undefined,
      });
      sendJson(res, 200, { ok: true, ...page });
    }

    async function handleEntry(req, res) {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET') {
        const date = dateParam(url, vault);
        const entry = await vault.read('diary', date);
        sendJson(res, 200, { ok: true, date, entry });
        return;
      }
      if (req.method !== 'PUT') {
        throw new HttpError(405, '这个接口不支持该请求方式', ['GET', 'PUT']);
      }
      const input = await readJson(req);
      const date = dateParam(url, vault, input.date);
      const body = requireText(input.body, '正文');
      const meta = {
        source: 'panel',
        updated: new Date().toISOString().slice(0, 16).replace('T', ' '),
      };
      const title = optionalText(input.title, 120);
      if (title !== '') meta.title = title;
      const mood = optionalText(input.mood, 40);
      if (mood !== '') meta.mood = mood;
      const weather = optionalText(input.weather, 40);
      if (weather !== '') meta.weather = weather;
      if (typeof input.private === 'boolean') meta.private = input.private;
      const saved = await vault.write('diary', date, { meta, body }, `日记 ${date}`);
      sendJson(res, 200, {
        ok: true,
        date,
        entry: { exists: true, path: saved.path, meta: saved.meta, body: saved.body, title: saved.title },
        hash: saved.hash,
      });
    }

    async function handleInbox(req, res) {
      requireMethod(req, res, ['POST']);
      const input = await readJson(req);
      const date = dateParam(new URL(req.url, 'http://localhost'), vault, input.date);
      const text = requireText(input.text, '碎片').trim();
      if (text.length > 5000) throw new HttpError(400, '这一条太长了（上限 5000 字）');
      const saved = await vault.appendInbox(date, text);
      sendJson(res, 200, { ok: true, date, ...saved });
    }

    async function handleHistory(req, res) {
      requireMethod(req, res, ['GET']);
      const url = new URL(req.url, 'http://localhost');
      const kind = kindParam(url);
      const date = dateParam(url, vault);
      const relative = vault.relPath(kind, date);
      const commits = vault.git.repo ? await vault.git.log(relative, 30) : [];
      sendJson(res, 200, { ok: true, path: relative, commits });
    }

    async function handleRevert(req, res) {
      requireMethod(req, res, ['POST']);
      const input = await readJson(req);
      const kind = KINDS.has(input.kind) ? input.kind : 'diary';
      const date = dateParam(new URL(req.url, 'http://localhost'), vault, input.date);
      const commit = optionalText(input.commit, 64);
      if (commit === '') throw new HttpError(400, '缺少版本号');
      const relative = vault.relPath(kind, date);
      const raw = await vault.git.show(commit, relative);
      const { meta, body } = parseFrontmatter(raw);
      const saved = await vault.write(kind, date, { meta, body }, `回退 ${date} 到 ${commit.slice(0, 7)}`);
      sendJson(res, 200, {
        ok: true,
        date,
        entry: { exists: true, path: saved.path, meta: saved.meta, body: saved.body, title: saved.title },
        hash: saved.hash,
      });
    }

    async function handleProfile(req, res) {
      if (req.method === 'GET') {
        const entry = await vault.read('profile');
        sendJson(res, 200, { ok: true, body: entry.body, exists: entry.exists });
        return;
      }
      if (req.method !== 'PUT') {
        throw new HttpError(405, '这个接口不支持该请求方式', ['GET', 'PUT']);
      }
      const input = await readJson(req);
      const body = requireText(input.body, '侧写');
      const saved = await vault.write('profile', null, {
        meta: { updated: new Date().toISOString().slice(0, 10) },
        body,
      }, '侧写更新');
      sendJson(res, 200, { ok: true, body: saved.body, hash: saved.hash });
    }

    async function settingsPayload() {
      await vault.ensure();
      const settings = await vault.settings();
      const names = await vault.avatars();
      const persona = await vault.readPersona(await defaultPersona());
      return {
        avatarName: typeof settings.avatar === 'string' && names.includes(settings.avatar) ? settings.avatar : null,
        avatars: names.map((name) => ({ name, url: `${API}/avatar?name=${encodeURIComponent(name)}` })),
        persona: { text: persona.text, source: persona.source },
        vault: vault.root,
      };
    }

    async function handleSettings(req, res) {
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, ...(await settingsPayload()) });
        return;
      }
      if (req.method !== 'PUT') {
        throw new HttpError(405, '这个接口不支持该请求方式', ['GET', 'PUT']);
      }
      const input = await readJson(req);
      const patch = {};
      if ('avatarName' in input) {
        if (input.avatarName === null || input.avatarName === '') {
          patch.avatar = null;
        } else if (typeof input.avatarName === 'string' && (await vault.avatars()).includes(input.avatarName)) {
          patch.avatar = input.avatarName;
        } else {
          throw new HttpError(400, '找不到这张头像，先把图片放进 人设/ 吧');
        }
      }
      await vault.saveSettings(patch);
      sendJson(res, 200, { ok: true, ...(await settingsPayload()) });
    }

    async function handlePersona(req, res) {
      if (req.method === 'GET') {
        const persona = await vault.readPersona(await defaultPersona());
        sendJson(res, 200, { ok: true, ...persona });
        return;
      }
      if (req.method !== 'PUT') {
        throw new HttpError(405, '这个接口不支持该请求方式', ['GET', 'PUT']);
      }
      const input = await readJson(req);
      const text = requireText(input.text, '人设');
      if (text.trim() === '') throw new HttpError(400, '人设不能是空的');
      if (text.length > 20000) throw new HttpError(400, '人设太长了（上限 2 万字）');
      await vault.writePersona(text);
      sendJson(res, 200, { ok: true, text, source: 'vault' });
    }

    async function handleAvatar(req, res) {
      requireMethod(req, res, ['GET', 'HEAD']);
      const url = new URL(req.url, 'http://localhost');
      const name = (url.searchParams.get('name') ?? '').trim();
      if (name === '' || name !== path.basename(name) || !IMAGE_RE.test(name)) {
        throw new HttpError(400, '头像名称不对');
      }
      await vault.ensure();
      let bytes;
      try {
        bytes = await fs.readFile(path.join(vault.root, '人设', name));
      } catch {
        throw new HttpError(404, '找不到这张头像');
      }
      const type = name.toLowerCase().endsWith('.png') ? 'image/png'
        : name.toLowerCase().endsWith('.webp') ? 'image/webp'
          : name.toLowerCase().endsWith('.gif') ? 'image/gif'
            : 'image/jpeg';
      res.writeHead(200, {
        'content-type': type,
        'cache-control': 'no-store',
        'content-length': String(bytes.length),
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    }

    async function handleMaid(req, res) {
      requireMethod(req, res, ['GET']);
      const url = new URL(req.url, 'http://localhost');
      const date = dateParam(url, vault);
      const entry = await vault.read('maid', date);
      sendJson(res, 200, { ok: true, date, entry });
    }

    function serveAsset(relative, contentType) {
      const target = path.join(PACKAGE_ROOT, relative);
      return async (req, res) => {
        requireMethod(req, res, ['GET', 'HEAD']);
        let bytes;
        try {
          bytes = await fs.readFile(target);
        } catch {
          sendJson(res, 404, { ok: false, error: '找不到这张图' });
          return;
        }
        res.writeHead(200, {
          'content-type': contentType,
          'cache-control': 'private, max-age=3600',
          'content-length': String(bytes.length),
          'x-content-type-options': 'nosniff',
        });
        res.end(req.method === 'HEAD' ? undefined : bytes);
      };
    }
  });
}

function rejected(scoped, req, res) {
  try {
    const connection = scoped.connection;
    if (connection && typeof connection.requestRejection === 'function') {
      const code = connection.requestRejection(req);
      if (code !== undefined && code !== null && code !== false) {
        res.statusCode = typeof code === 'number' ? code : 403;
        res.end();
        return true;
      }
    }
  } catch {
    res.statusCode = 403;
    res.end();
    return true;
  }
  return false;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function requireMethod(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    throw new HttpError(405, '这个接口不支持该请求方式', allowed);
  }
}

function dateParam(url, vault, fallback) {
  const raw = (fallback ?? url.searchParams.get('date') ?? '').trim();
  if (raw === '') return vault.today();
  if (!isValidDate(raw)) throw new HttpError(400, `日期格式不对：${raw}`);
  return raw;
}

function kindParam(url) {
  const kind = url.searchParams.get('kind') ?? 'diary';
  if (!KINDS.has(kind)) throw new HttpError(400, `未知的记录类型：${kind}`);
  return kind;
}

function requireText(value, label) {
  if (typeof value !== 'string') throw new HttpError(400, `缺少${label}`);
  if (value.length > 200_000) throw new HttpError(400, `${label}太长`);
  return value;
}

function optionalText(value, limit) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, limit);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, '请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new HttpError(400, '请求体必须是一个 JSON 对象'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, '请求体不是合法的 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
