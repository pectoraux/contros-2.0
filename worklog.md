# GenOffice Phase 2 — Increment 5A Worklog

Multi-agent shared work log. Append-only. Each section starts with `---`.

Baseline: `96f297ce7785cb6d73d04328244725623df5d881`

---

Task ID: 1
Agent: main (Principal Architect + implementer)
Task: Phase 2 — Increment 5A: Legacy Session Adoption for Migrated Sheets Read Path

Work Log:
- Restored the GenOffice monorepo from GitHub (pectoraux/genoffice) into the
  workspace via the user's PAT, checked out baseline 96f297c.
- Discovered that 8 missing `@genoffice/*-shared` packages referenced by
  `packages/renderer-bridge/package.json` are not in the public npm
  registry. Created local stub packages to let `npm install` succeed for
  testing (gitignored — not committed).
- Analyzed the integration gap: legacy `workbook:select` opens workbooks via
  `XlsxSidecarClient.open()` directly (spawning a sidecar process); migrated
  `read-range` / `read-formulas` / `recalc` / `read-media` / `close` go
  through `SheetsShellCoordinator` → `SpreadsheetService` →
  `ElectronXlsxSidecarEngine` → `SidecarProtocolClient`. Two separate
  sidecar processes — the engine's session was invisible to the legacy
  open path.
- Designed adoption: ONE shared sidecar process (legacy `XlsxSidecarClient`
  injected into the engine via the new `SidecarProtocolLike` interface).
  `engine.adoptExternalSession()` wraps the existing sidecar `sessionId`
  into an opaque `EngineSessionHandle` — pure in-process, no wire call.
- Implemented `SidecarProtocolLike` in
  `packages/platform-electron/src/capabilities/sidecar-protocol-client.ts`.
- Made `XlsxSidecarClient.request` public and added `onProcessExit` so it
  satisfies `SidecarProtocolLike`.
- Added `ElectronXlsxSidecarEngine.adoptExternalSession(opts)` — creates an
  opaque handle wrapping an EXISTING sidecar session. NO wire call.
- Added `ElectronXlsxSidecarEngineConfig.sidecarClient` — accepts an
  injectable sidecar client. When provided, the engine uses it instead of
  constructing its own (eliminating double-spawn).
- Fixed a pre-existing engine defect: `readRange` / `readFormulaCells`
  passed the file sheet NAME (e.g. 'Sheet1') as `sheetId` to the sidecar,
  but the sidecar expects the stable XLSX sheetId attribute (e.g.
  'sheet-1'). Added `resolveSheetIdFromName` to do the reverse lookup.
- Added `SheetsShellCoordinator.adoptLegacySession(wcId, session)` — registers
  a pre-constructed `ShellWorkbookSession` under (wcId, sessionId) and
  initializes commit state to IDLE. Lazily registers the renderer if this
  is the first contact.
- Added `adoptLegacySessionIntoCoordinator(bundle, wcId, adoption)` helper
  in `sheets-runtime.ts` — orchestrates engine wrap + WorkbookSession
  construction + coordinator registration.
- Added `adoptLegacySessionFromWorkbookFile(bundle, wcId, file, legacy,
  restoreTarget, locale)` helper in `sheets-main.ts` — translates the
  legacy `WorkbookFile` + `SessionInfo` into `LegacySessionAdoption`.
- Wired adoption into the `workbook:select` handler: after successful
  `openWorkbookSession()`, calls `adoptLegacySessionFromWorkbookFile()`.
  Marks `legacy.adopted = true` so `closeAllSessions` (legacy teardown)
  does NOT double-close the sidecar session or double-delete the snapshot.
- Updated `registerSheetsSession` to call `coordinator.registerRenderer`
  so the coordinator's `webContents.once('destroyed', ...)` hook is wired
  for the legacy path.
- Added 30 deterministic integration tests (Tests A-G + architecture guards
  + single-owner invariant + locale/state preservation + engine direct
  adoption) in `tests/sheets-legacy-adoption.test.ts`. All 30 pass.
- Added 4 real-sidecar integration tests in
  `tests/sheets-real-sidecar-adoption.test.ts` — uses the ACTUAL Rust
  xlsx-sidecar binary (built via cargo). All 4 pass.
- Added 6 new architecture guards in `tests/architecture.test.ts`:
  coordinator + sheets-runtime must not import the legacy sidecar client;
  only `xlsx-sidecar-client.ts` may import `child_process` in `src/main/`;
  no `getFocusedWindow` calls; no `createHandle` references in apps/sheets;
  no global session state.
