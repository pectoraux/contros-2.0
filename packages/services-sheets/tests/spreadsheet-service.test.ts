/**
 * Service-level tests for SpreadsheetServiceImpl.
 *
 * Uses a mock SpreadsheetEngine — does NOT use ElectronXlsxSidecarEngine.
 * Tests:
 *   open, readRange, readFormulaCells, recalculate, readMedia,
 *   save (unchanged/changed/unknown), writeRecovery, close,
 *   invalid engine handle, engine errors.
 */
import { describe, test, expect, vi } from 'vitest'
import { SpreadsheetServiceImpl, type SpreadsheetServiceDeps, type SheetsEventBus } from '../src/spreadsheet-service.js'
import type {
  SpreadsheetEngine,
  EngineSessionHandle,
  WorkbookMetadata,
  WorksheetMetadata,
  EngineRangeResult,
  EngineFormulaCellsResult,
  EngineRecalcResult,
  EngineMediaResult,
  ExternalChangeStatus,
  EngineError,
} from '@genoffice/runtime-contracts'
import { EngineError as EngineErrorClass, InvalidSessionError } from '@genoffice/runtime-contracts'

// ── Mock helpers ──────────────────────────────────────────────────────

function makeMockHandle(): EngineSessionHandle {
  return { [Symbol('brand')]: Symbol('brand') } as unknown as EngineSessionHandle
}

function makeMockMetadata(): WorkbookMetadata {
  return {
    name: 'test.xlsx',
    sha256: 'abc123',
    entryCount: 10,
    sheets: [
      { name: 'Sheet1', index: 0, hidden: false, rtl: false, showGridlines: true, rowCount: 100, columnCount: 26, defaultRowHeight: 15, defaultColumnWidth: 8.43 },
    ] as WorksheetMetadata[],
    activeTab: 0,
    definedNames: [],
    themeColors: [],
    themeFonts: { major: '', minor: '' },
  }
}

function makeMockEngine(): SpreadsheetEngine & { _handle: EngineSessionHandle } {
  const handle = makeMockHandle()
  return {
    _handle: handle,
    open: vi.fn(async () => ({ handle, metadata: makeMockMetadata() })),
    readRange: vi.fn(async () => ({ cells: [], rows: [], merges: [], columns: [], hyperlinks: [], conditionalFormatting: [], dataValidation: [], rowBreaks: [], columnBreaks: [], sheetProtection: false }) as EngineRangeResult),
    readFormulaCells: vi.fn(async () => ({ cells: [] }) as EngineFormulaCellsResult),
    recalculate: vi.fn(async () => ({ cells: [] }) as EngineRecalcResult),
    readMedia: vi.fn(async () => ({ mediaType: 'image/png', base64: 'iVBOR' }) as EngineMediaResult),
    saveArchive: vi.fn(async () => new Uint8Array([1, 2, 3])),
    convertWorkbook: vi.fn(async () => ({ data: new Uint8Array([1]), fileName: 'converted.xlsx' })),
    close: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  }
}

function makeMockEventBus(): SheetsEventBus {
  return {
    opened: vi.fn(),
    renamed: vi.fn(),
    teardown: vi.fn(),
  }
}

