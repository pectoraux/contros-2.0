/**
 * SpreadsheetService — domain runtime service for the sheets (`.xlsx`) editor.
 *
 * ADR-004 / Phase 2 Architecture:
 *   The service owns domain semantics (workbook open/read/recalc/save).
 *   It delegates engine operations to SpreadsheetEngine (opaque handle).
 *   It receives dependencies via constructor injection — no getRuntime().
 *
 *   The service does NOT own:
 *     - File dialogs (shell owns Files.pickOpen / Files.pickSave)
 *     - BrowserWindow / WebContents (shell owns window management)
 *     - wcId lookup (shell coordinator owns the session registry)
 *     - Snapshot management (shell owns snapshot paths)
 *     - Disk fingerprint computation (shell observes filesystem state)
 *     - Recovery UI dialogs (shell owns Restore/Discard prompts)
 *     - child_process spawning (engine adapter owns sidecar lifecycle)
 *
 *   The service DOES own:
 *     - Workbook open/save semantics
 *     - Sheet-id translation (domain ↔ engine)
 *     - ExternalChangeStatus policy (unchanged → save; changed/unknown → refuse)
 *     - Save-plan validation
 *     - Engine coordination (delegates to SpreadsheetEngine)
 *     - Recovery path derivation (pure computation, no filesystem)
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */

import type {
  SpreadsheetEngine,
  EngineSessionHandle,
  ExternalChangeStatus,
  WorkbookMetadata,
  EngineRangeResult,
  EngineFormulaCellsResult,
  EngineRecalcEdit,
  EngineRecalcRead,
  EngineRecalcResult,
  EngineMediaResult,
  EngineArchivePatch,
  WorksheetMetadata,
} from './spreadsheet-engine.js'

/**
 * Domain-level workbook session.
 *
 * Contains ONLY domain data — no filesystem paths, no engine handles,
 * no snapshot paths, no disk fingerprints. Those belong to
 * ShellWorkbookSession (shell coordinator).
 */
export interface WorkbookSession {
  /** The workbook file name (basename, e.g. 'budget.xlsx'). */
  readonly workbookPath: string
  /** SHA-256 hash of the workbook content at open time. */
  readonly workbookHash: string
  /** Domain sheetId → file sheet name mapping (Univer id → xlsx sheet name). */
  readonly sheetNames: ReadonlyMap<string, string>
}

/** Result of opening a workbook. */
export interface WorkbookOpenResult {
  /** Domain-level session (path, hash, sheetNames). */
  session: WorkbookSession
  /** Opaque engine handle — pass to subsequent engine operations. */
  engineHandle: EngineSessionHandle
  /** Workbook metadata from the engine. */
  metadata: WorkbookMetadata
}

/** Save request — the computed save plan (patches to apply). */
export interface SaveRequest {
  /** The patches to apply to the workbook archive. */
  patches: EngineArchivePatch[]
}

/** Result of a save operation. */
export interface SaveResult {
  ok: boolean
  error?: string
  reason?: 'external-modified'
  /** The saved workbook bytes (the shell persists these to disk). */
  data?: Uint8Array
}

/**
 * The runtime-independent spreadsheet domain service.
 *
 * Uses SpreadsheetEngine for workbook I/O and computation.
 * Uses Storage / Files capabilities for persistence (via the shell).
 *
 * The service NEVER touches Electron, Node builtins, or filesystem paths
 * directly. It receives bytes and returns bytes. The shell persists them.
 */
export interface SpreadsheetService {
  // ── Workbook lifecycle ──

  /**
   * Open a workbook from raw bytes. Internally calls engine.open() which
   * creates the opaque handle. Returns domain session + engine handle + metadata.
   *
   * The handle does NOT exist before this call. All subsequent operations
   * receive the handle returned here.
   *
   * @param workbook — the raw xlsx file content (Uint8Array)
   * @param locale — the UI locale for formula/function name resolution
   * @param fileName — the workbook file name (basename)
   */
  open(
    workbook: Uint8Array,
    locale: string,
    fileName: string,
  ): Promise<WorkbookOpenResult | null>

  /**
   * Close an engine session. The handle becomes invalid after this call.
   */
  close(engineHandle: EngineSessionHandle): Promise<{ ok: boolean }>

  // ── Workbook operations ──

  /**
   * Read a range of cells. The service resolves domain sheet ids →
   * engine sheet names using the session's sheetNames map.
   */
  readRange(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    sheetId: string,
    range: string,
  ): Promise<EngineRangeResult>

  /**
   * Read all formula cells from a worksheet.
   */
  readFormulaCells(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    sheetId: string,
  ): Promise<EngineFormulaCellsResult>

  /**
   * Recalculate formulas. The service resolves domain sheet ids → engine
   * sheet names before delegating to the engine.
   */
  recalculate(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    edits: EngineRecalcEdit[],
    reads: EngineRecalcRead[],
  ): Promise<EngineRecalcResult>

  /**
   * Read media (image bytes) from the workbook.
   */
  readMedia(
    engineHandle: EngineSessionHandle,
    visualId: string,
  ): Promise<EngineMediaResult>

  // ── Save ──

  /**
   * Save the workbook. The service applies the frozen external-change policy:
   *   'unchanged' → save permitted, returns archive bytes
   *   'changed'   → in-place save refused ({ ok: false, reason: 'external-modified' })
   *   'unknown'   → in-place save refused (safe default)
   *
   * The service does NOT directly hash files or check the filesystem.
   * The shell supplies the ExternalChangeStatus fact.
   *
   * @param session — domain workbook session
   * @param engineHandle — opaque engine handle
   * @param request — the save plan (patches)
   * @param externalChange — runtime-neutral fact about disk state
   * @returns save result with archive bytes (the shell persists them)
   */
  save(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    request: SaveRequest,
    externalChange: ExternalChangeStatus,
  ): Promise<SaveResult>

  /**
   * Write a recovery copy. The service delegates to the engine to produce
   * archive bytes, but does NOT write them to a filesystem path — it
   * returns the bytes for the shell to persist.
   *
   * @returns the recovery archive bytes (the shell persists them)
   */
  writeRecovery(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    request: SaveRequest,
  ): Promise<{ ok: boolean; data?: Uint8Array }>

  // ── Domain events ──
  onOpened(handler: (result: WorkbookOpenResult) => void): () => void
  onRenamed(handler: (paths: { oldPath: string; newPath: string }) => void): () => void
  onTeardown(handler: () => void): () => void
}
