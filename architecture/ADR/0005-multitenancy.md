# ADR-0005: Multi-tenancy — identity, persistence, isolation

> **Status: DECIDED (foundation).** Phase 0.5 decision gate. Q3 (canonical
> persistence) and Q4 (identity and tenancy) are resolved as explicit
> decisions. Q2 (office/domain synchronization) and Q5/Q6/Q7 remain deferred
> to their respective domain phases. Decisions use the format
> QUESTION / EVIDENCE / OPTIONS / TRADE-OFFS / RECOMMENDATION / DECISION /
> CONSEQUENCES / DEFERRED QUESTIONS.

## Context

Tenant isolation is infrastructure (master prompt section 11). Every
application/domain/repository path must enforce organization/tenant scope at
the application/domain boundary — never relying on UI filters, route
parameters, or frontend-selected project IDs.

Current GenOffice state (RECONNAISSANCE.md sections 6, 7):

- `@genoffice/project-store`: local-filesystem JSON/JSONL, single-tenant,
  no `tenantId` anywhere.
- Identity: personal/desktop Genspark account (`genoffice-auth.ts`),
  device-code OAuth, gsk API key in `~/.genoffice/auth.json`. No tenant /
  organization / workspace.
- AI auth: per-desktop-user (Genspark account OR user-supplied provider
  keys).
- No database. No server-side persistence. No server-side identity.

This is the largest body of Contractor-add work. Phase 0.5 resolves the
foundation decisions (Q3, Q4) so the implementation sequence (Identity ->
Tenant -> Workspace -> Project -> Audit -> Revision framework -> Core API)
can begin.

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

- `@genoffice/project-store` is NOT a domain authority. It remains the
  local convenience store for chat history + recent files (a
  representation/cache, per ARCHITECTURE.md invariant 2 and the cache rules
  in Decision 7 below).
- Contractor domain authorities live in a separate, tenant-scoped,
  PostgreSQL-backed store, behind application services + repositories.
- The two do not share authority. `project-store`'s "project" (file grouping
  + chat) is unrelated to the Contractor "Project" (canonical domain entity
  in the project graph). The naming collision is resolved in Decision 9
  (Project authority).

## Decision 4 — Genspark account auth is one auth provider, not the tenant
              authority

**DECIDED (refined by Q4 below).**

- For multi-tenant deployments: tenant-scoped identity is the primary auth
  for Contractor domain surfaces. The Genspark account auth
  (`genoffice-auth.ts`) becomes **one authentication provider / AI-credential
  integration** — useful for the desktop AI backend — but is NOT the
  Contractor OS tenant authority.
- For single-user desktop mode (if retained): the Genspark account may
  remain the AI auth; a single implicit tenant is assumed. This mode is a
  degenerate case of the multi-tenant model, not a separate architecture.
- The `genoffice` Genspark API key `key_name` / `billing_tag` is
  re-evaluated for tenant-scoped AI billing (trademark + billing
  attribution).

## Q3 — Canonical persistence technology (resolved)

### QUESTION

What persistence technology is canonical for the Contractor domain
authorities, and how is the persistence layer divided?

### EVIDENCE

- GenOffice uses local filesystem only (`@genoffice/project-store`); no
  database (RECONNAISSANCE.md section 6).
- The master prompt references PostgreSQL in several places — "Do not
  reproduce the entire IFC schema in PostgreSQL unless explicitly
  justified" (section 20); "real PostgreSQL integration tests" (section
  34); "PostgreSQL integration" in the milestone sequence (section 33) —
  implying PostgreSQL is the expected canonical DB.
- The master prompt's testing hierarchy (section 34) requires "real
  PostgreSQL integration tests" as a distinct tier.
- The sandbox environment uses Prisma + SQLite; this is a development
  convenience, not the canonical choice.
- Domain authorities (`EstimateRevision`, `ProgrammeRevision`,
  `PlanMeasurement`, `ProjectActual`, `Goal`) require: transactional
  integrity, tenant-scoped queries, immutable-revision storage,
  append-only audit, deterministic replay.

### OPTIONS

1. **PostgreSQL** — single relational DB, row-level tenant column
   (`tenant_id`), repository-level enforcement + architecture tests.
