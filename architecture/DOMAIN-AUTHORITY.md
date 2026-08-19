# Domain Authority

> **Status: PROPOSED.** Defines the intended domain authorities for Contractor
> GenOffice. These are NOT implemented yet — this document records intent so
> implementation can be held to it. See `RECONNAISSANCE.md` for the evidence
> that GenOffice has no domain-authority layer today.

## 1. Principle

A **domain authority** is the canonical, reconstructable, tenant-scoped record
of truth for a domain. It is:

- **Explicit** — named, with a defined contract.
- **Immutable once finalized** (for revisioned authorities) or **append-only**
  (for evidence authorities).
- **Revisioned** — history is reconstructable from finalized revisions.
- **Tenant-scoped** — every record carries a `tenantId`; isolation enforced at
  the application/domain boundary, never the UI.
- **Separable from representations** — workbooks, Gantt charts, BIM views,
  dashboards are *representations* of authority, not authorities themselves.

## 2. Authority vs. representation

This is the central distinction. GenOffice treats the office file
(`.docx`/`.xlsx`/`.pptx`) as source-of-truth (byte-preserving). Contractor
GenOffice treats the office file as a **representation** of canonical domain
state.

| Concept | Authority | Representation |
| --- | --- | --- |
| Commercial pricing | `EstimateRevision` | estimate workbook (`.xlsx`) |
| Schedule | `ProgrammeRevision` | Gantt chart, `.mpp`/`.xer` import |
| Plan takeoff | `PlanMeasurement` | BIM viewer state, drawing annotations |
| Execution | `ProjectActual` | progress dashboard, field reports |
| Goals | `Goal` (intent) + derived achievement | KPI dashboard |

A representation may be edited; the authority is updated only through the
application service. A representation may be regenerated from the authority;
the reverse is never silently true. (See ADR-0002.)

## 3. The authorities

### 3.1 Commercial — `EstimateRevision`

**Historical commercial truth. Immutable once finalized.**

A finalized `EstimateRevision` captures the canonical estimate at a point in
the commercial lifecycle. It is reconstructable: same inputs + same algorithm
version + same contract = same historical result. Corrections are new
revisions, not edits to finalized ones.

Inputs/evidence feeding an `EstimateRevision`:

- BOQ (bill of quantities) — itself derived from `PlanMeasurement` evidence.
- `EstimateLine` entries (quantity, unit, rate, pricing strategy — see §3.1.1).
- Pricing provenance (`ResourcePriceObservation`, `Recipe`, `CostModel` —
  conceptual; see ADR-0006; NOT introduced in Phase 2A).
- Margin target / bid context.

**Forbidden:** mutating a finalized `EstimateRevision` to "fix" a current
problem. The fix is a new revision.

### 3.1.1 Commercial domain contracts (Phase 2A — ESTABLISHED)

The Commercial domain contracts are now established as pure TypeScript
contracts + deterministic algorithms. See ADR-0007 for the full decision.

**Authority chain:**
```
PlanMeasurement (evidence)
    ↓
BOQ (scope structure)
    ↓
EstimateLine (priced line)
    ↓
EstimateRevision (AUTHORITY — immutable commercial truth)
    ↓
Bid (commercial decision, references EstimateRevision)
```

**Money model:** integer minor units (e.g. cents for GHS/USD, whole yen for
JPY), banker's rounding (round half to even) at the currency's minor-unit
precision. Same-currency arithmetic only. (Phase 2A §8/§9; ADR-0007 Decision 2.)

**Margin vs markup (CRITICAL distinction):**
```
cost          = direct + overhead + risk
sellPrice     = price charged to client
grossProfit   = sellPrice - cost
grossMargin   = grossProfit / sellPrice    (fraction of SELL price)
markup        = grossProfit / cost          (fraction of COST)
```
20% markup ≠ 20% margin. Conversions: `margin = markup/(1+markup)`,
`markup = margin/(1-margin)`. (Phase 2A §8; ADR-0007 Decision 3.)

