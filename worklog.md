# GenOffice Phase 2 — Increment 6A Worklog

Multi-agent shared work log. Append-only. Each section starts with `---`.

Baseline: `6d063ae`

---

Task ID: 1
Agent: main (Principal Architect + implementer)
Task: Phase 2 — Increment 6A: Harden the Sheets Save Boundary

Work Log:
- Reviewed the full git diff from 49623bb → 6d063ae before editing.
- Identified the type-safety violations in the save path:
  * `as unknown as SavePlan` in translateSaveRequest (23-field bulk cast)
  * `Record<string, unknown>` construction in buildWorkbookFile
  * Return type `unknown` for buildWorkbookFile (no schema validation)
- Created `apps/sheets/src/main/sheets-save-adapter.ts` — the shell-owned
  conversion boundary:
  * `translateSaveRequest(request: WorkbookSaveRequest): SaveRequest` —
    uses explicit per-family typed mappers (24 mappers, one per mutation
    family). Each mapper constructs fresh object literals (assignable to
    readonly interfaces under `exactOptionalPropertyTypes: true`).
    Conditional spreads preserve optionality without `undefined`.
  * `buildWorkbookFile(session: ShellWorkbookSession): WorkbookFile` —
    maps the coordinator's session metadata to the renderer's WorkbookFile
    shape, then validates via `workbookFileSchema.parse()`. Returns the
    frozen `WorkbookFile` type (NOT `unknown`).
- Removed all type assertions from the save path:
  * `as unknown as SavePlan` → replaced with per-family mappers
  * `Record<string, unknown>` construction → replaced with typed WorkbookFile
  * `as WorkbookChartEdit` / `as WorkbookVisualEdit` → removed by fixing
    the domain types
- Fixed the domain types in `packages/runtime-contracts/src/services/save-plan.ts`:
  * `WorkbookChartEdit`: removed `readonly drawingPath: string` (the renderer
    sends `chartPath`, not `drawingPath`; the gateway reads `chartPath` at
    xlsx-gateway.ts:928). The type is now `{ readonly [key: string]: unknown }`
    only — the index signature carries `chartPath` without a named-field
    mismatch that forced type assertions.
  * `WorkbookVisualEdit`: same fix — removed `readonly drawingPath: string`.
    The renderer sends `drawingPath` (correct), but the named field + index
    signature still forced a cast. Now it's index-signature-only.
- Moved translation logic OUT of the IPC handler:
  * `sheets-migrated-handlers.ts` now imports `translateSaveRequest` and
    `buildWorkbookFile` from `sheets-save-adapter.ts`.
  * The handler is genuinely thin: IPC validation → typed conversion →
    coordinator call → response mapping.
  * ZERO type assertions in the handler (verified by architecture test).
- Added 8 new architecture tests in `tests/architecture.test.ts`:
  * `sheets-migrated-handlers.ts` has ZERO type assertions
  * `sheets-save-adapter.ts` has ZERO type assertions
  * `sheets-save-adapter.ts` does NOT import XlsxSidecarClient or child_process
  * `sheets-save-adapter.ts` does NOT import xlsx-gateway
  * `sheets-save-adapter.ts` does NOT call filesystem APIs
  * `sheets-save-adapter.ts` uses workbookFileSchema.parse() for validation
  * `sheets-save-adapter.ts` buildWorkbookFile returns WorkbookFile (not unknown)
  * `sheets-migrated-handlers.ts` imports translateSaveRequest + buildWorkbookFile
- Extended `scripts/sheets-cdp-smoke.mjs` with save response fidelity and
  save content fidelity checks:
  * SAVE-RESPONSE-FIDELITY: validates all frozen WorkbookFile fields
    (sessionId, name, path, sha256, entryCount, sheets, styles, dxfStyles,
    visuals, definedNames, readOnly, needsSaveAs, restoredFromRecovery)
  * SAVE-CONTENT-FIDELITY: closes the session, re-opens the saved file
    via the sidecar, reads cells — verifies the save wrote valid content
- Updated `tests/sheets-cdp-real.test.ts` to assert the new markers.
- Audited the metadata expansion from Increment 6:
  * styles, dxfStyles, visuals (as `unknown[]`) on WorkbookMetadata —
    genuine workbook/domain metadata returned by engine.open(). KEEP.
  * columnWidths, tables, comments, pivotRanges (as `unknown[]`) on
    WorksheetMetadata — genuine per-sheet metadata. KEEP.
  * definedNames with `{name, formula, sheetIndex?}` — matches the sidecar's
    native shape. KEEP.
  * None of these fields are renderer-IPC-specific — they're workbook
    metadata that the engine contract carries. The adapter (shell-owned)
    maps them to the renderer's WorkbookFile shape.
- Verified runtime-contracts remains runtime-independent:
  ZERO Electron/Node/WebContents/BrowserWindow/apps.sheets/preload/renderer
  imports in runtime-contracts.
- Ran the full test suite:
  * runtime-contracts: 61/61 ✓
  * services-sheets: 60/60 ✓
  * platform-electron: 96/96 ✓
  * xlsx-gateway: 484/484 ✓
  * renderer-bridge: 151/151 ✓
  * services-docs: 30/30 ✓
  * apps/sheets: 122/122 ✓ (including 18 architecture tests + 20 save
    migration tests + real sidecar + CDP smoke)
  * Real Electron CDP smoke: 2/2 ✓ (with save response + content fidelity)
- Did NOT touch renderer/shared/preload (verified via git diff — empty).
- Verified the built main bundle has ZERO `@genoffice/*` runtime imports.

Stage Summary:
- SAVE TYPE SAFETY: PASS — zero type assertions in the save path
  (handler + adapter)
- SAVE ADAPTER THINNESS: PASS — handler imports from sheets-save-adapter.ts;
  the 23-field SavePlan construction is no longer inline
- WORKBOOKFILE VALIDATION: PASS — buildWorkbookFile returns `WorkbookFile`
  (not `unknown`), validated via `workbookFileSchema.parse()`
- METADATA BOUNDARY: PASS — runtime-contracts carries genuine workbook
  metadata; the adapter (shell-owned) maps to the renderer's IPC shape
- ERROR FIDELITY: PASS — external-change refusal still throws
  `new Error('errDiskChanged')` (matching the legacy `tm('errDiskChanged')`)
- SAVE-AS: PASS (deterministic test with real sidecar, from Increment 6)
- CONTENT FIDELITY: PASS — CDP test re-opens the saved file and reads cells
- RESPONSE FIDELITY: PASS — CDP test validates all frozen WorkbookFile fields
- REAL SAVE E2E: PASS — full CDP-driven flow with save + session continuity
- REAL SIDECAR: PASS
- ZERO TYPE ASSERTIONS IN SAVE PATH: PASS (verified by architecture test)
- RENDERER CHANGED: NO
- SHARED CHANGED: NO
- PRELOAD CHANGED: NO

Produced artifacts:
- `apps/sheets/src/main/sheets-save-adapter.ts` (new — typed conversion module)
- `apps/sheets/src/main/sheets-migrated-handlers.ts` (removed inline translation,
  imports from adapter)
- `packages/runtime-contracts/src/services/save-plan.ts` (fixed WorkbookChartEdit
  + WorkbookVisualEdit to remove named-field mismatch)
- `apps/sheets/tests/architecture.test.ts` (8 new save adapter guards)
- `apps/sheets/tests/sheets-cdp-real.test.ts` (added save-fidelity assertions)
- `scripts/sheets-cdp-smoke.mjs` (save response + content fidelity checks)
