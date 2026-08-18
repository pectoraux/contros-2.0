# ADR-0001: Foundation, upstream pin, web-vs-electron, licensing posture

> **Status: DECIDED (foundation, Q1 web-vs-electron, Q-lic1 licensing).**
> Phase 0.5 foundation decision gate. This ADR converts the Phase 0
> recommendations into explicit decisions. Each decision uses the format
> QUESTION / EVIDENCE / OPTIONS / TRADE-OFFS / RECOMMENDATION / DECISION /
> CONSEQUENCES / DEFERRED QUESTIONS.

## Context

The fork `pectoraux/contros-2.0` is a verified GitHub fork of
`genspark-ai/genoffice` (`architecture/RECONNAISSANCE.md` section 0). It is
pinned at `04a994b9e92eb55a6806eaa1e6be18e381c9d9df` with no divergence.
The fork is Apache-2.0 (root) with an empty `ee/` enterprise boundary.

This ADR records the foundation decisions: the fork, the substrate reuse
posture, the licensing posture, and — most importantly — the runtime
architecture (Q1), which was the highest-impact open question from Phase 0.

## Decision 1 — Fork foundation

**DECIDED.**

- Product repository: `pectoraux/contros-2.0` (verified fork).
- Upstream: `genspark-ai/genoffice` (added as `upstream` remote).
- Baseline commit: `04a994b9e92eb55a6806eaa1e6be18e381c9d9df`.
- Drift management: pin + intentional merge (see `UPSTREAM.md`).
- Legacy `pectoraux/contros`: reference material only — behavior/contracts
  may be ported, implementation boundaries may not.

## Decision 2 — Substrate reuse

**DECIDED.**

- GenOffice is the Office substrate. We do not rebuild Docs/Sheets/Slides/PDF/
  Markdown engines.
- REUSE: `docx-engine`, `pptx-engine`, `pptx-render`, `file-parse`,
  `font-metrics`, `agent-core`, `ai-provider`, `ai-search`, `electron-utils`,
  `ui`, `i18n`, the shell, the license gates, the security posture.
- ISOLATE: `ee/` (enterprise boundary), `@genoffice/project-store` (local
  convenience; not a domain authority), Univer (workbook model is a
  representation, not the authority), Genspark account auth (personal; becomes
  one auth provider among possible others, not the tenant authority).
- REPLACE: branding (trademark requirement — GenOffice/Genspark are Mainfunc
  trademarks).

## Decision 3 — Licensing posture (Q-lic1 resolved)

### QUESTION

Should the npm license gate allowlist be extended to include MPL-2.0 and
LGPL-2.1/LGPL-3.0? The master prompt section 27 lists MPL (and by extension
LGPL) as acceptable ("Prefer Apache, MIT, BSD, LGPL, MPL"). GenOffice's
current gate excludes them.

### EVIDENCE

`tools/check-licenses.mjs` allowlist = MIT, MIT-0, Apache-2.0, ISC,
BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, CC-BY-4.0, Zlib,
Unlicense, Python-2.0, Unicode-3.0, OFL-1.1. No MPL/LGPL. No current
dependency requires it. The license gate passes (exit 0) at the pinned
baseline.

### OPTIONS

1. Keep GenOffice's stricter allowlist (no MPL/LGPL). Revisit only when a
   concrete dependency (e.g. a BIM/schedule library) actually requires it.
2. Extend the allowlist now to include MPL-2.0 and LGPL (with isolation
   rules) per the master prompt wording.

### TRADE-OFFS

- Option 1 is stricter than the prompt literally asks, but nothing currently
  requires MPL/LGPL, and adding them introduces copyleft-adjacent obligations
  (LGPL dynamic-linking rules; MPL file-level copyleft) that we do not need.
- Option 2 aligns with the prompt wording but adds obligations we do not yet
  need.

### RECOMMENDATION

Option 1.

### DECISION

**Option 1 — keep GenOffice's stricter allowlist (no MPL/LGPL by default).**

The gate is extended only on a per-dependency basis, with a documented
isolation boundary and legal review, when a concrete dependency requires
MPL/LGPL. The default allowlist stays exactly as inherited from GenOffice.

### CONSEQUENCES

- The license gate (`tools/check-licenses.mjs` and `cargo-deny`) is reused
  unchanged at the baseline.
- Any future MPL/LGPL dependency requires: (a) a `third-party/` assessment
  entry, (b) a documented isolation boundary, (c) legal/architecture review,
  (d) an explicit allowlist extension. None of these may be skipped.
- GPL/AGPL/CPAL/SSPL/BUSL remain categorically excluded from the core
  product and distributed bundle.

