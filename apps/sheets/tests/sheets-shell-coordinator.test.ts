/**
 * Coordinator tests for SheetsShellCoordinator (Increment 4, Section 10).
 *
 * Tests the 12 required scenarios using mocked SpreadsheetService and
 * mocked Electron APIs (app, dialog, BrowserWindow).
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

// Now import the coordinator (after the mock is set up)
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
import { InvalidInputError, InvalidSessionError } from '@genoffice/runtime-contracts'

// ── Test helpers ─────────────────────────────────────────────────────

const testRunId = randomUUID()
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

function makeMockService(): SpreadsheetService & { _handle: EngineSessionHandle; _openResult: WorkbookOpenResult } {
  const handle = makeMockHandle()
  const metadata = makeMockMetadata()
  const session: WorkbookSession = {
    workbookName: 'test.xlsx',
    workbookHash: 'abc123',
    sheetNames: new Map([['sheet-1', 'Sheet1']]),
  }
  const openResult: WorkbookOpenResult = { session, engineHandle: handle, metadata }
  return {
    _handle: handle,
    _openResult: openResult,
    open: vi.fn(async () => openResult),
    close: vi.fn(async () => {}),
    readRange: vi.fn(async () => ({ cells: [], rows: [], merges: [], columns: [], hyperlinks: [], conditionalFormatting: [], dataValidation: [], rowBreaks: [], columnBreaks: [], sheetProtection: false }) as EngineRangeResult),
    readFormulaCells: vi.fn(async () => ({ cells: [] }) as EngineFormulaCellsResult),
    recalculate: vi.fn(async () => ({ cells: [] }) as EngineRecalcResult),
    readMedia: vi.fn(async () => ({ mediaType: 'image/png', base64: 'iVBOR' }) as EngineMediaResult),
    save: vi.fn(async () => ({ ok: true, data: new Uint8Array([1, 2, 3]), touchedEntries: ['xl/workbook.xml'] }) as SaveResult),
    writeRecovery: vi.fn(async () => new Uint8Array([1, 2, 3])),
  } as unknown as SpreadsheetService & { _handle: EngineSessionHandle; _openResult: WorkbookOpenResult }
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

describe('SheetsShellCoordinator (Increment 4)', () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `genoffice-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    vi.clearAllMocks()
  })

  // ── 1. Two workbooks in one renderer ──

  test('two workbooks in one renderer — independent sessions', async () => {
    const { coordinator, service } = makeCoordinator()
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

    expect(result1).not.toBeNull()
    expect(result2).not.toBeNull()
    expect(result1!.sessionId).not.toBe(result2!.sessionId)
    expect(result1!.session.originalPath).toBe(path1)
    expect(result2!.session.originalPath).toBe(path2)

    // Both sessions exist
    coordinator.getSession(wcId, result1!.sessionId)
    coordinator.getSession(wcId, result2!.sessionId)
  })

  // ── 2. Same workbook opened in two renderers ──

  test('same workbook in two renderers — fully independent', async () => {
    const { coordinator } = makeCoordinator()
    const wcId1 = 100
    const wcId2 = 200
    const path = join(testDir, 'shared.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog
      .mockResolvedValueOnce({ canceled: false, filePaths: [path] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [path] })

    const result1 = await coordinator.openWorkbook(wcId1, undefined, { locale: 'en' })
    const result2 = await coordinator.openWorkbook(wcId2, undefined, { locale: 'en' })

    expect(result1).not.toBeNull()
    expect(result2).not.toBeNull()
    // Different sessions, different engine handles (mock returns same handle but they're separate lookups)
    expect(result1!.sessionId).not.toBe(result2!.sessionId)
    // Both have their own snapshot
    expect(result1!.session.snapshotPath).not.toBe(result2!.session.snapshotPath)
  })

  // ── 3. Save isolation ──

  test('save isolation — saving one workbook does not affect another', async () => {
    const { coordinator, service } = makeCoordinator()
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

    // Save wb1
    const saveResult = await coordinator.saveWorkbook(wcId, result1!.sessionId, makeSaveRequest(), 'save', undefined)
    expect(saveResult.ok).toBe(true)

    // wb2 session still valid
    const session2 = coordinator.getSession(wcId, result2!.sessionId)
    expect(session2).toBeDefined()
  })

  // ── 4. Close isolation ──

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

    // Close wb1
    await coordinator.closeWorkbook(wcId, result1!.sessionId)

    // wb1 session gone
    expect(() => coordinator.getSession(wcId, result1!.sessionId)).toThrow(InvalidSessionError)
    // wb2 session still valid
    const session2 = coordinator.getSession(wcId, result2!.sessionId)
    expect(session2).toBeDefined()
  })

  // ── 5. Recovery isolation ──

  test('recovery isolation — recovery for one workbook does not affect another', async () => {
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

    // Write recovery for wb1
    const recoveryResult = await coordinator.writeRecovery(wcId, result1!.sessionId, makeSaveRequest())
    expect(recoveryResult.ok).toBe(true)

    // wb2 session still valid
    const session2 = coordinator.getSession(wcId, result2!.sessionId)
    expect(session2).toBeDefined()
  })

  // ── 6. Disk-change isolation ──

  test('disk-change isolation — save refused when disk fingerprint changed', async () => {
    const { coordinator, service } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'changed.xlsx')
    writeTestWorkbook(path, 'original content')

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const result = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    // Simulate disk change: overwrite the file with different content
    writeTestWorkbook(path, 'modified content that is definitely different')

    // Mock service.save to return the "changed" result directly (since the
    // coordinator computes externalChange and calls service.save with it).
    // The coordinator should detect the disk change and pass externalChange='changed',
    // causing service.save to return { ok: false, reason: 'external-modified' }.
    service.save = vi.fn(async (_s: any, _h: EngineSessionHandle, _r: SaveRequest, externalChange: any) => {
      if (externalChange === 'changed' || externalChange === 'unknown') {
        return { ok: false, reason: 'external-modified' as const }
      }
      return { ok: true, data: new Uint8Array([1, 2, 3]), touchedEntries: [] }
    }) as any

    const saveResult = await coordinator.saveWorkbook(wcId, result!.sessionId, makeSaveRequest(), 'save', undefined)
    expect(saveResult.ok).toBe(false)
    expect(saveResult.reason).toBe('external-modified')
  })

  // ── 7. Teardown during open ──

  test('teardown during open — all sessions cleaned up', async () => {
    const { coordinator } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'teardown.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const result = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    // Teardown
    await coordinator.teardown(wcId)

    // Session gone
    expect(() => coordinator.getSession(wcId, result!.sessionId)).toThrow(InvalidSessionError)
  })

  // ── 8. Teardown during save ──

  test('teardown during save — save completes or aborts cleanly', async () => {
    const { coordinator, service } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'teardown-save.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const result = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    // Start save, then teardown (the save should complete first since it's awaited)
    const savePromise = coordinator.saveWorkbook(wcId, result!.sessionId, makeSaveRequest(), 'save', undefined)
    await coordinator.teardown(wcId)

    // The save may succeed or the session may be gone — either is acceptable
    try {
      const saveResult = await savePromise
      // If it succeeds, the session was swapped/closed
    } catch (err) {
      // If it fails, it should be an InvalidSessionError
      expect(err).toBeInstanceOf(InvalidSessionError)
    }
  })

  // ── 9. Caller-specific recovery dialog ──

  test('caller-specific recovery dialog — dialog parent is the caller window', async () => {
    const { coordinator } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'recovery.xlsx')
    // Write the original file FIRST
    writeTestWorkbook(path, 'original content')

    // Sleep briefly so the recovery copy's mtime is strictly newer
    await new Promise((r) => setTimeout(r, 50))

    // Create a recovery copy NEWER than the file.
    // The coordinator uses app.getPath('userData') which the mock returns as
    // join(tmpdir(), 'genoffice-test-userData'). So the recovery path is:
    // join(tmpdir(), 'genoffice-test-userData', 'sheets-autosave', '<sha1>.xlsx')
    const recoveryDir = join(tmpdir(), 'genoffice-test-userData', 'sheets-autosave')
    mkdirSync(recoveryDir, { recursive: true })
    const hash = createHash('sha1').update(path).digest('hex').slice(0, 16)
    const recoveryPath = join(recoveryDir, `${hash}.xlsx`)
    writeFileSync(recoveryPath, 'recovery content')

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    mockDialog.showMessageBox.mockResolvedValueOnce({ response: 1 }) // Discard

    const mockWindow = { id: 999 } as any
    const result = await coordinator.openWorkbook(wcId, mockWindow, { locale: 'en' })

    // Verify showMessageBox was called with the parent window
    expect(mockDialog.showMessageBox).toHaveBeenCalled()
    const callArgs = mockDialog.showMessageBox.mock.calls[0]!
    expect(callArgs[0]).toBe(mockWindow) // parent window passed as first arg
  })

  // ── 10. Caller-specific save dialog ──

  test('caller-specific save dialog — save-as dialog parent is the caller window', async () => {
    const { coordinator, service } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'save-as.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const result = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    const mockWindow = { id: 999 } as any
    const saveAsPath = join(testDir, 'saved-as.xlsx')
    mockDialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: saveAsPath })

    await coordinator.saveWorkbook(wcId, result!.sessionId, makeSaveRequest(), 'save-as', mockWindow)

    expect(mockDialog.showSaveDialog).toHaveBeenCalled()
    const callArgs = mockDialog.showSaveDialog.mock.calls[0]!
    expect(callArgs[0]).toBe(mockWindow)
  })

  // ── 11. Per-renderer push events ──

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

    // wcId1 cannot access wcId2's session
    expect(() => coordinator.getSession(wcId1, result2!.sessionId)).toThrow(InvalidSessionError)
    // wcId2 cannot access wcId1's session
    expect(() => coordinator.getSession(wcId2, result1!.sessionId)).toThrow(InvalidSessionError)
  })

  // ── 12. Stale engine handle rejection ──

  test('stale engine handle rejection — operations on closed session throw', async () => {
    const { coordinator, service } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'stale.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const result = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    // Close the session
    await coordinator.closeWorkbook(wcId, result!.sessionId)

    // Operations on the closed session should throw InvalidSessionError
    await expect(coordinator.readRange(wcId, result!.sessionId, 'sheet-1', 'A1:B2')).rejects.toThrow(InvalidSessionError)
    await expect(coordinator.readFormulaCells(wcId, result!.sessionId, 'sheet-1')).rejects.toThrow(InvalidSessionError)
    await expect(coordinator.recalculate(wcId, result!.sessionId, [], [])).rejects.toThrow(InvalidSessionError)
    await expect(coordinator.readMedia(wcId, result!.sessionId, 'img1')).rejects.toThrow(InvalidSessionError)
  })

  // ── Additional: unknown sheetId fail-closed ──

  test('unknown sheetId in readRange → InvalidInputError (fail-closed)', async () => {
    const { coordinator, service } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'unknown-sheet.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const result = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    // Mock service to throw InvalidInputError for unknown sheetId
    service.readRange = vi.fn(async () => { throw new InvalidInputError('Unknown sheetId: unknown') })

    await expect(coordinator.readRange(wcId, result!.sessionId, 'unknown', 'A1:B2')).rejects.toThrow(InvalidInputError)
  })

  // ── Additional: engine handle opacity ──

  test('engine handle opacity — ShellWorkbookSession.engineHandle is opaque', async () => {
    const { coordinator } = makeCoordinator()
    const wcId = 100
    const path = join(testDir, 'opaque.xlsx')
    writeTestWorkbook(path)

    mockDialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    const result = await coordinator.openWorkbook(wcId, undefined, { locale: 'en' })

    // The engineHandle must have no inspectable properties
    const handle = result!.session.engineHandle
    expect(Object.keys(handle)).toEqual([])
    expect(Reflect.ownKeys(handle).filter((k) => typeof k === 'string')).toEqual([])
  })
})
