/**
 * SpreadsheetEngine — runtime-independent interface for the spreadsheet
 * execution engine (ADR-004).
 *
 * This is the Sheets-specific execution-engine port. It is NOT a generic
 * platform capability and NOT a shell responsibility. The interface lives
 * in runtime-contracts (Layer 1); the implementation lives in
 * platform-electron (Layer 4a) as ElectronXlsxSidecarEngine.
 *
 * The engine operates on opaque EngineSessionHandle tokens — the domain
 * service and runtime contracts NEVER inspect the token's internal
 * representation. The Electron adapter maps the token to a Rust sidecar
 * UUID internally; a future WASM adapter would map it to an in-memory
 * table key; a Cloud adapter would map it to a server session token.
 *
 * FORBIDDEN in this file (and all runtime-contracts):
 *   sidecarSessionId, sidecar, Rust, stdio, child_process, snapshotPath,
 *   BrowserWindow, WebContents, wcId, Electron, node:fs, node:path,
 *   engineSessionId
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */

// ── Opaque engine session handle ───────────────────────────────────────

/**
 * An opaque token representing an engine session. Created by
 * `SpreadsheetEngine.open()`, passed to all subsequent engine operations.
 *
 * The token has NO inspectable fields. Consumers must not attempt to
 * read, compare, or construct one. The only way to obtain an
 * EngineSessionHandle is as the return value of `engine.open()`.
 *
 * The Electron adapter maps this token to a Rust sidecar UUID internally.
 * A WASM adapter would map it to an in-memory table key. A Cloud adapter
 * would map it to a server session token. The mapping is private to the
 * adapter implementation.
 */
export declare const ENGINE_SESSION_HANDLE_BRAND: unique symbol

export interface EngineSessionHandle {
  /** @internal Brand marker — do not access. */
  readonly [ENGINE_SESSION_HANDLE_BRAND]: typeof ENGINE_SESSION_HANDLE_BRAND
}

// ── Engine errors ───────────────────────────────────────────────────────

/**
 * Base error for all engine failures. Contains domain-safe information only —
 * no Rust/stdio/child-process implementation details.
 */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

/**
 * The engine session handle is unknown — the session was closed, expired,
 * or never opened. The coordinator should clean up the session.
 */
export class InvalidSessionError extends EngineError {
  constructor(message: string) {
    super(message, 'INVALID_SESSION')
    this.name = 'InvalidSessionError'
  }
}

/**
 * The request payload failed validation. The domain service should reject
 * the caller.
 */
export class InvalidInputError extends EngineError {
  constructor(message: string) {
    super(message, 'INVALID_INPUT')
    this.name = 'InvalidInputError'
  }
}

// ── External change status ─────────────────────────────────────────────

/**
 * Runtime-neutral fact about whether the file on disk has changed since
 * the workbook was opened.
 *
 * Supplied by the shell (which observes filesystem state via the Files
 * capability). The domain service applies the frozen policy:
 *   'unchanged' → save permitted
 *   'changed'   → in-place save refused
 *   'unknown'   → in-place save refused (safe default)
 *
 * Save-As is always available (targets a user-selected path).
 */
export type ExternalChangeStatus = 'unchanged' | 'changed' | 'unknown'

// ── Engine domain types ────────────────────────────────────────────────

/** Worksheet metadata returned by engine.open(). */
export interface WorksheetMetadata {
  /** The sheet name as it appears in the xlsx file. */
  name: string
  /** Zero-based sheet index in the workbook. */
  index: number
  /** Whether the sheet is hidden. */
  hidden: boolean
  /** RTL layout. */
  rtl: boolean
  /** Gridline color (ARGB hex), if set. */
  gridlineColor?: string
  /** Whether gridlines are visible. */
  showGridlines: boolean
  /** Row count. */
  rowCount: number
  /** Column count. */
  columnCount: number
  /** Default row height in points. */
  defaultRowHeight: number
  /** Default column width in character units. */
  defaultColumnWidth: number
  /** Tab color (ARGB hex), if set. */
  tabColor?: string
}

/** Workbook metadata returned by engine.open(). */
export interface WorkbookMetadata {
  /** The file name (basename). */
  name: string
  /** Absolute on-disk path (may be a snapshot). */
  path: string
  /** SHA-256 hash of the file content. */
  sha256: string
  /** Number of ZIP entries in the archive. */
  entryCount: number
  /** Worksheet metadata for each sheet. */
  sheets: WorksheetMetadata[]
  /** Active sheet index (workbookView/@activeTab). */
  activeTab: number
  /** Defined names (workbook-level named ranges). */
  definedNames: Array<{ name: string; value: string }>
  /** Theme color scheme (ARGB hex values). */
  themeColors: string[]
  /** Theme font scheme (major/minor font names). */
  themeFonts: { major: string; minor: string }
}

/** A cell record within a range result. */
export interface EngineCellRecord {
  row: number
  column: number
  /** The cell value as a string (formatted). */
  value: string
  /** The raw typed value, if numeric. */
  number?: number
  /** Whether the cell contains a formula. */
  isFormula: boolean
  /** Style index (0 = default). */
  styleIndex: number
  /** Hyperlink target, if set. */
  hyperlink?: string
}

/** A merged cell range. */
export interface EngineCellArea {
  firstRow: number
  firstColumn: number
  lastRow: number
  lastColumn: number
}

/** Row metadata within a range result. */
export interface EngineRowMetadata {
  row: number
  height?: number
  customHeight?: boolean
  hidden: boolean
  outlineLevel?: number
  collapsed?: boolean
  styleIndex?: number
}

/** Column metadata within a range result. */
export interface EngineColumnMetadata {
  column: number
  width?: number
  customWidth?: boolean
  hidden: boolean
  outlineLevel?: number
  collapsed?: boolean
  styleIndex?: number
}

