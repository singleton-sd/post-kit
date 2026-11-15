import path from 'node:path';

/** True when `fsPath` resolves inside `root` (rejects sibling prefix escapes). */
export function isPathInsideRoot(root, fsPath) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(fsPath);
  const rel = path.relative(resolvedRoot, resolvedPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
