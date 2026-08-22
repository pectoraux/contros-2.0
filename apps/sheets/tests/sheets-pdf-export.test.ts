/**
 * Increment 7 — PDF export migration tests.
 *
 * Tests:
 *   1. SpreadsheetPdfRenderer contract exists and is data-only
 *   2. ElectronSpreadsheetPdfRenderer implements the contract
 *   3. Coordinator.exportPdf delegates to the renderer
 *   4. Save-dialog cancellation returns { canceled: true }
 *   5. Render failure returns a typed error (no file written)
 *   6. Success path: render → write to authorized path
 *   7. Architecture: handler has ZERO BrowserWindow/printToPDF/fs
 *
 * Uses a mock SpreadsheetPdfRenderer for deterministic testing (no real
 * BrowserWindow needed).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const { mockApp, mockDialog } = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn((name: string) => join(tmpdir(), `genoffice-test-${name}-${randomUUID()}`)) },
  mockDialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
}))
vi.mock('electron', () => ({
  app: mockApp,
  dialog: mockDialog,
  BrowserWindow: vi.fn(),
}))

import { SheetsShellCoordinator } from '../src/main/sheets-shell-coordinator'
import type {
  SpreadsheetPdfRenderer,
  SpreadsheetPdfOptions,
  SpreadsheetPdfRenderResult,
  SpreadsheetService,
} from '@genoffice/runtime-contracts'

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `genoffice-test-${randomUUID()}`)
  mkdirSync(testDir, { recursive: true })
  vi.clearAllMocks()
})

// ── Mock PDF renderer ────────────────────────────────────────────────

class MockPdfRenderer implements SpreadsheetPdfRenderer {
  public renderCalls = 0
  public lastHtml: string | undefined
  public lastOptions: SpreadsheetPdfOptions | undefined
  public shouldFail = false
  public pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]) // %PDF-1.4

  async renderToPdf(
    html: string,
    options: SpreadsheetPdfOptions,
  ): Promise<SpreadsheetPdfRenderResult> {
    this.renderCalls++
    this.lastHtml = html
    this.lastOptions = options
    if (this.shouldFail) {
      return { ok: false, reason: 'render-failed', message: 'Mock render failure' }
    }
    return { ok: true, data: this.pdfBytes }
  }
}

function makeMockService(): SpreadsheetService {
  return {
    open: vi.fn(),
    close: vi.fn(),
    readRange: vi.fn(),
    readFormulaCells: vi.fn(),
    recalculate: vi.fn(),
    readMedia: vi.fn(),
    save: vi.fn(),
    writeRecovery: vi.fn(),
  } as unknown as SpreadsheetService
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Increment 7 — PDF export migration', () => {
  describe('SpreadsheetPdfRenderer contract', () => {
    test('is exported from runtime-contracts', async () => {
      // The interface is a TypeScript type, not a runtime value.
      // We verify the source file exists and defines the interface.
      const src = readFileSync(
        join(__dirname, '..', '..', '..', 'packages', 'runtime-contracts', 'src', 'services', 'spreadsheet-pdf-renderer.ts'),
        'utf8',
      )
      expect(src).toMatch(/export interface SpreadsheetPdfRenderer/)
      expect(src).toMatch(/renderToPdf/)
    })

    test('contract types are data-only (no Electron/node imports)', () => {
      const src = readFileSync(
        join(__dirname, '..', '..', '..', 'packages', 'runtime-contracts', 'src', 'services', 'spreadsheet-pdf-renderer.ts'),
        'utf8',
      )
      // ZERO Electron / node imports (check import statements only)
      expect(src).not.toMatch(/from\s+['"]electron['"]/)
      expect(src).not.toMatch(/from\s+['"]node:/)
    })
  })

  describe('ElectronSpreadsheetPdfRenderer implementation', () => {
    test('is exported from platform-electron', async () => {
      const platform = await import('@genoffice/platform-electron')
      expect(platform).toHaveProperty('ElectronSpreadsheetPdfRenderer')
    })

    test('implementation file exists and implements the contract', () => {
      const src = readFileSync(
        join(__dirname, '..', '..', '..', 'packages', 'platform-electron', 'src', 'capabilities', 'electron-spreadsheet-pdf-renderer.ts'),
        'utf8',
      )
      expect(src).toMatch(/class ElectronSpreadsheetPdfRenderer/)
      expect(src).toMatch(/implements SpreadsheetPdfRenderer/)
      expect(src).toMatch(/renderToPdf/)
      // Uses BrowserWindow (hidden window)
      expect(src).toMatch(/BrowserWindow/)
      // Uses printToPDF
      expect(src).toMatch(/printToPDF/)
      // Has try/finally for cleanup
      expect(src).toMatch(/try\s*{/)
      expect(src).toMatch(/finally\s*{/)
    })
  })

  describe('coordinator.exportPdf', () => {
    test('exists and is callable', () => {
      const coordinator = new SheetsShellCoordinator({
        service: makeMockService(),
        pdfRenderer: new MockPdfRenderer(),
      })
      expect(typeof coordinator.exportPdf).toBe('function')
    })

    test('save-dialog cancellation returns { canceled: true }', async () => {
      const mockRenderer = new MockPdfRenderer()
      const coordinator = new SheetsShellCoordinator({
        service: makeMockService(),
        pdfRenderer: mockRenderer,
      })
      mockDialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })

      const result = await coordinator.exportPdf(100, undefined, {
        fileName: 'test.pdf',
        html: '<html><body>Test</body></html>',
        landscape: false,
        pageSize: 'A4',
        margins: { top: 1, bottom: 1, left: 1, right: 1 },
        scale: 1,
      })

      expect('canceled' in result).toBe(true)
      if ('canceled' in result) expect(result.canceled).toBe(true)
      // Renderer was NOT called (dialog was canceled before render)
      expect(mockRenderer.renderCalls).toBe(0)
    })

    test('render failure throws Error (no file written)', async () => {
      const mockRenderer = new MockPdfRenderer()
      mockRenderer.shouldFail = true
      const coordinator = new SheetsShellCoordinator({
        service: makeMockService(),
        pdfRenderer: mockRenderer,
      })
      const outputPath = join(testDir, 'failed.pdf')
      mockDialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: outputPath })

      await expect(coordinator.exportPdf(100, undefined, {
        fileName: 'test.pdf',
        html: '<html><body>Test</body></html>',
        landscape: false,
        pageSize: 'A4',
        margins: { top: 1, bottom: 1, left: 1, right: 1 },
        scale: 1,
      })).rejects.toThrow('Mock render failure')

      // No file was written (render failed before write)
      expect(existsSync(outputPath)).toBe(false)
    })

    test('success: render → write to authorized path', async () => {
      const mockRenderer = new MockPdfRenderer()
      const coordinator = new SheetsShellCoordinator({
        service: makeMockService(),
        pdfRenderer: mockRenderer,
      })
      const outputPath = join(testDir, 'success.pdf')
      mockDialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: outputPath })

      const result = await coordinator.exportPdf(100, undefined, {
        fileName: 'test.pdf',
        html: '<html><body><h1>Test PDF</h1></body></html>',
        landscape: true,
        pageSize: 'Letter',
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
        scale: 1.5,
      })

      // Result should be the success shape: { canceled: false, path: string }
      expect(result).toEqual({ canceled: false, path: outputPath })

      // The renderer was called with the correct options
      expect(mockRenderer.renderCalls).toBe(1)
      expect(mockRenderer.lastHtml).toBe('<html><body><h1>Test PDF</h1></body></html>')
      expect(mockRenderer.lastOptions?.landscape).toBe(true)
      expect(mockRenderer.lastOptions?.pageSize).toBe('Letter')
      expect(mockRenderer.lastOptions?.scale).toBe(1.5)

      // The PDF file exists and contains the mock PDF bytes
      expect(existsSync(outputPath)).toBe(true)
      const written = readFileSync(outputPath)
      expect(written[0]).toBe(0x25) // %
      expect(written[1]).toBe(0x50) // P
      expect(written[2]).toBe(0x44) // D
      expect(written[3]).toBe(0x46) // F
    })

    test('authorization order: save dialog runs BEFORE render (no render on cancel)', async () => {
      // Prove the ordering: save dialog → path selected → render → write
      // If the dialog is canceled, renderToPdf must NEVER be called.
      const mockRenderer = new MockPdfRenderer()
      const coordinator = new SheetsShellCoordinator({
        service: makeMockService(),
        pdfRenderer: mockRenderer,
      })
      mockDialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })

      const result = await coordinator.exportPdf(100, undefined, {
        fileName: 'test.pdf',
        html: '<html></html>',
        landscape: false,
        pageSize: 'A4',
        margins: { top: 1, bottom: 1, left: 1, right: 1 },
        scale: 1,
      })

      // Canceled
      expect(result).toEqual({ canceled: true })
      // Render was NEVER called (dialog was canceled before render)
      expect(mockRenderer.renderCalls).toBe(0)
    })

    test('authorization order: render failure cannot create a final PDF', async () => {
      // Prove that a render failure leaves NO partial output file.
      // The save dialog runs first (authorizing the path), then render
      // runs, then write. If render fails, write never happens.
      const mockRenderer = new MockPdfRenderer()
      mockRenderer.shouldFail = true
      const coordinator = new SheetsShellCoordinator({
        service: makeMockService(),
        pdfRenderer: mockRenderer,
      })
      const outputPath = join(testDir, 'no-partial.pdf')
      mockDialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: outputPath })

      await expect(coordinator.exportPdf(100, undefined, {
        fileName: 'test.pdf',
        html: '<html></html>',
        landscape: false,
        pageSize: 'A4',
        margins: { top: 1, bottom: 1, left: 1, right: 1 },
        scale: 1,
      })).rejects.toThrow()

      // Render WAS called (dialog succeeded, then render ran and failed)
      expect(mockRenderer.renderCalls).toBe(1)
      // But the output file was NEVER created (write never ran)
      expect(existsSync(outputPath)).toBe(false)
    })

    test('test-only output path override skips dialog', async () => {
      const mockRenderer = new MockPdfRenderer()
      const coordinator = new SheetsShellCoordinator({
        service: makeMockService(),
        pdfRenderer: mockRenderer,
      })
      const testPath = join(testDir, 'test-override.pdf')
      const prevEnv = process.env['GENOFFICE_PDF_TEST_OUTPATH']
      process.env['GENOFFICE_PDF_TEST_OUTPATH'] = testPath

      try {
        const result = await coordinator.exportPdf(100, undefined, {
          fileName: 'test.pdf',
          html: '<html></html>',
          landscape: false,
          pageSize: 'A4',
          margins: { top: 1, bottom: 1, left: 1, right: 1 },
          scale: 1,
        })

        // Success — the env var path was used directly (no dialog)
        expect(result).toEqual({ canceled: false, path: testPath })
        // The dialog was NOT called
        expect(mockDialog.showSaveDialog).not.toHaveBeenCalled()
        // The PDF file exists
        expect(existsSync(testPath)).toBe(true)
      } finally {
        if (prevEnv === undefined) delete process.env['GENOFFICE_PDF_TEST_OUTPATH']
        else process.env['GENOFFICE_PDF_TEST_OUTPATH'] = prevEnv
      }
    })

    test('missing pdfRenderer throws Error', async () => {
      const coordinator = new SheetsShellCoordinator({
        service: makeMockService(),
        // pdfRenderer NOT provided
      })

      await expect(coordinator.exportPdf(100, undefined, {
        fileName: 'test.pdf',
        html: '<html></html>',
        landscape: false,
        pageSize: 'A4',
        margins: { top: 1, bottom: 1, left: 1, right: 1 },
        scale: 1,
      })).rejects.toThrow(/PDF renderer not available/)
    })
  })

  describe('architecture guards', () => {
    test('migrated export-pdf handler has ZERO new BrowserWindow', () => {
      const src = readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-migrated-handlers.ts'),
        'utf8',
      )
      const stripped = src.replace(/\/\*\*?[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(stripped).not.toMatch(/new\s+BrowserWindow\b/)
    })

    test('migrated export-pdf handler has ZERO printToPDF calls', () => {
      const src = readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-migrated-handlers.ts'),
        'utf8',
      )
      const stripped = src.replace(/\/\*\*?[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(stripped).not.toMatch(/printToPDF/)
    })

    test('migrated export-pdf handler has ZERO getFocusedWindow calls', () => {
      const src = readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-migrated-handlers.ts'),
        'utf8',
      )
      expect(src).not.toMatch(/getFocusedWindow\s*\(/)
    })

    test('migrated export-pdf handler delegates to coordinator.exportPdf', () => {
      const src = readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-migrated-handlers.ts'),
        'utf8',
      )
      expect(src).toMatch(/coordinator\.exportPdf\b/)
    })

    test('runtime-contracts spreadsheet-pdf-renderer has ZERO Electron/node imports', () => {
      const src = readFileSync(
        join(__dirname, '..', '..', '..', 'packages', 'runtime-contracts', 'src', 'services', 'spreadsheet-pdf-renderer.ts'),
        'utf8',
      )
      expect(src).not.toMatch(/from\s+['"]electron['"]/)
      expect(src).not.toMatch(/from\s+['"]node:/)
    })

    test('coordinator exportPdf delegates to pdfRenderer.renderToPdf', () => {
      const src = readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-shell-coordinator.ts'),
        'utf8',
      )
      expect(src).toMatch(/pdfRenderer\.renderToPdf/)
    })
  })
})