**EstimateRevision payload + content hash:** the payload (projectId, currency,
policy, lines, note, pricingAlgorithmVersion) is content-hashed using the
Phase 1 canonical `contentHash` function. Same payload + same algorithmVersion
= same content hash → same historical result. Metadata (revisionId, tenantId,
createdBy, createdAt, finalizedAt, status, revisionNumber) is NOT part of the
content hash — it is identity/audit. (Phase 2A §13; ADR-0007 Decision 5.)

**Estimate-level totals:**
```
totalLineCost   = sum(lineCost = quantity × rate)
overhead        = totalLineCost × overheadPct
contingency     = totalLineCost × contingencyPct
totalCost       = totalLineCost + overhead + contingency
totalSellPrice  = sum(lineSellPrice)
totalGrossProfit = totalSellPrice - totalCost
grossMargin     = totalGrossProfit / totalSellPrice
```
(Phase 2A §7; ADR-0007 Decision 6.)

**Bid:** references a finalized EstimateRevision by revisionId +
contentHash. Does NOT duplicate the estimate payload. (Phase 2A §15;
ADR-0007 Decision 7.)

**Code location:** `packages/contractor-core/src/domain/commercial/`.
Pure, zero external deps, zero Electron, zero persistence.

**Office + AI boundaries (architectural rules, not implemented in Phase 2A):**
- Office adapter: EstimateRevision ↔ Office adapter ↔ workbook representation.
  Univer cannot directly mutate EstimateRevision. (Phase 2A §16; ADR-0002 Q2 deferred.)
- AI may produce CandidateEstimateLine/CandidatePrice/CandidateQuantity/
  CandidateBOQLine — but these are suggestions. AI cannot establish
  EstimateRevision or Bid authority. (Phase 2A §17.)

### 3.2 Programme — `ProgrammeRevision` + mutable working Programme

**Historical schedule truth (`ProgrammeRevision`) + user-authored working
state (mutable `Programme`).**

- `ProgrammeRevision` — finalized, immutable. Historical schedule truth.
- `Programme` (mutable) — user-authored working state (activities, durations,
  dependencies, constraints, calendars, resources).
- **Scheduling engine** derives: `start`, `finish`, `float`, `critical path`.
  The engine is deterministic and versioned (Section 14 of ARCHITECTURE.md).
- **The UI is never the scheduling authority.** The UI consumes a
  `ScheduleResult`. Editing derived outputs (start/finish/float) directly is
  forbidden unless represented as scheduling constraints in the domain.

See ADR-0003 for the scheduling-engine decision.

### 3.3 Plans / BIM — source artifacts (evidence) + `PlanMeasurement` (evidence)

**Immutable source artifacts are evidence. `PlanMeasurement` is measured
evidence — not commercial authority.**

A `PlanMeasurement` preserves:

- source artifact (IFC/PDF/DXF/DWG reference + hash)
- sheet / sheet revision
- element reference
- quantity
- unit
- measurement method
- measurement basis
- measurement engine version
- actor
- timestamp

The system answers: *What was measured? From which artifact? Which revision?
How? By whom? Using what algorithm?* (Section 20.)

Browser measurement may be **provisional**. The authoritative record passes
through the application/domain boundary. AI may propose measurements; AI may
not silently establish commercial authority.

See ADR-0004 for the BIM viewer strategy.

### 3.4 Execution — `ProjectActual` (append-only evidence)

**Execution evidence is append-only.**

`ProjectActual` records what actually happened (costs, progress, dates,
quantities installed). It does **not** rewrite estimate or schedule history.
Variance is *derived* from `EstimateRevision` vs. `ProjectActual`, not stored
as a separate mutable truth.

### 3.5 Goals — `Goal` (intent) + derived achievement

**Goals are explicit business intent. Current achievement is derived from
authoritative history — never stored as duplicate mutable KPI truth.**

A `Goal` contains:

- metric (e.g. `average_gross_margin`, `estimate_variance`, `bid_hit_rate`,
  `overdue_receivables`)
- target (e.g. `>= 20%`, `<= 5%`, `>= 35%`, `<= 10%`)
- period
- scope (tenant / workspace / project / team)
- current value (derived)
- forecast (derived)
- status (`on_track` / `at_risk` / `off_track`, derived)

