import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { apply } from '../lib/index.js';

const API = '/dsh-diary/api';

function fakeRes() {
  let settle;
  const finished = new Promise((resolve) => { settle = resolve; });
  const res = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    payload: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      this.headersSent = true;
      for (const [name, value] of Object.entries(headers ?? {})) this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      if (typeof body === 'string') this.payload = body;
      settle();
    },
  };
  return { res, finished };
}

async function waitFor(check, timeoutMs = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the host');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Minimal Cordis-shaped context: only the services this plugin actually uses. */
function harness(services) {
  const routes = new Map();
  const disposers = [];
  const attempted = [];
  const scoped = {
    webServer: {
      register(route) {
        routes.set(route.path, route.handler);
        return () => routes.delete(route.path);
      },
    },
    connection: { requestRejection: () => undefined },
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
    },
  };
  const ctx = {
    webServer: scoped.webServer,
    connection: scoped.connection,
    get: (name) => services[name],
    effect: scoped.effect,
    inject: (names, callback) => {
      const deps = Array.isArray(names) ? names : [names];
      attempted.push(deps);
      const available = { ...services, webServer: scoped.webServer, connection: scoped.connection };
      if (!deps.every((name) => available[name] !== undefined)) return;
      callback({ ...scoped, ...Object.fromEntries(deps.map((name) => [name, available[name]])) });
    },
  };
  ctx.dispose = () => { for (const dispose of disposers) dispose(); };
  ctx.routes = routes;
  ctx.attempted = attempted;
  return ctx;
}

async function call(routes, method, pathname, body) {
  const handler = routes.get(pathname.split('?')[0]);
  assert.notEqual(handler, undefined, `no route for ${pathname}`);
  const req = new PassThrough();
  req.method = method;
  req.url = pathname;
  const { res, finished } = fakeRes();
  if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
  req.end();
  await handler(req, res);
  await finished;
  let json = null;
  try {
    json = JSON.parse(res.payload);
  } catch {
    json = null;
  }
  return { status: res.statusCode, json, res };
}

async function withHost(run, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diary-api-'));
  const renamed = [];
  const resolved = [];
  const resolveCalled = [];
  const services = {
    workspaceRegistry: {
      resolveByPath: async (target) => {
        resolved.push(target);
        return options.existingWorkspace === true ? { id: 'ws-0', path: root } : undefined;
      },
      create: async (target, title) => {
        resolveCalled.push({ target, title });
        return { id: 'ws-1', path: target, title };
      },
    },
    sessionController: {
      list: async () => ({ items: [] }),
      create: async () => ({ sessionId: 'session-host' }),
      rename: async ({ sessionId, title }) => { renamed.push({ sessionId, title }); },
    },
  };
  const ctx = harness(services);
  apply(ctx, { vaultPath: root, workspace: root, git: false, dayCutoffHour: 4, timeZone: 'Asia/Shanghai' });
  try {
    // ensureWorkspace is fire-and-forget: wait for its first observable step.
    await waitFor(() => resolved.length > 0);
    await run({ routes: ctx.routes, renamed, resolved, resolveCalled, services, root });
  } finally {
    ctx.dispose();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }).catch(() => {});
  }
}

