# PHASE 2 — SHEETS ARCHITECTURE AMENDMENTS

## Status

PROPOSED (revised — pending Principal Architect approval)

## Baseline

`9c733fe14e0d2be044f91d2356541f0f414d8efb`

## Related ADRs

- ADR-004: Spreadsheet Engine Port (revised — opaque `EngineSessionHandle`)
- ADR-005: Screen Capture Capability (revised — `requestCapture()` for browser portability)
- ADR-006: Sheets PDF Rendering Port (approved, unchanged)

---

## 1. Sheets Session Model (FROZEN)

### Three-layer separation

The session model separates domain identity from shell infrastructure
from engine identity:

```text
WorkbookSession (domain — runtime-independent)
    workbookPath: string           // the user's file path
    workbookHash: string            // content hash for identity
    sheetNames: ReadonlyMap<string, string>  // domain sheetId → file sheet name

ShellWorkbookSession (shell — Electron-specific)
    workbookPath: string
    snapshotPath: string            // temp copy the engine reads/writes
    diskFingerprint: string         // sha256 of the snapshot at open time
    engineHandle: EngineSessionHandle  // opaque engine identity
    suggestSaveAs?: string          // converted import: suggested save path
    restoreTarget?: string          // recovery restore: original file path
    restoreTargetSha?: string       // recovery restore: original file sha256

EngineSessionHandle (engine — opaque)
    engineSessionId: string         // opaque string, meaning known only to engine impl
```

### Why three layers?

The previous proposal put `snapshotPath`, `diskFingerprint`, and
`sidecarSessionId` into `WorkbookSession` — leaking filesystem and engine
infrastructure into the domain contract. This made it impossible to swap
the engine implementation (WASM/Cloud) without changing the domain service.

The revised model:
- `WorkbookSession` is what the domain service needs to perform domain
  operations (read, recalc, save). It contains the file path, content hash,
  and sheet-name mapping. No filesystem paths, no engine handles.
- `ShellWorkbookSession` is what the shell coordinator owns. It contains
  the snapshot path, disk fingerprint, engine handle, and recovery metadata.
- `EngineSessionHandle` is opaque — the domain service passes it to the
  engine without knowing what's inside.

### Session creation

1. Shell coordinator resolves caller context (wcId, callerWindow).
2. Shell coordinator calls `Files.pickOpen` (or consumes a queued path).
3. Shell coordinator creates a snapshot: `Files.copy(originalPath, snapshotPath)`.
4. Shell coordinator calls `SpreadsheetEngine.open(snapshotPath)`.
5. Engine returns `EngineSessionHandle` + workbook metadata.
6. Shell coordinator creates `ShellWorkbookSession` (includes the handle).
7. Shell coordinator creates `WorkbookSession` (domain-level — path, hash,
   sheetNames) from the metadata.
8. Shell coordinator stores both in the session registry.

### Session lookup

```text
sheetsTabs: Map<wcId, SheetsTabSession>
SheetsTabSession {
    webContents: WebContents
    sessions: Map<sessionId, {
        domain: WorkbookSession
        shell: ShellWorkbookSession
    }>
    aiStreams: Map<requestId, AbortController>
}
```

The coordinator resolves `wcId → sessionId → { domain, shell }`. It passes
the `WorkbookSession` (domain) to `SpreadsheetService` methods and the
`ShellWorkbookSession.engineHandle` (opaque) to `SpreadsheetEngine` methods.

### Domain method invocation pattern

```text
// Shell coordinator receives an IPC request:
const { domain, shell } = sessionFor(wcId, sessionId)

// Domain service receives domain-level session + engine handle:
await spreadsheetService.readRange(domain, shell.engineHandle, sheetId, range)

// Inside SpreadsheetService:
async readRange(session: WorkbookSession, handle: EngineSessionHandle, sheetId: string, range: string) {
    // Resolve domain sheetId → engine sheet name using session.sheetNames
    const engineSheetName = session.sheetNames.get(sheetId)
    // Delegate to engine with opaque handle
    return this.engine.readRange(handle, engineSheetName, range)
}
```

### Session teardown

1. `webContents.once('destroyed')` → close all sessions for that wcId.
2. For each session:
   - `SpreadsheetEngine.close(shell.engineHandle)` (engine session)
   - `Files.unlink(shell.snapshotPath)` (snapshot)
3. Clear recovery copies for all session paths.

### Duplicate workbook opens

A single renderer can open the same file multiple times — each open
creates a new snapshot, a new engine session, and a new `ShellWorkbookSession`.
The sessions are independent.

### Same workbook in multiple renderers

Multiple renderers CAN open the same file — each gets its own snapshot,
engine session, and `ShellWorkbookSession`. They are fully independent.
A disk-change guard (sha256 comparison) prevents silent overwrites.

### Sidecar lifecycle

- The engine is spawned/managed by the Electron adapter
  (`ElectronXlsxSidecarEngine`), NOT by the shell coordinator or domain service.
