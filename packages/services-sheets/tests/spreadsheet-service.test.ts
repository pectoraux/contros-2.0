/**
 * Service-level tests for SpreadsheetServiceImpl (Increment 3A correction).
 *
 * Uses a mock SpreadsheetEngine — does NOT use ElectronXlsxSidecarEngine.
 *
 * Coverage:
 *   - open: session + engineHandle + metadata, workbookName field
 *   - readRange, readFormulaCells, recalculate, readMedia (session-scoped)
 *   - save: unchanged (permitted), changed/unknown (refused), engine error
 *     propagation
 *   - writeRecovery: returns bytes on success; throws typed error on failure
 *   - close: void on success; throws typed error on failure
 *
 * ERROR PROPAGATION (Increment 3A):
 *   Each test verifies that the correct TYPED error reaches the service
 *   caller — the service does NOT swallow engine exceptions into null or
 *   { ok: false }. Coverage:
 *     - engine open failure        → EngineError (INTERNAL_ERROR)
 *     - engine protocol error      → EngineError (PROTOCOL_ERROR)
 *     - engine invalid session     → InvalidSessionError
 *     - engine close failure       → EngineError (propagates)
 *     - engine recovery failure    → EngineError (propagates)
 *     - save engine failure        → EngineError (propagates, NOT ok: false)
 *
 * DOMAIN-EVENT PURITY (Increment 3A):
 *   No `onOpened` / `onRenamed` / `onTeardown` / `SheetsEventBus` tests —
 *   the shell coordinator owns event routing. The service is domain-only.
 */
import { describe, test, expect, vi } from 'vitest'
import { SpreadsheetServiceImpl, type SpreadsheetServiceDeps } from '../src/spreadsheet-service.js'
import type {
  SpreadsheetEngine,
  EngineSessionHandle,
  WorkbookMetadata,
  WorksheetMetadata,
  EngineRangeResult,
  EngineFormulaCellsResult,
  EngineRecalcResult,
  EngineMediaResult,
} from '@genoffice/runtime-contracts'
import { EngineError, InvalidSessionError, InvalidInputError } from '@genoffice/runtime-contracts'

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

