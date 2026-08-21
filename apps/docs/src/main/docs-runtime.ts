/**
 * Docs runtime construction — single publication (FIXED).
 *
 * Uses createElectronCapabilities() (no setRuntime) + publishRuntime() (one setRuntime).
 *
 * Sequence:
 *   1. createElectronCapabilities() → capabilities (NO setRuntime)
 *   2. Construct DocumentService using capabilities
 *   3. Construct Coordinator using service + capabilities
 *   4. Build final RuntimeContext with wired docs service
 *   5. publishRuntime() — ONE setRuntime() call
 *   6. (caller) register IPC, create windows
 */
import { app, BrowserWindow, type WebContents } from 'electron'
import { join } from 'node:path'
import { createElectronCapabilities, publishRuntime, type ElectronCapabilities } from '@genoffice/platform-electron'
import { DocumentServiceImpl, type DocsEventBus } from '@genoffice/services-docs'
import { type RuntimeContext, type DocumentService } from '@genoffice/runtime-contracts'
import { DocsShellCoordinatorImpl } from './docs-coordinator-impl.js'

export interface DocsRuntimeBundle {
  runtime: RuntimeContext
  docsService: DocumentService
  coordinator: DocsShellCoordinatorImpl
  capabilities: ElectronCapabilities
  fontRegistry: import('@genoffice/platform-electron').ElectronFontRegistry
}

export let runtimeBundle: DocsRuntimeBundle | null = null

export function initDocsRuntime(): DocsRuntimeBundle {
  const userDataDir = app.getPath('userData')

  // ── 1. Capabilities (NO setRuntime) ────────────────────────────────
  const caps = createElectronCapabilities({
    appKind: 'docs',
    broadcast: (channel: string, ...args: unknown[]) => {
      for (const wc of BrowserWindow.getAllWindows()) {
        if (!wc.isDestroyed()) wc.webContents.send(channel, ...args)
      }
    },
    getActiveWebContents: () => {
      const win = BrowserWindow.getFocusedWindow()
      return win && !win.isDestroyed() ? win.webContents : null
    },
    getActiveWindow: () => {
      const win = BrowserWindow.getFocusedWindow()
      return win && !win.isDestroyed() ? win : null
    },
  })

  // ── 2. Per-wcId push-event routing (NOT global activeWc) ───────────
  // The event bus forwards to the coordinator which routes to the
  // correct webContents by wcId.
  let coordinatorRef: DocsShellCoordinatorImpl | null = null

  const eventBus: DocsEventBus = {
    opened: (result) => { coordinatorRef?.sendOpenedToCaller(result) },
    renamed: (paths) => { coordinatorRef?.sendRenamedToCaller(paths.oldPath, paths.newPath) },
    teardown: () => { coordinatorRef?.sendTeardownToCaller() },
  }

  // ── 3. DocumentService (using capabilities) ────────────────────────
  const docsService = new DocumentServiceImpl(
    {
      storage: caps.storage,
      files: caps.files,
      ai: caps.ai,
      printing: caps.printing,
      settings: caps.settings,
      fontRegistry: caps.fontRegistry,
    },
    eventBus,
  )

  // ── 4. Coordinator (using service + capabilities) ──────────────────
  const coordinator = new DocsShellCoordinatorImpl({
    docs: docsService,
    userDataDir,
    shellHooks: undefined, // Set by docs-main.ts when the shell connects
    files: {
      pickSave: async (opts: { defaultName: string; accept?: string[] }) => {
        const result = await caps.files.pickSave(opts)
        return typeof result === 'string' ? result : null
      },
    },
    printToPDF: (wc: WebContents, opts: never) => wc.printToPDF(opts),
    print: (wc: WebContents, opts: never) => new Promise((resolve) => {
      wc.print(opts, (success: boolean, failureReason?: string) => {
        resolve({
          ok: success,
          ...(failureReason && !/cancel/i.test(failureReason) ? { error: failureReason } : {}),
        })
      })
    }),
  })
  coordinatorRef = coordinator

  // ── 5. Build final RuntimeContext + ONE publishRuntime() ────────────
  const wiredRuntime: RuntimeContext = {
    ...caps.partialRuntime,
    docs: docsService,
  }
  publishRuntime(wiredRuntime)

  runtimeBundle = { runtime: wiredRuntime, docsService, coordinator, capabilities: caps, fontRegistry: caps.fontRegistry }
  return runtimeBundle
}
