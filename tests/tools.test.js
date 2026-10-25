import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Vault } from '../lib/vault.js';
import { registerDiaryTools } from '../lib/tools.js';
import { detectWritingScope } from '../lib/scope.js';

/** Test double for a session log (real DSH Sessions answer `eventAt()`/`seq`). */
function sessionOf(events) {
  return { snapshotEvents: () => events };
}

function toolCall(name, args) {
  return { type: 'tool/call', data: { name, arguments: args === undefined ? '{}' : JSON.stringify(args) } };
}

function execOf(session) {
  return session === undefined ? undefined : { agent: { session } };
}

/** The same resolver the host wires in lib/index.js. */
function liveScope(exec) {
  return detectWritingScope(exec?.agent?.session);
}

async function harness(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diary-tools-'));
  const vault = new Vault(root, { git: true, dayCutoffHour: 4, timeZone: 'Asia/Shanghai' });
  await vault.ensure();
  const definitions = new Map();
  const ctx = {
    effect(run) {
      run();
      return () => {};
    },
    tools: {
      register(definition) {
        definitions.set(definition.name, definition);
        return () => {};
      },
    },
  };
  registerDiaryTools(ctx, {
    vault,
    refreshCard: () => {},
    resolveSessionScope: options.resolveSessionScope,
    sealDiaryDay: options.sealDiaryDay,
  });
  return { root, vault, definitions };
}

