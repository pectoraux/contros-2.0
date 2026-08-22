/**
 * SpreadsheetService — domain runtime service for the sheets (`.xlsx`) editor.
 *
 * ADR-004 / Phase 2 Architecture (Increment 3B correction):
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
 *     - Sheet-id translation (domain sheetId ↔ engine sheet name) — FAIL-CLOSED
 *       on unknown sheetIds (throws InvalidInputError)
 *     - ExternalChangeStatus policy (unchanged → save; changed/unknown → refuse)
 *     - Save-plan validation (sheetId resolution before delegation)
 *     - Engine coordination (delegates to SpreadsheetEngine)
 *     - Recovery path derivation (pure computation, no filesystem)
 *
 * SAVE DOMAIN MODEL (Increment 3B):
 *   The service accepts a domain `SavePlan` (NOT `EngineArchivePatch[]`).
 *   The SavePlan preserves ALL renderer-independent Sheets mutation families
 *   (sheetOps, edits, structuralOps, filterStates, hyperlinkEdits, cfStates,
 *   dvStates, pageSetupStates, noteStates, formulaValues, visualAdditions,
 *   tableAdditions, pivotAdditions, sparklineAdditions, pivotRefreshUpdates,
 *   sheetProtections, protectedRangeStates, definedNamesState, themeState,
 *   workbookProtectionState, chartEdits, visualEdits). This mirrors the
 *   legacy `WorkbookSaveRequest` (apps/sheets/src/shared/desktop-api.ts:1476)
 *   but as domain types, not Zod schemas.
 *
 *   The service translates the SavePlan → `EngineArchivePatch[]` at the
 *   final engine boundary, via an injected `SavePlanTranslator`. The
 *   translator implementation is provided by the shell (it wraps the
 *   xlsx-gateway.ts planning logic). The service does NOT import
 *   platform-electron, xlsx-gateway, or any engine-specific code.
 *
 * SHEET-ID MAPPING (Increment 3B):
 *   The service builds `sheetNames: Map<sheetId, sheetName>` from
 *   `[sheet.id, sheet.name]` (NOT `[sheet.name, sheet.name]`). The `id`
 *   is the stable XLSX sheetId attribute (immutable across renames);
 *   `name` is the visible tab name (mutable). Unknown sheetIds in any
 *   operation → `InvalidInputError` (fail-closed, mirroring the legacy
 *   runtime at sheets-main.ts:1785-1789 and 2544-2545).
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

// ── Domain save plan types (mirror legacy WorkbookSaveRequest) ────────

/**
 * A cell edit in the domain save plan.
 * Keyed by `sheetId` (domain), resolved to file sheet name by the service.
 */
export interface SheetCellEdit {
  /** Domain sheetId (the renderer's sheet identifier). */
  readonly sheetId: string
  readonly row: number
  readonly column: number
  /** The value to write (string for formulas, number for numeric). */
  readonly value: string
  /** Optional formula string (without leading =). */
  readonly formula?: string
  /** Optional style index to apply. */
  readonly styleIndex?: number
  /** Optional rich-text runs. */
  readonly rich?: unknown
  /** Whether to reset the cell's style. */
  readonly styleReset?: boolean
}

/**
 * A structural operation (insert/delete/resize/hide/outline rows or columns).
 * Keyed by `sheetId` (domain), resolved to file sheet name by the service.
 */
export interface SheetStructuralOp {
  readonly sheetId: string
  readonly kind: string
  readonly start?: number
  readonly end?: number
  readonly index?: number
  readonly count?: number
  readonly size?: number
  readonly level?: number
  readonly collapsed?: boolean
  readonly hidden?: boolean
  readonly before?: boolean
  readonly range?: unknown
}

/**
 * A sheet-level operation (add/duplicate/rename/reorder/remove/hide).
 * Keyed by `sheetId` (domain).
 */
export interface SheetOp {
  readonly kind: 'add-sheet' | 'duplicate-sheet' | 'rename-sheet' | 'remove-sheet' | 'set-sheet-hidden' | 'reorder-sheets'
  readonly sheetId: string
  /** For add-sheet / duplicate-sheet: the new sheet's name. */
  readonly name?: string
  /** For duplicate-sheet: the source sheet's id. */
  readonly sourceSheetId?: string
  /** For rename-sheet: the new name. */
  readonly newName?: string
  /** For set-sheet-hidden: the hidden state. */
  readonly hidden?: boolean
}

/**
 * A hyperlink edit (add/remove) keyed by sheetId + cell.
 */
