# Contractor GenOffice Architecture

> **Status: PROPOSED.** This directory is the proposed architectural
> constitution for Contractor GenOffice. It is **not automatically
> authoritative** until reviewed and accepted by the Principal Architect.
> Items marked `UNRESOLVED` require an explicit decision before
> implementation.

This baseline was produced by Phase 0 (RECON MODE + ARCHITECTURE
BASELINE). No Contractor feature implementation is included. The fork is
`pectoraux/contros-2.0` <- `genspark-ai/genoffice`, pinned at
`04a994b9e92eb55a6806eaa1e6be18e381c9d9df`.

## Read order

1. [`RECONNAISSANCE.md`](RECONNAISSANCE.md) — the evidence base. Verified
   state of the upstream GenOffice repository at the pinned baseline. Start
   here.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — the constitution. Governing
   priority, non-negotiable invariants, product structure, layered
   architecture, ADR index, open questions.
3. [`DOMAIN-AUTHORITY.md`](DOMAIN-AUTHORITY.md) — the domain authorities
   (`EstimateRevision`, `ProgrammeRevision`, `PlanMeasurement`,
   `ProjectActual`, `Goal`) and the authority-vs-representation distinction.
4. [`BOUNDARIES.md`](BOUNDARIES.md) — the boundary rules
   (UI -> adapter -> service -> repo -> DB), forbidden crossings, tenant
   boundary, AI boundary, external-engine boundary, `ee/` boundary.
5. [`LICENSING.md`](LICENSING.md) — the licensing policy (Apache-2.0 core,
   `ee/` enterprise boundary, license gates, trademark/rebranding).
6. [`UPSTREAM.md`](UPSTREAM.md) — the upstream pin and drift-management
   process.
7. [`ADR/`](ADR) — Architecture Decision Records:
   - [`0001-foundation.md`](ADR/0001-foundation.md) — fork foundation,
     substrate reuse, licensing posture, **Q1 web-vs-electron (UNRESOLVED)**,
     Q-lic1 MPL/LGPL allowlist (UNRESOLVED).
   - [`0002-domain-authority.md`](ADR/0002-domain-authority.md) —
     domain authority vs. office-file-as-source-of-truth. **Q2
     synchronization semantics (UNRESOLVED).**
   - [`0003-programme.md`](ADR/0003-programme.md) — Programme domain &
     scheduling engine. **Q5 engine source (UNRESOLVED).**
   - [`0004-plan-bim.md`](ADR/0004-plan-bim.md) — Plans/BIM domain &
     viewer strategy. **Q6 viewer library (UNRESOLVED).**
   - [`0005-multitenancy.md`](ADR/0005-multitenancy.md) — multi-tenancy:
     identity, persistence, isolation. **Q3 persistence technology
     (UNRESOLVED), Q4 identity model (UNRESOLVED).**
   - [`0006-goals-learning.md`](ADR/0006-goals-learning.md) — goals, pricing
     knowledge, learning/calibration. **Q7 pricing schema timing (UNRESOLVED
     by design — deferred).**

See also [`../third-party/README.md`](../third-party/README.md) — dependency
assessment framework + assessments for adopted and under-consideration
dependencies.

## Open questions requiring decisions before implementation

- **Q1** (ADR-0001): Web vs. Electron for v1. Highest-impact open question.
- **Q-lic1** (ADR-0001): MPL/LGPL in the license allowlist.
- **Q2** (ADR-0002): Office-file vs. domain-authority synchronization
  semantics.
- **Q3** (ADR-0005): Canonical persistence technology (PostgreSQL implied).
- **Q4** (ADR-0005): Identity model (replace vs. wrap Genspark account).
- **Q5** (ADR-0003): Scheduling engine source (scratch vs. port vs. embed).
- **Q6** (ADR-0004): BIM viewer library (web-ifc/ThatOpen vs. alternative).
- **Q7** (ADR-0006): Pricing-knowledge schema timing (deferred by design).

## Operating principle

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

When uncertain: **INSPECT. DOCUMENT. STOP.**
