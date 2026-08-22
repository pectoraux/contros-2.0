# PHASE 2 — SHEETS ARCHITECTURE AMENDMENTS

## Status

PROPOSED (revised 2 — pending Principal Architect approval)

## Baseline

`b5bfa96bf80b9cc9c30b1c2c823aa40ef9fcf794`

## Related ADRs

- ADR-004: Spreadsheet Engine Port (revised 2 — genuinely opaque handle, corrected open lifecycle)
- ADR-005: Screen Capture Capability (revised 2 — deterministic browser semantics)
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
    engineHandle: EngineSessionHandle  // opaque engine token
    suggestSaveAs?: string          // converted import: suggested save path
    restoreTarget?: string          // recovery restore: original file path
    restoreTargetSha?: string       // recovery restore: original file sha256

EngineSessionHandle (engine — genuinely opaque)
    // NO inspectable fields. The type is an opaque token.
    // The Electron adapter maps it to a sidecar UUID internally.
    // A WASM adapter maps it to an in-memory table key.
    // A Cloud adapter maps it to a server session token.
    // The domain service and runtime contracts NEVER inspect it.
```

### Why three layers?

The previous proposal put `snapshotPath`, `diskFingerprint`, and
`sidecarSessionId` into `WorkbookSession` — leaking filesystem and engine
infrastructure into the domain contract. This made it impossible to swap
the engine implementation (WASM/Cloud) without changing the domain service.

The revised model:
- `WorkbookSession` is what the domain service needs to perform domain
  operations (read, recalc, save). It contains the file path, content hash,
  and sheet-name mapping. No filesystem paths, no engine tokens.
- `ShellWorkbookSession` is what the shell coordinator owns. It contains
  the snapshot path, disk fingerprint, engine handle, and recovery metadata.
- `EngineSessionHandle` is genuinely opaque — no inspectable fields. The
  domain service passes it to the engine without knowing what's inside.

### Workbook-open lifecycle

```text
IPC workbook:select
    ↓
SHELL
    resolve caller (wcId, callerWindow)
    resolve original path (dialog or queued)
    create snapshot (Files.copy(originalPath, snapshotPath))
    ↓
SpreadsheetService.open(snapshotPath)
    ↓ (internally calls)
SpreadsheetEngine.open(snapshotPath)
    ↓
{ opaque EngineSessionHandle, WorkbookMetadata }
    ↓
SHELL creates ShellWorkbookSession (includes engineHandle + snapshotPath + diskFingerprint)
SHELL creates WorkbookSession (domain — path, hash, sheetNames)
    ↓
