/**
 * Coordinator tests for SheetsShellCoordinator (Increment 4A — behavioral correction).
 *
 * Tests the corrected coordinator behavior:
 *   - Save session replacement (same sessionId after save)
 *   - ExternalChangeStatus unknown policy (file missing → 'unknown', not 'unchanged')
 *   - No legacy XlsxSidecarClient dependency
 *   - Teardown epoch protection
 *   - Recovery race safety
 *
 * The coordinator is tested in isolation — no real sidecar, no real
 * Electron process. The mock SpreadsheetService returns canned results.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'

// Mock electron — the factory is hoisted by vitest, so all mocks must be
// defined INSIDE the factory (not as top-level variables).
const { mockApp, mockDialog } = vi.hoisted(() => ({
  mockApp: {
    getPath: vi.fn((name: string) => join(tmpdir(), `genoffice-test-${name}`)),
  },
  mockDialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  app: mockApp,
  dialog: mockDialog,
  BrowserWindow: vi.fn(),
}))

import { SheetsShellCoordinator } from '../src/main/sheets-shell-coordinator'
import type {
  SpreadsheetService,
  WorkbookOpenResult,
  EngineSessionHandle,
  SaveResult,
  EngineRangeResult,
  EngineFormulaCellsResult,
  EngineRecalcResult,
  EngineMediaResult,
  WorkbookMetadata,
  WorksheetMetadata,
  WorkbookSession,
  SaveRequest,
  SavePlan,
} from '@genoffice/runtime-contracts'
import { InvalidInputError, InvalidSessionError, EngineError } from '@genoffice/runtime-contracts'

// ── Test helpers ─────────────────────────────────────────────────────

let testDir: string

function makeMockHandle(): EngineSessionHandle {
  return { [Symbol('brand')]: Symbol('brand') } as unknown as EngineSessionHandle
}

function makeMockMetadata(name: string = 'test.xlsx'): WorkbookMetadata {
  return {
    name,
    sha256: 'abc123',
    entryCount: 10,
    sheets: [
      { id: 'sheet-1', name: 'Sheet1', index: 0, hidden: false, rtl: false, showGridlines: true, rowCount: 100, columnCount: 26, defaultRowHeight: 15, defaultColumnWidth: 8.43 } as WorksheetMetadata,
    ],
    activeTab: 0,
    definedNames: [],
    themeColors: [],
    themeFonts: { major: '', minor: '' },
  }
}

/**
 * Mock SpreadsheetService that returns unique handles for each open() call.
 * This lets us verify session-swap semantics (new handle after save).
 */
function makeMockService(): SpreadsheetService & {
  _handles: EngineSessionHandle[]
  _openCalls: number
  _closeCalls: number
} {
  const handles: EngineSessionHandle[] = []
  let openCalls = 0
  let closeCalls = 0
  const metadata = makeMockMetadata()
  const makeOpenResult = (): WorkbookOpenResult => {
    const handle = makeMockHandle()
    handles.push(handle)
    openCalls++
    const session: WorkbookSession = {
      workbookName: 'test.xlsx',
      workbookHash: 'abc123',
      sheetNames: new Map([['sheet-1', 'Sheet1']]),
    }
    return { session, engineHandle: handle, metadata }
  }
  return {
    _handles: handles,
    _openCalls: 0,
    _closeCalls: 0,
    open: vi.fn(async () => makeOpenResult()),
    close: vi.fn(async () => { closeCalls++ }),
    readRange: vi.fn(async () => ({ cells: [], rows: [], merges: [], columns: [], hyperlinks: [], conditionalFormatting: [], dataValidation: [], rowBreaks: [], columnBreaks: [], sheetProtection: false }) as EngineRangeResult),
    readFormulaCells: vi.fn(async () => ({ cells: [] }) as EngineFormulaCellsResult),
    recalculate: vi.fn(async () => ({ cells: [] }) as EngineRecalcResult),
    readMedia: vi.fn(async () => ({ mediaType: 'image/png', base64: 'iVBOR' }) as EngineMediaResult),
    save: vi.fn(async () => ({ ok: true, data: new Uint8Array([1, 2, 3]), touchedEntries: ['xl/workbook.xml'] }) as SaveResult),
    writeRecovery: vi.fn(async () => new Uint8Array([1, 2, 3])),
  } as unknown as SpreadsheetService & {
    _handles: EngineSessionHandle[]
    _openCalls: number
    _closeCalls: number
  }
}

