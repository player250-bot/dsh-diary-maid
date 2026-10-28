import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const HASH_RE = /^[0-9a-f]{7,40}$/;

/** Run one git command in `root`; resolves stdout, rejects with stderr. */
function run(root, args, input) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error((err || `git ${args[0]} exited ${code}`).trim()));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

/**
 * A tiny append-only git driver for the diary vault.
 *
 * Every mutation goes through one serial queue, so a save and a revert can
 * never interleave. History is only ever added to: a "revert" writes the old
 * text and commits it, it never rewrites or resets existing commits.
 */
export class Git {
  constructor(root, enabled) {
    this.root = root;
    this.enabled = enabled !== false;
    this.available = false;
    this.repo = false;
    this.queue = Promise.resolve();
  }

  enqueue(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async ensure() {
    if (!this.enabled) return false;
    await fs.mkdir(this.root, { recursive: true });
    try {
      await run(this.root, ['--version']);
    } catch {
      this.available = false;
      return false;
    }
    this.available = true;
    try {
      await fs.access(path.join(this.root, '.git'));
    } catch {
      await run(this.root, ['init', '-b', 'main']);
      await run(this.root, ['config', 'user.name', '鲸汐']);
      await run(this.root, ['config', 'user.email', 'jingxi@local']);
    }
    this.repo = true;
    return true;
  }

  /** Commit everything inside the vault; resolves the new hash or null when clean. */
  commit(message) {
    return this.enqueue(async () => {
      if (!this.repo) return null;
      const status = await run(this.root, ['status', '--porcelain']);
      if (status.trim() === '') return null;
      await run(this.root, ['add', '-A']);
      await run(this.root, ['commit', '-m', message]);
      return (await run(this.root, ['rev-parse', 'HEAD'])).trim();
    });
  }

  /** Newest-first commits touching one relative file. */
  async log(file, limit = 30) {
    if (!this.repo) return [];
    const out = await run(this.root, [
      'log', `-n${String(limit)}`, '--format=%H%x1f%aI%x1f%s', '--', file,
    ]);
    return out.split('\n').filter(Boolean).map((line) => {
      const [hash, at, subject] = line.split('\x1f');
      return { hash, at, subject };
    });
  }

  /** The exact text of one file at one commit. */
  async show(hash, file) {
    if (!this.repo) throw new Error('日记本还没有 git 仓库');
    if (!HASH_RE.test(hash)) throw new Error('无效的版本号');
    return run(this.root, ['show', `${hash}:${file}`]);
  }

  async branch() {
    if (!this.repo) return null;
    try {
      return (await run(this.root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    } catch {
      return null;
    }
  }

  async remote() {
    if (!this.repo) return null;
    try {
      const out = (await run(this.root, ['remote', 'get-url', 'origin'])).trim();
      return out || null;
    } catch {
      return null;
    }
  }

  async dirty() {
    if (!this.repo) return false;
    try {
      return (await run(this.root, ['status', '--porcelain'])).trim() !== '';
    } catch {
      return false;
    }
  }
}
