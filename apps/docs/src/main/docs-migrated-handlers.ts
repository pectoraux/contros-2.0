/**
 * Migrated Docs IPC handlers.
 *
 * Replaces specific IPC handlers in docs-main.ts with implementations
 * that delegate to the runtime (DocumentService + coordinator + capabilities).
 *
 * Called AFTER registerDocsIpc() — the handlers here override the existing ones
 * via ipcMain.removeHandler + ipcMain.handle.
 *
 * Only handlers classified as "domain behavior" or "platform primitive" are
 * migrated. Shell/window handlers stay in docs-main.ts.
 *
 * Migrated handlers:
 *   docs:open          → coordinator.openDocx()
 *   docs:open-path     → coordinator.openDocxPath(path)
 *   docs:save          → coordinator.saveDocx(path, data, auto)
 *   docs:save-as       → coordinator.saveDocxAs(defaultName, data)
 *   docs:save-new      → coordinator.saveDocxNew(defaultName, data)
 *   docs:write-recovery → coordinator.writeRecovery(path, data)
 *   docs:recent        → docsService.recentFiles()
 *   docs:pick-image    → docsService.pickImage()
 *   docs:font-metrics  → fontRegistry.fontMetrics(family)
 *   docs:print         → runtime.printing.print()
 *   docs:export-pdf    → docsService.exportPdf(...)
 *   docs:print-pdf-buffer → docsService.printPdfBuffer(...)
 *   docs:save-merged-pdf → docsService.saveMergedPdf(...)
 *
 * NOT migrated (stay in docs-main.ts):
 *   ai:*               → ElectronAI.stream/chat throws; keep existing handlers
 *   docs:consume-*     → shell state (pending-open, new-blank)
 *   docs:close-*       → shell state (close-guard)
 *   docs:view-menu-state → shell state
 *   win:*              → shell state (tab management)
 *   project:*          → could migrate later
 *   files:*            → could migrate later
 */
import { ipcMain } from 'electron'
import { Buffer } from 'node:buffer'
import type { RuntimeContext, DocumentService } from '@genoffice/runtime-contracts'
import type { DocsShellCoordinatorImpl } from './docs-coordinator-impl.js'
import type { ElectronFontRegistry } from '@genoffice/platform-electron'

export interface MigratedHandlersDeps {
  runtime: RuntimeContext
  docsService: DocumentService
  coordinator: DocsShellCoordinatorImpl
  fontRegistry: ElectronFontRegistry
}

export function registerMigratedDocsIpc(deps: MigratedHandlersDeps): void {
  const { runtime, docsService, coordinator, fontRegistry } = deps

  // ── docs:open ──────────────────────────────────────────────────────
  ipcMain.removeHandler('docs:open')
  ipcMain.handle('docs:open', async () => {
    const r = await coordinator.openDocx()
    return r?.result ?? null
  })

  // ── docs:open-path ──────────────────────────────────────────────────
  ipcMain.removeHandler('docs:open-path')
  ipcMain.handle('docs:open-path', async (_event, filePath: string) => {
    const r = await coordinator.openDocxPath(filePath)
    return r?.result ?? null
  })

  // ── docs:save ──────────────────────────────────────────────────────
  ipcMain.removeHandler('docs:save')
  ipcMain.handle(
    'docs:save',
    async (_event, filePath: string, data: ArrayBuffer, auto?: boolean) => {
      return coordinator.saveDocx(filePath, new Uint8Array(data), auto === true)
    },
  )

  // ── docs:save-as ────────────────────────────────────────────────────
  ipcMain.removeHandler('docs:save-as')
  ipcMain.handle(
    'docs:save-as',
    async (_event, defaultName: string, data: ArrayBuffer) => {
      return coordinator.saveDocxAs(defaultName, new Uint8Array(data))
    },
  )

  // ── docs:save-new ───────────────────────────────────────────────────
  ipcMain.removeHandler('docs:save-new')
  ipcMain.handle(
    'docs:save-new',
    async (_event, defaultName: string, data: ArrayBuffer) => {
      return coordinator.saveDocxNew(defaultName, new Uint8Array(data))
    },
  )

  // ── docs:write-recovery ─────────────────────────────────────────────
  ipcMain.removeHandler('docs:write-recovery')
  ipcMain.handle(
    'docs:write-recovery',
    async (_event, filePath: string, data: ArrayBuffer) => {
      return coordinator.writeRecovery(filePath, new Uint8Array(data))
    },
  )

  // ── docs:recent ─────────────────────────────────────────────────────
  ipcMain.removeHandler('docs:recent')
  ipcMain.handle('docs:recent', () => docsService.recentFiles())

  // ── docs:pick-image ─────────────────────────────────────────────────
  ipcMain.removeHandler('docs:pick-image')
  ipcMain.handle('docs:pick-image', () => docsService.pickImage())

  // ── docs:font-metrics ───────────────────────────────────────────────
  ipcMain.removeHandler('docs:font-metrics')
  ipcMain.handle('docs:font-metrics', (_event, family: string) => {
    return typeof family === 'string' ? fontRegistry.fontMetrics(family) : Promise.resolve(null)
  })

  // ── docs:print ──────────────────────────────────────────────────────
  ipcMain.removeHandler('docs:print')
  ipcMain.handle('docs:print', () => runtime.printing.print())

  // ── docs:export-pdf ─────────────────────────────────────────────────
  ipcMain.removeHandler('docs:export-pdf')
  ipcMain.handle(
    'docs:export-pdf',
    async (
      _event,
      defaultName: string,
      pageWidthTwips: number,
      pageHeightTwips: number,
      outPath?: string,
    ) => {
      return docsService.exportPdf(defaultName, pageWidthTwips, pageHeightTwips, outPath)
    },
  )

  // ── docs:print-pdf-buffer ───────────────────────────────────────────
  ipcMain.removeHandler('docs:print-pdf-buffer')
  ipcMain.handle(
    'docs:print-pdf-buffer',
    async (_event, pageWidthTwips: number, pageHeightTwips: number) => {
      return docsService.printPdfBuffer(pageWidthTwips, pageHeightTwips)
    },
  )

  // ── docs:save-merged-pdf ────────────────────────────────────────────
  ipcMain.removeHandler('docs:save-merged-pdf')
  ipcMain.handle(
    'docs:save-merged-pdf',
    async (
      _event,
      defaultName: string,
      base64Parts: string[],
      outPath?: string,
    ) => {
      return docsService.saveMergedPdf(defaultName, base64Parts, outPath)
    },
  )
}
