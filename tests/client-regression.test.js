import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Source-level guards for task-17: these are deliberately blunt string checks,
// so a regression fails loudly in CI even though the drawer itself is React.
const clientPath = new URL('../lib/client.js', import.meta.url);
const hostPath = new URL('../lib/index.js', import.meta.url);
const client = await readFile(clientPath, 'utf8');
const host = await readFile(hostPath, 'utf8');

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
