# ADR-0003: Programme domain & scheduling engine

> **Status: PROPOSED.** Defines the Programme domain and the scheduling
> engine approach. Contains one **UNRESOLVED** question about the engine
> source.

## Context

The Programme application should feel familiar to Microsoft Project users
(master prompt section 18): task table, WBS, task IDs, activity names,
duration, start, finish, predecessors, lag, calendars, constraints,
resources, baselines, progress, % complete, critical path, float, grouping,
filtering, sorting, timeline/Gantt.

Scheduling inputs (user-authored): duration, dependencies, calendar,
resources, constraints. Derived outputs (engine-computed): start, finish,
float, critical path. The UI consumes a `ScheduleResult` and does **not**
calculate CPM (ARCHITECTURE.md invariant 9; BOUNDARIES.md section 7).

The authority is `ProgrammeRevision` (immutable, finalized) + the mutable
working `Programme` (user-authored state). The engine derives outputs from
the working state; finalizing produces a `ProgrammeRevision`.

## Decision 1 — Build our own Programme domain

**DECIDED.**

- Do **not** fork OpenProject / ProjectLibre / GanttProject as the
  foundation (master prompt section 17). Use them as UX / interoperability /
  algorithm references only.
- Build our own: `Programme` (mutable working state), `ProgrammeActivity`,
  dependency model, `ProgrammeRevision` (immutable authority), scheduling
  engine, application services.

## Decision 2 — Programme authority structure

**DECIDED.**

- `ProgrammeRevision` — finalized, immutable, historical schedule truth.
  Reconstructable: same activities + dependencies + calendar + constraints +
  engine version = same `ScheduleResult`.
- `Programme` (mutable) — user-authored working state (activities, durations,
  dependencies, constraints, calendars, resources). This is what the user
  edits.
- **Scheduling engine** — deterministic, versioned pure function:
  `Programme` (working state) + engine version -> `ScheduleResult` (start,
  finish, float, critical path). The engine is a pure domain function
  (BOUNDARIES.md section 2); no I/O; unit-tested in isolation.
- The UI consumes `ScheduleResult`. Editing derived outputs (start/finish/
  float) directly is forbidden unless represented as scheduling constraints
  (e.g. "must start on" constraint) in the domain.

## Decision 3 — Gantt library is a UI primitive only

**DECIDED.**

- A Gantt library (if adopted) is a **rendering/interaction primitive only**.
  It is never the scheduling engine.
- The UI consumes `ScheduleResult` and renders it. User edits to the Gantt
  (drag a bar, link two tasks) produce *constraints* / *edits to the working
  Programme*, which the engine re-derives. The Gantt never computes CPM.

## Decision 4 — MPXJ is an interoperability component, never the authority

**DECIDED (pending dependency evaluation).**

- MPXJ (if adopted) is for schedule *file IO* (.mpp, .mspdi, .xer, .pmxml,
  and other schedule formats). It reads/writes files; it does not own the
  schedule.
- MPXJ is never the scheduling engine, never the `ProgrammeRevision`
  authority. A schedule imported via MPXJ becomes a candidate `Programme`
  (working state); finalizing produces a `ProgrammeRevision` through our
  engine.
- MPXJ license/runtime/bundle impact assessed in `third-party/` before
  adoption (not adopted in this baseline).

## Q5 — Scheduling engine source

**UNRESOLVED.**

- **QUESTION:** Build the scheduling engine from scratch, port it from legacy
  Contros (reference), or embed an external engine behind an adapter?
- **CURRENT EVIDENCE:**
  - GenOffice has no scheduling engine (not its domain).
  - Legacy `pectoraux/contros` may have scheduling logic (reference only —
    not inspected in this phase per master prompt section 24: "Do not inspect
    or modify legacy Contros during this phase unless needed for a specific
    comparison").
  - The engine must be deterministic, versioned, pure, testable (ARCHITECTURE.md
    invariant 7).
- **OPTIONS:**
  1. **From scratch.** Implement CPM (Critical Path Method) + calendar +
     constraints + resources as a pure TypeScript (or Rust) function. Full
     control over determinism and versioning. Most work.
  2. **Port from legacy Contros.** Extract proven scheduling behavior +
     contracts (not implementation boundaries) from `pectoraux/contros`,
     reimplement in the new architecture. Reuses proven logic; requires
     inspection of the legacy repo (deferred per section 24).
  3. **Embed external engine behind adapter.** Use an existing OSS scheduling
     library as the engine, behind a `SchedulingEngine` adapter. Least
     work, but introduces an external authority risk + licensing + determinism
     concerns (the external engine's versioning becomes our versioning).
- **TRADE-OFFS:**
  - Option 1 is the most aligned with the architecture (deterministic,
    versioned, ours) but is the most work.
  - Option 2 reuses proven logic but requires legacy inspection (deferred).
  - Option 3 is fastest but violates "external engines are components, not
    authorities" if the engine is not properly isolated behind a versioned
    adapter — and an external engine's internal versioning is hard to
    reconcile with our "engine version" revision requirement.
- **RECOMMENDATION:** Option 1 or 2, **pending Principal Architect decision
  and (for option 2) legacy Contros inspection**. Option 3 only if the
  external engine can be wrapped such that (a) its version is recorded as our
  engine version, (b) it is deterministic and replayable, and (c) its
  license is permissive. Default: plan for option 1/2.
- **STATUS: UNRESOLVED.** Decide before the Programme implementation phase
  (ARCHITECTURE.md section 32 step 8). Until then, no Programme code.

## Decision 5 — Microsoft Project UX familiarity

**DECIDED (target).**

The Programme UX targets familiarity for experienced Microsoft Project
users (section 18 concepts). This is a UX target, not an architecture
decision — the domain model is our own.

## Consequences

- New `Programme` / `ProgrammeActivity` / `ProgrammeRevision` domain +
  scheduling engine + application services.
- The engine is a pure, versioned function; `ScheduleResult` is the
  contract the UI consumes.
- MPXJ (if adopted) is IO-only, behind an adapter, in `third-party/`.
- A Gantt library (if adopted) is rendering-only.
- No Programme code in this baseline.

## Verification

- Design-only in this baseline. No code.
- Once built: deterministic replay tests (same inputs + engine version =
  same `ScheduleResult`); immutability tests (finalized `ProgrammeRevision`
  cannot be updated/deleted); CPM correctness tests against known schedules.
