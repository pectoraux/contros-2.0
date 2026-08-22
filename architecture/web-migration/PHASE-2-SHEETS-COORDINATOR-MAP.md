# PHASE 2 — SHEETS COORDINATOR MAP

## Status

PROPOSED (Increment 4)

## Baseline

`ad13214ac67b9e51ed8c6c697a521211a6230b18`

## Purpose

Maps the 8 priority Sheets IPC handlers to their coordinator-backed
replacements. Each row documents: the current handler, its responsibility,
the coordinator method that will own it, the SpreadsheetService method it
delegates to, the capability it uses, the shell-owned state, the migration
risk, and the behavior-preservation test.

The coordinator REPLACES the legacy `sheetsTabs`/`sessionFor`/`XlsxSidecarClient`
ownership model. Legacy handlers remain as fallback until the coordinator
is verified.

---

## Handler Map

### 1. workbook:select (selectWorkbook)

| Field | Value |
|-------|-------|
| **Current handler** | `ipcMain.handle(IPC_CHANNELS.selectWorkbook, ...)` at sheets-main.ts:1717 |
| **Responsibility** | Resolve caller, select/prepare file (.xls/.csv conversion, recovery check), snapshot, open workbook session, return WorkbookFile |
| **Coordinator method** | `SheetsShellCoordinator.openWorkbook(wcId, callerWindow, queuedPath?)` |
| **Service method** | `SpreadsheetService.open(bytes, locale, fileName)` |
| **Capability** | Files.pickOpen, Storage (snapshot copy), dialog (recovery prompt) |
| **Shell-owned state** | `ShellWorkbookSession { sessionId, originalPath, snapshotPath, workbookName, diskFingerprint, suggestSaveAs, csvImport, restoreTarget, restoreTargetSha, engineHandle }` |
| **Risk** | HIGH — the open flow has 4 branches (normal, .xls/.csv conversion, recovery restore, shell-queued). Must preserve suggestSaveAs, csvImport, restoreTarget, restoreTargetSha, stable sheet-id mapping, snapshot semantics. |
| **Behavior test** | Open a .xlsx → verify WorkbookFile with correct path, sha256, sheets[].id. Open a .csv → verify suggestSaveAs set, csvImport=true. Open with pending recovery → verify restoreTarget set, restoredFromRecovery=true. |

### 2. workbook:read-range (readWorkbookRange)

| Field | Value |
|-------|-------|
| **Current handler** | `ipcMain.handle(IPC_CHANNELS.readWorkbookRange, ...)` at sheets-main.ts:1744 |
| **Responsibility** | Look up session by sessionId, read cell range via sidecar, validate response |
| **Coordinator method** | `SheetsShellCoordinator.readRange(wcId, sessionId, sheetId, range)` |
| **Service method** | `SpreadsheetService.readRange(session, engineHandle, sheetId, range)` |
| **Capability** | None (delegates to service) |
| **Shell-owned state** | `ShellWorkbookSession.engineHandle`, `WorkbookSession.sheetNames` (for sheetId resolution) |
| **Risk** | LOW — pure delegation. The service resolves sheetId → sheetName. The coordinator passes the opaque handle. |
| **Behavior test** | Read a range after open → verify cells match. Read with unknown sheetId → InvalidInputError. Read with stale handle → InvalidSessionError. |

### 3. workbook:read-formulas (readWorkbookFormulas)

| Field | Value |
|-------|-------|
| **Current handler** | `ipcMain.handle(IPC_CHANNELS.readWorkbookFormulas, ...)` at sheets-main.ts:1752 |
| **Responsibility** | Look up session, read formula cells via sidecar, validate response |
| **Coordinator method** | `SheetsShellCoordinator.readFormulaCells(wcId, sessionId, sheetId)` |
| **Service method** | `SpreadsheetService.readFormulaCells(session, engineHandle, sheetId)` |
| **Capability** | None (delegates to service) |
| **Shell-owned state** | `ShellWorkbookSession.engineHandle`, `WorkbookSession.sheetNames` |
| **Risk** | LOW — pure delegation. |
| **Behavior test** | Read formulas after open → verify formula cells match. Unknown sheetId → InvalidInputError. |

### 4. workbook:recalc (recalcWorkbook)

| Field | Value |
|-------|-------|
| **Current handler** | `ipcMain.handle(IPC_CHANNELS.recalcWorkbook, ...)` at sheets-main.ts:1780 |
| **Responsibility** | Look up session, resolve sheetIds → sheetNames, call sidecar recalcCells, map results back to sheetIds |
| **Coordinator method** | `SheetsShellCoordinator.recalculate(wcId, sessionId, edits, reads)` |
| **Service method** | `SpreadsheetService.recalculate(session, engineHandle, edits, reads)` |
| **Capability** | None (delegates to service) |
| **Shell-owned state** | `ShellWorkbookSession.engineHandle`, `WorkbookSession.sheetNames` |
| **Risk** | MEDIUM — the legacy handler does sheetId resolution + result mapping. The service now owns this. Must verify the service's sheetId resolution matches (fail-closed). |
| **Behavior test** | Recalc with known sheetId → verify computed values. Recalc with unknown sheetId → InvalidInputError. Recalc on stale handle → InvalidSessionError. |

### 5. workbook:read-media (readWorkbookMedia)