2. **SQLite-per-tenant** — one file per tenant. Strong physical isolation;
   harder for cross-tenant aggregates, ops, and migrations.
3. **Hybrid** — PostgreSQL for shared/cross-tenant metadata + per-tenant
   schemas/files for dense domain data.
4. **Filesystem** — extend `@genoffice/project-store` into a domain
   authority. (Rejected: cannot enforce tenant isolation, immutability,
  transactions, or server-side access.)

### TRADE-OFFS

- Option 1 is the master prompt's implied default and supports the testing
  hierarchy. Row-level tenant isolation requires discipline + architecture
  tests, but that discipline is required anyway (Decision 2).
- Option 2 gives physical isolation but complicates operations, migrations,
  and cross-tenant features (admin reports, billing). It also conflicts
  with the master prompt's "real PostgreSQL integration tests" tier.
- Option 3 is most flexible but most complex — premature for a foundation
  decision.
- Option 4 is rejected outright (Decision 3 already rules out
  `project-store` as a domain authority).

### RECOMMENDATION

Option 1 (PostgreSQL) + object storage for large immutable artifacts +
`@genoffice/project-store` retained as local convenience/cache.

### DECISION

**Option 1 — PostgreSQL is the canonical transactional domain store.**

The persistence layer is divided into three tiers, each with a clearly
defined role:

```
PostgreSQL (canonical transactional domain state)
    |
    +-- Tenant / Organization / Membership / Workspace / Project identity
    +-- Domain authorities: EstimateRevision, ProgrammeRevision,
    |   PlanMeasurement (metadata + content), ProjectActual, Goal
    +-- Audit log (tenant-scoped, append-only)
    +-- Revision framework metadata (content hash, algorithm version,
        inputs, finalize/supersede events)
    |
Object storage (large immutable artifacts)
    |
    +-- Plan source artifacts (IFC/PDF/DXF/DWG blobs, content-hashed,
    |   immutable)
    +-- Office file representations generated from authorities
    |   (e.g. estimate workbook .xlsx exported from an EstimateRevision)
    +-- AI prompt/response logs (truncated per existing TOOL_FIELD_MAX_CHARS
    |   convention in project-store)
    +-- Backups / exports
    |
@genoffice/project-store (local Office / convenience / cache state)
    |
    +-- AI chat history (JSONL, append-only, local convenience)
    +-- Recent files (local convenience)
    +-- Local Office/document workspace representation
    +-- NOT a domain authority; NOT tenant-truth
```

#### What belongs where (explicit)

| Data | Tier | Role |
| --- | --- | --- |
| Tenant, Organization, Membership, Workspace, Project (canonical) | PostgreSQL | **authoritative** |
| `EstimateRevision` (content + metadata) | PostgreSQL | **authoritative** (immutable once finalized) |
| `ProgrammeRevision` (content + metadata) | PostgreSQL | **authoritative** (immutable once finalized) |
| `PlanMeasurement` (metadata + content) | PostgreSQL | **authoritative** (append-only evidence) |
| `PlanMeasurement` source artifact bytes (IFC/PDF/DXF/DWG) | Object storage | **authoritative** (immutable evidence, content-hashed) |
| `ProjectActual` | PostgreSQL | **authoritative** (append-only evidence) |
| `Goal` (intent: metric/target/period/scope) | PostgreSQL | **authoritative** (mutable intent) |
| `Goal` current value / status | derived at query time | **derived** (never stored as truth) |
| Variance (`Actual` vs `EstimateRevision`) | derived at query time | **derived** |
| Audit events | PostgreSQL | **authoritative** (append-only) |
| Schedule result cache (`ScheduleResult` for a `Programme` working state) | PostgreSQL (cache table) or in-memory | **cache** (recomputable from `Programme` + engine version) |
| Office file representations (workbook, deck, doc generated from an authority) | Object storage + PostgreSQL metadata | **derived** (recomputable from the authority) |
| AI chat history | `@genoffice/project-store` (local JSONL) | **local convenience** (not tenant-truth) |
| Recent files, local workspace grouping | `@genoffice/project-store` (local JSON) | **local convenience / cache** |
| Unsaved workbook working copy | local filesystem (Electron) or client state (web) | **working state** (promoted to authority on finalize) |

