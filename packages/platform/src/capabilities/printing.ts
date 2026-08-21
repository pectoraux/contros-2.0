/**
 * Printing capability — system print dialog + PDF export + print-to-bytes.
 *
 * Electron: BrowserWindow.printToPDF + shell.print.
 * Web: window.print() + pdf-lib assembly (for PDF export from page-image canvases).
 */
import type {
  PrintOptions,
  ExportPdfOptions,
  PrintToBytesOptions,
  SaveResult,
} from '../types.js'

export interface Printing {
  /** System print dialog for the current window; ok=false without error = canceled. */
  print(opts?: PrintOptions): Promise<{ ok: boolean; error?: string }>
  /** Render to PDF and ask where to save; returns the save outcome. */
  exportPdf(opts: ExportPdfOptions): Promise<{ ok: boolean; path?: string; error?: string }>
  /** Render one page-size group to PDF bytes (base64). */
  printToBytes(opts: PrintToBytesOptions): Promise<{ ok: boolean; base64?: string; error?: string }>
  /** Merge PDF fragments (base64 parts) and write to disk. */
  saveMergedPdf(
    defaultName: string,
    base64Parts: string[],
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>
}
