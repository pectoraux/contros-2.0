# GenOffice Reconnaissance Report

> Phase 0 output. This is the **evidence base** for the architecture freeze.
> It records the verified state of the upstream GenOffice repository at the
> pinned fork baseline. It is descriptive, not prescriptive — the prescriptive
> rules live in `ARCHITECTURE.md`, `DOMAIN-AUTHORITY.md`, `BOUNDARIES.md`,
> `LICENSING.md`, `UPSTREAM.md`, and the ADRs.
>
> All claims here are backed by reading the actual repository at:
> `pectoraux/contros-2.0` @ `04a994b9e92eb55a6806eaa1e6be18e381c9d9df`
> (verified fork of `genspark-ai/genoffice`, `fork: true` per GitHub API).

## 0. Repository provenance

| Field | Value | Evidence |
| --- | --- | --- |
| Product repository | `pectoraux/contros-2.0` | `git remote -v`; GitHub API `full_name` |
| Origin | `https://github.com/pectoraux/contros-2.0.git` | `git remote -v` |
| Upstream | `https://github.com/genspark-ai/genoffice.git` | `git remote -v` (added) |
| Fork relationship | `fork: true`, `parent: genspark-ai/genoffice`, `source: genspark-ai/genoffice` | GitHub API `/repos/pectoraux/contros-2.0` |
| Default branch | `main` | GitHub API |
| Fork baseline commit | `04a994b9e92eb55a6806eaa1e6be18e381c9d9df` | `git rev-parse HEAD` == `git rev-parse upstream/main` |
| Baseline commit subject | `Sync snapshot (2026-08-16) (#99)` | `git log -n1 --oneline upstream/main` |
| Divergence | none (`git log upstream/main..HEAD` empty; merge-base == HEAD) | `git merge-base --is-ancestor HEAD upstream/main` -> true |
| Upstream HEAD (at recon) | `04a994b9e92eb55a6806eaa1e6be18e381c9d9df` | `git rev-parse upstream/main` |

The fork is genuine and has not diverged. Baseline = upstream HEAD.

## 1. Repository topology

Monorepo, npm workspaces (`apps/*`, `packages/*`), plus one Rust sidecar.

### Apps (6, all Apache-2.0, all Electron)

| App | Package | Engine basis | Notable deps |
| --- | --- | --- | --- |
| Docs | `@genoffice/docs` | byte-preserving `.docx` (paragraph patch, `docxIndex` anchors) | electron-updater, pdf-lib, Tiptap |
| Sheets | `@genoffice/sheets` | **Univer** core (Apache-2.0) + in-house extensions + **Rust sidecar** | 14 `@univerjs/*` presets, Konva |
| Slides | `@genoffice/slides` | in-house `pptx-engine` + `pptx-render`, Konva canvas, HarfBuzz wasm | acorn, harfbuzzjs, pngjs, utif2 |
| PDF | `@genoffice/pdf` | pdf.js (Apache-2.0) + pdf-lib (MIT) + PDFium wasm (BSD-3-Clause) | true text editing (content-stream rewrite) |
| Markdown | `@genoffice/markdown` | Tiptap over plain `.md` files | (none external) |
| Shell | `@genoffice/shell` | Electron tab host; home screen, theming, auto-update | electron-builder |

Each app has `src/main` (Electron main), `src/preload`, `src/renderer` (React), `src/shared` (typed IPC contracts), `tests/` (vitest), `electron.vite.config.ts`, `tsconfig.json`.

### Packages (12, all `@genoffice/*`, all Apache-2.0, pure TypeScript unless noted)

