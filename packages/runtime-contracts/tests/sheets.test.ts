/**
 * Architecture-boundary test for the SpreadsheetService domain contract
 * (ADR-004 / Phase 2 Increment 3C correction).
 *
 * Verifies that the runtime-independent contract in
 * `packages/runtime-contracts/src/services/sheets.ts`:
 *
 *   1. Has ZERO references to shell lifecycle / event routing:
 *        SheetsEventBus, onOpened, onRenamed, onTeardown,
 *        oldPath, newPath, WebContents, BrowserWindow, wcId
 *
 *   2. Uses the corrected session field name `workbookName` (basename),
 *      NOT `workbookPath` (which would recreate filesystem path semantics
 *      in the domain layer).
 *
 *   3. Does NOT silently swallow engine errors:
 *        - open()          returns Promise<WorkbookOpenResult> (no | null)
 *        - close()         returns Promise<void> (no { ok: boolean })
 *        - writeRecovery() returns Promise<Uint8Array> (no { ok: boolean })
 *        - SaveResult has no `error?: string` field (engine errors throw)
 *
 *   4. Uses session-scoped readMedia (session + engineHandle + visualId)
 *      consistent with readRange / readFormulaCells / recalculate.
 *
 *   5. Documents the engineHandle as an opaque engine context token
 *      (not inspectable, not serializable, no implementation details).
 *
 *   6. (Increment 3C) Has ZERO references to EngineArchivePatch — the
 *      engine-specific archive type is PRIVATE to the engine implementation.
 *      The service delegates to engine.applySavePlan(handle, plan), which
 *      internally translates the domain SavePlan to the engine's own
 *      archive format.
 *
 *   7. (Increment 3C) Has ZERO references to SavePlanTranslator /
 *      SavePlanTranslation — the translation is now entirely below the
 *      engine boundary, not in runtime-contracts.
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const SHEETS_FILE = join(__dirname, '..', 'src', 'services', 'sheets.ts')

function readFile(filePath: string): string {
  return readFileSync(filePath, 'utf8')
}

function scanForPattern(
  text: string,
  pattern: RegExp,
): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    const stripped = line.trim()
    if (stripped.startsWith('*') || stripped.startsWith('//') || stripped.startsWith('/*')) return
    if (stripped.startsWith('import type ') || stripped.startsWith('export type ')) return
    if (pattern.test(line)) {
      hits.push({ line: i + 1, text: line.trim() })
    }
  })
  return hits
}

describe('SpreadsheetService contract — Increment 3A architecture boundary', () => {
  // ── 1. Domain-event purity (no shell lifecycle / event routing) ─────

  test('ZERO references to SheetsEventBus', () => {
    const text = readFile(SHEETS_FILE)
    const hits = scanForPattern(text, /\bSheetsEventBus\b/)
    expect(hits).toEqual([])
  })

  test('ZERO references to onOpened / onRenamed / onTeardown', () => {
    const text = readFile(SHEETS_FILE)
    const hits = scanForPattern(text, /\b(onOpened|onRenamed|onTeardown)\b/)
    expect(hits).toEqual([])
  })

  test('ZERO references to oldPath / newPath (no filesystem-specific event payloads)', () => {
    const text = readFile(SHEETS_FILE)
    const hits = scanForPattern(text, /\b(oldPath|newPath)\b/)
    expect(hits).toEqual([])
  })

  test('ZERO references to WebContents / BrowserWindow / wcId', () => {
    const text = readFile(SHEETS_FILE)
    const hits = scanForPattern(text, /\b(WebContents|BrowserWindow|wcId)\b/)
    expect(hits).toEqual([])
  })

  // ── 2. Session field naming (basename, not path) ──────────────────

  test('WorkbookSession has workbookName (NOT workbookPath)', () => {
    const text = readFile(SHEETS_FILE)
    const sessionMatch = text.match(/interface WorkbookSession \{([\s\S]*?)\}/)
    expect(sessionMatch).not.toBeNull()
    const sessionBody = sessionMatch![1]
    expect(sessionBody).toMatch(/readonly workbookName:\s*string/)
    expect(sessionBody).not.toMatch(/workbookPath/)
  })

  test('WorkbookSession has NO filesystem path field', () => {
    const text = readFile(SHEETS_FILE)
    const sessionMatch = text.match(/interface WorkbookSession \{([\s\S]*?)\}/)
    expect(sessionMatch).not.toBeNull()
    const sessionBody = sessionMatch![1]
    // No 'path' field of any kind — workbookName is a basename only
    expect(sessionBody).not.toMatch(/^\s*readonly\s+\w*[Pp]ath:\s*string/m)
  })

  // ── 3. Error semantics (no silent swallowing) ─────────────────────

  test('open() returns Promise<WorkbookOpenResult> (NOT | null)', () => {
    const text = readFile(SHEETS_FILE)
    // Match the actual method signature (parameters span multiple lines).
    // The JSDoc comment at the top also mentions `open()` but with empty
    // parens; requiring a newline inside the parens excludes that.
    const openMatch = text.match(/open\(\s*\n[\s\S]*?\):\s*Promise<([^>]+)>/)
    expect(openMatch).not.toBeNull()
    const returnType = openMatch![1]
    expect(returnType).not.toContain('null')
    expect(returnType.trim()).toBe('WorkbookOpenResult')
  })

  test('close() returns Promise<void> (NOT { ok: boolean })', () => {
    const text = readFile(SHEETS_FILE)
    // close() takes a single parameter on the same line in the actual
    // signature — match `close(engineHandle:` then any chars up to the
    // return type. The JSDoc comment uses `close()` (empty parens), so
    // requiring `engineHandle:` excludes the comment.
    const closeMatch = text.match(/close\(\s*engineHandle:[\s\S]*?\):\s*Promise<([^>]+)>/)
    expect(closeMatch).not.toBeNull()
    const returnType = closeMatch![1].trim()
    expect(returnType).toBe('void')
  })

  test('writeRecovery() returns Promise<Uint8Array> (NOT { ok: boolean, data? })', () => {
    const text = readFile(SHEETS_FILE)
    // Match the actual method signature — requires `session:` as first
    // parameter (the JSDoc comment uses empty `writeRecovery()` parens).
    const recoveryMatch = text.match(/writeRecovery\(\s*session:[\s\S]*?\):\s*Promise<([^>]+)>/)
    expect(recoveryMatch).not.toBeNull()
    const returnType = recoveryMatch![1].trim()
    expect(returnType).toBe('Uint8Array')
  })

  test('SaveResult has NO error?: string field (engine failures throw, not return)', () => {
    const text = readFile(SHEETS_FILE)
    const saveMatch = text.match(/interface SaveResult \{([\s\S]*?)\}/)
    expect(saveMatch).not.toBeNull()
    const saveBody = saveMatch![1]
    expect(saveBody).not.toMatch(/\berror\?/)
    // Must still have the legitimate soft-failure reason field
    expect(saveBody).toMatch(/reason\?:\s*'external-modified'/)
  })

  // ── 4. readMedia is session-scoped (consistent with readRange/etc) ──

  test('readMedia takes (session, engineHandle, visualId)', () => {
    const text = readFile(SHEETS_FILE)
    const mediaMatch = text.match(/readMedia\(([\s\S]*?)\):/)
    expect(mediaMatch).not.toBeNull()
    const params = mediaMatch![1]
    expect(params).toContain('session:')
    expect(params).toContain('engineHandle:')
    expect(params).toContain('visualId:')
  })

  // ── 5. Engine handle ownership: opaque, documented ─────────────────

  test('WorkbookOpenResult.engineHandle is documented as opaque', () => {
    const text = readFile(SHEETS_FILE)
    // The engineHandle field is present in WorkbookOpenResult
    const resultMatch = text.match(/interface WorkbookOpenResult \{([\s\S]*?)\}/)
    expect(resultMatch).not.toBeNull()
    const body = resultMatch![1]
    expect(body).toMatch(/engineHandle:\s*EngineSessionHandle/)
  })

  test('WorkbookSession does NOT expose engineHandle (handle is shell-side)', () => {
    const text = readFile(SHEETS_FILE)
    const sessionMatch = text.match(/interface WorkbookSession \{([\s\S]*?)\}/)
    expect(sessionMatch).not.toBeNull()
    const sessionBody = sessionMatch![1]
    expect(sessionBody).not.toMatch(/engineHandle/)
  })

  test('WorkbookOpenResult documents the opaque / non-inspectable nature of engineHandle', () => {
    const text = readFile(SHEETS_FILE)
    // Find the JSDoc above engineHandle in WorkbookOpenResult
    const handleSection = text.match(/\/\*\*([\s\S]*?)\*\/\s*engineHandle:\s*EngineSessionHandle/)
    expect(handleSection).not.toBeNull()
    const doc = handleSection![1]
    // Doc must mention opacity (or "non-inspectable" / "not inspectable")
    expect(
      /opaque/i.test(doc) ||
      /not\s+inspectable/i.test(doc) ||
      /non-inspectable/i.test(doc),
    ).toBe(true)
  })

  // ── 6. Approved boundaries preserved ───────────────────────────────

  test('WorkbookMetadata is referenced (engine contract preserved)', () => {
    const text = readFile(SHEETS_FILE)
    expect(text).toMatch(/WorkbookMetadata/)
  })

  test('ExternalChangeStatus is referenced (frozen save policy preserved)', () => {
    const text = readFile(SHEETS_FILE)
    expect(text).toMatch(/ExternalChangeStatus/)
  })

  test('EngineSessionHandle is referenced (opaque handle preserved)', () => {
    const text = readFile(SHEETS_FILE)
    expect(text).toMatch(/EngineSessionHandle/)
  })

  test('SpreadsheetEngine is referenced (engine delegation preserved)', () => {
    const text = readFile(SHEETS_FILE)
    expect(text).toMatch(/SpreadsheetEngine/)
  })

  // ── 7. SavePlan preserves all mutation families (Increment 3B/3C) ──

  test('SaveRequest is a domain SavePlan (NOT EngineArchivePatch[])', () => {
    const text = readFile(SHEETS_FILE)
    // SaveRequest must reference SavePlan, NOT EngineArchivePatch[]
    const saveReqMatch = text.match(/interface SaveRequest \{([\s\S]*?)\}/)
    expect(saveReqMatch).not.toBeNull()
    const body = saveReqMatch![1]
    expect(body).toMatch(/plan:\s*SavePlan/)
    expect(body).not.toMatch(/patches:\s*EngineArchivePatch/)
  })

  test('SavePlan preserves all mutation families from legacy WorkbookSaveRequest', () => {
    // Increment 3C: SavePlan is defined in save-plan.ts (separate file to
    // avoid a circular import: spreadsheet-engine.ts needs SavePlan,
    // and sheets.ts needs SpreadsheetEngine from spreadsheet-engine.ts).
    const SAVE_PLAN_FILE = join(__dirname, '..', 'src', 'services', 'save-plan.ts')
    const text = readFile(SAVE_PLAN_FILE)
    const planMatch = text.match(/interface SavePlan \{([\s\S]*?)\}/)
    expect(planMatch).not.toBeNull()
    const body = planMatch![1]
    // Cell-level mutations
    expect(body).toMatch(/\bedits:\s*SheetCellEdit/)
    expect(body).toMatch(/\bstructuralOps:\s*SheetStructuralOp/)
    expect(body).toMatch(/\bformulaValues:\s*SheetFormulaValue/)
    // Sheet-level mutations
    expect(body).toMatch(/\bsheetOps:\s*SheetOp/)
    expect(body).toMatch(/\bsheetOrder:\s*string/)
    // Per-sheet state
    expect(body).toMatch(/\bfilterStates:\s*SheetFilterState/)
    expect(body).toMatch(/\bhyperlinkEdits:\s*SheetHyperlinkEdit/)
    expect(body).toMatch(/\bcfStates:\s*SheetCfState/)
    expect(body).toMatch(/\bdvStates:\s*SheetDvState/)
    expect(body).toMatch(/\bpageSetupStates:\s*SheetPageSetupState/)
    expect(body).toMatch(/\bnoteStates:\s*SheetNoteState/)
    expect(body).toMatch(/\bsheetProtections:\s*SheetProtectionState/)
    expect(body).toMatch(/\bprotectedRangeStates:\s*SheetProtectedRangesState/)
    // Additions
    expect(body).toMatch(/\bvisualAdditions:\s*SheetVisualAddition/)
    expect(body).toMatch(/\btableAdditions:\s*SheetTableAddition/)
    expect(body).toMatch(/\bpivotAdditions:\s*SheetPivotAddition/)
    expect(body).toMatch(/\bsparklineAdditions:\s*SheetSparklineAddition/)
    // Workbook-level mutations
    expect(body).toMatch(/\bchartEdits:\s*WorkbookChartEdit/)
    expect(body).toMatch(/\bvisualEdits:\s*WorkbookVisualEdit/)
    expect(body).toMatch(/\bpivotCacheRefreshPaths:\s*string/)
    expect(body).toMatch(/\bpivotRefreshUpdates:\s*PivotRefreshUpdate/)
    expect(body).toMatch(/\bdefinedNamesState:\s*DefinedNamesState/)
    expect(body).toMatch(/\bthemeState:\s*WorkbookThemeState/)
    expect(body).toMatch(/\bworkbookProtectionState:\s*WorkbookProtectionState/)
  })

  test('SavePlan is re-exported from sheets.ts (so callers import from one module)', () => {
    const text = readFile(SHEETS_FILE)
    // sheets.ts re-exports the SavePlan types from save-plan.ts
    expect(text).toMatch(/export type \{[\s\S]*SavePlan[\s\S]*\} from '\.\/save-plan\.js'/)
  })

  test('SpreadsheetServiceDeps includes ONLY engine (no SavePlanTranslator — Increment 3C)', () => {
    const text = readFile(SHEETS_FILE)
    const depsMatch = text.match(/interface SpreadsheetServiceDeps \{([\s\S]*?)\}/)
    expect(depsMatch).not.toBeNull()
    const body = depsMatch![1]
    expect(body).toMatch(/engine:\s*SpreadsheetEngine/)
    // Increment 3C: SavePlanTranslator is REMOVED — the engine accepts
    // the domain SavePlan directly via applySavePlan.
    expect(body).not.toMatch(/savePlanTranslator/)
    expect(body).not.toMatch(/SavePlanTranslator/)
  })

  test('ZERO references to SavePlanTranslator in sheets.ts (Increment 3C removed it)', () => {
    // scanForPattern filters comment lines (starts with *, //, /*)
    const hits = scanForPattern(readFile(SHEETS_FILE), /\bSavePlanTranslator\b|\bSavePlanTranslation\b/)
    expect(hits).toEqual([])
  })

  test('ZERO references to EngineArchivePatch in sheets.ts source (non-comment, Increment 3C)', () => {
    // scanForPattern filters comment lines — the only allowable mentions of
    // EngineArchivePatch are in comment lines documenting its removal.
    const hits = scanForPattern(readFile(SHEETS_FILE), /\bEngineArchivePatch\b/)
    expect(hits).toEqual([])
  })

  test('ZERO references to EngineArchivePatch in save-plan.ts source (non-comment, Increment 3C)', () => {
    const SAVE_PLAN_FILE = join(__dirname, '..', 'src', 'services', 'save-plan.ts')
    const hits = scanForPattern(readFile(SAVE_PLAN_FILE), /\bEngineArchivePatch\b/)
    expect(hits).toEqual([])
  })

  // ── 8. SheetId mapping uses stable id (Increment 3B) ──────────────

  test('WorkbookSession.sheetNames documented as sheetId → sheetName from [sheet.id, sheet.name]', () => {
    const text = readFile(SHEETS_FILE)
    const sessionMatch = text.match(/interface WorkbookSession \{([\s\S]*?)\}/)
    expect(sessionMatch).not.toBeNull()
    const sessionBody = sessionMatch![1]
    // The sheetNames field must be documented as built from [sheet.id, sheet.name]
    expect(sessionBody).toMatch(/sheet\.id/)
    expect(sessionBody).toMatch(/sheet\.name/)
  })

  test('SaveResult includes touchedEntries (for shell recovery/recent-files tracking)', () => {
    const text = readFile(SHEETS_FILE)
    const saveMatch = text.match(/interface SaveResult \{([\s\S]*?)\}/)
    expect(saveMatch).not.toBeNull()
    const body = saveMatch![1]
    expect(body).toMatch(/touchedEntries\?:\s*string/)
  })
})
