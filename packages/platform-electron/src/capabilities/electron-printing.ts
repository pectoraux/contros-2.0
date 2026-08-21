/**
 * ElectronPrinting — implements the Printing capability using webContents.print
 * + webContents.printToPDF.
 *
 * Wraps the existing print logic from apps/docs/src/main/docs-main.ts (docs:print,
 * docs:export-pdf, docs:print-pdf-buffer, docs:save-merged-pdf).
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 *
 * NOTE: webContents is required for print/printToPDF. The active webContents is
 * resolved through a resolver function injected at construction time.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  Printing,
  PrintOptions,
  ExportPdfOptions,
  PrintToBytesOptions,
} from '@genoffice/platform'

export interface ElectronPrintingDeps {
  /** Returns the active webContents (for print/printToPDF), or null. */
  getActiveWebContents: () => {
    print: (opts?: any, callback?: (success: boolean, failureReason?: string) => void) => void
    printToPDF: (opts?: any) => Promise<Buffer>
    isDestroyed: () => boolean
  } | null
  /** The TWIPS_PER_INCH constant (1440). */
  twipsPerInch: number
}

export class ElectronPrinting implements Printing {
  constructor(private readonly deps: ElectronPrintingDeps) {}

  async print(opts?: PrintOptions): Promise<{ ok: boolean; error?: string }> {
    const wc = this.deps.getActiveWebContents()
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'no active web contents' }
    return new Promise((resolve) => {
      wc.print({ margins: { marginType: 'none' }, ...(opts as any) }, (success, failureReason) => {
        resolve({
          ok: success,
          ...(failureReason && !/cancel/i.test(failureReason) ? { error: failureReason } : {}),
        })
      })
    })
  }

  async exportPdf(opts: ExportPdfOptions): Promise<{ ok: boolean; path?: string; error?: string }> {
    const wc = this.deps.getActiveWebContents()
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'no active web contents' }

    let filePath = opts.outPath ?? null
    // Note: path-grant checking happens in the domain service, not here.
    if (!filePath) {
      // The save dialog should have been called by the domain service (via Files.pickSave).
      // If we get here without a path, it's a programming error.
      return { ok: false, error: 'no output path' }
    }

    try {
      const data = await wc.printToPDF({
        printBackground: true,
        pageSize: {
          width: (opts.pageWidthTwips ?? 12240) / this.deps.twipsPerInch,
          height: (opts.pageHeightTwips ?? 15840) / this.deps.twipsPerInch,
        },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, data)
      return { ok: true, path: filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async printToBytes(opts: PrintToBytesOptions): Promise<{ ok: boolean; base64?: string; error?: string }> {
    const wc = this.deps.getActiveWebContents()
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'no active web contents' }
    try {
      const data = await wc.printToPDF({
        printBackground: true,
        pageSize: {
          width: opts.pageWidthTwips / this.deps.twipsPerInch,
          height: opts.pageHeightTwips / this.deps.twipsPerInch,
        },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })
      return { ok: true, base64: data.toString('base64') }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async saveMergedPdf(
    defaultName: string,
    base64Parts: string[],
    outPath?: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    if (!outPath) return { ok: false, error: 'no output path' }
    try {
      const { PDFDocument } = await import('pdf-lib')
      const merged = await PDFDocument.create()
      for (const b64 of base64Parts) {
        const part = await PDFDocument.load(Buffer.from(b64, 'base64'))
        const pages = await merged.copyPages(part, part.getPageIndices())
        for (const page of pages) merged.addPage(page)
      }
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, Buffer.from(await merged.save()))
      return { ok: true, path: outPath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }
}
