/**
 * Runtime validators for sidecar responses.
 *
 * Every sidecar response arrives as `unknown` from JSON.parse. These
 * validators perform runtime type checking before constructing typed
 * domain results. Malformed responses produce EngineError('PROTOCOL_ERROR').
 */

import type {
  EngineRangeResult,
  EngineCellRecord,
  EngineCellArea,
  EngineRowMetadata,
  EngineColumnMetadata,
  EngineFormulaCellsResult,
  EngineFormulaCell,
  EngineRecalcResult,
  EngineRecalcCell,
  EngineMediaResult,
  WorksheetMetadata,
  WorkbookMetadata,
} from '@genoffice/runtime-contracts'
import { EngineError, InvalidInputError } from '@genoffice/runtime-contracts'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function isString(v: unknown): v is string {
  return typeof v === 'string'
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean'
}
function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v)
}
function opt<T>(v: unknown, check: (x: unknown) => x is T): T | undefined {
  return check(v) ? v : undefined
}

// ── Open result ───────────────────────────────────────────────────────

export interface ValidatedOpenResult {
  sessionId: string
  sha256: string
  entryCount: number
  sheets: WorksheetMetadata[]
  activeTab: number
  definedNames: Array<{ name: string; value: string }>
  themeColors: string[]
  themeFonts: { major: string; minor: string }
}

export function validateOpenResult(raw: unknown): ValidatedOpenResult {
  if (!isRecord(raw)) throw new EngineError('Invalid open response: not an object', 'PROTOCOL_ERROR')
  const sessionId = raw.sessionId
  if (!isString(sessionId)) throw new EngineError('Invalid open response: missing sessionId', 'PROTOCOL_ERROR')
  const sha256 = isString(raw.sha256) ? raw.sha256 : ''
  const entryCount = isNumber(raw.entryCount) ? raw.entryCount : 0
  const activeTab = isNumber(raw.activeTab) ? raw.activeTab : 0
  const definedNames = isArray(raw.definedNames)
    ? raw.definedNames.map((d, i) => {
        if (!isRecord(d) || !isString(d.name) || !isString(d.value))
          throw new EngineError(`Invalid open response: definedNames[${i}] malformed`, 'PROTOCOL_ERROR')
        return { name: d.name, value: d.value }
      })
    : []
  const themeColors = isArray(raw.themeColors) ? raw.themeColors.filter(isString) : []
  const themeFontsRaw = isRecord(raw.themeFonts) ? raw.themeFonts : {}
  const themeFonts = {
    major: isString(themeFontsRaw.major) ? themeFontsRaw.major : '',
    minor: isString(themeFontsRaw.minor) ? themeFontsRaw.minor : '',
  }
  const sheetsRaw = isArray(raw.sheets) ? raw.sheets : []
  const sheets: WorksheetMetadata[] = sheetsRaw.map((s, i) => {
    if (!isRecord(s)) throw new EngineError(`Invalid open response: sheets[${i}] not a record`, 'PROTOCOL_ERROR')
    if (!isString(s.name)) throw new EngineError(`Invalid open response: sheets[${i}].name`, 'PROTOCOL_ERROR')
    // Increment 3C: FAIL-CLOSED on missing/non-string sheets[].id.
    // The runtime contract requires a stable WorksheetMetadata.id (the XLSX
    // sheetId attribute, immutable across renames). A sidecar binary that
    // does not return `id` is PROTOCOL-INCOMPATIBLE — we do NOT silently
    // fall back to the sheet name (that recreates the broken 3A mapping).
    // The caller gets an EngineError(PROTOCOL_ERROR) and must update the
    // sidecar binary.
    if (!isString(s.id)) throw new EngineError(`Invalid open response: sheets[${i}].id (missing or non-string)`, 'PROTOCOL_ERROR')
    return {
      id: s.id,
      name: s.name,
      index: i,
      hidden: opt(s.hidden, isBoolean) ?? false,
      rtl: opt(s.rtl, isBoolean) ?? false,
      gridlineColor: opt(s.gridlineColor, isString),
      showGridlines: opt(s.showGridlines, isBoolean) ?? true,
      rowCount: opt(s.rowCount, isNumber) ?? 0,
      columnCount: opt(s.columnCount, isNumber) ?? 0,
      defaultRowHeight: opt(s.defaultRowHeight, isNumber) ?? 15,
      defaultColumnWidth: opt(s.defaultColumnWidth, isNumber) ?? 8.43,
      tabColor: opt(s.tabColor, isString),
    }
  })
  return { sessionId, sha256, entryCount, sheets, activeTab, definedNames, themeColors, themeFonts }
}

