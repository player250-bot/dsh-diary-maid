import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Vault, localDate, parseFrontmatter, stringifyFrontmatter } from '../lib/vault.js';

async function withVault(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diary-maid-'));
  const vault = new Vault(root, { git: true, dayCutoffHour: 4, timeZone: 'Asia/Shanghai' });
  try {
    await run(vault, root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('frontmatter round-trips titles, arrays and booleans', () => {
  const meta = { date: '2026-10-23', title: '卡在三遍 manifest 上', tags: ['日记', '插件'], private: true, mood: '' };
  const text = stringifyFrontmatter(meta, '正文\n');
  const parsed = parseFrontmatter(text);
  assert.equal(parsed.meta.date, '2026-10-23');
  assert.equal(parsed.meta.title, '卡在三遍 manifest 上');
  assert.deepEqual(parsed.meta.tags, ['日记', '插件']);
  assert.equal(parsed.meta.private, true);
  assert.equal(parsed.body, '正文\n');
});

test('today respects the 4am cutoff in the configured zone', () => {
  const late = new Date('2026-10-23T16:30:00Z'); // 00:30 on the 24th, Asia/Shanghai
  assert.equal(localDate(late, 4, 'Asia/Shanghai'), '2026-10-23');
  const noon = new Date('2026-10-23T04:30:00Z'); // 12:30 on the 23rd
  assert.equal(localDate(noon, 4, 'Asia/Shanghai'), '2026-10-23');
  const utc = new Date('2026-10-23T23:30:00Z'); // 07:30 on the 24th
  assert.equal(localDate(utc, 4, 'Asia/Shanghai'), '2026-10-24');
});

test('vault initializes its folders and an independent git repository', async () => {
  await withVault(async (vault, root) => {
    await vault.ensure();
    assert.equal(vault.git.repo, true);
    for (const dir of ['鲸汐/心事', '侧写', '人设', '.diary/history']) {
      const stat = await fs.stat(path.join(root, dir));
      assert.equal(stat.isDirectory(), true);
    }
    const gitignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    assert.match(gitignore, /\.diary\/history\//u);
    assert.equal((await vault.today()).length, 10);
  });
});

test('writing a page stores year/month, commits, and keeps a snapshot', async () => {
  await withVault(async (vault, root) => {
    const day = '2026-10-23';
    const first = await vault.write('diary', day, {
      meta: { title: '第一页', mood: '有点累' },
      body: '今天把面板搭起来了。\n',
    });
    assert.equal(first.path, '2026/10/2026-10-23.md');
    const raw = await fs.readFile(path.join(root, first.path), 'utf8');
    assert.match(raw, /title: 第一页/u);

    const second = await vault.write('diary', day, { meta: {}, body: '改过的正文。\n' });
    assert.equal(second.meta.title, '第一页', 'a body-only save keeps the previous title');

    const history = await vault.git.log(first.path, 10);
    assert.equal(history.length, 2);
    const restored = parseFrontmatter(await vault.git.show(history[1].hash, first.path));
    assert.equal(restored.meta.title, '第一页');
    assert.match(restored.body, /面板/u);

    const snapshots = await fs.readdir(path.join(root, '.diary/history'));
    assert.ok(snapshots.length >= 1);
  });
});

test('list, streak and inbox behave for one day and a gap', async () => {
  await withVault(async (vault, root) => {
    await vault.write('diary', '2026-10-22', { meta: { title: '前天地' }, body: '前天。\n' });
    await vault.write('diary', '2026-10-23', { meta: { title: '今天' }, body: '今天。\n' });
    await vault.appendInbox('2026-10-23', '卡在配置项上');
    await vault.appendInbox('2026-10-23', '第二件');

    const list = await vault.list({ limit: 10 });
    assert.deepEqual(list.items.map((item) => item.date), ['2026-10-23', '2026-10-22']);
    assert.equal(list.items[0].hasMaid, false);

    assert.equal(await vault.streak('2026-10-23'), 2);
    assert.equal(await vault.streak('2026-10-25'), 0);

    const inbox = await fs.readFile(path.join(root, '2026/10/2026-10-23.inbox.md'), 'utf8');
    assert.match(inbox, /- \d{2}:\d{2} 卡在配置项上/u);
    assert.match(inbox, /第二件/u);

    const index = JSON.parse(await fs.readFile(path.join(root, '.diary/index.json'), 'utf8'));
    assert.equal(index.entries.length, 2);
  });
});

test('settings, avatars and persona stay inside the vault', async () => {
  await withVault(async (vault, root) => {
    await vault.saveSettings({ avatar: '鲸汐-立绘.jpg' });
    assert.equal((await vault.settings()).avatar, '鲸汐-立绘.jpg');

    await fs.writeFile(path.join(root, '人设', '新头像.png'), 'not-a-real-png');
    await fs.writeFile(path.join(root, '人设', 'notes.txt'), 'ignore me');
    const avatars = await vault.avatars();
    assert.deepEqual(avatars, ['新头像.png']);

    const persona = await vault.readPersona('内置人设');
    assert.equal(persona.source, 'package');
    await vault.writePersona('你是鲸汐。\n');
    const saved = await vault.readPersona('内置人设');
    assert.equal(saved.source, 'vault');
    assert.equal(saved.text, '你是鲸汐。\n');
  });
});

test('maid and profile pages use their own paths', async () => {
  await withVault(async (vault) => {
    const maid = await vault.write('maid', '2026-10-23', { meta: { mood: '尾巴有点晃' }, body: '他今天说了三次算了。\n' });
    assert.equal(maid.path, '鲸汐/2026-10-23.md');
    const profile = await vault.write('profile', null, { meta: {}, body: '# 主人侧写\n' });
    assert.equal(profile.path, '侧写/主人.md');
    const read = await vault.read('maid', '2026-10-23');
    assert.equal(read.meta.mood, '尾巴有点晃');
  });
});
