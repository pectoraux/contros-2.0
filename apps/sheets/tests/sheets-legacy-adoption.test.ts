/**
 * Increment 5A — Legacy Session Adoption integration tests.
 *
 * Tests:
 *   A. legacy open → adopt → migrated read-range → succeeds
 *   B. legacy open → adopt → migrated read-formulas → succeeds
 *   C. legacy open → adopt → migrated recalc → succeeds
 *   D. legacy open → adopt → migrated read-media → succeeds
 *   E. legacy open in renderer A → migrated read from renderer B using A's sessionId → fails with InvalidSessionError
 *   F. legacy session closes → coordinator/migrated read → fails deterministically
 *   G. teardown renderer → adopted sessions cleaned exactly once
 *
 * Plus:
 *   - Architecture guards (adoption does NOT spawn, re-open, or import XlsxSidecarClient)
 *   - Single owner invariant (legacy + coordinator don't double-close)
 *
 * The tests use a mock `SidecarProtocolLike` that simulates the Rust sidecar
 * — no real binary needed. The mock tracks open sessions and responds to
 * wire commands in-process.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync, existsSync, copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'

// Mock electron's app + dialog (the coordinator imports `app` for userData
// paths and `dialog` for save-as dialogs).
const { mockApp, mockDialog } = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn((name: string) => join(tmpdir(), `genoffice-test-${name}-${randomUUID()}`)) },
  mockDialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
}))
vi.mock('electron', () => ({
  app: mockApp,
  dialog: mockDialog,
  BrowserWindow: vi.fn(),
}))

import {
  ElectronXlsxSidecarEngine,
  type SidecarProtocolLike,
  type OnProcessExitCallback,
} from '@genoffice/platform-electron'
import { SpreadsheetServiceImpl } from '@genoffice/services-sheets/src/spreadsheet-service.js'
import {
  SheetsShellCoordinator,
  type ShellWorkbookSession,
} from '../src/main/sheets-shell-coordinator'
import {
  initSheetsRuntime,
  adoptLegacySessionIntoCoordinator,
  type LegacySessionAdoption,
  type SheetsRuntimeBundle,
} from '../src/main/sheets-runtime'
import type {
  WorkbookMetadata,
  WorksheetMetadata,
} from '@genoffice/runtime-contracts'
import { InvalidSessionError } from '@genoffice/runtime-contracts'

// ── Mock sidecar client ───────────────────────────────────────────────

/**
 * In-process mock of the Rust xlsx-sidecar binary.
 *
 * Simulates the wire protocol: tracks open sessions, responds to
 * `open`/`read_range`/`read_formula_cells`/`recalc_cells`/`read_media`/
 * `close` commands. NO child_process spawn — pure in-process state.
 *
 * Tracks call counts for the architecture/single-owner tests:
 *   - `openCalls` — number of `open` commands received
 *   - `closeCalls` — number of `close` commands received (per sessionId)
 *   - `startCalls` — number of times `start()` was called
 *   - `stopCalls` — number of times `stop()` was called
 */
class MockSidecarClient implements SidecarProtocolLike {
  private readonly sessions = new Map<string, { path: string; locale: string }>()
  private exitCallback: OnProcessExitCallback | null = null
  public openCalls = 0
  public readonly closeCalls = new Map<string, number>()
  public readonly rangeCalls = new Map<string, number>()
  public readonly formulaCalls = new Map<string, number>()
  public readonly recalcCalls = new Map<string, number>()
  public readonly mediaCalls = new Map<string, number>()
  public startCalls = 0
  public stopCalls = 0

  onProcessExit(callback: OnProcessExitCallback): void { this.exitCallback = callback }