| Package | Role | Electron-coupled? |
| --- | --- | --- |
| `ui` | shared React kit, design tokens (`tokens.css`), AiComposer, color-picker, icons | no |
| `i18n` | shared i18n core | no |
| `electron-utils` | safe-external-url, context-menu, app-menu, navigation-guard, dialog-memory, remote-image | **yes** (Electron main) |
| `file-parse` | text extraction for AI attachments (xlsx/pptx/docx/pdf/text) | no |
| `font-metrics` | sfnt parsing, font location, metrics | no |
| `docx-engine` | docx parse to block tree, OOXML fragment gen, byte-level patch | no |
| `pptx-engine` / `pptx-render` | pptx model + rendering | no |
| `ai-provider` | provider abstraction (genspark/anthropic/gemini/deepseek/openai/custom), streaming, watchdog | no (but auth is desktop-personal) |
| `ai-search` | gsk to Serper to DuckDuckGo search; image + web; `genoffice-auth.ts` (device-code login) | **yes** (uses Electron `net.fetch` for Cloudflare bypass) |
| `agent-core` | `AgentLoop`, `AgentSkill` composition, IPC transport, `sanitizeAgentPayload` | transport impl is Electron; loop is generic |
| `project-store` | local-filesystem project + chat history (JSON/JSONL) | **no** (path injected by caller) |

### Other top-level

- `ee/` - **reserved, currently empty** except `README.md` + `LICENSE`. GenOffice Enterprise License (source-available, dev/test only, production needs Mainfunc enterprise agreement). Enforced via `.github/CODEOWNERS`.
- `tools/` - `check-licenses.mjs` (npm license gate), `gen-third-party-notices.mjs`, `check-theme-colors.mjs`, `format-changed.mjs`, fidelity-compare scripts.
- `scripts/` - fidelity baselines, update feed utils, drivers (gitignored Playwright/Electron acceptance).
- `e2e/` - Playwright specs.
- `fixtures/` - generated `.docx` corpus.

## 2. Runtime architecture

**Electron-first.** There is no web deployment target today.

- Node `>=22.12.0`, npm `>=10`. Rust toolchain required only for the sheets xlsx sidecar.
- Build: `electron-vite` per app; `electron-builder` packaging (mac/win/linux).
- Dev: `npm run dev` runs five renderer Vite servers (docs:5173, sheets:5174, slides:5175, pdf:5176, markdown:5177) + the shell.
- Per `CLAUDE.md`: app `src/main` code is compiled **into the shell build**; preload changes require a rebuild; workspace deps in an app's `dependencies` must also be in `externalizeDepsPlugin` `exclude` or the packaged app crashes.

## 3. Web architecture

**Not implemented.** Each app's renderer is a Vite-served React app, but it reaches the system only through the Electron preload bridge + IPC. There is no web shell, no server-side API, no browser runtime.

This is the single largest gap relative to the "web is primary" directive (see ADR-0001, OPEN QUESTION Q1).

## 4. Electron architecture

Mature and deliberately hardened (`SECURITY.md`):

- Every window: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- IPC is typed and validated; sheets uses **zod end-to-end**.
- `shell.openExternal` funnels through a single shared gate (`@genoffice/electron-utils` -> `safeExternalUrl`) with a protocol allowlist (http/https; PDF link annotations additionally allow mailto). `file:`, `javascript:`, custom schemes always rejected.
- No hardcoded API keys. AI requests proxy through the signed-in Genspark account by default; user-supplied keys stay in the OS-level settings store.
- **AI layout scripts (slides)**: parsed by Acorn, executed by a constrained AST interpreter (`apps/slides/src/renderer/ai/layout-script-interpreter.ts`). Not `eval`/`Function`/VM/worker. Statement/expression/call-depth limits. Prototype-free JSON copies. Edit primitives validate arguments and write only to an op buffer applied through the same command pipeline as manual edits.
- **AI-generated HTML (slides export)**: rendered in a hostile `BrowserWindow` (full lockdown, no preload, no IPC, watchdog timeout, main-process-driven `executeJavaScript`).

## 5. Office substrate