- Multiple renderers share the same engine process.
- The shell coordinator calls `SpreadsheetEngine.stop()` on
  `app.on('before-quit')`.
- The engine maintains its own session registry (keyed by the opaque
  handle's internal value).

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
    // Shell passes the file path + engine handle. Service creates a
    // WorkbookSession (domain) from the engine metadata.
    open(path: string, handle: EngineSessionHandle): Promise<{ session: WorkbookSession; result: WorkbookOpenResult } | null>
    close(handle: EngineSessionHandle): Promise<{ ok: boolean }>
    recentFiles(): Promise<string[]>

    // ── Workbook operations ──
    // Service receives the domain session + engine handle.
    // It resolves domain sheet ids → engine sheet names internally.
    readRange(session: WorkbookSession, handle: EngineSessionHandle, sheetId: string, range: string): Promise<RangeResult>
    readFormulaCells(session: WorkbookSession, handle: EngineSessionHandle, sheetId: string): Promise<FormulaCellsResult>
    recalculate(session: WorkbookSession, handle: EngineSessionHandle, edits: RecalcEdit[], reads: RecalcRead[]): Promise<RecalcResult>
    readMedia(handle: EngineSessionHandle, visualId: string): Promise<MediaResult>
    readPivotDefinition(path: string, cachePath: string): Promise<PivotDefinition>

    // ── Save ──
    // Service receives the domain session + engine handle + already-resolved save path.
    // It performs the save-plan semantics, disk-change policy, and engine saveArchive.
    // It does NOT resolve the save path (that's the shell's job).
    save(session: WorkbookSession, handle: EngineSessionHandle, request: SaveRequest, targetPath: string): Promise<SaveResult>
    writeRecovery(session: WorkbookSession, handle: EngineSessionHandle, request: SaveRequest, recoveryPath: string): Promise<{ ok: boolean }>
    autoRename(session: WorkbookSession, name: string): Promise<{ ok: boolean }>

    // ── PDF export ──
    // Delegates to SpreadsheetPdfRenderer (ADR-006).
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
- Snapshot management (shell owns snapshot paths)
- Disk fingerprint management (shell owns the fingerprint)

### What the domain service receives

- `WorkbookSession` — domain-level session identity (path, hash, sheetNames)
- `EngineSessionHandle` — opaque engine identity (passed through to engine)
- Already-resolved paths (save target, recovery path — resolved by shell)
- Save request (computed by renderer, validated by service)

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
- Disk-change policy (compare content hash; refuse if mismatch for in-place save)
- Recovery path derivation (sha1 of original path → recovery file name —
  this is a pure computation, no filesystem access)

### SHELL

- Caller/session ownership (which renderer, which session)
- File dialog for Save As (resolve target path via `Files.pickSave`)
- Recovery Restore/Discard UI (dialog prompt on open when recovery exists)
- Session lifecycle (close old session, open new session over saved file)
- Snapshot management (copy original → snapshot before engine open;
  remove snapshot on close/save/teardown)
- Disk fingerprint management (compute sha256 of snapshot at open time;
  recompute on save to detect external modification)
- Recovery filesystem state (write/delete recovery copies via `Files.write`/`Files.unlink`)

### STORAGE CAPABILITY

- Raw bytes persistence (`Storage.writeBlob` / `Storage.readBlob`)
- File I/O (`Files.read` / `Files.write` / `Files.stat` / `Files.copy`)
- Recovery persistence (recovery files stored via `Files.write` to
  `userData/sheets-autosave/`, NOT direct `writeFileSync`)

### Disk-change check

The domain service needs to verify that the file on disk hasn't changed
since open. But the domain service must NOT receive `snapshotPath` or
`diskFingerprint` directly — those are shell infrastructure.

Instead, the shell coordinator computes the fingerprint check and passes
the result to the domain service:

```text
SHELL: recompute sha256 of the file at session.originalPath
SHELL: compare with session.diskFingerprint (stored in ShellWorkbookSession)
SHELL: if mismatch → return { ok: false, reason: 'external-modified' }
SHELL: if match → call SpreadsheetService.save(session, handle, request, targetPath)
```

The domain service trusts the shell's assertion that the disk is unchanged
and proceeds with the save. The disk-change policy is a shell concern
(it owns the filesystem state); the save-plan semantics are a domain concern.

### Flow

```text
IPC: workbook:save
    ↓
SHELL: resolve caller (wcId, callerWindow)
SHELL: look up session (wcId → sessionId → { domain, shell })
SHELL: if Save As → Files.pickSave(callerWindow) → selectedPath
SHELL: disk-change check: recompute sha256(originalPath) vs shell.diskFingerprint
SHELL: if mismatch → return { ok: false, reason: 'external-modified' }
    ↓
DOMAIN: SpreadsheetService.save(domain.session, shell.engineHandle, request, selectedPath ?? domain.session.workbookPath)
DOMAIN:   resolve sheet ids → file names (domain.session.sheetNames)
DOMAIN:   engine.saveArchive(shell.engineHandle, patches) → bytes
DOMAIN:   Files.write(targetPath, bytes)
DOMAIN:   clear recovery (Files.unlink recoveryPath — path derived from originalPath)
    ↓
SHELL: close old engine session
SHELL: create new snapshot over saved file
SHELL: open new engine session
SHELL: update ShellWorkbookSession (new snapshotPath, diskFingerprint, engineHandle)
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
SHELL: look up session (wcId → sessionId → { domain, shell })
    ↓
DOMAIN: SpreadsheetService.recalculate(domain.session, shell.engineHandle, edits, reads)
DOMAIN:   resolve domain sheet ids → engine sheet names (domain.session.sheetNames)
DOMAIN:   engine.recalculate(shell.engineHandle, edits, reads)
DOMAIN:   validate engine response
DOMAIN:   resolve engine sheet names → domain sheet ids (reverse mapping)
    ↓
SHELL: return result to renderer
```

The **sheet-id translation** (domain ↔ engine) is owned by the domain
service, NOT the shell coordinator. The engine adapter must not expose
its internal naming model to the renderer or the shell.

The engine receives the opaque `EngineSessionHandle` — it does NOT receive
`snapshotPath` or `wcId`.

---

## 5. Reclassified IPC Inventory

### workbook:select

| Layer | Responsibility |
|---|---|
| SHELL | File dialog, caller context, recovery policy, session creation, snapshot creation |
| DOMAIN | Workbook preparation (convert .xls/.csv → .xlsx), workbook semantics |
| ENGINE | Sidecar `open` command (via `SpreadsheetEngine.open`) |
| STORAGE | Snapshot copy (`Files.copy`), recovery check (`Files.stat`) |

### workbook:save

| Layer | Responsibility |
|---|---|
| SHELL | Caller/session lookup, Save As dialog, disk-change check (sha256), session lifecycle (close+reopen), snapshot management |
| DOMAIN | Save plan validation, sheet-id resolution, engine saveArchive |
| ENGINE | Sidecar `save_archive` command |
| STORAGE | `Files.write` (target path), recovery cleanup (`Files.unlink`) |

### workbook:write-recovery

| Layer | Responsibility |
|---|---|
| SHELL | Caller/session lookup, suggestSaveAs/restoreTarget guard, recovery path resolution |
| DOMAIN | Save plan validation, sheet-id resolution, engine saveArchive |
| ENGINE | Sidecar `save_archive` command |
| STORAGE | `Files.write` (recovery path) |

### workbook:recalc

| Layer | Responsibility |
|---|---|
| SHELL | Caller/session lookup |
| DOMAIN | Sheet-id resolution (domain ↔ engine), engine recalc, result validation |
| ENGINE | Sidecar `recalc_cells` command |
| STORAGE | None (engine reads from its own internal state) |

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
| DOMAIN | PDF rendering (delegates to `SpreadsheetPdfRenderer` — ADR-006) |
| ENGINE | None (PDF renderer is a separate port) |
| STORAGE | `Files.write` (target path) |

---

## 6. Implementation Plan

Each step is independently testable and committed.

```text
 1. runtime-contracts: SpreadsheetEngine + EngineSessionHandle interfaces
    + architecture test (zero Electron/node/sidecar imports)
    + committed

 2. platform-electron: ElectronXlsxSidecarEngine
    (wraps existing XlsxSidecarClient, implements SpreadsheetEngine,
     translates EngineSessionHandle ↔ sidecar UUID internally)
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
    + WorkbookSession type (domain — path, hash, sheetNames only)
    + architecture tests (zero Electron/node imports, zero dialog/window refs,
      zero snapshotPath/sidecarSessionId references)
    + committed

 7. SheetsShellCoordinator
    + apps/sheets/src/main/sheets-coordinator-impl.ts
    + per-wcId + per-sessionId registry
    + ShellWorkbookSession (includes snapshotPath, diskFingerprint, engineHandle)
    + caller-specific dialog parent
    + close-guard flow
    + recovery path management (via Files capability, not node:fs)
    + snapshot management (via Files.copy, not node:fs)
    + disk fingerprint management (sha256 via Files.read)
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
ADR-004 SPREADSHEET ENGINE PORT: COMPLETE (revised — opaque EngineSessionHandle)
ADR-005 SCREEN CAPTURE: COMPLETE (revised — requestCapture for browser portability)
ADR-006 SHEETS PDF RENDERING: COMPLETE (approved, unchanged)

SHEETS SESSION MODEL: FROZEN (three-layer: WorkbookSession / ShellWorkbookSession / EngineSessionHandle)
DOMAIN BOUNDARY: FROZEN (domain receives WorkbookSession + EngineSessionHandle, not shell infrastructure)
SAVE/RECOVERY BOUNDARY: FROZEN (shell owns disk fingerprint check; domain owns save-plan semantics)
RECALCULATION BOUNDARY: FROZEN (domain owns sheet-id translation; engine receives opaque handle)

CODE CHANGES: NONE
IMPLEMENTATION AUTHORIZATION: BLOCKED
```