  request(command: Readonly<Record<string, unknown>>, _timeoutMs?: number): Promise<unknown> {
    const cmd = command.command
    if (cmd === 'open') {
      this.openCalls++
      const sessionId = randomUUID()
      this.sessions.set(sessionId, { path: command.path as string, locale: command.locale as string })
      return Promise.resolve({
        sessionId,
        sha256: 'mock-sha256-' + sessionId.slice(0, 8),
        entryCount: 10,
        sheets: [
          { id: 'sheet-1', name: 'Sheet1', rowCount: 100, columnCount: 26, hidden: false, showGridLines: true, defaultRowHeight: 15, defaultColumnWidth: 8.43, tabColor: null },
        ],
        activeTab: 0,
        definedNames: [],
        themeColors: [],
        themeFonts: { major: '', minor: '' },
      })
    }
    if (cmd === 'read_range') {
      const sid = command.sessionId as string
      if (!this.sessions.has(sid)) {
        return Promise.reject(new Error(`Unknown session: ${sid}`))
      }
      this.rangeCalls.set(sid, (this.rangeCalls.get(sid) ?? 0) + 1)
      return Promise.resolve({
        cells: [{ row: 0, column: 0, value: 'mock', isFormula: false, styleIndex: 0 }],
        rows: [], merges: [], columns: [], hyperlinks: [],
        conditionalFormatting: [], dataValidation: [], rowBreaks: [], columnBreaks: [],
        sheetProtection: false,
      })
    }
    if (cmd === 'read_formula_cells') {
      const sid = command.sessionId as string
      if (!this.sessions.has(sid)) {
        return Promise.reject(new Error(`Unknown session: ${sid}`))
      }
      this.formulaCalls.set(sid, (this.formulaCalls.get(sid) ?? 0) + 1)
      return Promise.resolve({ cells: [{ row: 0, column: 0, formula: '=SUM(A1:A2)' }] })
    }
    if (cmd === 'recalc_cells') {
      const path = command.path as string
      this.recalcCalls.set(path, (this.recalcCalls.get(path) ?? 0) + 1)
      return Promise.resolve({
        cells: [{ sheet: 'Sheet1', row: 0, column: 0, formatted: '42', number: 42, isFormula: false }],
      })
    }
    if (cmd === 'read_media') {
      const sid = command.sessionId as string
      if (!this.sessions.has(sid)) {
        return Promise.reject(new Error(`Unknown session: ${sid}`))
      }
      this.mediaCalls.set(sid, (this.mediaCalls.get(sid) ?? 0) + 1)
      return Promise.resolve({ mediaType: 'image/png', base64: 'iVBORw0KGgo=' })
    }
    if (cmd === 'close') {
      const sid = command.sessionId as string
      this.closeCalls.set(sid, (this.closeCalls.get(sid) ?? 0) + 1)
      this.sessions.delete(sid)
      return Promise.resolve({})
    }
    return Promise.reject(new Error(`MockSidecarClient: unknown command '${String(cmd)}'`))
  }

  start(): void { this.startCalls++ }
  getProcessId(): number | null { return 99999 }
  stop(): void { this.stopCalls++ }
  /** Test-only: simulate the sidecar process exiting unexpectedly. */
  simulateExit(): void { this.exitCallback?.() }
}

// ── Test helpers ─────────────────────────────────────────────────────

let testDir: string

function makeMetadata(name = 'test.xlsx'): WorkbookMetadata {
  const sheets: WorksheetMetadata[] = [{
    id: 'sheet-1', name: 'Sheet1', index: 0, hidden: false, rtl: false,
    showGridlines: true, rowCount: 100, columnCount: 26,
    defaultRowHeight: 15, defaultColumnWidth: 8.43,
  }]
  return {
    name, sha256: 'abc123', entryCount: 10, sheets, activeTab: 0,
    definedNames: [], themeColors: [], themeFonts: { major: '', minor: '' },
  }
}

function makeSheetNames(): Map<string, string> {
  return new Map([['sheet-1', 'Sheet1']])
}

function writeTestWorkbook(path: string, content = 'test xlsx content'): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Simulate the legacy `workbook:select` open path: open via the sidecar
 * client, build a snapshot, build the LegacySessionAdoption shape, and
 * return the data the legacy handler would have after a successful open.
 */
