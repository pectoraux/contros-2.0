# ADR-0007: Commercial Domain Contracts

> **Status: PROPOSED.** Phase 2A — Commercial domain contracts. Pure domain
> contracts + deterministic algorithms + replay tests. No persistence, no UI,
> no HTTP, no schema. This ADR records the commercial authority model and the
> pricing/money/rounding decisions.

## Context

Phase 1.1 established the foundation (identity, tenant, workspace, project,
audit, revision framework). Phase 2A establishes the Commercial domain
contracts that sit on top of the foundation. The master prompt §2 requires
the contractor to eventually ask: *What should I charge? Why? What have we
historically charged? What did it actually cost? What margin did we achieve?*

This ADR defines what is authoritative in Commercial, and the deterministic
money/pricing semantics that make commercial calculations reproducible.

## Decision 1 — Commercial authority is EstimateRevision

**DECIDED.**

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

- `EstimateRevision` is the canonical commercial authority. Finalized
  revisions are immutable. (DOMAIN-AUTHORITY.md §3.1; ADR-0005.)
- `PlanMeasurement` is evidence — it feeds BOQ but is NOT commercial authority.
- `BOQ` is scope structure — item code, description, unit, quantity. NOT authority.
- `EstimateLine` is a priced line within an EstimateRevision.
- `Bid` is a commercial decision that REFERENCES a finalized EstimateRevision
  (by revisionId + contentHash). It does NOT duplicate the estimate payload.

The generic revision framework from Phase 1.1 is REUSED — EstimateRevision
uses `RevisionMetadata` (identity, lifecycle, audit) + `EstimateRevisionPayload`
(commercial content). No competing revision mechanism. (Phase 2A §11.)

## Decision 2 — Money model

**DECIDED.**

- Money is represented internally as **integer minor units** (e.g. cents for
  GHS/USD, whole yen for JPY, fils for KWD). This avoids IEEE-754 floating-point
  error. (Phase 2A §9.)
- Every Money value carries its `CurrencyCode` (ISO 4217).
- Arithmetic is same-currency only; cross-currency requires an explicit
  `ExchangeRateObservation` (not implemented in Phase 2A).
- **Rounding: banker's rounding (round half to even)** at the currency's
  minor-unit precision. This avoids the systematic upward bias of "round half
  up" and matches the legacy Contros `round2` behavior. (Phase 2A §8; legacy
  `money.ts`.)

**Adopted from legacy:** the banker's rounding + minor-unit integer
representation + same-currency arithmetic invariants. (Legacy `money.ts`.)

## Decision 3 — Margin vs markup (CRITICAL distinction)

**DECIDED.**

```
cost          = direct + overhead + risk
sellPrice     = the price charged to the client
grossProfit   = sellPrice - cost
grossMargin   = grossProfit / sellPrice       (fraction of SELL price)
markup        = grossProfit / cost             (fraction of COST)
```

**20% markup ≠ 20% margin:**
- cost=100, markup=20% → sell=120, margin=20/120=16.67%
- cost=100, margin=20% → sell=125, profit=25, markup=25%

Conversions (deterministic):
- `margin = markup / (1 + markup)`
- `markup = margin / (1 - margin)`

Sell price from cost:
- `sellPrice = cost × (1 + markup)` (markup strategy)
- `sellPrice = cost / (1 - margin)` (margin strategy)

**Adopted from legacy:** the explicit margin/markup distinction + the
`expectedMarginPct` vs `marginPct` (spread) separation. (Legacy
`pricing-engine.ts` lines 165-174, 600-608.)

## Decision 4 — EstimateLine carries its own pricing strategy

**DECIDED.**

Each `EstimateLine` carries:
- `quantity` (Quantity — 4-decimal banker's-rounded)
- `costBasis` ('unit-rate' | 'lump-sum' | 'provisional' | 'scheduled')
- `rate` (Money per unit, or total for lump-sum)
- `pricingStrategy` ('markup' | 'margin')
- `pricingRatio` (Ratio 0..1; the markup or margin percentage)

The line's sell price is computed deterministically from cost + strategy.
This makes the estimate self-contained and replayable. (Phase 2A §7.)

## Decision 5 — EstimateRevision payload + content hash

**DECIDED.**

`EstimateRevisionPayload`:
- `projectId`
- `currency` (CurrencyCode)
- `policy` (EstimatePolicy: overheadPct + contingencyPct)
- `lines` (readonly EstimateLine[])
- `note` (string | null)
- `pricingAlgorithmVersion` (string)

The content hash is computed from the payload using the Phase 1 canonical
`contentHash` function (canonicalize → SHA-256). Same payload + same
algorithmVersion = same content hash → same historical result. (Phase 2A §13;
master §13/§14/§15.)

**Excludes from content hash:** revisionId, tenantId, createdBy, createdAt,
finalizedAt, status, revisionNumber — those are metadata (identity/audit),
not content. (master §15: content integrity separate from authorship.)

## Decision 6 — Estimate-level totals

**DECIDED.**

```
totalLineCost   = sum(lineCost)                    [sum of quantity × rate]
overhead        = totalLineCost × overheadPct       [estimate-level recovery]
contingency     = totalLineCost × contingencyPct   [estimate-level risk]
totalCost       = totalLineCost + overhead + contingency
totalSellPrice  = sum(lineSellPrice)               [sum of per-line sell prices]
totalGrossProfit = totalSellPrice - totalCost
grossMargin     = totalGrossProfit / totalSellPrice
```

Per-line sell price is computed from the line's pricingStrategy (markup or
margin). Overhead + contingency are estimate-level (applied to total line
cost, not per-line). (Phase 2A §7; legacy `pricing-engine.ts` cost buildup.)

