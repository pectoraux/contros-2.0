# Boundaries

> **Status: PROPOSED.** The boundary rules. Enforced by code review; where
> safe, encoded as architecture tests (Section 29 of ARCHITECTURE.md).

## 1. The canonical boundary

```
UI (React, Electron renderer OR web)
  -> API Adapter (typed, validated; zod)
  -> Application Service (authorization, tenant validation,
                          transactions, orchestration, audit)
  -> Repository (persistence mechanics only)
  -> Database (tenant-scoped)
```

Every request crosses every layer. No layer is skipped.

## 2. Layer responsibilities

### UI

- Consumes typed contracts (API adapter types).
- Never touches Prisma, the database, or repositories.
- Never contains business rules.
- State management: UI-only state is fine (selected tab, modal open). Domain
  state is fetched from the API.
- For Contractor domain workspaces: the UI is a *representation* of canonical
  state. Editing a workbook cell does not write `EstimateRevision` directly —
  it proposes a change that the application service finalizes.

### API Adapter

- The only entry point to application services (for both the web client
  and the Electron main process — ADR-0001 Decision 4).
- Typed request/response contracts.
- Validates input (zod end-to-end, as GenOffice already does for sheets).
- Authentication + tenant context extraction (from session/token, never from
  URL params or client-selected project IDs).
- No business logic — pure translation.

### Application Service

- Owns: authorization, tenant validation, transactions, business orchestration,
  audit.
- Calls repositories for persistence.
- Calls pure domain functions for deterministic algorithms.
- Calls adapters to mediate external engines (Univer, scheduling, BIM viewer).
- Finalizes AI candidates into authorities (AI never finalizes directly).
- Emits audit events for every authority-changing action. The audit
  event commits in the **same database transaction** as the business
  mutation (ADR-0007 Decision 18 — Audit Atomicity). If either fails, both
  roll back. No outbox, no audit-later, no eventual consistency for
  authority changes.

### Repository

- Owns persistence mechanics only (CRUD, queries, transactions as instructed by
  the service).
- **No business logic.**
- For immutable-revision authorities: exposes `create` + `read`. Does NOT expose
  `update`/`delete` for finalized records (Section 35 of ARCHITECTURE.md).
- Enforces tenant scope at the query level (every query is tenant-scoped).

### Pure domain functions

- Deterministic algorithms: CPM scheduling, pricing math, hash
  canonicalization, variance calculation, goal-achievement derivation.
- No I/O. No side effects. Unit-tested in isolation.
- Versioned (algorithm version recorded with revisions).

### Adapters

- Mediate between external engines and the domain.
- `WorkbookAdapter` (GenOffice pattern, REUSE): `getSnapshot`/`plan`/`apply`/
  `undo` — keeps Univer <-> EstimateRevision representation replaceable.
- BIM viewer adapter: mediates web-ifc/ThatOpen <-> `PlanMeasurement` +
  source artifact.
- Schedule IO adapter: mediates MPXJ (.mpp/.xer/.pmxml) <-> `ProgrammeRevision`
  representation (MPXJ is never the scheduling authority).

## 3. Identity layers (explicitly separated)

Per ADR-0005 Q4 Decision, four concerns are explicitly separated:

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

The canonical identity hierarchy: User -> Organization/Tenant ->
Membership -> Workspace -> Project. Genspark account auth is one
AuthProvider integration, NOT the tenant authority.

## 4. Persistence tiers (mandatory)

Per ADR-0005 Q3 Decision, persistence is divided into three tiers. The
boundary rules apply to each tier:

- **Authoritative** (PostgreSQL + object storage): written only by
  repositories, only through application services, only with audit. Tenant-
  scoped. Immutable-once-finalized revisions; append-only evidence.
- **Derived** (PostgreSQL cache tables or in-memory): recomputable from
  authoritative inputs + algorithm version. May be invalidated/regenerated
  at any time. Never the canonical truth.
- **Cache / local convenience** (`@genoffice/project-store`, in-memory,
  CDN): improves performance or UX. Never the truth.

**Forbidden:**

- Writing to the authoritative tier outside an application service +
  repository + audit.
- Treating cache/derived as authoritative (promoting without the service
  boundary).
- Letting `@genoffice/project-store`, an Office file, a spreadsheet, a BIM
  viewer, or AI state become a second source of domain truth.

### 4.1 Cascade / retention model (Phase 1.1 — C2 fix)

Historical authority must never be destroyed accidentally by a parent
deletion. The foundation schema classifies every foreign key:

