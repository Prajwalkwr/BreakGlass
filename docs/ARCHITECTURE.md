# Architecture

BreakGlass is three processes over one MongoDB database and one private artifact
directory. Nothing about monitoring happens in the browser.

```
                    ┌──────────────────────────┐
   browser ────────►│  apps/web (React SPA)    │  :5173 dev / static in production
                    └────────────┬─────────────┘
                                 │ /api/v1 (JSON, session cookie)
                    ┌────────────▼─────────────┐        ┌──────────────────┐
                    │  apps/api (Express)      │◄──────►│      MongoDB     │
                    │  routes, auth, tenancy   │        │  system of record│
                    └────────────┬─────────────┘        └────────▲─────────┘
                                 │ durable queue (same DB)       │
                    ┌────────────▼─────────────┐                 │
                    │  apps/worker             │─────────────────┘
                    │  scheduler + executors   │──► outbound HTTP / Playwright
                    │  + notification sender   │──► SMTP · Resend · Slack webhook
                    └────────────┬─────────────┘
                                 └──► .data/artifacts (private screenshots/traces)
```

## Packages

| Path | Responsibility |
| --- | --- |
| `packages/shared` | Contracts shared by API and web: Zod request schemas, check configuration schemas, DTO types, enums, plan limits |
| `packages/core` | Domain layer: Mongoose models, services (auth, projects, checks, incidents, notifications, deployments, artifacts, stats), monitoring executors, SSRF policy, queue and scheduler |
| `apps/api` | HTTP surface only: routing, validation, session attachment, CSRF/CORS, error mapping |
| `apps/worker` | Scheduler tick, job consumers (check runs, notification delivery, maintenance), graceful shutdown |
| `apps/web` | Marketing site + authenticated dashboard |
| `scripts/` | Verification and demo tooling (smoke, UI, browser, integrations, marketing, seeding) |

Keeping domain logic in `packages/core` is what makes "the worker runs the check" true:
the API never executes a check inline, and the worker never trusts a caller-supplied
workspace id.

When a project is added, the API performs a bounded public-page scan: it follows
same-origin HTML links only, scans at most 50 pages, and creates staggered HTTP checks
with a 30-minute interval. The browser pass also inventories visible forms, fields,
buttons, runtime errors, and same-origin fetch/XHR calls without clicking or submitting.
It stores endpoint paths without query strings or request data. This inventory is a
one-time observation, not a behavioral test or recurring alert; recurring checks and
incident state are handled by the normal worker pipeline.

## Data model

| Collection | Purpose | Notable constraints |
| --- | --- | --- |
| `users` | Account, password hash, verification state | unique `normalizedEmail` |
| `sessions` | Server-side sessions | token stored hashed, TTL index, revoked on logout/password change |
| `tokens` | Email verification + password reset | hashed, single use, TTL |
| `workspaces`, `memberships` | Tenancy boundary | every query filters by workspace; membership checked per request |
| `projects` | A client site | `canonicalUrl` for dedupe, latest bounded page-scan report, `githubWebhookSecretSet`, pause state |
| `checks` | Configuration + runtime state | interval floor 60s, thresholds, `nextRunAt`, `activeRunUntil` run lock, `configVersion` |
| `checkruns` | One record per execution | unique `runId`, stores failure category, evidence snapshot, duration |
| `incidents` | One per ongoing problem | **partial unique index** on `(checkId, activeKey)` so a second open incident cannot exist |
| `incidentevents` | Timeline (opened, acknowledged, recovery, resolved, notes, notifications) | append-only |
| `deployments` | Verified GitHub deliveries | unique `providerDeliveryId` for replay protection |
| `notificationdestinations` / `notificationdeliveries` | Alert endpoints and per-attempt audit | unique `dedupeKey` per event+incident+destination, max 10 destinations/workspace |
| `secrets` | Encrypted credentials | AES-256-GCM ciphertext + key id + fingerprint; never selected by default |
| `artifacts` | Private evidence files | signed, expiring URLs only; purged by the maintenance job |
| `jobs`, `workerheartbeats` | Durable queue + liveness | atomic claim via `findOneAndUpdate`, lease expiry for crashed workers |

## Check execution pipeline

1. **Scheduler tick** (worker, every `SCHEDULER_INTERVAL_MS`) selects checks with
   `enabled: true` and `nextRunAt <= now`, advances `nextRunAt` with a **conditional atomic
   update** (only one scheduler process can win a due run), and enqueues a `check-run` job
   with `dedupeKey: checkrun:<checkId>`.
2. **Worker claims the job** (`reserve`) with a lease; a crashed worker's lease expires and
   the job is reclaimable.
3. `processCheckRun` acquires a per-check run lock (`activeRunUntil`), re-reads the check
   (configuration may have changed), executes it and writes a `checkruns` record keyed by a
   deterministic `runId` (idempotent under retries).
