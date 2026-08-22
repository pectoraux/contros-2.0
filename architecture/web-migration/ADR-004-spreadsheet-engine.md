# ADR-004: Spreadsheet Engine Port

## Status

PROPOSED (revised 2 — pending Principal Architect approval)

## Context

The GenOffice Sheets application depends on a Rust binary (`xlsx-sidecar`)
for all workbook operations: open, read range, read formulas, recalculate,
read media, save (archive reassembly), convert legacy formats.

The current `XlsxSidecarClient` (apps/sheets/src/main/xlsx-sidecar-client.ts)
spawns the binary via `node:child_process` and communicates via JSON-over-stdio.
It is tightly coupled to the Electron main process — it cannot run in a
browser, a Web Worker, or a WASM runtime.

This coupling means the workbook I/O and computation model is not
runtime-independent. If Sheets is ever to run on Web/WASM/Cloud, the
engine interface must be abstracted.

## Decision

`XlsxSidecarClient` is NOT a shell responsibility and is NOT a generic
platform capability. It is the current implementation of a **Sheets-specific
execution-engine port**.

### Architecture

```text
runtime-contracts
    SpreadsheetEngine (interface)
    EngineSessionHandle (opaque token type)
          ↓
services-sheets
    SpreadsheetService (uses SpreadsheetEngine + EngineSessionHandle)
          ↓
platform-electron
    ElectronXlsxSidecarEngine (implements SpreadsheetEngine)
          ↓
Rust xlsx-sidecar binary
```

### Engine session handle — genuinely opaque

The engine returns an **opaque token** — `EngineSessionHandle` — from
`open()`. The domain service passes this token to subsequent engine
operations. The domain service and runtime contracts do NOT know what
is inside the token, and MUST NOT inspect it.

```text
EngineSessionHandle = opaque token
```

The type is defined in `runtime-contracts` as an opaque branded type.
Its internal representation is NOT part of the runtime-independent
contract. The type exposes NO fields — it is a bare token that can only
be passed back to the engine that created it.

The Electron adapter owns the internal mapping:

```text
EngineSessionHandle (opaque token)
    ↔
Rust sidecar UUID (internal to ElectronXlsxSidecarEngine)
```

A future WASM adapter maps the same opaque token to an in-memory session
table key. A Cloud adapter maps it to a server session token. The domain
service never inspects `engineSessionId`, `sidecar UUID`, or any other
engine-specific identifier.

### Interface ownership

The `SpreadsheetEngine` interface lives in `runtime-contracts` (Layer 1).
It defines domain-level operations using `EngineSessionHandle`:

```text
SpreadsheetEngine {
    // Opens a workbook file. Returns an opaque handle + workbook metadata.
    // The handle is created by the engine — it does not exist before this call.
    open(path: string, locale: string): Promise<{ handle: EngineSessionHandle; metadata: WorkbookMetadata }>

    // All subsequent operations receive the opaque handle from open().
    readRange(handle: EngineSessionHandle, sheetName: string, range: string): Promise<RangeResult>
    readFormulaCells(handle: EngineSessionHandle, sheetName: string): Promise<FormulaCellsResult>
    recalculate(handle: EngineSessionHandle, edits: RecalcEdit[], reads: RecalcRead[]): Promise<RecalcResult>
    readMedia(handle: EngineSessionHandle, visualId: string): Promise<MediaResult>
    saveArchive(handle: EngineSessionHandle, patches: ArchivePatch[]): Promise<Uint8Array>
    convertWorkbook(path: string): Promise<{ path: string }>
    close(handle: EngineSessionHandle): Promise<void>
    stop(): Promise<void>
}
```

Note: `open()` does NOT receive a handle — it CREATES one. All other
methods receive the handle returned by `open()`.

### FORBIDDEN in runtime-independent contracts

The following terms/concepts MUST NOT appear in `runtime-contracts`,
`services-sheets`, or `platform`:

```text
sidecarSessionId
sidecar
Rust
stdio
child_process
snapshotPath
BrowserWindow
WebContents
wcId
Electron
node:fs
node:path
node:child_process
engineSessionId
```

The Electron adapter may translate the opaque `EngineSessionHandle`
token to its internal Rust sidecar UUID. This translation is private
to the adapter.

### Engine independence