export interface SheetHyperlinkEdit {
  readonly sheetId: string
  readonly row: number
  readonly column: number
  /** null target = remove hyperlink. */
  readonly target: string | null
}

/**
 * A filter state (auto-filter) keyed by sheetId.
 */
export interface SheetFilterState {
  readonly sheetId: string
  readonly filter: unknown
  readonly hiddenRows: number[]
  readonly visibilityRange?: unknown
}

/**
 * A conditional-formatting state keyed by sheetId.
 */
export interface SheetCfState {
  readonly sheetId: string
  readonly rules: unknown[]
}

/**
 * A data-validation state keyed by sheetId.
 */
export interface SheetDvState {
  readonly sheetId: string
  readonly rules: unknown[]
}

/**
 * A page-setup state keyed by sheetId.
 */
export interface SheetPageSetupState {
  readonly sheetId: string
  readonly [key: string]: unknown
}

/**
 * A note (cell comment) state keyed by sheetId.
 */
export interface SheetNoteState {
  readonly sheetId: string
  readonly notes: unknown[]
}

/**
 * A visual addition (chart/shape/image) keyed by sheetId.
 */
export interface SheetVisualAddition {
  readonly sheetId: string
  readonly anchor: unknown
  readonly chart?: unknown
  readonly shape?: unknown
  readonly image?: unknown
}

/**
 * A table addition keyed by sheetId.
 */
export interface SheetTableAddition {
  readonly sheetId: string
  readonly area: unknown
  readonly name: string
  readonly columnNames: string[]
  readonly style?: unknown
  readonly bandedRows?: boolean
}

/**
 * A pivot-table addition keyed by sheetId + sourceSheetId.
 */
export interface SheetPivotAddition {
  readonly sheetId: string
  readonly sourceSheetId: string
  readonly sourceArea: unknown
  readonly location: unknown
  readonly name: string
  readonly [key: string]: unknown
}

/**
 * A sparkline addition keyed by sheetId.
 */
export interface SheetSparklineAddition {
  readonly sheetId: string
  readonly type: 'line' | 'column' | 'stacked'
  readonly color?: string
  readonly cells: Array<{ cell: string; sourceRef: string }>
}

/**
 * A recalculated formula value writeback keyed by sheetId.
 */
export interface SheetFormulaValue {
  readonly sheetId: string
  readonly row: number
  readonly column: number
  readonly value: string | number | boolean | null
}

/**
 * A pivot refresh update keyed by sheetId.
 */
export interface PivotRefreshUpdate {
  readonly cachePath: string
  readonly sheetId: string
  readonly newOutputRef: string
  readonly relayout?: SheetPivotAddition
}

/**
 * A sheet protection state keyed by sheetId.
 */
export interface SheetProtectionState {
  readonly sheetId: string
  readonly protected: boolean
}

/**
 * A protected-range state keyed by sheetId.
 */
export interface SheetProtectedRangesState {
  readonly sheetId: string
  readonly ranges: Array<{ name: string; sqref: string }>
}

/**
 * A chart edit (package-absolute drawingPath — no sheetId mapping needed).
 */
export interface WorkbookChartEdit {
  readonly drawingPath: string
  readonly [key: string]: unknown
}

/**
 * A visual edit (package-absolute drawingPath — no sheetId mapping needed).
 */
export interface WorkbookVisualEdit {
  readonly drawingPath: string
  readonly [key: string]: unknown
}

/**
 * Defined-names state (declarative snapshot, null = untouched).
 */
export interface DefinedNamesState {
  readonly names: Array<{ name: string; formula: string; sheetIndex?: number }>
  readonly preserveNames: string[]
}

/**
 * Theme state (null = untouched).
 */
export interface WorkbookThemeState {
  readonly colors?: { name: string; values: string[] }
  readonly fonts?: { name: string; major: string; minor: string }
}

/**
 * Workbook protection state (null = untouched).
 */
export interface WorkbookProtectionState {
  readonly lockStructure: boolean
}

/**
 * The domain save plan — preserves ALL renderer-independent Sheets mutation
 * families. Mirrors the legacy `WorkbookSaveRequest` (apps/sheets/src/shared/
 * desktop-api.ts:1476) but as domain types, not Zod schemas.
 *
 * Every field keyed by `sheetId` is resolved to the file sheet name by the
 * service (using `session.sheetNames`) before delegation. Unknown sheetIds
 * → `InvalidInputError` (fail-closed).
 *
 * The service translates this plan to `EngineArchivePatch[]` at the final
 * engine boundary, via the injected `SavePlanTranslator`.
 */