4. **Execution**:
   - HTTP/API: Node `https.request` with `lookup` pinned to the validated IP set, manual
     redirect handling (each hop revalidated), response size cap, per-step evidence capture.
   - Browser: Playwright Chromium, bounded waits, step-by-step results, screenshot on failure.
   - Public page scan: bounded same-origin discovery with SSRF-protected HTTP and browser
     transports; discovered pages become ordinary HTTP checks and browser observations
     are reported without interacting with controls.
5. **Result application** (`applyResultToCheck`): counters, runtime status, last result, and
   incident transitions.
6. **Notifications** are queued as separate jobs when an incident opens/resolves (or repeats,
   throttled), so a mail provider outage never fails a check.

## Incident state machine

```
             failures < threshold
  healthy ─────────────────────────► suspected
     ▲                                   │ threshold reached
     │                                   ▼
     │                              ┌─────────┐  user acknowledges   ┌──────────────┐
     └──────────────────────────────│  open   │─────────────────────►│ acknowledged │
        recovery threshold met      └────┬────┘                      └──────┬───────┘
                                        │ success but < threshold           │
                                        ▼                                   ▼
                                   ┌────────────┐  failures again      open/acknowledged
                                   │ recovering │──────────────────────────────┘
                                   └─────┬──────┘
                                         │ recovery threshold met
                                         ▼
                                     resolved
```

- **One incident per check**: a partial unique index on `(checkId, activeKey)` makes duplicate
  opens impossible even under concurrent workers; the loser updates the existing incident.
- **Thresholds are per check** (`failureThreshold`, default 2; `recoveryThreshold`, default 2),
  so a single blip does not page anyone and one lucky request cannot clear an outage.
- **Acknowledgement is not resolution** — it records a person and a time, and leaves the
  incident open.
- **Manual resolution is a human decision**: it closes the incident with the actor's name and
  does not pretend the site is healthy; the next failing threshold opens a new incident.
- **Non-outage failures never move the machine**: `auth_failure`, `config_error`,
  `blocked_destination`, `browser_runtime_error` and `internal_error` describe the *monitor*
  being unable to verify, they set an honest runtime status, and they neither open nor
  resolve incidents.

## Queue

`packages/core/src/queue` defines a `QueueDriver` contract and ships a MongoDB driver:

- enqueue with optional `dedupeKey` (unique partial index while the key is live),
- `reserve` atomically claims a job for one worker with a lease (`lockedUntil`),
- `fail` applies exponential backoff and parks the job as `dead` after `maxAttempts`,
- `stats` powers `/api/v1/health` (`workersOnline`, `pendingJobs`).

The contract has an optional Redis/BullMQ adapter for higher throughput: a
BullMQ driver only has to implement `enqueue/reserve/complete/fail/release/stats`. The BullMQ
and ioredis dependencies are installed, but **no Redis driver is wired up** — the Mongo driver
is the supported path and everything in `docs/FINAL-REPORT.md` ran on it.

## Artifacts

Browser failures produce screenshots (and optionally traces). Files are written under
`ARTIFACT_DIR` (resolved from the repository root, never `process.cwd()`), recorded in
`artifacts`, and served only through
`GET /api/v1/artifacts/:id?exp=<unix>&sig=<hmac>` — HMAC-signed, 1-hour expiry,
`Cache-Control: private, no-store`, and still gated by an authenticated session that must be
a member of the owning workspace.

## Frontend

- **Marketing** (`/`, `/privacy`, `/terms`) — its own chrome (`SiteHeader`, `SiteFooter`,
  `Container`/`Section`/`Eyebrow`/`ButtonLink` primitives in `components/marketing`), a
  monochrome design language built on the shared Tailwind tokens, and screenshots captured
  from the running app (`apps/web/public/shots`, regenerated by `npm run capture:shots`).
- **Auth** (`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`) —
  `AuthLayout`, React Hook Form + Zod, server errors mapped onto fields.
- **Dashboard** (`/app/*`) — `AppShell` with workspace switcher; TanStack Query for all
  server state; no monitoring logic in the client (the UI only reads and configures).
- Design tokens live in `apps/web/tailwind.config.js` (`ink`, `paper`, `state`, display type
  scale, easing, shadows). Status colour is used only for real states.

## Why MongoDB for the queue

The workload is small and bursty (a few hundred checks per minute at the high end), and the
same database already holds the checks. Using it for jobs removes a moving part from a
self-hosted deployment, and the driver covers what the product needs: atomic claim, lease,
delay, dedupe, retry with backoff, dead-letter parking and stats. The cost is polling latency
(tens of milliseconds) and throughput ceiling (hundreds of jobs/second per instance) — both
acceptable here and documented rather than hidden.
