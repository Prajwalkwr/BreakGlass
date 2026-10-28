import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveDataPath } from '../lib/paths';
import type { StorageDriver } from './driver';

function root(): string {
  // Anchored to the repository root (not cwd) so the API and the worker read
  // and write the same directory.
  return resolveDataPath(process.env.ARTIFACT_DIR ?? '.data/artifacts');
}

/**
 * Development / single-host fallback: files on a private directory with mode
 * 0600. Not suitable for a multi-host deployment (a worker on another machine
 * cannot see this volume) — use the S3 driver there.
 */
export const localStorageDriver: StorageDriver = {
  name: 'local',

  async put(key, data) {
    const fullPath = path.resolve(root(), key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data, { mode: 0o600 });
  },

  async get(key) {
    const fullPath = path.resolve(root(), key);
    // Defend against path traversal from a corrupted record.
    if (!fullPath.startsWith(root() + path.sep)) throw new Error('Invalid storage key.');
    return fs.readFile(fullPath);
  },

  async delete(key) {
    const fullPath = path.resolve(root(), key);
    if (!fullPath.startsWith(root() + path.sep)) return;
    await fs.unlink(fullPath).catch(() => undefined);
  },

  async check() {
    const probe = path.join(root(), `.healthcheck-${crypto.randomBytes(4).toString('hex')}`);
    try {
      await fs.mkdir(root(), { recursive: true });
      await fs.writeFile(probe, 'ok', { mode: 0o600 });
      await fs.unlink(probe);
      return { ok: true, detail: root() };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'unwritable' };
    }
  },
};
