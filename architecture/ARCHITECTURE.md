# Contractor GenOffice Architecture

> **Status: PROPOSED.** This document is the proposed architectural constitution
> for Contractor GenOffice. It is **not automatically authoritative** until
> reviewed and accepted by the Principal Architect. Items marked `UNRESOLVED`
> require an explicit decision before implementation. The evidence base is
> `architecture/RECONNAISSANCE.md`.

## 0. What this is

Contractor GenOffice is a unified, multi-tenant operating system for
project-based businesses, built on a verified fork of GenOffice
(`pectoraux/contros-2.0` <- `genspark-ai/genoffice`). The first vertical is
Construction; the platform must remain open to future trades
(electrical, mechanical, plumbing, HVAC, fabrication, field services).

GenOffice supplies the Office substrate (Docs, Sheets, Slides, PDF,
Markdown, shell, agent infrastructure, AI provider abstraction, search
utilities). Contractor GenOffice adds the domain layer (Commercial,
Programme, Plans/BIM, Execution, Goals, Knowledge, AI candidates) **on top**,
without creating competing sources of truth and without forking the
upstream Office engines.

## 1. Governing priority (non-negotiable)

```
correctness
> architectural integrity
> historical correctness
> auditability
> determinism
> tenant isolation
> interoperability
> maintainability
> speed
> feature count
```

A higher-ranked invariant is never sacrificed for a lower-ranked convenience.

## 2. The constitution — non-negotiable invariants

These invariants outrank any local implementation preference. If
implementation appears to conflict with one: **STOP. REPORT.** Do not
silently redesign.

1. **One product, one identity, one tenant model, one project graph, one
   audit model, one domain-authority model.** No disconnected applications,
   databases, or UX systems per capability.
2. **Source-of-truth discipline.** Before every change ask: *what is
   authoritative?* Then ask: *does this create a second authority?* If yes:
   STOP. Convenience representations (UI state, cached schedule,
   spreadsheet cells, AI suggestions, BIM viewer state, derived dashboards)
   are allowed; second authorities are not.
3. **Domain authorities are explicit, immutable, revisioned, tenant-scoped.**
   `EstimateRevision`, `ProgrammeRevision`, `PlanMeasurement`,
   `ProjectActual`, `Goal`. Finalized revisions are never mutated to fix
   current state — corrections are new revisions / new evidence / new events.
4. **The Office file is a representation, not the domain authority.** GenOffice
   treats `.docx`/`.xlsx`/`.pptx` as source-of-truth (byte-preserving). For
   Contractor OS, the office file is a *representation* of canonical domain
   state. The `EstimateRevision` is authoritative; the estimate workbook is a
   view of it. (See ADR-0002.)
5. **Tenant isolation is infrastructure, enforced at the application/domain
   boundary — never at the UI/route layer.** Cross-tenant data never
   participates in matching, pricing, scheduling, plan linkage, goal
   calculation, or AI inference unless explicitly designed and authorized.
6. **The boundary is UI -> API adapter -> application service -> repository ->
   database.** UI never touches Prisma. Routes never contain business rules.
   AI never mutates canonical truth directly. Viewers never persist directly.
7. **Determinism.** Commercial and scheduling logic is deterministic, replayable,
   explainable, versioned, testable. No unstable wall clock, randomness, mutable
   external state, or unstable DB ordering in canonical content calculations.
8. **AI is advisory.** AI output is candidate / suggestion / draft / explanation.
   It never silently becomes finalized commercial, schedule, or historical
   truth. All AI-originated domain changes are auditable. (GenOffice already
   implements this pattern — REUSE.)
9. **External engines are components, not authorities.** Univer, MPXJ, web-ifc,
  ThatOpen, Gantt libraries, Genspark proxy: usable as engines/renderers/IO,
  never as the domain authority.
10. **Licensing is an architecture gate.** Permissive only (MIT/Apache/BSD/ISC/
    0BSD/Zlib/MPL/LGPL/Unicode/OFL) in the core product. GPL/AGPL/CPAL excluded.
    `ee/` is a reserved enterprise-license boundary — no Contractor domain
    authority lives there. The fork must rebrand (GenOffice/Genspark are
    Mainfunc trademarks).
11. **Upstream is pinned, not tracked.** No silent absorption of upstream
    architectural changes. Fetch -> diff -> license scan -> architecture review
    -> test -> intentional merge.
12. **Legacy Contros is reference material.** Port behavior and contracts, not
    implementation boundaries.

## 3. Product structure (target)

