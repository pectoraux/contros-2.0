/**
 * SpreadsheetService — domain runtime service for the sheets (`.xlsx`) editor.
 *
 * ADR-004 / Phase 2 Architecture (Increment 3A correction):
 *   The service owns DOMAIN semantics only — workbook open/read/recalc/save.
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
 *     - Renderer event routing / lifecycle notifications (shell coordinator
 *       owns `docs/workbook opened`, `renamed`, `teardown` notifications)
 *
 *   The service DOES own:
 *     - Workbook open/save semantics
 *     - Sheet-id translation (domain ↔ engine)
 *     - ExternalChangeStatus policy (unchanged → save; changed/unknown → refuse)
 *     - Save-plan validation
 *     - Engine coordination (delegates to SpreadsheetEngine)
 *     - Recovery path derivation (pure computation, no filesystem)
 *
 * ERROR MODEL (Increment 3A):
 *   The service preserves typed engine/domain failures. It does NOT silently
 *   convert every engine exception into `null` or `{ ok: false }`. Operations
 *   that have no legitimate "soft failure" outcome throw typed errors:
 *     - open()           → throws EngineError | InvalidSessionError | InvalidInputError
 *     - close()          → throws EngineError | InvalidSessionError
 *     - writeRecovery()  → throws EngineError | InvalidSessionError
 *   The caller can distinguish:
 *     - user cancellation — handled at the shell layer (dialog cancelled);
 *       the service is never called
 *     - invalid workbook  — engine throws InvalidInputError (INVALID_INPUT)
 *     - engine failure    — engine throws EngineError (INTERNAL_ERROR)
 *     - protocol failure  — engine throws EngineError (PROTOCOL_ERROR)
 *     - invalid session   — engine throws InvalidSessionError (INVALID_SESSION)
 *
 *   save() is the only operation that has a legitimate soft-failure outcome:
 *     - externalChange === 'changed' || 'unknown' → { ok: false, reason: 'external-modified' }
 *   All other save failures (engine errors) propagate as typed errors.
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
} from './spreadsheet-engine.js'

/**
 * Domain-level workbook session.
 *
 * Contains ONLY domain data — no filesystem paths, no engine handles,
 * no snapshot paths, no disk fingerprints. Those belong to
 * ShellWorkbookSession (shell coordinator).
 *
 * Note: the field `workbookName` is a basename (e.g. 'budget.xlsx'), NOT an
 * absolute filesystem path. Filesystem paths remain exclusively in the
 * shell layer (ShellWorkbookSession).
 */
export interface WorkbookSession {
  /**
   * The workbook name (basename, e.g. 'budget.xlsx').
   * This is a domain identifier — NOT a filesystem path. The shell
   * layer (ShellWorkbookSession) owns the absolute path separately.
   */
  readonly workbookName: string
  /** SHA-256 hash of the workbook content at open time. */
  readonly workbookHash: string
  /** Domain sheetId → file sheet name mapping (Univer id → xlsx sheet name). */
  readonly sheetNames: ReadonlyMap<string, string>
}

/**
 * Result of opening a workbook.
 *
 * `engineHandle` is an opaque engine context token. Callers MUST NOT
 * inspect, compare, serialize, or construct one. The only way to obtain
 * an `EngineSessionHandle` is as the return value of `service.open()`.
 *
 * The handle is included in this result so that the shell coordinator
 * (which owns the WorkbookSession ↔ engineHandle mapping) can pass it
 * to subsequent service operations. The shell stores it inside
 * `ShellWorkbookSession.engineHandle`; the domain WorkbookSession above
 * does NOT contain it.
 *
 * The handle exposes NO sidecar UUID, NO engineSessionId, NO
 * implementation details — only an opaque brand symbol. Any attempt to
 * read its fields via `Object.keys()`, `Reflect.ownKeys()`, or similar
 * reflection returns nothing useful.
 */
export interface WorkbookOpenResult {
  /** Domain-level session (workbookName, hash, sheetNames). */
  session: WorkbookSession
  /**
   * Opaque engine context token — pass to subsequent service operations.
   * Not inspectable, not serializable, not constructable by callers.
   */
  engineHandle: EngineSessionHandle
  /** Workbook metadata from the engine. */
  metadata: WorkbookMetadata
}

/** Save request — the computed save plan (patches to apply). */
export interface SaveRequest {
  /** The patches to apply to the workbook archive. */
  patches: EngineArchivePatch[]
}

