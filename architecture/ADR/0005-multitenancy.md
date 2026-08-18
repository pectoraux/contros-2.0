# ADR-0005: Multi-tenancy — identity, persistence, isolation

> **Status: PROPOSED.** This is the highest-risk ADR. GenOffice has **no**
> multi-tenancy today (RECONNAISSANCE.md sections 6, 7). Multiple
> **UNRESOLVED** questions. None of this is implemented in the baseline.

## Context

Tenant isolation is infrastructure (master prompt section 11). Every
application/domain/repository path must enforce organization/tenant scope at
the application/domain boundary — never relying on UI filters, route
parameters, or frontend-selected project IDs.

Current GenOffice state:

- `@genoffice/project-store`: local-filesystem JSON/JSONL, single-tenant,
  no `tenantId` anywhere.
- Identity: personal/desktop Genspark account (`genoffice-auth.ts`), device-
  code OAuth, gsk API key in `~/.genoffice/auth.json`. No tenant/organization/
  workspace.
- AI auth: per-desktop-user (Genspark account OR user-supplied provider
  keys).
- No database. No server-side persistence. No server-side identity.

This is the single largest body of Contractor-add work.

## Decision 1 — Tenant is the top-level isolation boundary

**DECIDED.**

- Tenant (organization) is the top-level isolation boundary. Every domain
  record carries a `tenantId`.
- The project graph: Tenant -> Workspace -> Project -> {Opportunity, Plans,
  BOQ, EstimateRevisions, Bids, ProgrammeRevisions, Actuals, Goals}.
- Cross-tenant data never participates in matching, pricing, scheduling,
  plan linkage, goal calculation, or AI inference unless explicitly designed
  and authorized (and audited).

## Decision 2 — Tenant scope enforced at the application/domain boundary

**DECIDED.**

- The `tenantId` is resolved from the authenticated session at the API
  adapter, **never** from URL params, request bodies, or client-selected
  project IDs.
- Every repository query is tenant-scoped at the query level
  (`WHERE tenant_id = ?`), not at the UI filter level.
- Every application service receives a tenant context and validates it.
- Architecture test (when safe to encode): every repository method takes a
  `tenantId` (or a context containing one).

## Decision 3 — `@genoffice/project-store` stays as local convenience

**DECIDED.**

- `@genoffice/project-store` is NOT a domain authority. It remains the local
  convenience store for chat history + recent files (a representation, per
  ARCHITECTURE.md invariant 2).
- Contractor domain authorities live in a separate, tenant-scoped,
  DB-backed store, behind application services + repositories.
- The two do not share authority. `project-store`'s "project" (file grouping
  + chat) is unrelated to the Contractor "Project" (domain entity in the
  project graph).

## Decision 4 — Genspark account auth is wrapped, not replaced (for desktop)

**DECIDED (pending Q4).**

- For multi-tenant deployments: tenant-scoped identity is the primary auth.
  The Genspark account auth (`genoffice-auth.ts`) is wrapped so the desktop
  app can still use it for personal AI, but the Contractor domain surfaces
  authenticate against the tenant identity provider.
- For single-user desktop mode (if kept): the Genspark account remains the
  AI auth; a single implicit tenant is assumed.
- The `genoffice` Genspark API key `key_name` / `billing_tag` is re-evaluated
  for tenant-scoped AI billing (trademark + billing attribution).

## Q3 — Canonical persistence technology

**UNRESOLVED.**

- **QUESTION:** What database / persistence technology is canonical for the
  Contractor domain authorities?
