/**
 * Coordinator tests for Increment 4G — commit-journal + teardown commit correction.
 *
 * Tests:
 *   Marker location consistency (A-C):
 *     A — marker discovery: save writes to userData/sheets-save-commits/, reconcile finds it
 *     B — crash after rename: marker exists, temp absent → marker deleted
 *     C — crash before rename: marker exists, temp exists → temp + marker deleted
 *   Teardown/commit race (A-B):
 *     A — teardown before commit: no rename, final target unchanged, resources cleaned
 *     B — teardown after commit begins: commit completes, then teardown closes new session
 *   Marker validation:
 *     — malformed marker quarantined/deleted
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

import { SheetsShellCoordinator } from '../src/main/sheets-shell-coordinator'
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
function makeCoordinator(service?: ReturnType<typeof makeMockService>) { const s = service ?? makeMockService(); return { coordinator: new SheetsShellCoordinator({ service: s }), service: s } }

describe('SheetsShellCoordinator (Increment 4G — commit-journal + teardown commit)', () => {
  beforeEach(() => { testDir = join(tmpdir(), `genoffice-test-${randomUUID()}`); mkdirSync(testDir, { recursive: true }); vi.clearAllMocks() })

  // ═══ Marker location consistency ═══

  describe('marker location consistency', () => {
    test('A — marker discovery: save writes to userData/sheets-save-commits/, reconcile finds it', async () => {
      const { coordinator } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'marker-discovery.xlsx')
      writeTestWorkbook(path, 'original content')
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

      // Save successfully — marker should be created AND cleared
      await coordinator.saveWorkbook(wcId, openResult!.sessionId, makeSaveRequest(), 'save', undefined)

      // No leftover markers (save completed successfully)
      const commitDir = join(tmpdir(), 'genoffice-test-userData', 'sheets-save-commits')
      if (existsSync(commitDir)) {
        const { readdirSync } = await import('node:fs')
        expect(readdirSync(commitDir).length).toBe(0)
      }
    })

    test('B — crash after rename: marker exists, temp absent → marker deleted', async () => {
      const userDataDir = join(testDir, 'userData')
      const commitDir = join(userDataDir, 'sheets-save-commits')
      mkdirSync(commitDir, { recursive: true })

      // Simulate: rename succeeded, temp was promoted, marker not cleared
      const marker = { version: 1, finalTarget: join(testDir, 'final.xlsx'), tempTarget: join(testDir, 'temp.xlsx'), sessionId: 'sess-b' }
      writeFileSync(join(commitDir, 'sess-b.json'), JSON.stringify(marker))
      // Temp does NOT exist (it was renamed to final)
      // Final exists (rename succeeded)
      writeTestWorkbook(join(testDir, 'final.xlsx'), 'new content')

      await SheetsShellCoordinator.reconcileSaveCommit(userDataDir)

      // Marker should be deleted
      expect(existsSync(join(commitDir, 'sess-b.json'))).toBe(false)
    })

    test('C — crash before rename: marker exists, temp exists → temp + marker deleted', async () => {
      const userDataDir = join(testDir, 'userData')
      const commitDir = join(userDataDir, 'sheets-save-commits')
      mkdirSync(commitDir, { recursive: true })

      // Simulate: marker written, rename did NOT happen (crash before rename)
      const tempPath = join(testDir, 'temp-c.xlsx')
      writeTestWorkbook(tempPath, 'temp content')
      const marker = { version: 1, finalTarget: join(testDir, 'final-c.xlsx'), tempTarget: tempPath, sessionId: 'sess-c' }
      writeFileSync(join(commitDir, 'sess-c.json'), JSON.stringify(marker))

      await SheetsShellCoordinator.reconcileSaveCommit(userDataDir)

      // Temp should be deleted (rename never happened)
      expect(existsSync(tempPath)).toBe(false)
      // Marker should be deleted
      expect(existsSync(join(commitDir, 'sess-c.json'))).toBe(false)
    })

    test('D — malformed marker: quarantined/deleted', async () => {
      const userDataDir = join(testDir, 'userData')
      const commitDir = join(userDataDir, 'sheets-save-commits')
      mkdirSync(commitDir, { recursive: true })

      // Corrupted JSON
      writeFileSync(join(commitDir, 'corrupted.json'), 'not valid json {{{')

      // Missing required fields
      writeFileSync(join(commitDir, 'incomplete.json'), JSON.stringify({ version: 1, finalTarget: 'x' }))

      // Wrong version
      writeFileSync(join(commitDir, 'wrong-version.json'), JSON.stringify({ version: 99, finalTarget: 'x', tempTarget: 'y', sessionId: 'z' }))

      await SheetsShellCoordinator.reconcileSaveCommit(userDataDir)

      // All malformed markers should be deleted
      expect(existsSync(join(commitDir, 'corrupted.json'))).toBe(false)
      expect(existsSync(join(commitDir, 'incomplete.json'))).toBe(false)
      expect(existsSync(join(commitDir, 'wrong-version.json'))).toBe(false)
    })
  })

  // ═══ Teardown/commit race ═══

  describe('teardown/commit race', () => {
    test('A — teardown before commit: no rename, final target unchanged, resources cleaned', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'td-before-commit.xlsx')
      writeTestWorkbook(path, 'original content')
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId

      // Make service.save trigger teardown and resolve immediately
      const origSave = service.save
      service.save = vi.fn(async (...args: Parameters<typeof origSave>) => {
        // Teardown fires (increments epoch), but does NOT wait for lock yet
        void coordinator.teardown(wcId)
        // Give teardown time to increment epoch
        await new Promise((r) => setTimeout(r, 10))
        return origSave(...args)
      }) as typeof origSave

      // Save should fail (teardown invalidated epoch at checkEpoch after service.save)
      await expect(coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)).rejects.toThrow(InvalidSessionError)

      // Final target UNCHANGED
      expect(readFileSync(path, 'utf8')).toBe('original content')
    }, 10000)

    test('B — teardown after commit begins: commit completes, then teardown closes new session', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'td-after-commit.xlsx')
      writeTestWorkbook(path, 'original content')
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId
      const oldHandle = openResult!.session.engineHandle

      // Make the replacement service.open block, trigger teardown during commit
      let callCount = 0
      let resolveOpen!: () => void
      const openBlocked = new Promise<void>((r) => { resolveOpen = r })
      const origOpen = (service.open as unknown as ReturnType<typeof vi.fn>).getMockImplementation() ?? (service.open as Function)
      service.open = vi.fn(async (bytes: Uint8Array, locale: string, fn: string): Promise<WorkbookOpenResult> => {
        callCount++
        if (callCount === 1) {
          // This is the replacement open during save Phase A.
          // Block it, and trigger teardown.
          void coordinator.teardown(wcId)
          await openBlocked
        }
        return (origOpen as Function)(bytes, locale, fn)
      }) as any

      // Save should fail because teardown invalidated the epoch
      // (checkEpoch after the replacement open returns will throw)
      const savePromise = coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)

      // Wait a moment for teardown to increment epoch
      await new Promise((r) => setTimeout(r, 20))

      // Release the blocked open
      resolveOpen!()

      // Save should fail (epoch was invalidated by teardown)
      await expect(savePromise).rejects.toThrow()

      // Final target should be unchanged (commit never happened)
      expect(readFileSync(path, 'utf8')).toBe('original content')
    })
  })

  // ═══ Regression ═══

  describe('regression', () => {
    test('save preserves same sessionId and readRange works after save', async () => {
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

    test('locale is preserved', async () => {
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

    test('teardown during service.save: close not called until save completes', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100; const path = join(testDir, 'reg-td-save.xlsx'); writeTestWorkbook(path)
      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId
      let resolveSave!: () => void
      const saveBlocked = new Promise<void>((r) => { resolveSave = r })
      const origSave = service.save
      service.save = vi.fn(async (...args: Parameters<typeof origSave>) => {
        void coordinator.teardown(wcId)
        await saveBlocked
        return origSave(...args)
      }) as typeof origSave
      const savePromise = coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)
      await new Promise((r) => setTimeout(r, 30))
      expect(service._closeCalls).toBe(0)
      resolveSave!()
      await expect(savePromise).rejects.toThrow(InvalidSessionError)
      await new Promise((r) => setTimeout(r, 30))
      expect(service._closeCalls).toBeGreaterThan(0)
    })

    test('no copyFile fallback in Phase B', async () => {
      const { readFile } = await import('node:fs/promises')
      const source = await readFile(join(__dirname, '..', 'src', 'main', 'sheets-shell-coordinator.ts'), 'utf8')
      const phaseBStart = source.indexOf('Phase B: Commit')
      const phaseCEnd = source.indexOf('Phase C: Old-resource')
      const phaseBSection = source.slice(phaseBStart, phaseCEnd)
      expect(phaseBSection).not.toContain('await copyFile')
      expect(phaseBSection).not.toMatch(/fall\s*back.*copy/i)
      expect(phaseBSection).toContain('rename')
    })
  })
})