| FK | Cascade rule | Classification | Rationale |
| --- | --- | --- | --- |
| `auth_provider_bindings.user_id → users` | ON DELETE CASCADE | SAFE CASCADE | Auth bindings are convenience identity, not historical authority. Deleting a user cleans up their bindings. |
| `memberships.user_id → users` | ON DELETE CASCADE | SAFE CASCADE | Memberships are not historical authority; deleting a user revokes their memberships. |
| `memberships.organization_id → organizations` | ON DELETE CASCADE | SAFE CASCADE | An org's memberships are not historical authority. |
| `workspaces.organization_id → organizations` | ON DELETE CASCADE | SAFE CASCADE | Workspaces are not historical authority (they are organizational containers). |
| `projects.workspace_id → workspaces` | ON DELETE CASCADE | SAFE CASCADE | Projects are not historical authority (they are business identity, but not immutable history). |
| `revisions.project_id → projects` | **ON DELETE RESTRICT** | **RESTRICT (historical)** | Revisions ARE historical authority. A project with revisions cannot be hard-deleted. Soft-delete (status='archived') is used instead. |

**Rule:** any table that holds historical authority (revisions, audit_events,
future `PlanMeasurement`, `ProjectActual`) must use `ON DELETE RESTRICT` (or
have no FK) to its parent — never `ON DELETE CASCADE`. Audit_events has no FK
to organizations (it uses `tenant_id` as a plain column), so it survives any
parent deletion.

**Soft-delete policy:** organizations, workspaces, and projects are
soft-deleted (status flag: `active`/`disabled`/`archived`) rather than
hard-deleted. No application service exposes hard deletion of these
entities. Hard deletion is only possible via raw SQL, and the RESTRICT
constraint on `revisions.project_id` prevents it when revisions exist.

## 5. Forbidden crossings

| From | To | Forbidden? | Why |
| --- | --- | --- | --- |
| UI | Prisma / DB | **YES** | UI cannot own persistence; breaks tenant isolation |
| Route | business rules | **YES** | Routes are transport; rules live in services |
| AI | canonical mutation | **YES** | AI is advisory (Section 22/25); services finalize |
| Parser (xlsx/ifc) | canonical commercial mutation | **YES** | Parsers produce candidates/evidence; services finalize |
| Viewer | direct persistence | **YES** | Viewers render; persistence goes through services |
| Application service | raw SQL bypassing repository | **YES** | Services use repositories; repositories own persistence |
| Repository | business rules | **YES** | Repositories are mechanics only |
| Cross-domain direct mutation (e.g. Programme writes Commercial field) | | **YES** | Domains connect through explicit application-service orchestration |
| AI-generated HTML | renderer capabilities | **YES** | GenOffice already enforces (hostile BrowserWindow) |

## 6. Tenant boundary (mandatory)

- Every application-service call carries a resolved `tenantId` from the
  authenticated session — **never** from a URL param, request body, or
  client-selected project ID.
- Every repository query is tenant-scoped at the query level (WHERE tenant_id
  = ?), not at the UI filter level.
- Cross-tenant data never participates in: matching, pricing, scheduling, plan
  linkage, goal calculation, AI inference — unless explicitly designed and
  authorized (e.g. a tenant-admin cross-tenant report, which itself goes
  through an audited service).
- The boundary is enforced at the **application/domain boundary**, not the UI.

This is the single biggest gap in the current GenOffice codebase (no tenant
concept exists anywhere — see RECONNAISSANCE.md section 6/7). ADR-0005 owns
the resolution.

## 7. AI boundary (advisory only)

GenOffice already implements the advisory-AI pattern (RECONNAISSANCE.md
section 8):

```
cloud planner -> untrusted command DSL -> local validation + dry-run
            -> user approval -> atomic commit (business mutation + audit
                                   in ONE transaction — ADR-0007 D18)
```

Contractor GenOffice inherits this. Specifically:

- AI produces: candidate / suggestion / draft / explanation.
- AI never produces: finalized `EstimateRevision`, finalized
  `ProgrammeRevision`, historical revision, finalized `Bid`.
- AI-originated domain changes are auditable (actor, timestamp, AI model,
  prompt hash, accepted/rejected).
- `sanitizeAgentPayload` (GenOffice) is applied to all AI payloads crossing
  the boundary.

## 8. Office substrate boundary

The Office engines (`docx-engine`, `pptx-engine`, `xlsx-engine`, `pdf.js`,
Tiptap) are the Office substrate. They treat the office file as
source-of-truth (byte-preserving). For Contractor OS:

