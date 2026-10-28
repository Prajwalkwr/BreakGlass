import pino from 'pino';
import { loadEnv } from '../config/env';

let instance: pino.Logger | null = null;

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'newPassword',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'headers.authorization',
  'headers.cookie',
  'config.headers',
  'payload.password',
];

export function logger(): pino.Logger {
  if (instance) return instance;
  const env = loadEnv();
  instance = pino({
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: env.NODE_ENV === 'test' ? 'test' : undefined },
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
  return instance;
}

export function childLogger(bindings: Record<string, unknown>) {
  return logger().child(bindings);
}