### DEFERRED QUESTIONS

- The exact isolation rules for an MPL/LGPL dependency (in-process vs.
  worker vs. child process vs. isolated service) are deferred to the
  `third-party/` assessment of the specific dependency that triggers it.

## Decision 4 — Runtime architecture (Q1 web-vs-electron resolved)

### QUESTION

How can Contractor Core be web-capable while GenOffice Office capabilities
remain reusable without creating two products? (Paraphrased from the master
prompt section 3: "Web is the primary runtime. Electron is a packaging
option. Do not create two products.")

### EVIDENCE

- GenOffice is **Electron-only**. There is no web shell, no server-side API,
  no browser runtime (RECONNAISSANCE.md section 3).
- Each app has `electron.vite.config.ts`. Renderers reach the system only
  through the Electron preload bridge + IPC.
- `@genoffice/electron-utils` and `@genoffice/ai-search` use Electron
  main-process APIs (`net.fetch` for Cloudflare bypass; `session.fromPartition`
  for proxy fallback).
- The Rust xlsx sidecar (`apps/sheets/native/xlsx-engine`) is a subprocess.
- The Office engines themselves (`docx-engine`, `pptx-engine`, `pptx-render`,
  `file-parse`, `font-metrics`) are pure TypeScript with no Electron
  dependency — they are web-compatible by construction.
- The Office *apps* (`apps/docs`, `apps/sheets`, `apps/slides`, `apps/pdf`,
  `apps/markdown`, `apps/shell`) ARE Electron-coupled (preload + main +
  IPC).
- `WorkbookAdapter` (`getSnapshot`/`plan`/`apply`/`undo`) already abstracts
  editor-agnostic planning and audit (RECONNAISSANCE.md section 15).
- The Contractor domain layer (tenancy, identity, project graph, domain
  authorities, audit, scheduling, pricing) does not exist in GenOffice and
  has no Electron dependency by design — it is new work.

### OPTIONS

#### Option A — Entire product becomes Electron-first

Contractor Core is built as Electron-main services + IPC, like the rest of
GenOffice. Web is deferred indefinitely.

- **Technical feasibility:** high. Matches the existing codebase directly.
- **Development cost:** lowest. Reuses the most of GenOffice.
- **Runtime complexity:** lowest. One runtime.
- **Offline implications:** excellent (local-first is inherent).
- **Office compatibility:** excellent (the Office apps are already
  Electron-native).
- **Security:** inherits GenOffice's hardened Electron posture (renderer
  lockdown, zod IPC, `safeExternalUrl`, AST interpreter).
- **Long-term maintainability:** good for desktop, but the product is
  permanently desktop-only. Multi-tenant SaaS deployment is not possible
  without a later rewrite.
- **Effect on product vision:** **violates** "web is primary" (master
  prompt section 30). A multi-tenant operating system that is desktop-only
  cannot serve project-based businesses that need shared tenant access
  across users, devices, and sites.

#### Option B — Entire GenOffice substrate is rewritten for web

Re-platform the Office apps (Docs/Sheets/Slides/PDF/Markdown/Shell) to a
browser runtime + server API. Contractor Core is also web-primary.

- **Technical feasibility:** partial. The Office engines are web-compatible
  (pure TS), but the apps' preload/IPC/main-process coupling is not. pdf.js
  and Univer are web-native; the docx/pptx/xlsx gateways and the Rust xlsx
  sidecar need server-side equivalents.
- **Development cost:** very high. Order-of-magnitude larger than Option A.
- **Runtime complexity:** medium (one runtime, but a server is now
  mandatory).
- **Offline implications:** poor without significant additional work (service
  workers, local cache, conflict resolution).
- **Office compatibility:** at risk during the rewrite; fidelity could
  regress.
- **Security:** web threat model applies (XSS, CSRF, authn/authz on every
  request).
- **Long-term maintainability:** good if the rewrite succeeds, but the
  rewrite itself is the risk.
- **Effect on product vision:** honors "web is primary" literally, but at
  the cost of destabilizing the Office substrate (which is GenOffice's
  core value) and delaying the Contractor domain work by months.

#### Option C — Hybrid: Contractor Core web-capable, Office engines reused
            through explicit adapters, Electron = desktop packaging/native
            capabilities

- **Contractor Core** (tenancy, identity, project graph, domain authorities,
  audit, scheduling, pricing, Goals, Execution, AI candidates) is built as
  a **web-capable server API + application services + repositories** with
  no Electron dependency. It runs identically when invoked from a web
  client or from the Electron main process.
