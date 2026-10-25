import path from 'node:path';

/**
 * Is `cwd` the workspace root or somewhere below it?
 *
 * Used to keep the diary ritual skill inside the diary workspace: a bare
 * prefix match would let `/sdcard/dsh日记-other` pass, so the separator is
 * part of the check.
 */
export function inWorkspace(cwd, roots) {
  if (typeof cwd !== 'string' || cwd === '') return false;
  const target = path.resolve(cwd);
  return roots.some((root) => {
    const base = path.resolve(root);
    return target === base || target.startsWith(`${base}${path.sep}`);
  });
}

/** The session title 房间日志 writes after the first room log ("房间 · 副标题"). */
const ROOM_TITLE_RE = /^房间\s*·/u;
const ROOM_SKILL = 'room-chat';
const STUDY_SKILL = 'diary-ritual';

/**
 * Read the session's durable event log.
 *
 * DSH has **no** mutable "room mode" on a session: `SessionHeader` only carries
 * creation metadata (version/id/createdAt/cwd/parent/isSeeded/origin/agentPreset)
 * and is frozen at creation. What is queryable from the host is the event log:
 *  - `tool/call` events record every tool the model ran (including `skill` and
 *    `room_log`), and
 *  - `session/title` events record renames (`room_log` renames the session to
 *    "房间 · …").
 * That is the evidence this function folds; no prompt text is consulted.
 *
 * @returns {{ mode: 'room'|'study'|'unknown', reason: string }}
 */
export function detectWritingScope(session) {
  const events = sessionEvents(session);
  if (events === null) return { mode: 'unknown', reason: 'session-unavailable' };
  let roomLog = false;
  let roomSkill = false;
  let diarySkill = false;
  let title = '';
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue;
    if (event.type === 'session/title') {
      const candidate = event.data?.title;
      if (typeof candidate === 'string' && candidate !== '') title = candidate;
      continue;
    }
    if (event.type !== 'tool/call') continue;
    const name = event.data?.name;
    if (name === 'room_log') {
      roomLog = true;
      continue;
    }
    if (name !== 'skill') continue;
    const skill = skillNameFrom(event);
    if (skill === ROOM_SKILL) roomSkill = true;
    else if (skill === STUDY_SKILL) diarySkill = true;
  }
  // Study evidence wins: the 主人 may have loaded the diary ritual earlier and
  // then wandered into room talk; refusing a diary write there is the failure we
  // must never cause.
  if (diarySkill) return { mode: 'study', reason: 'diary-ritual loaded' };
  if (roomLog) return { mode: 'room', reason: 'room_log called' };
  if (roomSkill) return { mode: 'room', reason: 'room-chat loaded' };
  if (title !== '' && ROOM_TITLE_RE.test(title)) return { mode: 'room', reason: 'room title' };
  return { mode: 'unknown', reason: events.length === 0 ? 'empty session' : 'no room/study evidence' };
}

/** The session's durable events, or null when this object cannot answer. */
function sessionEvents(session) {
  if (session === null || typeof session !== 'object') return null;
  // Real DSH Sessions expose `eventAt(seq)`/`seq`; read the log without calling
  // the deprecated snapshot helpers. Test doubles may answer with an array.
  if (typeof session.eventAt === 'function' && Number.isInteger(session.seq) && session.seq >= 0) {
    const events = [];
    for (let index = 0; index < session.seq; index += 1) {
      const event = session.eventAt(index);
      if (event !== undefined) events.push(event);
    }
    return events;
  }
  for (const method of ['snapshotEvents', 'ownEvents']) {
    if (typeof session[method] !== 'function') continue;
    try {
      const events = session[method]();
      return Array.isArray(events) ? events : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** The `name` argument of a `skill` tool call, tolerating raw JSON/text args. */
function skillNameFrom(event) {
  const data = event.data;
  if (data === null || typeof data !== 'object') return '';
  let args = data.arguments;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return '';
    }
  }
  if (args === null || typeof args !== 'object') return '';
  return typeof args.name === 'string' ? args.name : '';
}