#### What is authoritative vs. derived vs. cache (explicit)

- **Authoritative:** PostgreSQL domain authority tables + object-storage
  source artifacts. These are the canonical truth. Revisions are immutable
  once finalized; evidence is append-only.
- **Derived:** goal current value/status, variance, schedule result (when
  cached), office file representations generated from authorities. Always
  recomputable from authoritative inputs + algorithm version. Never stored
  as the canonical truth.
- **Cache:** `ScheduleResult` cache, computed dashboards, `project-store`
  chat history / recent files. Improves performance or UX; never the
  truth. Invalidated/regenerated from authorities.

#### What must NOT become a second source of truth

- `@genoffice/project-store` (local convenience only)
- Office files (`.xlsx`/`.docx`/`.pptx`/`.pdf`/`.md`) — representations,
  not authorities (ADR-0002)
- Spreadsheets (Univer workbook model) — a representation
- BIM viewer state — a representation of `PlanMeasurement` + source artifact
- AI state (candidates, suggestions) — advisory only
- Electron local state — never a second database

### CONSEQUENCES

- A PostgreSQL instance (or cluster) is required for any non-trivial
  deployment. The sandbox's Prisma+SQLite is a development convenience
  only; canonical schema targets PostgreSQL.
- The repository layer enforces `tenant_id` scoping on every query.
  Architecture tests verify this (when safe to encode).
- Object storage (S3-compatible, or local files in dev) holds large
  immutable artifacts. The PostgreSQL row holds the content hash + storage
  key, never the bytes.
- `@genoffice/project-store` is untouched; it continues to serve local
  Office/document convenience. Its data is cache/local, not authoritative.
- Migrations are PostgreSQL-first. SQLite is supported only as a dev
  fallback (with the explicit caveat that SQLite-only tests do not satisfy
  the "real PostgreSQL integration tests" tier of the testing hierarchy).
- The revision framework (ADR-0002, ADR-0003) stores content hash,
  algorithm version, inputs, and finalize/supersede events in PostgreSQL.

### DEFERRED QUESTIONS

- Exact schema (tables, columns, indexes) — deferred to the persistence
  implementation phase (ARCHITECTURE.md section 32 step 1-3). The
  foundation decision is the technology choice + the tier division, not
  the schema.
- ORM choice (Prisma vs. raw SQL vs. other) — deferred. The master prompt
  mentions Prisma in the sandbox; the canonical deployment may use Prisma
  against PostgreSQL. Decided in implementation, not foundation.
- Object-storage provider (S3 / R2 / MinIO / local) — deferred to
  deployment.
- Row-level security (PostgreSQL RLS) vs. application-level tenant
  enforcement — deferred to the repository implementation. Either way,
  application-level enforcement is mandatory (Defense 2); RLS, if used, is
  defense-in-depth, not a replacement.

## Q4 — Identity and tenancy (resolved)

### QUESTION

What is the Contractor identity hierarchy, and how do authentication,
authorization, tenant isolation, and audit identity relate — and how does
the existing GenOffice/Genspark desktop identity fit?

### EVIDENCE

- GenOffice identity is personal/desktop (Genspark account device-code
  OAuth, or user-supplied provider keys). No tenant/organization/workspace
  (RECONNAISSANCE.md section 7).
- The master prompt section 5/11 requires: one canonical Tenant model,
  tenant isolation below the UI, every application/domain path enforcing
  organization/tenant scope.
- The master prompt section 31 requires one canonical project graph:
  Tenant -> Workspace -> Project -> {domain entities}.

### OPTIONS

1. **Replace.** A tenant identity provider (OIDC/SAML/custom) is the sole
   auth for Contractor domain surfaces. Genspark account is dropped for
   Contractor (kept only if the fork still ships non-Contractor office
   features).
2. **Wrap.** Keep Genspark account for desktop AI; layer tenant identity
   on top for Contractor domain surfaces. Two auth contexts.
3. **Unify.** Make the Genspark account a tenant member (Genspark becomes
   the tenant identity provider). Requires Genspark-side changes we don't
   control.
