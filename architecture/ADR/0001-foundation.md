# ADR-0001: Foundation, upstream pin, web-vs-electron

> **Status: PROPOSED.** Foundation decision. Contains one **UNRESOLVED**
> question that must be decided before significant implementation begins.

## Context

The fork `pectoraux/contros-2.0` is a verified GitHub fork of
`genspark-ai/genoffice` (RECONNAISSANCE.md section 0). It is pinned at
`04a994b9e92eb55a6806eaa1e6be18e381c9d9df` with no divergence. This ADR
records the foundation decisions and the open question about the runtime
target.

## Decision 1 — Fork foundation

**DECIDED.**

- Product repository: `pectoraux/contros-2.0` (verified fork).
- Upstream: `genspark-ai/genoffice` (added as `upstream` remote).
- Baseline commit: `04a994b9e92eb55a6806eaa1e6be18e381c9d9df`.
- Drift management: pin + intentional merge (see `UPSTREAM.md`).
- Legacy `pectoraux/contros`: reference only.

## Decision 2 — Substrate reuse

**DECIDED.**

- GenOffice is the Office substrate. We do not rebuild Docs/Sheets/Slides/PDF/
  Markdown engines.
- We REUSE: `docx-engine`, `pptx-engine`, `pptx-render`, `file-parse`,
  `font-metrics`, `agent-core`, `ai-provider`, `ai-search`, `electron-utils`,
  `ui`, `i18n`, the shell, the license gates, the security posture.
- We ISOLATE: `ee/`, `@genoffice/project-store` (local convenience; not a
  domain authority), Univer (workbook model is a representation, not the
  authority), Genspark account auth (personal; wrap with tenant identity).
- We REPLACE: identity model (tenant-scoped), persistence authority (DB-backed
  domain truth), branding (trademark).

## Decision 3 — Licensing posture

**DECIDED** (with one open sub-question).

- Root Apache-2.0 inherited. `ee/` boundary preserved. No CLA (stable).
- License gates (`tools/check-licenses.mjs`, `cargo-deny`) REUSED.
- No GPL/AGPL/CPAL in production deps (verified).

### Q-lic1 — MPL/LGPL in the allowlist?

**UNRESOLVED.**

- **QUESTION:** Should the npm license gate allowlist be extended to include
  MPL-2.0 and LGPL-2.1/LGPL-3.0? The master prompt section 27 lists MPL (and
  by extension LGPL) as acceptable ("Prefer Apache, MIT, BSD, LGPL, MPL").
  GenOffice's current gate excludes them.
- **CURRENT EVIDENCE:** `tools/check-licenses.mjs` allowlist = MIT, MIT-0,
  Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0,
  CC-BY-4.0, Zlib, Unlicense, Python-2.0, Unicode-3.0, OFL-1.1. No MPL/LGPL.
  No current dependency requires it.
- **OPTIONS:**
  1. Keep GenOffice's stricter allowlist (no MPL/LGPL) until a dependency
     actually needs it. (Conservative; matches existing gate.)
  2. Extend the allowlist now to include MPL-2.0 and LGPL (with isolation
     rules) per the master prompt. (Permissive-of-permissive; aligns with
     prompt wording.)
- **TRADE-OFFS:** Option 1 is stricter than the prompt literally asks, but
  nothing currently requires MPL/LGPL, and adding them introduces
  copyleft-adjacent obligations (LGPL dynamic-linking rules, MPL file-level
  copyleft). Option 2 aligns with the prompt but adds obligations we don't
  yet need.
- **RECOMMENDATION:** Option 1. Keep the stricter gate. Revisit only when a
  concrete dependency (e.g. a specific BIM/schedule library) is evaluated and
  requires MPL/LGPL — at which point escalate to legal review and document
  the isolation boundary.
- **STATUS: UNRESOLVED** — pending Principal Architect confirmation. Default
  until decided: keep GenOffice's allowlist as-is.

