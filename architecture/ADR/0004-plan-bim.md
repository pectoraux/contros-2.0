# ADR-0004: Plans/BIM domain & viewer strategy

> **Status: PROPOSED.** Defines the Plans/BIM domain and the viewer strategy.
> Contains one **UNRESOLVED** question about the viewer library.

## Context

The Plans/BIM application should support (Phase 1, master prompt section 18):
view, inspect, measure, annotate, takeoff, link. Native BIM authoring is
Phase 2+ unless explicitly approved (section 22).

The authority is the source artifact (immutable evidence) + `PlanMeasurement`
(measured evidence — not commercial authority). The system answers: *What was
measured? From which artifact? Which revision? How? By whom? Using what
algorithm?* (section 20).

IFC is an interoperability protocol, not the application database schema
(section 19). Do not reproduce the entire IFC model in the DB unless
justified.

## Decision 1 — Build our own Contractor Plan domain

**DECIDED.**

- Do **not** fork FreeCAD / LibreCAD / QCAD / Bonsai as the foundation
  (section 19). Use them as references only.
- Build our own: `PlanArtifact` (immutable source evidence), `PlanMeasurement`
  (measured evidence), application services.

## Decision 2 — Phase 1 scope: view / measure / takeoff / link

**DECIDED.**

- Phase 1: view, inspect, measure, annotate, takeoff, link.
- Native BIM authoring is Phase 2+ unless explicitly approved.
- DWG support is a deliberate licensing/business decision (section 22). Do
  not distort architecture around a problematic open-source DWG library.

## Decision 3 — IFC is interoperability, not the DB schema

**DECIDED.**

- Use IFC for: exchange, import, export, geometry, semantic interoperability.
- Store only application-domain data we actually need (`PlanArtifact`
  reference + hash, `PlanMeasurement` records). Do not reproduce the entire
  IFC schema in the database unless explicitly justified per-field.

## Decision 4 — PlanMeasurement is evidence, not commercial authority

**DECIDED.**

- A `PlanMeasurement` preserves: source artifact, sheet, sheet revision,
  element reference, quantity, unit, measurement method, measurement basis,
  measurement engine version, actor, timestamp.
- It is append-only evidence. It feeds BOQ -> `EstimateLine` ->
  `EstimateRevision`, but it is NOT the commercial authority itself
  (DOMAIN-AUTHORITY.md section 3.3).
- Browser measurement may be **provisional**. The authoritative record passes
  through the application/domain boundary.
- AI may propose measurements. AI may not silently establish commercial
  authority (ARCHITECTURE.md invariant 8).

## Decision 5 — Web-first viewer direction

**DECIDED (target, pending Q6).**

- Preferred web-first direction: `web-ifc`, ThatOpen components, Fragments
  (section 18).
- Phase 1 viewer runs in the renderer (Electron or web). Server-side geometry
  processing (IfcOpenShell, if adopted) runs as an isolated service, never
  in-process (BOUNDARIES.md section 7).

## Q6 — Viewer library

**UNRESOLVED.**

- **QUESTION:** web-ifc / ThatOpen / Fragments, or an alternative?
- **CURRENT EVIDENCE:** These are the master prompt's preferred web-first
  direction (section 18). They are not yet inspected. License / runtime /
  bundle impact / determinism of geometry parsing must be assessed before
  adoption.
- **OPTIONS:**
  1. web-ifc + ThatOpen components + Fragments (prompt's preference).
  2. Alternative web IFC viewer (assess in `third-party/`).
  3. Server-side-only (IfcOpenShell) + thin renderer.
- **TRADE-OFFS:** Option 1 is the prompt's preference and likely
  web-compatible, but must be verified for license (expected MIT/Apache),
  bundle size (IFC parsing in wasm can be large), determinism (geometry
  parsing must be deterministic for `PlanMeasurement` reproducibility), and
  maintenance. Option 3 moves weight server-side but reduces web portability.
- **RECOMMENDATION:** Option 1, **pending `third-party/` assessment** of
  web-ifc / ThatOpen license, bundle, determinism. Default until assessed:
  do not adopt.
- **STATUS: UNRESOLVED.** Decide before the Plan/BIM implementation phase
  (ARCHITECTURE.md section 32 step 10). No viewer code in this baseline.

## Decision 6 — Source artifacts are evidence

**DECIDED.**

- Source artifacts (IFC/PDF/DXF/DWG references + content hash) are immutable
  evidence. They are stored (or referenced by hash in a blob store) but not
  mutated.
- A `PlanMeasurement` references a source artifact + sheet revision + element
  reference + engine version, so the measurement is reproducible from the
  artifact + the measurement method + the engine version.

## Consequences

- New `PlanArtifact` / `PlanMeasurement` domain + application services.
- Viewer (web-ifc/ThatOpen or alternative) is a rendering/measurement-candidate
  component, behind an adapter, never the authority.
- IfcOpenShell (if adopted) is an isolated server-side service.
- No Plan/BIM code in this baseline.

## Verification

- Design-only in this baseline. No code.
- Once built: measurement reproducibility tests (same artifact + method +
  engine version = same measurement); immutability tests (`PlanMeasurement`
  append-only); determinism tests (geometry parsing deterministic).
