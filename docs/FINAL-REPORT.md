# BreakGlass — final report

Everything below was produced by running the code in this repository on 27 October 2026.
Where something was not verified, it says so.

The marketing site referenced in this report is the rebuild described in
`apps/web/src/pages/marketing` — a monochrome, editorial recreation of the Wix
"AI Company (Monochromatic)" layout language (eyebrow labels, large uppercase display type,
hairline rules, numbered sections, alternating dark/light bands), implemented from scratch
with no Wix assets, and populated with screenshots captured from the running application.

---

## 1. What this is

A working website-monitoring product for small web agencies, plus a public marketing site.

- A user signs up, creates a workspace, adds a client site, configures a check (HTTP, API or
  browser journey), tests it, activates it, and receives alerts when it fails repeatedly.
- Monitoring runs on a worker process, not in the browser. Logging out does not stop it.
- Failures become a single incident with a timeline, evidence and delivery records.

## 2. Scope decisions and what is deliberately absent

In the product (and stated in the UI): no multi-region monitoring, no client-facing status
pages, no SMS/phone alerts, no AI root-cause claims, no log/metric/trace ingestion. In the
marketing site: no pricing (there is no billing), no social links, no testimonials, no
customer logos, no usage statistics, no contact details — because none of those exist yet.

External integrations that need configuration before they do anything:
**email delivery** (`EMAIL_PROVIDER` + SMTP/Resend credentials), **Slack alerts** (incoming
webhook URL per destination) and **GitHub deployment correlation** (webhook + per-project
secret). All three code paths work; they are inert without credentials.

## 3. Architecture as built

npm workspaces: `packages/shared` (Zod contracts + DTOs), `packages/core` (models, services,
monitoring, queue, scheduler, notifications), `apps/api` (Express HTTP surface), `apps/worker`
(scheduler + job consumers), `apps/web` (React SPA: marketing site + dashboard).

MongoDB is the system of record and is the default queue backend. The queue driver is an
interface (`enqueue/reserve/complete/fail/release/stats`) with MongoDB and optional Redis /
BullMQ implementations. Redis requires a configured Redis service; nothing in this report
ran against Redis.

## 4. Authentication and sessions

- bcrypt password hashing; opaque session tokens stored **hashed**; httpOnly, SameSite=Lax
  cookie (`Secure` in production); no tokens in `localStorage`.
- Sessions expire, are revoked on logout, and all other sessions are revoked on password
  change. Email verification and password reset tokens are hashed, single-use and expiring.
- Login and forgot-password return identical responses for unknown accounts.
- Verified by `apps/api/src/tests/api.test.ts` (session cookie flags, logout revocation,
  password-change revocation, no user enumeration) and by
  `npm run verify:integrations` (verification link works, cannot be reused; reset link works,
  old password dies, token cannot be reused).

## 5. Tenant isolation

Every route resolves the workspace from the path, checks membership server-side, then scopes
queries by that workspace. Cross-tenant reads return 404. Asserted for projects, checks,
incidents and runs in `apps/api/src/tests/api.test.ts` and in `npm run smoke` (cross-workspace
project / incident / check access all 404).

## 6. Onboarding flow

`npm run verify:ui` drives the real UI: signup → dashboard → add site → add check → run the
configuration test (real outbound request) → activate → the scheduler runs it on its own →
a failure opens an incident → the incident is acknowledged (and stays open). **22/22**
assertions passed, including "new workspace shows an honest empty state" and "active
workspace persisted".

## 7. Check types and execution

- **HTTP**: status range, redirects (manual, each hop revalidated), expected/forbidden body
  content, response size cap, DNS/TLS/timeout classification.
- **API**: method, headers (encrypted where sensitive), body, JSON path assertions.
- **Browser**: Playwright Chromium journey with typed steps (goto, fill, click, press,
  expectText, expectVisible, expectUrl, waitForResponse), 7 steps in 699 ms against the test
  site, screenshot captured on failure, `text_not_found` classified correctly
  (`npm run verify:browser`, **13/13**).

## 8. Scheduling and queue durability

Atomic claim (one worker wins), per-check run lock so a slow check never overlaps itself,
idempotent `runId`, exponential backoff, lease expiry for crashed workers, dead-letter
parking, dedupe keys, and graceful shutdown (the worker logged
`Graceful shutdown requested … processed 18, failed 0`). Six queue tests cover claim
exclusivity, delay, dedupe, lease reclaim, retry-to-dead and stats.

## 9. Incident lifecycle

Healthy → Suspected → Open → Acknowledged → Recovering → Resolved. Configurable failure and
recovery thresholds; a partial unique index on `(checkId, activeKey)` guarantees one open
incident per check; recovery requires consecutive successes; acknowledgement is recorded
separately and does not resolve; non-outage failures (`auth_failure`, `config_error`,
`blocked_destination`, `browser_runtime_error`, `internal_error`) never move the machine.
Twenty tests cover the transitions, thresholds, reopen-after-resolve and the non-outage
classification.

## 10. Notifications