## Q1 — Web vs. Electron (the major open question)

**UNRESOLVED — this is the highest-impact open question in the freeze.**

- **QUESTION:** Is "web is primary" (master prompt section 30) real for v1,
  or is Electron-first acceptable with web deferred to a later phase?
- **CURRENT EVIDENCE:**
  - GenOffice is **Electron-only**. There is no web shell, no server-side API,
    no browser runtime (RECONNAISSANCE.md section 3).
  - Renderers reach the system only through the Electron preload bridge +
    IPC. Each app has `electron.vite.config.ts`.
  - `@genoffice/electron-utils` and `@genoffice/ai-search` use Electron
    main-process APIs (`net.fetch` for Cloudflare bypass, `session.fromPartition`
    for proxy).
  - The Rust xlsx sidecar is a subprocess; web would need a server-side
    equivalent.
  - The master prompt says: "Web is the primary runtime. Electron is a
    packaging option. Do not create two products." (section 30/23)
- **OPTIONS:**
  1. **Electron-first, web deferred.** Ship the Contractor desktop product on
     Electron (inheriting GenOffice's mature runtime). Build the tenant/
     domain layers as Electron-main services + IPC. Defer web to a later
     phase that extracts the renderers into a web shell + replaces preload
     bridges with a server API. (Pragmatic; matches the actual codebase.)
  2. **Web-primary from day one.** Build a new web shell + server-side API +
     browser runtime for the Contractor domain workspaces, while the Office
     substrate (Docs/Sheets/Slides/PDF/Markdown) remains Electron-only until
     the web extraction is done. (Aligns with the prompt literally; ~order-
     of-magnitude more work; two runtimes temporarily.)
  3. **Hybrid.** Contractor domain workspaces (Commercial/Programme/Plans/
     Execution/Goals) are web-primary (React + server API + tenant model),
     and the Office substrate stays Electron (the office editors open inside
     the Electron shell, as today). The domain workspaces are the "new" web
     surface; the office editors remain "desktop." (Splits the product
     surface but keeps one identity/tenant/project-graph.)
- **TRADE-OFFS:**
  - Option 1 is fastest to a real product and reuses the most of GenOffice,
    but contradicts the literal "web is primary" directive.
  - Option 2 honors the directive but is a very large build, and the office
    editors cannot be web-primary without major work (pdf.js is web-native;
    Univer is web-native; but the preload/IPC/main-process coupling is not).
  - Option 3 is a credible middle path: the *Contractor* surfaces (where
    tenancy matters most) are web-primary; the *Office* surfaces (where
    GenOffice already excels on desktop) stay Electron. Risk: two runtimes
    must share one identity/tenant/project-graph.
- **RECOMMENDATION:** Option 3 (hybrid), **pending Principal Architect
  confirmation**. The Contractor domain workspaces are the multi-tenant
  surface and should be web-primary with a server API + tenant model; the
  Office substrate stays Electron (it's already excellent there, and
  re-platforming it is not the priority). The shared spine (identity,
  tenant, project graph, domain authorities, audit) is built once and
  consumed by both runtimes.
- **STATUS: UNRESOLVED.** This decision changes the scope of identity,
  persistence, and UI work by an order of magnitude. It must be decided
  before the implementation sequence (ARCHITECTURE.md section 32 step 1-2)
  begins.

## Consequences

- Until Q1 is decided, no tenant/identity/persistence implementation begins.
- The architecture freeze documents (this baseline) are written to be
  runtime-agnostic: the boundary (UI -> adapter -> service -> repo -> DB) and
  the domain authorities are the same regardless of Electron or web.
- The license-gate question (Q-lic1) is low-risk and can default to
  "keep as-is" safely.

## Verification

- Fork verified via GitHub API (`fork: true`, `parent: genspark-ai/genoffice`).
- Baseline verified via `git merge-base --is-ancestor HEAD upstream/main`.
- License gate verified via `node tools/check-licenses.mjs` (exit 0).