test('saves API creates, lists, updates and deletes', async () => {
  await withHost(async ({ routes, renamed }) => {
    const empty = await call(routes, 'GET', `${API}/saves`);
    assert.equal(empty.status, 200);
    assert.equal(empty.json.ok, true);
    assert.equal(empty.json.saves.length, 0);
    assert.equal(empty.json.today.length, 10);
    assert.equal(typeof empty.json.workspace, 'string');
    assert.equal(empty.json.broken, false);

    const created = await call(routes, 'POST', `${API}/saves`, {
      sessionId: 'session-abc',
      title: '日记 · 2026-10-25',
      date: '2026-10-25',
    });
    assert.equal(created.status, 200);
    assert.equal(created.json.ok, true);
    assert.equal(created.json.renamed, true);
    assert.equal(created.json.save.status, 'active');
    assert.deepEqual(created.json.save.dates, ['2026-10-25']);
    assert.deepEqual(renamed, [{ sessionId: 'session-abc', title: '日记 · 2026-10-25' }]);

    const listed = await call(routes, 'GET', `${API}/saves`);
    assert.equal(listed.json.saves.length, 1);
    assert.deepEqual(listed.json.bindings['2026-10-25'], [created.json.save.id]);

    const again = await call(routes, 'POST', `${API}/saves`, { sessionId: 'session-abc', date: '2026-10-25' });
    assert.equal(again.status, 409);
    assert.equal(again.json.ok, false);
    assert.equal(again.json.save.id, created.json.save.id);

    const bound = await call(routes, 'PUT', `${API}/saves`, {
      id: created.json.save.id,
      addDates: ['2026-10-26'],
    });
    assert.equal(bound.status, 200);
    assert.deepEqual(bound.json.save.dates, ['2026-10-25', '2026-10-26']);
    assert.deepEqual((await call(routes, 'GET', `${API}/saves`)).json.bindings['2026-10-26'], [created.json.save.id]);

    const renamedSave = await call(routes, 'PUT', `${API}/saves`, { id: created.json.save.id, title: '新名字' });
    assert.equal(renamedSave.json.save.title, '新名字');
    const sealed = await call(routes, 'PUT', `${API}/saves`, { id: created.json.save.id, status: 'sealed' });
    assert.equal(sealed.json.save.status, 'sealed');

    const archived = await call(routes, 'DELETE', `${API}/saves?id=${encodeURIComponent(created.json.save.id)}`);
    assert.equal(archived.status, 200);
    assert.equal(archived.json.deleted, false);
    assert.equal(archived.json.save.status, 'archived');

    const removed = await call(routes, 'DELETE', `${API}/saves?id=${encodeURIComponent(created.json.save.id)}&hard=1`);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.deleted, true);
    assert.equal((await call(routes, 'GET', `${API}/saves`)).json.saves.length, 0);
  });
});

test('saves API rejects bad input and reports a failed rename', async () => {
  await withHost(async ({ routes, services }) => {
    services.sessionController.rename = async () => { throw new Error('rename refused'); };

    const missing = await call(routes, 'POST', `${API}/saves`, { date: '2026-10-25' });
    assert.equal(missing.status, 400);

    const badDate = await call(routes, 'POST', `${API}/saves`, { sessionId: 'session-a', date: '2026-02-30' });
    assert.equal(badDate.status, 400);

    const created = await call(routes, 'POST', `${API}/saves`, { sessionId: 'session-a', date: '2026-10-25' });
    assert.equal(created.status, 200);
    assert.equal(created.json.renamed, false);
    assert.equal(created.json.save.title, '日记 · 2026-10-25');

    const unknown = await call(routes, 'PUT', `${API}/saves`, { id: 'save-nope', title: 'x' });
    assert.equal(unknown.status, 404);

    const noId = await call(routes, 'DELETE', `${API}/saves`);
    assert.equal(noId.status, 400);

    const notAllowed = await call(routes, 'PATCH', `${API}/saves`, {});
    assert.equal(notAllowed.status, 405);
    assert.match(String(notAllowed.res.headers.allow), /GET/u);
  });
});

test('the saves API stays away from the vault git history', async () => {
  await withHost(async ({ routes, root }) => {
    const created = await call(routes, 'POST', `${API}/saves`, { sessionId: 'session-a', date: '2026-10-25' });
    assert.equal(created.status, 200);
    const ignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    assert.match(ignore, /\.diary\/saves\.json/u);
    const table = JSON.parse(await fs.readFile(path.join(root, '.diary/saves.json'), 'utf8'));
    assert.equal(table.saves.length, 1);
  });
});

test('a workspace that already owns the directory is reused', async () => {
  await withHost(async ({ resolveCalled, resolved }) => {
    assert.equal(resolved.length, 1);
    assert.deepEqual(resolveCalled, []);
  }, { existingWorkspace: true });
});

test('startup registers the vault directory as a workspace once', async () => {
  await withHost(async ({ resolveCalled }) => {
    await waitFor(() => resolveCalled.length > 0);
    assert.equal(resolveCalled.length, 1);
    assert.equal(resolveCalled[0].title, '鲸汐的抽屉');
    assert.ok(resolveCalled[0].target.endsWith('diary-api-') || resolveCalled[0].target.includes(os.tmpdir()));
  });
});
