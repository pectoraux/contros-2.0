/**
 * Docs runtime construction.
 *
 * Constructs the full runtime for the Docs Electron application:
 *   1. 9 Electron capabilities (platform-electron)
 *   2. DocumentServiceImpl (services-docs)
 *   3. DocsShellCoordinatorImpl (apps/docs/src/main)
 *
 * Called once during app bootstrap, after app.whenReady().
 */
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createElectronRuntime, ElectronFontRegistry } from '@genoffice/platform-electron'
import { DocumentServiceImpl, type DocsEventBus } from '@genoffice/services-docs'
import { setRuntime, type RuntimeContext, type DocumentService } from '@genoffice/runtime-contracts'
import { DocsShellCoordinatorImpl } from './docs-coordinator-impl.js'

export interface DocsRuntimeBundle {
  runtime: RuntimeContext
  docsService: DocumentService
  coordinator: DocsShellCoordinatorImpl
  fontRegistry: ElectronFontRegistry
}

export function constructDocsRuntime(): DocsRuntimeBundle {
  const userDataDir = app.getPath('userData')
  const documentsDir = app.getPath('documents')

  // ── Font registry ─────────────────────────────────────────────────
  const fontRegistry = new ElectronFontRegistry({
    cacheDir: join(userDataDir, 'font-metrics'),
  })

  // ── Event bus (forwards domain events to webContents) ──────────────
  const eventBus: DocsEventBus = {
    opened: (_result) => {
      // The IPC handler forwards this to webContents.send('docs:opened', result)
    },
    renamed: (_paths) => {
      // Forwarded by the IPC handler
    },
    teardown: () => {
      // Forwarded by the IPC handler
    },
  }

  // ── Construct the runtime via the Electron adapter ─────────────────
  // The capabilities (storage, files, ai, identity, printing, clipboard,
  // notifications, windowing, settings) are constructed inside
  // createElectronRuntime(). We pass a partial config — the DocumentService
  // is constructed separately because it needs the capabilities as deps.
  //
  // For now, we construct the runtime WITHOUT the docs service (it will be
  // NOT_YET_WIRED), then construct the DocumentServiceImpl with the
  // capabilities, then attach it.
  //
  // But wait — createElectronRuntime() constructs the capabilities internally
  // and doesn't expose them. We need them to construct DocumentServiceImpl.
  //
  // Solution: construct the capabilities ourselves, then pass them to both
  // createElectronRuntime (via config) and DocumentServiceImpl.
  //
  // Actually, createElectronRuntime() constructs everything internally.
  // We need a different approach: construct the capabilities, then the
  // service, then the runtime.
  //
  // For Increment 2, let's use the createElectronRuntime factory and then
  // construct the DocumentService using the runtime's capabilities.
  // The runtime will have docs: NOT_YET_WIRED initially.
  const runtime = createElectronRuntime({
    appKind: 'docs',
    broadcast: (channel: string, ...args: unknown[]) => {
      // Broadcast to all webContents
      for (const wc of BrowserWindow.getAllWindows()) {
        if (!wc.isDestroyed()) {
          wc.webContents.send(channel, ...args)
        }
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

  // ── Construct the DocumentService with the runtime's capabilities ──
  const docsService = new DocumentServiceImpl(
    {
      storage: runtime.storage,
      files: runtime.files,
      ai: runtime.ai,
      printing: runtime.printing,
      settings: runtime.settings,
      fontRegistry,
    },
    eventBus,
  )

  // ── Attach the DocumentService to the runtime ──────────────────────
  // The runtime's docs slot is NOT_YET_WIRED. We need to replace it.
  // Since RuntimeContext is readonly, we use a type-safe approach:
  // create a new runtime object with docs replaced.
  const wiredRuntime: RuntimeContext = {
    ...runtime,
    docs: docsService,
  }
  setRuntime(wiredRuntime)

  // ── Construct the coordinator ──────────────────────────────────────
  const coordinator = new DocsShellCoordinatorImpl({
    docs: docsService,
    userDataDir,
    getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
    // shellHooks will be set by docs-main.ts when the shell connects
  })

  return {
    runtime: wiredRuntime,
    docsService,
    coordinator,
    fontRegistry,
  }
}

/** Module-level singleton — set by constructDocsRuntime(). */
export let runtimeBundle: DocsRuntimeBundle | null = null

/** Construct the runtime and store it as a module-level singleton. */
export function initDocsRuntime(): DocsRuntimeBundle {
  runtimeBundle = constructDocsRuntime()
  return runtimeBundle
}
