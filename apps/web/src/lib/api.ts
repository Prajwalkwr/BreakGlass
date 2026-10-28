import type { ApiErrorBody } from '@breakglass/shared';

const BASE = '/api/v1';

export class ApiRequestError extends Error {
  status: number;
  code: string;
  details?: { path: string; message: string }[];

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body?.error?.code ?? 'unknown';
    this.details = body?.error?.details;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

/**
 * Single fetch wrapper for the whole app: sends cookies (so the httpOnly
 * session is used), always speaks JSON, and throws a typed error the UI can
 * render field-level validation from.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'breakglass-web',
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiRequestError(0, null, 'Could not reach the BreakGlass API. Check your connection and try again.');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ApiRequestError(response.status, payload as ApiErrorBody | null, 'The request failed.');
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};