```
                    CONTRACTOR GENOFFICE
                            |
          +-----------------+------------------+
          |                 |                  |
       OFFICE            WORK CORE         INTELLIGENCE
          |                 |                  |
 Docs/Sheets/etc.       Projects            Goals
                        Opportunities       Knowledge
                        Teams               AI
                        Customers
          |
          +--------------------------------------+
                                                 |
                  DOMAIN WORKSPACES              |
        +----------+----------+----------+------+
        |          |          |          |
    COMMERCIAL  PROGRAMME  PLANS/BIM  EXECUTION
        |          |          |          |
      BOQ       Gantt/CPM   IFC/PDF/DXF  Actuals
      Estimate  Resources   Takeoff      Variance
      Bid       Baselines   Measurements Progress
      Pricing   Progress    BIM
        |          |          |          |
        +----------+----------+----------+
                   |
             PROJECT GRAPH
                   |
                 TENANT
```

The Office substrate (GenOffice) sits to the left. The Work Core and
Intelligence layers are Contractor additions. Domain Workspaces are
Contractor additions. Everything resolves against one Project Graph under
one Tenant.

## 4. Core project graph (target)

```
Tenant
  |
Workspace
  |
Project
  |- Opportunity
  |- Documents
  |- Plans
  |- BOQ
  |- EstimateRevisions
  |- Bids
  |- ProgrammeRevisions
  |- Actuals
  +- Goals
```

Longer-term construction flow:

```
PLAN / BIM
  -> PLAN MEASUREMENT EVIDENCE
  -> BOQ
  -> ESTIMATE LINE
  -> ESTIMATE REVISION
  -> BID
  -> PROGRAMME ACTIVITY
  -> PROGRAMME REVISION
  -> EXECUTION
  -> PROJECT ACTUAL
  -> VARIANCE
  -> GOALS / LEARNING
```

These domains are connected but do not collapse into one model. The
connections are explicit (see `DOMAIN-AUTHORITY.md`).

## 5. Layered architecture

```
UI (React, Electron renderer OR web)
  -> API Adapter (typed, validated; zod)
  -> Application Service (authorization, tenant validation,
                          transactions, orchestration, audit)
  -> Repository (persistence mechanics only)
  -> Database (tenant-scoped)
```

Plus:

- **Pure domain functions** — deterministic algorithms (CPM scheduling, pricing
  math, hash canonicalization). No I/O. Unit-tested in isolation.
- **Adapters** — mediate between engines and the domain (e.g.,
  `WorkbookAdapter` for Univer <-> EstimateRevision representation).
- **Repositories** — own persistence mechanics. **No business logic.**
- **Application services** — own authorization, tenant validation,
  transactions, business orchestration, audit.

**Forbidden:**

- UI -> Prisma / direct DB
- Route -> business rules
- AI -> direct canonical mutation
- Parser (xlsx/ifc/...) -> canonical commercial mutation
- Viewer -> direct persistence

## 6. GenOffice substrate — what we keep

Contractor GenOffice **does not rebuild** the Office substrate. GenOffice
provides:

- **Docs** (`docx-engine`) — byte-preserving `.docx` round-trip.
- **Sheets** (Univer + Rust sidecar + `xlsx-gateway`) — `.xlsx` with
  `WorkbookAdapter` (`getSnapshot`/`plan`/`apply`/`undo`) mediating.
- **Slides** (`pptx-engine`/`pptx-render`) — `.pptx`.
- **PDF** (pdf.js + pdf-lib + PDFium) — true text editing.
- **Markdown** (Tiptap) — `.md`.
- **Shell** — Electron tab host, theming, auto-update.
- **`agent-core`** — `AgentLoop`, `AgentSkill`, `sanitizeAgentPayload`.
- **`ai-provider`** — provider abstraction, streaming, watchdog.
- **`ai-search`** — gsk/Serper/DuckDuckGo search.
- **`electron-utils`** — `safeExternalUrl`, context-menu, app-menu.
- **`ui` / `i18n`** — shared kit + tokens.
- **License gates** — `tools/check-licenses.mjs`, `cargo-deny`.
- **Security posture** — renderer lockdown, zod IPC, AST interpreter for AI
  scripts, hostile BrowserWindow for AI HTML.

All Apache-2.0. See `RECONNAISSANCE.md` for the full REUSE/ISOLATE/EXTEND/
REPLACE/DO-NOT-TOUCH classification.

## 7. Contractor additions — what we build

- **Tenant / Workspace / Project graph** (identity + persistence).
- **Domain authorities**: `EstimateRevision`, `ProgrammeRevision`,
  `PlanMeasurement`, `ProjectActual`, `Goal` — immutable, revisioned,
  tenant-scoped, DB-backed.
