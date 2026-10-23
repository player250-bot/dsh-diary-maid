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
