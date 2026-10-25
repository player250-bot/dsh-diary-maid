import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SaveStore, SavesError } from '../lib/saves.js';

async function withStore(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diary-saves-'));
  const store = new SaveStore(root, { dayCutoffHour: 4, timeZone: 'Asia/Shanghai' });
  try {
    await run(store, root);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }).catch(() => {});
  }
}

async function readFileJson(root) {
  return JSON.parse(await fs.readFile(path.join(root, '.diary/saves.json'), 'utf8'));
}

test('a missing table reads as empty and the first save creates it', async () => {
  await withStore(async (store, root) => {
    const before = await store.read();
    assert.equal(before.saves.length, 0);
    assert.equal(before.broken, false);
    assert.deepEqual(before.bindings, {});
    await assert.rejects(fs.access(path.join(root, '.diary/saves.json')));

    const created = await store.create({ sessionId: 'session-a', date: '2026-10-25' });
    assert.equal(created.save.status, 'active');
    assert.deepEqual(created.save.dates, ['2026-10-25']);
    assert.equal(created.save.title, '日记 · 2026-10-25');
    assert.equal(created.save.source, 'created');
    assert.match(created.save.id, /^save-20261025-\d{6}-[0-9a-f]{6}$/u);
    assert.match(created.save.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u);

    const table = await readFileJson(root);
    assert.equal(table.version, 1);
    assert.equal(table.saves.length, 1);
    assert.deepEqual(table.bindings, { '2026-10-25': [created.save.id] });
  });
});

test('one conversation can only be saved once', async () => {
  await withStore(async (store) => {
    const first = await store.create({ sessionId: 'session-a', date: '2026-10-25' });
    await assert.rejects(
      store.create({ sessionId: 'session-a', date: '2026-10-26' }),
      (error) => {
        assert.equal(error instanceof SavesError, true);
        assert.equal(error.status, 409);
        assert.equal(error.save.id, first.save.id);
        return true;
      },
    );
    assert.equal((await store.list()).length, 1);
    await assert.rejects(store.create({ sessionId: 'bad session id' }), /会话编号/u);
  });
});

test('dates are many-to-many: one save covers days, one day holds saves', async () => {
  await withStore(async (store) => {
    const first = await store.create({ sessionId: 'session-a', date: '2026-10-25', title: '工作吐槽' });
    const second = await store.create({ sessionId: 'session-b', date: '2026-10-25', title: '也聊工作' });
    await store.bind(first.save.id, { addDates: ['2026-10-26', '2026-10-24', '2026-10-26'] });
    const third = await store.create({ sessionId: 'session-c', date: '2026-10-24' });

    const table = await readFileJson(readOf(store));
    const byId = Object.fromEntries(table.saves.map((save) => [save.id, save]));
    assert.deepEqual(byId[first.save.id].dates, ['2026-10-24', '2026-10-25', '2026-10-26']);
    assert.deepEqual(table.bindings['2026-10-25'], [first.save.id, second.save.id]);
    assert.deepEqual(table.bindings['2026-10-24'], [first.save.id, third.save.id]);

    const after = await store.bind(first.save.id, { removeDates: ['2026-10-25'] });
    assert.deepEqual(after.save.dates, ['2026-10-24', '2026-10-26']);
    assert.deepEqual((await readFileJson(readOf(store))).bindings['2026-10-25'], [second.save.id]);
    await assert.rejects(store.bind(first.save.id, { addDates: ['2026-13-01'] }), /日期格式/u);
  });
});

test('title, tags, note and status are bounded and normalized', async () => {
  await withStore(async (store) => {
    const created = await store.create({
      sessionId: 'session-a',
      date: '2026-10-25',
      title: `  ${'长'.repeat(60)}  `,
      tags: [' 工作 ', '工作', '', '心情', '设计', '杂事', '多余'],
      note: 'x'.repeat(600),
    });
    assert.equal(created.save.title.length, 40);
    assert.deepEqual(created.save.tags, ['工作', '心情', '设计', '杂事', '多余']);
    assert.equal(created.save.note.length, 500);

    const updated = await store.update(created.save.id, { title: '改个名', tags: ['标签'] });
    assert.equal(updated.save.title, '改个名');
    assert.deepEqual(updated.save.tags, ['标签']);

    const sealed = await store.update(created.save.id, { status: 'sealed' });
    assert.equal(sealed.save.status, 'sealed');
    assert.notEqual(sealed.save.sealedAt, null);

    const reopened = await store.update(created.save.id, { status: 'active' });
    assert.equal(reopened.save.sealedAt, null);

    await assert.rejects(store.update(created.save.id, { status: 'nope' }), /存档状态/u);
    await assert.rejects(store.update('save-missing', { title: 'x' }), (error) => error.status === 404);
  });
});

