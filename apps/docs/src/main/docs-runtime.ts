/**
 * Docs runtime construction — single publication.
 *
 * Constructs the full runtime in one pass:
 *   1. Electron capabilities (via createElectronRuntime)
 *   2. DocumentService (using the capabilities)
 *   3. Coordinator (using the service + capabilities)
 *   4. ONE setRuntime() with the wired runtime
 *
 * createElectronRuntime() calls setRuntime() internally with NOT_YET_WIRED
 * for the docs slot. We override it immediately after with the wired runtime.
 * This is acceptable because:
 *   - The NOT_YET_WIRED runtime is never observed by any consumer
 *   - setRuntime() is called with the final wired runtime before any
 *     IPC handler is registered or window is created
 *
 * The bootstrap sequence is:
 *   app.whenReady()
 *     → initDocsRuntime()  (constructs capabilities + service + coordinator + setRuntime)
 *     → startDocsStandalone()  (registers IPC handlers, creates window)
 *     → registerMigratedDocsIpc()  (overrides handlers with runtime-backed implementations)
 *
 * At no point does any consumer see a NOT_YET_WIRED docs service.
 */
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createElectronRuntime, ElectronFontRegistry, ElectronFiles, ElectronPrinting } from '@genoffice/platform-electron'
import { DocumentServiceImpl, type DocsEventBus } from '@genoffice/services-docs'
import { setRuntime, type RuntimeContext, type DocumentService } from '@genoffice/runtime-contracts'
import { DocsShellCoordinatorImpl } from './docs-coordinator-impl.js'

export interface DocsRuntimeBundle {
  runtime: RuntimeContext
  docsService: DocumentService
  coordinator: DocsShellCoordinatorImpl
  fontRegistry: ElectronFontRegistry
}

export let runtimeBundle: DocsRuntimeBundle | null = null

export function initDocsRuntime(): DocsRuntimeBundle {
  const userDataDir = app.getPath('userData')

  // ── Font registry ─────────────────────────────────────────────────
  const fontRegistry = new ElectronFontRegistry({
    cacheDir: join(userDataDir, 'font-metrics'),
  })

  // ── Event bus (forwards domain events to coordinator → webContents) ──
  // The event bus is the bridge between the domain service's events
  // and the shell's push-event forwarding to the renderer.
  // The coordinator holds the active webContents reference.
  // We create the coordinator first (needs the service), so we use
  // a mutable holder.
  let coordinatorRef: DocsShellCoordinatorImpl | null = null

  const eventBus: DocsEventBus = {
    opened: (result) => { coordinatorRef?.sendOpened(result) },
    renamed: (paths) => { coordinatorRef?.sendRenamed(paths.oldPath, paths.newPath) },
    teardown: () => { coordinatorRef?.sendTeardown() },
  }

  // ── Construct runtime (calls setRuntime with NOT_YET_WIRED docs) ──
  const initialRuntime = createElectronRuntime({
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

  // ── Construct DocumentService with the runtime's capabilities ────
  const docsService = new DocumentServiceImpl(
    {
      storage: initialRuntime.storage,
      files: initialRuntime.files,
      ai: initialRuntime.ai,
      printing: initialRuntime.printing,
      settings: initialRuntime.settings,
      fontRegistry,
    },
    eventBus,
  )

  // ── Construct coordinator ─────────────────────────────────────────
  const coordinator = new DocsShellCoordinatorImpl({
    docs: docsService,
    userDataDir,
    getFocusedWindow: () => {
      const win = BrowserWindow.getFocusedWindow()
      return win && !win.isDestroyed() ? win : null
    },
    files: {
      pickSave: async (opts: { defaultName: string; accept?: string[] }) => {
        const result = await initialRuntime.files.pickSave(opts)
        return typeof result === 'string' ? result : null
      },
    },
    printToPDF: (wc, opts) => wc.printToPDF(opts),
    print: (wc, opts) => new Promise((resolve) => {
      wc.print(opts as never, (success: boolean, failureReason?: string) => {
        resolve({
          ok: success,
          ...(failureReason && !/cancel/i.test(failureReason) ? { error: failureReason } : {}),
        })
      })
    }),
  })
  coordinatorRef = coordinator

  // ── Publish the FINAL runtime with the wired docs service ─────────
  // This is the ONLY setRuntime that matters. The one inside
  // createElectronRuntime() published NOT_YET_WIRED — no consumer
  // observed it because we hadn't registered any handlers yet.
  const wiredRuntime: RuntimeContext = {
    ...initialRuntime,
    docs: docsService,
  }
  setRuntime(wiredRuntime)

  runtimeBundle = { runtime: wiredRuntime, docsService, coordinator, fontRegistry }
  return runtimeBundle
}
