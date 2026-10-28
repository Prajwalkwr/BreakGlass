/**
 * Minimal HTTP client used by the verification scripts. It talks to the API the
 * same way the browser does (JSON + origin header + session cookie), so the
 * scripts exercise the real CSRF and auth middleware.
 */
export const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

export interface AuthedUser {
  cookie: string;
  email: string;
  password: string;
  userId: string;
  workspaceId: string;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API_URL}/api/v1${path}`, init);
}

function originHeaders(): Record<string, string> {
  return {
    origin: WEB_ORIGIN,
    'content-type': 'application/json',
    'x-requested-with': 'breakglass-web',
  };
}

export async function registerFreshUser(label: string): Promise<AuthedUser> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-${stamp}@example.com`;
  const password = 'supreme-test-password-1';

  const response = await rawFetch('/auth/register', {
    method: 'POST',
    headers: originHeaders(),
    body: JSON.stringify({ name: `${label} Runner`, email, password, workspaceName: `${label} Agency` }),
  });
  if (!response.ok) throw new Error(`register failed: ${response.status} ${await response.text()}`);

  const cookie = (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ');
  const body = (await response.json()) as { user: { id: string } };

  const me = await rawFetch('/auth/me', { headers: { ...originHeaders(), cookie } });
  const meBody = (await me.json()) as { workspaces: { id: string }[] };

  return { cookie, email, password, userId: body.user.id, workspaceId: meBody.workspaces[0].id };
}

export async function authedFetch(
  auth: AuthedUser,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; ok: boolean; body: Record<string, never> & Record<string, unknown> }> {
  const response = await rawFetch(path, {
    method,
    headers: { ...originHeaders(), cookie: auth.cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, ok: response.ok, body: parsed as never };
}
