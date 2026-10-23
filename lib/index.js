import { promises as fs, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault, expandHome, isValidDate, parseFrontmatter } from './vault.js';
import { registerDiaryTools } from './tools.js';
import { inWorkspace } from './scope.js';

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
  const workspacePath = path.resolve(expandHome(String(config.workspace ?? path.dirname(vaultPath))));
  console.log(`[dsh-diary-maid] mounted · vault=${vaultPath}`);
  const vault = new Vault(vaultPath, {
    git: config.git !== false,
    dayCutoffHour: Number.isInteger(config.dayCutoffHour) ? config.dayCutoffHour : 4,
    timeZone: typeof config.timeZone === 'string' ? config.timeZone : undefined,
  });

  const personaFile = path.join(vaultPath, '人设/鲸汐.md');
  const personaState = { text: '', enabled: true, mtime: 0, checkedAt: 0 };
  let cardCache = '';
  try {
    const initial = JSON.parse(readFileSync(path.join(vaultPath, '.diary/settings.json'), 'utf8'));
    if (initial !== null && typeof initial === 'object' && initial.personaEnabled === false) personaState.enabled = false;
  } catch {
    /* no settings yet: the persona is on by default */
  }
  loadPersonaSync();

  function sessionUsage(session) {
    try {
      const meter = ctx.get('tokenMeter');
      const window = session?.requestContext()?.contextWindow;
      if (!meter || !session || !window) return null;
      const tokens = meter.measure(session).totalTokens;
      return { tokens, window, percent: Math.min(100, Math.round((tokens / window) * 100)) };
    } catch {
      return null;
    }
  }

  function sessionTitleOf(session) {
    try {
      return ctx.get('sessionTitle')?.get(session)?.title ?? '';
    } catch {
      return '';
    }
  }

  async function renameSession(id, title) {
    try {
      const controller = ctx.get('sessionController');
      if (!controller || !id || !title) return;
      await controller.rename({ sessionId: id, title });
    } catch {
      /* naming is a nicety; never fail the room log */
    }
  }

  async function diarySessions() {
    const controller = ctx.get('sessionController');
    if (!controller) return [];
    const value = await controller.list({});
    const items = [];
    for (const summary of value.items) {
      if (summary.origin === 'subagent') continue;
      if (!inWorkspace(summary.cwd, [workspacePath, vaultPath])) continue;
      const agent = ctx.get('agents')?.get(summary.sessionId);
      const session = agent?.session;
      const usage = session === undefined ? null : sessionUsage(session);
      items.push({
        id: summary.sessionId,
        title: session === undefined ? '' : sessionTitleOf(session),
        updatedAt: summary.updatedAt,
        running: summary.running === true,
        percent: usage === null ? null : usage.percent,
        tokens: usage === null ? null : usage.tokens,
      });
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  ctx.inject(['systemPrompt'], (system) => {
    const sectionBase = system.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX');
    system.effect(() => system.systemPrompt.section({
      name: 'diary-maid:persona',
      order: Number.isFinite(sectionBase) ? sectionBase + 1 : 1,
      text: () => personaText(),
      interpolate: false,
    }), 'dsh-diary-maid: persona section');

    const contextBase = system.systemPrompt.getContextOrder('WEB_SURFACE');
    system.effect(() => system.systemPrompt.context({
      name: 'diary-maid:today',
      order: Number.isFinite(contextBase) ? contextBase + 1 : 220,
      text: () => cardCache,
      interpolate: false,
    }), 'dsh-diary-maid: today card');
  });

  vault.ensure().then(async () => {
    const settings = await vault.settings();
    if (settings.personaEnabled === false) personaState.enabled = false;
    await refreshCard();
  }).catch(() => {});

  ctx.effect(() => {
    const timer = setInterval(() => { refreshCard(); }, 60_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, 'dsh-diary-maid: card refresh');

  function loadPersonaSync() {
    try {
      const stat = statSync(personaFile);
      personaState.text = readFileSync(personaFile, 'utf8');
      personaState.mtime = stat.mtimeMs;
      return;
    } catch {
      /* fall back to the bundled persona */
    }
    try {
      personaState.text = readFileSync(path.join(PACKAGE_ROOT, 'persona/鲸汐.md'), 'utf8');
    } catch {
      personaState.text = '';
    }
  }

  /** Read the vault copy when it changes; never throw into prompt assembly. */
  function personaText() {
    if (!personaState.enabled) return '';
    const now = Date.now();
    if (now - personaState.checkedAt > 1500) {
      personaState.checkedAt = now;
      try {
        const stat = statSync(personaFile);
        if (stat.mtimeMs !== personaState.mtime) {
          personaState.text = readFileSync(personaFile, 'utf8');
          personaState.mtime = stat.mtimeMs;
        }
      } catch {
        /* keep the last good persona */
      }
    }
    return personaState.text;
  }

  async function refreshCard() {
    try {
      const today = vault.today();
      const entry = await vault.read('diary', today);
      const recent = await vault.list({ limit: 5 });
      const profile = await vault.read('profile');
      const maid = await vault.read('maid', today);
      const streak = await vault.streak(today);
      const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${today}T00:00:00`).getDay()] ?? '';
      const status = !entry.exists ? '还没写' : entry.meta.status === 'draft' ? '草稿' : '已写';
      const lines = [
        `【日记】${today} ${weekday} · ${status} · 连续 ${String(streak)} 天`,
        '【做法】主人讲今天 → 先用 diary_capture 记原话，再回应；成文等主人说「晚安」。',
      ];

      const previous = recent.items.filter((item) => item.date !== today).slice(0, 3);
      if (previous.length > 0) {
        lines.push(`【最近】${previous.map((item) => `${item.date.slice(5)} ${item.title.slice(0, 16)}`).join(' / ')}`);
      }
      const gist = profile.body.replace(/^#{1,6}\s+.*$/gmu, '').replace(/\s+/gu, ' ').trim();
      if (gist !== '') lines.push(`【侧写】${gist.slice(0, 100)}`);
      const last = maid.body.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'))
        .slice(-1)[0];
      if (last !== undefined) lines.push(`【她上次】${last.slice(0, 80)}`);
      try {
        const agent = ctx.get('agents')?.currentInitiator();
        const usage = agent === undefined ? null : sessionUsage(agent.session);
        if (usage !== null && usage.percent >= 70) {
          lines.push(`【房间】上下文 ${String(usage.percent)}% · 可以提醒主人换一间新的；旧房间会留着。`);
        }
      } catch {
        /* no live session in this assembly */
      }
      const rooms = await vault.roomLogs(3);
      if (rooms.length > 0) {
        lines.push(`【房间】${rooms.map((room) => `${room.date.slice(5)} ${room.title}`).join(' / ')}；要回忆先 memory_search。`);
      }

      const nextCard = lines.join('\n');
      if (nextCard !== cardCache) console.log(`[dsh-diary-maid] card refreshed (${String(nextCard.length)} chars)`);
      cardCache = nextCard;
      console.log(`[dsh-diary-maid] card=${String(cardCache.length)}`);
    } catch (error) {
      console.log(`[dsh-diary-maid] card failed: ${String(error?.message ?? error)}`);
      cardCache = '';
    }
  }

  ctx.inject(['tools'], (toolCtx) => {
    registerDiaryTools(toolCtx, { vault, refreshCard, renameSession });
  });

  ctx.inject(['skills'], (skillCtx) => {
    const catalogue = [
      {
        name: 'diary-ritual',
        file: 'skills/diary-ritual.md',
        description: '鲸汐的写日记流程：听主人讲今天、追问细节、先出草稿、确认后落盘，再更新侧写和她自己的日记。',
        whenToUse: '当主人开始讲今天发生的事、想写日记、说「晚安」，或要更新主人侧写时。',
        resource: '鲸汐的写日记流程',
      },
      {
        name: 'room-chat',
        file: 'skills/room-chat.md',
        description: '鲸汐在房间里的日常聊天：不用访谈的架势，随便聊，聊完写一条带副标题的房间日志；不碰日记，只轻轻影响侧写、心事和她自己的日记。',
        whenToUse: '当主人说「去房间坐坐」「随便聊聊」「我来了」，或想不带记录目的地讲讲话时。',
        resource: '鲸汐的房间',
      },
    ].map((entry) => {
      try {
        return { ...entry, content: readFileSync(path.join(PACKAGE_ROOT, entry.file), 'utf8') };
      } catch {
        return { ...entry, content: '' };
      }
    }).filter((entry) => entry.content !== '');
    if (catalogue.length === 0) return;

    // Both skills belong to the diary workspace, not to every session. The
    // catalog asks each provider with the session's cwd, so an empty candidate
    // list keeps 鲸汐 out of unrelated projects.
    const roots = [workspacePath, vaultPath];
    const inDiaryWorkspace = (cwd) => inWorkspace(cwd, roots);
    const summaryOf = (entry) => ({
      name: entry.name,
      description: entry.description,
      whenToUse: entry.whenToUse,
      invocation: { modelInvocable: true, userInvocable: false },
      source: 'custom',
      provider: 'dsh-diary-maid',
      resourceBase: { kind: 'opaque', description: entry.resource },
    });

    skillCtx.effect(() => skillCtx.skills.registerProvider((control) => ({
      name: 'dsh-diary-maid',
      async list(options) {
        if (control.signal.aborted || !inDiaryWorkspace(options?.cwd)) return { candidates: [], complete: true };
        return {
          candidates: catalogue.map((entry, index) => ({
            ...summaryOf(entry),
            rank: index,
            locator: { kind: 'inline', name: entry.name },
          })),
          complete: true,
        };
      },
      async get(candidate, options) {
        if (control.signal.aborted || !inDiaryWorkspace(options?.cwd)) return undefined;
        const entry = catalogue.find((item) => item.name === candidate.name);
        if (entry === undefined) return undefined;
        return { ...summaryOf(entry), content: entry.content };
      },
    })), 'dsh-diary-maid: workspace skills');
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
      [`${API}/search`, handleSearch],
      [`${API}/calendar`, handleCalendar],
      [`${API}/book`, handleBook],
      [`${API}/export`, handleExport],
      [`${API}/notes`, handleNotes],
      [`${API}/note`, handleNote],
      [`${API}/sessions`, handleSessions],
      [`${API}/rooms`, handleRooms],
      [`${API}/room`, handleRoom],
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
      void refreshCard();
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
      void refreshCard();
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
      void refreshCard();
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
        personaEnabled: personaState.enabled,
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
      if (typeof input.personaEnabled === 'boolean') {
        personaState.enabled = input.personaEnabled;
        patch.personaEnabled = input.personaEnabled;
      }
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
      personaState.text = text;
      try {
        personaState.mtime = statSync(personaFile).mtimeMs;
      } catch {
        personaState.mtime = Date.now();
      }
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

    async function handleSearch(req, res) {
      requireMethod(req, res, ['GET']);
      const url = new URL(req.url, 'http://localhost');
      const query = (url.searchParams.get('q') ?? '').trim();
      if (query === '') {
        sendJson(res, 200, { ok: true, items: [] });
        return;
      }
      const items = await vault.search(query, url.searchParams.get('limit') ?? 30);
      sendJson(res, 200, { ok: true, items });
    }

    async function handleCalendar(req, res) {
      requireMethod(req, res, ['GET']);
      const url = new URL(req.url, 'http://localhost');
      const month = url.searchParams.get('month') ?? vault.today().slice(0, 7);
      sendJson(res, 200, { ok: true, ...(await vault.calendar(month)) });
    }

    async function handleBook(req, res) {
      requireMethod(req, res, ['GET']);
      const url = new URL(req.url, 'http://localhost');
      const book = await vault.book({
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      });
      sendJson(res, 200, { ok: true, ...book });
    }

    async function handleExport(req, res) {
      requireMethod(req, res, ['GET']);
      const url = new URL(req.url, 'http://localhost');
      const book = await vault.book({
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      });
      const filename = `dsh-diary-${vault.today()}.md`;
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(book.text);
    }

    async function handleNotes(req, res) {
      requireMethod(req, res, ['GET']);
      const items = await vault.notes();
      sendJson(res, 200, { ok: true, items });
    }

    async function handleNote(req, res) {
      requireMethod(req, res, ['GET']);
      const url = new URL(req.url, 'http://localhost');
      const name = url.searchParams.get('name') ?? '';
      const text = await vault.readNote(name);
      sendJson(res, 200, { ok: true, name, text });
    }

    async function handleSessions(req, res) {
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, items: await diarySessions(), workspace: workspacePath });
        return;
      }
      if (req.method === 'POST') {
        const controller = ctx.get('sessionController');
        if (!controller) throw new HttpError(500, '会话服务不可用');
        const created = await controller.create({ cwd: workspacePath });
        sendJson(res, 200, { ok: true, id: created.sessionId });
        return;
      }
      if (req.method === 'PUT') {
        const input = await readJson(req);
        const id = optionalText(input.id, 80);
        const title = optionalText(input.title, 80);
        if (id === '' || title === '') throw new HttpError(400, '缺少会话编号或标题');
        await renameSession(id, title);
        sendJson(res, 200, { ok: true });
        return;
      }
      throw new HttpError(405, '这个接口不支持该请求方式', ['GET', 'POST', 'PUT']);
    }

    async function handleRooms(req, res) {
      requireMethod(req, res, ['GET']);
      const url = new URL(req.url, 'http://localhost');
      const items = await vault.roomLogs(url.searchParams.get('limit') ?? 8);
      sendJson(res, 200, { ok: true, items });
    }

    async function handleRoom(req, res) {
      requireMethod(req, res, ['GET']);
      const url = new URL(req.url, 'http://localhost');
      const id = (url.searchParams.get('id') ?? '').trim();
      const entry = await vault.readRoomLog(id);
      sendJson(res, 200, { ok: true, entry });
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