| Substrate | Engine | Authority model |
| --- | --- | --- |
| Docs | `docx-engine`: parse `word/document.xml` to block tree anchored by `docxIndex` + original XML slice; dirty blocks to OOXML fragments to splice into original `document.xml`; repack zip, all other entries byte-for-byte. Tiptap streaming editor. | **the `.docx` file is the source of truth**; edits are narrow patches |
| Sheets | Univer core (UI) + Rust sidecar (calamine + IronCalc, read + calc) + in-house charts (Konva) + `xlsx-gateway` (copy-on-write OOXML). `WorkbookAdapter` (`getSnapshot`/`plan`/`apply`/`undo`) mediates. | **the `.xlsx` file is the source of truth**; gateway rewrites only the target worksheet, refuses stale hashes, atomic rename write |
| Slides | in-house `pptx-engine` (parse/edit) + `pptx-render` (build-slide, render-tree, coords, text-layout, build-chart, fill, preset-geometry). Konva canvas. HarfBuzz shaping. | **the `.pptx` file is the source of truth** |
| PDF | pdf.js (render) + pdf-lib (assembly) + PDFium wasm (content-stream rewrite). True text editing - paragraph selection, in-block reflow, original-font preservation, subset-embedded fonts. Not cover-up annotations. | **the `.pdf` file is the source of truth** |
| Markdown | Tiptap block editor over plain `.md` files; saved back as plain Markdown. | **the `.md` file is the source of truth** |

**Unifying philosophy** (from README): "The original file is the source of truth, edits are applied as narrow patches, and everything the editor didn't touch survives the round trip untouched."

This is **the** central tension for Contractor GenOffice: the Office substrate treats the office *file* as authoritative. Contractor OS domain authorities (`EstimateRevision`, `ProgrammeRevision`, etc.) are separate, revisioned, tenant-scoped truths. The office file is a *representation* of canonical state, not the canonical state. See ADR-0002.

## 6. Persistence / storage architecture

**`@genoffice/project-store`** - local-filesystem JSON/JSONL store, no Electron dependency (path injected by caller):

```
userData/projects/
  index.json                       # { projects[], fileMap{path->projectId}, chatIdByPath{path->chatId} }
  <projectId>/
    project.json                   # { id, name, createdAt, updatedAt, files[] }
    chats/<chatId>.jsonl           # append-only chat history (one JSON line per message)
  .trash/<id>-<ts>/                # soft-deleted projects
```

- Atomic writes (`.tmp` + rename). Tolerant JSONL parsing (bad lines skipped, no crash). In-memory `seq` counters, initialized from JSONL line count on first read.
- `chatId` = `sha256(filePath).slice(0,16)` - an **identity** hash of the path (not a content-integrity hash of the document).
- Stores: projects (file groupings), fileMap, chatIdByPath, chat messages (seq, ts, role, text, fileRef, tools, attachments), timeline aggregation.

**Critical gaps for Contractor GenOffice:**

1. **Single-tenant, local-desktop.** No `tenantId` / `organizationId` anywhere. Cannot enforce tenant isolation (Section 11).
2. **No database. No server-side persistence.** Domain truth lives only on one machine's filesystem.
3. **The "project" here is a file-grouping + chat-history convenience**, not the Contractor OS Project graph (Tenant -> Workspace -> Project -> BOQ/Estimate/Bid/Programme/Actuals).
4. **No domain authority concepts** (no `EstimateRevision`, `ProgrammeRevision`, `PlanMeasurement`, `ProjectActual`, `Goal`).

`sheets/docs/architecture.md` explicitly lists production gaps the upstream authors already acknowledge:

> - Durable SQLite transaction and audit journal.
> - Local privacy classifier and cloud model gateway.
> - Signed updates, crash recovery, telemetry, and enterprise controls.

## 7. Identity / authentication

**Personal / desktop identity** - `packages/ai-search/src/genoffice-auth.ts`:

