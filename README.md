# BreakGlass

Website monitoring and incident investigation for small web agencies.

BreakGlass watches the sites an agency manages — HTTP uptime, API responses and real
browser journeys — runs the checks on its own workers, and turns confirmed failures into
**one incident with the evidence attached** instead of a stream of alerts.

This is a working application, not a prototype: accounts, sessions, monitoring workers,
the incident state machine, alert delivery and the dashboard all exist and are exercised
by the verification scripts described below.

---

## What it does

| Area | Behaviour |
| --- | --- |
| Checks | HTTP (status range, redirects, expected/forbidden content), API (method, headers, JSON assertions, encrypted credentials), browser journeys (Playwright steps with failure screenshots) |
| Scheduling | Durable job queue with atomic claims, per-check run locks, retries with backoff, graceful shutdown; a check can genuinely never run twice at once |
| Incidents | Healthy → Suspected → Open → Acknowledged → Recovering → Resolved, with configurable failure and recovery thresholds, one incident per ongoing problem, and acknowledgement tracked separately from resolution |
| Alerts | Email (SMTP or Resend) and Slack incoming webhooks, one delivery per incident per destination, deduplicated and throttled, with a delivery record per attempt |
| Evidence | Run history, bounded response previews, failure screenshots, signed private artifact URLs, suggested next steps explicitly marked as suggestions |
| Deployments | Signature-verified GitHub webhooks, deduplicated by delivery id, used for **timing correlation only** |
| Tenancy | Every record is workspace-scoped and every route re-checks membership server-side |

Deliberately out of scope (and stated as such in the UI): multi-region monitoring,
client-facing status pages, SMS/phone alerts, AI root-cause analysis, and log/metric/trace
ingestion.

## Stack

- **Frontend** — React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query,
  React Hook Form + Zod
- **API** — Node 20, Express, Zod validation, Pino logging
- **Data** — MongoDB (Mongoose) as the system of record
- **Queue** — MongoDB-backed durable queue by default (atomic claims, leases, retries), with
  an optional Redis/BullMQ adapter for deployments that configure Redis. Local development
  and the default test suite use MongoDB.
- **Monitoring** — Node `http/https` with a pinned DNS lookup for HTTP/API checks;
  Playwright Chromium for browser journeys
- **Monorepo** — npm workspaces: `packages/shared` (contracts), `packages/core` (domain,
  models, services, monitoring, queue), `apps/api`, `apps/worker`, `apps/web`

## Quick start (local)

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#   - set ENCRYPTION_KEY (openssl rand -base64 32)
#   - keep EMAIL_PROVIDER=none for the dev outbox, or point it at a local SMTP sink

# 3. Database (any MongoDB works; no local mongod required)
npm run dev:db            # boots an in-process MongoDB on 127.0.0.1:27017 (.data/db)

# 4. Run everything (API :4000, worker, web :5173)
npm run dev
```

Open <http://localhost:5173>, create an account, add a site, add a check, run the
configuration test, then activate it. Monitoring continues after you sign out.

### Optional local helpers

```bash
node scripts/demo-target.mjs      # three fake client sites on :9910 (one healthy, one slow, one failing)
node scripts/dev-mail-sink.mjs    # SMTP sink on :1025 writing .data/outbox-smtp/*.eml
npm run seed                      # builds a demo workspace with real check history
npm run capture:shots             # re-captures the marketing screenshots from the running app
```

## Verification

Every number below was produced by running the command in this repository, against the
real API, worker, MongoDB and Chromium.

| Command | What it proves | Last result |
| --- | --- | --- |
| `npm test` | SSRF policy, queue semantics, incident state machine, notification dedupe, API/CSRF/tenancy | **100 passed / 11 optional skips** |
| `npm run smoke` | End-to-end API flow: register → project → check → run → incident → resolve → isolation | **36 / 36** |
| `npm run verify:ui` | Real Chromium: marketing → signup → add site → test → activate → scheduled run → incident → ack | **22 / 22** |
| `npm run verify:browser` | Playwright journey check, encrypted login, screenshots, signed URLs, tampering | **13 / 13** |
| `npm run verify:integrations` | GitHub HMAC webhooks (bad/unsigned/signed/duplicate/cross-project) and email verification + reset | **21 / 21** |
| `npm run verify:marketing` | Marketing site: links, metadata, keyboard, reduced motion, overflow at 1440/1280/834/390/320 | **54 / 54** |

The verification scripts are in `scripts/` and are safe to re-run; each creates its own
account and data.

## Configuration

All variables are documented in [.env.example](.env.example). The ones that matter most:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | System of record |
| `ENCRYPTION_KEY`, `ENCRYPTION_KEY_ID` | AES-256-GCM key for stored credentials (required in production; a dev key is generated into `.data/` otherwise) |
| `APP_ORIGIN`, `API_ORIGIN`, `ALLOWED_ORIGINS` | Cookie/CSRF/CORS allow-list |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `SMTP_*`, `RESEND_API_KEY` | Alert delivery. `none` writes mail to `.data/outbox` and the dashboard says so |
| `ARTIFACT_DIR` | Private storage for screenshots/traces. Must be an absolute shared path in production |
| `WORKER_CONCURRENCY`, `BROWSER_CONCURRENCY`, `SCHEDULER_INTERVAL_MS` | Worker tuning |
| `ALLOW_PRIVATE_TARGETS` | Development only: allow loopback/private targets. Always off in production |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — processes, data model, check pipeline, queue, incident machine
- [docs/SECURITY.md](docs/SECURITY.md) — auth, CSRF, SSRF defences, secret handling, artifact signing, webhooks
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — deploying, running the worker, health checks, email providers, troubleshooting
- [docs/FINAL-REPORT.md](docs/FINAL-REPORT.md) — what was built, what was verified, what is missing

## Known gaps

These are real and are not hidden anywhere in the product or the marketing site:

- **Email verification is encouraged, not enforced** — unverified accounts can still use the
  product; the UI prompts them.
- **No billing** and no plan enforcement beyond the fixed workspace limits (25 projects,
  100 active checks, 25 browser checks, 100 checks per project by default).
- **Single worker pool** — checks run from one region, so a regional outage affects the
  monitor as well as the monitored site.
- **Redis/BullMQ requires an external Redis service** and has not been exercised in this
  local verification run; MongoDB is the default supported local queue.
- **SPA metadata** — page titles and Open Graph tags are updated client-side; crawlers that
  do not execute JavaScript see the defaults in `apps/web/index.html`.
- **Slack delivery is implemented but was only verified against a local receiver**, not a
  real Slack workspace.
- **Production dependency audit** currently reports five advisories in Nodemailer, React
  Router, and Zod. The suggested fixes require major-version upgrades, so those migrations
  still need compatibility work and verification.