The system explains *why* a goal is on track / at risk / off track and
identifies drivers (variance from `ProjectActual` vs. `EstimateRevision`,
etc.).

**Forbidden:** storing a mutable `current_value`/`status` as the truth. They
are derived; only the `Goal` (intent: metric/target/period/scope) is stored as
intent.

## 4. Project identity (one canonical Project)

There is **one canonical Project identity**: the Contractor OS Project
(Tenant -> Workspace -> Project). It owns {Opportunity, Plans, BOQ,
EstimateRevisions, Bids, ProgrammeRevisions, Actuals, Goals}.

The GenOffice `@genoffice/project-store` entry is **not** a Project. It is
renamed conceptually to **`LocalWorkspace`** — a local Office/document
workspace representation (groups files + AI chat history for the desktop
editor). A `LocalWorkspace` may be **linked** to a canonical `Project` by a
`projectId` reference, but the link is a reference, not authority:

- The canonical Project is the truth (PostgreSQL, tenant-scoped).
- The LocalWorkspace is a local convenience view (filesystem, no tenant scope).
- A LocalWorkspace may exist without a canonical Project (personal/local
  files not yet promoted). A canonical Project may exist without a
  LocalWorkspace (created server-side, never opened on a desktop).
- The link is resolved by the desktop client; the repository enforces
  `tenantId`/`projectId` scope on canonical data only.

This resolves the naming collision flagged in Phase 0. See ADR-0005 Decision 9.

## 5. Office engine authority vs. Contractor business authority

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
pattern, extended to all Office engines). The adapter translates between
Office representations and Contractor authorities. The application service
finalizes the authority; the engine never does.

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

See ADR-0005 Decision 8.

## 6. The project graph (authoritative connections)

```
PLAN / BIM artifact (evidence)
  -> PlanMeasurement (evidence)
    -> BOQ
      -> EstimateLine
        -> EstimateRevision (authority)
          -> Bid
            -> ProgrammeActivity (mutable working)
              -> ProgrammeRevision (authority, when finalized)
                -> Execution
                  -> ProjectActual (append-only evidence)
                    -> Variance (derived)
                      -> Goal achievement (derived)
                        -> Learning / calibration (derived, feeds future estimates)
```

Connections are explicit. Domains do not collapse.

## 7. What is NOT authoritative

These are convenience representations. They are allowed but never the truth:

- UI state (selected project, open tab, scroll position)
- cached schedule (the `ScheduleResult` cache; the `Programme` working state
  + engine version is the truth)
- spreadsheet cells (the workbook is a representation of `EstimateRevision`)
- AI output (candidates only)
- BIM viewer state (a representation of `PlanMeasurement` + source artifact)
- drawing annotations (provisional until promoted through the boundary)
- imported rates (provenance-tracked; do not silently become the
  `EstimateRevision`)
- reconciliation caches
- derived dashboards (derived from authorities)
- Electron local state (`@genoffice/project-store` is a local convenience store
  for chat history + recent files — **not** a domain authority)
- Office files (`.xlsx`/`.docx`/`.pptx`/`.pdf`/`.md`) — representations,
  not authorities (see section 5; ADR-0002)
- Univer workbook model — a representation, not the commercial authority
  (see section 5; ADR-0005 Decision 8)

## 8. Persistence tiers (authoritative / derived / cache)

Per ADR-0005 Q3 Decision, persistence is divided into three tiers:

- **Authoritative** (PostgreSQL + object storage): canonical truth.
  Immutable-once-finalized revisions; append-only evidence; tenant-scoped.
- **Derived** (PostgreSQL cache tables or in-memory): recomputable from
  authoritative inputs + algorithm version. Examples: goal current value,
  variance, schedule result (when cached), office file representations
  generated from authorities. Never stored as canonical truth.
- **Cache / local convenience** (`@genoffice/project-store`, in-memory,
  CDN): improves performance or UX; never the truth. Examples: chat history,
  recent files, local workspace grouping, `ScheduleResult` cache.

