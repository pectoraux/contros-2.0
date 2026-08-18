# Third-Party Dependency Assessment

> **Status: PROPOSED framework.** Every dependency adopted into Contractor
> GenOffice is assessed here before adoption. No dependency enters without an
> entry below (or in a sibling file) + a passing license gate. The existing
> GenOffice license gates (`tools/check-licenses.mjs`, `cargo-deny`) are
> reused.

## Assessment template

For each dependency under consideration, record:

```
### <package> — <one-line role>

- **License:** <SPDID(s)> — verified from <source>
- **Runtime:** in-process library / worker / child process / isolated service / reference-only
- **Web compat:** yes / no / unknown — evidence
- **Electron compat:** yes / no / unknown — evidence
- **Bundle impact:** <size / wasm / native module>
- **Security implications:** < hostile input? native code? network? >
- **Maintenance:** <active? last release? >
- **Architecture implications:** < does it become an authority? is it isolated? >
- **Authority role:** < engine / renderer / IO / transport / none >
- **Decision:** ADOPT / DEFER / REJECT — with reason
- **Isolation boundary:** < if ADOPT, how is it isolated from the domain authority? >
```

## Already-adopted (inherited from GenOffice, verified permissive)

These are in the upstream baseline. All verified by running
`node tools/check-licenses.mjs` (exit 0) and reading `deny.toml`. See
`architecture/RECONNAISSANCE.md` section 12/13 for the full table.

Summary (all OK, no action):

- Electron (MIT) — desktop runtime
- Univer core `@univerjs/*` (Apache-2.0) — sheets UI. **CAUTION: avoid
  Univer Pro (license-gated).**
- pdf.js (Apache-2.0), pdf-lib (MIT), PDFium (BSD-3-Clause) — PDF
- Tiptap / ProseMirror (MIT) — Docs/Markdown editors
- Konva (MIT) — canvas rendering (Slides, Sheets charts)
- HarfBuzz wasm (MIT) — text shaping
- calamine + IronCalc (Rust, MIT/Apache) — xlsx sidecar IO
- acorn (MIT) — AST parsing for AI layout scripts
- Liberation/Carlito/Caladea/Noto fonts (OFL/Apache-2.0)
- Unicode Character Database (Unicode-3.0) — radicals mapping

## Under consideration (not yet adopted)

### MPXJ — schedule file IO (.mpp/.mspdi/.xer/.pmxml)

- **License:** TBD — assess (likely LGPL or MPL; verify)
- **Runtime:** isolated service or in-process (Java? needs assessment — MPXJ
  is Java; would need a JVM sidecar or a port)
- **Web compat:** no (Java) — would need a server-side service
- **Electron compat:** via sidecar service only
- **Bundle impact:** JVM sidecar is heavy
- **Security implications:** parses untrusted schedule files (hostile input,
  ARCHITECTURE.md section 39 / BOUNDARIES.md section 9)
- **Maintenance:** TBD
- **Architecture implications:** IO only, behind a `ScheduleIOAdapter`;
  never the scheduling authority (ADR-0003 Decision 4)
- **Authority role:** none (IO component)
- **Decision:** DEFER — assess when Programme file IO is needed. Consider
  lighter alternatives (e.g. parse .mspdi XML directly, since it's XML).
- **Isolation boundary:** if adopted, isolated server-side service, never
  in-process in the renderer.

### web-ifc — IFC parsing (wasm)

- **License:** TBD — expected MIT/Apache; verify
- **Runtime:** in-process wasm (renderer) OR server-side
- **Web compat:** yes (wasm)
- **Electron compat:** yes
- **Bundle impact:** wasm binary (large)
- **Security implications:** parses untrusted IFC files (hostile input)
- **Maintenance:** TBD
- **Architecture implications:** viewer + measurement-candidate source;
  behind a `BimViewerAdapter`; never the `PlanMeasurement` authority
  (ADR-0004 Decision 4)
- **Authority role:** none (viewer/measurement candidate source)
- **Decision:** DEFER — assess before Plan/BIM phase (ADR-0004 Q6). Verify
  license, bundle size, determinism of geometry parsing.
- **Isolation boundary:** if adopted, in-process wasm in renderer for view;
  server-side service for heavy geometry.

### ThatOpen components / Fragments — BIM viewer components

- **License:** TBD — expected MIT/Apache; verify
- **Runtime:** in-process (renderer)
- **Web compat:** yes
- **Electron compat:** yes
- **Bundle impact:** TBD
- **Security implications:** renders untrusted model data
- **Maintenance:** TBD
- **Architecture implications:** rendering/interaction primitive; never the
  authority
- **Authority role:** none (rendering primitive)
- **Decision:** DEFER — assess with web-ifc (ADR-0004 Q6).
- **Isolation boundary:** renderer primitive.

### IfcOpenShell — server-side IFC geometry processing

- **License:** TBD (LGPL-3.0? — verify; if LGPL, assess dynamic-link/isolation
  obligations per `LICENSING.md` section 2)
- **Runtime:** isolated server-side service (Python/C++)
- **Web compat:** n/a (server-side)
- **Electron compat:** via service
- **Bundle impact:** heavy (native)
- **Security implications:** parses untrusted IFC (hostile input)
- **Maintenance:** TBD
- **Architecture implications:** isolated geometry service; never the
  authority
- **Authority role:** none (geometry service)
- **Decision:** DEFER — assess if/when heavy server-side IFC processing is
  needed. If LGPL, document isolation boundary per LICENSING.md.
- **Isolation boundary:** isolated service, never in-process.

### A Gantt library (rendering primitive)

- **License:** TBD — assess per candidate
- **Runtime:** in-process (renderer)
- **Web compat:** yes (most JS Gantt libs)
- **Electron compat:** yes
- **Bundle impact:** TBD
- **Security implications:** low (renders our own `ScheduleResult`)
- **Maintenance:** TBD
- **Architecture implications:** rendering primitive ONLY; never the
  scheduling engine (ADR-0003 Decision 3)
- **Authority role:** none (rendering primitive)
- **Decision:** DEFER — assess when Programme UI is built. The library must
  consume a `ScheduleResult` and emit constraint edits, not compute CPM.
- **Isolation boundary:** renderer primitive; `ScheduleResult` is the
  contract.

## Rejected

(none yet)

## Hard stops

- No GPL/AGPL/CPAL/SSPL/BUSL in the core product or distributed Electron
  bundle (LICENSING.md section 2).
- No dependency with an unverified or missing license.
- No dependency that would become a hidden authority (external engine as
  domain truth).
- No dependency that weakens the renderer sandbox / IPC validation /
  `safeExternalUrl` / AST interpreter.