- **CURRENT EVIDENCE:** None exists today. GenOffice uses local filesystem
  only. The master prompt references PostgreSQL in several places (e.g.
  "Do not reproduce the entire IFC schema in PostgreSQL unless explicitly
  justified", section 20; "real PostgreSQL integration tests", section 34),
  implying PostgreSQL is the expected canonical DB. The sandbox environment
  uses Prisma + SQLite.
- **OPTIONS:**
  1. **PostgreSQL** (per master prompt implication). Tenant-scoped schema or
     row-level tenant column. Mature, supports the revision/audit/
     determinism requirements.
  2. **SQLite-per-tenant** (file-per-tenant). Strong isolation by
     construction; simpler ops for small tenants; harder for cross-tenant
     aggregates.
  3. **Hybrid.** PostgreSQL for shared/cross-tenant metadata + per-tenant
     schemas for dense domain data.
- **TRADE-OFFS:**
  - Option 1 is the master prompt's implied default and supports the testing
    hierarchy (section 34: "real PostgreSQL integration tests"). Row-level
     tenant isolation requires discipline + architecture tests.
  - Option 2 gives physical isolation but complicates operations,
    migrations, and cross-tenant features.
  - Option 3 is most flexible but most complex.
- **RECOMMENDATION:** Option 1 (PostgreSQL, row-level tenant column +
  repository-level enforcement + architecture tests), **pending Principal
  Architect confirmation**. Aligns with the master prompt's testing
  hierarchy. The sandbox's Prisma+SQLite is a development convenience, not
  the canonical choice.
- **STATUS: UNRESOLVED.** Must be decided before the persistence
  implementation phase (ARCHITECTURE.md section 32 step 1-2).

## Q4 — Identity model

**UNRESOLVED.**

- **QUESTION:** Replace Genspark account auth with tenant auth, or wrap it?
- **CURRENT EVIDENCE:** GenOffice uses Genspark device-code OAuth (personal)
  OR user-supplied provider keys. No tenant/organization/workspace concept.
- **OPTIONS:**
  1. **Replace.** Tenant identity provider (OIDC/SAML/custom) is the sole
     auth for Contractor domain surfaces. Genspark account is dropped for
     Contractor (kept only if the fork still ships non-Contractor office
     features).
  2. **Wrap.** Keep Genspark account for desktop AI; layer tenant identity
     on top for Contractor domain surfaces. Two auth contexts.
  3. **Unify.** Make the Genspark account a tenant member (Genspark becomes
     the tenant identity provider). Requires Genspark-side changes we don't
     control.
- **TRADE-OFFS:**
  - Option 1 is cleanest but drops the Genspark AI backend (which is
    valuable). Option 2 keeps both but has two auth contexts (complexity).
    Option 3 is not under our control.
- **RECOMMENDATION:** Option 2 (wrap), **pending Principal Architect
  confirmation**. Tenant identity is primary for Contractor domain surfaces;
  Genspark account remains for desktop AI (wrapped behind a tenant-scoped
  credential resolver).
- **STATUS: UNRESOLVED.** Must be decided before the identity implementation
  phase (section 32 step 1).

## Decision 5 — Tenant isolation in AI inference

**DECIDED.**

- AI inference is tenant-scoped. AI candidates never see cross-tenant data
  (unless explicitly authorized + audited).
- The tenant context flows from the session -> application service -> AI
  prompt construction -> agent tools.
- `sanitizeAgentPayload` (GenOffice) is applied to all AI payloads crossing
  the boundary.

## Decision 6 — Audit is tenant-scoped

**DECIDED.**

- Every authority-changing action emits an audit event with: actor,
  timestamp, tenant, authorization context, action, before/after content
  hash. Audit events are tenant-scoped and append-only.

## Consequences

- A new tenant-scoped persistence layer (PostgreSQL, pending Q3) for domain
  authorities.
- A new identity layer (tenant identity, pending Q4) wrapping/replacing
  Genspark account auth.
- `@genoffice/project-store` remains local convenience; not touched.
- Architecture tests for tenant boundary enforcement.
- No identity/persistence code in this baseline.

## Verification

- Design-only in this baseline. No code.
- Once built: tenant-isolation integration tests (tenant A cannot read/write
  tenant B's data); cross-tenant inference tests (AI candidate for tenant A
  contains no tenant B data); audit tests (every authority change emits a
  tenant-scoped audit event).
