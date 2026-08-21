/**
 * createElectronCapabilities — constructs all 9 Electron capabilities + ProjectStore
 * WITHOUT calling setRuntime().
 *
 * The caller constructs domain services using these capabilities, then calls
 * publishRuntime() to publish the final wired runtime exactly once.
 *
 * IMPORTANT (ADR-001 Correction A): capabilities receive their dependencies
 * via constructor injection. They do NOT call getRuntime() internally.
 */
import { app, dialog, shell, nativeTheme, nativeImage } from 'electron'
import { join } from 'node:path'
import {
  NOT_YET_WIRED,
  type RuntimeContext,
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

export interface ElectronCapabilitiesConfig {
  appKind: 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown' | 'shell'
  broadcast?: (channel: string, ...args: unknown[]) => void
  getActiveWebContents?: () => unknown
  getActiveWindow?: () => { setProgressBar: (p: number) => void; isDestroyed: () => boolean } | null
}

export interface ElectronCapabilities {
  storage: ElectronStorage
  files: ElectronFiles
  settings: ElectronSettings
  ai: ElectronAI
  identity: ElectronIdentity
  printing: ElectronPrinting
  clipboard: ElectronClipboard
  notifications: ElectronNotifications
  windowing: ElectronWindowing
  fontRegistry: ElectronFontRegistry
  projectStore: ProjectStore
  /** The partial runtime with NOT_YET_WIRED for all domain services. */
  partialRuntime: RuntimeContext
}

export function createElectronCapabilities(config: ElectronCapabilitiesConfig): ElectronCapabilities {
  const userDataDir = app.getPath('userData')
  const documentsDir = app.getPath('documents')
  const appVersion = app.getVersion()
  const broadcast = config.broadcast ?? (() => {})
  const getActiveWebContents = config.getActiveWebContents ?? (() => null)
  const getActiveWindow = config.getActiveWindow ?? (() => null)

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
  const projectStore = new ProjectStore(userDataDir)

  const partialRuntime: RuntimeContext = {
    platform: 'electron',
    version: appVersion,
    storage, files, identity, ai, printing, clipboard, notifications, windowing, settings,
    docs: NOT_YET_WIRED('Docs service not yet constructed'),
    sheets: NOT_YET_WIRED('Sheets service — Phase 1 increment 3'),
    slides: NOT_YET_WIRED('Slides service — Phase 1 increment 4'),
    pdf: NOT_YET_WIRED('PDF service — Phase 1 increment 5'),
    markdown: NOT_YET_WIRED('Markdown service — Phase 1 increment 6'),
    project: projectStore as unknown as RuntimeContext['project'],
  }

  return { storage, files, settings, ai, identity, printing, clipboard, notifications, windowing, fontRegistry, projectStore, partialRuntime }
}

/**
 * publishRuntime — calls setRuntime() exactly once with the final wired runtime.
 * The caller constructs domain services using the capabilities, builds the final
 * RuntimeContext, and passes it here.
 */
import { setRuntime } from '@genoffice/runtime-contracts'

export function publishRuntime(runtime: RuntimeContext): void {
  setRuntime(runtime)
}

/**
 * createElectronRuntime — legacy convenience wrapper.
 * Constructs capabilities + publishes runtime with NOT_YET_WIRED for all
 * domain services. Use createElectronCapabilities + publishRuntime instead
 * when you need to construct domain services before publishing.
 */
export function createElectronRuntime(config: ElectronCapabilitiesConfig): RuntimeContext {
  const caps = createElectronCapabilities(config)
  setRuntime(caps.partialRuntime)
  return caps.partialRuntime
}
