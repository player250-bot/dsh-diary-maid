import assert from 'node:assert/strict';
import test from 'node:test';
import { inWorkspace } from '../lib/scope.js';

const roots = ['/sdcard/dsh日记', '/sdcard/dsh日记/vault'];

test('the diary skill stays inside the diary workspace', () => {
  assert.equal(inWorkspace('/sdcard/dsh日记', roots), true);
  assert.equal(inWorkspace('/sdcard/dsh日记/vault', roots), true);
  assert.equal(inWorkspace('/sdcard/dsh日记/vault/鲸汐', roots), true);
  assert.equal(inWorkspace('/sdcard/dsh日记/dsh-diary-maid', roots), true);
});

test('sibling prefixes and other workspaces do not match', () => {
  assert.equal(inWorkspace('/sdcard/dsh日记本', roots), false);
  assert.equal(inWorkspace('/sdcard/dsh日记2/vault', roots), false);
  assert.equal(inWorkspace('/root', roots), false);
  assert.equal(inWorkspace('', roots), false);
  assert.equal(inWorkspace(undefined, roots), false);
});