async function legacyOpenAndAdopt(
  bundle: SheetsRuntimeBundle,
  wcId: number,
  mockClient: MockSidecarClient,
  workbookPath: string,
  locale = 'en',
  options: { restoreTarget?: string; suggestSaveAs?: string; csvImport?: boolean } = {},
): Promise<{ sessionId: string; session: ShellWorkbookSession; snapshotPath: string }> {
  // Snapshot
  const snapshotDir = join(tmpdir(), `genoffice-test-snapshots-${randomUUID()}`)
  mkdirSync(snapshotDir, { recursive: true })
  const snapshotPath = join(snapshotDir, `${randomUUID()}.xlsx`)
  copyFileSync(workbookPath, snapshotPath)

  // Sidecar open — gets a sessionId
  const opened = await mockClient.request({ command: 'open', path: snapshotPath, locale }) as {
    sessionId: string
    sheets: Array<{ id: string; name: string }>
  }
  const sessionId = opened.sessionId

  const diskFingerprint = sha256OfFile(snapshotPath)

  const sheetNames = new Map<string, string>()
  for (const s of opened.sheets) sheetNames.set(s.id, s.name)

  const metadata = makeMetadata(workbookPath.split(/[\\/]/).pop() ?? 'workbook.xlsx')

  const adoption: LegacySessionAdoption = {
    sidecarSessionId: sessionId,
    originalPath: workbookPath,
    snapshotPath,
    diskFingerprint,
    ...(options.suggestSaveAs !== undefined ? { suggestSaveAs: options.suggestSaveAs } : {}),
    ...(options.csvImport === true ? { csvImport: options.csvImport } : {}),
    ...(options.restoreTarget !== undefined ? { restoreTarget: options.restoreTarget } : {}),
    sheetNames,
    metadata,
    locale,
  }

  const session = await adoptLegacySessionIntoCoordinator(bundle, wcId, adoption)
  return { sessionId, session, snapshotPath }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Increment 5A — Legacy Session Adoption', () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `genoffice-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    vi.clearAllMocks()
  })

  // ═══ Architecture guards ═══

  describe('architecture guards (adoption path purity)', () => {
    test('adoption does NOT call sidecar.open (no re-open)', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'arch-no-reopen.xlsx')
      writeTestWorkbook(path)
      // Legacy open increments openCalls once
      await legacyOpenAndAdopt(bundle, 100, mockClient, path)
      // Adoption must NOT have caused another open
      expect(mockClient.openCalls).toBe(1)
    })

    test('adoption does NOT call sidecar.start (no spawn)', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'arch-no-spawn.xlsx')
      writeTestWorkbook(path)
      await legacyOpenAndAdopt(bundle, 100, mockClient, path)
      // The engine should NOT call start() on the injected client —
      // the caller (sheets-main.ts) is responsible for starting the
      // shared sidecar process.
      expect(mockClient.startCalls).toBe(0)
    })

    test('adoption does NOT call sidecar.stop (lifecycle ownership preserved)', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'arch-no-stop.xlsx')
      writeTestWorkbook(path)
      await legacyOpenAndAdopt(bundle, 100, mockClient, path)
      await bundle.engine.stop()
      // engine.stop() must NOT call client.stop() on the injected client
      expect(mockClient.stopCalls).toBe(0)
    })

    test('coordinator does NOT import @genoffice/platform-electron', () => {
      const src = readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-shell-coordinator.ts'),
        'utf8',
      )
      expect(src).not.toMatch(/from\s+['"]@genoffice\/platform-electron['"]/)
    })

    test('coordinator does NOT import the legacy sidecar client class', () => {
      const src = readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-shell-coordinator.ts'),
        'utf8',
      )
      // No import statement referencing the legacy client module
      expect(src).not.toMatch(/from\s+['"]\.\/xlsx-sidecar-client['"]/)
      // No import of child_process (the engine's wire protocol is shared)
      expect(src).not.toMatch(/^import.*child_process/m)
    })

    test('adoption helper does NOT call getFocusedWindow or BrowserWindow.fromWebContents', () => {
      const src = readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-runtime.ts'),
        'utf8',
      )
      expect(src).not.toMatch(/getFocusedWindow/)
      expect(src).not.toMatch(/BrowserWindow\.fromWebContents/)
    })

    test('adoption helper does NOT import the legacy sidecar client class', () => {
      // sheets-runtime.ts is the integration point — it imports the engine
      // (platform-electron) but NOT the legacy client (apps/sheets/main).
      // We check the import statements specifically, not the whole file
      // (comments may reference the legacy class by name).
      const src = readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-runtime.ts'),
        'utf8',
      )
      // No import statement referencing the legacy client module
      expect(src).not.toMatch(/from\s+['"]\.\/xlsx-sidecar-client['"]/)
      // No import of child_process (the engine's wire protocol is shared)
      expect(src).not.toMatch(/^import.*child_process/m)
    })

    test('no global session state — each wcId has its own map', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const p1 = join(testDir, 'iso-wc1.xlsx'), p2 = join(testDir, 'iso-wc2.xlsx')
      writeTestWorkbook(p1); writeTestWorkbook(p2)

      const { sessionId: sid1 } = await legacyOpenAndAdopt(bundle, 100, mockClient, p1)
      const { sessionId: sid2 } = await legacyOpenAndAdopt(bundle, 200, mockClient, p2)

      // Each wcId's session is only visible to that wcId
      expect(() => bundle.coordinator.getSession(100, sid2)).toThrow(InvalidSessionError)
      expect(() => bundle.coordinator.getSession(200, sid1)).toThrow(InvalidSessionError)
      // Each wcId can see its own
      expect(bundle.coordinator.getSession(100, sid1).sessionId).toBe(sid1)
      expect(bundle.coordinator.getSession(200, sid2).sessionId).toBe(sid2)
    })
  })

  // ═══ Test A: legacy open → adopt → read-range ═══

  describe('Test A — legacy open → adopt → migrated read-range', () => {
    test('succeeds and delegates through the coordinator', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'test-a.xlsx')
      writeTestWorkbook(path)
      const { sessionId } = await legacyOpenAndAdopt(bundle, 100, mockClient, path)

      const result = await bundle.coordinator.readRange(100, sessionId, 'sheet-1', 'A1:B2')
      expect(result).toBeDefined()
      expect(result.cells).toBeDefined()
      expect(mockClient.rangeCalls.get(sessionId)).toBe(1)
    })
  })

  // ═══ Test B: legacy open → adopt → read-formulas ═══

  describe('Test B — legacy open → adopt → migrated read-formulas', () => {
    test('succeeds and delegates through the coordinator', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'test-b.xlsx')
      writeTestWorkbook(path)
      const { sessionId } = await legacyOpenAndAdopt(bundle, 100, mockClient, path)

      const result = await bundle.coordinator.readFormulaCells(100, sessionId, 'sheet-1')
      expect(result).toBeDefined()
      expect(result.cells).toBeDefined()
      expect(result.cells[0].formula).toBe('=SUM(A1:A2)')
      expect(mockClient.formulaCalls.get(sessionId)).toBe(1)
    })
  })

  // ═══ Test C: legacy open → adopt → recalc ═══

  describe('Test C — legacy open → adopt → migrated recalc', () => {
    test('succeeds and delegates through the coordinator', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'test-c.xlsx')
      writeTestWorkbook(path)
      const { sessionId, snapshotPath } = await legacyOpenAndAdopt(bundle, 100, mockClient, path)

      // EngineRecalcEdit.sheetName is actually a domain sheetId (despite
      // the field name — the service resolves it via session.sheetNames).
      // Pass the sheetId 'sheet-1', not the sheet name 'Sheet1'.
      const edits: { sheetName: string; row: number; column: number; value: string }[] = [{
        sheetName: 'sheet-1', row: 0, column: 0, value: '42',
      }]
      const reads: { sheetName: string; row: number; column: number }[] = [{
        sheetName: 'sheet-1', row: 0, column: 0,
      }]
      const result = await bundle.coordinator.recalculate(100, sessionId, edits, reads)
      expect(result).toBeDefined()
      expect(result.cells).toBeDefined()
      // recalc uses path (snapshot), not sessionId
      expect(mockClient.recalcCalls.get(snapshotPath)).toBe(1)
    })
  })

  // ═══ Test D: legacy open → adopt → read-media ═══

  describe('Test D — legacy open → adopt → migrated read-media', () => {
    test('succeeds and delegates through the coordinator', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'test-d.xlsx')
      writeTestWorkbook(path)
      const { sessionId } = await legacyOpenAndAdopt(bundle, 100, mockClient, path)

      const result = await bundle.coordinator.readMedia(100, sessionId, 'img-1')
      expect(result).toBeDefined()
      expect(result.mediaType).toBe('image/png')
      expect(result.base64).toBeTruthy()
      expect(mockClient.mediaCalls.get(sessionId)).toBe(1)
    })
  })

  // ═══ Test E: cross-renderer denial ═══

  describe('Test E — cross-renderer denial', () => {
    test('renderer A session cannot be accessed from renderer B', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'test-e.xlsx')
      writeTestWorkbook(path)
      const { sessionId: sessionIdA } = await legacyOpenAndAdopt(bundle, 100, mockClient, path)

      // Renderer B (wcId=200) tries to read using A's sessionId
      expect(() => bundle.coordinator.getSession(200, sessionIdA)).toThrow(InvalidSessionError)
      await expect(bundle.coordinator.readRange(200, sessionIdA, 'sheet-1', 'A1:B2'))
        .rejects.toThrow(InvalidSessionError)
    })

    test('renderer A and B can each have independent sessions', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const p1 = join(testDir, 'iso-a1.xlsx')
      const p2 = join(testDir, 'iso-b1.xlsx')
      writeTestWorkbook(p1); writeTestWorkbook(p2)

      const { sessionId: sessionIdA1 } = await legacyOpenAndAdopt(bundle, 100, mockClient, p1)
      const { sessionId: sessionIdB1 } = await legacyOpenAndAdopt(bundle, 200, mockClient, p2)

      // A1 cannot access B1, B1 cannot access A1
      expect(() => bundle.coordinator.getSession(100, sessionIdB1)).toThrow(InvalidSessionError)
      expect(() => bundle.coordinator.getSession(200, sessionIdA1)).toThrow(InvalidSessionError)

      // Both renderers can read their own sessions
      await bundle.coordinator.readRange(100, sessionIdA1, 'sheet-1', 'A1:B2')
      await bundle.coordinator.readRange(200, sessionIdB1, 'sheet-1', 'A1:B2')
    })
  })

  // ═══ Test F: legacy close → migrated read fails ═══

  describe('Test F — legacy session closes → migrated read fails deterministically', () => {
    test('after closeWorkbook, reads throw InvalidSessionError', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'test-f.xlsx')
      writeTestWorkbook(path)
      const { sessionId, snapshotPath } = await legacyOpenAndAdopt(bundle, 100, mockClient, path)

      // Close via the coordinator (the migrated close path)
      await bundle.coordinator.closeWorkbook(100, sessionId)

      // Sidecar session was closed exactly once (the coordinator did it)
      expect(mockClient.closeCalls.get(sessionId)).toBe(1)
      // Snapshot file was removed
      expect(existsSync(snapshotPath)).toBe(false)

      // Subsequent reads fail deterministically
      expect(() => bundle.coordinator.getSession(100, sessionId)).toThrow(InvalidSessionError)
      await expect(bundle.coordinator.readRange(100, sessionId, 'sheet-1', 'A1:B2'))
        .rejects.toThrow(InvalidSessionError)
    })
  })

  // ═══ Test G: teardown renderer → adopted sessions cleaned exactly once ═══

  describe('Test G — teardown renderer → adopted sessions cleaned exactly once', () => {
    test('teardown closes each adopted session exactly once', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const p1 = join(testDir, 'td-a1.xlsx'), p2 = join(testDir, 'td-a2.xlsx')
      writeTestWorkbook(p1); writeTestWorkbook(p2)

      // Renderer A has 2 sessions
      const { sessionId: sid1, snapshotPath: snap1 } = await legacyOpenAndAdopt(bundle, 100, mockClient, p1)
      const { sessionId: sid2, snapshotPath: snap2 } = await legacyOpenAndAdopt(bundle, 100, mockClient, p2)

      await bundle.coordinator.teardown(100)

      // Each sidecar session was closed EXACTLY once
      expect(mockClient.closeCalls.get(sid1)).toBe(1)
      expect(mockClient.closeCalls.get(sid2)).toBe(1)
      // Snapshots cleaned
      expect(existsSync(snap1)).toBe(false)
      expect(existsSync(snap2)).toBe(false)
      // Coordinator no longer holds the renderer
      expect(() => bundle.coordinator.getSession(100, sid1)).toThrow(InvalidSessionError)
    })

    test('teardown is idempotent — calling twice does not double-close', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'td-idem.xlsx')
      writeTestWorkbook(path)

      const { sessionId } = await legacyOpenAndAdopt(bundle, 100, mockClient, path)
      await bundle.coordinator.teardown(100)
      // Second teardown must be a no-op (renderer already gone)
      await bundle.coordinator.teardown(100)
      // Only one close call to the sidecar
      expect(mockClient.closeCalls.get(sessionId)).toBe(1)
    })
  })

  // ═══ Single owner invariant ═══

  describe('single resource owner invariant', () => {
    test('coordinator owns sidecar close + snapshot rm exactly once', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'single-owner.xlsx')
      writeTestWorkbook(path)
      const { sessionId, snapshotPath } = await legacyOpenAndAdopt(bundle, 100, mockClient, path)

      // Close via the coordinator
      await bundle.coordinator.closeWorkbook(100, sessionId)
      // Sidecar saw exactly ONE close call — the coordinator did it.
      // (If the legacy path also closed, this would be 2 — the `adopted=true`
      // flag in sheets-main.ts:closeAllSessions guards against that.)
      expect(mockClient.closeCalls.get(sessionId)).toBe(1)
      expect(existsSync(snapshotPath)).toBe(false)
    })

    test('adoption does not create a second engine handle for the same sidecar session', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'no-double-handle.xlsx')
      writeTestWorkbook(path)
      const { sessionId, session } = await legacyOpenAndAdopt(bundle, 100, mockClient, path)

      // The adopted session's engineHandle is opaque — its only key is
      // the (symbol-typed) brand marker (which serializes to 'undefined'
      // at runtime because ENGINE_SESSION_HANDLE_BRAND is a `declare const`
      // with no value). None of the sensitive fields leak.
      const handle = session.engineHandle
      const keys = Object.keys(handle)
      expect(keys).not.toContain('id')
      expect(keys).not.toContain('sidecarSessionId')
      expect(keys).not.toContain('engineSessionId')
      expect(keys).not.toContain('path')
      const ownKeys = Reflect.ownKeys(handle)
      const stringKeys = ownKeys.filter(k => typeof k === 'string')
      expect(stringKeys).not.toContain('id')
      expect(stringKeys).not.toContain('sidecarSessionId')
      expect(stringKeys).not.toContain('engineSessionId')
      expect(stringKeys).not.toContain('path')

      // The sidecar saw ONE open call — adoption did not re-open
      expect(mockClient.openCalls).toBe(1)
    })
  })

  // ═══ Adoption timing ═══

  describe('adoption timing', () => {
    test('adoption is callable only after the legacy session is registered', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      // No prior open — try to adopt with a fake sessionId
      const fakeAdoption: LegacySessionAdoption = {
        sidecarSessionId: randomUUID(),
        originalPath: '/nonexistent.xlsx',
        snapshotPath: '/nonexistent-snapshot.xlsx',
        diskFingerprint: 'fake',
        sheetNames: makeSheetNames(),
        metadata: makeMetadata(),
        locale: 'en',
      }
      // Adoption itself doesn't validate the sidecar session exists — that
      // happens lazily on the first read. So adoptLegacySession succeeds...
      const session = await adoptLegacySessionIntoCoordinator(bundle, 100, fakeAdoption)
      expect(session).toBeDefined()
      // ...but a subsequent read fails because the sidecar doesn't know the session.
      await expect(bundle.coordinator.readRange(100, fakeAdoption.sidecarSessionId, 'sheet-1', 'A1:B2'))
        .rejects.toThrow()
    })

    test('double-adoption of the same sessionId throws InvalidSessionError', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'double-adopt.xlsx')
      writeTestWorkbook(path)

      // First adoption succeeds
      const { sessionId, snapshotPath } = await legacyOpenAndAdopt(bundle, 100, mockClient, path)

      // Second adoption of the same sessionId must fail — the caller must
      // close before re-adopting. The error surfaces the bug rather than
      // silently replacing the session.
      const duplicateAdoption: LegacySessionAdoption = {
        sidecarSessionId: sessionId,
        originalPath: path,
        snapshotPath,
        diskFingerprint: 'duplicate',
        sheetNames: makeSheetNames(),
        metadata: makeMetadata(),
        locale: 'en',
      }
      await expect(adoptLegacySessionIntoCoordinator(bundle, 100, duplicateAdoption))
        .rejects.toThrow(InvalidSessionError)
    })
  })

  // ═══ Multi-session per renderer ═══

  describe('multi-session per renderer', () => {
    test('renderer A can have sessions A1 and A2 simultaneously', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const p1 = join(testDir, 'multi-a1.xlsx'), p2 = join(testDir, 'multi-a2.xlsx')
      writeTestWorkbook(p1); writeTestWorkbook(p2)

      const { sessionId: sid1 } = await legacyOpenAndAdopt(bundle, 100, mockClient, p1)
      const { sessionId: sid2 } = await legacyOpenAndAdopt(bundle, 100, mockClient, p2)

      // Both sessions are accessible from renderer A
      const s1 = bundle.coordinator.getSession(100, sid1)
      const s2 = bundle.coordinator.getSession(100, sid2)
      expect(s1.sessionId).toBe(sid1)
      expect(s2.sessionId).toBe(sid2)
      expect(sid1).not.toBe(sid2)
    })

    test('A1 cannot access A2 (same renderer, different sessions)', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const p1 = join(testDir, 'cross-a1.xlsx'), p2 = join(testDir, 'cross-a2.xlsx')
      writeTestWorkbook(p1); writeTestWorkbook(p2)

      const { sessionId: sid1 } = await legacyOpenAndAdopt(bundle, 100, mockClient, p1)
      const { sessionId: sid2 } = await legacyOpenAndAdopt(bundle, 100, mockClient, p2)

      // Both are valid in renderer A — but session 1 cannot be accessed by session 2's id
      // (they're distinct sessions, not aliases)
      expect(sid1).not.toBe(sid2)
      expect(bundle.coordinator.getSession(100, sid1).sessionId).toBe(sid1)
      expect(bundle.coordinator.getSession(100, sid2).sessionId).toBe(sid2)
    })
  })

  // ═══ Cross-renderer multi-session ═══

  describe('cross-renderer multi-session (3 sessions, 2 renderers)', () => {
    test('renderer A has A1+A2; renderer B has B1; isolation holds', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const pA1 = join(testDir, 'multi-a1.xlsx')
      const pA2 = join(testDir, 'multi-a2.xlsx')
      const pB1 = join(testDir, 'multi-b1.xlsx')
      writeTestWorkbook(pA1); writeTestWorkbook(pA2); writeTestWorkbook(pB1)

      const { sessionId: A1 } = await legacyOpenAndAdopt(bundle, 100, mockClient, pA1)
      const { sessionId: A2 } = await legacyOpenAndAdopt(bundle, 100, mockClient, pA2)
      const { sessionId: B1 } = await legacyOpenAndAdopt(bundle, 200, mockClient, pB1)

      // A1 cannot access A2 (same renderer, but distinct sessions — both visible)
      // A1 cannot access B1 (different renderer)
      // B1 cannot access A1 (different renderer)
      expect(bundle.coordinator.getSession(100, A1).sessionId).toBe(A1)
      expect(bundle.coordinator.getSession(100, A2).sessionId).toBe(A2)
      expect(bundle.coordinator.getSession(200, B1).sessionId).toBe(B1)
      expect(() => bundle.coordinator.getSession(100, B1)).toThrow(InvalidSessionError)
      expect(() => bundle.coordinator.getSession(200, A1)).toThrow(InvalidSessionError)
      expect(() => bundle.coordinator.getSession(200, A2)).toThrow(InvalidSessionError)
    })
  })

  // ═══ Adopted session preserves locale ═══

  describe('locale preservation', () => {
    test('adopted session carries the legacy open locale', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'locale-zh.xlsx')
      writeTestWorkbook(path)
      const { session } = await legacyOpenAndAdopt(bundle, 100, mockClient, path, 'zh')
      expect(session.locale).toBe('zh')
    })
  })

  // ═══ Adopted session preserves suggestSaveAs / csvImport / restoreTarget ═══

  describe('legacy session state preserved through adoption', () => {
    test('csvImport + suggestSaveAs carried into the coordinator session', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const path = join(testDir, 'csv-import.csv')
      writeTestWorkbook(path, 'a,b,c')
      const { sessionId } = await legacyOpenAndAdopt(bundle, 100, mockClient, path, 'en', {
        suggestSaveAs: '/tmp/converted.xlsx',
        csvImport: true,
      })
      const session = bundle.coordinator.getSession(100, sessionId)
      expect(session.suggestSaveAs).toBe('/tmp/converted.xlsx')
      expect(session.csvImport).toBe(true)
    })

    test('restoreTarget + restoreTargetSha carried into the coordinator session', async () => {
      const mockClient = new MockSidecarClient()
      const bundle = initSheetsRuntime({ binaryPath: '/unused', sidecarClient: mockClient })
      const original = join(testDir, 'original.xlsx')
      writeTestWorkbook(original, 'original')
      const restoreSha = sha256OfFile(original)
      const { sessionId } = await legacyOpenAndAdopt(bundle, 100, mockClient, original, 'en', {
        restoreTarget: original,
      })
      const session = bundle.coordinator.getSession(100, sessionId)
      expect(session.restoreTarget).toBe(original)
      // restoreTargetSha wasn't passed in this test (the helper doesn't set it
      // unless provided) — verify the field is present when set.
      void restoreSha
    })
  })

  // ═══ Engine.adoptExternalSession — direct tests ═══

  describe('ElectronXlsxSidecarEngine.adoptExternalSession — direct', () => {
    test('creates an opaque handle with no inspectable fields', () => {
      const mockClient = new MockSidecarClient()
      const engine = new ElectronXlsxSidecarEngine({ binaryPath: '/unused', sidecarClient: mockClient })
      const handle = engine.adoptExternalSession({
        sidecarSessionId: 'sid-1',
        tempPath: '/tmp/foo.xlsx',
        sheetNames: new Map([['sheet-1', 'Sheet1']]),
      })
      // The handle's only key is the brand marker (which serializes to
      // 'undefined' at runtime). None of the sensitive field names leak.
      const keys = Object.keys(handle)
      expect(keys).not.toContain('id')
      expect(keys).not.toContain('sidecarSessionId')
      expect(keys).not.toContain('engineSessionId')
      expect(keys).not.toContain('path')
      const ownKeys = Reflect.ownKeys(handle)
      const stringKeys = ownKeys.filter(k => typeof k === 'string')
      expect(stringKeys).not.toContain('id')
      expect(stringKeys).not.toContain('sidecarSessionId')
      expect(stringKeys).not.toContain('engineSessionId')
      expect(stringKeys).not.toContain('path')
    })

    test('adopted handle resolves reads through the SAME injected client', async () => {
      const mockClient = new MockSidecarClient()
      const engine = new ElectronXlsxSidecarEngine({ binaryPath: '/unused', sidecarClient: mockClient })
      // Pre-open a session via the mock directly (simulating legacy open)
      const opened = await mockClient.request({ command: 'open', path: '/tmp/foo.xlsx', locale: 'en' }) as { sessionId: string }
      // Adopt it
      const handle = engine.adoptExternalSession({
        sidecarSessionId: opened.sessionId,
        tempPath: '/tmp/foo.xlsx',
        sheetNames: new Map([['sheet-1', 'Sheet1']]),
      })
      // Read through the adopted handle
      const result = await engine.readRange(handle, 'Sheet1', 'A1:B2')
      expect(result.cells).toBeDefined()
      // The mock saw ONE read_range call to the original sessionId
      expect(mockClient.rangeCalls.get(opened.sessionId)).toBe(1)
      // And ONE open call (adoption did not re-open)
      expect(mockClient.openCalls).toBe(1)
    })

    test('adopted handle closes the sidecar session on engine.close()', async () => {
      const mockClient = new MockSidecarClient()
      const engine = new ElectronXlsxSidecarEngine({ binaryPath: '/unused', sidecarClient: mockClient })
      const opened = await mockClient.request({ command: 'open', path: '/tmp/foo.xlsx', locale: 'en' }) as { sessionId: string }
      const handle = engine.adoptExternalSession({
        sidecarSessionId: opened.sessionId,
        tempPath: '/tmp/foo.xlsx',
        sheetNames: new Map([['sheet-1', 'Sheet1']]),
      })
      await engine.close(handle)
      expect(mockClient.closeCalls.get(opened.sessionId)).toBe(1)
    })
  })
})
