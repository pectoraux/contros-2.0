# ADR-0006: Goals, pricing knowledge, learning/calibration

> **Status: PROPOSED.** Goals are first-class. Pricing knowledge is strategic
> but **schema is deferred** — do not create schema merely because a name
> sounds reasonable.

## Context

The contractor should eventually ask (master prompt section 2): *What should
I charge? Why? What have we historically charged? What did it actually cost?
What margin did we achieve? What margin should we target? Are we on track?
What drove the variance? What should we do differently next time?*

This means first-class capabilities: Pricing Knowledge, Goals, Calibration,
Variance, Historical Revisions, Actuals.

## Decision 1 — Goals are first-class business intent; achievement is derived

**DECIDED.**

- A `Goal` expresses explicit business intent: metric, target, period, scope.
- Examples: `average_gross_margin >= 20%`, `estimate_variance <= 5%`,
  `bid_hit_rate >= 35%`, `overdue_receivables <= 10%`.
- `current value` and `status` (`on_track`/`at_risk`/`off_track`) are
  **derived** from authoritative history (`EstimateRevision` vs.
  `ProjectActual`, bid outcomes, etc.), never stored as duplicate mutable
  KPI truth (DOMAIN-AUTHORITY.md section 3.5).
- The system explains *why* a goal is on track / at risk / off track and
  identifies drivers (variance from `ProjectActual` vs. `EstimateRevision`).

## Decision 2 — Variance is derived, not stored as a second truth

**DECIDED.**

- Variance = `ProjectActual` (append-only evidence) vs. `EstimateRevision`
  (immutable commercial truth). It is **derived** at query time (or cached
  with a provenance trail), never stored as the canonical truth.
- This preserves the revision rule (ARCHITECTURE.md invariant 3): historical
  variance is reconstructable from the historical revision + the historical
  actuals.

## Decision 3 — Pricing knowledge is strategic but schema is deferred

**DECIDED (deferral).**

- Conceptual candidates (section 24): `WorkDefinition`,
  `WorkDefinitionVersion`, `ResourcePriceObservation`,
  `ProductivityObservation`, `Recipe`, `CostModel`, `HistoricalEstimate`,
  `ActualCost`, `Calibration`.
- **These are conceptual candidates only at this phase.** Do not create
  schema merely because a name sounds reasonable.
- Schema is designed when there is a concrete pricing-recommendation feature
  with defined inputs, provenance, and authority semantics — and only after
  the Commercial domain (`EstimateRevision`) exists.
- Pricing recommendations require provenance. AI may recommend candidate
  price / expected margin / confidence / reason, but must not silently
  overwrite `EstimateRevision` or `Bid` (ARCHITECTURE.md invariant 8).

## Decision 4 — Learning / calibration feeds future estimates

**DECIDED (target).**

- The loop: `EstimateRevision` (historical) vs. `ProjectActual` (historical)
  -> variance -> learning -> calibration -> future estimate inputs.
- Calibration is **derived** (with provenance), not a mutable truth that
  silently overwrites pricing.
- Replay tests (eventually): same historical revisions + same actuals + same
  calibration algorithm version = same calibrated future estimate inputs.

## Q7 — When does pricing-knowledge schema become real?

**UNRESOLVED (by design).**

- **QUESTION:** When does the pricing-knowledge schema become real?
- **CURRENT EVIDENCE:** No pricing-knowledge schema exists in GenOffice.
  Legacy Contros may have `PricingEngine` behavior (reference only — not
  inspected this phase).
- **OPTIONS:**
  1. Design schema now (risk: premature, speculative schema).
  2. Defer until a concrete pricing-recommendation feature is specified.
- **RECOMMENDATION:** Option 2. Defer. Do not create schema prematurely
  (ARCHITECTURE.md section 2; master prompt section 21: "Do not create schema
  merely because a name sounds reasonable").
- **STATUS: UNRESOLVED by design** — deferred, not blocked. Becomes DECIDED
  when a concrete pricing feature is specified.

## Consequences

- `Goal` (intent) is a domain authority; achievement is derived.
- Variance is derived.
- Pricing-knowledge schema is deferred (no schema in this baseline).
- Calibration is derived (with provenance).
- No Goals/Pricing code in this baseline.

## Verification

- Design-only in this baseline. No code.
- Once built: goal-achievement derivation tests (same authoritative history
  = same derived status); variance replay tests; calibration provenance
  tests.