test('seal settles every active save bound to one day, idempotently', async () => {
  await withStore(async (store) => {
    const first = await store.create({ sessionId: 'session-a', date: '2026-10-25' });
    const second = await store.create({ sessionId: 'session-b', date: '2026-10-25' });
    await store.create({ sessionId: 'session-c', date: '2026-10-26' });

    const result = await store.seal('2026-10-25');
    assert.equal(result.count, 2);
    assert.deepEqual([...result.ids].sort(), [first.save.id, second.save.id].sort());
    const saves = await store.list();
    assert.equal(saves.find((save) => save.sessionId === 'session-a').status, 'sealed');
    assert.equal(saves.find((save) => save.sessionId === 'session-c').status, 'active');

    const again = await store.seal('2026-10-25');
    assert.equal(again.count, 0);
  });
});

test('archive keeps the row, hard delete removes only the row', async () => {
  await withStore(async (store) => {
    const created = await store.create({ sessionId: 'session-a', date: '2026-10-25' });
    const archived = await store.archive(created.save.id);
    assert.equal(archived.save.status, 'archived');
    assert.equal((await store.list()).length, 1);

    const removed = await store.remove(created.save.id);
    assert.equal(removed.save.id, created.save.id);
    assert.equal((await store.list()).length, 0);
    assert.deepEqual((await readFileJson(readOf(store))).bindings, {});
    await assert.rejects(store.remove(created.save.id), (error) => error.status === 404);
  });
});

test('a corrupt table degrades to broken and is never overwritten', async () => {
  await withStore(async (store, root) => {
    const target = path.join(root, '.diary/saves.json');
    await fs.mkdir(path.dirname(target), { recursive: true });
    const corrupt = '{"version":1,"saves":[{"id":"save-20261025-160400-aaaa","sessionId":';
    await fs.writeFile(target, corrupt, 'utf8');

    const state = await store.read();
    assert.equal(state.broken, true);
    assert.deepEqual(state.saves, []);
    await assert.rejects(store.create({ sessionId: 'session-a', date: '2026-10-25' }), (error) => error.status === 409);
    await assert.rejects(store.list().then(() => store.create({ sessionId: 'session-b' })), /存档表读不出来/u);
    assert.equal(await fs.readFile(target, 'utf8'), corrupt);
  });
});

test('a non-object table is broken too, and stale rows are dropped on read', async () => {
  await withStore(async (store, root) => {
    const target = path.join(root, '.diary/saves.json');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '[]', 'utf8');
    assert.equal((await store.read()).broken, true);

    await fs.writeFile(target, JSON.stringify({
      version: 1,
      saves: [
        { id: 'save-1', sessionId: 'session-a', title: '好的', dates: ['2026-10-25', 'nope'], status: 'active', tags: ['x'], note: '', source: 'created' },
        { id: 'save-1', sessionId: 'session-b', title: '重复 id', dates: [], status: 'active' },
        { id: 'save-3', sessionId: 'session-a', title: '重复会话', dates: [], status: 'active' },
        { nope: true },
      ],
    }), 'utf8');
    const state = await store.read();
    assert.equal(state.broken, false);
    assert.equal(state.saves.length, 1);
    assert.deepEqual(state.saves[0].dates, ['2026-10-25']);
  });
});

test('concurrent creates serialize instead of losing rows', async () => {
  await withStore(async (store, root) => {
    await Promise.all(Array.from({ length: 12 }, (_, index) => store.create({
      sessionId: `session-${String(index)}`,
      date: '2026-10-25',
    })));
    const table = await readFileJson(root);
    assert.equal(table.saves.length, 12);
    assert.equal(table.bindings['2026-10-25'].length, 12);
    assert.equal(new Set(table.saves.map((save) => save.id)).size, 12);
  });
});

test('an existing vault gains the ignore line on its next ensure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diary-saves-'));
  try {
    const { Vault } = await import('../lib/vault.js');
    await fs.mkdir(path.join(root, '.git'), { recursive: true });
    await fs.writeFile(path.join(root, '.gitignore'), '.diary/index.json\n', 'utf8');
    const vault = new Vault(root, { git: false });
    await vault.ensure();
    const ignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    assert.match(ignore, /\.diary\/saves\.json/u);
    assert.match(ignore, /\.diary\/index\.json/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }).catch(() => {});
  }
});

test('the saves table is gitignored by the vault, not committed', async () => {
  await withStore(async (store, root) => {
    const { Vault } = await import('../lib/vault.js');
    const vault = new Vault(root, { git: false });
    await vault.ensure();
    const ignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    assert.match(ignore, /\.diary\/saves\.json/u);
    await store.create({ sessionId: 'session-a', date: '2026-10-25' });
    assert.equal(vault.git.repo, false);
  });
});

/** The store owns the root; the temp helper only needs it back for assertions. */
function readOf(store) {
  return store.root;
}
