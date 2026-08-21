/**
 * createElectronRuntime — constructs the full RuntimeContext for the Electron
 * adapter. Wires all 9 capabilities + the ProjectStore + the DocumentService.
 *
 * This is the ONLY function that calls setRuntime() during bootstrap.
 *
 * BOUNDARY CORRECTION (2026-08-21, per Principal Architect review):
 *   - Removed `attachDocsService()` and `getRuntimeForAttach()` — they were a
 *     service-locator escape hatch that violated "getRuntime() is bootstrap-only".
 *   - The runtime is now constructed in THREE explicit phases, with NO mutation
 *     after setRuntime():
 *       Phase A: construct the 9 capabilities (no service deps)
 *       Phase B: construct the DocumentService (depends on capabilities from A)
 *       Phase C: construct the RuntimeContext and call setRuntime() ONCE
 *
 * IMPORTANT (ADR-001 Correction A): the DocumentServiceImpl receives its
 * dependencies via constructor injection. It does NOT call getRuntime()
 * internally.
 *
 * Per Phase 1 increment 1 (corrected), this constructs the full runtime for
 * the Docs editor. Sheets/Slides/PDF/Markdown services are constructed in
 * later increments and added to the runtime.
 */
import { app, dialog, shell, nativeTheme, nativeImage } from 'electron'
import { join } from 'node:path'
import { setRuntime, type RuntimeContext } from '@genoffice/runtime-contracts'
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
  getActiveWebContents?: () => any
  /** Function to get the active BrowserWindow (for setProgressBar / dialog parent). */
  getActiveWindow?: () => { setProgressBar: (p: number) => void; isDestroyed: () => boolean } | null
  /**
   * The DocumentService to wire into the runtime. The caller constructs it
   * (with its own EventBus + shell hooks) and passes it in. This avoids the
   * runtime factory depending on services-docs (which would create a circular
   * dep: services-docs → platform-electron types → runtime factory → services-docs).
   *
   * For Phase 1 increment 1 (corrected), this is constructed by the docs main
   * bootstrap and passed in. Null when appKind !== 'docs'.
   */
  docsService?: any
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
    dialog: dialog as any,
    shell: shell as any,
    parentWindow: () => getActiveWindow() as any,
    fallbackDir: join(documentsDir, 'GenOffice'),
  })
  const settings = new ElectronSettings({
    userDataDir,
    documentsDir,
    nativeTheme: nativeTheme as any,
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
    getActiveWebContents: () => getActiveWebContents() as any,
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
  // The docsService is constructed by the caller (apps/docs/src/main/index.ts)
  // and passed in via config.docsService. We do NOT construct it here to avoid
  // a circular dep (services-docs imports types from platform-electron).
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
    docs: config.docsService ?? null,
    sheets: null as any, // Phase 1 increment 2 (Sheets)
    slides: null as any, // Phase 1 increment 4 (Slides)
    pdf: null as any, // Phase 1 increment 3 (PDF)
    markdown: null as any, // Phase 1 increment 5 (Markdown)
    project: projectStore as any,
  }

  // THE ONLY setRuntime call in the bootstrap. No attachDocsService, no
  // getRuntimeForAttach, no service-locator escape hatch.
  setRuntime(runtime)

  return runtime
}
