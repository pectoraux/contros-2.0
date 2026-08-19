# ADR-0009: Production Hosting, Database, and Authentication

> **Status: DECIDED (Phase 2C.2).** Records the deployment architecture for the
> Contractor GenOffice browser slice: Vercel serverless functions hosting the
> HTTP adapter, Neon Postgres as the canonical database, and passwordless
> email magic-link authentication wired to the existing `ApiSessionResolver`
> seam. The frozen architecture (CoreApi, services, repositories, domain,
> tenancy, audit, revision) is unchanged; this ADR defines how the existing
> seams are hosted in production.

## Context

Phase 2C.1 established the first browser slice (`e5bbb00`): a Vite+React
`apps/web` app + a `packages/web-host` Node HTTP host + DEV-only signed-cookie
auth, all running against PGlite (in-process PostgreSQL WASM). The slice is
locally usable but not deployable:

- PGlite is in-process and in-memory — serverless function invocations each get
  a fresh empty database; nothing persists.
- The HTTP host is a long-lived `http.createServer` — Vercel expects
  request/response function handlers, not a listening server.
- The DEV-only auth (`CONTRACTOR_DEV_AUTH=1 + CG_DEV_CREDENTIAL`) is explicitly
  forbidden in production (ADR-0008 D2) — it's a development convenience gated
  by a server-side secret, not a real identity provider.

Phase 2C.2 makes the slice deployable without redesigning the frozen
architecture. The `CoreApi`, application services, repositories, domain model,
tenancy model, revision model, and audit-atomicity model are all unchanged.
This ADR defines the three deployment seams: hosting, database, authentication.

## Decision 1 — Hosting: Vercel serverless functions

### QUESTION

Where should the Contractor GenOffice browser slice be hosted?

### EVIDENCE

- The HTTP host (`packages/web-host/src/server.ts`) is a thin Node
  `http.createServer` wrapping `CoreApi.handle()`. It contains no business
  logic — it's a transport adapter.
- Vercel hosts serverless functions (Node request/response handlers) + static
  assets (the Vite-built browser bundle).
- The CoreApi is already framework-neutral (`ApiRequest`/`ApiResponse` value
  objects); wrapping it as a Vercel function is a small mechanical adapter.

### OPTIONS

1. **Vercel** — serverless functions for `/api/*`, static hosting for the
   browser bundle. Fits the thin-adapter shape.
2. **Fly.io / Render** — long-lived Node process hosting. Closer to the current
   `http.createServer` shape, but more ops surface area.
3. **Self-hosted VPS** — maximum control, maximum ops burden.

### DECISION

**Option 1 — Vercel.** The HTTP host is already a thin adapter; wrapping it as
a Vercel function is mechanical. The browser bundle is a standard Vite build
served as static assets. No business logic moves into the host.

### CONSEQUENCES

- The `packages/web-host/src/server.ts` is supplemented (not replaced) by a
  Vercel function adapter at `packages/web-host/src/vercel-handler.ts`. The
  dev server (`dev-server.ts`) is unchanged for local development.
- The Vercel function imports the same `CoreApi` + `WebSessionResolver`; only
  the entry shape differs (`export default function handler(req, res)` vs
  `http.createServer`).
- Cold-start latency applies (serverless). The `PgLite`-in-process dev path is
  unaffected.

## Decision 2 — Database: Neon Postgres (serverless pooled)

### QUESTION

What database backs the production deployment?

### EVIDENCE

- The architecture is "PostgreSQL canonical" (ADR-0005). The `PostgresClient`
  (`packages/contractor-core/src/persistence/postgres-client.ts`) exists for
  standalone PostgreSQL but is documented "NOT VERIFIED" — never runtime-tested.
- PGlite is in-process and in-memory — correct for tests/dev, wrong for a
  stateless serverless deployment.
- Neon Postgres provides serverless-friendly pooled PostgreSQL over a
  `DATABASE_URL` connection string. Other options (Supabase, RDS, Aurora)
  would work equally well; Neon is chosen for serverless-fit + free-tier
  availability for the first deployment.

### OPTIONS

1. **Neon Postgres** — serverless pooled PostgreSQL; `DATABASE_URL` connection
   string; free tier for the first deployment.
2. **Supabase** — hosted Postgres + additional services (auth, storage).
3. **Self-hosted Postgres** — maximum control, maximum ops.

### DECISION

**Option 1 — Neon Postgres.** The `PostgresClient` connects via
`process.env.DATABASE_URL` using `pg.Pool`. The connection string comes from
the environment (Vercel secret), never source.

### CONSEQUENCES

- **PostgresClient bug fix (required).** The current `PostgresClient` caches a
  single `PoolClient` on the instance (`this.client`) and never releases it
  back to the pool. In a serverless function this would exhaust the connection
  pool under load and leak transaction state across concurrent invocations.
  The fix: check out a connection per `tx()` call and release it in `finally`;
  do not cache on the instance. This is a bug fix, not a redesign — the
  `DbClient` contract is unchanged.
