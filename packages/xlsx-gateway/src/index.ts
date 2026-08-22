/**
 * @genoffice/xlsx-gateway — canonical XLSX planning implementation.
 *
 * This package owns the pure SavePlan → archive-patch translation logic
 * used by both apps/sheets and packages/platform-electron.
 *
 * The authoritative entry point is `planCellEditsToXlsx` (in src/gateway/
 * xlsx-gateway.ts), which accepts an EntrySource + mutation families and
 * produces a MutationPlan (replaced/added/addedBinary/removedEntries/
 * addedEntries/touchedEntries).
 *
 * ZERO Electron imports. ZERO node:* imports (except jszip for the
 * in-memory EntrySource). ZERO apps/sheets imports.
 */

// ── Gateway planning ──
export {
  planCellEditsToXlsx,
  applyPlanToXlsx,
  applyCellEditsToXlsx,
  createBufferEntrySource,
  assembleWithJsZip,
  readBasicWorkbook,
  inventoryXlsx,
  mutateXlsxFile,
  writeXlsxAtomically,
  syncFileBestEffort,
  sha256,
  toA1Address,
  assertOnlyTouchedEntriesChanged,
  type CellEdit,
  type EntrySource,
  type MutationPlan,
  type XlsxMutation,
  type PackageEntry,
  type ImportedXlsx,
  type SheetStructuralOps,
  type SheetHyperlinkEdits,
  type SheetCfState,
  type SheetDvState,
  type SheetProtectionState,
  type SheetProtectedRangesState,
  type SheetFormulaValues,
  type SheetNoteState,
  type SheetVisualAddition,
  type SheetTableAddition,
  type SheetPivotAddition,
  type SheetSparklineAddition,
  type PivotRefreshUpdate,
} from './gateway/xlsx-gateway.js'

// ── Gateway types (previously from apps/sheets/src/shared/desktop-api) ──
export type {
  HexColor,
  EditableBorderStyle,
  StyleEditBorder,
  WorkbookStyleEdit,
  WorkbookRichRun,
  DrawingAnchor,
  ChartSeriesSetEntry,
  ChartSeriesEdit,
  ChartAxisTitles,
  ChartValueAxis,
  WorkbookChartEdit,
  WorkbookVisualEdit,
} from './types.js'

// ── Sheet edit plan ──
export type { SheetEditPlan, SheetAllocation } from './gateway/xlsx-sheets.js'
export { SheetEditError, validateSheetName } from './gateway/xlsx-sheets.js'

// ── Structural ops ──
export type { StructuralOp, AxisAttributeOp } from './gateway/xlsx-structure.js'

// ── Filter state ──
export type { SheetFilterState } from './gateway/xlsx-filter.js'

// ── Defined names ──
export type { DefinedNamesState } from './gateway/xlsx-defined-names.js'
export { DefinedNameError } from './gateway/xlsx-defined-names.js'

// ── Page setup ──
export type { SheetPageSetupState } from './gateway/xlsx-page-setup.js'

// ── Theme ──
export type { WorkbookThemeState } from './gateway/xlsx-theme.js'

// ── Package I/O (sidecar streaming save) ──
export {
  saveWorkbookViaSidecar,
  readArchiveEntryText,
  assertManifestPreserved,
  type ArchiveClient,
  type ArchiveEntry,
  type StreamingSaveRequest,
  type StreamingSaveResult,
} from './gateway/xlsx-package-io.js'

// ── Domain types (used by the gateway) ──
export type {
  CellScalar,
  CellState,
  CellFormatState,
  WorksheetState,
  WorkbookSnapshot,
  CellChange,
  SheetRename,
  StructuralChange,
  FormatChange,
  ChangePlan,
  ApplyOutcome,
  CommitReceipt,
  WorkbookAdapter,
} from './domain/workbook.types.js'

// ── Cell address utilities ──
export {
  columnIndex,
  columnLabel,
  formatAddress,
  parseAddress,
  parseRange,
  rangeCellCount,
} from './domain/cell-address.js'

// ── Shape types ──
export { ADDABLE_SHAPE_TYPES, type AddableShapeType } from './shared/shape-types.js'
