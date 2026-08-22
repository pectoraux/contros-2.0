# PHASE 2 — SHEETS ARCHITECTURE AMENDMENTS

## Status

PROPOSED (pending Principal Architect approval)

## Baseline

`a7dfc30ba0c4202d86d13302b75faf70ad4e08e9`

## Related ADRs

- ADR-004: Spreadsheet Engine Port
- ADR-005: Screen Capture Capability
- ADR-006: Sheets PDF Rendering Port

---

## 1. Sheets Session Model (FROZEN)

### Model

```text
wcId (renderer identity)
    ↓
Map<sessionId, WorkbookSession>
```

A `WorkbookSession` owns:

```text
WorkbookSession {
    sessionId: string           // UUID from the engine
    originalPath: string         // the user's file path
    snapshotPath: string         // temp copy the engine reads/writes
    sheetNames: ReadonlyMap<string, string>  // Univer sheetId → file sheet name
    diskFingerprint: string      // sha256 of the snapshot at open time
    sidecarSessionId: string     // engine-side session identifier
    suggestSaveAs?: string       // converted import: suggested save path
    restoreTarget?: string       // recovery restore: original file path
    restoreTargetSha?: string    // recovery restore: original file sha256
}
```

### Session creation

1. Shell coordinator resolves caller context (wcId, callerWindow).
2. Shell coordinator calls `Files.pickOpen` (or consumes a queued path).
3. Shell coordinator creates a snapshot via `Files.copy(originalPath, snapshotPath)`.
4. Shell coordinator calls `SpreadsheetEngine.open(snapshotPath)`.
5. Engine returns `sessionId` + workbook metadata.
6. Shell coordinator creates `WorkbookSession` and stores it in
   `sheetsTabs.get(wcId).sessions.set(sessionId, session)`.
7. Shell coordinator sends push events to the renderer.

### Session lookup

```text
sheetsTabs: Map<wcId, SheetsTabSession>
SheetsTabSession {
    webContents: WebContents
    sessions: Map<sessionId, WorkbookSession>
    aiStreams: Map<requestId, AbortController>
}
```

### Session teardown

1. `webContents.once('destroyed')` → close all sessions for that wcId.
2. For each session: `SpreadsheetEngine.close(sessionId)` +
   `Files.unlink(snapshotPath)`.
3. Clear recovery copies for all session paths.

### Duplicate workbook opens

A single renderer can open the same file multiple times — each open
creates a new snapshot and a new engine session. The sessions are
independent: a save in one does not affect the other (each has its own
snapshot and disk fingerprint).

### Same workbook in multiple renderers

Multiple renderers CAN open the same file — each gets its own snapshot
and engine session. They are fully independent. A disk-change guard
(sha256 comparison) prevents one renderer's save from silently
overwriting the other's changes: the second save will detect the
fingerprint mismatch and require the user to confirm overwrite.

### Sidecar lifecycle

- The sidecar is spawned once per shell process (not per renderer).
- Multiple renderers share the same sidecar process.
- The sidecar maintains its own session registry (UUID-keyed).
- The shell coordinator calls `SpreadsheetEngine.stop()` on
  `app.on('before-quit')`.

### Renderer teardown

When a renderer's `webContents` is destroyed:
1. Close all engine sessions for that wcId.
2. Remove all snapshots for that wcId.
3. Clear all recovery copies for those sessions.
4. Remove the wcId from `sheetsTabs`.

### Snapshot cleanup

Snapshots live at `temp/genoffice-sheets-sessions/{uuid}.xlsx`.
They are removed on:
- Session close (explicit `closeWorkbook`)
- Renderer destruction (teardown)
- Successful save (old snapshot replaced by new session over saved file)

---

## 2. SpreadsheetService Domain Boundary (FROZEN)

### Interface (proposed, not yet implemented)

```text
SpreadsheetService {
    // ── Workbook lifecycle ──
    open(path: string): Promise<{ session: WorkbookSession; result: WorkbookOpenResult } | null>
    close(session: WorkbookSession): Promise<{ ok: boolean }>
    recentFiles(): Promise<string[]>

    // ── Workbook operations ──
    readRange(session: WorkbookSession, sheetId: string, range: string): Promise<RangeResult>
    readFormulaCells(session: WorkbookSession, sheetId: string): Promise<FormulaCellsResult>
    recalculate(session: WorkbookSession, edits: RecalcEdit[], reads: RecalcRead[]): Promise<RecalcResult>
    readMedia(session: WorkbookSession, visualId: string): Promise<MediaResult>
    readPivotDefinition(session: WorkbookSession, pivotPath: string): Promise<PivotDefinition>

    // ── Save ──
    save(session: WorkbookSession, request: SaveRequest): Promise<SaveResult>
    saveAs(session: WorkbookSession, request: SaveRequest, selectedPath: string): Promise<SaveResult>
    writeRecovery(session: WorkbookSession, request: SaveRequest): Promise<{ ok: boolean }>
    autoRename(session: WorkbookSession, name: string): Promise<{ ok: boolean }>

    // ── PDF export ──
    exportPdf(html: string, options: PdfOptions): Promise<{ base64?: string; error?: string }>

    // ── Domain events ──
    onOpened(handler: (result: WorkbookOpenResult) => void): () => void
    onRenamed(handler: (paths: { oldPath: string; newPath: string }) => void): () => void
    onTeardown(handler: () => void): () => void
}
```

