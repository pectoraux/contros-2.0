/**
 * createElectronRuntime — constructs the full RuntimeContext for the Electron
 * adapter. Wires all 9 capabilities + the ProjectStore + DocumentService.
 *
 * This is the ONLY function that calls setRuntime() during bootstrap.
 *
 * IMPORTANT (ADR-001 Correction A): the DocumentServiceImpl receives its
 * dependencies via constructor injection. It does NOT call getRuntime()
 * internally.
 *
 * Per Phase 1 increment 1 plan, this constructs the full runtime for the Docs
 * editor. Sheets/Slides/PDF/Markdown services are constructed in later
 * increments and added to the runtime.
 */
import { app, dialog, shell, nativeTheme, nativeImage, BrowserWindow } from 'electron'
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
}

export function createElectronRuntime(config: ElectronRuntimeConfig): RuntimeContext {
  const userDataDir = app.getPath('userData')
  const documentsDir = app.getPath('documents')
  const appVersion = app.getVersion()
  const broadcast = config.broadcast ?? (() => {})
  const getActiveWebContents = config.getActiveWebContents ?? (() => null)
  const getActiveWindow = config.getActiveWindow ?? (() => null)

  // ── Capabilities ──────────────────────────────────────────────────────
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

  // ── Project store (filesystem-backed via @genoffice/project-store) ────
  const projectStore = new ProjectStore(userDataDir)

  // ── DocumentService (Phase 1 increment 1 — Docs only) ────────────────
  // Lazy import to avoid circular deps; the service depends on capabilities.
  // In Phase 1 increment 1, only the Docs service is constructed.
  let docsService: any = null
  // We construct it lazily because services-docs is a separate package and
  // we want to avoid loading it when appKind !== 'docs'.
  // The actual construction happens in the docs main bootstrap.

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
    docs: docsService as any,
    sheets: null as any, // Phase 1 increment 2 (Sheets)
    slides: null as any, // Phase 1 increment 4 (Slides)
    pdf: null as any, // Phase 1 increment 3 (PDF)
    markdown: null as any, // Phase 1 increment 5 (Markdown)
    project: projectStore as any,
  }

  // Set the global singleton (bootstrap-only call)
  setRuntime(runtime)

  return runtime
}

/**
 * Set the DocumentService on the runtime after the docs main has constructed it.
 * This avoids a circular dependency: services-docs imports from platform-electron
 * (for types only), and platform-electron constructs the runtime (which contains
 * the DocumentService).
 */
export function attachDocsService(docsService: any): void {
  const runtime = getRuntimeForAttach()
  ;(runtime as any).docs = docsService
}

// Lazy getter to avoid importing getRuntime at the top level (circular).
function getRuntimeForAttach(): RuntimeContext {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getRuntime } = require('@genoffice/runtime-contracts')
  return getRuntime() as RuntimeContext
}
