/**
 * Coordinator tests for Increment 4J — shell startup reconciliation + true save-crash test.
 *
 * Tests:
 *   1. Shell startup reconciliation: source inspection proves shell calls reconcileSheetsSaveCommits
 *   2. Standalone startup reconciliation: source inspection proves index.ts calls it
 *   3. REAL save→reconcile: save writes marker via production path, barrier pauses,
 *      verify marker at production path, simulate crash, reconcile, verify cleanup
 *   4. Manual reconciliation tests (crash before/after rename)
 *   5. Marker validation (zero type assertions)
 *   6. Teardown before/during commit
 *   Plus all regression tests.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'

const { mockApp, mockDialog } = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn((name: string) => join(tmpdir(), `genoffice-test-${name}`)) },
  mockDialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
}))
vi.mock('electron', () => ({ app: mockApp, dialog: mockDialog, BrowserWindow: vi.fn() }))

import { SheetsShellCoordinator, reconcileSheetsSaveCommits } from '../src/main/sheets-shell-coordinator'
import type {
  SpreadsheetService, WorkbookOpenResult, EngineSessionHandle, SaveResult,
  EngineRangeResult, EngineFormulaCellsResult, EngineRecalcResult, EngineMediaResult,
  WorkbookMetadata, WorksheetMetadata, WorkbookSession, SaveRequest, SavePlan,
} from '@genoffice/runtime-contracts'
import { InvalidInputError, InvalidSessionError, EngineError } from '@genoffice/runtime-contracts'

let testDir: string

function makeMockHandle(): EngineSessionHandle { return { [Symbol('brand')]: Symbol('brand') } as unknown as EngineSessionHandle }
function makeMockMetadata(name: string = 'test.xlsx'): WorkbookMetadata {
  return { name, sha256: 'abc123', entryCount: 10,
    sheets: [{ id: 'sheet-1', name: 'Sheet1', index: 0, hidden: false, rtl: false, showGridlines: true, rowCount: 100, columnCount: 26, defaultRowHeight: 15, defaultColumnWidth: 8.43 } as WorksheetMetadata],
    activeTab: 0, definedNames: [], themeColors: [], themeFonts: { major: '', minor: '' } }
}

function makeMockService(): SpreadsheetService & { _closeCalls: number; _closeHandles: EngineSessionHandle[] } {
  let closeCalls = 0
  const closeHandles: EngineSessionHandle[] = []
  const metadata = makeMockMetadata()
  const svc: any = {
    _closeCalls: 0, _closeHandles: closeHandles,
    open: vi.fn(async (_b: Uint8Array, _l: string, _f: string): Promise<WorkbookOpenResult> => {
      const handle = makeMockHandle()
      const session: WorkbookSession = { workbookName: 'test.xlsx', workbookHash: 'abc123', sheetNames: new Map([['sheet-1', 'Sheet1']]) }
      return { session, engineHandle: handle, metadata }
    }),
    close: vi.fn(async (h: EngineSessionHandle) => { closeCalls++; closeHandles.push(h) }),
    readRange: vi.fn(async () => ({ cells: [], rows: [], merges: [], columns: [], hyperlinks: [], conditionalFormatting: [], dataValidation: [], rowBreaks: [], columnBreaks: [], sheetProtection: false })),
    readFormulaCells: vi.fn(async () => ({ cells: [] })),
    recalculate: vi.fn(async () => ({ cells: [] })),
    readMedia: vi.fn(async () => ({ mediaType: 'image/png', base64: 'iVBOR' })),
    save: vi.fn(async () => ({ ok: true, data: new Uint8Array([1, 2, 3]), touchedEntries: ['xl/workbook.xml'] })),
    writeRecovery: vi.fn(async () => new Uint8Array([1, 2, 3])),
  }
  Object.defineProperty(svc, '_closeCalls', { get: () => closeCalls })
  return svc
}

function makeEmptySavePlan(): SavePlan {
  return { edits: [], structuralOps: [], formulaValues: [], sheetOps: [], sheetOrder: [], filterStates: [], hyperlinkEdits: [], cfStates: [], dvStates: [], pageSetupStates: [], noteStates: [], sheetProtections: [], protectedRangeStates: [], visualAdditions: [], tableAdditions: [], pivotAdditions: [], sparklineAdditions: [], chartEdits: [], visualEdits: [], pivotCacheRefreshPaths: [], pivotRefreshUpdates: [], definedNamesState: null, themeState: null, workbookProtectionState: null }
}
function makeSaveRequest(): SaveRequest { return { plan: makeEmptySavePlan() } }
function writeTestWorkbook(path: string, content = 'test xlsx content'): void { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, content) }
function makeCoordinator(service?: ReturnType<typeof makeMockService>, opts?: { onCommitGate?: (sid: string) => Promise<void>; onMarkerWritten?: (markerPath: string, sid: string) => Promise<void> }) {
  const s = service ?? makeMockService()
  const deps: { service: SpreadsheetService; onCommitGate?: (sid: string) => Promise<void>; onMarkerWritten?: (mp: string, sid: string) => Promise<void> } = { service: s }
  if (opts?.onCommitGate) deps.onCommitGate = opts.onCommitGate
  if (opts?.onMarkerWritten) deps.onMarkerWritten = opts.onMarkerWritten
  return { coordinator: new SheetsShellCoordinator(deps), service: s }
}

describe('SheetsShellCoordinator (Increment 4J — shell startup + true save-crash)', () => {
  beforeEach(() => { testDir = join(tmpdir(), `genoffice-test-${randomUUID()}`); mkdirSync(testDir, { recursive: true }); vi.clearAllMocks() })

  // ═══ 1. Shell startup reconciliation ═══

  describe('startup reconciliation wired', () => {
    test('standalone index.ts calls reconcileSheetsSaveCommits before startSheetsStandalone', async () => {
      const source = readFileSync(join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8')
      expect(source).toContain('reconcileSheetsSaveCommits')
      expect(source).toContain('startSheetsStandalone')
      const reconcilePos = source.indexOf('reconcileSheetsSaveCommits')
      const startStandalonePos = source.indexOf('startSheetsStandalone', reconcilePos)
      expect(startStandalonePos).toBeGreaterThan(reconcilePos)
      expect(source).toContain('await reconcileSheetsSaveCommits()')
    })

    test('shell index.ts imports and calls reconcileSheetsSaveCommits', async () => {
      const shellSource = readFileSync(join(__dirname, '..', '..', 'shell', 'src', 'main', 'index.ts'), 'utf8')
      expect(shellSource).toContain('reconcileSheetsSaveCommits')
      expect(shellSource).toContain('await reconcileSheetsSaveCommits()')
    })

    test('reconcileSheetsSaveCommits is callable and idempotent', async () => {
      await reconcileSheetsSaveCommits()
      await reconcileSheetsSaveCommits()
    })
  })

  // ═══ 2. REAL save→reconcile (production path, NOT manually constructed marker) ═══

  describe('real save→reconcile (production path)', () => {
    test('save writes marker via production path → barrier pauses → verify marker at production path → simulate crash → reconcile cleans', async () => {
      const { coordinator, service } = makeCoordinator(undefined, {
        onMarkerWritten: async (markerPath: string, sid: string) => {
          // At this point, the marker has been written by the PRODUCTION save path.
          // Verify it exists at the EXACT production path.
          expect(existsSync(markerPath)).toBe(true)

          // Verify the marker was written by the production save (not manually):
          // it should contain the sessionId, finalTarget, and tempTarget.
          const markerContent = JSON.parse(readFileSync(markerPath, 'utf8'))
          expect(markerContent.version).toBe(1)
          expect(markerContent.sessionId).toBe(sid)
          expect(typeof markerContent.finalTarget).toBe('string')
          expect(markerContent.finalTarget.length).toBeGreaterThan(0)
          expect(typeof markerContent.tempTarget).toBe('string')
          expect(markerContent.tempTarget.length).toBeGreaterThan(0)

          // Verify the temp target exists (rename hasn't happened yet)
          expect(existsSync(markerContent.tempTarget)).toBe(true)

          // Simulate crash: THROW to prevent the save from completing.
          // This leaves the marker on disk and the temp file behind.
          // The save's try/catch will call owned.release() which cleans up
          // the temp and handle, but the MARKER remains (it's not owned).
          throw new Error('SIMULATED_CRASH')
        },
      })

      const wcId = 100; const path = join(testDir, 'real-save-crash.xlsx')
      writeTestWorkbook(path, 'original content')
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId

      // The save should fail (simulated crash in onMarkerWritten)
      await expect(coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)).rejects.toThrow('SIMULATED_CRASH')

      // The marker should STILL exist on disk (the save failed before clearing it)
      const markerDir = join(tmpdir(), 'genoffice-test-userData', 'sheets-save-commits')
      const markerPath = join(markerDir, `${sessionId}.json`)

      // The marker may or may not exist depending on whether the error
      // in onMarkerWritten was caught by the try/catch in the save flow.
      // Let's check: the save flow has a try/catch around the marker write
      // and rename. If onMarkerWritten throws, the catch block runs
      // owned.release() and rethrows. But the marker was already written
      // BEFORE onMarkerWritten was called. The catch block does NOT delete
      // the marker — it only deletes the temp and closes the handle.
      // So the marker SHOULD still exist.
      expect(existsSync(markerPath)).toBe(true)

      // The temp target should have been cleaned by owned.release()
      // (it's in the OwnedResources). But the marker is NOT owned —
      // it's a journal entry that reconciliation handles.

      // Now invoke reconciliation (same as startup)
      await reconcileSheetsSaveCommits()

      // The marker should be discovered and cleaned
      expect(existsSync(markerPath)).toBe(false)

      // Final target should be UNCHANGED (rename never happened)
      expect(readFileSync(path, 'utf8')).toBe('original content')
    })

    test('crash before rename: marker + temp → temp deleted, marker deleted, final preserved', async () => {
      const userDataDir = join(testDir, 'userData')
      const commitDir = join(userDataDir, 'sheets-save-commits')
      mkdirSync(commitDir, { recursive: true })

      const tempPath = join(testDir, 'temp-before.xlsx')
      writeTestWorkbook(tempPath, 'temp content')
      const finalPath = join(testDir, 'final-before.xlsx')
      writeTestWorkbook(finalPath, 'original content')

      writeFileSync(join(commitDir, 'crash-before.json'), JSON.stringify({
        version: 1, finalTarget: finalPath, tempTarget: tempPath, sessionId: 'crash-before',
      }))

      await SheetsShellCoordinator.reconcileSaveCommit(userDataDir)

      expect(existsSync(tempPath)).toBe(false)
      expect(existsSync(join(commitDir, 'crash-before.json'))).toBe(false)
      expect(readFileSync(finalPath, 'utf8')).toBe('original content')
    })

    test('crash after rename: marker exists, temp absent → marker deleted, final preserved', async () => {
      const userDataDir = join(testDir, 'userData')
      const commitDir = join(userDataDir, 'sheets-save-commits')
      mkdirSync(commitDir, { recursive: true })

      const finalPath = join(testDir, 'final-after.xlsx')
      writeTestWorkbook(finalPath, 'new content')
      const tempPath = join(testDir, 'temp-after.xlsx') // does NOT exist

      writeFileSync(join(commitDir, 'crash-after.json'), JSON.stringify({
        version: 1, finalTarget: finalPath, tempTarget: tempPath, sessionId: 'crash-after',
      }))

      await SheetsShellCoordinator.reconcileSaveCommit(userDataDir)

      expect(existsSync(join(commitDir, 'crash-after.json'))).toBe(false)
      expect(readFileSync(finalPath, 'utf8')).toBe('new content')
      expect(existsSync(tempPath)).toBe(false)
    })
  })

  // ═══ 3. Marker validation ═══

  describe('marker validation', () => {
    test('validateMarker source contains no `as` type assertions', () => {
      const source = readFileSync(join(__dirname, '..', 'src', 'main', 'sheets-shell-coordinator.ts'), 'utf8')
      const funcStart = source.indexOf('function validateMarker')
      const funcEnd = source.indexOf('\n}', funcStart)
      const funcBody = source.slice(funcStart, funcEnd + 2)
      expect(funcBody).not.toMatch(/\bas\s+[A-Z{]/)
      expect(funcBody).not.toContain(' as Record')
    })

    test('rejects null', async () => {
      const d = join(testDir, 'u', 'sheets-save-commits'); mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'null.json'), 'null')
      await SheetsShellCoordinator.reconcileSaveCommit(join(testDir, 'u'))
      expect(existsSync(join(d, 'null.json'))).toBe(false)
    })

    test('rejects arrays', async () => {
      const d = join(testDir, 'u', 'sheets-save-commits'); mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'array.json'), '[1,2,3]')
      await SheetsShellCoordinator.reconcileSaveCommit(join(testDir, 'u'))
      expect(existsSync(join(d, 'array.json'))).toBe(false)
    })

    test('rejects wrong version', async () => {
      const d = join(testDir, 'u', 'sheets-save-commits'); mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'wrong.json'), JSON.stringify({ version: 99, finalTarget: 'a', tempTarget: 'b', sessionId: 'c' }))
      await SheetsShellCoordinator.reconcileSaveCommit(join(testDir, 'u'))
      expect(existsSync(join(d, 'wrong.json'))).toBe(false)
    })

    test('rejects missing/empty/non-string fields', async () => {
      const d = join(testDir, 'u', 'sheets-save-commits'); mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'missing.json'), JSON.stringify({ version: 1, finalTarget: 'a' }))
      writeFileSync(join(d, 'empty.json'), JSON.stringify({ version: 1, finalTarget: '', tempTarget: '', sessionId: '' }))
      writeFileSync(join(d, 'nonstring.json'), JSON.stringify({ version: 1, finalTarget: 123, tempTarget: true, sessionId: null }))
      writeFileSync(join(d, 'corrupted.json'), 'not valid json {{{')
      await SheetsShellCoordinator.reconcileSaveCommit(join(testDir, 'u'))
      expect(existsSync(join(d, 'missing.json'))).toBe(false)
      expect(existsSync(join(d, 'empty.json'))).toBe(false)
      expect(existsSync(join(d, 'nonstring.json'))).toBe(false)
      expect(existsSync(join(d, 'corrupted.json'))).toBe(false)
    })
  })

  // ═══ 4. Teardown before/during commit ═══

  describe('teardown/commit race', () => {
    test('A — teardown during commit: commit completes, teardown closes replacement', async () => {
      const { coordinator, service } = makeCoordinator(undefined, {
        onCommitGate: async (_sid: string) => {
          void coordinator.teardown(100)
          await new Promise((r) => setTimeout(r, 20))
        },
      })
      const wcId = 100; const path = join(testDir, 'td-during.xlsx')
      writeTestWorkbook(path, 'original content')
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId

      const saveResult = await coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)
      expect(saveResult.ok).toBe(true)
      expect(readFileSync(path).length).toBeGreaterThan(0)

      await new Promise((r) => setTimeout(r, 50))
      expect(() => coordinator.getSession(wcId, sessionId)).toThrow(InvalidSessionError)
      expect(service._closeCalls).toBeGreaterThanOrEqual(2)
    })

    test('B — teardown before commit: save aborts, no rename, final target unchanged', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'td-before.xlsx')
      writeTestWorkbook(path, 'original content')
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId
      const origSave = service.save
      service.save = vi.fn(async (...args: Parameters<typeof origSave>) => {
        void coordinator.teardown(wcId)
        await new Promise((r) => setTimeout(r, 10))
        return origSave(...args)
      }) as typeof origSave
      await expect(coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)).rejects.toThrow(InvalidSessionError)
      expect(readFileSync(path, 'utf8')).toBe('original content')
    })
  })

  // ═══ 5. Regression ═══

  describe('regression', () => {
    test('save preserves same sessionId and readRange works', async () => {
      const { coordinator } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'reg-save.xlsx'); writeTestWorkbook(path)
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId
      const saveResult = await coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)
      expect(saveResult.ok).toBe(true)
      const session = coordinator.getSession(wcId, sessionId)
      expect(session.sessionId).toBe(sessionId)
      const rangeResult = await coordinator.readRange(wcId, sessionId, 'sheet-1', 'A1:B2')
      expect(rangeResult).toBeDefined()
    })

    test('locale preserved', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'reg-locale.xlsx'); writeTestWorkbook(path)
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'zh' })
      await coordinator.saveWorkbook(wcId, openResult!.sessionId, makeSaveRequest(), 'save', undefined)
      const calls = (service.open as ReturnType<typeof vi.fn>).mock.calls
      expect(calls[0]![1]).toBe('zh')
      expect(calls[1]![1]).toBe('zh')
    })

    test('no legacyClient', () => {
      const { coordinator } = makeCoordinator()
      expect((coordinator as any).deps).toHaveProperty('service')
      expect((coordinator as any).deps).not.toHaveProperty('legacyClient')
    })

    test('deleted file → unknown', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'reg-del.xlsx'); writeTestWorkbook(path)
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const { unlinkSync } = await import('node:fs'); unlinkSync(path)
      service.save = vi.fn(async (_s: any, _h: EngineSessionHandle, _r: SaveRequest, ec: any) => {
        if (ec === 'unknown') return { ok: false, reason: 'external-modified' as const }
        return { ok: true, data: new Uint8Array([1]), touchedEntries: [] }
      }) as any
      const saveResult = await coordinator.saveWorkbook(wcId, openResult!.sessionId, makeSaveRequest(), 'save', undefined)
      expect(saveResult.ok).toBe(false)
      expect(saveResult.reason).toBe('external-modified')
    })

    test('per-renderer isolation', async () => {
      const { coordinator } = makeCoordinator()
      const wcId1 = 100, wcId2 = 200; const p1 = join(testDir, 'wb1.xlsx'), p2 = join(testDir, 'wb2.xlsx')
      writeTestWorkbook(p1); writeTestWorkbook(p2)
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [p1] }).mockResolvedValueOnce({ canceled: false, filePaths: [p2] })
      const r1 = await coordinator.openWorkbook(wcId1, undefined, { locale: 'en' })
      const r2 = await coordinator.openWorkbook(wcId2, undefined, { locale: 'en' })
      expect(() => coordinator.getSession(wcId1, r2!.sessionId)).toThrow(InvalidSessionError)
      expect(() => coordinator.getSession(wcId2, r1!.sessionId)).toThrow(InvalidSessionError)
    })

    test('close isolation', async () => {
      const { coordinator } = makeCoordinator()
      const wcId = 100; const p1 = join(testDir, 'iso1.xlsx'), p2 = join(testDir, 'iso2.xlsx')
      writeTestWorkbook(p1); writeTestWorkbook(p2)
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [p1] }).mockResolvedValueOnce({ canceled: false, filePaths: [p2] })
      const r1 = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const r2 = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      await coordinator.closeWorkbook(wcId, r1!.sessionId)
      expect(() => coordinator.getSession(wcId, r1!.sessionId)).toThrow(InvalidSessionError)
      coordinator.getSession(wcId, r2!.sessionId)
    })

    test('recovery/save race', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'reg-race.xlsx'); writeTestWorkbook(path)
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId
      let resolveSave!: () => void
      const saveBlocked = new Promise<void>((r) => { resolveSave = r })
      const origSave = service.save
      service.save = vi.fn(async (...args: Parameters<typeof origSave>) => { await saveBlocked; return origSave(...args) }) as typeof origSave
      const savePromise = coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)
      await new Promise((r) => setTimeout(r, 20))
      const recoveryPromise = coordinator.writeRecovery(wcId, sessionId, makeSaveRequest())
      resolveSave!()
      const saveResult = await savePromise
      expect(saveResult.ok).toBe(true)
      const recoveryResult = await recoveryPromise
      expect(recoveryResult.ok).toBe(false)
      const recoveryFilePath = (coordinator as any).recoveryPathFor(path)
      expect(existsSync(recoveryFilePath)).toBe(false)
    })

    test('readRange delegates', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'reg-read.xlsx'); writeTestWorkbook(path)
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      await coordinator.readRange(wcId, openResult!.sessionId, 'sheet-1', 'A1:B2')
      expect(service.readRange).toHaveBeenCalledTimes(1)
    })

    test('engine handle opaque', async () => {
      const { coordinator } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'reg-opaque.xlsx'); writeTestWorkbook(path)
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const result = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const handle = result!.session.engineHandle
      expect(Object.keys(handle)).toEqual([])
      expect(Reflect.ownKeys(handle).filter((k) => typeof k === 'string')).toEqual([])
    })

    test('XLS DEFERRED', async () => {
      const { coordinator } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'legacy.xls'); writeTestWorkbook(path, 'fake')
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      await expect(coordinator.openWorkbook(wcId, undefined, { locale: 'en' })).rejects.toThrow(EngineError)
    })

    test('no copyFile fallback in Phase B', async () => {
      const source = readFileSync(join(__dirname, '..', 'src', 'main', 'sheets-shell-coordinator.ts'), 'utf8')
      const phaseBStart = source.indexOf('Phase B: Commit')
      const phaseCEnd = source.indexOf('Phase C: Old-resource')
      const phaseBSection = source.slice(phaseBStart, phaseCEnd)
      expect(phaseBSection).not.toContain('await copyFile')
      expect(phaseBSection).not.toMatch(/fall\s*back.*copy/i)
      expect(phaseBSection).toContain('rename')
    })
  })
})