test('registers exactly the seven diary tools', async () => {
  const { root, definitions } = await harness();
  try {
    assert.deepEqual([...definitions.keys()].sort(), ['diary_capture', 'diary_read', 'diary_write', 'memory_search', 'profile_append', 'room_log', 'room_read']);
    for (const definition of definitions.values()) {
      assert.equal(typeof definition.execute, 'function');
      assert.equal(typeof definition.output.render, 'function');
      assert.equal(definition.parameters.type, 'object');
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('diary_capture appends to the inbox and diary_write reads back', async () => {
  const { root, vault, definitions } = await harness();
  try {
    const today = vault.today();
    await definitions.get('diary_capture').execute({ text: '今天把工具接上了', date: today });
    const inbox = await vault.read('inbox', today);
    assert.match(inbox.raw, /今天把工具接上了/u);

    await definitions.get('diary_write').execute({
      kind: 'diary',
      date: today,
      body: '今天把工具接上了。\n\n> 卡了三遍。\n',
      title: '工具接上了',
      mood: '有点累',
      mode: 'final',
    });
    const read = await definitions.get('diary_read').execute({ kind: 'diary', date: today });
    assert.equal(read.exists, true);
    assert.equal(read.title, '工具接上了');
    assert.match(read.body, /卡了三遍/u);

    const entry = await vault.read('diary', today);
    assert.equal(entry.meta.status, 'final');
    assert.equal(entry.meta.mood, '有点累');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('room_log writes a room page, room_read opens it, memory_search finds it', async () => {
  const { root, vault, definitions } = await harness();
  try {
    const saved = await definitions.get('room_log').execute({
      title: '聊了聊房间',
      summary: '主人想要一个不带任务的房间。',
      tags: ['房间', '设计'],
      mood: '轻快',
      body: '他把杯子推过来，说想要一个随便聊的地方。\n',
    });
    assert.match(saved.id, /^\d{4}-\d{2}-\d{2}-\d{6}$/u);
    const list = await vault.roomLogs(5);
    assert.equal(list[0].title, '聊了聊房间');
    assert.deepEqual(list[0].tags, ['房间', '设计']);

    const entry = await definitions.get('room_read').execute({ id: saved.id });
    assert.match(entry.body, /随便聊的地方/u);

    const hits = await definitions.get('memory_search').execute({ query: '随便聊' });
    assert.equal(hits.items.length, 1);
    assert.equal(hits.items[0].kind, 'room');

    const toc = await vault.readRoomLog(saved.id);
    assert.equal(toc.summary, '主人想要一个不带任务的房间。');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('diary_write handles maid pages and the profile', async () => {
  const { root, vault, definitions } = await harness();
  try {
    const today = vault.today();
    await definitions.get('diary_write').execute({
      kind: 'maid',
      date: today,
      body: '他今天说了三次算了。\n\n今天也把主人的一天，折好收进抽屉里了。\n',
      mood: '有点心疼',
    });
    const maid = await definitions.get('diary_read').execute({ kind: 'maid', date: today });
    assert.match(maid.body, /三次算了/u);

    await definitions.get('diary_write').execute({ kind: 'profile', body: '# 主人侧写\n\n- [2026-10-23][事实] 在写日记插件。\n' });
    const profile = await definitions.get('diary_read').execute({ kind: 'profile' });
    assert.equal(profile.exists, true);
    assert.match(profile.body, /\[事实\]/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a room session cannot write the diary, but her diary and the profile still work', async () => {
  const { root, vault, definitions } = await harness({ resolveSessionScope: liveScope });
  try {
    const today = vault.today();
    const exec = execOf(sessionOf([toolCall('skill', { name: 'room-chat' })]));

    await assert.rejects(
      () => definitions.get('diary_write').execute({ kind: 'diary', date: today, body: '今天……\n', mode: 'final' }, exec),
      /房间里不写日记/u,
    );
    assert.equal((await vault.read('diary', today)).exists, false, 'a refused write must not touch the page');

    // Her diary and the profile are allowed in the room: room talk only has a light touch.
    const maid = await definitions.get('diary_write').execute({ kind: 'maid', date: today, body: '他在房间里坐了一会儿。\n' }, exec);
    assert.equal(maid.kind, 'maid');
    const profile = await definitions.get('profile_append').execute({ entries: [{ text: '在房间里坐了一会儿', kind: 'fact' }] }, exec);
    assert.deepEqual({ added: profile.added, skipped: profile.skipped }, { added: 1, skipped: 0 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a study session still writes and finalises the diary (P2 seal untouched)', async () => {
  const sealed = [];
  const { root, vault, definitions } = await harness({
    resolveSessionScope: liveScope,
    sealDiaryDay: async (date) => { sealed.push(date); },
  });
  try {
    const today = vault.today();
    const exec = execOf(sessionOf([toolCall('skill', { name: 'diary-ritual' })]));
    const saved = await definitions.get('diary_write').execute({
      kind: 'diary',
      date: today,
      body: '今天把边界补上了。\n',
      mode: 'final',
    }, exec);
    assert.equal(saved.status, 'final');
    const entry = await vault.read('diary', today);
    assert.equal(entry.exists, true);
    assert.equal(entry.meta.status, 'final');
    assert.deepEqual(sealed, [today], 'a final diary page must still settle the day');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('when the session state cannot be read, the diary write is allowed (fail safe)', async () => {
  const { root, vault, definitions } = await harness({
    resolveSessionScope: () => { throw new Error('session unavailable'); },
  });
  try {
    const today = vault.today();
    const saved = await definitions.get('diary_write').execute({ kind: 'diary', date: today, body: '书房照常写。\n' });
    assert.equal(saved.status, 'draft');
    const entry = await vault.read('diary', today);
    assert.equal(entry.exists, true, 'an unknown session must never be treated as a room');
    assert.match(entry.body, /书房照常写/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('profile_append appends, skips duplicates and reports through its render', async () => {
  const { root, vault, definitions } = await harness();
  try {
    const today = vault.today();
    const tool = definitions.get('profile_append');
    const first = await tool.execute({
      entries: [
        { text: '在收尾插件', kind: 'fact' },
        { text: '可能有点困', kind: 'guess' },
      ],
    });
    assert.deepEqual({ path: first.path, added: first.added, skipped: first.skipped }, { path: '侧写/主人.md', added: 2, skipped: 0 });
    const raw1 = await fs.readFile(path.join(root, '侧写', '主人.md'), 'utf8');
    assert.match(raw1, new RegExp(`- \\[${today}\\]\\[事实\\] 在收尾插件`, 'u'));
    assert.match(raw1, new RegExp(`- \\[${today}\\]\\[推测\\] 可能有点困`, 'u'));

    const second = await tool.execute({
      entries: [
        { text: '在收尾插件', kind: 'fact' },
        { text: ' 新的观察 ', kind: 'fact', date: today },
      ],
    });
    assert.equal(second.added, 1);
    assert.equal(second.skipped, 1);
    const raw2 = await fs.readFile(path.join(root, '侧写', '主人.md'), 'utf8');
    assert.ok(raw2.startsWith(raw1), 'the old profile text must stay byte-for-byte');
    assert.match(raw2, /\[事实\] 新的观察/u);

    const rendered = tool.output.render({}, second);
    assert.match(rendered[0].text, /侧写追加好了：1 条，跳过 1 条重复/u);

    await assert.rejects(() => tool.execute({ entries: [{ text: '  ', kind: 'fact' }] }), /不能为空/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