The `SpreadsheetEngine` interface MUST NOT define sidecar-specific
concepts. The interface operates on:

- `EngineSessionHandle` (opaque token — no inspectable fields)
- Domain-level workbook metadata (sheets, styles, defined names)
- Domain-level edit/recalc/read operations
- Domain-level archive patch operations

Allowed:
```text
EngineSessionHandle (opaque token)
engine workbook metadata
engine calculation results
```

Forbidden:
```text
sidecarSessionId
engineSessionId
Rust
stdio
child_process
snapshotPath
BrowserWindow
WebContents
wcId
Electron
```

### Lifecycle ownership

- **Spawn/stop**: owned by the Electron adapter (`ElectronXlsxSidecarEngine`).
  The domain service calls `engine.open(path)` — it does not know how the
  engine parses the file internally.
- **Engine session handle**: created by `engine.open()`, owned by the shell
  coordinator (stored in `ShellWorkbookSession.engineHandle`). The domain
  service receives the handle as a method parameter — it does not store it.
  `SpreadsheetService.open()` calls `engine.open()` internally and receives
  the handle; it does NOT receive a pre-existing handle.
- **Snapshot management**: owned by the shell coordinator. The engine
  receives a path (which may be a snapshot); it does not create or manage
  snapshots itself. The `snapshotPath` field lives in `ShellWorkbookSession`,
  NOT in `WorkbookSession` (domain) or `EngineSessionHandle`.

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
    ↓
SpreadsheetEngine.open(snapshotPath)
    ↓
{ opaque EngineSessionHandle, WorkbookMetadata }
    ↓
SHELL creates ShellWorkbookSession (includes engineHandle + snapshotPath)
SHELL creates WorkbookSession (domain — path, hash, sheetNames)
    ↓
renderer receives WorkbookOpenResult
```

Key: `SpreadsheetService.open()` does NOT receive an `EngineSessionHandle`.
The handle is created BY `engine.open()` inside the service. The service
returns the handle to the shell coordinator, which stores it.

Subsequent operations (readRange, recalc, save, etc.) receive both
`WorkbookSession` (domain) and `EngineSessionHandle` (opaque token) as
parameters.

### Error model

The engine interface uses typed errors:
- `EngineError` — the engine crashed, timed out, or returned an invalid
  response. The domain service propagates this as a domain-level failure.
- `InvalidSessionError` — the handle is unknown to the engine (closed,
  expired, or never opened). The coordinator should clean up the session.
- `InvalidInputError` — the request payload failed validation. The
  domain service should reject the caller.

### Future implementations

The interface is designed to allow:
- `ElectronXlsxSidecarEngine` — current Rust sidecar via `child_process`
  (the opaque token maps to a sidecar UUID internally)
- `WasmSpreadsheetEngine` — IronCalc compiled to WASM, running in-process
  (the opaque token maps to an in-memory table key)
- `CloudSpreadsheetEngine` — server-side workbook computation
  (the opaque token maps to a server session token)

The interface must not assume a process boundary. A WASM engine would
return results synchronously (or via async in-process calls); the
interface uses `Promise<T>` for all operations.

### Dependency direction

```text
runtime-contracts (SpreadsheetEngine + EngineSessionHandle)
    ↑ imported by
services-sheets (SpreadsheetService)
    ↑ imported by
platform-electron (ElectronXlsxSidecarEngine)
```

The `runtime-contracts` package does NOT import from `platform-electron`
or `services-sheets`. The interface is defined at Layer 1; the
implementation is at Layer 4a.

## Consequences

- `services-sheets` depends on `SpreadsheetEngine` + `EngineSessionHandle`
  (interfaces), not on `XlsxSidecarClient` (implementation).
- `platform-electron` gains a new adapter: `ElectronXlsxSidecarEngine`.
- The Rust sidecar binary and its JSON-over-stdio protocol remain
  unchanged — only the TS wrapper moves.
- The engine handle is genuinely opaque: switching from sidecar to WASM
  to Cloud does not change `SpreadsheetService` or `WorkbookSession`.
- `SpreadsheetService.open()` creates the handle via `engine.open()`;
  it does not receive a pre-existing handle.
- Future Web/WASM runtimes can implement `SpreadsheetEngine` without
  spawning a child process.
