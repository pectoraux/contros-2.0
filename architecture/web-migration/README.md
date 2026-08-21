# GenOffice Web Migration — Architecture

This folder contains the frozen architecture for the GenOffice web migration.

> **Status: FROZEN.** ADR-001 and ADR-002 are approved. Implementation proceeds per the milestone order below. Do not "improve" the architecture during implementation — the purpose of each milestone is to establish the frozen seams, not to solve the migration prematurely.

## Documents

| Document | Status | Purpose |
|---|---|---|
| [ADR-001: Platform Extraction Architecture](./ADR-001-platform-extraction-architecture.md) | ✅ Approved (frozen) | The four-layer target architecture: Runtime Contracts → Domain Services → Platform Capabilities → Adapters. |
| [ADR-002: Renderer Compatibility Bridge Strategy](./ADR-002-renderer-compatibility-bridge.md) | ✅ Approved (frozen) | The compatibility layer that lets the existing renderers run unchanged during migration. |
| [MILESTONE-1-HANDOFF.md](./MILESTONE-1-HANDOFF.md) | ✅ Frozen | The exact scope of Milestone 1, the next implementation step. |

## Migration order (frozen)

```
Milestone 1  →  Electron compatibility runtime  →  Electron consolidation  →
Web shell    →  Markdown                         →  PDF                    →
Docs         →  Slides                           →  Sheets                 →
renderer migration  →  bridge deletion           →  cloud backend         →  collaboration
```

## Architectural corrections (frozen into the ADRs)

These two corrections were applied during the architecture review pass and are now part of the frozen spec:

1. **`getRuntime()` is bootstrap-only, not a domain dependency.** Domain services receive their dependencies explicitly through construction (`new DocumentServiceImpl(storage, files, ai, ...)`). They never internally call `getRuntime()`. This prevents the new architecture from quietly recreating the same hidden-global coupling that the migration is intended to eliminate.

2. **Bridge tests must cover both shape and dispatch.** A bridge that technically satisfies 280 method signatures while dispatching a method to the wrong service is a silent contract violation. Milestone 1 includes shape/coverage tests + dispatch tests + architecture-boundary tests.

## Out of scope

The existing `architecture/` parent folder (`ADR/`, `ARCHITECTURE.md`, `BOUNDARIES.md`, `DOMAIN-AUTHORITY.md`, `LICENSING.md`, `README.md`, `RECONNAISSANCE.md`, `UPSTREAM.md`) describes the **Contractor GenOffice SaaS** — a separate product grafted onto this fork. Those documents are **out of scope** for the office-suite web migration. The office-suite web migration starts from zero on the editor side; only the patterns (DbClient port, PGlite-for-tests, repository boundary enforcement, framework-neutral `handle()` seam) are borrowable as references.
