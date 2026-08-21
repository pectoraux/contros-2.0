/**
 * Migrated Docs IPC handlers — behavioral fidelity version.
 *
 * Preserves all per-renderer semantics by passing wcId + event.sender
 * to the coordinator.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { Buffer } from 'node:buffer'
import type { DocumentService } from '@genoffice/runtime-contracts'
import type { DocsShellCoordinatorImpl } from './docs-coordinator-impl.js'
import type { ElectronFontRegistry } from '@genoffice/platform-electron'
import type { RuntimeContext } from '@genoffice/runtime-contracts'

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
  ipcMain.handle('docs:open', async (event: IpcMainInvokeEvent) => {
    const r = await coordinator.openDocx(event.sender.id)
    if (r) {
      // Forward push event to the renderer
      // The renderer's preload listens for 'docs:opened' — the existing code
      // sends it from loadDocx via the shell. We send it here.
      // But wait — the existing code sends 'docs:opened' only for external
      // opens (Finder/Explorer drop), not for dialog opens. For dialog opens,
      // the return value IS the opened result. So we DON'T send docs:opened
      // here — the renderer gets the result from the invoke() return.
    }
    return r?.result ?? null
  })

  // ── docs:open-path ──────────────────────────────────────────────────
  ipcMain.removeHandler('docs:open-path')
  ipcMain.handle('docs:open-path', async (event: IpcMainInvokeEvent, filePath: string) => {
    const r = await coordinator.openDocxPath(event.sender.id, filePath)
    return r?.result ?? null
  })

  // ── docs:save ──────────────────────────────────────────────────────
  ipcMain.removeHandler('docs:save')
  ipcMain.handle(
    'docs:save',
    async (event: IpcMainInvokeEvent, filePath: string, data: ArrayBuffer, auto?: boolean) => {
      return coordinator.saveDocx(event.sender.id, filePath, new Uint8Array(data), auto === true)
    },
  )

  // ── docs:save-as ────────────────────────────────────────────────────
  ipcMain.removeHandler('docs:save-as')
  ipcMain.handle(
    'docs:save-as',
    async (event: IpcMainInvokeEvent, defaultName: string, data: ArrayBuffer) => {
      return coordinator.saveDocxAs(event.sender.id, defaultName, new Uint8Array(data))
    },
  )

  // ── docs:save-new ───────────────────────────────────────────────────
  ipcMain.removeHandler('docs:save-new')
  ipcMain.handle(
    'docs:save-new',
    async (event: IpcMainInvokeEvent, defaultName: string, data: ArrayBuffer) => {
      return coordinator.saveDocxNew(event.sender.id, defaultName, new Uint8Array(data))
    },
  )

  // ── docs:write-recovery ─────────────────────────────────────────────
  ipcMain.removeHandler('docs:write-recovery')
  ipcMain.handle(
    'docs:write-recovery',
    async (event: IpcMainInvokeEvent, filePath: string, data: ArrayBuffer) => {
      return coordinator.writeRecovery(event.sender.id, filePath, new Uint8Array(data))
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
  ipcMain.handle('docs:font-metrics', (_event: IpcMainInvokeEvent, family: string) => {
    return typeof family === 'string' ? fontRegistry.fontMetrics(family) : Promise.resolve(null)
  })

  // ── docs:print (caller-specific) ────────────────────────────────────
  ipcMain.removeHandler('docs:print')
  ipcMain.handle('docs:print', (event: IpcMainInvokeEvent) => {
    return coordinator.print(event.sender)
  })

  // ── docs:export-pdf (with per-wcId authorization) ───────────────────
  ipcMain.removeHandler('docs:export-pdf')
  ipcMain.handle(
    'docs:export-pdf',
    async (
      event: IpcMainInvokeEvent,
      defaultName: string,
      pageWidthTwips: number,
      pageHeightTwips: number,
      outPath?: string,
    ) => {
      return coordinator.exportPdf(
        event.sender.id,
        defaultName,
        pageWidthTwips,
        pageHeightTwips,
        outPath,
        event.sender,
      )
    },
  )

  // ── docs:print-pdf-buffer (caller-specific) ────────────────────────
  ipcMain.removeHandler('docs:print-pdf-buffer')
  ipcMain.handle(
    'docs:print-pdf-buffer',
    async (event: IpcMainInvokeEvent, pageWidthTwips: number, pageHeightTwips: number) => {
      return coordinator.printPdfBuffer(event.sender, pageWidthTwips, pageHeightTwips)
    },
  )

  // ── docs:save-merged-pdf (with per-wcId authorization) ──────────────
  ipcMain.removeHandler('docs:save-merged-pdf')
  ipcMain.handle(
    'docs:save-merged-pdf',
    async (
      event: IpcMainInvokeEvent,
      defaultName: string,
      base64Parts: string[],
      outPath?: string,
    ) => {
      return coordinator.saveMergedPdf(
        event.sender.id,
        defaultName,
        base64Parts,
        outPath,
      )
    },
  )
}
