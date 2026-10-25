import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Source-level guards for task-17: these are deliberately blunt string checks,
// so a regression fails loudly in CI even though the drawer itself is React.
const clientPath = new URL('../lib/client.js', import.meta.url);
const hostPath = new URL('../lib/index.js', import.meta.url);
const packagePath = new URL('../package.json', import.meta.url);
const client = await readFile(clientPath, 'utf8');
const host = await readFile(hostPath, 'utf8');
const pkg = JSON.parse(await readFile(packagePath, 'utf8'));

test('the panel carries a visible version the master can read back', () => {
  assert.match(client, /const VERSION = 'v\d+\.\d+\.\d+';/u);
  assert.match(client, /const BUILD = '[0-9.\-]+';/u);
  assert.match(client, /const VERSION_LABEL = `\$\{VERSION\} · \$\{BUILD\}`;/u);
  assert.match(client, /'settings\.version'/u);
  assert.match(client, /h\('p', \{ className: 'dm-mono' \}, VERSION_LABEL\)/u);
});

test('「开始聊」 opens the saves drawer and the old startChat path is gone', () => {
  assert.equal(client.includes('startChat'), false, 'startChat must not come back');
  const chatEntries = client.match(/openSaves\(\{ intent: 'chat'/gu) ?? [];
  assert.ok(chatEntries.length >= 3, `expected at least 3 chat entries, saw ${String(chatEntries.length)}`);
  assert.match(client, /openSaves\(\{ intent: 'room'/u);
  // Every entry stays inside the panel: no entry may close it directly.
  assert.equal(/onClick: \(\) => startChat/u.test(client), false);
});

test('a failing drawer reports itself instead of silently closing the panel', () => {
  assert.match(client, /const openSaves = \(options\) => \{[\s\S]{0,200}?try \{/u);
  assert.match(client, /t\('saves\.error\.open'/u);
  assert.match(client, /\[dsh-diary-maid\] openSaves failed/u);
  assert.match(client, /const savesSheetBody = \(\) => \{[\s\S]{0,400}?renderSavedSheetBody\(\)/u);
  assert.match(client, /t\('saves\.error\.render'/u);
});

test('the panel never registers a workspace or starts a session on mount', () => {
  assert.equal(/workspaceRegistry[^\n]*\.create\(/u.test(host), false);
  assert.equal(/registry\.create\(/u.test(host), false);
  assert.match(host, /async function lookupWorkspace\(registry\)/u);
  assert.match(host, /ctx\.inject\(\['workspaceRegistry'\]/u);
});

test('each save row has a manage entry and hard delete asks inside the drawer', () => {
  assert.match(client, /className: 'dm-saverow-more'/u);
  assert.match(client, /openSaveManage\(save\)/u);
  assert.match(client, /const renderSaveConfirm = \(\) =>/u);
  assert.match(client, /className: 'dm-overlay dm-confirm'/u);
  assert.match(client, /saves\.manage\.deleteConfirm/u);
  assert.match(client, /confirmDelete: true/u);
  assert.match(client, /hard=1/u);
  assert.match(client, /saves\.refreshSessions/u);
});

test('a room row renames through PUT /api/sessions and only reports success after it is confirmed', () => {
  const start = client.indexOf('const roomTitleOf =');
  const end = client.indexOf('const viewRoom =');
  assert.ok(start > 0 && end > start, 'room rename helpers must exist');
  const rename = client.slice(start, end);
  assert.match(client, /request\('\/sessions', \{ method: 'PUT', body: JSON\.stringify\(\{ id: current\.id, title: name \}\) \}\);/u);
  // trim to 40 characters, never send an empty name
  assert.match(rename, /replace\(\/\\s\+\/gu, ' '\)\.trim\(\)\.slice\(0, 40\)/u);
  assert.match(rename, /room\.renameEmpty/u);
  // busy guard: a second tap cannot start a second rename
  assert.match(rename, /roomRenameBusyRef\.current/u);
  // success is only claimed after GET /sessions or the client displayTitle agrees
  assert.match(rename, /fresh = await request\('\/sessions'\)/u);
  assert.match(rename, /row\.displayTitle \?\? row\.title/u);
  assert.match(rename, /roomTitleNow\(current\.id\) === name/u);
  assert.match(rename, /room\.renameUnconfirmed/u);
  assert.match(rename, /room\.renameDone/u);
  // the row keeps the entry inline
  assert.match(client, /event\.stopPropagation\(\);\s*startRoomRename\(item\);/u);
  assert.match(client, /className: 'dm-roomedit-error'/u);
});

test('room rename and save management ask inside the panel, never with native dialogs', () => {
  assert.equal(/window\.alert\s*\(/u.test(client), false, 'no native alert anywhere');
  assert.equal(/window\.prompt\s*\(/u.test(client), false, 'no native prompt anywhere');
  const rename = client.slice(client.indexOf('const startRoomRename ='), client.indexOf('const viewRoom ='));
  const saves = client.slice(client.indexOf('// ---- Session saves'), client.indexOf('const closePanel ='));
  assert.equal(/window\.confirm\s*\(/u.test(rename), false, 'room rename must not use window.confirm');
  assert.equal(/window\.confirm\s*\(/u.test(saves), false, 'save management must not use window.confirm');
  // The one remaining native confirm is the pre-existing history revert.
  assert.equal((client.match(/window\.confirm\s*\(/gu) ?? []).length, 1);
});

test('360–430px phones get overflow guards for the six tabs and the saves drawer', () => {
  const start = client.indexOf('@media (max-width:430px)');
  assert.ok(start > 0, 'the 430px breakpoint must exist');
  const narrow = client.slice(start, client.indexOf('`;', start));
  for (const selector of ['.dm-header', '.dm-body', '.dm-saverow', '.dm-manage-actions', '.dm-confirm-card', '.dm-roomrow', '.dm-prose', '.dm-toast']) {
    assert.ok(narrow.includes(selector), `${selector} needs a narrow-screen rule`);
  }
  assert.match(narrow, /\.dm-saverow\{[^}]*min-width:0/u);
  assert.match(narrow, /\.dm-manage-actions>\s*\.dm-btn\{[^}]*min-width:0/u);
  assert.match(narrow, /\.dm-confirm-card\{[^}]*overflow-y:auto/u);
  assert.match(narrow, /\.dm-roomrow-title\{[^}]*overflow-wrap:anywhere/u);
  assert.match(narrow, /\.dm-toast\{[^}]*max-width:calc\(100% - 24px\)/u);
});

test('the panel version string matches package.json', () => {
  const version = /const VERSION = 'v(\d+\.\d+\.\d+)';/u.exec(client);
  assert.ok(version !== null, 'VERSION must stay parseable');
  assert.equal(version[1], pkg.version);
});