- **Scheduling engine** (own, deterministic CPM) — Programme domain.
- **Plan/BIM viewer** (web-ifc / ThatOpen) — Phase 1 view/measure/takeoff.
- **Pricing knowledge base** (conceptual — schema deferred; ADR-0006).
- **Tenant-scoped AI credential resolution + audit.**
- **Web deployment path** (UNRESOLVED — see ADR-0001 Q1).
- **Rebranding** (trademark requirement).

No Contractor feature implementation begins until this freeze is reviewed.

## 8. Boundary map (summary)

See `BOUNDARIES.md` for the full rules. Summary:

- UI consumes contracts; never owns domain truth.
- API adapters are the only entry point to application services.
- Application services own authorization + tenant scope + transactions + audit.
- Repositories own persistence only.
- Pure functions own deterministic algorithms.
- AI produces candidates; application services finalize.
- External engines (Univer, MPXJ, web-ifc) are mediated by adapters; never
  authoritative.
- `ee/` is off-limits for domain authority.

## 9. Domain authorities (summary)

See `DOMAIN-AUTHORITY.md` for the full map. Summary:

| Domain | Authority | Mutability | Storage |
| --- | --- | --- | --- |
| Commercial | `EstimateRevision` | immutable once finalized | tenant-scoped DB |
| Programme | `ProgrammeRevision` (immutable) + mutable working Programme | immutable revisions; mutable working state | tenant-scoped DB |
| Plans/BIM | source artifacts (evidence) + `PlanMeasurement` (evidence) | append-only | tenant-scoped DB + blob store |
| Execution | `ProjectActual` (append-only evidence) | append-only | tenant-scoped DB |
| Goals | `Goal` (explicit intent); achievement derived | intent mutable; achievement derived | tenant-scoped DB |

## 10. Revision & determinism rules

- **Revision rule**: same authoritative inputs + same algorithm version + same
  contract = same historical result. Never mutate historical revisions to fix
  current state; corrections are new revisions / new evidence / new events.
- **Determinism rule**: canonical calculations use canonicalized content, stable
  ordering, no wall clock / randomness / mutable external state.
- **Historical hashing**: content hashes identify content. Authorship,
  authorization, actor identity belong to audit events. Keep them separate.

## 11. ADR index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](ADR/0001-foundation.md) | Fork foundation, upstream pin, web-vs-electron | PROPOSED (Q1 UNRESOLVED) |
| [0002](ADR/0002-domain-authority.md) | Domain authority vs. office-file-as-source-of-truth | PROPOSED |
| [0003](ADR/0003-programme.md) | Programme domain & scheduling engine | PROPOSED |
| [0004](ADR/0004-plan-bim.md) | Plans/BIM domain & viewer strategy | PROPOSED |
| [0005](ADR/0005-multitenancy.md) | Multi-tenancy: identity, persistence, isolation | PROPOSED (multiple UNRESOLVED) |
| [0006](ADR/0006-goals-learning.md) | Goals, pricing knowledge, learning/calibration | PROPOSED (schema deferred) |

## 12. Open architectural questions (require decision before implementation)

These are tracked in detail in the ADRs. Summary:

- **Q1** (ADR-0001): Is "web is primary" real for v1, or is Electron-first
  acceptable with web deferred? GenOffice is Electron-only today. The answer
  changes the scope of the identity/persistence/UI work by an order of
  magnitude.
- **Q2** (ADR-0002): Exact reconciliation between byte-preserving office-file
  authority (GenOffice) and revisioned domain authority (Contractor OS).
- **Q3** (ADR-0005): Canonical persistence technology (PostgreSQL? SQLite-per-
  tenant? something else?). Recon shows none exists today.
- **Q4** (ADR-0005): Identity model — replace Genspark account auth with
  tenant auth, or wrap it?
- **Q5** (ADR-0003): Build scheduling engine from scratch vs. port from legacy
  Contros (reference) vs. embed an external engine behind an adapter.
- **Q6** (ADR-0004): web-ifc / ThatOpen vs. alternative for Phase 1 BIM viewer.
- **Q7** (ADR-0006): When does pricing-knowledge schema become real? (Default:
  not yet — conceptual only.)

## 13. Change management

Before modifying a frozen area, record internally:

```
Current invariant
Proposed change
Why current architecture cannot satisfy requirement
Alternative considered
Replayability risk
Auditability risk
Tenant-isolation risk
Commercial-truth risk
Migration strategy
Regression strategy
```

Do not weaken a foundation merely because a feature would be easier.

## 14. Operating principle

```
The architecture is the constitution.
The repository is the evidence.
The tests are the proof.
The domain authorities are explicit.
The history is immutable.
The tenant boundary is mandatory.
AI is advisory.
Office is a substrate.
External engines are components, not authorities.
Legacy Contros is reference material.
```

When uncertain: **INSPECT. DOCUMENT. STOP.** Do not guess.
