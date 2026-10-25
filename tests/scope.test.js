import assert from 'node:assert/strict';
import test from 'node:test';
import { detectWritingScope, inWorkspace } from '../lib/scope.js';

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

const event = (type, data) => ({ type, data });
const session = (events) => ({ snapshotEvents: () => events });
const skill = (name) => event('tool/call', { name: 'skill', arguments: JSON.stringify({ name }) });

test('writing scope is read from the session log, not from prompt text', () => {
  assert.equal(detectWritingScope(session([skill('room-chat')])).mode, 'room');
  assert.equal(detectWritingScope(session([event('tool/call', { name: 'room_log' })])).mode, 'room');
  assert.equal(detectWritingScope(session([event('session/title', { title: '房间 · 随便坐坐' })])).mode, 'room');
  assert.equal(detectWritingScope(session([skill('diary-ritual')])).mode, 'study');
});

test('study evidence wins, and unreadable sessions fail safe', () => {
  // The master may load the diary ritual, wander into room talk, then say 晚安.
  const both = session([skill('room-chat'), skill('diary-ritual')]);
  assert.equal(detectWritingScope(both).mode, 'study');

  // No session / no usable events must mean "unknown", never "room".
  assert.equal(detectWritingScope(undefined).mode, 'unknown');
  assert.equal(detectWritingScope({}).mode, 'unknown');
  assert.equal(detectWritingScope({ snapshotEvents: () => { throw new Error('gone'); } }).mode, 'unknown');
  assert.equal(detectWritingScope(session([])).mode, 'unknown');
  assert.equal(detectWritingScope(session([skill('dsh-badge')])).mode, 'unknown');

  // ownEvents() is the fallback for shapes without snapshotEvents().
  const own = { ownEvents: () => [skill('room-chat')] };
  assert.equal(detectWritingScope(own).mode, 'room');

  // The live DSH shape: `seq` + `eventAt()`, as read by the host resolver.
  const live = [skill('room-chat')];
  const liveSession = { seq: live.length, eventAt: (index) => live[index] };
  assert.equal(detectWritingScope(liveSession).mode, 'room');
});