export function buildWorkbookMetadata(v: ValidatedOpenResult, fileName: string): WorkbookMetadata {
  return {
    name: fileName,
    sha256: v.sha256,
    entryCount: v.entryCount,
    sheets: v.sheets,
    activeTab: v.activeTab,
    definedNames: v.definedNames,
    themeColors: v.themeColors,
    themeFonts: v.themeFonts,
  }
}

// ── Range result ──────────────────────────────────────────────────────

export function validateRangeResult(raw: unknown): EngineRangeResult {
  if (!isRecord(raw)) throw new EngineError('Invalid range response: not an object', 'PROTOCOL_ERROR')
  const cells = isArray(raw.cells) ? raw.cells.map(validateCellRecord) : []
  const rows = isArray(raw.rows) ? raw.rows.map(validateRowMetadata) : []
  const merges = isArray(raw.merges) ? raw.merges.map(validateCellArea) : []
  const columns = isArray(raw.columns) ? raw.columns.map(validateColumnMetadata) : []
  // INCREMENT 5B (build-fix): The sidecar returns hyperlinks as
  // { row, column, target } (not { cell, target }). The engine contract
  // uses { cell, target }, so we convert row+column → A1 notation.
  // Without this fix, every hyperlink would be rejected as malformed.
  const hyperlinks = isArray(raw.hyperlinks)
    ? raw.hyperlinks.map((h, i) => {
        if (!isRecord(h)) throw new EngineError(`Invalid range response: hyperlinks[${i}]`, 'PROTOCOL_ERROR')
        if (isString(h.cell) && isString(h.target)) {
          return { cell: h.cell, target: h.target }
        }
        // Sidecar's native shape: { row, column, target }
        if (isNumber(h.row) && isNumber(h.column) && isString(h.target)) {
          return { cell: cellRefFromRowCol(h.row, h.column), target: h.target }
        }
        throw new EngineError(`Invalid range response: hyperlinks[${i}]`, 'PROTOCOL_ERROR')
      })
    : []
  // INCREMENT 5B (build-fix): The sidecar returns `conditionalRules` and
  // `dataValidations` (plural), not `conditionalFormatting` and
  // `dataValidation` (singular). Read the correct field names so the data
  // is preserved (the engine contract stores them as `unknown[]` — the
  // field name in the contract stays the same, only the source field
  // changes).
  const conditionalFormatting = isArray(raw.conditionalRules)
    ? raw.conditionalRules
    : (isArray(raw.conditionalFormatting) ? raw.conditionalFormatting : [])
  const dataValidation = isArray(raw.dataValidations)
    ? raw.dataValidations
    : (isArray(raw.dataValidation) ? raw.dataValidation : [])
  const rowBreaks = isArray(raw.rowBreaks) ? raw.rowBreaks.filter(isNumber) : []
  const columnBreaks = isArray(raw.columnBreaks) ? raw.columnBreaks.filter(isNumber) : []
  const sheetProtection = opt(raw.sheetProtection, isBoolean) ?? false
  const autoFilter = isRecord(raw.autoFilter)
    ? {
        startRow: opt(raw.autoFilter.startRow, isNumber) ?? 0,
        startColumn: opt(raw.autoFilter.startColumn, isNumber) ?? 0,
        endRow: opt(raw.autoFilter.endRow, isNumber) ?? 0,
        endColumn: opt(raw.autoFilter.endColumn, isNumber) ?? 0,
      }
    : undefined
  return { cells, rows, merges, columns, hyperlinks, conditionalFormatting, dataValidation, autoFilter, rowBreaks, columnBreaks, sheetProtection }
}

/** Convert 0-indexed (row, column) to A1 notation (e.g. (0, 0) → "A1"). */
function cellRefFromRowCol(row: number, column: number): string {
  let col = ''
  let n = column + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    col = String.fromCharCode(65 + rem) + col
    n = Math.floor((n - 1) / 26)
  }
  return `${col}${row + 1}`
}

function validateCellRecord(raw: unknown): EngineCellRecord {
  if (!isRecord(raw)) throw new EngineError('Invalid range response: cell record', 'PROTOCOL_ERROR')
  if (!isNumber(raw.row)) throw new EngineError('Invalid range response: cell.row', 'PROTOCOL_ERROR')
  if (!isNumber(raw.column)) throw new EngineError('Invalid range response: cell.column', 'PROTOCOL_ERROR')
  // INCREMENT 5B (build-fix): The sidecar returns `value` as a typed scalar
  // (string | number | boolean | null). The engine contract has `value: string`
  // AND `number?: number` — the validator converts the typed value to a
  // string AND captures the raw numeric value in `number`. Without this fix,
  // numeric cells (e.g. 10.0) were converted to empty string ('') because
  // `opt(raw.value, isString)` returned undefined for non-string values.
  const rawValue = raw.value
  let value: string
  let number: number | undefined
  if (isString(rawValue)) {
    value = rawValue
    number = opt(raw.number, isNumber)
  } else if (isNumber(rawValue)) {
    value = String(rawValue)
    number = rawValue
  } else if (isBoolean(rawValue)) {
    value = String(rawValue)
    number = undefined
  } else {
    // null, undefined, or other — empty string
    value = ''
    number = undefined
  }
  return {
    row: raw.row,
    column: raw.column,
    value,
    number,
    isFormula: opt(raw.isFormula, isBoolean) ?? false,
    styleIndex: opt(raw.styleIndex, isNumber) ?? 0,
    hyperlink: opt(raw.hyperlink, isString),
  }
}

