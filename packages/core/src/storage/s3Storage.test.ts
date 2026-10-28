import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateBucketCommand, S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createS3StorageDriver } from './s3Storage';
import { localStorageDriver } from './localStorage';
import { StorageUnavailableError } from './driver';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * S3-compatible object storage tests.
 *
 * Run against a real S3 API (moto / MinIO) when one is reachable at
 * TEST_S3_ENDPOINT; skipped otherwise so `npm test` still passes without one.
 * The local driver's tests always run.
 */

const ENDPOINT = process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:9100';
const BUCKET = 'breakglass-evidence-test';

async function probe(): Promise<boolean> {
  const client = new S3Client({
    endpoint: ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
    connectionTimeout: 1_000,
    requestTimeout: 1_500,
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    return true;
  } catch (error) {
    // Bucket already exists from a previous run is still a healthy endpoint.
    const name = (error as { name?: string }).name;
    return name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists';
  }
}

const available = await probe();

describe.skipIf(!available)('S3-compatible evidence storage', () => {
  const driver = createS3StorageDriver({
    endpoint: ENDPOINT,
    region: 'us-east-1',
    bucket: BUCKET,
    accessKeyId: 'test',
    secretAccessKey: 'test',
    forcePathStyle: true,
    prefix: 'evidence',
  });

  const client = new S3Client({
    endpoint: ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

  it('reports the bucket as reachable', async () => {
    const result = await driver.check();
    expect(result.ok).toBe(true);
  });

  it('round-trips bytes under the configured prefix', async () => {
    const key = 'workspaces/ws1/checks/c1/run1-screenshot-abc.jpg';
    const data = Buffer.from('fake-jpeg-bytes-\u0000\u0001\u0002', 'binary');
    await driver.put(key, data, 'image/jpeg');

    const fetched = await driver.get(key);
    expect(fetched.equals(data)).toBe(true);

    // Stored under the prefix, not at the bucket root.
    const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: `evidence/${key}` }));
    expect(head.ContentType).toBe('image/jpeg');
    expect(head.ContentLength).toBe(data.length);
    // Evidence is encrypted at rest and never public.
    expect(head.ServerSideEncryption).toBe('AES256');
  });

  it('errors when an object does not exist', async () => {
    await expect(driver.get('workspaces/ws1/missing.jpg')).rejects.toThrow(/download failed/i);
  });

  it('delete is idempotent', async () => {
    const key = 'workspaces/ws1/checks/c1/tmp.html';
    await driver.put(key, Buffer.from('<html></html>'), 'text/html');
    await driver.delete(key);
    await expect(driver.get(key)).rejects.toThrow();
    await expect(driver.delete(key)).resolves.toBeUndefined();
  });

  it('reports a missing bucket instead of throwing raw SDK errors', async () => {
    const broken = createS3StorageDriver({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      bucket: 'does-not-exist-bucket',
      accessKeyId: 'test',
      secretAccessKey: 'test',
      forcePathStyle: true,
      prefix: '',
    });
    const result = await broken.check();
    expect(result.ok).toBe(false);
    expect(result.detail).toBeTruthy();
  });
});

describe('local evidence storage (development fallback)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-artifacts-'));
    process.env.ARTIFACT_DIR = dir;
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes private files and reads them back', async () => {
    await localStorageDriver.put('workspaces/ws1/a.jpg', Buffer.from('bytes'), 'image/jpeg');
    expect((await localStorageDriver.get('workspaces/ws1/a.jpg')).toString()).toBe('bytes');
    const stat = await fs.stat(path.join(dir, 'workspaces/ws1/a.jpg'));
    if (process.platform !== 'win32') {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it('refuses path traversal', async () => {
    await expect(localStorageDriver.get('../../etc/passwd')).rejects.toThrow(/Invalid storage key/);
  });

  it('delete tolerates a missing file', async () => {
    await expect(localStorageDriver.delete('workspaces/ws1/nope.jpg')).resolves.toBeUndefined();
  });

  it('exposes a typed unavailable error for callers to distinguish', () => {
    const error = new StorageUnavailableError('upload failed', 's3');
    expect(error.driver).toBe('s3');
    expect(error.name).toBe('StorageUnavailableError');
  });
});