- Device-code OAuth flow (`/api/office_addin_auth/device_code?app_type=genoffice`) to browser approve to poll `/token` for a 30-day Bearer to `POST /session` for a cookie to `POST /api/api_tokens/create` minting a gsk API key named `"genoffice"` (the `key_name` lands in billing as `billing_tag`).
- Stored in `~/.genoffice/auth.json` (mode `0o600`), deliberately NOT the shared config.json.
- Re-login revokes the superseded key (best-effort). Logout revokes server-side + removes local.
- Proxy fallback fetch (Chromium `net.fetch` for Cloudflare bot-challenge bypass; pinned session for registered proxy).

Alternative: user-supplied provider API keys (Anthropic/Gemini/DeepSeek/OpenAI/custom) in the OS settings store.

**No tenant / organization / workspace concept. No multi-user. No server-side identity.** See ADR-0005 (multitenancy) - this is a foundational gap.

## 8. AI infrastructure

| Package | Role | Authority? |
| --- | --- | --- |
| `ai-provider` | provider abstraction, streaming (SSE), watchdog (connect/idle/response timeouts), credits/network/timeout error codes | no - transport only |
| `ai-search` | gsk to Serper (`SERPER_API_KEY`) to DuckDuckGo fallback; web + image; `COPYRIGHT_HOSTS` filter; runs in main process | no - utility |
| `agent-core` | `AgentLoop` (agent execution), `composeSkills`/`AgentSkill` (skill composition), `createIpcTransport` (Electron transport), `sanitizeAgentPayload` | no - generic loop |

**AI is already advisory** per `apps/sheets/docs/architecture.md` trust boundary:

```
Renderer -> context extractor -> local privacy policy -> cloud planner
       -> untrusted command DSL -> local validation and dry-run
       -> user approval -> atomic commit and audit
```

> "The document core is the only workbook writer. The renderer cannot access disk, model credentials, or subprocesses. A cloud model cannot invoke native capabilities or commit files."

This is the Section 22 / Section 25 pattern, already implemented. REUSE.

AI auth is per-desktop-user (Genspark account). For multi-tenant Contractor deployments, this needs tenant-scoped credential resolution + audit.

## 9. IPC architecture

- Typed preload bridge to validated Electron IPC to main process.
- Each app: `src/shared/ipc.ts` / `src/shared/ipc-channels.ts` / `src/shared/desktop-api.ts`.
- Sheets uses **zod end-to-end**.
- Renderers cannot reach disk, credentials, or subprocesses directly - only through validated channels.
- `safeExternalUrl` gate for all `shell.openExternal`.

This is the Section 12 boundary, already enforced. REUSE.

## 10. Test architecture

- **Vitest** per workspace (`vitest.config.ts` in each app/package). Root `npm test` runs them in dependency order.
- **Playwright E2E** (`e2e/`, `playwright.config.ts`).
- **Rust sidecar tests** (cargo).
- **License gates**: `tools/check-licenses.mjs` (npm, reads `package-lock.json`, no install) + `cargo deny check licenses` (Rust, `apps/sheets/native/xlsx-engine/deny.toml`).
- **Theme-color gate**: `tools/check-theme-colors.mjs` (chrome colors must use semantic tokens, not raw hex).
- **Format gate**: `tools/format-changed.mjs` (incremental Prettier - only changed files).
- **Fidelity baselines**: `scripts/docs-word-fidelity.mjs`, `scripts/pagination-baseline*.mjs` (macOS + Word + AppleScript, optional local, never in CI).

## 11. CI / build system

Per `CONTRIBUTING.md`, every change must pass:

```
npm run format:check
npm run lint          # ESLint, 0 errors required; warnings allowed
npm run typecheck     # tsc --noEmit across every workspace
npm test              # engine + app unit tests + Rust sidecar tests
npm run licenses       # production dependency licenses within the permissive allowlist
```

