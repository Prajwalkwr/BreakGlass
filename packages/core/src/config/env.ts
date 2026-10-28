import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveDataPath } from '../lib/paths';
import { z } from 'zod';
import dotenv from 'dotenv';

/**
 * Loads `.env` from the working directory and its parents (so both the API and
 * the worker pick up the repository-level file regardless of which workspace
 * npm runs them from). Real environment variables always win.
 */
let dotenvLoaded = false;
function loadDotEnvFiles(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  const candidates: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 3; i += 1) {
    candidates.push(path.join(dir, '.env'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const file of candidates.reverse()) {
    if (fs.existsSync(file)) dotenv.config({ path: file });
  }
}

/* ------------------------------------------------------------------ */
/* Environment schema                                                  */
/* ------------------------------------------------------------------ */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_ORIGIN: z.string().default('http://localhost:4000'),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  ALLOWED_ORIGINS: z.string().optional(),

  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/breakglass'),

  /** Base64-encoded 32-byte key for AES-256-GCM secret encryption. */
  ENCRYPTION_KEY: z.string().optional(),
  ENCRYPTION_KEY_ID: z.string().default('k1'),

  SESSION_COOKIE_NAME: z.string().default('bg_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(14),

  /**
   * Queue backend. `auto` uses Redis when REDIS_URL is present, otherwise the
   * bundled MongoDB queue. Set explicitly in production so the choice is not
   * an accident of environment.
   */
  QUEUE_DRIVER: z.enum(['auto', 'mongo', 'redis']).default('auto'),
  REDIS_URL: z.string().optional(),

  EMAIL_PROVIDER: z.enum(['none', 'resend', 'smtp']).default('none'),
  EMAIL_FROM: z.string().default('BreakGlass <alerts@breakglass.local>'),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: booleanish.default(false),

  /**
   * Evidence storage. `auto` uses S3 when a bucket and credentials are
   * present, otherwise the local filesystem (development only).
   */
  STORAGE_DRIVER: z.enum(['auto', 'local', 's3']).default('auto'),
  ARTIFACT_DIR: z.string().default('.data/artifacts'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Path-style addressing: required by MinIO, optional on R2/Spaces. */
  S3_FORCE_PATH_STYLE: booleanish.default(false),
  S3_PREFIX: z.string().default(''),

  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  BROWSER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).max(300000).default(15000),
  RUN_INLINE_WORKER: booleanish.default(false),

  ALLOW_PRIVATE_TARGETS: booleanish.default(false),
  MONITOR_USER_AGENT: z.string().default('BreakGlass-Monitor/1.0 (+https://breakglass.app/bot)'),

  RETENTION_DAYS_RUNS: z.coerce.number().int().min(1).max(3650).default(30),
  RETENTION_DAYS_ARTIFACTS: z.coerce.number().int().min(1).max(3650).default(14),

  DEV_SEED: booleanish.default(false),
});

export type Env = z.infer<typeof envSchema>;

function loadEncryptionKey(raw: string | undefined, nodeEnv: string): { key: Buffer; generated: boolean } {
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error(
        'ENCRYPTION_KEY must be a base64-encoded 32-byte key. Generate one with: openssl rand -base64 32',
      );
    }
    return { key, generated: false };
  }

  if (nodeEnv === 'production') {
    throw new Error('ENCRYPTION_KEY is required in production.');
  }

  // Development/test only: keep a stable local key so sessions and encrypted
  // credentials survive restarts. This file is git-ignored and never used in
  // production (production requires an explicit ENCRYPTION_KEY).
  const dir = resolveDataPath('.data');
  const file = path.join(dir, 'dev-encryption.key');
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) {
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length === 32) return { key, generated: true };
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return { key, generated: true };
}

let cached: Env | null = null;
let cachedKey: { key: Buffer; generated: boolean } | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  loadDotEnvFiles();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  cachedKey = loadEncryptionKey(cached.ENCRYPTION_KEY, cached.NODE_ENV);

  if (cachedKey.generated && cached.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.warn(
      '[breakglass] ENCRYPTION_KEY not set — using a local development key from .data/dev-encryption.key. Never use this in production.',
    );
  }
  return cached;
}

export function getEncryptionKey(): Buffer {
  loadEnv();
  if (!cachedKey) throw new Error('Encryption key not initialised');
  return cachedKey.key;
}

export function allowedOrigins(env: Env = loadEnv()): string[] {
  const list = new Set<string>([env.APP_ORIGIN, env.API_ORIGIN]);
  if (env.ALLOWED_ORIGINS) {
    for (const origin of env.ALLOWED_ORIGINS.split(',')) {
      const trimmed = origin.trim();
      if (trimmed) list.add(trimmed);
    }
  }
  return [...list];
}

export function isProduction(env: Env = loadEnv()): boolean {
  return env.NODE_ENV === 'production';
}

export function emailIsConfigured(env: Env = loadEnv()): boolean {
  if (env.EMAIL_PROVIDER === 'resend') return Boolean(env.RESEND_API_KEY);
  if (env.EMAIL_PROVIDER === 'smtp') return Boolean(env.SMTP_HOST && env.SMTP_PORT);
  return false;
}

/** For tests: reset memoised env between suites. */
export function resetEnvCache(): void {
  cached = null;
  cachedKey = null;
}