Email (SMTP or Resend) and Slack webhooks. One delivery per incident per destination
(unique `dedupeKey`), repeat notifications throttled to one per 30-minute bucket, per-attempt
delivery records with provider, status, attempts and error. In development with no provider,
mail is written to `.data/outbox` and labelled as not delivered; the dashboard shows a banner.
Ten notification tests cover dedupe, per-destination fan-out, throttling, disabled
destinations, the "accepted ≠ delivered" distinction, failure recording and the message
content. **Email delivery was verified over a real SMTP handshake** against a local sink
(`scripts/dev-mail-sink.mjs`) as well as the file outbox.

## 11. Evidence and artifacts

Failure screenshots (and optional traces) are written under a repository-root-resolved
`ARTIFACT_DIR`, recorded in MongoDB, and served only through HMAC-signed URLs with a one-hour
expiry, `Cache-Control: private, no-store`, and a session that must belong to the workspace.
Verified: signed URL returns the image, tampered signature 403, anonymous 401, signed URL
still requires a session.

## 12. Security posture

- **CSRF**: origin/referer allow-list plus JSON-only bodies for requests that carry a body
  (body-less writes are covered by the origin check). Three API tests cover missing origin,
  foreign origin and form-encoded writes.
- **SSRF**: structural validation + DNS resolution + per-hop revalidation + pinned `lookup`
  + connected-socket assertion; loopback/private/link-local/CGNAT/multicast/IPv6-ULA and
  metadata endpoints blocked, including IPv4-mapped forms. **34 tests**, plus refusal
  asserted at the API for metadata, loopback, RFC1918, `localhost`, `ftp:` and `file:` URLs.
- **Secrets**: AES-256-GCM, decrypted only in the worker, never returned by the API
  (asserted in both `verify:integrations` and `verify:browser`).
- **Webhooks**: HMAC-SHA256 over the raw body with a timing-safe compare; bad signature 401,
  missing signature 401, duplicate delivery ignored, cross-project secret 401.
- **Rate limits** on auth, reset and heavy endpoints; per-check timeouts, size caps and run
  locks.

## 13. Frontend and design

Monochrome design system (ink/paper/state tokens, display type scale, hairline borders,
minimal rounding). The marketing site is built from reusable primitives
(`Container`, `Section`, `Eyebrow`, `SectionHeading`, `ButtonLink`, `ScreenshotFrame`,
`InvestigationTimeline`, `HeroPreview`) and is separate from the dashboard while sharing
branding. Sections: hero with an explicitly illustrative product preview, product value
(three capabilities), how it works (three steps + "logging out stops nothing"), an honest
capabilities table (available / needs configuration / not in this release), five real
screenshots of the app, an agency section, the six-stage incident investigation timeline with
a correlation-not-causation caveat, a final call to action, and the footer.

Accessibility: semantic landmarks, one `h1` per page, skip link as the first tab stop, visible
focus rings, keyboard-operable mobile menu (Escape closes, focus returns), `prefers-reduced-
motion` neutralises animations, per-route titles and Open Graph metadata, and every image has
descriptive alt text.

## 14. Verification results (all executed)

| Command | Result |
| --- | --- |
| `npm test` | **100 passed, 11 optional skips**, 7 files |
| `npm run smoke` | **36 / 36** checks |
| `npm run verify:ui` | **22 / 22** checks (real Chromium, full onboarding → incident) |
| `npm run verify:browser` | **13 / 13** assertions |
| `npm run verify:integrations` | **21 / 21** assertions |
| `npm run verify:marketing` | **54 / 54** checks (links, metadata, keyboard, reduced motion, 1440/1280/834/390/320 overflow) |
| `npm run build` / `typecheck` | clean (packages + api + worker + web) |

Manual visual review of the marketing site at 1440, 1280, 834 and 390 px found no horizontal
overflow, no clipped sections, no unrevealed content after scrolling to the bottom, and no
console errors.

## 15. Screenshots and demo data

`apps/web/public/shots/*.jpg` are captured from the running application by
`npm run capture:shots` against a demo workspace built by `npm run seed` **through the real
pipeline** (`registerUser`, `createProject`, `createCheck`, `processCheckRun` against a local
target server). Timestamps are redistributed afterwards so the history looks like a few hours
of monitoring; results, durations and incident state are genuine pipeline output. The
workspace is fictional (Northline Studio, four invented client sites) and the marketing page
labels the screenshots as a demo workspace.

## 16. Known gaps

- Email verification is prompted but not enforced.
- No billing and no plan enforcement beyond fixed workspace limits.
- One worker pool / one region.
- Redis/BullMQ requires an external Redis service and was not exercised in this verification.
- SPA metadata is client-side; crawlers without JavaScript see `apps/web/index.html` defaults.
- Slack alerting is implemented and exercised against a local receiver, not a live workspace.
- `npm audit --omit=dev` reports five production dependency advisories affecting Nodemailer,
  React Router, and Zod. The available fixes require major-version upgrades; compatibility
  migrations and verification remain outstanding.
- `/home/user/site` in this workspace is an unrelated scaffold from an earlier, abandoned
  task and is not part of the BreakGlass application.
