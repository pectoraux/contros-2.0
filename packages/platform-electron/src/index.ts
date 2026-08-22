/**
 * @genoffice/platform-electron — barrel export.
 *
 * The Electron adapter: implements the @genoffice/platform capability
 * interfaces using existing Electron + node:fs + electron-utils + font-metrics
 * + ai-search + project-store + i18n code.
 *
 * This is Layer 4a — the reference adapter. The Web adapter (Layer 4b) is
 * implemented in a later phase.
 */
export { ElectronStorage } from './capabilities/electron-storage.js'
export { ElectronFiles, sha256Bytes, pathExists } from './capabilities/electron-files.js'
export { ElectronSettings } from './capabilities/electron-settings.js'
export { ElectronAI } from './capabilities/electron-ai.js'
export { ElectronIdentity } from './capabilities/electron-identity.js'
export { ElectronPrinting } from './capabilities/electron-printing.js'
export { ElectronClipboard } from './capabilities/electron-clipboard.js'
export { ElectronNotifications } from './capabilities/electron-notifications.js'
export { ElectronWindowing } from './capabilities/electron-windowing.js'
export { ElectronFontRegistry } from './capabilities/electron-font-registry.js'
export { ElectronXlsxSidecarEngine, type ElectronXlsxSidecarEngineConfig, type AdoptExternalSessionOptions } from './capabilities/electron-xlsx-sidecar-engine.js'
export { SidecarProtocolClient, type SidecarProtocolLike, type OnProcessExitCallback } from './capabilities/sidecar-protocol-client.js'
export {
  createElectronCapabilities,
  publishRuntime,
  createElectronRuntime,
  type ElectronCapabilitiesConfig,
  type ElectronCapabilities,
} from './runtime/electron-runtime.js'
