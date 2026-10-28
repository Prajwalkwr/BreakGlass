/**
 * Evidence storage contract.
 *
 * Evidence (screenshots, Playwright traces, captured HTML) is private data.
 * Whichever driver is configured, the object is never publicly readable: the
 * API authenticates the caller, checks workspace membership, then streams the
 * bytes itself. Drivers therefore only implement raw byte movement.
 */
export interface StorageDriver {
  readonly name: 'local' | 's3';

  /** Writes bytes and returns the storage key to persist on the artifact. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;

  /** Reads bytes for an existing key. Throws when the object is missing. */
  get(key: string): Promise<Buffer>;

  /** Deletes an object. Must be idempotent: missing objects are not an error. */
  delete(key: string): Promise<void>;

  /** Best-effort connectivity probe used by health checks and startup logs. */
  check(): Promise<{ ok: boolean; detail: string }>;
}

export class StorageUnavailableError extends Error {
  constructor(message: string, readonly driver: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}