function makeService(engine?: ReturnType<typeof makeMockEngine>) {
  const eng = engine ?? makeMockEngine()
  const deps: SpreadsheetServiceDeps = { engine: eng }
  const eventBus = makeMockEventBus()
  const service = new SpreadsheetServiceImpl(deps, eventBus)
  return { service, engine: eng, eventBus }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('SpreadsheetServiceImpl', () => {
  // ── open ──────────────────────────────────────────────────────────

  describe('open', () => {
    test('returns session + engineHandle + metadata', async () => {
      const { service, engine } = makeService()
      const result = await service.open(new Uint8Array([1, 2, 3]), 'en', 'test.xlsx')
      expect(result).not.toBeNull()
      expect(result!.session.workbookPath).toBe('test.xlsx')
      expect(result!.session.workbookHash).toBe('abc123')
      expect(result!.session.sheetNames.size).toBe(1)
      expect(result!.engineHandle).toBe(engine._handle)
      expect(result!.metadata.name).toBe('test.xlsx')
    })

    test('fires opened event', async () => {
      const { service, eventBus } = makeService()
      await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      expect(eventBus.opened).toHaveBeenCalledTimes(1)
    })

    test('returns null on engine error', async () => {
      const engine = makeMockEngine()
      engine.open = vi.fn(async () => { throw new EngineErrorClass('fail', 'INTERNAL_ERROR') })
      const { service } = makeService(engine)
      const result = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      expect(result).toBeNull()
    })
  })

  // ── readRange ─────────────────────────────────────────────────────

  describe('readRange', () => {
    test('delegates to engine with resolved sheet name', async () => {
      const { service, engine } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await service.readRange(opened!.session, opened!.engineHandle, 'Sheet1', 'A1:B2')
      expect(engine.readRange).toHaveBeenCalledWith(engine._handle, 'Sheet1', 'A1:B2')
    })
  })

  // ── readFormulaCells ─────────────────────────────────────────────

  describe('readFormulaCells', () => {
    test('delegates to engine', async () => {
      const { service, engine } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await service.readFormulaCells(opened!.session, opened!.engineHandle, 'Sheet1')
      expect(engine.readFormulaCells).toHaveBeenCalledWith(engine._handle, 'Sheet1')
    })
  })

  // ── recalculate ──────────────────────────────────────────────────

  describe('recalculate', () => {
    test('resolves sheet ids and delegates to engine', async () => {
      const { service, engine } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      const edits = [{ sheetName: 'Sheet1', row: 0, column: 0, value: '42' }]
      const reads = [{ sheetName: 'Sheet1', row: 0, column: 0 }]
      await service.recalculate(opened!.session, opened!.engineHandle, edits, reads)
      expect(engine.recalculate).toHaveBeenCalledWith(
        engine._handle,
        [{ sheetName: 'Sheet1', row: 0, column: 0, value: '42' }],
        [{ sheetName: 'Sheet1', row: 0, column: 0 }],
      )
    })
  })

  // ── readMedia ────────────────────────────────────────────────────

  describe('readMedia', () => {
    test('delegates to engine', async () => {
      const { service, engine } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await service.readMedia(opened!.engineHandle, 'img1')
      expect(engine.readMedia).toHaveBeenCalledWith(engine._handle, 'img1')
    })
  })

  // ── save: external-change policy ──────────────────────────────────

  describe('save', () => {
    test('unchanged → save permitted, returns data', async () => {
      const { service, engine } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      const result = await service.save(opened!.session, opened!.engineHandle, { patches: [] }, 'unchanged')
      expect(result.ok).toBe(true)
      expect(result.data).toBeInstanceOf(Uint8Array)
      expect(engine.saveArchive).toHaveBeenCalledWith(engine._handle, [])
    })

    test('changed → save refused with external-modified', async () => {
      const { service, engine } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      const result = await service.save(opened!.session, opened!.engineHandle, { patches: [] }, 'changed')
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('external-modified')
      expect(engine.saveArchive).not.toHaveBeenCalled()
    })

    test('unknown → save refused (safe default)', async () => {
      const { service, engine } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      const result = await service.save(opened!.session, opened!.engineHandle, { patches: [] }, 'unknown')
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('external-modified')
      expect(engine.saveArchive).not.toHaveBeenCalled()
    })

    test('engine error → save fails gracefully', async () => {
      const engine = makeMockEngine()
      engine.saveArchive = vi.fn(async () => { throw new EngineErrorClass('save failed', 'INTERNAL_ERROR') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      const result = await service.save(opened!.session, opened!.engineHandle, { patches: [] }, 'unchanged')
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  // ── writeRecovery ────────────────────────────────────────────────

  describe('writeRecovery', () => {
    test('returns archive bytes for recovery', async () => {
      const { service } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      const result = await service.writeRecovery(opened!.session, opened!.engineHandle, { patches: [] })
      expect(result.ok).toBe(true)
      expect(result.data).toBeInstanceOf(Uint8Array)
    })

    test('engine error → recovery fails gracefully', async () => {
      const engine = makeMockEngine()
      engine.saveArchive = vi.fn(async () => { throw new Error('fail') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      const result = await service.writeRecovery(opened!.session, opened!.engineHandle, { patches: [] })
      expect(result.ok).toBe(false)
    })
  })

  // ── close ────────────────────────────────────────────────────────

  describe('close', () => {
    test('delegates to engine.close', async () => {
      const { service, engine } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      const result = await service.close(opened!.engineHandle)
      expect(result.ok).toBe(true)
      expect(engine.close).toHaveBeenCalledWith(engine._handle)
    })

    test('engine error → close fails gracefully', async () => {
      const engine = makeMockEngine()
      engine.close = vi.fn(async () => { throw new Error('fail') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      const result = await service.close(opened!.engineHandle)
      expect(result.ok).toBe(false)
    })
  })

  // ── domain events ────────────────────────────────────────────────

  describe('domain events', () => {
    test('onOpened handler receives result', async () => {
      const { service } = makeService()
      const handler = vi.fn()
      service.onOpened(handler)
      const result = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      expect(handler).toHaveBeenCalledWith(result)
    })

    test('onOpened unsubscribe works', async () => {
      const { service } = makeService()
      const handler = vi.fn()
      const unsub = service.onOpened(handler)
      unsub()
      await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      expect(handler).not.toHaveBeenCalled()
    })
  })
})
