import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { StorageDriver } from './driver';

export interface S3StorageConfig {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO and most self-hosted gateways need path-style addressing. */
  forcePathStyle: boolean;
  /** Optional key prefix, so one bucket can be shared between environments. */
  prefix: string;
}

let client: S3Client | null = null;
let clientFor = '';

function getClient(config: S3StorageConfig): S3Client {
  const fingerprint = `${config.endpoint}|${config.region}|${config.accessKeyId}|${config.forcePathStyle}`;
  if (client && clientFor === fingerprint) return client;
  client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Evidence uploads are small screenshots/traces; fail fast rather than hang
    // a worker for the SDK default of 3 attempts over several minutes.
    maxAttempts: 2,
    requestHandler: { requestTimeout: 15_000, connectionTimeout: 5_000 },
  });
  clientFor = fingerprint;
  return client;
}

function toApiError(error: unknown, operation: string): Error {
  const name = (error as { name?: string })?.name ?? 'UnknownError';
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Object storage ${operation} failed (${name}): ${message}`);
}

/**
 * Private S3-compatible object storage (AWS S3, MinIO, Cloudflare R2,
 * DigitalOcean Spaces, Backblaze B2 S3 API).
 *
 * Objects are written with server-side encryption and never with a public
 * ACL; reads are proxied by the API so tenant checks cannot be bypassed by
 * sharing a URL.
 */
export function createS3StorageDriver(config: S3StorageConfig): StorageDriver {
  const s3 = () => getClient(config);
  const withPrefix = (key: string) => (config.prefix ? `${config.prefix.replace(/\/+$/, '')}/${key}` : key);

  return {
    name: 's3',

    async put(key, data, contentType) {
      try {
        await s3().send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: withPrefix(key),
            Body: data,
            ContentType: contentType,
            ServerSideEncryption: 'AES256',
            // Explicitly never public-read: evidence is tenant data.
            ACL: 'private',
          }),
        );
      } catch (error) {
        throw toApiError(error, 'upload');
      }
    },

    async get(key) {
      try {
        const result = await s3().send(new GetObjectCommand({ Bucket: config.bucket, Key: withPrefix(key) }));
        if (!result.Body) throw new Error('empty body');
        return Buffer.from(await result.Body.transformToByteArray());
      } catch (error) {
        throw toApiError(error, 'download');
      }
    },

    async delete(key) {
      // S3 DeleteObject is already idempotent; only log-worthy failures throw.
      try {
        await s3().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: withPrefix(key) }));
      } catch (error) {
        throw toApiError(error, 'delete');
      }
    },

    async check() {
      try {
        await s3().send(new HeadBucketCommand({ Bucket: config.bucket }));
        return { ok: true, detail: `${config.bucket}${config.endpoint ? ` at ${config.endpoint}` : ''}` };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'unreachable' };
      }
    },
  };
}