renderer receives WorkbookOpenResult
```

Key: `SpreadsheetService.open()` does NOT receive a pre-existing
`EngineSessionHandle`. The handle is created BY `engine.open()` inside
the service. The service returns the handle to the shell coordinator.

Subsequent operations (readRange, recalc, save, etc.) receive both
`WorkbookSession` (domain) and `EngineSessionHandle` (opaque token).

### Session creation

1. Shell coordinator resolves caller context (wcId, callerWindow).
2. Shell coordinator calls `Files.pickOpen` (or consumes a queued path).
3. Shell coordinator creates a snapshot: `Files.copy(originalPath, snapshotPath)`.
4. Shell coordinator calls `SpreadsheetService.open(snapshotPath)`.
5. Service internally calls `SpreadsheetEngine.open(snapshotPath)`.
6. Engine returns opaque `EngineSessionHandle` + workbook metadata.
7. Service returns `{ handle, metadata }` to the shell coordinator.
8. Shell coordinator creates `ShellWorkbookSession` (includes the handle).
9. Shell coordinator creates `WorkbookSession` (domain — path, hash,
   sheetNames) from the metadata.
10. Shell coordinator stores both in the session registry.

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
`ShellWorkbookSession.engineHandle` (opaque token) to `SpreadsheetEngine` methods.

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
A disk-change guard prevents silent overwrites.

### Engine lifecycle

- The engine is spawned/managed by the Electron adapter
  (`ElectronXlsxSidecarEngine`), NOT by the shell coordinator or domain service.
- Multiple renderers share the same engine process.
- The shell coordinator calls `SpreadsheetEngine.stop()` on
  `app.on('before-quit')`.
- The engine maintains its own session registry (keyed by the opaque
  token's internal value — private to the adapter).

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
    // Opens a workbook file. Internally calls engine.open() which creates
    // the opaque EngineSessionHandle. Returns the handle + metadata.
    // Does NOT receive a pre-existing handle.
    open(path: string): Promise<{ handle: EngineSessionHandle; session: WorkbookSession; result: WorkbookOpenResult } | null>
    close(handle: EngineSessionHandle): Promise<{ ok: boolean }>
    recentFiles(): Promise<string[]>

    // ── Workbook operations ──
    // Receive domain session + opaque engine handle.
    // Service resolves domain sheet ids → engine sheet names internally.
    readRange(session: WorkbookSession, handle: EngineSessionHandle, sheetId: string, range: string): Promise<RangeResult>
    readFormulaCells(session: WorkbookSession, handle: EngineSessionHandle, sheetId: string): Promise<FormulaCellsResult>
    recalculate(session: WorkbookSession, handle: EngineSessionHandle, edits: RecalcEdit[], reads: RecalcRead[]): Promise<RecalcResult>
    readMedia(handle: EngineSessionHandle, visualId: string): Promise<MediaResult>
    readPivotDefinition(path: string, cachePath: string): Promise<PivotDefinition>

    // ── Save ──
    // Service receives domain session + handle + already-resolved save path
    // + external change status (supplied by shell).
    // Service performs save-plan semantics, engine saveArchive.
    // Service does NOT resolve the save path or compute the disk fingerprint.
    save(session: WorkbookSession, handle: EngineSessionHandle, request: SaveRequest, targetPath: string, externalChange: ExternalChangeStatus): Promise<SaveResult>
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

### ExternalChangeStatus

A runtime-neutral fact supplied by the shell:

```text
ExternalChangeStatus = 'unchanged' | 'changed' | 'unknown'
```

- `'unchanged'` — the shell verified the file on disk matches the
  stored fingerprint (sha256). In-place save is safe.
- `'changed'` — the file on disk differs from the stored fingerprint.
  The domain service must refuse an in-place save (return `reason: 'external-modified'`).
- `'unknown'` — the shell could not determine the status (stat failed,
  permission denied, etc.). The domain service MUST refuse an in-place
  save. An office application must not silently overwrite a file when
  it cannot establish its current disk state. Save-As remains available
  because it targets a user-selected path.

### What the domain service MUST NOT do

- File dialogs (shell owns `Files.pickOpen` / `Files.pickSave`)
- `BrowserWindow` creation (shell/coordinator owns window management)
- `WebContents` calls (shell/coordinator owns renderer communication)
- `wcId` lookup (shell coordinator owns the session registry)
- Renderer event routing (shell coordinator owns `wc.send`)
- `child_process` spawning (engine adapter owns engine lifecycle)
- Recovery UI dialogs (shell coordinator owns Restore/Discard prompts)
- `node:fs` direct writes (uses `Storage` or `Files` capability)
- Snapshot management (shell owns snapshot paths)
- Disk fingerprint management (shell owns the fingerprint; supplies
  `ExternalChangeStatus` to the domain service)
- Engine handle inspection (the handle is opaque; the domain service
  passes it through to the engine)

### What the domain service receives

- `WorkbookSession` — domain-level session identity (path, hash, sheetNames)
- `EngineSessionHandle` — opaque engine token (passed through to engine)
- Already-resolved paths (save target, recovery path — resolved by shell)
- `ExternalChangeStatus` — runtime-neutral fact about disk state
  (supplied by shell, computed via `Files.stat` + hash comparison)
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
- External-modification POLICY (deterministic):
  - `'unchanged'` → save permitted
  - `'changed'` → in-place save refused
  - `'unknown'` → in-place save refused (safe default: an office
    application must not silently overwrite a file when it cannot
    establish its current disk state)
  - Save-As is always available (targets a user-selected path, not
    the original file — no disk-change check needed)
- Recovery path derivation (sha1 of original path → recovery file name —
  this is a pure computation, no filesystem access)

### SHELL

- Caller/session ownership (which renderer, which session)
- File dialog for Save As (resolve target path via `Files.pickSave`)
- Recovery Restore/Discard UI (dialog prompt on open when recovery exists)
- Session lifecycle (close old session, open new session over saved file)
- Snapshot management (copy original → snapshot before engine open;
  remove snapshot on close/save/teardown)
- Disk fingerprint OBSERVATION (compute sha256 of file at open time,
  recompute on save, compare — supply the fact as `ExternalChangeStatus`)
- Recovery filesystem state (write/delete recovery copies via `Files.write`/`Files.unlink`)

### CAPABILITY

- Provides file/hash observation (`Files.stat` returns mtime/size;
  `Files.read` returns bytes for hashing)
- Provides raw bytes persistence (`Storage.writeBlob` / `Storage.readBlob`)
- Provides file I/O (`Files.read` / `Files.write` / `Files.stat` / `Files.copy`)
- Provides recovery persistence (recovery files stored via `Files.write`)

### Disk-change check — resolved ownership

The shell OWNS the filesystem state and OBSERVES it. The domain OWNS
the POLICY (what the observation means for save permissibility).

```text
SHELL: recompute sha256 of file at session.originalPath (via Files.read)
SHELL: compare with session.diskFingerprint (stored in ShellWorkbookSession)
SHELL: supply ExternalChangeStatus fact to domain service
    ↓
