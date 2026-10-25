import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Vault } from '../lib/vault.js';
import { SaveStore } from '../lib/saves.js';
import { registerDiaryTools } from '../lib/tools.js';

// P2 trigger tests: the tool half of "diary final → seal that day".
// The HTTP half lives in tests/api.test.js.
async function withTools(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diary-p2-'));
  const vault = new Vault(root, { git: false, dayCutoffHour: 4, timeZone: 'Asia/Shanghai' });
  const store = new SaveStore(root, { dayCutoffHour: 4, timeZone: 'Asia/Shanghai' });
  const definitions = new Map();
  const ctx = {
    effect(fn) {
      fn();
      return () => {};
    },
    tools: {
      register(definition) {
        definitions.set(definition.name, definition);
        return () => {};
      },
    },
  };
  // Deliberately thin: the tool must catch seal failures on its own too.
  // In the host the shared helper already catches and warns (see lib/index.js).
  registerDiaryTools(ctx, { vault, refreshCard: () => {}, sealDiaryDay: (date) => store.seal(date) });
  try {
    await run({ root, vault, store, definitions });
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }).catch(() => {});
  }
}

test('diary_write final seals every active save bound to the day; draft does not', async () => {
  await withTools(async ({ root, vault, store, definitions }) => {
    const today = vault.today();
    const first = await store.create({ sessionId: 'session-a', date: today });
    const second = await store.create({ sessionId: 'session-b', date: today });
    const otherDay = await store.create({ sessionId: 'session-c', date: '2026-01-01' });
    const write = definitions.get('diary_write');

    await write.execute({ kind: 'diary', date: today, body: '先写个草稿。\n', mode: 'draft' });
    const saves = await store.list();
    assert.equal(saves.find((save) => save.id === first.save.id).status, 'active');

    await write.execute({ kind: 'diary', date: today, body: '定稿的一页。\n', mode: 'final' });
    // Read the table off disk, exactly as the host leaves it for the panel.
    const table = JSON.parse(await fs.readFile(path.join(root, '.diary/saves.json'), 'utf8'));
    for (const id of [first.save.id, second.save.id]) {
      const row = table.saves.find((save) => save.id === id);
      assert.equal(row.status, 'sealed');
      assert.equal(typeof row.sealedAt, 'string');
      assert.notEqual(row.sealedAt, '');
    }
    assert.equal(table.bindings[today].length, 2);
    assert.equal(table.saves.find((save) => save.id === otherDay.save.id).status, 'active');

    const entry = await vault.read('diary', today);
    assert.equal(entry.meta.status, 'final');
    // The seal is metadata-only: the page text ends exactly where the tool wrote it.
    assert.match(entry.raw, /^---\n/u);
    assert.equal(entry.raw.includes('sessionId'), false);
    assert.equal(entry.raw.endsWith('定稿的一页。\n'), true);
  });
});

test('writing final again the same day is idempotent and keeps the first sealedAt', async () => {
  await withTools(async ({ vault, store, definitions }) => {
    const today = vault.today();
    const created = await store.create({ sessionId: 'session-a', date: today });
    const write = definitions.get('diary_write');

    await write.execute({ kind: 'diary', date: today, body: '第一版。\n', mode: 'final' });
    const sealedAt = (await store.list()).find((save) => save.id === created.save.id).sealedAt;
    assert.notEqual(sealedAt, null);

    await write.execute({ kind: 'diary', date: today, body: '改了个错字。\n', mode: 'final', title: '改过的' });
    const after = (await store.list()).find((save) => save.id === created.save.id);
    assert.equal(after.status, 'sealed');
    assert.equal(after.sealedAt, sealedAt);
  });
});

test('a failing seal never fails or rolls back the diary write', async () => {
  await withTools(async ({ root, vault, definitions }) => {
    const today = vault.today();
    const table = path.join(root, '.diary/saves.json');
    await fs.mkdir(path.dirname(table), { recursive: true });
    await fs.writeFile(table, '{"version":1,"saves":[', 'utf8');

    const written = await definitions.get('diary_write').execute({
      kind: 'diary',
      date: today,
      body: '表坏了也照样写下来。\n',
      mode: 'final',
    });
    assert.equal(written.status, 'final');
    const entry = await vault.read('diary', today);
    assert.equal(entry.exists, true);
    assert.match(entry.body, /照样写下来/u);
    // A broken table must not be clobbered by a failed seal either.
    assert.equal(await fs.readFile(table, 'utf8'), '{"version":1,"saves":[');
  });
});
