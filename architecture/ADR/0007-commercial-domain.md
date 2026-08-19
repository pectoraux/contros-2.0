# ADR-0007: Commercial Domain Contracts

> **Status: PROPOSED (Phase 2A); extended in Phase 2A.1, 2A.2, 2B.1,
> 2B.1.1, 2B.2, 2B.2.1.** Decisions 1-17 record the commercial authority
> model and the pricing/money/rounding/audit-atomicity decisions. Decision 18
> (Audit Atomicity) and Decision 19 (Draft Bid Reference) were added in
> Phase 2B.2.1 and are implemented by the Commercial application services +
> committed audit-failure rollback tests.

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

## Decision 4 — EstimateLine: rate is unit COST; pricing is adjustment metadata

**DECIDED (Phase 2A.1 — hardened).**

Each `EstimateLine` carries:
- `quantity` (Quantity — 4-decimal banker's-rounded)
- `costBasis` ('unit-rate' | 'lump-sum' | 'provisional' | 'scheduled')
- `rate` (Money per unit — **unit COST**, not sell price. For lump-sum, this is the total cost.)
- `pricingStrategy` ('markup' | 'margin') — **line-level pricing adjustment/input**
- `pricingRatio` (Ratio 0..1; the markup or margin percentage)
- `currency` (derived from `rate.currency`)

**CRITICAL (Phase 2A.1 H2 decision):** The line-level `pricingStrategy` +
`pricingRatio` are **adjustment metadata**, NOT the canonical sell price
authority. The CANONICAL sell price is estimate-level (see Decision 6).
The per-line pricing may be used for informational/adjustment purposes,
but it must NOT silently redefine the estimate's canonical profit authority.

The `rate` field has ONE unambiguous meaning: **unit cost**. It is not a
sell rate or a base rate. (Phase 2A.1 §4.)

## Decision 5 — EstimateRevision payload + content hash + single-currency

**DECIDED (Phase 2A.1 — hardened).**

`EstimateRevisionPayload`:
- `projectId`
- `currency` (CurrencyCode — **single currency for the entire revision**)
- `policy` (EstimatePricingPolicy: overheadPct + contingencyPct + targetProfitMode + targetProfitRatio)
- `lines` (readonly EstimateLine[] — **all must match payload.currency**)
- `note` (string | null)
- `pricingAlgorithmVersion` (string)

**Single-currency invariant (Phase 2A.1 M2 fix):** `estimateRevisionPayload()`
enforces that every EstimateLine's `currency` matches the payload's
`currency`. A mixed-currency payload throws at construction time — it
NEVER becomes hashable canonical content. (Phase 2A.1 §6.)

The content hash is computed from the payload using the Phase 1 canonical
`contentHash` function (canonicalize → SHA-256). Same payload + same
algorithmVersion = same content hash → same historical result.

**Excludes from content hash:** revisionId, tenantId, createdBy, createdAt,
finalizedAt, status, revisionNumber — those are metadata (identity/audit),
not content. (master §15: content integrity separate from authorship.)

## Decision 6 — Estimate-level profit model (Phase 2A.1 H2 — INTENTIONAL CHANGE)

**DECIDED.**

The CANONICAL sell price is **estimate-level**, not per-line. This is an
INTENTIONAL CHANGE from the Phase 2A per-line model. The canonical
commercial model is:

```
DIRECT COST
    ↓
CONTINGENCY
    ↓
OVERHEAD
    ↓
TARGET PROFIT / SELL PRICE
```

### EstimatePricingPolicy

```
EstimatePricingPolicy:
  overheadPct        = Ratio (0..1)
  contingencyPct      = Ratio (0..1)
  targetProfitMode     = 'markup' | 'margin'
  targetProfitRatio    = Ratio (0..1)
```

### Canonical computation

```
totalLineCost   = sum(lineCost = rate × quantity)
contingency     = totalLineCost × contingencyPct   (H1: on DIRECT COST only)
overhead        = totalLineCost × overheadPct       (H1: on DIRECT COST only)
totalCost       = totalLineCost + overhead + contingency

markup mode:
  profit       = totalCost × targetProfitRatio
  sellPrice    = totalCost + profit

margin mode:
  sellPrice    = totalCost / (1 - targetProfitRatio)
  profit       = sellPrice - totalCost

grossProfit     = sellPrice - totalCost
grossMargin     = grossProfit / sellPrice
```

### Why this is preferred over the per-line model

The per-line model (`sellPrice = sum(lineCost × (1 + markup))`) makes
overall profitability depend accidentally on line-level pricing choices.
If per-line markup is insufficient to cover overhead + contingency, the
estimate can produce a negative gross profit — an accidental loss.

The estimate-level model makes profitability EXPLICIT: the target profit
ratio is a deliberate commercial decision, not an emergent property of
line-level adjustments. Per-line pricing remains as adjustment metadata.

### Negative-profit policy

If `targetProfitRatio > 0` and `targetProfitMode = 'markup'`, then
`sellPrice >= totalCost` (profit is always non-negative). A bid below
cost is represented as an explicit commercial decision on the Bid (a
negative `directorAdjustment`), not an accidental consequence of
line-level markup. (Phase 2A.1 §5.)

### Line-level pricing role

Line-level `pricingStrategy` + `pricingRatio` remain on `EstimateLine` as
adjustment metadata. They are part of the content hash (captured for
reproducibility) but do NOT determine the canonical sell price. The exact
interaction between per-line pricing and the estimate-level policy is a
boundary that may be refined when Pricing Knowledge is introduced. The
canonical authority is the estimate-level policy.

## Decision 7 — Bid: explicit commercial decision (Phase 2A.1 — hardened)

**DECIDED.**

A `Bid` references a finalized `EstimateRevision` by `estimateRevisionId` +
`estimateRevisionContentHash` (provenance). It does NOT duplicate the
estimate payload. The Bid carries: status (draft/submitted/won/lost/withdrawn),
finalPrice (may include director adjustment), directorAdjustment,
adjustmentRationale, submittedAt, outcomeAt, outcomeNote.

**finalPrice is an explicit commercial submission decision** — it is NOT
automatically derived from `EstimateRevision.totalSellPrice`. A Bid may
intentionally differ from the estimate because of director adjustment,
commercial negotiation, or customer strategy. The difference is explicit
and auditable. (Phase 2A.1 §10.)

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

## Decision 10 — No persistence in Phase 2A/2A.1

**DECIDED.**

Phase 2A/2A.1 is DOMAIN MODE only. No SQL, no Prisma, no migrations, no HTTP, no
UI. The commercial contracts are pure TypeScript + deterministic algorithms
+ replay tests. Persistence + application services + API come in Phase 2B,
building on these hardened contracts. (Phase 2A §21; Phase 2A.1 §15.)

## Decision 11 — H1: Overhead on direct cost only (INTENTIONAL CHANGE)

**DECIDED (Phase 2A.1).**

### QUESTION
Should overhead be calculated on direct cost only, or on direct cost +
contingency (legacy behavior)?

### EVIDENCE
Legacy Contros: `overhead = (directCost + riskCost) × overheadPct` where
`riskCost = directCost × contingencyPct`. The overhead base includes
contingency.

### OPTIONS
1. Legacy: `overhead = (directCost + contingency) × overheadPct`.
2. New: `overhead = directCost × overheadPct` (contingency excluded from base).

### TRADE-OFFS
Legacy compounds contingency into the overhead base, which increases the
total cost. The new approach treats overhead and contingency as independent
cost components on the same direct-cost base, which is simpler and more
transparent.

### DECISION
**Option 2 — overhead on direct cost only.** Contingency is a separate
cost component. This is an INTENTIONAL CHANGE from legacy.

### CONSEQUENCES
For the same inputs, the new model produces a lower total cost than legacy
(by `contingency × overheadPct`). Example: direct=1000, contingency=50,
overhead=10% → legacy overhead=105, new overhead=100 (difference: 5 GHS).
This is documented and tested. Future reconciliation with legacy estimates
must account for this difference.

## Decision 12 — M1: markup() returns actual ratio (no clamping)

**DECIDED (Phase 2A.1).**

The `markup()` function returns the actual mathematical ratio (a plain
`number`, which may exceed 1 = 100%). It does NOT silently clamp to [0, 1].
If a bounded Ratio is needed (e.g. for a policy input), use `ratio()` at
the appropriate input boundary to validate. (Phase 2A.1 §7.)

## Decision 13 — Line order is canonical (ACCEPT)

**DECIDED (Phase 2A.1).**

EstimateRevision line order IS part of canonical commercial content.
An EstimateRevision represents an ordered commercial document (matching
legacy `RevisionSnapshot.lines` which is an ordered array). Same lines in
different order → different content hash. (Phase 2A.1 §8.)

## Decision 14 — BOQ quantity snapshot (not live reference)

**DECIDED (Phase 2A.1).**

`EstimateLine.quantity` is a commercial SNAPSHOT taken at estimate creation.
It is NOT a live reference to `BOQItem.quantity`. A finalized
`EstimateRevision` is immune to later BOQ changes. The link between a
`BOQItem` and an `EstimateLine` is by reference (`boqItemId`), not by
live value. (Phase 2A.1 §9.)

## Decision 15 — Me1: Canonical calculation path is cost-only (Phase 2A.2)

**DECIDED (Phase 2A.2).**

The canonical calculation path in `computeEstimateRevisionTotals` is
visibly cost-only: `EstimateLine → lineCostOf → sum → totalLineCost →
overhead + contingency → totalCost → EstimatePricingPolicy → profit →
sellPrice`. Per-line `pricingStrategy` + `pricingRatio` do NOT appear in
this path. The dead `lineSellPriceOf` computation was removed from the
canonical totals. (Phase 2A.2 §3.)

`pricingStrategy` + `pricingRatio` remain on `EstimateLine` as
**document-identity metadata** — they are part of the content hash (what
was finalized) but do NOT influence the canonical financial result (what
the commercial outcome is).

| Change | Hash | Financial result |
| --- | --- | --- |
| pricingStrategy | changes | unchanged |
| pricingRatio | changes | unchanged |

## Decision 16 — Me2: grossMargin returns mathematical truth (Phase 2A.2)

**DECIDED (Phase 2A.2).**

`grossMargin()` returns the mathematical ratio as a plain `number` (may
be negative if sellPrice < cost — a loss). It does NOT silently clamp to
[0, 1]. A loss is reported as a negative margin, not hidden as 0%.
(Phase 2A.2 §5.)

## Decision 17 — L1: Domain-specific margin validation (Phase 2A.2)

**DECIDED (Phase 2A.2).**

Margin mode with `targetProfitRatio >= 1` is rejected with a
`ValidationError` containing the message "Target profit margin must be
less than 100%". This prevents the generic "Money divide by zero" error
from reaching the caller. (Phase 2A.2 §7.)

## Decision 18 — Audit Atomicity (Phase 2B.2.1)

**DECIDED (Phase 2B.2.1).**

### QUESTION

When an authority-changing Commercial operation mutates a business row
(e.g. a draft revision becomes finalized, a draft bid becomes submitted),
must the required audit event commit in the same database transaction as
the business mutation, or may the audit be emitted afterwards (business
commit, then audit, eventually consistent)?

### EVIDENCE

- The constitution's priority order is **correctness > architectural
  integrity > historical correctness > auditability > determinism >
  tenant isolation**. An audit event that commits while the business
  mutation rolled back (or vice versa) breaks both correctness and
  auditability.
- The Phase 2B.2.1 independent audit found that the Commercial services
  emitted audit events **after** the business commit — a separate write.
  If the audit write failed, the business mutation persisted with **no
  audit record**, producing an un-auditable authority change (the exact
  failure mode the constitution forbids).
- The `DbClient.tx()` contract supports nested transactions via
  SAVEPOINT (Phase 2B.1.1), and every repository + the
  `AuditRepository.append()` share the same `DbClient` instance, so an
  audit write issued inside an outer service transaction participates in
  the same transaction without any new abstraction.

### OPTIONS

1. **Atomic (same transaction):** business mutation + required audit
   event commit in ONE `db.tx()`. If either fails, both roll back.
2. **Eventual consistency (outbox / event bus / audit-later):** business
   commits first; audit is emitted asynchronously; a reconciliation
   process repairs gaps.
3. **Sequential (business commit, then audit, best-effort):** no
   transaction boundary around both; an audit failure leaves the
   business mutation persisted without an audit record.

### TRADE-OFFS

- Option 1 ties audit emission to the transaction's commit. It makes an
  audit-write failure (trigger, constraint, disk) **fail the entire
  authority change**, which is the intended safe behavior: it is better
  to refuse an authority change than to allow an un-auditable one. The
  cost is a slightly larger transaction (one extra row + the audit
  trigger firing inside it).
- Option 2 (outbox) decouples durability of the business mutation from
  audit delivery and is attractive for cross-service audit sinks. But it
  introduces a second durable substrate (the outbox), a delivery loop,
  and a new failure class (delivered-but-business-rolled-back, or
  business-committed-but-audit-never-delivered). That complexity is not
  justified for the single-process, single-database Commercial domain.
- Option 3 is the pre-Phase-2B.2.1 behavior and is rejected: it is
  exactly the gap the independent audit identified.

### RECOMMENDATION

Option 1. Authority changes are rare, high-value, and must be auditable.
The cost of a slightly larger transaction is negligible; the cost of an
un-auditable authority change is a constitutional violation.

### DECISION

**Option 1 — atomic.** Every authority-changing Commercial operation
and its required audit event must commit in the **same database
transaction**:

```text
business mutation + required audit event = one atomic commit
```

If either fails:

```text
ROLLBACK (both)
```

Concretely, each authority-changing `*Service` method is structured:

```text
requirePermission(ctx, …)          // authorization (before tx)
validate / load / hash-check        // validation (before tx)
db.tx(async () => {
  business mutation                 // repository write(s)
  audit.append({ … })               // audit write — same transaction
})
```

Authorization and validation run **before** the transaction opens, so a
permission or validation failure produces **zero** business writes and
**zero** audit writes. The transaction boundary owns the atomicity of
the mutation + audit pair.

**Rejected for the current architecture:** business commit → audit
later → eventual consistency (Option 3), and the outbox / event bus /
queue (Option 2). No outbox is introduced in this phase.

### CONSEQUENCES

- An audit-insert failure (trigger, constraint, disk) now rolls back
  the entire authority change. This is verified by committed
  audit-failure rollback tests against real PostgreSQL (pglite) for
  every authority-changing Commercial operation: finalize, update,
  supersede, bid submit, bid outcome, bid withdraw, BOQ item mutation,
  PlanMeasurement creation.
- A successful authority change produces **exactly one** audit event
  for the operation. Existing success-path tests assert
  `toHaveLength(1)` rather than `find(...).toBeDefined()`.
- `Bid.submittedAt` and `Bid.outcomeAt` are populated by the **same**
  UPDATE that sets `status`, inside the same transaction as the audit
  write — so a submitted Bid can never exist without `submittedAt`, and
  an outcome can never exist without `outcomeAt`. (Phase 2B.2.1 Me2 fix.)
- Timestamps are **server/application-controlled** (`new Date().toISOString()`
  captured once per operation, used for both the business mutation and
  the audit event). No client-supplied timestamp path is introduced.
- No new transaction abstraction, no outbox, no event bus, no second
  audit repository. The approved invariant is implemented with the
  existing `DbClient.tx()` + shared-`db` `AuditRepository`.

### DEFERRED QUESTIONS

- Cross-service audit sinks (e.g. an external SIEM consuming audit
  events) are out of scope. If required, they would consume the
  committed `audit_events` table via replication/CDC, NOT via an outbox
  in the authority-change transaction.
- Outbox semantics for **non-authority** events (e.g. notification
  side-effects) are not addressed here; this decision applies only to
  authority-changing Commercial operations and their required audit.

## Decision 19 — Draft Bid Reference (Phase 2B.2.1)

**DECIDED (Phase 2B.2.1).**

A **draft** `Bid` may reference a **draft** `EstimateRevision`. This is
deliberate and supports the commercial workflow of drafting a bid before
the estimate is finalized.

`BidService.submitBid()` enforces the authority gate:

```text
EstimateRevision.status = finalized
AND
Bid.estimateRevisionContentHash = actual revision content hash
```

A submission that references a non-finalized revision, or whose stored
content hash no longer matches the actual revision content hash, is
rejected with `ValidationError` / `ConflictError` before the
authority-changing transaction opens.

This separates **drafting** (cheap, reversible, may point at a draft
estimate) from **submission** (the authority-changing transition, which
requires a finalized, hash-matching estimate).

### CONSEQUENCES

- `createBid` does NOT require the referenced revision to be finalized;
  it only requires same-tenant + same-project existence.
- `submitBid` requires `finalized` + hash match. The content hash is
  computed from the **actual** revision at submit time (not a
  client-supplied hash), so a tampered bid hash or a revision that
  changed after the bid was drafted is detected.
- A draft bid referencing a draft estimate can be withdrawn without
  ever being submitted.

## Legacy Contros findings

| Legacy behavior | Current contract | Decision |
| --- | --- | --- |
| `round2` — banker's rounding at 2 decimals, GHS | `bankerRound` + Money (minor units, currency-specific decimals) | ADOPT (generalized to any currency's decimals) |
| Cost buildup: material+labour+plant+subcontract+fee → directCost | `EstimateLine` carries rate (unit cost); `lineCost = rate × qty` | INTENTIONAL CHANGE (simplified cost model; recipe engine deferred to Pricing Knowledge) |
| `overhead = (directCost + riskCost) × overheadPct` (includes contingency in base) | `overhead = totalLineCost × overheadPct` (direct cost only) | **INTENTIONAL CHANGE** (H1: overhead on direct cost only) |
| `profit = estimatedTotalCost × profitPct` (estimate-level markup) | `profit = totalCost × targetProfitRatio` (estimate-level, markup or margin mode) | ADOPT (estimate-level profit model preserved, with explicit mode) |
| `sellPrice = estimatedTotalCost + profit` (estimate-level) | `sellPrice = totalCost + profit` (markup) or `totalCost / (1 - ratio)` (margin) | ADOPT (estimate-level sell price; per-line sell removed as canonical authority) |
| `expectedMarginPct` vs `marginPct` (spread) distinction | `grossMargin` (profit/sell) vs `markup` (profit/cost) | ADOPT (explicit margin vs markup distinction) |
| `finalizeRevision` — captures immutable snapshot JSON | `EstimateRevisionPayload` + content hash | ADOPT (same pattern: immutable payload + hash) |
| `replayRevision` — reconstructs result from snapshot | `replayEstimateRevision` — reconstructs totals from payload | ADOPT (same replay pattern) |
| `validateBidSubmission` — gate before submit | `validateBidSubmission` — same gate | ADOPT |
| `PricingEngine` — full recipe (CostRecipeLine, WorkDefinitionVersion, ExecutionSegment, SubcontractQuote) | NOT ported — EstimateLine carries rate directly | DEFER (recipe-based pricing belongs to Pricing Knowledge) |
| Legacy Prisma schema, Next.js routes, UI | NOT ported | REJECT (per master prompt §28) |

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