function validateRowMetadata(raw: unknown): EngineRowMetadata {
  if (!isRecord(raw) || !isNumber(raw.row)) throw new EngineError('Invalid range response: row metadata', 'PROTOCOL_ERROR')
  return {
    row: raw.row,
    height: opt(raw.height, isNumber),
    customHeight: opt(raw.customHeight, isBoolean),
    hidden: opt(raw.hidden, isBoolean) ?? false,
    outlineLevel: opt(raw.outlineLevel, isNumber),
    collapsed: opt(raw.collapsed, isBoolean),
    styleIndex: opt(raw.styleIndex, isNumber),
  }
}

function validateColumnMetadata(raw: unknown): EngineColumnMetadata {
  if (!isRecord(raw) || !isNumber(raw.column)) throw new EngineError('Invalid range response: column metadata', 'PROTOCOL_ERROR')
  return {
    column: raw.column,
    width: opt(raw.width, isNumber),
    customWidth: opt(raw.customWidth, isBoolean),
    hidden: opt(raw.hidden, isBoolean) ?? false,
    outlineLevel: opt(raw.outlineLevel, isNumber),
    collapsed: opt(raw.collapsed, isBoolean),
    styleIndex: opt(raw.styleIndex, isNumber),
  }
}

function validateCellArea(raw: unknown): EngineCellArea {
  if (!isRecord(raw)) throw new EngineError('Invalid range response: merge area', 'PROTOCOL_ERROR')
  if (!isNumber(raw.firstRow) || !isNumber(raw.firstColumn) || !isNumber(raw.lastRow) || !isNumber(raw.lastColumn))
    throw new EngineError('Invalid range response: merge bounds', 'PROTOCOL_ERROR')
  return { firstRow: raw.firstRow, firstColumn: raw.firstColumn, lastRow: raw.lastRow, lastColumn: raw.lastColumn }
}

// ── Formula cells result ─────────────────────────────────────────────

export function validateFormulaCellsResult(raw: unknown): EngineFormulaCellsResult {
  if (!isRecord(raw)) throw new EngineError('Invalid formula cells response', 'PROTOCOL_ERROR')
  const cells = isArray(raw.cells) ? raw.cells.map(validateFormulaCell) : []
  return { cells }
}

function validateFormulaCell(raw: unknown): EngineFormulaCell {
  if (!isRecord(raw) || !isNumber(raw.row) || !isNumber(raw.column))
    throw new EngineError('Invalid formula cells response: cell', 'PROTOCOL_ERROR')
  const result: EngineFormulaCell = {
    row: raw.row,
    column: raw.column,
    formula: opt(raw.formula, isString) ?? '',
  }
  const cv = opt(raw.cachedValue, isString)
  if (cv !== undefined) result.cachedValue = cv
  return result
}

// ── Recalc result ─────────────────────────────────────────────────────

export function validateRecalcResult(raw: unknown): EngineRecalcResult {
  if (!isRecord(raw)) throw new EngineError('Invalid recalc response', 'PROTOCOL_ERROR')
  const cells = isArray(raw.cells) ? raw.cells.map(validateRecalcCell) : []
  return { cells }
}

function validateRecalcCell(raw: unknown): EngineRecalcCell {
  if (!isRecord(raw)) throw new EngineError('Invalid recalc response: cell', 'PROTOCOL_ERROR')
  const result: EngineRecalcCell = {
    sheetName: opt(raw.sheet, isString) ?? '',
    row: opt(raw.row, isNumber) ?? 0,
    column: opt(raw.column, isNumber) ?? 0,
    formatted: opt(raw.formatted, isString) ?? '',
    isFormula: opt(raw.isFormula, isBoolean) ?? false,
  }
  const num = opt(raw.number, isNumber)
  if (num !== undefined) result.number = num
  return result
}

// ── Media result ──────────────────────────────────────────────────────

export function validateMediaResult(raw: unknown): EngineMediaResult {
  if (!isRecord(raw)) throw new EngineError('Invalid media response', 'PROTOCOL_ERROR')
  if (!isString(raw.mediaType) || !isString(raw.base64))
    throw new EngineError('Invalid media response: missing mediaType or base64', 'PROTOCOL_ERROR')
  return { mediaType: raw.mediaType, base64: raw.base64 }
}