Nothing in the cache/derived tier may be promoted to authoritative without
  going through the application service + repository + audit.

## 9. Revision framework (applies to all revisioned authorities)

For every revisioned authority:

- **Identity**: stable ID (e.g. `est_<hash>`, `prog_<hash>`).
- **Content hash**: canonicalized content hash (deterministic serialization).
  Identifies content; does NOT establish authorship.
- **Algorithm version**: the deterministic algorithm + contract version that
  produced derived fields (e.g. scheduling engine version for `ProgrammeRevision`).
- **Inputs**: references to the authoritative inputs (BOQ, measurements, etc.).
- **Audit**: actor, timestamp, authorization context, action (finalize / correct
  / supersede). Separate from content hash.
- **Immutability**: finalized revisions cannot be updated or deleted by the
  repository. Corrections are new revisions that supersede.

**Repository contract** (Section 35 of the master prompt): immutable-revision
repositories must NOT expose `update`/`delete` for finalized records.

### 9.1 Revision immutability model (Phase 1.1 — hardened)

The distinction between **content/identity immutability** and **controlled
lifecycle transition** is enforced at the database level (not merely by
repository convention):

```
Revision content/identity fields  = IMMUTABLE after finalization
Revision lifecycle status         = controlled state transition
```

**Immutable fields** (cannot change once the revision is finalized; any
UPDATE attempting to change them — including during a finalized→superseded
transition — is rejected by a database trigger):

- `revision_id` (primary key)
- `tenant_id`
- `project_id`
- `authority_kind`
- `revision_number`
- `created_by`
- `created_at`
- `algorithm_version`
- `content_hash`
- `parent_revision_id`
- `finalized_at`

**Mutable field** (controlled lifecycle only):

- `status` — the only field that may change after finalization, and only
  for the approved transition: `finalized → superseded`.

**Allowed state machine:**

```
draft     → finalized    (finalize)
draft     → superseded   (discard without finalizing)
finalized → superseded   (a newer finalized revision supersedes it)
```

**Forbidden:**

- `finalized → draft` (cannot "un-finalize")
- `superseded → anything` (terminal state — no UPDATE at all)
- Any UPDATE that changes a content/identity field on a non-draft revision
- Any DELETE on a finalized/superseded revision

The database trigger (`block_immutable_revision_update`) enforces that
during the `finalized → superseded` transition, **only `status` may
change** — every other field is compared `OLD IS DISTINCT FROM NEW` and
the UPDATE is rejected if any differ. This prevents the audit-identified
bypass where a single `UPDATE ... SET content_hash='X', status='superseded'`
could rewrite historical truth.

### 9.2 Revision-number allocation (Phase 1.1 — concurrency-safe)

Revision numbers are allocated from a dedicated `revision_counters` table
(one row per `(tenant_id, project_id, authority_kind)`). Allocation is a
single atomic `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` statement
inside the transaction — no `SELECT MAX()+1` race window, no serialization
failures, no retry needed. Concurrent `createDraft` calls for the same
`(tenant, project, authorityKind)` each receive a unique sequential number.
(Phase 1.1 H1 fix.)

## 10. Determinism & canonical hashing

- Canonical calculations use canonicalized content (stable key ordering, no
  unstable fields, deterministic serialization).
- One serialization rule per domain. Do not invent multiple rules for the same
  domain.
- Content hash identifies content. Authorship/authorization/actor identity live
  in audit events. (Section 15 of ARCHITECTURE.md.)

## 11. What does NOT exist yet (gap)

GenOffice has **none** of these authorities. `@genoffice/project-store` is a
local-filesystem convenience store for chat history + file groupings. The
Contractor OS domain authorities are a **new layer** to be built — tenant-
scoped, PostgreSQL-backed, behind application services, with the revision
framework above.

The foundation decisions (Phase 0.5: Q1 runtime, Q3 persistence, Q4
identity) unblock the implementation sequence: Identity -> Tenant ->
Workspace -> Project -> Audit -> Revision framework -> Core API (see
ARCHITECTURE.md section 13).