- **GenOffice Office engines** (`docx-engine`, `pptx-engine`, `pptx-render`,
  `xlsx-engine`, `file-parse`, `font-metrics`, `agent-core`, `ai-provider`,
  `ai-search`) are **reused through explicit adapters**. The engines are
  pure TypeScript (web-compatible) or Rust sidecars (server-side equivalent
  for web). The Office *apps* (Electron preload/main/IPC) remain the desktop
  editors; on web, a thin Office-render adapter exposes the same engines to
  a browser renderer.
- **Electron** is the **desktop packaging / native-capabilities layer**
  (filesystem integration, offline cache, native dialogs, auto-update). It
  is not a second product — it consumes the same Contractor Core API the
  web client consumes.
- The **shared spine** (identity, tenant, project graph, domain authorities,
  audit) is built once. Both runtimes (web client, Electron desktop) talk
  to the same Core API. There is one canonical tenant model, one project
  graph, one audit model, one authority model — never two.

**Option C — technical feasibility / development cost / runtime complexity /
offline implications / Office compatibility / security / long-term
maintainability / effect on product vision:**

- **Technical feasibility:** high. The Office engines are already
  web-compatible (pure TS). The Contractor Core is new (no legacy coupling).
  The Electron apps keep working as the desktop editors. The Office-render
  adapter for web is the only genuinely new surface, and it can be phased in.
- **Development cost:** medium. Higher than Option A, much lower than
  Option B. The Contractor Core is built web-capable from the start (which
  it must be anyway for multi-tenancy); the Office substrate is reused, not
  rewritten.
- **Runtime complexity:** medium. Two *clients* (web, Electron desktop)
  share one *server* (Contractor Core API). The complexity is bounded and
  is the price of "one product, two surfaces."
- **Offline implications:** good. Electron desktop has full offline
  (inherent). Web has reduced offline (acceptable for a multi-tenant
  operating system; field-data capture can be added later via service
  workers + sync, but is not a foundation requirement).
- **Office compatibility:** excellent. The Office engines are untouched
  (DO NOT TOUCH per `BOUNDARIES.md`). Electron desktop editing is
  byte-preserving as today. Web Office rendering uses the same engines via
  the adapter; deep web editing of `.xlsx`/`.pptx`/`.docx` is phased in
  later, not a foundation requirement.
- **Security:** strong. Contractor Core enforces tenant isolation at the
  application/domain boundary for both runtimes. Electron inherits
  GenOffice's hardened posture. Web applies the standard web threat model
  on top of the same tenant-scoped Core API.
- **Long-term maintainability:** good. One Core, one authority model, one
  audit model. The Office engines are reused. Electron does not fork the
  product. Adding a third surface (e.g. mobile) later talks to the same
  Core.
- **Effect on product vision:** **honors** "web is primary" (Contractor
  Core is web-capable; the multi-tenant surface is web) **and** "do not
  create two products" (one Core, one identity, one tenant model, one
  project graph, one audit). Electron is a packaging option, exactly as
  the prompt requires.

### TRADE-OFFS

- Option A is fastest but permanently desktop-only — incompatible with a
  multi-tenant operating system that serves project-based businesses
  across users and sites.