Packaging: `npm run dist:mac|win|linux` (regenerates third-party notices, builds all six apps, packages). Code signing optional (unsigned artifacts warn, don't fail).

## 12. Licensing

| Layer | License | Risk |
| --- | --- | --- |
| Root (`LICENSE`) | **Apache-2.0** (Copyright 2026 Mainfunc, Inc.) | none - permissive, aligns with Section 27 |
| `ee/` (`ee/LICENSE`) | GenOffice Enterprise License (source-available, dev/test only; production/hosting/distribution requires Mainfunc enterprise agreement) | **high if built upon** - but currently **empty**; reserved boundary |
| CLA | none; inbound = outbound Apache-2.0 section 5 ("the open-source core cannot be retroactively relicensed") | none - stable |
| npm production deps | verified **within allowlist** (`node tools/check-licenses.mjs` -> exit 0) | none - gate enforces |
| Rust sidecar deps | `cargo-deny`, allowlist MIT/Apache-2.0/Apache-2.0 WITH LLVM-exception/BSD-2-Clause/BSD-3-Clause/0BSD/Zlib/Unicode-3.0/Unlicense/CC0-1.0/BSL-1.0 | none - gate enforces |
| Bundled fonts | Liberation, Carlito, Caladea, Noto CJK (OFL/Apache-2.0) | none |
| Unicode data | `apps/pdf/src/shared/radicals.ts` derived from Unicode Character Database 17.0.0 (Unicode License v3, `LICENSE-UNICODE.txt`) | none |
| **Trademark** | "GenOffice and Genspark names and logos are trademarks of Mainfunc, Inc. ... Forks should use their own branding." (README License) | **must rebrand** |

### npm allowlist (from `tools/check-licenses.mjs`)

```
MIT, MIT-0, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD,
BlueOak-1.0.0, CC0-1.0, CC-BY-4.0, Zlib, Unlicense, Python-2.0,
Unicode-3.0, OFL-1.1
```

Handles SPDX `OR`/`AND`/`WITH`; `/` dual-license shorthand. `EXCEPTIONS` map for packages with missing license fields (currently `@univerjs/telemetry: Apache-2.0`).

### Key dependencies (all permissive)

Electron (MIT), Univer (Apache-2.0 core; **note: README references a "license-gated Univer Pro chart package"** - Contractor use must stay on Apache core), pdf.js (Apache-2.0), pdf-lib (MIT), PDFium (BSD-3-Clause via `@embedpdf/pdfium`), Tiptap/ProseMirror (MIT), Konva (MIT), HarfBuzz (MIT, wasm), calamine + IronCalc (Rust, MIT/Apache).

**No GPL / AGPL / CPAL** found in production dependencies (verified by running the gate).

## 13. Third-party dependencies - classification

| Dependency | License | Runtime | Web-compat | Electron-compat | Authority implications |
| --- | --- | --- | --- | --- | --- |
| Electron | MIT | in-process (runtime) | n/a (it *is* the desktop runtime) | yes | none |
| Univer core | Apache-2.0 | in-process (renderer lib) | yes | yes | **Univer IS the workbook model in sheets today** - must be demoted to a representation for Contractor OS |
| Univer Pro (chart pkg) | license-gated (avoid) | in-process | unknown | unknown | avoid |
| pdf.js / pdf-lib / PDFium | Apache-2.0 / MIT / BSD-3-Clause | in-process / wasm | yes (pdf.js is web-native) | yes | none |
| Tiptap / ProseMirror | MIT | in-process | yes | yes | none |
| Konva | MIT | in-process (canvas) | yes | yes | none - rendering primitive |
| HarfBuzz (wasm) | MIT | wasm | yes | yes | none - shaping only |
| calamine / IronCalc | MIT/Apache | **Rust sidecar process** | no (sidecar) | yes (bundled) | none - xlsx IO only |
| Genspark proxy | (account-based, no license) | network | yes | yes | **auth is per-desktop-user; needs tenant scoping** |
| acorn | MIT | in-process | yes | yes | none - AST parsing for AI scripts |

No fork-of-a-whole-application dependencies. All are engines/components.

## 14. Existing project / workspace concepts

GenOffice's "project" (`@genoffice/project-store`) = a **grouping of files + AI chat history**. It is a convenience layer for the chat experience, not a domain authority.

**No** Contractor OS concepts exist:
- no Tenant / Organization / Workspace
- no Opportunity
- no Plans / BOQ / EstimateRevision / Bid / ProgrammeRevision / Actuals / Goals
- no pricing knowledge base

## 15. Existing domain boundaries

GenOffice already implements (in the Office-substrate sense):

- **Trust boundary** (renderer -> typed preload -> validated IPC -> main -> sidecar/gateway). Strong. Aligns with Section 12.
- **`WorkbookAdapter`** (`getSnapshot`/`plan`/`apply`/`undo`) - editor-agnostic abstraction. REUSE as the pattern for all Contractor domain adapters.
- **File-as-source-of-truth** (byte-preserving round-trip) - Office substrate philosophy. Must be reconciled with Contractor domain authority (ADR-0002).
- **AI-as-advisory** (untrusted command DSL -> validation -> dry-run -> approval -> atomic commit -> audit). Aligns with Section 22/25.
- **`sanitizeAgentPayload`** - AI payload sanitization already exists.

## 16. Existing architectural risks

1. **No multi-tenancy.** No `tenantId` anywhere in persistence, identity, or AI auth. (Section 11 violation.)
2. **Local-filesystem persistence only.** No server-side / DB-backed domain authority. (Cannot host canonical domain truth.)
3. **Personal desktop identity** (Genspark account). Not tenant-scoped.
4. **Web is not implemented.** Electron-only. "Web is primary" (Section 30) is aspirational, not current.
5. **Univer as workbook authority** in sheets. Must be demoted to a representation for Contractor OS.
6. **File-as-source-of-truth vs. domain authority.** Office substrate treats the office file as authoritative; Contractor domain authorities are separate. Tension to resolve (ADR-0002).
7. **Trademark.** GenOffice/Genspark are Mainfunc trademarks. Fork must rebrand.
8. **Upstream is a mirror.** `main` advances via "Sync snapshot" squashed commits from a private tree (CONTRIBUTING.md). Drift management cannot use PR history; must diff snapshots.
9. **`ee/` enterprise boundary.** Currently empty, but any future enterprise code there is license-locked. Do not build domain authority on `ee/`.

## Classification: REUSE / ISOLATE / EXTEND / REPLACE / DO NOT TOUCH

### REUSE (as-is; Apache-2.0; no authority conflict)

- All office engines: `docx-engine`, `pptx-engine`, `pptx-render`, `file-parse`, `font-metrics`. Byte-preserving fidelity is the Office substrate value.
- `@genoffice/agent-core` - `AgentLoop`, `AgentSkill`, `sanitizeAgentPayload`. Generic agent infrastructure.
- `@genoffice/ai-provider` - provider abstraction, streaming, watchdog. (Wrap with tenant-scoped credential resolution.)
- `@genoffice/ai-search` - search utility. (Tenant-scoped keys.)
- `@genoffice/electron-utils` - safe-external-url, context-menu, app-menu, navigation-guard, dialog-memory.
- `@genoffice/ui`, `@genoffice/i18n`.
- `apps/shell` - Electron tab host. (Rebrand.)
- License gates - `tools/check-licenses.mjs`, `apps/sheets/native/xlsx-engine/deny.toml`. Extend allowlist only with permissive licenses.
- Security posture - renderer lockdown, zod IPC, `safeExternalUrl`, AST interpreter for AI scripts.

### ISOLATE (keep at arm's length; do not build authority on)

- `ee/` - enterprise-license boundary. No Contractor domain authority here.
- `@genoffice/project-store` - keep as local convenience store (chat history, recent files). **Not** a domain authority. Contractor domain authorities live in a separate, tenant-scoped store.
- Univer SDK in sheets - workbook model is a *representation*, not the `EstimateRevision` authority. `WorkbookAdapter` mediates.
- Genspark account auth (`genoffice-auth.ts`) - personal desktop identity. Wrap with tenant identity layer.

### EXTEND (add to; preserve existing behavior)

- License-gate allowlist - only with permissive licenses.
- Agent skills - new Contractor OS skills (BOQ, estimate, programme, plan-measurement).
- IPC channels - new tenant-scoped domain channels.
- `WorkbookAdapter` pattern - new domain adapters for Estimate / Programme representations.

### REPLACE (swap for Contractor OS needs)

- **Identity model** - tenant-scoped identity replaces/overrides personal Genspark account for multi-tenant deployments (personal mode may remain for single-user desktop).
- **Persistence authority** - tenant-scoped, DB-backed domain authority store replaces local-filesystem for domain truth. `project-store` remains for local convenience.
- **Branding** - replace GenOffice/Genspark names + logos (trademark requirement).

### DO NOT TOUCH (without explicit architectural approval)

- Byte-preserving file round-trip engines (`docx-engine`, `pptx-engine`, `xlsx-engine`). They are the Office substrate value.
- Security boundaries - renderer lockdown, zod IPC, `safeExternalUrl`, AST interpreter.
- License-gate allowlist - never weaken; only extend with permissive licenses.
- `ee/` boundary.

## What Contractor OS needs to add (new, on top of GenOffice)

- Tenant / organization / workspace model (identity + persistence).
- Project graph: Tenant -> Workspace -> Project -> { Opportunity, Plans, BOQ, EstimateRevisions, Bids, ProgrammeRevisions, Actuals, Goals }.
- Domain authorities: `EstimateRevision`, `ProgrammeRevision`, `PlanMeasurement`, `ProjectActual`, `Goal` - immutable, revisioned, tenant-scoped, DB-backed.
- Scheduling engine (own, deterministic, CPM) - Programme domain (ADR-0003).
- Plan/BIM viewer (web-ifc / ThatOpen) - Phase 1 view/measure/takeoff (ADR-0004).
- Pricing knowledge base (conceptual - do not schema prematurely; ADR-0006).
- Tenant-scoped AI credential resolution + audit.
- Web deployment path (if "web is primary" is real - significant scope; ADR-0001 Q1).
- Rebranding (trademark).

## License risks

- `ee/` enterprise license - if Contractor OS builds on future `ee/` code, production use requires Mainfunc enterprise agreement. **Mitigation**: do not build domain authority in `ee/`; keep Contractor OS in the Apache-2.0 tree.
- Univer Pro - "license-gated Univer Pro chart package" (README). **Mitigation**: stay on Apache Univer core; avoid Pro tier; verify per-feature.
- Trademark - GenOffice/Genspark are Mainfunc trademarks. **Mitigation**: rebrand the fork.
- No CLA / inbound = outbound - stable. Good.

## Web risks

- Electron-only today. No web shell. No server-side API. No browser runtime.
- Renderers depend on Electron preload bridges (`desktop-api`, `ipc`). Web needs an adapter layer.
- The Rust sidecar is a subprocess; web needs a server-side equivalent.

## Electron risks

- Mature security posture (good).
- App main compiled into shell build (operational gotcha).
- Native sidecar (Rust) must be bundled per-platform.
- Local-first is inherent (good for desktop, neutral for web).

## Upstream drift risks

- Upstream `main` is a **mirror** advancing via "Sync snapshot" squashed commits from a private tree. PR-level history is not visible in `git log`.
- Strategy (ADR in UPSTREAM.md): pin baseline -> fetch -> diff snapshot -> license scan -> architecture review -> test -> intentional merge. No auto-merge.

## Recommended fork baseline

**`04a994b9e92eb55a6806eaa1e6be18e381c9d9df`** ("Sync snapshot (2026-08-16) (#99)").

This IS the current fork baseline (no divergence). Pin it in `architecture/UPSTREAM.md`.
