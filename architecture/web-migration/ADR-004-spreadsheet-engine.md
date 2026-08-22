# ADR-004: Spreadsheet Engine Port

## Status

PROPOSED (revised — pending Principal Architect approval)

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
    EngineSessionHandle (opaque type)
          ↓
services-sheets
    SpreadsheetService (uses SpreadsheetEngine + EngineSessionHandle)
          ↓
platform-electron
    ElectronXlsxSidecarEngine (implements SpreadsheetEngine)
          ↓
Rust xlsx-sidecar binary
```

### Engine session handle

The engine returns an **opaque handle** — `EngineSessionHandle` — from
`open()`. The domain service passes this handle to subsequent engine
operations. The domain service and runtime contracts do NOT know what
is inside the handle.

```text
EngineSessionHandle = { readonly engineSessionId: string }
```

The handle is a branded type: the `engineSessionId` field is an opaque
string whose meaning is known only to the engine implementation. The
Electron adapter translates `EngineSessionHandle ↔ Rust sidecar UUID`
internally. A WASM adapter would translate it to an in-memory table
key. A Cloud adapter would translate it to a server session token.

### Interface ownership

The `SpreadsheetEngine` interface lives in `runtime-contracts` (Layer 1).
It defines domain-level operations using `EngineSessionHandle`:

```text
SpreadsheetEngine {
    open(path: string, locale: string): Promise<{ handle: EngineSessionHandle; metadata: WorkbookMetadata }>
    readRange(handle: EngineSessionHandle, sheetId: string, range: string): Promise<RangeResult>
    readFormulaCells(handle: EngineSessionHandle, sheetId: string): Promise<FormulaCellsResult>
    recalculate(handle: EngineSessionHandle, edits: RecalcEdit[], reads: RecalcRead[]): Promise<RecalcResult>
    readMedia(handle: EngineSessionHandle, visualId: string): Promise<MediaResult>
    saveArchive(handle: EngineSessionHandle, patches: ArchivePatch[]): Promise<Uint8Array>
    convertWorkbook(path: string): Promise<{ path: string }>
    close(handle: EngineSessionHandle): Promise<void>
    stop(): Promise<void>
}
```

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
```

The Electron adapter may translate:

```text
EngineSessionHandle.engineSessionId
    ↔
Rust sidecar UUID (internal to ElectronXlsxSidecarEngine)
```

### Engine independence

The `SpreadsheetEngine` interface MUST NOT define sidecar-specific
concepts. The interface operates on:

- `EngineSessionHandle` (opaque engine-owned identity)
- Domain-level workbook metadata (sheets, styles, defined names)
- Domain-level edit/recalc/read operations
- Domain-level archive patch operations

Allowed:
```text
EngineSessionHandle
engine session identity
engine workbook metadata
engine calculation results
```

Forbidden:
```text
sidecarSessionId
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
- **Engine session handle**: returned by `engine.open()`, owned by the shell
  coordinator (stored in `ShellWorkbookSession.engineHandle`). The domain
  service receives the handle as a method parameter — it does not store it.
- **Snapshot management**: owned by the shell coordinator. The engine
  receives a path (which may be a snapshot); it does not create or manage
  snapshots itself. The `snapshotPath` field lives in `ShellWorkbookSession`,
  NOT in `WorkbookSession` (domain) or `EngineSessionHandle`.

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
- `WasmSpreadsheetEngine` — IronCalc compiled to WASM, running in-process
  (the handle would be an in-memory table key, not a sidecar UUID)
- `CloudSpreadsheetEngine` — server-side workbook computation
  (the handle would be a server session token)

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
- The engine handle is opaque: switching from sidecar to WASM to Cloud
  does not change `SpreadsheetService` or `WorkbookSession`.
- Future Web/WASM runtimes can implement `SpreadsheetEngine` without
  spawning a child process.
