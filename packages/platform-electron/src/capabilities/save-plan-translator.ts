/**
 * SavePlanTranslator — translates a domain SavePlan to engine-internal
 * EngineArchivePatch[] by delegating to the legacy `planCellEditsToXlsx`
 * planning logic (the behavioral source of truth).
 *
 * ARCHITECTURE (Increment 3D):
 *   The translator lives in packages/platform-electron/ — below the
 *   runtime-independent boundary. It imports the legacy gateway planning
 *   function via the `@genoffice/xlsx-gateway` path alias (pointing to
 *   apps/sheets/src/gateway/xlsx-gateway.ts). This is the AUTHORITATIVE
 *   implementation — the translator does NOT invent a new XLSX mutation
 *   algorithm.
 *
 *   The translator:
 *     1. Resolves domain sheetIds → file sheet names (fail-closed).
 *     2. Builds the gateway-style mutation types (CellEdit[],
 *        SheetStructuralOps[], SheetEditPlan, etc.) — mirroring the
 *        legacy `writeWorkbookTo` at sheets-main.ts:2511-2762.
 *     3. Calls `planCellEditsToXlsx` with an EntrySource (abstract
 *        archive reader backed by the sidecar).
 *     4. Converts the resulting MutationPlan to EngineArchivePatch[] +
 *        touchedEntries + removedEntries + addedEntries.
 *
 * SHEET-ID SEMANTICS:
 *   The translator consumes `sheetId → sheetName` from the domain
 *   session mapping. It does NOT use `sheetName → sheetName` or infer
 *   sheet identity from array ordering. Unknown sheetIds →
 *   InvalidInputError before generating patches.
 *
 * SAVE ORDERING:
 *   The translator delegates to `planCellEditsToXlsx` which preserves
 *   the legacy save ordering (structural sheet operations → sheet XML
 *   edits → formula values → relationships → workbook metadata →
 *   defined names → theme/protection). The translator does NOT reorder.
 *
 * TYPE BOUNDARY:
 *   The domain SavePlan types (in runtime-contracts/save-plan.ts) use
 *   `unknown` for complex fields to avoid leaking engine types. The
 *   gateway types are strict discriminated unions. The translator casts
 *   through `unknown` at the boundary — the renderer's Zod validation
 *   (apps/sheets/src/shared/desktop-api.ts) guarantees the runtime shape
 *   matches the gateway's expectations.
 */

import type { SavePlan } from '@genoffice/runtime-contracts'
import { InvalidInputError } from '@genoffice/runtime-contracts'

// Import the legacy gateway types and planning function.
// These are the AUTHORITATIVE implementations — the translator does NOT
// reinvent XLSX mutation. The path alias maps to
// apps/sheets/src/gateway/xlsx-gateway.ts.
import type {
  CellEdit,
  EntrySource,
  MutationPlan,
  SheetStructuralOps,
  SheetHyperlinkEdits,
  SheetCfState,
  SheetDvState,
  SheetProtectionState,
  SheetProtectedRangesState,
  SheetFormulaValues,
  SheetNoteState,
  SheetVisualAddition,
  SheetTableAddition,
  SheetPivotAddition,
  SheetSparklineAddition,
  PivotRefreshUpdate,
} from '@genoffice/xlsx-gateway'
import type { StructuralOp } from '@genoffice/xlsx-structure'
import type { SheetFilterState } from '@genoffice/xlsx-filter'
import type { SheetEditPlan } from '@genoffice/xlsx-sheets'
import type { DefinedNamesState } from '@genoffice/xlsx-defined-names'
import type { SheetPageSetupState } from '@genoffice/xlsx-page-setup'
import type { WorkbookThemeState } from '@genoffice/xlsx-theme'
import type { WorkbookChartEdit, WorkbookVisualEdit } from '@genoffice/sheets-shared'
import { planCellEditsToXlsx } from '@genoffice/xlsx-gateway'

// ── Internal types ────────────────────────────────────────────────────

/**
 * INTERNAL engine archive-patch type (Increment 3C/3D).
 *
 * This type is PRIVATE to the engine implementation — it does NOT appear
 * in runtime-contracts. Represents one entry to replace or add in the
 * archive, with either text or binary content.
 */
export interface EngineArchivePatch {
  /** The ZIP entry path within the archive (e.g., 'xl/worksheets/sheet1.xml'). */
  readonly entryPath: string
  /** The new content for the entry (UTF-8 string for XML, raw bytes for media). */
  readonly content: string | Uint8Array
}

/**
 * Result of translating a SavePlan to engine archive patches.
 */