/**
 * Result of a save operation.
 *
 * `ok: false` is a LEGITIMATE business outcome, NOT an error — it
 * indicates that in-place save was refused because the external file
 * changed (or its state is unknown). The shell prompts the user to
 * Save-As instead.
 *
 * Engine failures (InvalidSessionError, EngineError) do NOT produce
 * `ok: false` — they propagate as typed errors. The caller can
 * distinguish:
 *   - externalChange policy refusal → { ok: false, reason: 'external-modified' }
 *   - engine failure              → throws EngineError | InvalidSessionError
 */
export interface SaveResult {
  /** true when the save succeeded; false when refused by external-change policy. */
  ok: boolean
  /**
   * Present when ok === false. Currently always 'external-modified'
   * (the only legitimate soft-failure reason).
   */
  reason?: 'external-modified'
  /** The saved workbook bytes — present when ok === true. */
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
 *
 * ERROR MODEL:
 *   - `open()`, `close()`, `writeRecovery()` throw typed errors on failure
 *     (EngineError, InvalidSessionError, InvalidInputError). They do NOT
 *     return null or `{ ok: false }` — the caller must catch typed errors.
 *   - `save()` returns `SaveResult` because external-change policy refusal
 *     is a legitimate business outcome. Engine failures still throw.
 *   - `readRange`, `readFormulaCells`, `recalculate`, `readMedia` throw
 *     typed errors on engine failure (no swallowing).
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
   * THROWS on failure (does NOT return null):
   *   - InvalidInputError     — workbook bytes are not a valid xlsx
   *   - InvalidSessionError   — engine could not establish a session
   *   - EngineError           — engine failure (INTERNAL_ERROR) or
   *                             protocol failure (PROTOCOL_ERROR)
   *
   * @param workbook — the raw xlsx file content (Uint8Array)
   * @param locale — the UI locale for formula/function name resolution
   * @param fileName — the workbook file name (basename)
   */
  open(
    workbook: Uint8Array,
    locale: string,
    fileName: string,
  ): Promise<WorkbookOpenResult>

  /**
   * Close an engine session. The handle becomes invalid after this call.
   *
   * THROWS on failure (does NOT return `{ ok: false }`):
   *   - InvalidSessionError — handle was already closed or never opened
   *   - EngineError         — engine failure or protocol failure
   *
   * @param engineHandle — opaque engine handle returned by open()
   */
  close(engineHandle: EngineSessionHandle): Promise<void>

  // ── Workbook operations ──

  /**
   * Read a range of cells. The service resolves domain sheet ids →
   * engine sheet names using the session's sheetNames map.
   *
   * THROWS on engine failure (InvalidSessionError, EngineError).
   */
  readRange(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    sheetId: string,
    range: string,
  ): Promise<EngineRangeResult>

  /**
   * Read all formula cells from a worksheet.
   *
   * THROWS on engine failure (InvalidSessionError, EngineError).
   */
  readFormulaCells(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    sheetId: string,
  ): Promise<EngineFormulaCellsResult>

  /**
   * Recalculate formulas. The service resolves domain sheet ids → engine
   * sheet names before delegating to the engine.
   *
   * THROWS on engine failure (InvalidSessionError, InvalidInputError, EngineError).
   */
  recalculate(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    edits: EngineRecalcEdit[],
    reads: EngineRecalcRead[],
  ): Promise<EngineRecalcResult>

  /**
   * Read media (image bytes) from the workbook.
   *
   * The `visualId` is scoped to the workbook session (each opened workbook
   * has its own visual ids). The `session` parameter is required for
   * consistency with the domain/session model — even though the
   * `engineHandle` already scopes the request server-side, passing the
   * domain session makes the call shape uniform with `readRange` /
   * `readFormulaCells` / `recalculate` and lets the service apply future
   * domain-level validation without an API break.
   *
   * THROWS on engine failure (InvalidSessionError, EngineError).
   */
  readMedia(
    session: WorkbookSession,
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
   * RETURNS `SaveResult` — the external-change refusal is a legitimate
   * business outcome (NOT an error). Engine failures (InvalidSessionError,
   * EngineError) PROPAGATE as typed errors — they do NOT produce
   * `{ ok: false }`.
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
   * THROWS on failure (does NOT return `{ ok: false }`):
   *   - InvalidSessionError — handle was closed or never opened
   *   - EngineError         — engine failure or protocol failure
   *
   * @returns the recovery archive bytes (the shell persists them)
   */
  writeRecovery(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    request: SaveRequest,
  ): Promise<Uint8Array>
}