function makeService(engine?: ReturnType<typeof makeMockEngine>) {
  const eng = engine ?? makeMockEngine()
  const deps: SpreadsheetServiceDeps = { engine: eng }
  const service = new SpreadsheetServiceImpl(deps)
  return { service, engine: eng }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('SpreadsheetServiceImpl', () => {
  // ── open ──────────────────────────────────────────────────────────

  describe('open', () => {
    test('returns session + engineHandle + metadata', async () => {
      const { service, engine } = makeService()
      const result = await service.open(new Uint8Array([1, 2, 3]), 'en', 'test.xlsx')
      expect(result.session.workbookName).toBe('test.xlsx')
      expect(result.session.workbookHash).toBe('abc123')
      expect(result.session.sheetNames.size).toBe(1)
      expect(result.engineHandle).toBe(engine._handle)
      expect(result.metadata.name).toBe('test.xlsx')
    })

    test('engine open failure → throws EngineError with INTERNAL_ERROR code', async () => {
      const engine = makeMockEngine()
      engine.open = vi.fn(async () => { throw new EngineError('fail', 'INTERNAL_ERROR') })
      const { service } = makeService(engine)
      await expect(service.open(new Uint8Array([1]), 'en', 'test.xlsx')).rejects.toThrow(EngineError)
      await expect(service.open(new Uint8Array([1]), 'en', 'test.xlsx')).rejects.toMatchObject({
        name: 'EngineError',
        code: 'INTERNAL_ERROR',
      })
    })

    test('engine protocol error → throws EngineError with PROTOCOL_ERROR code', async () => {
      const engine = makeMockEngine()
      engine.open = vi.fn(async () => { throw new EngineError('protocol', 'PROTOCOL_ERROR') })
      const { service } = makeService(engine)
      await expect(service.open(new Uint8Array([1]), 'en', 'test.xlsx')).rejects.toMatchObject({
        name: 'EngineError',
        code: 'PROTOCOL_ERROR',
      })
    })

    test('engine invalid session → throws InvalidSessionError', async () => {
      const engine = makeMockEngine()
      engine.open = vi.fn(async () => { throw new InvalidSessionError('invalid') })
      const { service } = makeService(engine)
      await expect(service.open(new Uint8Array([1]), 'en', 'test.xlsx')).rejects.toBeInstanceOf(InvalidSessionError)
    })

    test('invalid workbook input → throws InvalidInputError (distinguishable from engine failure)', async () => {
      const engine = makeMockEngine()
      engine.open = vi.fn(async () => { throw new InvalidInputError('not a valid xlsx') })
      const { service } = makeService(engine)
      await expect(service.open(new Uint8Array([1]), 'en', 'test.xlsx')).rejects.toBeInstanceOf(InvalidInputError)
      // Verify the caller can distinguish InvalidInputError from generic EngineError
      try {
        await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidInputError)
        expect(err).toBeInstanceOf(EngineError)
        expect((err as EngineError).code).toBe('INVALID_INPUT')
      }
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

    test('engine failure → throws EngineError (not swallowed)', async () => {
      const engine = makeMockEngine()
      engine.readRange = vi.fn(async () => { throw new EngineError('range fail', 'INTERNAL_ERROR') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await expect(service.readRange(opened!.session, opened!.engineHandle, 'Sheet1', 'A1:B2')).rejects.toThrow(EngineError)
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

  // ── readMedia (session-scoped, per Increment 3A) ────────────────

  describe('readMedia', () => {
    test('delegates to engine with engineHandle + visualId (session accepted for consistency)', async () => {
      const { service, engine } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await service.readMedia(opened!.session, opened!.engineHandle, 'img1')
      expect(engine.readMedia).toHaveBeenCalledWith(engine._handle, 'img1')
    })

    test('engine failure → throws EngineError (not swallowed)', async () => {
      const engine = makeMockEngine()
      engine.readMedia = vi.fn(async () => { throw new EngineError('media fail', 'INTERNAL_ERROR') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await expect(service.readMedia(opened!.session, opened!.engineHandle, 'img1')).rejects.toThrow(EngineError)
    })
  })

  // ── save: external-change policy + engine error propagation ──────

  describe('save', () => {
    test('unchanged → save permitted, returns data', async () => {
      const { service, engine } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      const result = await service.save(opened!.session, opened!.engineHandle, { patches: [] }, 'unchanged')
      expect(result.ok).toBe(true)
      expect(result.data).toBeInstanceOf(Uint8Array)
      expect(engine.saveArchive).toHaveBeenCalledWith(engine._handle, [])
    })

    test('changed → save refused with external-modified (legitimate business outcome)', async () => {
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

    test('engine failure → throws EngineError (NOT converted to { ok: false })', async () => {
      const engine = makeMockEngine()
      engine.saveArchive = vi.fn(async () => { throw new EngineError('save failed', 'INTERNAL_ERROR') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      // The error must propagate as a typed EngineError — the caller
      // must NOT see { ok: false, error: '...' }. This is the
      // Increment 3A error-semantics requirement.
      await expect(service.save(opened!.session, opened!.engineHandle, { patches: [] }, 'unchanged')).rejects.toThrow(EngineError)
      await expect(service.save(opened!.session, opened!.engineHandle, { patches: [] }, 'unchanged')).rejects.toMatchObject({
        name: 'EngineError',
        code: 'INTERNAL_ERROR',
      })
    })

    test('engine protocol error → throws EngineError with PROTOCOL_ERROR (distinguishable from engine failure)', async () => {
      const engine = makeMockEngine()
      engine.saveArchive = vi.fn(async () => { throw new EngineError('protocol', 'PROTOCOL_ERROR') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await expect(service.save(opened!.session, opened!.engineHandle, { patches: [] }, 'unchanged')).rejects.toMatchObject({
        name: 'EngineError',
        code: 'PROTOCOL_ERROR',
      })
    })

    test('engine invalid session → throws InvalidSessionError (distinguishable from engine failure)', async () => {
      const engine = makeMockEngine()
      engine.saveArchive = vi.fn(async () => { throw new InvalidSessionError('session expired') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await expect(service.save(opened!.session, opened!.engineHandle, { patches: [] }, 'unchanged')).rejects.toBeInstanceOf(InvalidSessionError)
    })
  })

  // ── writeRecovery: returns bytes on success; throws on failure ───

  describe('writeRecovery', () => {
    test('returns archive bytes for recovery', async () => {
      const { service } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      const data = await service.writeRecovery(opened!.session, opened!.engineHandle, { patches: [] })
      expect(data).toBeInstanceOf(Uint8Array)
    })

    test('engine failure → throws EngineError (NOT converted to { ok: false })', async () => {
      const engine = makeMockEngine()
      engine.saveArchive = vi.fn(async () => { throw new EngineError('recovery fail', 'INTERNAL_ERROR') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await expect(service.writeRecovery(opened!.session, opened!.engineHandle, { patches: [] })).rejects.toThrow(EngineError)
    })

    test('engine protocol error → throws EngineError with PROTOCOL_ERROR', async () => {
      const engine = makeMockEngine()
      engine.saveArchive = vi.fn(async () => { throw new EngineError('protocol', 'PROTOCOL_ERROR') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await expect(service.writeRecovery(opened!.session, opened!.engineHandle, { patches: [] })).rejects.toMatchObject({
        name: 'EngineError',
        code: 'PROTOCOL_ERROR',
      })
    })

    test('engine invalid session → throws InvalidSessionError', async () => {
      const engine = makeMockEngine()
      engine.saveArchive = vi.fn(async () => { throw new InvalidSessionError('session expired') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await expect(service.writeRecovery(opened!.session, opened!.engineHandle, { patches: [] })).rejects.toBeInstanceOf(InvalidSessionError)
    })
  })

  // ── close: void on success; throws on failure ────────────────────

  describe('close', () => {
    test('delegates to engine.close and returns void on success', async () => {
      const { service, engine } = makeService()
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await service.close(opened!.engineHandle)
      expect(engine.close).toHaveBeenCalledWith(engine._handle)
    })

    test('engine failure → throws EngineError (NOT converted to { ok: false })', async () => {
      const engine = makeMockEngine()
      engine.close = vi.fn(async () => { throw new EngineError('close fail', 'INTERNAL_ERROR') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await expect(service.close(opened!.engineHandle)).rejects.toThrow(EngineError)
    })

    test('engine invalid session → throws InvalidSessionError', async () => {
      const engine = makeMockEngine()
      engine.close = vi.fn(async () => { throw new InvalidSessionError('already closed') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await expect(service.close(opened!.engineHandle)).rejects.toBeInstanceOf(InvalidSessionError)
    })

    test('engine protocol error → throws EngineError with PROTOCOL_ERROR', async () => {
      const engine = makeMockEngine()
      engine.close = vi.fn(async () => { throw new EngineError('protocol', 'PROTOCOL_ERROR') })
      const { service } = makeService(engine)
      const opened = await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
      await expect(service.close(opened!.engineHandle)).rejects.toMatchObject({
        name: 'EngineError',
        code: 'PROTOCOL_ERROR',
      })
    })
  })

  // ── Error model: caller can distinguish all failure modes ─────────

  describe('error model — caller can distinguish all failure modes', () => {
    test('open() failure modes are distinguishable by error class + code', async () => {
      const cases = [
        { make: () => new InvalidInputError('bad bytes'), expectedClass: InvalidInputError, expectedCode: 'INVALID_INPUT' },
        { make: () => new InvalidSessionError('no session'), expectedClass: InvalidSessionError, expectedCode: 'INVALID_SESSION' },
        { make: () => new EngineError('engine', 'INTERNAL_ERROR'), expectedClass: EngineError, expectedCode: 'INTERNAL_ERROR' },
        { make: () => new EngineError('protocol', 'PROTOCOL_ERROR'), expectedClass: EngineError, expectedCode: 'PROTOCOL_ERROR' },
      ]

      for (const { make, expectedClass, expectedCode } of cases) {
        const engine = makeMockEngine()
        engine.open = vi.fn(async () => { throw make() })
        const { service } = makeService(engine)
        try {
          await service.open(new Uint8Array([1]), 'en', 'test.xlsx')
          expect.fail('open() should have thrown')
        } catch (err) {
          expect(err).toBeInstanceOf(expectedClass)
          expect((err as EngineError).code).toBe(expectedCode)
        }
      }
    })
  })
})