| Field | Value |
|-------|-------|
| **Current handler** | `ipcMain.handle(IPC_CHANNELS.readWorkbookMedia, ...)` at sheets-main.ts:1827 |
| **Responsibility** | Look up session, read media (image bytes) via sidecar, validate response |
| **Coordinator method** | `SheetsShellCoordinator.readMedia(wcId, sessionId, visualId)` |
| **Service method** | `SpreadsheetService.readMedia(session, engineHandle, visualId)` |
| **Capability** | None (delegates to service) |
| **Shell-owned state** | `ShellWorkbookSession.engineHandle` |
| **Risk** | LOW — pure delegation. The visualId is engine-scoped (the sidecar maps handle → sessionId). |
| **Behavior test** | Read media after open → verify base64 bytes. Cross-session misuse → engine fails (visualId not found). |

### 6. workbook:save (saveWorkbook)

| Field | Value |
|-------|-------|
| **Current handler** | `ipcMain.handle(IPC_CHANNELS.saveWorkbook, ...)` at sheets-main.ts:1965 |
| **Responsibility** | Resolve save target (in-place vs save-as), check disk fingerprint, call writeWorkbookTo, swap session, clear recovery |
| **Coordinator method** | `SheetsShellCoordinator.saveWorkbook(wcId, sessionId, request, mode)` |
| **Service method** | `SpreadsheetService.save(session, engineHandle, SaveRequest, externalChange)` |
| **Capability** | Files.pickSave (save-as dialog), Storage (persist bytes), dialog (disk-change error) |
| **Shell-owned state** | `ShellWorkbookSession { originalPath, snapshotPath, diskFingerprint, suggestSaveAs, restoreTarget, restoreTargetSha, engineHandle }` |
| **Risk** | HIGH — the save flow has 3 branches (in-place, save-as, restore-writeback) + disk-change guard + session swap + recovery cleanup. Must preserve: in-place refusal when disk changed, save-as always allowed, restore silent writeback (with sha guard), session swap after save (old snapshot removed, new session opened), recovery copy cleared. |
| **Behavior test** | Save in-place unchanged → verify bytes persisted, session swapped. Save in-place changed → verify refusal. Save-as → verify dialog, new path, session swap. Restore save → verify silent writeback to restoreTarget, sha guard. |

### 7. workbook:write-recovery (writeWorkbookRecovery)

| Field | Value |
|-------|-------|
| **Current handler** | `ipcMain.handle(IPC_CHANNELS.writeWorkbookRecovery, ...)` at sheets-main.ts:2033 |
| **Responsibility** | Check session is eligible (not suggestSaveAs, not restoreTarget), call writeWorkbookTo to recovery path |
| **Coordinator method** | `SheetsShellCoordinator.writeRecovery(wcId, sessionId, request)` |
| **Service method** | `SpreadsheetService.writeRecovery(session, engineHandle, SaveRequest)` |
| **Capability** | Storage (persist bytes to recovery path) |
| **Shell-owned state** | `ShellWorkbookSession { suggestSaveAs, restoreTarget, snapshotPath }` |
| **Risk** | MEDIUM — recovery eligibility check (skip if suggestSaveAs or restoreTarget), recovery path derivation, best-effort failure. Must preserve: skip for converted imports, skip for restored sessions, silent failure (best-effort). |
| **Behavior test** | Write recovery on normal session → verify bytes at recovery path. Write recovery on suggestSaveAs session → verify skipped. Write recovery on restoreTarget session → verify skipped. |

### 8. workbook:close (closeWorkbook)

| Field | Value |
|-------|-------|
| **Current handler** | `ipcMain.handle(IPC_CHANNELS.closeWorkbook, ...)` at sheets-main.ts:2052 |
| **Responsibility** | Delete session, close sidecar session, remove snapshot |
| **Coordinator method** | `SheetsShellCoordinator.closeWorkbook(wcId, sessionId)` |
| **Service method** | `SpreadsheetService.close(engineHandle)` |
| **Capability** | Storage (remove snapshot) |
| **Shell-owned state** | `ShellWorkbookSession { snapshotPath, engineHandle }` |
| **Risk** | MEDIUM — must preserve: snapshot removal, sidecar session close (best-effort), session registry cleanup. Must handle teardown races (close during open, close during save). |
| **Behavior test** | Close after open → verify snapshot removed, session gone. Close during open → verify no stale session. Close during save → verify save completes or aborts cleanly. |

---

## Coordinator Architecture

```text
IPC handler (event.sender.id → wcId)
    ↓
SheetsShellCoordinator
    ├── Map<wcId, Map<sessionId, ShellWorkbookSession>>
    ├── openWorkbook()  → SpreadsheetService.open() + snapshot + recovery
    ├── readRange()     → SpreadsheetService.readRange()
    ├── readFormulaCells() → SpreadsheetService.readFormulaCells()
    ├── recalculate()   → SpreadsheetService.recalculate()
    ├── readMedia()     → SpreadsheetService.readMedia()
    ├── saveWorkbook()  → SpreadsheetService.save() + disk check + persist + session swap
    ├── writeRecovery() → SpreadsheetService.writeRecovery() + persist to recovery path
    ├── closeWorkbook() → SpreadsheetService.close() + snapshot cleanup
    └── teardown(wcId)  → close all sessions for wcId
```

## Migration Strategy

1. **Implement coordinator** as a standalone module in `apps/sheets/src/main/`.
2. **Wire to service + engine** — the coordinator constructs `SpreadsheetServiceImpl` with `ElectronXlsxSidecarEngine` and calls it.
3. **Override handlers** — replace the 8 legacy `ipcMain.handle` registrations with coordinator-backed versions. Keep untouched handlers (AI, PDF, screen capture, files) on the old path.
4. **Legacy fallback** — the old `sheetsTabs`/`sessionFor`/`XlsxSidecarClient` code remains for handlers not yet migrated. The coordinator and legacy code coexist.
5. **No renderer changes** — the IPC channel names and payload shapes are unchanged. The renderer cannot tell whether a handler is coordinator-backed or legacy.
