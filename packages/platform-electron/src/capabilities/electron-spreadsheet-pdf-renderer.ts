/**
 * ElectronSpreadsheetPdfRenderer — Electron adapter for the
 * Sheets-specific PDF rendering port (ADR-006).
 *
 * Implements `SpreadsheetPdfRenderer` using a hidden `BrowserWindow`:
 *   1. Write the HTML to a temp file (sandboxed BrowserWindow can't load
 *      arbitrary data: URLs longer than ~2MB; loadFile avoids this).
 *   2. Create a hidden, scripting-disabled BrowserWindow.
 *   3. Load the temp HTML file.
 *   4. Call webContents.printToPDF() with the page options.
 *   5. Return the PDF bytes.
 *   6. Destroy the window and clean up the temp file (try/finally).
 *
 * OWNERSHIP:
 *   The renderer owns the hidden BrowserWindow + temp file lifecycle.
 *   BrowserWindow/WebContents NEVER leak outside this adapter — the
 *   interface returns only `Uint8Array` (PDF bytes) on success.
 *
 * ERROR MODEL:
 *   Errors are RETURNED (not thrown) as `{ ok: false, reason, message }`.
 *   The coordinator maps them to the frozen IPC error shape.
 *
 * TIMEOUT:
 *   loadFile + printToPDF have a 60-second timeout. If either exceeds it,
 *   the renderer returns `{ ok: false, reason: 'render-failed' }` and
 *   cleans up the window + temp file.
 *
 * RESOURCE CLEANUP:
 *   try/finally ensures the BrowserWindow is destroyed and the temp dir
 *   is removed in ALL cases (success, error, timeout).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'

import type {
  SpreadsheetPdfRenderer,
  SpreadsheetPdfOptions,
  SpreadsheetPdfRenderResult,
} from '@genoffice/runtime-contracts'

const PDF_RENDER_TIMEOUT_MS = 60_000

/**
 * Configuration for ElectronSpreadsheetPdfRenderer.
 * Currently empty — the renderer is self-contained. Reserved for future
 * temp-dir override or window-options customization.
 */
export interface ElectronSpreadsheetPdfRendererConfig {
  /** Optional temp dir override (defaults to os.tmpdir()). */
  readonly tempDir?: string
}

export class ElectronSpreadsheetPdfRenderer implements SpreadsheetPdfRenderer {
  private readonly tempDir: string

  constructor(config: ElectronSpreadsheetPdfRendererConfig = {}) {
    this.tempDir = config.tempDir ?? tmpdir()
  }

  async renderToPdf(
    html: string,
    options: SpreadsheetPdfOptions,
  ): Promise<SpreadsheetPdfRenderResult> {
    let workDir: string | undefined
    let window: BrowserWindow | undefined
    try {
      // 1. Write HTML to a temp file (sandboxed windows can't load huge data: URLs)
      workDir = await mkdtemp(join(this.tempDir, 'genoffice-pdf-'))
      const htmlPath = join(workDir, 'print.html')
      await writeFile(htmlPath, html, 'utf8')

      // 2. Create hidden, scripting-disabled BrowserWindow
      window = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, javascript: false },
      })

      // 3. Load the HTML file (with timeout)
      await withTimeout(window.loadFile(htmlPath), PDF_RENDER_TIMEOUT_MS, 'HTML load timed out')

      // 4. printToPDF with the page options (with timeout)
      const pdf = await withTimeout(
        window.webContents.printToPDF({
          landscape: options.landscape,
          pageSize: mapPageSize(options.pageSize),
          margins: mapMargins(options.margins),
          scale: options.scale,
          printBackground: true,
        }),
        PDF_RENDER_TIMEOUT_MS,
        'printToPDF timed out',
      )

      return { ok: true, data: new Uint8Array(pdf) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: 'render-failed', message }
    } finally {
      // 5. Clean up — destroy window + remove temp dir (best-effort)
      try { window?.destroy() } catch { /* best effort */ }
      if (workDir) {
        try { await rm(workDir, { recursive: true, force: true }) } catch { /* best effort */ }
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Map the contract's page size to Electron's printToPDF pageSize option.
 *
 * Named sizes pass through directly. Custom sizes map to
 * `{ width, height }` in microns (Electron's expectation for custom
 * page sizes — inches × 25400 = microns).
 */
function mapPageSize(
  pageSize: SpreadsheetPdfOptions['pageSize'],
): Electron.PrintToPDFOptions['pageSize'] {
  if (typeof pageSize === 'string') {
    return pageSize
  }
  // Custom size: inches → microns (1 inch = 25400 microns)
  return { width: pageSize.width * 25400, height: pageSize.height * 25400 }
}

/**
 * Map the contract's margins (inches) to Electron's printToPDF margins
 * (also in inches — direct match).
 */
function mapMargins(
  margins: SpreadsheetPdfMargins,
): Electron.PrintToPDFOptions['margins'] {
  return {
    top: margins.top,
    bottom: margins.bottom,
    left: margins.left,
    right: margins.right,
  }
}

// Re-export the type for the mapper signature
type SpreadsheetPdfMargins = {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

/**
 * Race a promise against a timeout. If the timeout fires first, reject
 * with a timeout error. The original promise is NOT cancelled (Electron's
 * loadFile/printToPDF don't support AbortController) — the timeout just
 * unblocks the caller so it can clean up.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, ms)
    promise.then(
      (result) => { clearTimeout(timer); resolve(result) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}
