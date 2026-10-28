import crypto from 'node:crypto';
import { getEncryptionKey, loadEnv } from '../config/env';
import { Artifact } from '../models/infra';
import { logger } from '../lib/logger';
import { notFound } from '../lib/errors';
import { getStorage } from '../storage';
import type { ArtifactPayload } from '../monitoring/types';
import type { Types } from 'mongoose';

const ARTIFACT_TTL_MINUTES = 10;

/**
 * Evidence artifacts are written to private storage — the local filesystem
 * during development, private S3-compatible object storage (AWS S3, MinIO,
 * R2, Spaces) whenever it is configured. Nothing is ever exposed through a
 * public path: reads require an authenticated session, workspace membership
 * *and* a short-lived signature, and the API proxies the bytes.
 */
export async function saveArtifacts(params: {
  workspaceId: Types.ObjectId | string;
  projectId: Types.ObjectId | string;
  checkId: Types.ObjectId | string;
  runId: string;
  artifacts: ArtifactPayload[];
}): Promise<{ artifactId: string; kind: 'screenshot' | 'trace' | 'html'; bytes: number }[]> {
  if (!params.artifacts.length) return [];
  const env = loadEnv();
  const storage = getStorage();
  const retentionDays = env.RETENTION_DAYS_ARTIFACTS;
  const expiresAt = new Date(Date.now() + retentionDays * 86_400_000);
  const saved: { artifactId: string; kind: 'screenshot' | 'trace' | 'html'; bytes: number }[] = [];

  for (const artifact of params.artifacts) {
    const extension = artifact.kind === 'screenshot' ? 'jpg' : artifact.kind === 'trace' ? 'zip' : 'html';
    const key = [
      'workspaces',
      safeSegment(String(params.workspaceId)),
      'checks',
      safeSegment(String(params.checkId)),
      `${safeSegment(params.runId)}-${artifact.kind}-${crypto.randomBytes(4).toString('hex')}.${extension}`,
    ].join('/');

    await storage.put(key, artifact.data, artifact.contentType);

    const doc = await Artifact.create({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      checkId: params.checkId,
      runId: params.runId,
      kind: artifact.kind,
      storage: storage.name,
      storageKey: key,
      contentType: artifact.contentType,
      bytes: artifact.data.length,
      checksum: crypto.createHash('sha256').update(artifact.data).digest('hex'),
      expiresAt,
    });

    saved.push({ artifactId: String(doc._id), kind: artifact.kind, bytes: artifact.data.length });
  }

  return saved;
}

function signingKey(): Buffer {
  // Derived from the deployment encryption key so no extra secret is required.
  return crypto.createHmac('sha256', getEncryptionKey()).update('breakglass-artifact-url').digest();
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function signArtifactUrl(artifactId: string, ttlMinutes = ARTIFACT_TTL_MINUTES): { url: string; expiresAt: string } {
  const expires = Math.floor(Date.now() / 1000) + ttlMinutes * 60;
  const signature = crypto
    .createHmac('sha256', signingKey())
    .update(`${artifactId}:${expires}`)
    .digest('base64url');
  return {
    url: `/api/v1/artifacts/${artifactId}?exp=${expires}&sig=${signature}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

export function verifyArtifactSignature(artifactId: string, expires: string, signature: string): boolean {
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;
  const expected = crypto
    .createHmac('sha256', signingKey())
    .update(`${artifactId}:${expiresAt}`)
    .digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function readArtifact(artifactId: string, workspaceId: string) {
  const artifact = await Artifact.findById(artifactId);
  if (!artifact) throw notFound('Artifact not found.');
  // Tenant isolation: the artifact must belong to the caller's workspace.
  if (String(artifact.workspaceId) !== String(workspaceId)) throw notFound('Artifact not found.');
  if (artifact.expiresAt.getTime() < Date.now()) throw notFound('This evidence has expired and was deleted.');

  const storage = getStorage();
  let data: Buffer;
  try {
    data = await storage.get(artifact.storageKey);
  } catch (error) {
    logger().warn(
      { err: (error as Error).message, artifactId, driver: storage.name },
      'Stored evidence could not be read',
    );
    throw notFound('The stored evidence file is no longer available.');
  }
  return { artifact, data };
}

/**
 * Retention janitor: deletes expired artifacts and their bytes.
 *
 * A storage error on one object leaves that record in place (and therefore
 * retried on the next maintenance pass) instead of orphaning bytes.
 */
export async function purgeExpiredArtifacts(): Promise<number> {
  const expired = await Artifact.find({ expiresAt: { $lt: new Date() } }).limit(500);
  const storage = getStorage();
  let removed = 0;
  let failed = 0;
  for (const artifact of expired) {
    try {
      await storage.delete(artifact.storageKey);
    } catch (error) {
      failed += 1;
      logger().warn(
        { err: (error as Error).message, artifactId: String(artifact._id) },
        'Could not delete expired evidence; will retry',
      );
      continue;
    }
    await Artifact.deleteOne({ _id: artifact._id });
    removed += 1;
  }
  if (removed || failed) logger().info({ removed, failed }, 'Purged expired evidence artifacts');
  return removed;
}

/** Health probe for the configured storage driver. */
export async function checkArtifactStorage(): Promise<{ driver: string; ok: boolean; detail: string }> {
  const storage = getStorage();
  const result = await storage.check();
  return { driver: storage.name, ...result };
}