- The office file is a **representation** of canonical domain state.
- Editing the workbook edits the representation; the application service
  finalizes the `EstimateRevision`.
- The `WorkbookAdapter` pattern mediates: AI planning, transaction safety,
  and audit behavior stay replaceable if the editor changes (GenOffice
  sheets `architecture.md`).
- **Office engines are authoritative for rendering/editing office files**;
  they are **never authoritative for Contractor business state**
  (ADR-0005 Decision 8, `DOMAIN-AUTHORITY.md` section 5). The Univer rule:
  Univer is reused (not removed, not forked) as the workbook engine; the
  `WorkbookAdapter` mediates; the application service finalizes the
  `EstimateRevision`; Univer never writes the authority directly.

See ADR-0002 for the reconciliation decision (Q2 detailed mechanics
deferred to the Commercial phase).

## 9. External engine boundary

External engines are components, not authorities:

| Engine | Role | Authority? |
| --- | --- | --- |
| Univer (sheets UI) | spreadsheet renderer + interaction | no — `WorkbookAdapter` mediates |
| Rust xlsx sidecar (calamine/IronCalc) | xlsx IO + calc | no — IO only |
| MPXJ (potential) | schedule file IO (.mpp/.xer/.pmxml) | no — never the scheduling engine |
| web-ifc / ThatOpen (potential) | IFC/BIM viewing + geometry | no — viewer + measurement candidate source |
| Gantt library (potential) | Gantt UI primitive | no — rendering only; never CPM |
| Genspark proxy | AI model transport | no — transport; tenant-scoped creds |
| IfcOpenShell (potential, server-side) | isolated IFC geometry processing | no — isolated service |

A Gantt library is **never** the scheduling engine. The UI consumes a
`ScheduleResult` and does not calculate CPM.

## 10. `ee/` boundary

`ee/` is a reserved enterprise-license boundary (RECONNAISSANCE.md section 12).
No Contractor domain authority lives there. The Apache-2.0 core stays plain.
CODEOWNERS (GenOffice) enforces no external PRs to `ee/`.

## 11. Security boundary (inherits GenOffice)

Inherited as-is (RECONNAISSANCE.md section 4):

- Renderer lockdown (`contextIsolation`, no `nodeIntegration`, `sandbox`).
- zod-validated IPC.
- `safeExternalUrl` protocol allowlist.
- AST interpreter for AI layout scripts (not eval/Function/VM).
- Hostile BrowserWindow for AI HTML rendering.
- No hardcoded keys; user keys in OS settings store.

Contractor additions must not weaken these.

## 12. Runtime boundary (web + Electron share one Core)

Per ADR-0001 Decision 4 (Option C / Hybrid):

- **Contractor Core has zero Electron dependency.** Application services,
  repositories, pure domain functions, and the Core API are runtime-
  agnostic.
- The **Electron main process is one client** of the Core API (via a
  main-process Core client), not the host of it.
- The **web client is another client** of the same Core API.
- Both surfaces share one spine: identity, tenant, project graph,
  authorities, audit.
- Electron adds: filesystem integration, offline cache, native dialogs,
  auto-update. It does **not** add a second database, a second identity
  model, or a second authority.
- Deep web editing of `.xlsx`/`.pptx`/`.docx` is deferred (Phase-1 web
  surfaces are the Contractor domain workspaces; deep office editing stays
  on Electron desktop until the Office-render adapter is built).

## 13. Architecture tests (where safe to encode now)

Encode in CI/tests where the existing repository structure makes it safe:

- UI cannot import Prisma / `@prisma/client` / `db`.
- Routes (`apps/*/src/main` IPC handlers) cannot contain business rules
  (heuristic: no direct `EstimateRevision`/`ProgrammeRevision` mutation).
- Programme service cannot mutate Commercial authority fields.
- Plan service cannot bypass the repository.
- AI module cannot call `finalize*Revision` repository methods.
- Tenant boundary: every repository method takes a `tenantId` (or a context
  containing one).
- Immutable-revision repositories expose no `update`/`delete` for finalized
  records.
- Protected packages cannot gain disallowed licenses (extend GenOffice's
  `tools/check-licenses.mjs`).

Do not add complex enforcement until the existing structure is understood
(Section 29 of ARCHITECTURE.md). The first baseline commit adds only the
documents + the existing license gate (already present).

## 14. Hard stops

If implementation would require crossing a forbidden boundary, or weakening
an invariant: **STOP. REPORT.** Do not silently redesign. (ARCHITECTURE.md
section 2.)