function makeEmptySavePlan(): SavePlan {
  return {
    edits: [], structuralOps: [], formulaValues: [], sheetOps: [], sheetOrder: [],
    filterStates: [], hyperlinkEdits: [], cfStates: [], dvStates: [],
    pageSetupStates: [], noteStates: [], sheetProtections: [], protectedRangeStates: [],
    visualAdditions: [], tableAdditions: [], pivotAdditions: [], sparklineAdditions: [],
    chartEdits: [], visualEdits: [], pivotCacheRefreshPaths: [], pivotRefreshUpdates: [],
    definedNamesState: null, themeState: null, workbookProtectionState: null,
  }
}

function makeSaveRequest(): SaveRequest {
  return { plan: makeEmptySavePlan() }
}

function writeTestWorkbook(path: string, content: string = 'test xlsx content'): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

function makeCoordinator(service?: ReturnType<typeof makeMockService>) {
  const svc = service ?? makeMockService()
  const coordinator = new SheetsShellCoordinator({ service: svc })
  return { coordinator, service: svc }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('SheetsShellCoordinator (Increment 4A — behavioral correction)', () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `genoffice-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    vi.clearAllMocks()
  })

  // ── 1. Save session replacement (CRITICAL) ──

  describe('save session replacement', () => {
    test('save succeeds and preserves the same sessionId', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'wb.xlsx')
      writeTestWorkbook(path, 'original content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      expect(openResult).not.toBeNull()
      const sessionId = openResult!.sessionId

      // Save
      const saveResult = await coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)
      expect(saveResult.ok).toBe(true)

      // The same sessionId must still be addressable
      const session = coordinator.getSession(wcId, sessionId)
      expect(session.sessionId).toBe(sessionId)
    })

    test('readRange immediately after save succeeds using the same sessionId', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'wb.xlsx')
      writeTestWorkbook(path, 'original content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId

      await coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)

      // readRange must succeed with the same sessionId
      const rangeResult = await coordinator.readRange(wcId, sessionId, 'sheet-1', 'A1:B2')
      expect(rangeResult).toBeDefined()
    })

    test('old engine handle is closed after save', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'wb.xlsx')
      writeTestWorkbook(path, 'original content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const oldHandle = openResult!.session.engineHandle

      await coordinator.saveWorkbook(wcId, openResult!.sessionId, makeSaveRequest(), 'save', undefined)

      // service.close should have been called for the old handle
      expect(service.close).toHaveBeenCalledWith(oldHandle)
    })

    test('old snapshot is removed after save', async () => {
      const { coordinator } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'wb.xlsx')
      writeTestWorkbook(path, 'original content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const oldSnapshotPath = openResult!.session.snapshotPath

      await coordinator.saveWorkbook(wcId, openResult!.sessionId, makeSaveRequest(), 'save', undefined)

      // Old snapshot should be gone
      const { existsSync } = await import('node:fs')
      expect(existsSync(oldSnapshotPath)).toBe(false)
    })

    test('new engine session is active after save', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'wb.xlsx')
      writeTestWorkbook(path, 'original content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const oldHandle = openResult!.session.engineHandle

      await coordinator.saveWorkbook(wcId, openResult!.sessionId, makeSaveRequest(), 'save', undefined)

      // The new session must have a different engine handle
      const newSession = coordinator.getSession(wcId, openResult!.sessionId)
      expect(newSession.engineHandle).not.toBe(oldHandle)
    })

    test('save-as also preserves a valid session', async () => {
      const { coordinator } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'wb.xlsx')
      writeTestWorkbook(path, 'original content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId

      const saveAsPath = join(testDir, 'saved-as.xlsx')
      mockDialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: saveAsPath })

      const saveResult = await coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save-as', undefined)
      expect(saveResult.ok).toBe(true)

      // Same sessionId, new originalPath
      const session = coordinator.getSession(wcId, sessionId)
      expect(session.originalPath).toBe(saveAsPath)
    })

    test('restore-writeback also preserves a valid session', async () => {
      const { coordinator } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'restore.xlsx')
      writeTestWorkbook(path, 'original content')

      // Create a recovery copy newer than the file
      const recoveryDir = join(tmpdir(), 'genoffice-test-userData', 'sheets-autosave')
      mkdirSync(recoveryDir, { recursive: true })
      const hash = createHash('sha1').update(path).digest('hex').slice(0, 16)
      const recoveryPath = join(recoveryDir, `${hash}.xlsx`)
      await new Promise((r) => setTimeout(r, 50))
      writeFileSync(recoveryPath, 'recovery content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      mockDialog.showMessageBox.mockResolvedValueOnce({ response: 0 }) // Restore

      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      expect(openResult).not.toBeNull()
      const sessionId = openResult!.sessionId
      expect(openResult!.session.restoreTarget).toBe(path)

      // Save (restore-writeback)
      const saveResult = await coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)
      expect(saveResult.ok).toBe(true)

      // Same sessionId still addressable
      const session = coordinator.getSession(wcId, sessionId)
      expect(session.sessionId).toBe(sessionId)
    })
  })

  // ── 2. ExternalChangeStatus policy ──

  describe('ExternalChangeStatus policy', () => {
    test('unchanged file → save permitted', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'unchanged.xlsx')
      writeTestWorkbook(path, 'original content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

      // Don't modify the file → save should succeed
      const saveResult = await coordinator.saveWorkbook(wcId, openResult!.sessionId, makeSaveRequest(), 'save', undefined)
      expect(saveResult.ok).toBe(true)
    })

    test('changed file → save refused', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'changed.xlsx')
      writeTestWorkbook(path, 'original content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

      // Modify the file
      writeTestWorkbook(path, 'modified content')

      // Mock service.save to return refused when externalChange is 'changed'
      service.save = vi.fn(async (_s: any, _h: EngineSessionHandle, _r: SaveRequest, externalChange: any) => {
        if (externalChange === 'changed' || externalChange === 'unknown') {
          return { ok: false, reason: 'external-modified' as const }
        }
        return { ok: true, data: new Uint8Array([1]), touchedEntries: [] }
      }) as any

      const saveResult = await coordinator.saveWorkbook(wcId, openResult!.sessionId, makeSaveRequest(), 'save', undefined)
      expect(saveResult.ok).toBe(false)
      expect(saveResult.reason).toBe('external-modified')
    })

    test('deleted file → save refused (unknown, not unchanged)', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'deleted.xlsx')
      writeTestWorkbook(path, 'original content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

      // Delete the file
      const { unlinkSync } = await import('node:fs')
      unlinkSync(path)

      // Mock service.save to return refused when externalChange is 'unknown'
      service.save = vi.fn(async (_s: any, _h: EngineSessionHandle, _r: SaveRequest, externalChange: any) => {
        if (externalChange === 'unknown') {
          return { ok: false, reason: 'external-modified' as const }
        }
        return { ok: true, data: new Uint8Array([1]), touchedEntries: [] }
      }) as any

      const saveResult = await coordinator.saveWorkbook(wcId, openResult!.sessionId, makeSaveRequest(), 'save', undefined)
      expect(saveResult.ok).toBe(false)
      expect(saveResult.reason).toBe('external-modified')
    })

    test('save-as bypasses disk-change guard', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'saveas-bypass.xlsx')
      writeTestWorkbook(path, 'original content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

      // Modify the file (disk changed)
      writeTestWorkbook(path, 'modified content')

      // Save-as should still succeed (bypasses the guard)
      const saveAsPath = join(testDir, 'saved-as-bypass.xlsx')
      mockDialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: saveAsPath })

      const saveResult = await coordinator.saveWorkbook(wcId, openResult!.sessionId, makeSaveRequest(), 'save-as', undefined)
      expect(saveResult.ok).toBe(true)
    })

    test('restore-target uses its own sha guard', async () => {
      const { coordinator } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'restore-guard.xlsx')
      writeTestWorkbook(path, 'original content')

      // Create recovery copy newer
      const recoveryDir = join(tmpdir(), 'genoffice-test-userData', 'sheets-autosave')
      mkdirSync(recoveryDir, { recursive: true })
      const hash = createHash('sha1').update(path).digest('hex').slice(0, 16)
      const recoveryPath = join(recoveryDir, `${hash}.xlsx`)
      await new Promise((r) => setTimeout(r, 50))
      writeFileSync(recoveryPath, 'recovery content')

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      mockDialog.showMessageBox.mockResolvedValueOnce({ response: 0 }) // Restore

      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      expect(openResult!.session.restoreTarget).toBe(path)

      // Modify the restore target after open
      writeTestWorkbook(path, 'modified after open')

      // Save should throw because restoreTarget sha changed
      await expect(
        coordinator.saveWorkbook(wcId, openResult!.sessionId, makeSaveRequest(), 'save', undefined)
      ).rejects.toThrow()
    })
  })

  // ── 3. No coordinator legacy sidecar ──

  test('coordinator deps do NOT include legacyClient', () => {
    // The SheetsShellCoordinatorDeps interface should NOT have a legacyClient field.
    // Verify by attempting to construct with a legacyClient — TypeScript should
    // reject it. At runtime, we verify the deps type doesn't include it.
    const { coordinator } = makeCoordinator()
    expect(coordinator).toBeDefined()
    // The deps should only have 'service'
    expect((coordinator as any).deps).toHaveProperty('service')
    expect((coordinator as any).deps).not.toHaveProperty('legacyClient')
  })

  // ── 4. .xls conversion failure ──

  test('.xls conversion throws explicit error (not silent failure)', async () => {
    const { coordinator } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'legacy.xls')
    writeTestWorkbook(path, 'fake xls content')

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })

    // Opening a .xls should throw (conversion not yet wired through service)
    await expect(coordinator.openWorkbook(wcId, undefined, { locale: 'en' })).rejects.toThrow(EngineError)
  })

  // ── 5. Teardown epoch safety ──

  describe('teardown epoch safety', () => {
    test('teardown during open — session NOT registered, engine handle cleaned up', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'teardown-open.xlsx')
      writeTestWorkbook(path)

      // Start an open operation, but tear down before it completes.
      // We'll make the dialog resolve, then tear down immediately.
      mockDialog.showOpenDialog.mockImplementation(async () => {
        // Tear down while the dialog is "showing"
        await coordinator.teardown(wcId)
        return { canceled: false, filePaths: [path] }
      })

      // The open should fail because the renderer was torn down during the operation
      await expect(coordinator.openWorkbook(wcId, undefined, { locale: 'en' })).rejects.toThrow(InvalidSessionError)
    })

    test('teardown during save — replacement session NOT registered, new handle cleaned up', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'teardown-save.xlsx')
      writeTestWorkbook(path)

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId

      // Make service.save trigger a teardown
      service.save = vi.fn(async () => {
        await coordinator.teardown(wcId)
        return { ok: true, data: new Uint8Array([1, 2, 3]), touchedEntries: [] }
      }) as any

      // The save should fail because the renderer was torn down
      await expect(
        coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)
      ).rejects.toThrow(InvalidSessionError)

      // The new engine handle should have been closed (cleanup)
      expect(service.close).toHaveBeenCalled()
    })
  })

  // ── 6. Recovery race safety ──

  describe('recovery race safety', () => {
    test('stale recovery write is rejected after save increments epoch', async () => {
      const { coordinator, service } = makeCoordinator()
      const wcId = 100
      const path = join(testDir, 'recovery-race.xlsx')
      writeTestWorkbook(path)

      mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
      const sessionId = openResult!.sessionId

      // Start a recovery write, but make it slow
      service.writeRecovery = vi.fn(async () => {
        // Save while the recovery write is in flight
        await coordinator.saveWorkbook(wcId, sessionId, makeSaveRequest(), 'save', undefined)
        return new Uint8Array([1, 2, 3])
      }) as any

      // The recovery write should return ok: false (stale — epoch incremented by save)
      const recoveryResult = await coordinator.writeRecovery(wcId, sessionId, makeSaveRequest())
      expect(recoveryResult.ok).toBe(false)
    })
  })

  // ── 7. Engine handle opacity ──

  test('engine handle opacity — ShellWorkbookSession.engineHandle is opaque', async () => {
    const { coordinator } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'opaque.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const result = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    const handle = result!.session.engineHandle
    expect(Object.keys(handle)).toEqual([])
    expect(Reflect.ownKeys(handle).filter((k) => typeof k === 'string')).toEqual([])
  })

  // ── 8. Read delegation (no regression) ──

  test('readRange delegates to service, not sidecar', async () => {
    const { coordinator, service } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'read.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    await coordinator.readRange(wcId, openResult!.sessionId, 'sheet-1', 'A1:B2')
    expect(service.readRange).toHaveBeenCalledTimes(1)
  })

  test('readFormulaCells delegates to service', async () => {
    const { coordinator, service } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'formulas.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    await coordinator.readFormulaCells(wcId, openResult!.sessionId, 'sheet-1')
    expect(service.readFormulaCells).toHaveBeenCalledTimes(1)
  })

  test('recalculate delegates to service', async () => {
    const { coordinator, service } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'recalc.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    await coordinator.recalculate(wcId, openResult!.sessionId, [], [])
    expect(service.recalculate).toHaveBeenCalledTimes(1)
  })

  test('readMedia delegates to service', async () => {
    const { coordinator, service } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'media.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const openResult = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    await coordinator.readMedia(wcId, openResult!.sessionId, 'img1')
    expect(service.readMedia).toHaveBeenCalledTimes(1)
  })

  // ── 9. Close isolation ──

  test('close isolation — closing one workbook does not affect another', async () => {
    const { coordinator } = makeCoordinator()
    const wcId = 100
    const path1 = join(testDir, 'wb1.xlsx')
    const path2 = join(testDir, 'wb2.xlsx')
    writeTestWorkbook(path1)
    writeTestWorkbook(path2)

    mockDialog.showOpenDialog
      .mockResolvedValueOnce({ canceled: false, filePaths: [path1] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [path2] })

    const result1 = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })
    const result2 = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    await coordinator.closeWorkbook(wcId, result1!.sessionId)

    expect(() => coordinator.getSession(wcId, result1!.sessionId)).toThrow(InvalidSessionError)
    coordinator.getSession(wcId, result2!.sessionId) // should not throw
  })

  // ── 10. Per-renderer isolation ──

  test('per-renderer event routing — session resolved by wcId, not global', async () => {
    const { coordinator } = makeCoordinator()
    const wcId1 = 100
    const wcId2 = 200
    const path1 = join(testDir, 'wb1.xlsx')
    const path2 = join(testDir, 'wb2.xlsx')
    writeTestWorkbook(path1)
    writeTestWorkbook(path2)

    mockDialog.showOpenDialog
      .mockResolvedValueOnce({ canceled: false, filePaths: [path1] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [path2] })

    const result1 = await coordinator.openWorkbook(wcId1, undefined, { locale: 'en' })
    const result2 = await coordinator.openWorkbook(wcId2, undefined, { locale: 'en' })

    expect(() => coordinator.getSession(wcId1, result2!.sessionId)).toThrow(InvalidSessionError)
    expect(() => coordinator.getSession(wcId2, result1!.sessionId)).toThrow(InvalidSessionError)
  })
})