4. **Pluggable identity + explicit hierarchy.** Define a canonical
   Contractor identity hierarchy (User, Organization, Membership, Role,
   Workspace, Project, Service identity, Audit actor). Authentication is
   pluggable: Genspark account becomes one auth provider integration
   (useful for AI credentials and desktop convenience), but the
   Contractor tenant authority is independent of it. Authentication,
   authorization, tenant isolation, and audit identity are explicitly
   separated concerns.

### TRADE-OFFS

- Option 1 is cleanest but drops the Genspark AI backend (valuable for the
  desktop editor's AI features) and complicates single-user desktop mode.
- Option 2 keeps both but leaves the relationship between the two auth
  contexts implicit — a source of future ambiguity.
- Option 3 is not under our control (Genspark is a third-party service).
- Option 4 is the most explicit and the most aligned with the master
  prompt's separation of concerns (section 15: "Keep integrity and
  authorship conceptually separate"; section 11: tenant isolation is
  infrastructure, not auth).

### RECOMMENDATION

Option 4.

### DECISION

**Option 4 — Pluggable identity + explicit Contractor identity hierarchy.**

#### The identity hierarchy

```
Identity (a person or service principal)
    |
    +-- User (canonical identity record: id, contact, status)
    |       |
    |       +-- authenticates via one or more AuthProviders
    |       |   (Genspark account, OIDC, SAML, email/password, etc.)
    |       |
    |       +-- is a member of one or more Organizations
    |
    +-- Organization / Tenant (top-level isolation boundary)
    |       |
    |       +-- Membership (User x Organization, with Role)
    |       |       |
    |       |       +-- Role (owner / admin / member / viewer / custom)
    |       |
    |       +-- owns Workspaces
    |       +-- owns Projects (via Workspaces)
    |       +-- owns domain authorities (EstimateRevisions, etc.)
    |       +-- owns Audit events
    |
    +-- Workspace (organizational unit within a Tenant)
    |       |
    |       +-- owns Projects
    |
    +-- Project (canonical business/project identity)
            |
            +-- owns {Opportunity, Plans, BOQ, EstimateRevisions,
                      Bids, ProgrammeRevisions, Actuals, Goals}
            |
            +-- may be linked to local GenOffice project-store entries
                (see Decision 9 / Project authority)
```

#### The four explicitly separated concerns

| Concern | Definition | Enforced where |
| --- | --- | --- |
| **Authentication** | Verifying a User's identity (who are you?) | Auth provider (Genspark, OIDC, SAML, etc.) -> session token; verified at the API adapter |
| **Authorization** | Verifying a User may perform an action in a Tenant/Workspace/Project (may you?) | Application service, against Membership + Role + ACL |
| **Tenant isolation** | Ensuring a request never reads/writes another Tenant's data | Repository layer (every query is `WHERE tenant_id = ?`); architecture tests enforce |
| **Audit identity** | Recording *who* did *what* *when* *in which tenant* *under what authorization* | Audit service; every authority-changing action emits a tenant-scoped, append-only audit event |

Authentication and authorization are **separate**: a User authenticates
(once, via any provider), then is authorized per Tenant/Workspace/Project
based on their Memberships and Roles. Tenant isolation is **below**
authorization — even an authorized request is constrained to its tenant's
data. Audit identity is **separate from content integrity** (master prompt
section 15): a content hash identifies content; an audit event identifies
the actor, timestamp, tenant, authorization context, and action.

#### How the pieces relate

- **Desktop GenOffice identity** (Genspark account `genoffice-auth.ts`):
  becomes one AuthProvider integration. Useful for: (a) the desktop
  editor's personal AI backend, (b) single-user desktop mode (degenerate
  case: one User, one implicit Tenant). It is NOT the tenant authority.
- **Web identity**: a User authenticates via a web AuthProvider (OIDC/SAML/
  email) at the Core API; the session token carries the User identity.
  Membership resolution determines Tenant/Workspace/Project access.
- **Organization membership**: a User may belong to multiple Organizations
  (Tenants). The session selects an active Tenant context (server-side);
  the Tenant context is what every repository query is scoped to. The
  client never selects a Tenant by sending a `tenantId` in a request body
  — the active Tenant is resolved server-side from the session.
