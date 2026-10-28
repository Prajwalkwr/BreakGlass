# Operations

## Processes

| Process | Command | Scales by |
| --- | --- | --- |
| API | `npm run start -w @breakglass/api` | adding instances behind a load balancer (stateless; sessions in Mongo) |
| Worker (also runs the scheduler) | `npm run start:worker` | increasing `WORKER_CONCURRENCY` or adding worker processes |
| Web | `npm run build -w @breakglass/web` → serve `apps/web/dist` | CDN / static hosting |

The worker is also the scheduler. A single scheduler tick is atomic, so running several
workers is safe — they will not enqueue the same run twice.

## Environment checklist for production

1. `NODE_ENV=production`
2. `MONGODB_URI` pointing at a replicated MongoDB
3. `ENCRYPTION_KEY` (32 random bytes, base64) and a stable `ENCRYPTION_KEY_ID`. Without it,
   the app refuses to start in production rather than falling back to a dev key.
4. `APP_ORIGIN` = the public web origin, `API_ORIGIN` = the public API origin,
   `ALLOWED_ORIGINS` for any extra origins. Cookies are `Secure`, so both must be HTTPS.
5. `ARTIFACT_DIR` = an **absolute** path on a volume shared by the API and the worker.
   The API signs URLs for files the worker wrote; a per-container relative path breaks that.
6. `EMAIL_PROVIDER=resend` + `RESEND_API_KEY`, or `EMAIL_PROVIDER=smtp` + `SMTP_*`.
   Verify a destination from Settings → Alerts (the "send test" button) before relying on it.
7. `ALLOW_PRIVATE_TARGETS` unset/false.
8. `npm run build` then run the compiled output.

## Health

`GET /api/v1/health` (no auth) returns:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "database": "connected",
  "queue": { "driver": "mongo", "workersOnline": 1, "pendingJobs": 0 },
  "email": "smtp",
  "overdueChecks": 0,
  "timestamp": "…"
}
```

- `status` is `ok` only when the database is connected **and** at least one worker heartbeat
  is fresh; otherwise the response is `degraded` and HTTP **503** — point your own monitor at
  this endpoint so BreakGlass does not fail silently.
- `/api/v1/health/live` — process liveness (for Kubernetes-style probes).
- `/api/v1/health/ready` — readiness including database.
- `overdueChecks` counts enabled checks whose `nextRunAt` is more than a couple of minutes
  in the past; a rising number means the worker is not keeping up.

## Email providers

**Resend** — set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and a verified `EMAIL_FROM`
domain. Failures return the provider's message and are recorded on the delivery.

**SMTP** — set `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_SECURE`. Auth is only attempted when `SMTP_USER` is set, so an unauthenticated relay
(including the local dev sink) works.

**Development outbox** — `EMAIL_PROVIDER=none` writes each message to
`.data/outbox/*.html` and marks the delivery `development_outbox`. The dashboard shows a
banner saying alerts are not configured, and the email body itself says no real mailbox was
contacted. Do not ship this to users.

Every delivery attempt is stored in `notificationdeliveries` (status, provider, attempts,
error, timestamps) and shown on the incident page, so "did the alert go out?" is auditable.

## Backups

- **MongoDB** is the system of record: `mongodump` on a schedule, restore with `mongorestore`.
- **`ARTIFACT_DIR`** holds screenshots/traces: snapshot the volume or sync it to object
  storage. Artifacts are referenced by id from MongoDB, so a database-only restore leaves
  broken evidence links (the API returns 404 rather than failing).
- Keep `ENCRYPTION_KEY` in your secret manager. **Losing it makes every stored credential
  unrecoverable** — checks using them will fail with a clear "credential could not be read"
  error until they are rotated.

## Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| `/health` returns 503 with `database: disconnected` | MongoDB unreachable | connection string, network policy, `api.log` |
| `workersOnline: 0` | worker not running or crashed | worker logs; heartbeats collection TTL is short by design |
| Checks show `blocked_destination` | SSRF policy refused the target | is it private/loopback/metadata? production always blocks those |
| Checks show `browser_runtime_error` | Chromium missing in the worker image | `playwright install --with-deps chromium` in the worker build |
| Checks show `auth_failure` | the test account was rejected | rotate the stored credential; this is deliberately not treated as an outage |
| Alerts not arriving | provider not configured or destination disabled | Settings → Alerts, delivery records on the incident |
| Evidence URLs 404 | `ARTIFACT_DIR` differs between API and worker | set an absolute shared path |
| `overdueChecks` climbing | worker saturated (browser checks are heavy) | raise `WORKER_CONCURRENCY`, lower `BROWSER_CONCURRENCY`, or spread checks out |
| Webhook 409 | no secret configured for the project | configure the GitHub integration again |

## Deploying the browser runner

Playwright needs system libraries. In a container image:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
# copy the repo, npm ci, npm run build, then:
CMD ["node", "apps/worker/dist/index.js"]
```

Use the matching Playwright image tag for your installed version, otherwise Chromium will
fail to launch (`browser_runtime_error`).

## Local scripts

| Script | Purpose |
| --- | --- |
| `scripts/local-mongo.mjs` | persistent in-process MongoDB on :27017 (`.data/db`) |
| `scripts/demo-target.mjs` | three fake client sites on :9910, switchable via `/__demo/mode` |
| `scripts/dev-mail-sink.mjs` | SMTP sink on :1025 writing `.data/outbox-smtp` |
| `scripts/seed-demo.ts` | rebuild the demo workspace through the real pipeline |
| `scripts/capture-shots.ts` | capture marketing screenshots from the running app |
| `scripts/restart-stack.sh` | restart API + worker using pid files (never pattern matching) |
| `scripts/verify-*.ts` | the verification suites listed in the README |

`scripts/restart-stack.sh` starts each service in its own session so the whole process group
is signalled — important because `tsx` spawns a child process.
