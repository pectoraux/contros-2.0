/**
 * createElectronRuntime — constructs the full RuntimeContext for the Electron
 * adapter. Wires all 9 capabilities + the ProjectStore + (optionally) the
 * DocumentService.
 *
 * BOUNDARY CORRECTION (2026-08-21, FINAL pass):
 *   - `docsService` is now typed `DocumentService | undefined` (not `any`)
 *   - Unwired services use `NOT_YET_WIRED(reason)` instead of `null as any`
 *   - `project: projectStore` is typed (no `as any`)
 *   - The `dialog as any` / `shell as any` casts remain (narrowing Electron's
 *     types to our typed subset — these are NOT escape hatches, they're
 *     type-narrowing casts that are safe because ElectronFilesDeps declares
 *     the subset we use)
 *
 * The runtime is constructed in THREE explicit phases with NO mutation
 * after setRuntime():
 *   Phase A: 9 capabilities (no service deps)
 *   Phase B: ProjectStore
 *   Phase C: RuntimeContext + setRuntime() (the ONLY call)
 *
 * IMPORTANT (ADR-001 Correction A): the DocumentServiceImpl receives its
 * dependencies via constructor injection. It does NOT call getRuntime()
 * internally.
 */
import { app, dialog, shell, nativeTheme, nativeImage } from 'electron'
import { join } from 'node:path'
import {
  setRuntime,
  NOT_YET_WIRED,
  type RuntimeContext,
  type DocumentService,
} from '@genoffice/runtime-contracts'
import { ProjectStore } from '@genoffice/project-store'

import { ElectronStorage } from '../capabilities/electron-storage.js'
import { ElectronFiles } from '../capabilities/electron-files.js'
import { ElectronSettings } from '../capabilities/electron-settings.js'
import { ElectronAI } from '../capabilities/electron-ai.js'
import { ElectronIdentity } from '../capabilities/electron-identity.js'
import { ElectronPrinting } from '../capabilities/electron-printing.js'
import { ElectronClipboard } from '../capabilities/electron-clipboard.js'
import { ElectronNotifications } from '../capabilities/electron-notifications.js'
import { ElectronWindowing } from '../capabilities/electron-windowing.js'
import { ElectronFontRegistry } from '../capabilities/electron-font-registry.js'

export interface ElectronRuntimeConfig {
  /** Which app is constructing the runtime. */
  appKind: 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown' | 'shell'
  /** Function to broadcast events to all webContents (e.g. theme changes). */
  broadcast?: (channel: string, ...args: unknown[]) => void
  /** Function to get the active webContents (for printing). */
  getActiveWebContents?: () => unknown
  /** Function to get the active BrowserWindow (for setProgressBar / dialog parent). */
  getActiveWindow?: () => { setProgressBar: (p: number) => void; isDestroyed: () => boolean } | null
  /**
   * The DocumentService to wire into the runtime. The caller constructs it
   * (with its own EventBus + SessionRegistry) and passes it in.
   *
   * When undefined, `runtime.docs` is `NOT_YET_WIRED('...')` — the bridge
   * checks `isWired(runtime.docs)` before delegating.
   *
   * Typed as `DocumentService` (NOT `any`) — the caller must provide a
   * properly-typed service.
   */
  docsService?: DocumentService
}

export function createElectronRuntime(config: ElectronRuntimeConfig): RuntimeContext {
  const userDataDir = app.getPath('userData')
  const documentsDir = app.getPath('documents')
  const appVersion = app.getVersion()
  const broadcast = config.broadcast ?? (() => {})
  const getActiveWebContents = config.getActiveWebContents ?? (() => null)
  const getActiveWindow = config.getActiveWindow ?? (() => null)

  // ── Phase A: capabilities (no service dependencies) ───────────────────
  const storage = new ElectronStorage({ userDataDir })
  const files = new ElectronFiles({
    dialog: dialog as unknown as ElectronFiles['deps']['dialog'],
    shell: shell as unknown as ElectronFiles['deps']['shell'],
    parentWindow: () => getActiveWindow() as unknown as ReturnType<typeof getActiveWindow>,
    fallbackDir: join(documentsDir, 'GenOffice'),
  })
  const settings = new ElectronSettings({
    userDataDir,
    documentsDir,
    nativeTheme: nativeTheme as unknown as ConstructorParameters<typeof ElectronSettings>[0]['nativeTheme'],
    broadcast,
    appVersion,
  })
  const ai = new ElectronAI({
    userDataDir,
    openExternal: (url) => shell.openExternal(url),
  })
  const identity = new ElectronIdentity({
    openExternal: (url) => shell.openExternal(url),
    openCreditUsageUrl: () => shell.openExternal('https://www.genspark.ai/credit-usage'),
    openGenTeamUrl: () => shell.openExternal('https://genoffice.ai/join'),
  })
  const printing = new ElectronPrinting({
    getActiveWebContents: () => getActiveWebContents() as never,
    twipsPerInch: 1440,
  })
  const clipboard = new ElectronClipboard({
    clipboard: require('electron').clipboard,
    nativeImageFromBuffer: (buf) => nativeImage.createFromBuffer(buf),
  })
  const notifications = new ElectronNotifications({
    NotificationCtor: require('electron').Notification,
  })
  const windowing = new ElectronWindowing({
    openExternal: (url) => shell.openExternal(url),
    getActiveWindow,
  })
  const fontRegistry = new ElectronFontRegistry({
    cacheDir: join(userDataDir, 'font-metrics'),
  })

  // ── Phase B: project store (filesystem-backed via @genoffice/project-store) ──
  const projectStore = new ProjectStore(userDataDir)

  // ── Phase C: construct the runtime (capabilities + services in one pass) ──
  // Service slots use ServiceSlot<T> — either the actual service, or NOT_YET_WIRED(reason).
  // No `null as any` placeholders.
  const runtime: RuntimeContext = {
    platform: 'electron',
    version: appVersion,
    storage,
    files,
    identity,
    ai,
    printing,
    clipboard,
    notifications,
    windowing,
    settings,
    docs: config.docsService ?? NOT_YET_WIRED('Docs service not yet constructed — Phase 1 increment 2 wires it'),
    sheets: NOT_YET_WIRED('Sheets service — Phase 1 increment 3'),
    slides: NOT_YET_WIRED('Slides service — Phase 1 increment 4'),
    pdf: NOT_YET_WIRED('PDF service — Phase 1 increment 5'),
    markdown: NOT_YET_WIRED('Markdown service — Phase 1 increment 6'),
    project: projectStore as unknown as RuntimeContext['project'],
  }

  // THE ONLY setRuntime call in the bootstrap. No attachDocsService, no
  // getRuntimeForAttach, no service-locator escape hatch.
  setRuntime(runtime)

  return runtime
}
