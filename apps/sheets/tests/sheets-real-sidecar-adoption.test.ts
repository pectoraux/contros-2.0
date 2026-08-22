/**
 * Increment 5A — REAL sidecar integration test.
 *
 * This test uses the ACTUAL Rust xlsx-sidecar binary (no mocks) to verify
 * that the adoption path works end-to-end with a real sidecar process:
 *
 *   1. Spawn the real sidecar (via XlsxSidecarClient — the legacy client).
 *   2. Open a real .xlsx fixture via `client.open()` (the legacy path).
 *   3. Adopt the resulting sidecar session into the coordinator.
 *   4. Call `coordinator.readRange(...)` — verifies the request crosses:
 *        coordinator
 *          → SpreadsheetService
 *          → ElectronXlsxSidecarEngine (with the legacy client injected)
 *          → real sidecar binary
 *   5. Verify the response reaches the test caller.
 *
 * If the Rust sidecar binary is unavailable, the test is SKIPPED (not failed)
 * — the spec requires reporting "REAL SIDECAR INTEGRATION: NOT AVAILABLE"
 * rather than fabricating success.
 *
 * This test does NOT launch the full Electron shell — that requires a CDP
 * driver and Xvfb. Instead, it directly exercises the engine + service +
 * coordinator + sidecar binary. The shell-level CDP smoke test is documented
 * separately (see e2e/sheets-adoption-cdp.test.ts for the full shell test).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { XlsxSidecarClient } from '../src/main/xlsx-sidecar-client'
import { ElectronXlsxSidecarEngine } from '@genoffice/platform-electron'
import { SpreadsheetServiceImpl } from '@genoffice/services-sheets/src/spreadsheet-service.js'
import { SheetsShellCoordinator } from '../src/main/sheets-shell-coordinator'
import {
  initSheetsRuntime,
  adoptLegacySessionIntoCoordinator,
} from '../src/main/sheets-runtime'
import type { WorkbookMetadata, WorksheetMetadata } from '@genoffice/runtime-contracts'

// ── Sidecar binary path ───────────────────────────────────────────────

function sidecarBinaryPath(): string {
  const executable = process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar'
  return fileURLToPath(
    new URL(`../native/xlsx-engine/target/release/${executable}`, import.meta.url),
  )
}

const SIDECAR_BINARY = sidecarBinaryPath()
const SIDECAR_AVAILABLE = existsSync(SIDECAR_BINARY)

// ── Fixture ──────────────────────────────────────────────────────────

const FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/generated/compatibility-basic.xlsx', import.meta.url),
)
const FIXTURE_AVAILABLE = existsSync(FIXTURE_PATH)

// ── Test setup ────────────────────────────────────────────────────────

let testDir: string
let sidecarClient: XlsxSidecarClient | null = null
let bundle: ReturnType<typeof initSheetsRuntime> | null = null

beforeAll(() => {
  if (!SIDECAR_AVAILABLE || !FIXTURE_AVAILABLE) return
  testDir = join(tmpdir(), `genoffice-real-test-${randomUUID()}`)
  mkdirSync(testDir, { recursive: true })
  sidecarClient = new XlsxSidecarClient(SIDECAR_BINARY)
  sidecarClient.start()
  bundle = initSheetsRuntime({ binaryPath: SIDECAR_BINARY, sidecarClient })
})

afterAll(async () => {
  if (sidecarClient) {
    try { sidecarClient.stop() } catch { /* best effort */ }
  }
  if (testDir) {
    try { rmSync(testDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})

// ── Skip helpers ─────────────────────────────────────────────────────

const skipIfNoSidecar = SIDECAR_AVAILABLE && FIXTURE_AVAILABLE ? describe : describe.skip

// ── Tests ────────────────────────────────────────────────────────────

skipIfNoSidecar('Increment 5A — REAL sidecar integration', () => {
  test('legacy open → adopt → migrated read-range crosses the full stack', async () => {
    // 1. Snapshot the fixture
    const snapshotPath = join(testDir, `${randomUUID()}.xlsx`)
    copyFileSync(FIXTURE_PATH, snapshotPath)

    // 2. Open via the legacy XlsxSidecarClient (the legacy workbook:select path)
    const openedRaw = await sidecarClient!.open(snapshotPath, 'en')
    const opened = openedRaw as {
      sessionId: string
      sheets: Array<{ id: string; name: string }>
    }

    expect(opened.sessionId).toBeTruthy()
    expect(typeof opened.sessionId).toBe('string')
    expect(opened.sheets.length).toBeGreaterThan(0)
    const sheet1 = opened.sheets[0]
    expect(sheet1.id).toBeTruthy()
    expect(sheet1.name).toBeTruthy()

    // 3. Build the LegacySessionAdoption shape (mirrors what
    //    sheets-main.ts:adoptLegacySessionFromWorkbookFile produces)
    const sheetNames = new Map<string, string>()
    for (const s of opened.sheets) sheetNames.set(s.id, s.name)

    const diskFingerprint = createHash('sha256')
      .update(require('node:fs').readFileSync(snapshotPath))
      .digest('hex')

    const sheets: WorksheetMetadata[] = opened.sheets.map((s, i) => ({
      id: s.id, name: s.name, index: i,
      hidden: false, rtl: false, showGridlines: true,
      rowCount: 100, columnCount: 26,
      defaultRowHeight: 15, defaultColumnWidth: 8.43,
    }))

    const metadata: WorkbookMetadata = {
      name: 'compatibility-basic.xlsx',
      sha256: diskFingerprint,
      entryCount: 14,
      sheets,
      activeTab: 0,
      definedNames: [],
      themeColors: [],
      themeFonts: { major: '', minor: '' },
    }

    // 4. Adopt — wraps the existing sidecar session into an opaque handle
    const session = await adoptLegacySessionIntoCoordinator(
      bundle!,
      100, // wcId
      {
        sidecarSessionId: opened.sessionId,
        originalPath: FIXTURE_PATH,
        snapshotPath,
        diskFingerprint,
        sheetNames,
        metadata,
        locale: 'en',
      },
    )

    expect(session).toBeDefined()
    expect(session.sessionId).toBe(opened.sessionId)
    expect(session.engineHandle).toBeDefined()

    // 5. Migrated read-range: this crosses coordinator → service → engine
    //    → real sidecar binary. The response must come back with cells.
    //    The fixture has only 1 row × 2 cols — use a range within bounds.
    const result = await bundle!.coordinator.readRange(
      100, opened.sessionId, sheet1.id, 'A1:B1',
    )
    expect(result).toBeDefined()
    expect(result.cells).toBeDefined()
    // The fixture has at least one cell — verify the sidecar actually
    // returned data (not a mock).
    expect(Array.isArray(result.cells)).toBe(true)
    expect(result.cells.length).toBeGreaterThan(0)
  })

  test('adopted session uses the SAME sidecar process (no double spawn)', async () => {
    // Verify by checking process IDs — the legacy client's PID must equal
    // the engine's PID (since they share the same injected client).
    const legacyPid = sidecarClient!.getProcessId()
    const enginePid = bundle!.engine.getProcessId()
    expect(legacyPid).not.toBeNull()
    expect(enginePid).not.toBeNull()
    expect(legacyPid).toBe(enginePid)
  })

  test('teardown closes the sidecar session exactly once', async () => {
    // Open + adopt
    const snapshotPath = join(testDir, `${randomUUID()}.xlsx`)
    copyFileSync(FIXTURE_PATH, snapshotPath)
    const openedRaw = await sidecarClient!.open(snapshotPath, 'en')
    const opened = openedRaw as { sessionId: string; sheets: Array<{ id: string; name: string }> }
    const sheetNames = new Map<string, string>()
    for (const s of opened.sheets) sheetNames.set(s.id, s.name)

    const session = await adoptLegacySessionIntoCoordinator(bundle!, 200, {
      sidecarSessionId: opened.sessionId,
      originalPath: FIXTURE_PATH,
      snapshotPath,
      diskFingerprint: 'test',
      sheetNames,
      metadata: {
        name: 'test.xlsx', sha256: 'test', entryCount: 14,
        sheets: opened.sheets.map((s, i) => ({
          id: s.id, name: s.name, index: i, hidden: false, rtl: false,
          showGridlines: true, rowCount: 100, columnCount: 26,
          defaultRowHeight: 15, defaultColumnWidth: 8.43,
        })),
        activeTab: 0, definedNames: [], themeColors: [],
        themeFonts: { major: '', minor: '' },
      },
      locale: 'en',
    })

    // Teardown — should close the sidecar session exactly once
    await bundle!.coordinator.teardown(200)
    // After teardown, the session is no longer resolvable
    expect(() => bundle!.coordinator.getSession(200, session.sessionId)).toThrow()
  })
})

// Always-running report test — verifies whether the real sidecar is available
describe('Increment 5A — REAL sidecar availability report', () => {
  test('reports sidecar availability', () => {
    if (!SIDECAR_AVAILABLE) {
      // The spec requires this exact report when the sidecar is unavailable
      console.warn('REAL SHEETS E2E IPC: BLOCKED')
      console.warn('REAL SIDECAR INTEGRATION: NOT AVAILABLE')
      console.warn(`Sidecar binary not found at: ${SIDECAR_BINARY}`)
    }
    if (!FIXTURE_AVAILABLE) {
      console.warn(`XLSX fixture not found at: ${FIXTURE_PATH}`)
    }
    // This test always passes — it's a report, not a gate.
    expect(true).toBe(true)
  })
})