### What the domain service MUST NOT do

- File dialogs (shell owns `Files.pickOpen` / `Files.pickSave`)
- `BrowserWindow` creation (shell/coordinator owns window management)
- `WebContents` calls (shell/coordinator owns renderer communication)
- `wcId` lookup (shell coordinator owns the session registry)
- Renderer event routing (shell coordinator owns `wc.send`)
- `child_process` spawning (engine adapter owns sidecar lifecycle)
- Recovery UI dialogs (shell coordinator owns Restore/Discard prompts)
- `node:fs` direct writes (uses `Storage` or `Files` capability)

### Dependencies (constructor-injected)

```text
SpreadsheetServiceDeps {
    engine: SpreadsheetEngine         // ADR-004
    pdfRenderer: SpreadsheetPdfRenderer  // ADR-006
    storage: Storage                   // frozen capability
    files: Files                       // frozen capability
    ai: AI                             // frozen capability
    settings: Settings                 // frozen capability
}
```

---

## 3. Save/Recovery Boundary (FROZEN)

### DOMAIN

- Workbook save semantics (what constitutes a valid save plan)
- Save plan application (resolve sheet ids → file names, delegate to engine)
- Disk-change policy (compare fingerprint; refuse if mismatch for in-place save)
- Recovery path derivation (sha1 of original path → recovery file name)

### SHELL

- Caller/session ownership (which renderer, which session)
- File dialog for Save As (resolve target path)
- Recovery Restore/Discard UI (dialog prompt on open when recovery exists)
- Session lifecycle (close old session, open new session over saved file)
- Snapshot management (copy original → snapshot before engine open)

### STORAGE CAPABILITY

- Raw bytes persistence (`Storage.writeBlob` / `Storage.readBlob`)
- File I/O (`Files.read` / `Files.write` / `Files.stat` / `Files.copy`)
- Recovery persistence (recovery files stored via `Files.write` to
  `userData/sheets-autosave/`, NOT direct `writeFileSync`)

### Flow

```text
IPC: workbook:save
    ↓
SHELL: resolve caller (wcId, callerWindow)
SHELL: look up session (wcId → sessionId → WorkbookSession)
SHELL: if Save As → Files.pickSave(callerWindow) → selectedPath
    ↓
DOMAIN: SpreadsheetService.save(session, request)
DOMAIN:   verify disk fingerprint (session.diskFingerprint vs Files.stat)
DOMAIN:   resolve sheet ids → file names (session.sheetNames)
DOMAIN:   engine.saveArchive(sessionId, patches) → bytes
DOMAIN:   Files.write(selectedPath ?? session.originalPath, bytes)
DOMAIN:   clear recovery (Storage.deleteBlob or Files.unlink)
    ↓
SHELL: close old session, open new session over saved file
SHELL: send workbook:renamed if path changed
SHELL: send push events to renderer
```

---

## 4. Recalculation Boundary (FROZEN)

### Current flow

```text
IPC: workbook:recalc
    ↓
MAIN: validate request (zod schema)
MAIN: resolve Univer sheet ids → file sheet names (session.sheetNames)
MAIN: call sidecar.recalcCells({ path: snapshotPath, edits, reads })
MAIN: validate sidecar response
MAIN: resolve file sheet names → Univer sheet ids (reverse mapping)
    ↓
RENDERER: overlay computed values
```

### Future architecture

```text
IPC: workbook:recalc
    ↓
SHELL: resolve caller (wcId, sessionId)
SHELL: look up session (wcId → sessionId → WorkbookSession)
    ↓
DOMAIN: SpreadsheetService.recalculate(session, edits, reads)
DOMAIN:   resolve domain sheet ids → engine sheet names
DOMAIN:   engine.recalculate(session.sidecarSessionId, edits, reads)
DOMAIN:   validate engine response
DOMAIN:   resolve engine sheet names → domain sheet ids
    ↓
SHELL: return result to renderer
```

The **sheet-id translation** (domain ↔ engine) is owned by the domain
service, NOT the shell coordinator. The engine adapter must not expose
its internal naming model to the renderer or the shell.

---

## 5. Reclassified IPC Inventory

### workbook:select

| Layer | Responsibility |
|---|---|
| SHELL | File dialog, caller context, recovery policy, session creation |
| DOMAIN | Workbook preparation (convert .xls/.csv → .xlsx), workbook semantics |
| ENGINE | Sidecar `open` command |
| STORAGE | Snapshot copy (`Files.copy`), recovery check (`Files.stat`) |

### workbook:save

