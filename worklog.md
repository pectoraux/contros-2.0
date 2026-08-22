# GenOffice Phase 2 — Increment 6 Worklog

Multi-agent shared work log. Append-only. Each section starts with `---`.

Baseline: `49623bb`

---

Task ID: 1
Agent: main (Principal Architect + implementer)
Task: Phase 2 — Increment 6: Sheets Save + Recovery Behavioral Cutover

Work Log:
- Reviewed the parent commit (49623bb) diff before editing.
- Traced the legacy workbook:save path completely: handler at line 2077
  (sheets-main.ts), writeWorkbookTo() at line 2623, the 22 mutation families,
  save vs save-as semantics, external change detection, close/reopen/session
  replacement, and the frozen WorkbookSaveResult response shape.
- Traced the legacy workbook:write-recovery path: handler at line 2145,
  recovery path derivation, epoch check, mutation lock.
- Confirmed the coordinator's existing saveWorkbook() and writeRecovery()
  already implement the full commit journal (Phase A/B/C), atomic promotion
  (rename, no copyFile fallback), teardown safety, external-change policy,
  and recovery race semantics — no redesign needed.
- Extended WorkbookMetadata + WorksheetMetadata (runtime-contracts) to carry
  the full sidecar open response: styles, dxfStyles, visuals (as unknown[]),
  per-sheet columnWidths/tables/comments/pivotRanges (as unknown[]), and
  fixed definedNames to use {name, formula, sheetIndex?} (matching the
  sidecar's native shape and the renderer's expectation — eliminating the
  lossy formula→value translation that discarded sheetIndex).
- Updated validateOpenResult + buildWorkbookMetadata (platform-electron) to
  capture the additional fields from the sidecar's open response.
- Fixed the adoption helper in sheets-main.ts to pass through the new fields
  (definedNames, columnWidths, tables, comments, pivotRanges, styles,
  dxfStyles, visuals) without lossy translation.
- Implemented the migrated workbook:save handler in sheets-migrated-handlers.ts:
  - Validates input via workbookSaveRequestSchema (frozen IPC shape)
  - Translates WorkbookSaveRequest → SaveRequest (1:1 field mapping via
    translateSaveRequest — the service resolves sheetIds internally)
  - Calls coordinator.saveWorkbook(wcId, sessionId, request, mode, callerWindow)
  - Maps SaveResult → frozen WorkbookSaveResult:
    { canceled: true } or { canceled: false, file: WorkbookFile, touchedEntries }
  - Uses buildWorkbookFile(session) to construct the renderer's WorkbookFile
    from the replacement session's metadata + diskFingerprint
  - Uses session.diskFingerprint for sha256 (NOT metadata.sha256 which comes
    from the sidecar's open response and is often empty)
- Implemented the migrated workbook:write-recovery handler:
  - Validates input, translates to SaveRequest
  - Calls coordinator.writeRecovery(wcId, sessionId, request)
  - Returns { ok: boolean }
- Both handlers are registered via the same removeHandler + handle pattern
  as the previous 5 migrated handlers — the legacy handlers are replaced.
- Added 20 deterministic tests (sheets-save-migration.test.ts):
  - Session continuity: open → save → read with SAME sessionId
  - Save-As: new path, preserves sessionId, old target untouched
  - External change policy: unchanged → permit, changed → refuse, unknown → refuse
  - Teardown during COMMITTING: commit completes, teardown closes replacement
  - Recovery race: concurrent save + recovery, stale recovery returns ok: false
  - Multi-session isolation: A1 save does not affect A2 or B1
  - Architecture guards: ZERO XlsxSidecarClient/xlsx-package-io/xlsx-gateway/
    node:fs/node:path/child_process/getFocusedWindow/global state
  - Legacy handler replacement verified via source inspection
- Extended scripts/sheets-cdp-smoke.mjs with the save flow:
  - open → read → save (via saveWorkbookEdits) → read again with SAME sessionId
  - Verifies session continuity (same sessionId works after save)
  - All checks pass with the REAL Rust sidecar binary
- Ran the full test suite:
  * runtime-contracts: 61/61 ✓
  * services-sheets: 60/60 ✓
  * platform-electron: 96/96 ✓
  * xlsx-gateway: 484/484 ✓
  * renderer-bridge: 151/151 ✓
  * services-docs: 30/30 ✓
  * apps/sheets coordinator + architecture + adoption + save-migration +
    real-sidecar + CDP-smoke + xlsx-sidecar/recalc/borders/streaming-save: 107/107 ✓
  * apps/sheets CDP real test: 2/2 ✓ (includes save + session-continuity)
- Did NOT touch renderer/shared/preload (verified via git diff — empty).
- No generated binaries committed.
- Build artifact verified: no @genoffice/* runtime imports in out/main/index.js.

Stage Summary:
- SAVE HANDLER MIGRATION: PASS
- RECOVERY HANDLER MIGRATION: PASS
- SAVEPLAN PATH: PASS (WorkbookSaveRequest → SavePlan → service.save()
  → engine.applySavePlan() → sidecar save_archive)
- SESSION CONTINUITY: PASS (same sessionId after save, verified by real CDP test)
- SAVE-AS: PASS (deterministic test with real sidecar)
- EXTERNAL CHANGE POLICY: PASS (all three: unchanged/changed/unknown)
- COMMIT JOURNAL: PASS (Phase A/B/C unchanged from 4F/4G)
- ATOMIC PROMOTION: PASS (rename, no copyFile fallback)
- TEARDOWN SAFETY: PASS (teardown during COMMITTING: commit completes)
- RECOVERY RACE SAFETY: PASS (concurrent save + recovery: stale recovery → ok: false)
- MULTI-SESSION ISOLATION: PASS (A1 save does not affect A2 or B1)
- REAL SAVE E2E: PASS (CDP-driven: open → read → save → read-same-sessionId)
- REAL RECOVERY E2E: PASS (deterministic test with real sidecar)
- REAL SIDECAR: PASS
- LEGACY SAVE HANDLER ACTIVE: NO (replaced by registerMigratedSheetsIpc)
- LEGACY RECOVERY HANDLER ACTIVE: NO
- RENDERER CHANGED: NO
- SHARED CHANGED: NO
- PRELOAD CHANGED: NO

Produced artifacts:
- packages/runtime-contracts/src/services/spreadsheet-engine.ts
  (extended WorkbookMetadata + WorksheetMetadata)
- packages/platform-electron/src/capabilities/sidecar-validators.ts
  (capture full sidecar open response)
- apps/sheets/src/main/sheets-migrated-handlers.ts
  (save + write-recovery handlers, translateSaveRequest, buildWorkbookFile)
- apps/sheets/src/main/sheets-main.ts (fixed adoption helper)
- apps/sheets/tests/sheets-save-migration.test.ts (20 tests, new)
- apps/sheets/tests/sheets-cdp-real.test.ts (added save/continuity assertions)
- scripts/sheets-cdp-smoke.mjs (added save + session-continuity flow)
