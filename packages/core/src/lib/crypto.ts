import crypto from 'node:crypto';
import { getEncryptionKey, loadEnv } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

export interface EncryptedValue {
  /** Versioned, self-describing ciphertext: v1.<keyId>.<iv>.<tag>.<ciphertext> */
  ciphertext: string;
  keyId: string;
  /** sha256 fingerprint of the plaintext — lets us detect changes without decrypting. */
  fingerprint: string;
}

export function encryptSecret(plaintext: string): EncryptedValue {
  const key = getEncryptionKey();
  const keyId = loadEnv().ENCRYPTION_KEY_ID;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: [VERSION, keyId, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.'),
    keyId,
    fingerprint: fingerprintSecret(plaintext),
  };
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error('Malformed encrypted value');
  }
  const [, , ivB64, tagB64, dataB64] = parts;
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function fingerprintSecret(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex').slice(0, 32);
}

/** Opaque, high-entropy token for sessions / reset links. */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Tokens are stored hashed so a database leak cannot be replayed. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function randomId(prefix?: string): string {
  const id = crypto.randomBytes(12).toString('hex');
  return prefix ? `${prefix}_${id}` : id;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Masks a secret for display: never returns more than 4 trailing characters.
 */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••';
  return `••••••${value.slice(-4)}`;
}

/** Redacts likely-sensitive query parameters and header values from a URL/string before storing. */
const SENSITIVE_PATTERNS = [
  /([?&](?:token|key|api_key|apikey|secret|password|auth|access_token|signature|sig)=)[^&#\s]+/gi,
];

export function redactString(input: string, maxLength = 500): string {
  let output = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    output = output.replace(pattern, '$1[redacted]');
  }
  return output.length > maxLength ? `${output.slice(0, maxLength)}…` : output;
}

const SECRET_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
]);

export function isSensitiveHeader(name: string): boolean {
  return SECRET_HEADER_NAMES.has(name.toLowerCase());
}
