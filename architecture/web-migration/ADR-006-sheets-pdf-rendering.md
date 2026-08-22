# ADR-006: Sheets PDF Rendering Port

## Status

PROPOSED (architecture amendment, pending Principal Architect approval)

## Context

The GenOffice Sheets application exports PDFs by:
1. Receiving an HTML string from the renderer (the rendered spreadsheet view)
2. Creating a hidden `BrowserWindow` in the main process
3. Loading the HTML into the hidden window
4. Calling `webContents.printToPDF()` on the hidden window
5. Writing the resulting PDF bytes to the user-chosen save path

This is architecturally different from the Docs PDF export, which calls
`webContents.printToPDF()` on the **renderer's own** `WebContents` (the
document is already displayed). Sheets needs a **separate rendering context**
because the spreadsheet view is an interactive canvas (Univer), not a
printable DOM.

The existing `Printing` platform capability (`Printing.exportPdf`) takes
a `webContents` and calls `printToPDF` — it does not create a hidden
window or load arbitrary HTML. Extending `Printing` with hidden-window
behavior would pollute the generic capability with Sheets-specific
rendering concerns.

## Decision

Sheets PDF rendering becomes a **Sheets-specific runtime port**:
`SpreadsheetPdfRenderer`.

### Architecture

```text
runtime-contracts
    SpreadsheetPdfRenderer (interface)
          ↓
services-sheets
    SpreadsheetService (uses SpreadsheetPdfRenderer)
          ↓
platform-electron
    ElectronSpreadsheetPdfRenderer (implements SpreadsheetPdfRenderer)
          ↓
hidden BrowserWindow + printToPDF
```

### Interface (proposed)

```text
SpreadsheetPdfRenderer {
    renderToPdf(
        html: string,
        options: SpreadsheetPdfOptions
    ): Promise<{ base64: string } | { error: string }>
}

SpreadsheetPdfOptions {
    landscape: boolean
    pageSize: { width: number; height: number }  // twips
    margins: { top: number; bottom: number; left: number; right: number }
    scale: number
}
```

### Why not `Printing.exportPdf`?

`Printing.exportPdf` is designed for "render the current view to PDF" —
it takes the renderer's own `webContents` and calls `printToPDF`. This
works for Docs (the document IS the renderer's DOM). It does NOT work
for Sheets because:

1. The spreadsheet canvas (Univer) is not a print-ready DOM — it's an
   interactive canvas that needs to be converted to HTML first.
2. The conversion to HTML happens in the renderer (the renderer knows
   the current view state, styles, page breaks).
3. The PDF rendering must happen in a SEPARATE window (loading the HTML
   and calling `printToPDF`) — you can't call `printToPDF` on the
   interactive canvas's `webContents` without disrupting the user's view.

### Interface ownership

The `SpreadsheetPdfRenderer` interface lives in `runtime-contracts`
(Layer 1). It defines a single operation: `renderToPdf(html, options)`.

The interface must NOT expose:
- `BrowserWindow`, `WebContents`
- `node:fs`, `node:path`
- File dialogs, save paths
- `wcId`, renderer identity

### Lifecycle ownership

- **HTML generation**: owned by the renderer (the renderer knows the
  current spreadsheet view state).
- **PDF rendering**: owned by the Electron adapter
  (`ElectronSpreadsheetPdfRenderer`), which creates a hidden
  `BrowserWindow`, loads the HTML, calls `printToPDF`, and returns
  the bytes.
- **Save path**: owned by the shell coordinator (file dialog + write).

### Future implementations

- `ElectronSpreadsheetPdfRenderer` — hidden BrowserWindow + printToPDF
  (current approach)
- `WebSpreadsheetPdfRenderer` — use browser's `window.print()` or a
  headless browser API
- `WasmSpreadsheetPdfRenderer` — render PDF directly from the spreadsheet
  model without an HTML intermediary
- `CloudSpreadsheetPdfRenderer` — send the HTML/model to a server-side
  rendering service

The interface uses `Promise<T>` for all operations and does not assume
a process boundary.

### Error model

- `RenderError` — the hidden window failed to load, `printToPDF` failed,
  or the HTML was invalid.
- The adapter should clean up the hidden window in all cases (try/finally).

## Consequences

- `runtime-contracts` gains a `SpreadsheetPdfRenderer` interface.
- `platform-electron` gains an `ElectronSpreadsheetPdfRenderer`
  implementation.
- The generic `Printing` capability remains unchanged — it is NOT
  polluted with hidden-window behavior.
- Sheets' PDF export path becomes:
  `renderer (generates HTML) → IPC → coordinator → SpreadsheetService → SpreadsheetPdfRenderer → bytes → save`
