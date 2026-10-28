# Security model

This document describes what the code actually enforces. Where something is a residual
risk, it is listed as one.

## Authentication and sessions

- Passwords are hashed with bcrypt (cost 12). Nothing is stored in `localStorage`; the
  session lives in an opaque random token in an **httpOnly, SameSite=Lax cookie**
  (`bg_session`), `Secure` when `NODE_ENV=production`.
- Only a SHA-256 hash of the token is stored in `sessions`, so a database read cannot be
  replayed as a session.
- Sessions have a TTL and are revoked on logout, on password change (all other sessions),
  and by an explicit "revoke all" action. `PATCH /auth/account` and
  `POST /auth/change-password` re-authenticate with the current password.
- Login and forgot-password return the **same** response for unknown accounts, and
  forgot-password always returns 200 — no account enumeration.
- Email verification and password reset tokens are random, stored hashed, single-use and
  time-limited; reusing one returns 400.

## CSRF

The API is cookie-authenticated, so state-changing requests must satisfy `csrfProtection`:

1. an `Origin` (or `Referer`) header must be present and match the configured
   `APP_ORIGIN` / `API_ORIGIN` / `ALLOWED_ORIGINS`, or the request `Host` for same-origin
   calls, or be loopback in non-production;
2. if the request carries a body, the content type must be JSON (multipart allowed for
   uploads). Cross-site HTML forms cannot produce JSON, so they cannot forge writes;
3. CORS only emits headers for allowed origins — and for disallowed origins it returns no
   headers at all rather than an error, so the browser blocks the response.

Webhook routes are mounted **before** the JSON parser and outside CSRF; they authenticate
with an HMAC signature instead.

## SSRF

Monitoring makes the server fetch arbitrary user-supplied URLs, so the policy is layered:

1. **At write time** (`createProject`, `createCheck`) the URL is structurally validated
   (http/https, no credentials in the URL, no non-standard ports) and DNS-resolved; every
   resolved address is checked against the block list. A rejected target returns 400
   immediately rather than becoming a check that fails forever.
2. **At run time** every hop is validated again — a DNS record that changes after the check
   was saved is re-evaluated, and redirects are followed manually so each `Location` is
   validated before it is fetched.
3. **At socket time** the HTTP client uses a pinned `lookup` callback plus an
   `assertConnectedSocketAllowed` check on the connected peer, which defeats DNS rebinding
   (resolve → validate → connect-to-something-else).
4. **Blocked ranges**: loopback, private (10/8, 172.16/12, 192.168/16), link-local
   (169.254/16), CGNAT (100.64/10), benchmarking, multicast, reserved, IPv6 ULA/link-local,
   IPv4-mapped IPv6 forms of all of the above, and cloud metadata endpoints
   (169.254.169.254, `metadata.google.internal`, `100.100.100.200`, …) which are blocked
   **even when** private targets are enabled for local development.
5. Browser checks apply the same address policy to navigations and subresources, and refuse
   non-http(s) schemes.

`ALLOW_PRIVATE_TARGETS=true` exists so the demo/verification scripts can monitor
`127.0.0.1`. It is ignored when `NODE_ENV=production`, and metadata endpoints stay blocked.

## Credentials

- Test credentials (API headers, browser login values, Slack webhook URLs, GitHub webhook
  secrets) are encrypted with **AES-256-GCM** before insert, with a key id for rotation.
  The envelope is `v1.<keyId>.<iv>.<tag>.<ciphertext>`.
- Secrets are decrypted only inside the worker at execution time, resolved by workspace and
  project, and are never returned by any API response — the API returns `secretRef` handles
  and a `sensitive: true` flag instead. `verify:integrations` and `verify:browser` both
  assert this.
- Logs redact `authorization`, `cookie`, `set-cookie`, passwords, tokens and secret values
  (Pino redaction paths), and evidence snapshots store request headers by allow-list.

## Artifacts

Failure screenshots and traces are private files. They are served only through signed URLs
(HMAC over artefact id + expiry, 1-hour TTL), scoped to workspace membership, with
`Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. A tampered
signature returns 403; a valid signature without a session returns 401.

## Webhooks

GitHub deliveries are verified with `x-hub-signature-256` (HMAC-SHA256 over the raw body,
timing-safe compare), keyed on a per-project secret stored encrypted. Deliveries are
deduplicated by `x-github-delivery` (unique index) and branch deletions (all-zero SHA) are
ignored. A delivery is only ever used as *timing context* for an incident — never as a
cause.

## Tenancy

Every route resolves the workspace from the path, checks membership server-side
(`requireWorkspace`), and then scopes the query by that workspace id. Cross-workspace reads
return 404 rather than 403 so the existence of another tenant's records is not disclosed.
The API test suite and `npm run smoke` both assert cross-tenant access is refused for
projects, checks, incidents, runs and artifacts.

## Abuse and load

- Rate limits: auth endpoints (brute force), password reset (stricter), heavy endpoints
  that launch browsers or outbound requests (per user), and a general API limit.
- Every check has a timeout (3–60s), a response size cap, a redirect cap and a run lock, so
  a slow or hostile target cannot wedge the worker.
- Fixed plan limits: 25 projects, 100 active checks, 25 browser checks per workspace,
  100 checks per project. The optional public page scan is limited to 50 same-origin pages,
  uses at most five concurrent HTTP requests, caps each response at 256 KB, and does not
  follow redirects while discovering links. Its browser pass records only page control
  counts and same-origin fetch/XHR method, path, and status; it never clicks or submits
  forms and stores neither query strings nor request/response bodies.

## Residual risks (known)

- **No email verification enforcement**: unverified accounts can use the product.
- **Rate limiting is per process**, not distributed; behind multiple API instances it is
  approximate.
- **Single shared encryption key** unless you rotate with a new `ENCRYPTION_KEY_ID`;
  stored ciphertext is versioned so rotation is possible, but no re-encryption tool ships.
- **Artifact storage is a local directory**, not object storage; disk access is the
  security boundary. Put it on an encrypted volume and back it up.
- **No 2FA**, no enterprise SSO/RBAC matrix (owner/member only).
- **The dev mail sink and demo target** (`scripts/`) are development tools with no auth.
  Never deploy them.
