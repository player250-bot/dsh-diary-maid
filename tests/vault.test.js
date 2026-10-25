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

test('room logs live under 鲸汐/房间 with a derived TOC', async () => {
  await withVault(async (vault, root) => {
    const first = await vault.writeRoomLog({
      at: new Date('2026-10-22T21:10:00+08:00'),
      title: '随便坐坐',
      summary: '聊了聊今天。',
      tags: ['房间'],
      body: '他今天有点累。\n',
    });
    const second = await vault.writeRoomLog({
      at: new Date('2026-10-23T23:40:00+08:00'),
      title: '聊了新房间和记忆目录',
      summary: '主人想用目录而不是时间来分对话。',
      tags: ['房间', '设计'],
      body: '他把杯子推过来。\n',
    });
    assert.equal(second.path, '鲸汐/房间/2026-10-23-234000.md');
    const list = await vault.roomLogs(5);
    assert.deepEqual(list.map((item) => item.id), [second.id, first.id]);
    assert.equal(list[0].title, '聊了新房间和记忆目录');
    assert.deepEqual(list[0].tags, ['房间', '设计']);
    const entry = await vault.readRoomLog(second.id);
    assert.match(entry.body, /杯子/u);
    const toc = await fs.readFile(path.join(root, '鲸汐/房间/目录.md'), 'utf8');
    assert.match(toc, /聊了新房间和记忆目录/u);
  });
});

test('search, calendar, book and notes share the same vault', async () => {
  await withVault(async (vault, root) => {
    await vault.write('diary', '2026-10-22', { meta: { title: '前天地' }, body: '昨天在改配置。\n' });
    await vault.write('diary', '2026-10-23', { meta: { title: '今天' }, body: '今天把工具接上了。\n' });
    await vault.write('diary', '2026-10-24', { meta: { title: '私密', private: true }, body: '这件事不要导出。\n' });

    const hits = await vault.search('工具');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].date, '2026-10-23');
    assert.equal(hits[0].kind, 'diary');

    const calendar = await vault.calendar('2026-10');
    assert.deepEqual(calendar.entries.map((item) => item.date), ['2026-10-22', '2026-10-23', '2026-10-24']);
    assert.deepEqual(calendar.maid, []);

    const book = await vault.book({});
    assert.equal(book.count, 2);
    assert.match(book.text, /## 2026-10-22/u);
    assert.match(book.text, /## 2026-10-23/u);
    assert.doesNotMatch(book.text, /不要导出/u);

    await fs.writeFile(path.join(root, '鲸汐/心事/关于主人.md'), '# 心事\n\n他今天笑了。\n');
    const notes = await vault.notes();
    assert.deepEqual(notes.map((item) => item.name), ['关于主人']);
    assert.match(await vault.readNote('关于主人'), /他今天笑了/u);
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

test('appendProfile only adds lines, keeps old bytes and commits a snapshot', async () => {
  await withVault(async (vault, root) => {
    const file = path.join(root, '侧写', '主人.md');
    const before = '# 主人侧写\n\n## 近期状态\n\n- [2026-10-24][事实] 旧的。\n\n## 雷区\n\n- 别催。\n';
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, before, 'utf8');

    const first = await vault.appendProfile([{ text: '在收尾插件', kind: 'fact' }], { today: '2026-10-25' });
    assert.deepEqual({ path: first.path, added: first.added, skipped: first.skipped }, { path: '侧写/主人.md', added: 1, skipped: 0 });
    const afterFirst = await fs.readFile(file, 'utf8');
    assert.equal(afterFirst, `${before}\n- [2026-10-25][事实] 在收尾插件\n`, 'nothing but the new line may change');

    // A section insertion splices one line in; the rest of the file stays identical.
    const second = await vault.appendProfile([{ text: '新的近期条目', kind: 'fact' }], { today: '2026-10-25', section: '近期状态' });
    assert.equal(second.added, 1);
    const afterSecond = await fs.readFile(file, 'utf8');
    assert.equal(afterSecond.replace('- [2026-10-25][事实] 新的近期条目\n', ''), afterFirst);
    assert.match(afterSecond, /- \[2026-10-24\]\[事实\] 旧的。\n- \[2026-10-25\]\[事实\] 新的近期条目\n/u);

    // Repeating the exact entry is a no-op, not a second line.
    const third = await vault.appendProfile([{ text: '新的近期条目', kind: 'fact' }], { today: '2026-10-25', section: '近期状态' });
    assert.equal(third.added, 0);
    assert.equal(third.skipped, 1);
    assert.equal(await fs.readFile(file, 'utf8'), afterSecond);

    const history = await vault.git.log('侧写/主人.md', 10);
    assert.ok(history.length >= 2, 'every append must be committed');
    assert.match(history[0].subject, /侧写追加/u);
    const snapshots = (await fs.readdir(path.join(root, '.diary/history'))).filter((name) => name.startsWith('侧写-主人-'));
    assert.ok(snapshots.length >= 2, 'the previous text is snapshotted before it is replaced');
  });
});

test('appendProfile validates entries, defaults the date and leaves diary pages alone', async () => {
  await withVault(async (vault, root) => {
    await vault.write('diary', '2026-10-25', { meta: { private: true, title: '私密' }, body: '不要导出。\n' });
    const diaryFile = path.join(root, '2026/10/2026-10-25.md');
    const beforeDiary = await fs.readFile(diaryFile, 'utf8');

    await assert.rejects(() => vault.appendProfile([], { today: '2026-10-25' }), /至少/u);
    await assert.rejects(() => vault.appendProfile([{ text: '  ', kind: 'fact' }], { today: '2026-10-25' }), /不能为空/u);
    await assert.rejects(() => vault.appendProfile([{ text: 'x', kind: 'wat' }], { today: '2026-10-25' }), /kind/u);
    await assert.rejects(() => vault.appendProfile([{ text: 'x', kind: 'fact', date: '2026-02-30' }], { today: '2026-10-25' }), /日期/u);
    await assert.rejects(
      () => vault.appendProfile(Array.from({ length: 21 }, () => ({ text: 'x', kind: 'fact' })), { today: '2026-10-25' }),
      /最多/u,
    );

    const today = vault.today();
    await vault.appendProfile([{ text: '默认日期', kind: 'guess' }]);
    const profile = await fs.readFile(path.join(root, '侧写', '主人.md'), 'utf8');
    assert.match(profile, new RegExp(`- \\[${today}\\]\\[推测\\] 默认日期`, 'u'));

    assert.equal(await fs.readFile(diaryFile, 'utf8'), beforeDiary, 'a private diary page is untouched');
  });
});
