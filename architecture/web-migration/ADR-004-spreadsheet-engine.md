# ADR-004: Spreadsheet Engine Port

## Status

PROPOSED (architecture amendment, pending Principal Architect approval)

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
          ↓
services-sheets
    SpreadsheetService (uses SpreadsheetEngine)
          ↓
platform-electron
    ElectronXlsxSidecarEngine (implements SpreadsheetEngine)
          ↓
Rust xlsx-sidecar binary
```

### Interface ownership

The `SpreadsheetEngine` interface lives in `runtime-contracts` (Layer 1).
It defines domain-level operations:

```text
open(path) → sessionId + workbook metadata
readRange(sessionId, sheetId, range) → cells/merges/styles
readFormulaCells(sessionId, sheetId) → formula cells
recalculate(sessionId, edits, reads) → computed values
readMedia(sessionId, visualId) → image bytes
saveArchive(sessionId, patches) → bytes
convertWorkbook(path) → xlsx path
close(sessionId) → void
```

The interface must NOT expose:
- `BrowserWindow`, `WebContents`, `ipcMain`, `ipcRenderer`
- `node:child_process`, `node:fs`, `node:path`
- File dialogs, `wcId`, renderer identity

### Lifecycle ownership

- **Spawn/stop**: owned by the Electron adapter (`ElectronXlsxSidecarEngine`).
  The domain service calls `engine.open(path)` — it does not know how the
  engine parses the file internally.
- **Session registry**: owned by the shell coordinator (per-wcId +
  per-sessionId). The engine returns a sessionId; the coordinator maps
  (wcId, sessionId) → `WorkbookSession`.
- **Snapshot management**: owned by the shell coordinator. The engine
  receives a path (which may be a snapshot); it does not create or manage
  snapshots itself.

### Error model

The engine interface uses typed errors:
- `EngineError` — the sidecar crashed, timed out, or returned an invalid
  response. The domain service propagates this as a domain-level failure.
- `InvalidSessionError` — the sessionId is unknown to the engine (closed,
  expired, or never opened). The coordinator should clean up the session.
- `InvalidInputError` — the request payload failed validation. The
  domain service should reject the caller.

### Future implementations

The interface is designed to allow:
- `ElectronXlsxSidecarEngine` — current Rust sidecar via child_process
- `WasmSpreadsheetEngine` — IronCalc compiled to WASM, running in-process
- `CloudSpreadsheetEngine` — server-side workbook computation

The interface must not assume a process boundary. A WASM engine would
return results synchronously (or via async in-process calls); the
interface uses `Promise<T>` for all operations.

### Dependency direction

```text
runtime-contracts (SpreadsheetEngine interface)
    ↑ imported by
services-sheets (SpreadsheetService)
    ↑ imported by
platform-electron (ElectronXlsxSidecarEngine)
```

The `runtime-contracts` package does NOT import from `platform-electron`
or `services-sheets`. The interface is defined at Layer 1; the
implementation is at Layer 4a.

## Consequences

- `services-sheets` depends on `SpreadsheetEngine` (interface), not on
  `XlsxSidecarClient` (implementation).
- `platform-electron` gains a new adapter: `ElectronXlsxSidecarEngine`.
- The Rust sidecar binary and its JSON-over-stdio protocol remain
  unchanged — only the TS wrapper moves.
- Future Web/WASM runtimes can implement `SpreadsheetEngine` without
  spawning a child process.