## Decision 7 — Bid references EstimateRevision

**DECIDED.**

A `Bid` references a finalized `EstimateRevision` by `estimateRevisionId` +
`estimateRevisionContentHash` (provenance). It does NOT duplicate the
estimate payload. The Bid carries: status (draft/submitted/won/lost/withdrawn),
finalPrice (may include director adjustment), directorAdjustment,
adjustmentRationale, submittedAt, outcomeAt, outcomeNote.

`validateBidSubmission` enforces: estimateRevisionId set, revision exists +
is finalized, finalPrice set. (Phase 2A §15; legacy `validateBidSubmission`.)

## Decision 8 — PlanMeasurement + BOQ are NOT commercial authority

**DECIDED.**

- `PlanMeasurement` is measurement evidence (artifact + sheet + element +
  quantity + method + engine version + actor + timestamp). It feeds BOQ
  but is NOT commercial authority. (Phase 2A §5; DOMAIN-AUTHORITY.md §3.3.)
- `BOQ` is scope structure (item code + description + unit + quantity +
  provenance). It is NOT commercial authority. (Phase 2A §6.)

## Decision 9 — Office + AI boundaries (architectural rules, not implemented)

**DECIDED (architectural rule).**

- Office adapter: `EstimateRevision ↔ Office adapter ↔ workbook representation`.
  Univer cannot directly mutate EstimateRevision. (Phase 2A §16; ADR-0002 Q2
  deferred.)
- AI may produce `CandidateEstimateLine`, `CandidatePrice`, `CandidateQuantity`,
  `CandidateBOQLine` — but these are suggestions. AI cannot establish
  EstimateRevision or Bid authority. (Phase 2A §17; ARCHITECTURE.md invariant 8.)

## Decision 10 — No persistence in Phase 2A

**DECIDED.**

Phase 2A is DOMAIN MODE only. No SQL, no Prisma, no migrations, no HTTP, no
UI. The commercial contracts are pure TypeScript + deterministic algorithms
+ replay tests. Persistence + application services + API come in a later
phase, building on these contracts. (Phase 2A §21.)

## Legacy Contros findings

| Legacy behavior | Current contract | Decision |
| --- | --- | --- |
| `round2` — banker's rounding at 2 decimals, GHS | `bankerRound` + Money (minor units, currency-specific decimals) | ADOPT (generalized to any currency's decimals) |
| `priceLine` — cost buildup: material+labour+plant+subcontract+fee → directCost → risk → overhead → profit → sellPrice | `EstimateLine` carries rate+strategy; `computeEstimateRevisionTotals` computes line cost + sell + overhead + contingency | ADOPT (simplified: per-line markup/margin instead of full recipe engine; recipe engine deferred to Pricing Knowledge) |
| `expectedMarginPct` vs `marginPct` (spread) distinction | `grossMargin` (profit/sell) vs `markup` (profit/cost) | ADOPT (explicit margin vs markup distinction) |
| `finalizeRevision` — captures immutable snapshot JSON | `EstimateRevisionPayload` + content hash | ADOPT (same pattern: immutable payload + hash) |
| `replayRevision` — reconstructs result from snapshot | `replayEstimateRevision` — reconstructs totals from payload | ADOPT (same replay pattern) |
| `validateBidSubmission` — gate before submit | `validateBidSubmission` — same gate | ADOPT |
| `PricingEngine` — full recipe (CostRecipeLine, WorkDefinitionVersion, ExecutionSegment, SubcontractQuote) | NOT ported in Phase 2A — EstimateLine carries rate+strategy directly | DEFER (recipe-based pricing belongs to Pricing Knowledge, not the estimate contract) |
| Legacy Prisma schema, Next.js routes, UI | NOT ported | REJECT (per master prompt §28: port behavior/contracts, not implementation boundaries) |

## Consequences

- The Commercial domain has a canonical, immutable authority (`EstimateRevision`).
- Money is deterministic (integer minor units, banker's rounding).
- Margin ≠ markup is explicit and tested.
- Revisions are replayable (same payload + same algorithm version = same hash + same totals).
- Bid references EstimateRevision (no payload duplication).
- PlanMeasurement + BOQ are evidence/scope, not authority.
- No persistence/UI/API introduced — those come in a later phase.

## Deferred questions

- **Q2 (ADR-0002):** Office-file ↔ domain-authority synchronization mechanics
  (workbook import/diff → new EstimateRevision). Deferred to the Commercial
  persistence/application phase.
- **Pricing Knowledge schema:** `WorkDefinition`, `ResourcePriceObservation`,
  `CostModel` are NOT introduced in Phase 2A. They belong to a future
  Pricing Knowledge domain (ADR-0006 Q7 deferred by design). EstimateLine
  carries its rate directly.
- **Tax:** not modeled in Phase 2A. Tax semantics (if needed) will be added
  as a distinct line/revision field with explicit rules.
- **Multi-currency within a revision:** an EstimateRevision has ONE currency.
  Cross-currency estimates require separate revisions + an
  `ExchangeRateObservation` (boundary defined, not implemented).
- **Recipe-based pricing** (legacy `PricingEngine` full recipe): deferred to
  Pricing Knowledge. EstimateLine's rate is direct in Phase 2A.

## Verification

- 65 new Commercial tests pass (money 21, pricing 18, estimate-revision 13,
  bid 6, architecture 7).
- Full suite: 196/196 pass (131 foundation + 65 commercial). Zero regressions.
- TypeScript clean (`tsc --noEmit`, 0 errors).
- All tests pure (no DB, no network, no filesystem, no Electron, no mocks).
- Replay tests prove: same payload → same content hash → same totals.