- Built the Rust sidecar binary (`cargo build --release`) — it spawns,
  opens XLSX fixtures, responds to read_range/read_formula_cells/recalc/
  read_media/close commands.
- Generated XLSX fixtures via `tsx scripts/generate-fixtures.ts`.
- Verified the full adoption path end-to-end with the REAL sidecar:
  legacy `client.open()` → `adoptLegacySessionIntoCoordinator()` →
  `coordinator.readRange()` → returns cell data from the real sidecar.
- Attempted the full Electron CDP smoke test (spec section 9). Built the
  sheets app via `electron-vite build`. Launched under Xvfb. BLOCKED by
  a pre-existing build defect: the bundled main process dynamically
  imports `@genoffice/xlsx-gateway/src/gateway/csv-import.js`, which
  Node cannot resolve because workspace packages ship TS source without
  a compile step. Verified the SAME failure occurs at HEAD baseline
  (96f297c) — NOT introduced by Increment 5A.
- Documented the CDP blocker in `tests/sheets-cdp-smoke.test.ts` with the
  exact error, reproduction steps, and the intended CDP flow for the next
  increment to wire up once the build issue is resolved.
- Verified ALL existing tests still pass:
  * packages/platform-electron: 96/96 ✓
  * packages/services-sheets: 60/60 ✓
  * apps/sheets coordinator + architecture + adoption tests: 68/68 ✓
  * apps/sheets real-sidecar tests: 21/21 ✓
  * apps/sheets broader suite: 786/794 ✓ (8 failures pre-existing at HEAD,
    in `tests/workbook-skill-tools.test.ts` — unrelated to Increment 5A)
- Did NOT touch renderer/shared/preload (verified via `git status`).

Stage Summary:
- LEGACY SESSION ADOPTION: PASS — `adoptLegacySession` API on coordinator;
  adoption helper in `sheets-runtime.ts`; wired into `workbook:select`.
- SINGLE RESOURCE OWNER: PASS — `legacy.adopted = true` flag prevents
  double-close; coordinator's `teardown(wcId)` is the single owner of the
  engine handle + snapshot.
- MULTI-SESSION ISOLATION: PASS — `wcId → Map<sessionId, ShellWorkbookSession>`
  preserved; cross-renderer access throws `InvalidSessionError` (Test E).
- MIGRATED READ-RANGE / FORMULAS / RECALC / MEDIA: PASS (with real sidecar).
- CROSS-RENDERER DENIAL: PASS (Test E).
- TEARDOWN CLEANUP: PASS (Test G — exactly-once close, idempotent teardown).
- REAL SHEETS E2E IPC: BLOCKED — pre-existing build defect
  (`@genoffice/xlsx-gateway/src/gateway/csv-import.js` unresolvable at
  runtime). Present at HEAD baseline 96f297c — NOT introduced by 5A.
- REAL SIDECAR INTEGRATION: PASS — Rust sidecar binary built; full adoption
  path tested end-to-end in `sheets-real-sidecar-adoption.test.ts`.
- OPEN/SAVE LEGACY PATHS: UNCHANGED — only `workbook:select` modified to
  ADD adoption (existing open logic preserved; `workbook:save` /
  `workbook:write-recovery` untouched).
- SHEETS RENDERER CHANGED: NO.
- SHEETS SHARED CHANGED: NO.
- SHEETS PRELOAD CHANGED: NO.

Produced artifacts:
- `apps/sheets/src/main/sheets-shell-coordinator.ts` (adoptLegacySession)
- `apps/sheets/src/main/sheets-runtime.ts` (adoptLegacySessionIntoCoordinator)
- `apps/sheets/src/main/sheets-main.ts` (workbook:select adoption wiring)
- `apps/sheets/src/main/xlsx-sidecar-client.ts` (SidecarProtocolLike compat)
- `packages/platform-electron/src/capabilities/electron-xlsx-sidecar-engine.ts`
  (adoptExternalSession, injectable sidecarClient, sheetName→sheetId fix)
- `packages/platform-electron/src/capabilities/sidecar-protocol-client.ts`
  (SidecarProtocolLike interface)
- `packages/platform-electron/src/index.ts` (export new types)
- `apps/sheets/tests/architecture.test.ts` (6 new guards)
- `apps/sheets/tests/sheets-legacy-adoption.test.ts` (30 tests, new)
- `apps/sheets/tests/sheets-real-sidecar-adoption.test.ts` (4 tests, new)
- `apps/sheets/tests/sheets-cdp-smoke.test.ts` (CDP blocker report, new)
- `.gitignore` (excluded local stub packages, tool-results, skills)