- **Project access**: a Project belongs to a Workspace, which belongs to a
  Tenant. Access is authorized via Membership + Role + per-Project ACL.
  The client sends a `projectId`; the server validates that the
  authenticated User's active Tenant owns that Project (and the User has
  access). A client-supplied `projectId` is never trusted for isolation
  — only for routing.
- **AI credentials**: AI providers (Genspark, Anthropic, etc.) are
  invoked through the Core, with credentials resolved per-Tenant (or
  per-User for personal mode). The Core enforces tenant-scoped AI
  inference (Decision 5). `sanitizeAgentPayload` (GenOffice) is applied
  to all AI payloads crossing the boundary.

### CONSEQUENCES

- A canonical identity model exists: User, Organization/Tenant, Membership,
  Role, Workspace, Project, Service identity, Audit actor. There is exactly
  one of each.
- Genspark account auth is preserved as a desktop/AuthProvider integration
  but is demoted from "the auth" to "one of several possible auths."
- The Core API resolves Tenant context from the session server-side; the
  client never supplies a `tenantId`.
- Authorization is role-based at minimum; per-Project ACLs are supported.
- Audit is tenant-scoped and append-only; audit actor is separate from
  content integrity hash.
- Single-user desktop mode is a degenerate case (one User, one implicit
  Tenant, one Workspace, one Project) — not a separate architecture. This
  matters for development and for the personal/desktop editor experience.

### DEFERRED QUESTIONS

- Exact AuthProvider set supported at launch (Genspark + OIDC? + SAML?
  + email/password?) — deferred to the identity implementation phase
  (section 32 step 1). The foundation decision is the hierarchy + the
  separation of concerns, not the provider list.
- Exact Role/ACL model (RBAC vs. ABAC; custom roles; workspace-scoped vs.
  project-scoped roles) — deferred to the authorization implementation
  (section 32 step 1-2).
- Session/token format (JWT? opaque token? session DB?) — deferred to
  implementation.
- Whether single-user desktop mode is a shipped configuration or just a
  development convenience — deferred to product decision (not
  architecture).

## Decision 5 — Tenant isolation in AI inference

**DECIDED.**

- AI inference is tenant-scoped. AI candidates never see cross-tenant data
  (unless explicitly authorized + audited).
- The tenant context flows from the session -> application service -> AI
  prompt construction -> agent tools.
- `sanitizeAgentPayload` (GenOffice) is applied to all AI payloads crossing
  the boundary.

## Decision 6 — Audit is tenant-scoped and append-only

**DECIDED.**

- Every authority-changing action emits an audit event with: actor, timestamp,
  tenant, authorization context, action, before/after content hash. Audit
  events are tenant-scoped and append-only.
- Audit identity is separate from content integrity hash (master prompt
  section 15).

## Decision 7 — Persistence tier roles (cache vs. derived vs. authoritative)

**DECIDED.** (Reinforces Decision 3 + Q3 Decision.)

- **Authoritative:** PostgreSQL domain authority tables + object-storage
  source artifacts. Immutable-once-finalized revisions; append-only evidence.
- **Derived:** goal current value/status, variance, schedule result (when
  cached), office file representations generated from authorities. Always
  recomputable from authoritative inputs + algorithm version. Never stored
  as the canonical truth.
- **Cache:** `ScheduleResult` cache, computed dashboards, `@genoffice/project-store`
  chat history / recent files / local workspace grouping. Improves
  performance or UX; never the truth. Invalidated/regenerated from
  authorities.
- Nothing in the cache/derived tier may be promoted to authoritative
  without going through the application service + repository + audit.

## Decision 8 — Office engine authority vs. Contractor business authority

**DECIDED.** (Reinforces ADR-0002 and `DOMAIN-AUTHORITY.md` section 4.)

The Office engines are authoritative for **rendering and editing office
files**; they are **never authoritative for Contractor business state**.

| Office engine is authoritative for | Contractor domain is authoritative for |
| --- | --- |
| Rendering a workbook (Univer) | `EstimateRevision` |
| Editing workbook content (Univer + xlsx-gateway) | `ProgrammeRevision` |
| Rendering a deck (pptx-render) | `Goal` (intent) + derived achievement |
| Rendering a doc (docx-engine) | `ProjectActual` |
| Rendering a PDF (pdf.js + PDFium) | `PlanMeasurement` |
| Rendering markdown (Tiptap) | `Bid` |