- Option B honors "web is primary" literally but destabilizes the Office
  substrate (GenOffice's core value) and delays the Contractor domain work
  by months — a poor trade for foundation work.
- Option C is the only option that satisfies both "web is primary" and
  "do not create two products" without rewriting the Office substrate. Its
  cost is medium; its risk is bounded; it preserves GenOffice's Office
  fidelity and unblocks the Contractor domain work immediately.

### RECOMMENDATION

Option C.

### DECISION

**Option C — Hybrid.**

```
Contractor Core (web-capable server API + application services
                + repositories + pure domain functions)
        |                          |
        v                          v
  Web client (React)         Electron desktop (existing
  consumes Core API          GenOffice shell + Office apps,
  via Core API               consumes the SAME Core API
  adapter)                   via a main-process Core client)

GenOffice Office engines (docx-engine, pptx-engine, pptx-render,
                          xlsx-engine, file-parse, font-metrics,
                          agent-core, ai-provider, ai-search)
        |
        v  reused through explicit adapters, never authoritative
        |   for Contractor business state
        v
  Office representations (workbooks, decks, docs, PDFs, markdown)
        |
        v  mediated by domain adapters (WorkbookAdapter pattern);
           application services finalize the domain authority

Electron = desktop packaging + native capabilities (filesystem,
           offline cache, native dialogs, auto-update). Not a
           second product; consumes the same Core API.
```

Key constraints that follow from this decision:

1. **Contractor Core has zero Electron dependency.** Application services,
   repositories, pure domain functions, and the Core API are written to be
   runtime-agnostic. The Electron main process is *one client* of the Core
   API, not the host of it.
2. **The Core API is the only entry point to application services** for both
   the web client and the Electron main process. (`BOUNDARIES.md` section 1.)
3. **Office engines are reused, not rewritten.** They are wrapped by
   adapters (`WorkbookAdapter` and future domain adapters) that translate
   between Office representations and Contractor domain authorities. The
   engines remain authoritative for *rendering and editing office files*
   but are never authoritative for *Contractor business state*.
   (`DOMAIN-AUTHORITY.md` section 4.)
4. **Electron is a packaging option.** It adds filesystem integration,
   offline cache, native dialogs, and auto-update. It does not add a
   second database, a second identity model, or a second authority.
5. **One shared spine.** Identity, tenant, workspace, project graph,
   domain authorities, audit — built once, consumed by both surfaces.
   (`ARCHITECTURE.md` section 2 invariant 1.)
6. **Office web rendering is phased.** Phase-1 web surfaces are the
   Contractor domain workspaces (Commercial, Programme, Plans/BIM,
   Execution, Goals). Deep web editing of `.xlsx`/`.pptx`/`.docx` is
   deferred to a later phase and is not a foundation requirement. The
   Electron desktop editors continue to handle deep office editing.

### CONSEQUENCES

- Contractor Core is built as a server (HTTP/WebSocket API) from day one.
  The sandbox's Next.js environment is one possible host for the Core API
  during development; the canonical host is a deployment the Principal
  Architect chooses (per Q3/ADR-0005).
- The Electron main process gains a Core API client (replacing direct
  `project-store` calls for Contractor domain concerns). `@genoffice/project-store`
  continues to handle local Office/document convenience state (chat history,
  recent files), never Contractor domain authority.
- The web client is a React app consuming the Core API. It is built in
  parallel with the Core, not after.
- Office engines (`docx-engine`, etc.) are imported by both the Electron
  apps (as today) and, where needed, by the Core (for server-side
  generation of representations from authorities — e.g. generating an
  estimate workbook `.xlsx` from an `EstimateRevision`).
- The Rust xlsx sidecar runs as a subprocess (Electron desktop) OR a
  server-side service (web/Core). The same Rust binary; different host.
- AI (`agent-core`, `ai-provider`, `ai-search`) is invoked through the
  Core (tenant-scoped credentials), not directly from the renderer.
  GenOffice's existing `genoffice-auth.ts` (personal Genspark account)
  becomes one auth provider for AI credentials, wrapped by the tenant
  identity layer (per Q4/ADR-0005).
- Two surfaces must share one spine — this is enforced by the invariant
  "one canonical everything" (ARCHITECTURE.md section 2).

### DEFERRED QUESTIONS

- The exact Core API transport (REST + WebSocket? gRPC? tRPC?) is a
  Phase-1 implementation detail, not a foundation decision. Decided when
  the Core API is built (ARCHITECTURE.md section 32 step 7).
- The exact web client framework details (routing, state management) are
  Phase-1 implementation details.
- Office web-rendering (deep `.xlsx`/`.pptx`/`.docx` editing in a browser)
  is deferred to a post-foundation phase. The Phase-1 web surfaces are the
  Contractor domain workspaces; deep office editing stays on Electron
  desktop until the Office-render adapter is built.
- Q2 (office-file-vs-domain-authority synchronization semantics) is
  resolved enough by this decision to proceed (the domain authority is
  canonical; the office file is a representation); the detailed sync
  mechanics remain deferred to ADR-0002 as before.

## Consequences (overall)

- Q1 is DECIDED (Option C / Hybrid). Q-lic1 is DECIDED (Option 1 /
  stricter allowlist, extended per-dependency with review).
- The implementation sequence (ARCHITECTURE.md section 32) is unblocked
  for: Identity -> Tenant -> Workspace -> Project -> Audit -> Revision
  framework -> Core API. These are built web-capable (no Electron
  dependency).
- The Electron main process becomes a Core API client; the web client is
  another Core API client. Both share the spine.
- No Contractor feature implementation (Commercial/Programme/Plans/BIM/
  Execution/Goals/AI) begins until Identity + Tenant + Workspace +
  Project + Audit + Revision framework + Core API exist (master prompt
  section 12 implementation gate).

## Verification

- Fork verified via GitHub API (`fork: true`, `parent: genspark-ai/genoffice`).
- Baseline verified via `git merge-base --is-ancestor HEAD upstream/main`.
- License gate verified via `node tools/check-licenses.mjs` (exit 0) —
  evidence the current allowlist (Option 1 for Q-lic1) is enforceable.
- This ADR is design-only. No code is introduced by the decision commit.
