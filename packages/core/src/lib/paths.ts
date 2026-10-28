import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves local data directories (artifacts, development outbox, dev keys).
 *
 * The API and the worker are separate processes and are usually started from
 * different working directories (`apps/api`, `apps/worker`), so resolving
 * `.data` against `process.cwd()` silently splits evidence storage in two —
 * the worker writes a screenshot that the API then cannot read.
 *
 * Resolution order:
 *   1. an absolute path from the environment, used verbatim;
 *   2. a relative path resolved against the repository root;
 *   3. `process.cwd()` when no repository root can be found.
 *
 * In production set an absolute path (or mount object storage) so both
 * processes share one location — see docs/OPERATIONS.md.
 */
let cachedRoot: string | null = null;

export function repositoryRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = path.join(current, 'package.json');
    try {
      const contents = fs.readFileSync(manifest, 'utf8');
      if (contents.includes('"workspaces"')) return current;
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir);
}

export function projectRoot(): string {
  if (!cachedRoot) cachedRoot = repositoryRoot();
  return cachedRoot;
}

/** Resolves a configured data path (absolute, or relative to the repo root). */
export function resolveDataPath(configured: string): string {
  if (path.isAbsolute(configured)) return configured;
  return path.resolve(projectRoot(), configured);
}

export function dataDir(): string {
  return resolveDataPath('.data');
}