export interface SavePlan {
  // ── Cell-level mutations ──
  readonly edits: SheetCellEdit[]
  readonly structuralOps: SheetStructuralOp[]
  readonly formulaValues: SheetFormulaValue[]

  // ── Sheet-level mutations ──
  readonly sheetOps: SheetOp[]
  /** Final tab order (domain sheetIds). Required when sheetOps is non-empty. */
  readonly sheetOrder: string[]

  // ── Per-sheet state ──
  readonly filterStates: SheetFilterState[]
  readonly hyperlinkEdits: SheetHyperlinkEdit[]
  readonly cfStates: SheetCfState[]
  readonly dvStates: SheetDvState[]
  readonly pageSetupStates: SheetPageSetupState[]
  readonly noteStates: SheetNoteState[]
  readonly sheetProtections: SheetProtectionState[]
  readonly protectedRangeStates: SheetProtectedRangesState[]

  // ── Additions (new objects) ──
  readonly visualAdditions: SheetVisualAddition[]
  readonly tableAdditions: SheetTableAddition[]
  readonly pivotAdditions: SheetPivotAddition[]
  readonly sparklineAdditions: SheetSparklineAddition[]

  // ── Workbook-level mutations ──
  readonly chartEdits: WorkbookChartEdit[]
  readonly visualEdits: WorkbookVisualEdit[]
  readonly pivotCacheRefreshPaths: string[]
  readonly pivotRefreshUpdates: PivotRefreshUpdate[]
  readonly definedNamesState: DefinedNamesState | null
  readonly themeState: WorkbookThemeState | null
  readonly workbookProtectionState: WorkbookProtectionState | null
}

/**
 * Result of translating a SavePlan to engine archive patches.
 * The service passes these patches to `engine.saveArchive()`.
 */
export interface SavePlanTranslation {
  /** The engine archive patches to apply. */
  readonly patches: EngineArchivePatch[]
  /** Entry paths that were touched (for the save result). */
  readonly touchedEntries: string[]
}

/**
 * Translates a domain SavePlan to engine archive patches at the final
 * engine boundary. The service calls this before `engine.saveArchive()`.
 *
 * The translator implementation is provided by the shell (it wraps the
 * xlsx-gateway.ts planning logic). The service does NOT import
 * platform-electron, xlsx-gateway, or any engine-specific code.
 *
 * The translator receives the resolved `sheetNames` map (sheetId → file
 * sheet name) and is responsible for resolving sheetIds in the plan
 * before producing archive patches.
 */
export interface SavePlanTranslator {
  /**
   * Translate a domain SavePlan to engine archive patches.
   *
   * @param handle — opaque engine session handle (for reading archive entries)
   * @param plan — the domain save plan
   * @param sheetNames — the resolved sheetId → file sheet name map
   * @returns the engine archive patches + touched entry paths
   */
  translate(
    handle: EngineSessionHandle,
    plan: SavePlan,
    sheetNames: ReadonlyMap<string, string>,
  ): Promise<SavePlanTranslation>
}

// ── Domain session ───────────────────────────────────────────────────

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
  /**
   * Domain sheetId → file sheet name mapping.
   * Built from `[sheet.id, sheet.name]` (NOT `[sheet.name, sheet.name]`).
   * The `id` is the stable XLSX sheetId attribute (immutable across renames).
   */
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

/**
 * The domain save request — a rich SavePlan preserving all mutation families.
 *
 * This REPLACES the Increment 3A `SaveRequest = EngineArchivePatch[]`,
 * which discarded renderer-independent Sheets mutation semantics. The
 * service now receives a domain SavePlan, validates sheetIds (fail-closed),
 * resolves them to file sheet names, and delegates to the engine via the
 * injected SavePlanTranslator.
 */
export interface SaveRequest {
  /** The domain save plan (sheetOps, edits, structuralOps, etc.). */
  readonly plan: SavePlan
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
  /** Entry paths that were touched — present when ok === true. */
  touchedEntries?: string[]
}

// ── Service dependencies ─────────────────────────────────────────────

/**
 * Dependencies for SpreadsheetServiceImpl.
 *
 * The SavePlanTranslator is injected (not imported) — the service does
 * NOT own the translation logic. The shell provides the translator
 * implementation (wrapping xlsx-gateway.ts).
 */
export interface SpreadsheetServiceDeps {
  /** The spreadsheet execution engine (injected — runtime chooses impl). */
  readonly engine: SpreadsheetEngine
  /** Translates domain SavePlan → EngineArchivePatch[] at the engine boundary. */
  readonly savePlanTranslator: SavePlanTranslator
}

