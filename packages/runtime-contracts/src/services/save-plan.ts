/**
 * Domain save plan types for the Sheets service (Increment 3B/3C).
 *
 * These types define the runtime-independent mutation model that the
 * renderer produces and the SpreadsheetService consumes. They mirror
 * the legacy `WorkbookSaveRequest` (apps/sheets/src/shared/desktop-api.ts:1476)
 * but as domain types, not Zod schemas.
 *
 * This file lives in `runtime-contracts/src/services/` so BOTH the
 * engine contract (`spreadsheet-engine.ts`) and the service contract
 * (`sheets.ts`) can import it without a circular dependency:
 *
 *   save-plan.ts          ← domain mutation types (no engine types)
 *       ↑                       ↑
 *   spreadsheet-engine.ts   sheets.ts
 *
 * Every sheetId-keyed field is resolved to the file sheet name by the
 * service (using `session.sheetNames`) before delegation. Unknown sheetIds
 * → `InvalidInputError` (fail-closed).
 */

// ── Cell-level mutations ─────────────────────────────────────────────

/**
 * A cell edit in the domain save plan.
 * Keyed by `sheetId` (domain), resolved to file sheet name by the service.
 *
 * Mirrors the legacy `WorkbookCellEdit` (apps/sheets/src/shared/desktop-api.ts:748)
 * but as a domain type, not a Zod schema.
 */
export interface SheetCellEdit {
  /** Domain sheetId (the renderer's sheet identifier). */
  readonly sheetId: string
  readonly row: number
  readonly column: number
  /** false = style-only edit; the cell's stored content stays untouched. */
  readonly writeValue: boolean
  /** The cell value (string, number, boolean, or null). */
  readonly value: string | number | boolean | null
  /** Optional formula string (without leading =). */
  readonly formula?: string
  /** Optional style edit (mirrors WorkbookStyleEdit). */
  readonly style?: unknown
  /** Optional rich-text runs (mirrors WorkbookRichRun[]). */
  readonly rich?: readonly unknown[]
  /** Reset the cell to the default style before applying `style`. */
  readonly styleReset?: boolean
}

/**
 * A structural operation (insert/delete/resize/hide/outline rows or columns).
 * Keyed by `sheetId` (domain), resolved to file sheet name by the service.
 *
 * This is a discriminated union matching the legacy `WorkbookStructuralOp`
 * schema (apps/sheets/src/shared/desktop-api.ts:771). The `kind` field
 * determines which other fields are present.
 */
export type SheetStructuralOp =
  | {
      readonly sheetId: string
      readonly kind: 'insert-rows' | 'remove-rows' | 'insert-cols' | 'remove-cols'
      readonly index: number
      readonly count: number
    }
  | {
      readonly sheetId: string
      readonly kind: 'move-rows'
      readonly index: number
      readonly count: number
      readonly before: number
    }
  | {
      readonly sheetId: string
      readonly kind: 'merge-cells' | 'unmerge-cells'
      readonly range: unknown
    }
  | {
      readonly sheetId: string
      readonly kind: 'set-row-size' | 'set-col-size'
      readonly start: number
      readonly end: number
      readonly size: number | null
    }
  | {
      readonly sheetId: string
      readonly kind: 'set-rows-hidden' | 'set-cols-hidden'
      readonly start: number
      readonly end: number
      readonly hidden: boolean
    }
  | {
      readonly sheetId: string
      readonly kind: 'set-rows-outline' | 'set-cols-outline'
      readonly start: number
      readonly end: number
      readonly level: number
      readonly collapsed?: boolean
    }

// ── Sheet-level mutations ───────────────────────────────────────────

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

// ── Per-sheet state ─────────────────────────────────────────────────

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

// ── Additions (new objects) ─────────────────────────────────────────

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

// ── Workbook-level mutations ────────────────────────────────────────

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

// ── SavePlan ────────────────────────────────────────────────────────

/**
 * The domain save plan — preserves ALL renderer-independent Sheets mutation
 * families. Mirrors the legacy `WorkbookSaveRequest` (apps/sheets/src/shared/
 * desktop-api.ts:1476) but as domain types, not Zod schemas.
 *
 * Every field keyed by `sheetId` is resolved to the file sheet name by the
 * service (using `session.sheetNames`) before delegation. Unknown sheetIds
 * → `InvalidInputError` (fail-closed).
 *
 * The engine accepts this plan via `SpreadsheetEngine.applySavePlan(handle, plan)`
 * and internally translates it to its own archive format. The runtime-
 * independent contract does NOT expose any engine-specific archive type.
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