export interface SavePlanTranslation {
  /** The engine archive patches to apply (replace + add). */
  readonly patches: EngineArchivePatch[]
  /** Entry paths that were touched (for the save result). */
  readonly touchedEntries: string[]
  /** Entry paths that should be removed from the archive. */
  readonly removedEntries: string[]
  /** Entry paths that are newly added (distinct from replacements). */
  readonly addedEntries: string[]
}

// ── Translator ────────────────────────────────────────────────────────

/**
 * Translate a domain SavePlan to engine archive patches by delegating to
 * the legacy `planCellEditsToXlsx` planning logic.
 *
 * @param plan — the domain save plan (sheetOps, edits, structuralOps, etc.)
 * @param sheetNames — the resolved sheetId → file sheet name map
 * @param source — abstract archive reader (backed by the sidecar)
 * @returns the engine archive patches + touched/removed/added entries
 *
 * THROWS:
 *   - InvalidInputError — unknown sheetId in any mutation family
 *   - Error — planning failure (e.g. conflicting mutations, missing entries)
 */
export async function translateSavePlan(
  plan: SavePlan,
  sheetNames: ReadonlyMap<string, string>,
  source: EntrySource,
): Promise<SavePlanTranslation> {
  // ── 1. Resolve sheetIds → sheetNames (mirrors writeWorkbookTo) ──

  // Added sheet tracking (add-sheet / duplicate-sheet introduce NEW sheetIds
  // not in the session map; the legacy runtime tracks them in addedSheetNames).
  const addedSheetNames = new Map<string, string>()
  const duplicateSources = new Map<string, string>()
  const renames: { sheetName: string; newName: string }[] = []
  const removals: string[] = []
  const hiddenChanges: { sheetName: string; hidden: boolean }[] = []
  let orderChanged = false

  for (const op of plan.sheetOps) {
    if (op.kind === 'add-sheet') {
      if (op.name === undefined) throw new InvalidInputError(`add-sheet op missing name: ${op.sheetId}`)
      addedSheetNames.set(op.sheetId, op.name)
      continue
    }
    if (op.kind === 'duplicate-sheet') {
      if (op.name === undefined) throw new InvalidInputError(`duplicate-sheet op missing name: ${op.sheetId}`)
      if (op.sourceSheetId === undefined) throw new InvalidInputError(`duplicate-sheet op missing sourceSheetId: ${op.sheetId}`)
      const sourceName = sheetNames.get(op.sourceSheetId)
      if (sourceName === undefined) {
        throw new InvalidInputError(`Unknown duplicate source sheetId: ${op.sourceSheetId}`)
      }
      addedSheetNames.set(op.sheetId, op.name)
      duplicateSources.set(op.sheetId, sourceName)
      continue
    }
    if (op.kind === 'reorder-sheets') {
      orderChanged = true
      continue
    }
    // rename-sheet / remove-sheet / set-sheet-hidden: sheetId must exist
    const sheetName = addedSheetNames.get(op.sheetId) ?? sheetNames.get(op.sheetId)
    if (sheetName === undefined) {
      throw new InvalidInputError(`Unknown sheetId in sheet op (${op.kind}): ${op.sheetId}`)
    }
    if (op.kind === 'rename-sheet') {
      if (op.newName === undefined) throw new InvalidInputError(`rename-sheet op missing newName: ${op.sheetId}`)
      renames.push({ sheetName, newName: op.newName })
    } else if (op.kind === 'set-sheet-hidden') {
      if (op.hidden === undefined) throw new InvalidInputError(`set-sheet-hidden op missing hidden: ${op.sheetId}`)
      hiddenChanges.push({ sheetName, hidden: op.hidden })
    } else if (op.kind === 'remove-sheet') {
      removals.push(sheetName)
    }
  }

  const renameByOriginal = new Map(renames.map((r) => [r.sheetName, r.newName]))
  const resolveSheetName = (sheetId: string): string => {
    const name = addedSheetNames.get(sheetId) ?? sheetNames.get(sheetId)
    if (name === undefined) {
      throw new InvalidInputError(`Unknown sheetId: ${sheetId}`)
    }
    return name
  }

  // Build the SheetEditPlan (only when sheetOps is non-empty)
  let sheetPlan: SheetEditPlan | undefined
  if (plan.sheetOps.length > 0) {
    sheetPlan = {
      renames,
      additions: [...addedSheetNames].map(([sheetId, name]) => ({
        name,
        sourceSheetName: duplicateSources.get(sheetId),
      })),
      removals,
      hiddenChanges,
      orderChanged,
      order: plan.sheetOrder.map((sheetId) => {
        const original = resolveSheetName(sheetId)
        return addedSheetNames.has(sheetId)
          ? original
          : (renameByOriginal.get(original) ?? original)
      }),
    }
  }

  // ── 2. Build gateway-style mutation types ──

  // Cell edits: resolve sheetId → sheetName.
  // The domain SheetCellEdit uses `unknown` for style/rich; the gateway
  // CellEdit has strict types. Cast through unknown — the renderer's Zod
  // validation guarantees the runtime shape.
  const edits: CellEdit[] = plan.edits.map((edit) => ({
    sheetName: resolveSheetName(edit.sheetId),
    row: edit.row,
    column: edit.column,
    writeValue: edit.writeValue,
    cell: { value: edit.value, formula: edit.formula },
    style: edit.style as CellEdit['style'],
    rich: edit.rich as CellEdit['rich'],
    styleReset: edit.styleReset,
  }))

  // Structural ops: group by sheet, resolve sheetId → sheetName.
  // The domain SheetStructuralOp has a loose `kind: string`; the gateway
  // StructuralOp is a discriminated union. Cast through unknown — the
  // renderer's Zod validation guarantees the kind+fields match.
  const opsBySheet = new Map<string, StructuralOp[]>()
  for (const op of plan.structuralOps) {
    const sheetName = resolveSheetName(op.sheetId)
    const sheetOps = opsBySheet.get(sheetName) ?? []
    // Cast through unknown: the domain op has the right fields (validated
    // by Zod at the renderer boundary), but TypeScript can't prove the
    // discriminated union matches.
    sheetOps.push(op as unknown as StructuralOp)
    opsBySheet.set(sheetName, sheetOps)
  }
  const structuralOps: SheetStructuralOps[] = [...opsBySheet].map(([sheetName, ops]) => ({ sheetName, ops }))

  // Filter states
  const filterStates: SheetFilterState[] = plan.filterStates.map((s) => ({
    sheetName: resolveSheetName(s.sheetId),
    filter: s.filter as SheetFilterState['filter'],
    hiddenRows: s.hiddenRows,
    visibilityRange: s.visibilityRange as SheetFilterState['visibilityRange'],
  }))

  // Hyperlink edits: group by sheet
  const linksBySheet = new Map<string, { row: number; column: number; target: string | null }[]>()
  for (const link of plan.hyperlinkEdits) {
    const sheetName = resolveSheetName(link.sheetId)
    const sheetLinks = linksBySheet.get(sheetName) ?? []
    sheetLinks.push({ row: link.row, column: link.column, target: link.target })
    linksBySheet.set(sheetName, sheetLinks)
  }
  const hyperlinkEdits: SheetHyperlinkEdits[] = [...linksBySheet].map(([sheetName, edits]) => ({ sheetName, edits }))

  // CF states
  const cfStates: SheetCfState[] = plan.cfStates.map((s) => ({
    sheetName: resolveSheetName(s.sheetId),
    rules: s.rules as SheetCfState['rules'],
  }))

  // DV states
  const dvStates: SheetDvState[] = plan.dvStates.map((s) => ({
    sheetName: resolveSheetName(s.sheetId),
    rules: s.rules as SheetDvState['rules'],
  }))

  // Sheet protections
  const sheetProtections: SheetProtectionState[] = plan.sheetProtections.map((s) => ({
    sheetName: resolveSheetName(s.sheetId),
    protected: s.protected,
  }))

  // Protected range states
  const protectedRangeStates: SheetProtectedRangesState[] = plan.protectedRangeStates.map((s) => ({
    sheetName: resolveSheetName(s.sheetId),
    ranges: s.ranges as SheetProtectedRangesState['ranges'],
  }))

  // Page setup states (spread + resolve sheetId)
  const pageSetupStates: SheetPageSetupState[] = plan.pageSetupStates.map(({ sheetId, ...state }) => ({
    sheetName: resolveSheetName(sheetId),
    ...state,
  })) as unknown as SheetPageSetupState[]

  // Note states
  const noteStates: SheetNoteState[] = plan.noteStates.map(({ sheetId, notes }) => ({
    sheetName: resolveSheetName(sheetId),
    notes: notes as SheetNoteState['notes'],
  }))

  // Visual additions
  const visualAdditions: SheetVisualAddition[] = plan.visualAdditions.map((add) => ({
    sheetName: resolveSheetName(add.sheetId),
    anchor: add.anchor,
    chart: add.chart,
    shape: add.shape,
    image: add.image,
  })) as unknown as SheetVisualAddition[]

  // Table additions
  const tableAdditions: SheetTableAddition[] = plan.tableAdditions.map((t) => ({
    sheetName: resolveSheetName(t.sheetId),
    area: t.area,
    name: t.name,
    columnNames: t.columnNames,
    style: t.style,
    bandedRows: t.bandedRows ?? false,
  })) as unknown as SheetTableAddition[]

  // Pivot additions (sheetId + sourceSheetId)
  const pivotAdditions: SheetPivotAddition[] = plan.pivotAdditions.map((p) => ({
    sheetName: resolveSheetName(p.sheetId),
    sourceSheetName: resolveSheetName(p.sourceSheetId),
    ...p,
  })) as unknown as SheetPivotAddition[]

  // Sparkline additions
  const sparklineAdditions: SheetSparklineAddition[] = plan.sparklineAdditions.map(({ sheetId, ...group }) => ({
    sheetName: resolveSheetName(sheetId),
    ...group,
  })) as unknown as SheetSparklineAddition[]

  // Formula values: group by sheet
  const formulaValuesBySheet = new Map<string, { row: number; column: number; value: string | number | boolean | null }[]>()
  for (const cell of plan.formulaValues) {
    const sheetName = resolveSheetName(cell.sheetId)
    const list = formulaValuesBySheet.get(sheetName) ?? []
    list.push({ row: cell.row, column: cell.column, value: cell.value })
    formulaValuesBySheet.set(sheetName, list)
  }
  const formulaValues: SheetFormulaValues[] = [...formulaValuesBySheet].map(([sheetName, cells]) => ({ sheetName, cells }))

  // Pivot refresh updates: resolve sheetId + relayout.sourceSheetId
  const pivotRefreshUpdates: PivotRefreshUpdate[] = plan.pivotRefreshUpdates.map((upd) => {
    const base: Record<string, unknown> = {
      cachePath: upd.cachePath,
      sheetName: resolveSheetName(upd.sheetId),
      newOutputRef: upd.newOutputRef,
    }
    if (upd.relayout !== undefined) {
      const { sheetId: _sheetId, sourceSheetId, ...rest } = upd.relayout
      base.relayout = { ...rest, sourceSheetName: resolveSheetName(sourceSheetId!) }
    }
    return base as unknown as PivotRefreshUpdate
  })

  // Chart edits + visual edits: package-absolute drawingPath, no sheetId mapping.
  // The domain types use `[key: string]: unknown`; the gateway types are strict.
  // Cast through unknown — the renderer's Zod validation guarantees the shape.
  const chartEdits = plan.chartEdits as unknown as readonly WorkbookChartEdit[]
  const visualEdits = plan.visualEdits as unknown as readonly WorkbookVisualEdit[]

  // Defined names, theme, workbook protection: workbook-level, no sheetId mapping
  const definedNamesState = plan.definedNamesState as unknown as DefinedNamesState | null
  const themeState = plan.themeState as unknown as WorkbookThemeState | null
  const workbookProtectionState = plan.workbookProtectionState as unknown as { readonly lockStructure: boolean } | null

  // ── 3. Delegate to the legacy planner ──
  const mutationPlan: MutationPlan = await planCellEditsToXlsx(
    source,
    edits,
    structuralOps,
    chartEdits,
    sheetPlan,
    filterStates,
    hyperlinkEdits,
    cfStates,
    dvStates,
    sheetProtections,
    definedNamesState,
    visualAdditions,
    pageSetupStates,
    noteStates,
    tableAdditions,
    pivotAdditions,
    plan.pivotCacheRefreshPaths,
    pivotRefreshUpdates,
    visualEdits,
    sparklineAdditions,
    formulaValues,
    themeState,
    workbookProtectionState,
    protectedRangeStates,
  )

  // ── 4. Convert MutationPlan → EngineArchivePatch[] ──
  const patches: EngineArchivePatch[] = []
  // Replaced entries (text)
  for (const [entryPath, content] of mutationPlan.replaced) {
    patches.push({ entryPath, content })
  }
  // Added entries (text)
  for (const [entryPath, content] of mutationPlan.added) {
    patches.push({ entryPath, content })
  }
  // Added binary entries (media)
  for (const [entryPath, content] of mutationPlan.addedBinary) {
    patches.push({ entryPath, content })
  }

  return {
    patches,
    touchedEntries: [...mutationPlan.touchedEntries],
    removedEntries: [...mutationPlan.removedEntries],
    addedEntries: [...mutationPlan.addedEntries],
  }
}