/** Result of reading a range from the engine. */
export interface EngineRangeResult {
  cells: EngineCellRecord[]
  rows: EngineRowMetadata[]
  merges: EngineCellArea[]
  columns: EngineColumnMetadata[]
  /** Hyperlinks in the range. */
  hyperlinks: Array<{ cell: string; target: string }>
  /** Conditional formatting rules. */
  conditionalFormatting: unknown[]
  /** Data validation rules. */
  dataValidation: unknown[]
  /** Auto-filter state, if set. */
  autoFilter?: { startRow: number; startColumn: number; endRow: number; endColumn: number }
  /** Page break rows. */
  rowBreaks: number[]
  /** Page break columns. */
  columnBreaks: number[]
  /** Sheet protection state. */
  sheetProtection: boolean
}

/** A formula cell within a formula-cells result. */
export interface EngineFormulaCell {
  row: number
  column: number
  /** The formula string (without leading =). */
  formula: string
  /** The cached value, if any. */
  cachedValue?: string
}

/** Result of reading formula cells from the engine. */
export interface EngineFormulaCellsResult {
  cells: EngineFormulaCell[]
}

/** A recalculation edit (user input to apply before evaluation). */
export interface EngineRecalcEdit {
  sheetName: string
  row: number
  column: number
  /** The value to set (string for formulas, number for numeric). */
  value: string
}

/** A recalculation read request (which cells to return computed values for). */
export interface EngineRecalcRead {
  sheetName: string
  row: number
  column: number
}

/** A computed cell after recalculation. */
export interface EngineRecalcCell {
  sheetName: string
  row: number
  column: number
  /** The formatted display value. */
  formatted: string
  /** The numeric value, if numeric. */
  number?: number
  /** Whether the cell contains a formula. */
  isFormula: boolean
}

/** Result of recalculation. */
export interface EngineRecalcResult {
  cells: EngineRecalcCell[]
}

/** Result of reading media (image bytes) from the engine. */
export interface EngineMediaResult {
  /** MIME type (e.g., 'image/png'). */
  mediaType: string
  /** Base64-encoded image bytes. */
  base64: string
}

/** A patch to apply to a ZIP entry in the archive during save. */
export interface EngineArchivePatch {
  /** The ZIP entry path to patch (e.g., 'xl/worksheets/sheet1.xml'). */
  entryPath: string
  /** The new content for the entry (UTF-8 string). */
  content: string
}

// ── SpreadsheetEngine interface ────────────────────────────────────────

/**
 * The spreadsheet execution engine interface.
 *
 * This interface is implemented by:
 *   - ElectronXlsxSidecarEngine (current: Rust sidecar via child_process)
 *   - WasmSpreadsheetEngine (future: IronCalc compiled to WASM)
 *   - CloudSpreadsheetEngine (future: server-side computation)
 *
 * The interface uses `Promise<T>` for all operations. It must not assume
 * a process boundary — a WASM engine returns results via async in-process
 * calls, not IPC.
 */
export interface SpreadsheetEngine {
  /**
   * Open a workbook file. Creates a new engine session and returns an
   * opaque handle + workbook metadata.
   *
   * The handle does NOT exist before this call. All subsequent operations
   * receive the handle returned here.
   */
  open(path: string, locale: string): Promise<{
    handle: EngineSessionHandle
    metadata: WorkbookMetadata
  }>

  /**
   * Read a range of cells from a worksheet.
   * @param handle — opaque engine session handle (from open())
   * @param sheetName — the file sheet name (NOT a renderer sheet id)
   * @param range — the cell range (e.g., 'A1:Z100')
   */
  readRange(
    handle: EngineSessionHandle,
    sheetName: string,
    range: string,
  ): Promise<EngineRangeResult>

  /**
   * Read all formula cells from a worksheet.
   * @param handle — opaque engine session handle
   * @param sheetName — the file sheet name
   */
  readFormulaCells(
    handle: EngineSessionHandle,
    sheetName: string,
  ): Promise<EngineFormulaCellsResult>

  /**
   * Recalculate formulas. Applies pending edits as user input, evaluates,
   * and returns computed values for the requested cells.
   * @param handle — opaque engine session handle
   * @param edits — the edits to apply before evaluation
   * @param reads — the cells to return computed values for
   */
  recalculate(
    handle: EngineSessionHandle,
    edits: EngineRecalcEdit[],
    reads: EngineRecalcRead[],
  ): Promise<EngineRecalcResult>

  /**
   * Read media (image bytes) from the workbook.
   * @param handle — opaque engine session handle
   * @param visualId — the visual object identifier
   */
  readMedia(
    handle: EngineSessionHandle,
    visualId: string,
  ): Promise<EngineMediaResult>

  /**
   * Save the workbook as a new archive. Applies patches to the existing
   * ZIP entries and returns the complete archive bytes.
   * @param handle — opaque engine session handle
   * @param patches — the entry patches to apply
   * @returns the complete archive bytes (Uint8Array)
   */
  saveArchive(
    handle: EngineSessionHandle,
    patches: EngineArchivePatch[],
  ): Promise<Uint8Array>

  /**
   * Convert a legacy workbook (.xls) to .xlsx format.
   * @param path — the path to the legacy file
   * @returns the path to the converted .xlsx file
   */
  convertWorkbook(path: string): Promise<{ path: string }>

  /**
   * Close an engine session. The handle becomes invalid after this call.
   * @param handle — opaque engine session handle
   */
  close(handle: EngineSessionHandle): Promise<void>

  /**
   * Stop the engine entirely. Kills any background processes, releases
   * all resources. Called on app shutdown.
   */
  stop(): Promise<void>
}
