import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Vault } from '../lib/vault.js';
import { registerDiaryTools } from '../lib/tools.js';

async function harness() {
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
  registerDiaryTools(ctx, { vault, refreshCard: () => {} });
  return { root, vault, definitions };
}

test('registers exactly the three diary tools', async () => {
  const { root, definitions } = await harness();
  try {
    assert.deepEqual([...definitions.keys()].sort(), ['diary_capture', 'diary_read', 'diary_write']);
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

    await definitions.get('diary_write').execute({
      kind: 'interview',
      date: today,
      mood: '有点累',
      body: '## 问：今天最累的一刻？\n答：改了三遍配置。\n',
    });
    const interview = await definitions.get('diary_read').execute({ kind: 'interview', date: today });
    assert.match(interview.body, /改了三遍配置/u);

    await definitions.get('diary_write').execute({ kind: 'profile', body: '# 主人侧写\n\n- [2026-10-23][事实] 在写日记插件。\n' });
    const profile = await definitions.get('diary_read').execute({ kind: 'profile' });
    assert.equal(profile.exists, true);
    assert.match(profile.body, /\[事实\]/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