- 93 Commercial domain tests pass (money 21, pricing 18, estimate-revision 41,
  bid 6, architecture 7) — pure unit tests, no DB.
- Commercial persistence + application-service integration tests run against
  REAL PostgreSQL (pglite — PostgreSQL 16 WASM). No mocks of the database,
  transaction, or audit boundary.
- Audit-atomicity regression tests (Phase 2B.2.1, Decision 18): forcing
  `INSERT INTO audit_events` to fail via a temporary trigger proves the
  business mutation rolls back for every authority-changing Commercial
  operation — finalize, update, supersede, bid submit, bid outcome, bid
  withdraw, BOQ item mutation, PlanMeasurement creation.
- Success-path audit tests assert **exactly one** audit event per
  authority-changing operation (`toHaveLength(1)`), not merely `>= 1`.
- `Bid.submittedAt` / `Bid.outcomeAt` success-path assertions: a submitted
  Bid always has `submittedAt != null`; an outcome always has
  `outcomeAt != null` and preserves `outcomeNote`.
- TypeScript clean (`tsc --noEmit`, 0 errors).
- Replay tests prove: same payload → same content hash → same totals.
- H1 regression test: overhead = totalLineCost × overheadPct (NOT (totalLineCost + contingency) × overheadPct).
- H2 regression test: estimate-level profit (markup + margin modes); positive profit ratio → sellPrice >= totalCost.
- M1 regression test: markup() returns 3.0 for 300% markup (not clamped to 1.0).
- M2 regression test: mixed-currency payload throws at construction time (never hashable).
- Me1 regression test: changing pricingStrategy/pricingRatio changes hash but NOT financial result.
- Me2 regression test: grossMargin(sell=100, cost=200) = -1 (negative, not clamped to 0).
- L1 regression test: margin=1 throws ValidationError "Target profit margin must be less than 100%" (not "divide by zero").
- Line-order regression test: same lines, different order → different hash.
- BOQ snapshot regression test: EstimateLine quantity is independent of BOQItem quantity.
