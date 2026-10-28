export type ErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unsafe_target'
  | 'internal_error'
  | 'service_unavailable'
  | 'payload_too_large';

export class AppError extends Error {
  statusCode: number;
  code: ErrorCode;
  details?: { path: string; message: string }[];

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toBody() {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

export const badRequest = (message: string, details?: { path: string; message: string }[]) =>
  new AppError(400, 'invalid_input', message, details);
export const unauthorized = (message = 'You need to sign in to continue.') =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that.') =>
  new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const rateLimited = (message = 'Too many requests. Please try again shortly.') =>
  new AppError(429, 'rate_limited', message);
export const unsafeTarget = (message: string) => new AppError(422, 'unsafe_target', message);
export const serviceUnavailable = (message: string) => new AppError(503, 'service_unavailable', message);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
