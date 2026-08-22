/**
 * Regression tests comparing the SavePlan translator output against the
 * legacy `planCellEditsToXlsx` + `saveWorkbookViaSidecar` pipeline
 * (Increment 3D, Section 10).
 *
 * The translator delegates to the SAME `planCellEditsToXlsx` function,
 * so the outputs are semantically equivalent by construction. These tests
 * verify that equivalence by calling the translator and comparing the
 * resulting touchedEntries against the known legacy output (recorded from
 * the existing `xlsx-streaming-save.test.ts` regression suite).
 *
 * Fixture: buildEditFixture() from apps/sheets/tests/fixture-builder.ts
 * — the same fixture used by the legacy streaming-save tests.
 */
import { describe, test, expect } from 'vitest'
import { translateSavePlan } from '../src/capabilities/save-plan-translator.js'
import { createBufferEntrySource } from '@genoffice/xlsx-gateway'
import { buildEditFixture } from '../../apps/sheets/tests/fixture-builder.js'
import type { SavePlan, SheetCellEdit } from '@genoffice/runtime-contracts'

// ── Helpers ──────────────────────────────────────────────────────────

function makeEmptySavePlan(): SavePlan {
  return {
    edits: [],
    structuralOps: [],
    formulaValues: [],
    sheetOps: [],
    sheetOrder: [],
    filterStates: [],
    hyperlinkEdits: [],
    cfStates: [],
    dvStates: [],
    pageSetupStates: [],
    noteStates: [],
    sheetProtections: [],
    protectedRangeStates: [],
    visualAdditions: [],
    tableAdditions: [],
    pivotAdditions: [],
    sparklineAdditions: [],
    chartEdits: [],
    visualEdits: [],
    pivotCacheRefreshPaths: [],
    pivotRefreshUpdates: [],
    definedNamesState: null,
    themeState: null,
    workbookProtectionState: null,
  }
}

async function makeEntrySource() {
  const buffer = await buildEditFixture()
  return createBufferEntrySource(buffer)
}

function makeSheetNames(): Map<string, string> {
  return new Map([['1', 'Data']])
}

// ── Tests ─────────────────────────────────────────────────────────────

/**
 * Regression: the translator delegates to planCellEditsToXlsx — the SAME
 * function used by the legacy `saveWorkbookViaSidecar` pipeline. The
 * expected touchedEntries below are recorded from the legacy
 * `xlsx-streaming-save.test.ts` test ("saves a cell edit while raw-copying
 * every untouched entry byte-for-byte"), which asserts:
 *   touchedEntries: ['xl/workbook.xml', 'xl/worksheets/sheet1.xml']
 */
describe('SavePlan translator — legacy regression (Section 10)', () => {
  test('cell edit: translator touches the same entries as the legacy pipeline', async () => {
    const source = await makeEntrySource()
    const edit: SheetCellEdit = {
      sheetId: '1',  // sheetId="1" → sheetName="Data"
      row: 0,
      column: 0,
      writeValue: true,
      value: 'World',
    }
    const plan: SavePlan = { ...makeEmptySavePlan(), edits: [edit] }
    const result = await translateSavePlan(plan, makeSheetNames(), source)

    // Legacy assertion (from xlsx-streaming-save.test.ts):
    //   expect(result.touchedEntries).toEqual(['xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    expect(result.touchedEntries.sort()).toEqual(['xl/workbook.xml', 'xl/worksheets/sheet1.xml'])

    // Legacy content assertion:
    //   savedSheet contains '<is><t xml:space="preserve">World</t></is>'
    const sheetPatch = result.patches.find((p) => p.entryPath === 'xl/worksheets/sheet1.xml')
    expect(sheetPatch).toBeDefined()
    expect(sheetPatch!.content as string).toContain('<is><t xml:space="preserve">World</t></is>')

    // Legacy workbook assertion:
    //   savedWorkbook contains 'fullCalcOnLoad="1"'
    const workbookPatch = result.patches.find((p) => p.entryPath === 'xl/workbook.xml')
    expect(workbookPatch).toBeDefined()
    expect(workbookPatch!.content as string).toContain('fullCalcOnLoad="1"')

    // No entries removed or added for a simple cell edit
    expect(result.removedEntries).toEqual([])
    expect(result.addedEntries).toEqual([])
  })

  test('empty plan: translator touches only workbook.xml (fullCalcOnLoad)', async () => {
    const source = await makeEntrySource()
    const result = await translateSavePlan(makeEmptySavePlan(), makeSheetNames(), source)

    // An empty save still adds fullCalcOnLoad="1" to workbook.xml.
    expect(result.touchedEntries).toEqual(['xl/workbook.xml'])
    expect(result.removedEntries).toEqual([])
    expect(result.addedEntries).toEqual([])
  })

  test('structural op (insert-rows): translator touches worksheet + workbook', async () => {
    const source = await makeEntrySource()
    const plan: SavePlan = {
      ...makeEmptySavePlan(),
      structuralOps: [{ sheetId: '1', kind: 'insert-rows', index: 0, count: 1 }],
    }
    const result = await translateSavePlan(plan, makeSheetNames(), source)

    // Structural ops touch the worksheet (row addresses shift) and
    // workbook.xml (fullCalcOnLoad).
    expect(result.touchedEntries).toContain('xl/worksheets/sheet1.xml')
    expect(result.touchedEntries).toContain('xl/workbook.xml')
  })

  test('sheet protection: translator touches worksheet + workbook', async () => {
    const source = await makeEntrySource()
    const plan: SavePlan = {
      ...makeEmptySavePlan(),
      sheetProtections: [{ sheetId: '1', protected: true }],
    }
    const result = await translateSavePlan(plan, makeSheetNames(), source)

    expect(result.touchedEntries).toContain('xl/worksheets/sheet1.xml')
    expect(result.touchedEntries).toContain('xl/workbook.xml')
  })

  test('workbook protection: translator touches workbook.xml', async () => {
    const source = await makeEntrySource()
    const plan: SavePlan = {
      ...makeEmptySavePlan(),
      workbookProtectionState: { lockStructure: true },
    }
    const result = await translateSavePlan(plan, makeSheetNames(), source)

    expect(result.touchedEntries).toEqual(['xl/workbook.xml'])
  })

  test('defined names state: translator touches workbook.xml', async () => {
    const source = await makeEntrySource()
    const plan: SavePlan = {
      ...makeEmptySavePlan(),
      definedNamesState: { names: [], preserveNames: [] },
    }
    const result = await translateSavePlan(plan, makeSheetNames(), source)

    expect(result.touchedEntries).toEqual(['xl/workbook.xml'])
  })

  test('formula values: translator touches workbook.xml (fullCalcOnLoad)', async () => {
    const source = await makeEntrySource()
    const plan: SavePlan = {
      ...makeEmptySavePlan(),
      formulaValues: [{ sheetId: '1', row: 2, column: 1, value: 42 }],
    }
    const result = await translateSavePlan(plan, makeSheetNames(), source)

    // Formula value writeback touches the worksheet (the <v> element)
    // and workbook.xml (fullCalcOnLoad). The exact set of touched entries
    // depends on whether the planner optimizes no-op writes.
    expect(result.touchedEntries).toContain('xl/workbook.xml')
  })
})