| Layer | Responsibility |
|---|---|
| SHELL | Caller/session lookup, Save As dialog, session lifecycle (close+reopen) |
| DOMAIN | Save plan validation, sheet-id resolution, disk-change policy, engine saveArchive |
| ENGINE | Sidecar `save_archive` command |
| STORAGE | `Files.write` (target path), recovery cleanup (`Files.unlink`) |

### workbook:write-recovery

| Layer | Responsibility |
|---|---|
| SHELL | Caller/session lookup, suggestSaveAs/restoreTarget guard |
| DOMAIN | Save plan validation, sheet-id resolution, engine saveArchive |
| ENGINE | Sidecar `save_archive` command |
| STORAGE | `Files.write` (recovery path) |

### workbook:recalc

| Layer | Responsibility |
|---|---|
| SHELL | Caller/session lookup |
| DOMAIN | Sheet-id resolution (domain ↔ engine), engine recalc, result validation |
| ENGINE | Sidecar `recalc_cells` command |
| STORAGE | None (reads from snapshot path) |

### workbook:close

| Layer | Responsibility |
|---|---|
| SHELL | Caller/session lookup, session removal, snapshot cleanup |
| DOMAIN | None (the engine close is a lifecycle op) |
| ENGINE | Sidecar `close` command |
| STORAGE | `Files.unlink` (snapshot path) |

### workbook:export-pdf

| Layer | Responsibility |
|---|---|
| SHELL | Caller context, save dialog |
| DOMAIN | PDF rendering (delegates to `SpreadsheetPdfRenderer`) |
| ENGINE | None (PDF renderer is a separate port — ADR-006) |
| STORAGE | `Files.write` (target path) |

---

## 6. Implementation Plan

Each step is independently testable and committed.

```text
 1. runtime-contracts: SpreadsheetEngine interface
    + architecture test (zero Electron/node imports)
    + committed

 2. platform-electron: ElectronXlsxSidecarEngine
    (wraps existing XlsxSidecarClient, implements SpreadsheetEngine)
    + test (delegates to sidecar, returns typed results)
    + committed

 3. runtime-contracts: SpreadsheetPdfRenderer interface
    + architecture test
    + committed

 4. platform-electron: ElectronSpreadsheetPdfRenderer
    (wraps existing hidden-BrowserWindow PDF export)
    + test
    + committed

 5. platform: ScreenCapture capability (ADR-005 amendment)
    + interface in platform/src/capabilities/
    + ScreenCapture added to RuntimeContext (optional slot)
    + ElectronScreenCapture in platform-electron
    + architecture tests updated
    + committed

 6. services-sheets: skeleton
    + SpreadsheetService interface (domain, no Electron)
    + SpreadsheetServiceImpl (delegates to engine + capabilities)
    + architecture tests (zero Electron/node imports, zero dialog/window refs)
    + committed

 7. SheetsShellCoordinator
    + apps/sheets/src/main/sheets-coordinator-impl.ts
    + per-wcId + per-sessionId registry
    + caller-specific dialog parent
    + close-guard flow
    + recovery path management
    + sidecar lifecycle
    + committed

 8. typed Sheets IPC contract
    + packages/renderer-bridge/src/sheets-ipc-contract.ts
    (types derived from Sheets DesktopApi via Parameters<>/ReturnType<>)
    + committed

 9. Sheets IPC bridge
    + packages/renderer-bridge/src/bridges/sheets-bridge.ts
    + createSheetsDesktopBridge (maps DesktopApi → IPC channels)
    + sheets-entry.ts (sheets-specific entry point)
    + committed

10. main-process handler migration
    + apps/sheets/src/main/sheets-migrated-handlers.ts
    + override legacy handlers with coordinator-backed implementations
    + register in shell (initSheetsRuntime + registerMigratedSheetsIpc)
    + committed

11. preload migration
    + apps/sheets/src/preload/index.ts
    + replace handwritten desktopApi with createSheetsDesktopBridge
    + install typed ElectronIpcTransport
    + projectApi unchanged
    + committed

12. CDP real-Electron smoke test
    + apps/sheets/tests/real-sheets-smoke.test.ts
    + launch shell, create sheets tab, execute window.desktopApi.selectWorkbook()
    + verify IPC round trip + push events
    + committed

13. behavior/regression verification
    + full test suite (5 migration packages, sheets tests, pagination-equivalent)
    + real CDP smoke test passes
    + renderer/shared/preload byte-identical check
    + final report
    + committed
```

---

## Final Status

```text
ADR-004 SPREADSHEET ENGINE PORT: COMPLETE
ADR-005 SCREEN CAPTURE: COMPLETE
ADR-006 SHEETS PDF RENDERING: COMPLETE

SHEETS SESSION MODEL: FROZEN
DOMAIN BOUNDARY: FROZEN
SAVE/RECOVERY BOUNDARY: FROZEN
RECALCULATION BOUNDARY: FROZEN

CODE CHANGES: NONE
IMPLEMENTATION AUTHORIZATION: BLOCKED
```