The boundary is mediated by **domain adapters** (the `WorkbookAdapter`
pattern, extended). The adapter translates between Office representations
and Contractor authorities. The application service finalizes the
authority; the engine never does.

### Univer rule (explicit)

- **Univer** = the Office workbook engine in Sheets (rendering + interaction
  + cell editing). It is **reused** (not removed, not forked).
- **Contractor domain** = the commercial authority (`EstimateRevision`,
  `Bid`, pricing, etc.).
- Univer is **never** the Contractor commercial authority. The
  `WorkbookAdapter` (`getSnapshot`/`plan`/`apply`/`undo`) mediates. The
  application service finalizes the `EstimateRevision` from accepted plans;
  Univer never writes the authority directly.
- The integration boundary permits canonical domain state <-> Office
  representation translation **without** allowing Office state to silently
  rewrite historical authority. (Detailed sync mechanics deferred to
  ADR-0002 Q2.)

## Decision 9 — Project authority (one canonical Project identity)

**DECIDED.** (Resolves the naming collision flagged in `DOMAIN-AUTHORITY.md`
section 5 and Decision 3 above.)

There is **one canonical Project identity**: the Contractor OS Project
(Tenant -> Workspace -> Project). The GenOffice `@genoffice/project-store`
"project" is **not** a Project — it is a local Office/document workspace
representation.

| Concept | Role | Storage |
| --- | --- | --- |
| **Contractor OS Project** | canonical business/project identity; owns {Opportunity, Plans, BOQ, EstimateRevisions, Bids, ProgrammeRevisions, Actuals, Goals} | PostgreSQL (tenant-scoped) |
| **GenOffice project-store entry** | local Office/document workspace representation; groups files + AI chat history for the desktop editor | `@genoffice/project-store` (local JSON/JSONL) |

To avoid silent name collision:

- The Contractor OS entity is named `Project` (canonical).
- The `project-store` entity is named **`LocalWorkspace`** (or
  `DesktopWorkspace`) in Contractor-facing docs and code to distinguish it
  from the canonical `Project`. (Implementation may keep the existing
  `project-store` field names for backward compatibility, but the
  conceptual name is `LocalWorkspace`.)
- A `LocalWorkspace` may be **linked** to a canonical `Project` (a
  `projectId` reference), so a desktop user's local files + chats can be
  associated with the canonical Project. The link is a *reference*, not
  authority: the canonical Project is the truth; the LocalWorkspace is a
  local convenience view of files related to that Project.
- A `LocalWorkspace` may exist without a canonical Project (personal/local
  files not yet promoted to a Project). A canonical Project may exist
  without a LocalWorkspace (created server-side, never opened on a desktop).
- The link is resolved by the desktop client, not by the repository. The
  repository enforces `tenantId`/`projectId` scope on canonical data;
  `project-store` does not enforce (or know about) tenant scope.

This satisfies "there must be one canonical project identity" (master prompt
section 6) without breaking the existing desktop editor convenience.

## Consequences (overall)

- Q3 is DECIDED (PostgreSQL + object storage + project-store as local
  convenience). Q4 is DECIDED (pluggable identity + explicit hierarchy +
  separated concerns).
- Project authority is DECIDED (one canonical Project; project-store is a
  LocalWorkspace).
- Office engine authority is DECIDED (engines authoritative for rendering/
  editing office files; never for Contractor business state).
- Univer is reused, not removed, not the commercial authority.
- The implementation sequence (Identity -> Tenant -> Workspace -> Project ->
  Audit -> Revision framework -> Core API) is unblocked.
- No Contractor feature implementation (Commercial/Programme/Plans/BIM/
  Execution/Goals/AI) begins until the foundation sequence is complete
  (master prompt section 12 implementation gate).

## Verification

- This ADR is design-only. No code, no schema, no migrations are introduced
  by the decision commit.
- Once built: tenant-isolation integration tests (tenant A cannot read/write
  tenant B's data); cross-tenant inference tests; audit tests (every
  authority change emits a tenant-scoped audit event); immutability tests
  (finalized revisions cannot be updated/deleted); Project-authority tests
  (LocalWorkspace link is a reference, not authority).