- **PostgresClient runtime verification (new).** A test that runs against a
  real PostgreSQL when `DATABASE_URL` is set (skipped otherwise). This closes
  the "NOT VERIFIED" gap from prior phases for the standalone-Postgres path.
- Migrations run as a deploy step (not per-request). The deploy script applies
  `FOUNDATION_MIGRATION_SQL` + `COMMERCIAL_MIGRATION_SQL` once.

## Decision 3 — Authentication: passwordless email magic-link

### QUESTION

What production authentication mechanism replaces the DEV-only flow?

### EVIDENCE

- ADR-0008 D4 defers production auth to "a real provider (OIDC/SAML/NextAuth/
  Passport)" wired to the existing `ApiSessionResolver` seam.
- No password storage, password hashing, or credential-reset flow exists, and
  none should be invented (ADR-0008 D2).
- The `ApiSessionResolver` contract is stable: `resolveSession(token) →
  { provider, subject, tenantId } | null`. A production resolver validates a
  token, resolves the user via `AuthProviderBinding`, and issues the same
  signed session cookie.

### OPTIONS

1. **Passwordless email magic-link** — the user enters their email; the server
   generates a single-use, short-lived link; the user clicks it; the server
   issues a session cookie. No password storage. Requires an email-sending
   service (SMTP/Resend/SendGrid).
2. **OIDC via a third-party provider** (Google/GitHub/Microsoft) — full
   identity-provider integration; the most "production" option.
3. **NextAuth/Auth.js** — a library that wraps multiple providers.

### DECISION

**Option 1 — passwordless email magic-link.** This is the smallest real auth
that satisfies the contract without inventing password storage. The flow:

1. `POST /api/auth/request-link { email }` — server generates a single-use
   token (HMAC-signed, short-lived), stores it in a `magic_links` table, and
   emails it. For dev, the link is logged to the server console (no email
   service required).
2. `GET /api/auth/verify?token=…` — server verifies the token, resolves or
   creates the `User` + `AuthProviderBinding` (provider='email',
   subject=email), issues the signed session cookie, redirects to the tenant
   selection screen.
3. The existing `WebSessionResolver` is unchanged — it already resolves the
   session cookie to a `TenantContext` via `IdentityService`.

The magic-link tokens are stored in a new `magic_links` table (additive; does
not modify the foundation or commercial migrations). The table is append-only
with expiry + single-use enforcement.

### CONSEQUENCES

- **No password storage.** No password hashing library. No credential-reset
  flow. This is the explicit Phase 2C.2 boundary.
- **Email sending is deferred to a service.** For dev/the first deployment,
  the magic link is logged to the server console. For production, an email
  provider (Resend/SendGrid/SES) is wired via `process.env.EMAIL_API_KEY`.
- **The DEV-only flow (ADR-0008 D2) remains for local development.** The
  production deployment sets `CONTRACTOR_DEV_AUTH=0` (or omits it); the
  `/api/auth/dev-login` endpoint returns 404. The magic-link flow is the
  production path.
- **The `ApiSessionResolver` seam is unchanged.** A future migration to
  OIDC/NextAuth replaces only the token-verification step; the session cookie
  + tenant-selection flow is identical.

## Decision 4 — The frozen architecture is unchanged

### DECISION

Phase 2C.2 adds deployment seams; it does NOT modify:

- The `CoreApi` contract (`handle(ApiRequest) → ApiResponse`).
- The application services (authorization, validation, transaction, audit).
- The repositories (tenant-scoped SQL, parameterized).
- The domain model (EstimateRevision, Bid, BOQ, PlanMeasurement, Money, etc.).
- The tenancy model (`ctx.tenantId` from authenticated session, never client).
- The revision model (immutability, counter, content hash).
- The audit model (append-only, atomic with business mutation per ADR-0007 D18).

The only modifications to existing files:
- `PostgresClient` bug fix (connection-per-tx, not cached-on-instance) — a bug
  fix required for serverless correctness, not a redesign.
- Additive `magic_links` migration (new file, does not touch foundation or
  commercial migrations).

### DEFERRED QUESTIONS

- **Email provider selection** (Resend vs SendGrid vs SES): deferred. The
  magic-link flow logs to console for dev; a provider is wired via
  `EMAIL_API_KEY` for production.
- **Session revocation list**: deferred (same as ADR-0008 D1).
- **Rate limiting on magic-link requests**: deferred (Vercel's edge rate
  limiting can be added later).
- **Migration to OIDC/NextAuth**: deferred. The magic-link flow is the
  production path until a richer provider is required.
- **Multi-region deployment**: deferred. The first deployment is
  single-region.