DOMAIN: SpreadsheetService.save(session, handle, request, targetPath, externalChange)
DOMAIN: if externalChange === 'changed' → return { ok: false, reason: 'external-modified' }
DOMAIN: if externalChange === 'unknown' → return { ok: false, reason: 'external-modified' }
DOMAIN: if externalChange === 'unchanged' → proceed with save
DOMAIN: resolve sheet ids → engine sheet names
DOMAIN: engine.saveArchive(handle, patches) → bytes
DOMAIN: Files.write(targetPath, bytes)
DOMAIN: clear recovery (Files.unlink recoveryPath)
```

The domain service does NOT directly manipulate filesystem state to
perform the disk-change check. It receives the fact from the shell and
applies the policy.

### Flow

```text
IPC: workbook:save
    ↓
SHELL: resolve caller (wcId, callerWindow)
SHELL: look up session (wcId → sessionId → { domain, shell })
SHELL: if Save As → Files.pickSave(callerWindow) → selectedPath
SHELL: observe disk state: recompute sha256(originalPath) vs shell.diskFingerprint
SHELL: supply ExternalChangeStatus to domain service
    ↓
DOMAIN: SpreadsheetService.save(domain.session, shell.engineHandle, request, targetPath, externalChange)
DOMAIN: if 'changed' → return { ok: false, reason: 'external-modified' }
DOMAIN: resolve sheet ids → file names (domain.session.sheetNames)
DOMAIN: engine.saveArchive(shell.engineHandle, patches) → bytes
DOMAIN: Files.write(targetPath, bytes)
DOMAIN: clear recovery (Files.unlink recoveryPath)
    ↓
SHELL: close old engine session
SHELL: create new snapshot over saved file
SHELL: open new engine session (via SpreadsheetService.open)
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

The engine receives the opaque `EngineSessionHandle` token — it does NOT
receive `snapshotPath` or `wcId`.

---

## 5. Reclassified IPC Inventory

### workbook:select

| Layer | Responsibility |
|---|---|
| SHELL | File dialog, caller context, recovery policy, session creation, snapshot creation |
| DOMAIN | Workbook preparation (convert .xls/.csv → .xlsx), workbook semantics, engine.open() |
| ENGINE | Sidecar `open` command (via `SpreadsheetEngine.open`) |
| STORAGE | Snapshot copy (`Files.copy`), recovery check (`Files.stat`) |

### workbook:save

| Layer | Responsibility |
|---|---|
| SHELL | Caller/session lookup, Save As dialog, disk-state observation (sha256 → ExternalChangeStatus), session lifecycle (close+reopen), snapshot management |
| DOMAIN | External-modification policy (given ExternalChangeStatus), save plan validation, sheet-id resolution, engine saveArchive |
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
 1. runtime-contracts: SpreadsheetEngine + EngineSessionHandle (opaque) interfaces
    + ExternalChangeStatus type
    + architecture test (zero Electron/node/sidecar imports, zero inspectable handle fields)
    + committed

 2. platform-electron: ElectronXlsxSidecarEngine
    (wraps existing XlsxSidecarClient, implements SpreadsheetEngine,
     translates opaque EngineSessionHandle ↔ sidecar UUID internally)
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
      zero snapshotPath/sidecarSessionId/engineSessionId references)
    + committed

 7. SheetsShellCoordinator
    + apps/sheets/src/main/sheets-coordinator-impl.ts
    + per-wcId + per-sessionId registry
    + ShellWorkbookSession (includes snapshotPath, diskFingerprint, engineHandle)
    + caller-specific dialog parent
    + close-guard flow
    + disk-state observation (sha256 via Files.read → ExternalChangeStatus)
    + recovery path management (via Files capability, not node:fs)
    + snapshot management (via Files.copy, not node:fs)
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
ADR-004 SPREADSHEET ENGINE PORT: COMPLETE (revised 2 — genuinely opaque handle, corrected open lifecycle)
ADR-005 SCREEN CAPTURE: COMPLETE (revised 2 — deterministic browser semantics)
ADR-006 SHEETS PDF RENDERING: COMPLETE (approved, unchanged)

SHEETS SESSION MODEL: FROZEN (three-layer: WorkbookSession / ShellWorkbookSession / opaque EngineSessionHandle)
DOMAIN BOUNDARY: FROZEN (domain receives WorkbookSession + opaque handle + ExternalChangeStatus)
SAVE/RECOVERY BOUNDARY: FROZEN (shell observes disk state → ExternalChangeStatus; domain owns policy)
RECALCULATION BOUNDARY: FROZEN (domain owns sheet-id translation; engine receives opaque handle)

CODE CHANGES: NONE
IMPLEMENTATION AUTHORIZATION: BLOCKED
```