// ── Service interface ───────────────────────────────────────────────

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
 *
 * SHEET-ID FAIL-CLOSED:
 *   All operations that accept a `sheetId` (readRange, readFormulaCells,
 *   recalculate, readMedia, save, writeRecovery) validate the sheetId
 *   against `session.sheetNames` BEFORE delegation. Unknown sheetIds →
 *   `InvalidInputError` (mirrors the legacy runtime at sheets-main.ts:1787,
 *   2545, 2554).
 *
 * MEDIA SESSION SAFETY:
 *   `readMedia` accepts `session` + `engineHandle` for API consistency.
 *   The engineHandle is the complete session scope — the sidecar maps
 *   engineHandle → sidecar sessionId internally, and visualId is scoped
 *   to that sessionId. Cross-session misuse (passing session A's
 *   visualId with session B's engineHandle) fails at the engine level
 *   (visualId not found in session B's sidecar session). The service
 *   does NOT need to validate session ↔ engineHandle binding — the
 *   engine's own session isolation enforces it.
 */
export interface SpreadsheetService {
  // ── Workbook lifecycle ──

  /**
   * Open a workbook from raw bytes. Internally calls engine.open() which
   * creates the opaque handle. Returns domain session + engine handle + metadata.
   *
   * The sheetNames map is built from `[sheet.id, sheet.name]` — the stable
   * XLSX sheetId attribute, NOT the mutable sheet name. This preserves
   * the legacy mapping at sheets-main.ts:2805.
   *
   * THROWS on failure (does NOT return null):
   *   - InvalidInputError     — workbook bytes are not a valid xlsx
   *   - InvalidSessionError   — engine could not establish a session
   *   - EngineError           — engine failure (INTERNAL_ERROR) or
   *                             protocol failure (PROTOCOL_ERROR)
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
   */
  close(engineHandle: EngineSessionHandle): Promise<void>

  // ── Workbook operations ──

  /**
   * Read a range of cells. The service resolves domain sheetId →
   * engine sheet name using the session's sheetNames map.
   * Unknown sheetId → InvalidInputError (fail-closed).
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
   * Unknown sheetId → InvalidInputError (fail-closed).
   *
   * THROWS on engine failure (InvalidSessionError, EngineError).
   */
  readFormulaCells(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    sheetId: string,
  ): Promise<EngineFormulaCellsResult>

  /**
   * Recalculate formulas. The service resolves domain sheetIds → engine
   * sheet names before delegating to the engine.
   * Unknown sheetId → InvalidInputError (fail-closed).
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
   * The `visualId` is scoped to the engine session (the sidecar maps
   * engineHandle → sidecar sessionId; visualId is unique within that
   * sessionId). The `session` parameter is accepted for API consistency
   * with readRange/readFormulaCells/recalculate. Cross-session misuse
   * (session A's visualId with session B's engineHandle) fails at the
   * engine level — the service does not need to validate the binding.
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
   * The service validates all sheetIds in the SavePlan against
   * `session.sheetNames` (fail-closed → InvalidInputError) before
   * delegation. Unknown sheetIds in ANY mutation family (edits,
   * structuralOps, sheetOps, filterStates, etc.) → InvalidInputError.
   *
   * The service translates the validated SavePlan to EngineArchivePatch[]
   * via the injected SavePlanTranslator, then calls engine.saveArchive().
   *
   * RETURNS `SaveResult` — the external-change refusal is a legitimate
   * business outcome (NOT an error). Engine failures (InvalidSessionError,
   * EngineError) PROPAGATE as typed errors — they do NOT produce
   * `{ ok: false }`.
   */
  save(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    request: SaveRequest,
    externalChange: ExternalChangeStatus,
  ): Promise<SaveResult>

  /**
   * Write a recovery copy. The service validates all sheetIds in the
   * SavePlan (fail-closed), translates to EngineArchivePatch[] via the
   * injected SavePlanTranslator, and delegates to engine.saveArchive().
   * It does NOT write to a filesystem path — it returns the bytes for
   * the shell to persist.
   *
   * THROWS on failure (does NOT return `{ ok: false }`):
   *   - InvalidInputError    — unknown sheetId in the SavePlan
   *   - InvalidSessionError  — handle was closed or never opened
   *   - EngineError          — engine failure or protocol failure
   *
   * @returns the recovery archive bytes (the shell persists them)
   */
  writeRecovery(
    session: WorkbookSession,
    engineHandle: EngineSessionHandle,
    request: SaveRequest,
  ): Promise<Uint8Array>
}
