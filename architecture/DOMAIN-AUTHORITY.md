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
- `EstimateLine` entries (resource, quantity, unit, rate, markup).
- Pricing provenance (`ResourcePriceObservation`, `Recipe`, `CostModel` —
  conceptual; see ADR-0006).
- Margin target / bid context.

**Forbidden:** mutating a finalized `EstimateRevision` to "fix" a current
problem. The fix is a new revision.

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

## 4. The project graph (authoritative connections)

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

## 5. What is NOT authoritative

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

## 6. Revision framework (applies to all revisioned authorities)

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

## 7. Determinism & canonical hashing

- Canonical calculations use canonicalized content (stable key ordering, no
  unstable fields, deterministic serialization).
- One serialization rule per domain. Do not invent multiple rules for the same
  domain.
- Content hash identifies content. Authorship/authorization/actor identity live
  in audit events. (Section 15 of ARCHITECTURE.md.)

## 8. What does NOT exist yet (gap)

GenOffice has **none** of these authorities. `@genoffice/project-store` is a
local-filesystem convenience store for chat history + file groupings. The
Contractor OS domain authorities are a **new layer** to be built — tenant-
scoped, DB-backed, behind application services, with the revision framework
above.

This is the single largest body of work in the implementation sequence
(Section 32 of ARCHITECTURE.md): identity + tenancy -> Core API -> project
graph -> shared domain contracts -> audit -> revision framework -> port
commercial -> port programme -> goals -> plan/BIM -> ... .
