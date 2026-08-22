/**
 * Docs-specific entry point for @genoffice/renderer-bridge.
 *
 * CONTRACT HARDENING (Increment 3D):
 *   The main barrel (index.ts) re-exports ALL bridges, including
 *   createSlidesDesktopBridge which imports @genoffice/slides-shared.
 *   That file declares `global { Window.desktop: DesktopFilesApi }` which
 *   conflicts with the docs `Window.desktop: DesktopApi` declaration.
 *
 *   This entry point exports ONLY the Docs bridge + typed transport +
 *   IPC contract — NO slides, sheets, pdf, or markdown bridges. This
 *   allows application preloads (like apps/docs/src/preload) to import
 *   the docs bridge without the slides global declaration polluting
 *   their type space.
 *
 * Usage:
 *   import { createDocsDesktopBridge } from '@genoffice/renderer-bridge/docs'
 *   import type { DocsIpcTransport } from '@genoffice/renderer-bridge/docs'
 */

export { createDocsDesktopBridge, type DocsBridgeDeps } from './bridges/docs-bridge.js'

export type { TypedIpcTransport, DocsIpcTransport } from './ipc-transport.js'
export type {
  DocsIpcRequestChannels,
  DocsIpcSendChannels,
  DocsIpcEventChannels,
  IpcRequestChannel,
  IpcSendChannel,
  IpcEventChannel,
} from './docs-ipc-contract.js'

// Shell types (application-boundary, NOT runtime-contracts)
export type { ShellTabInfo, ShellMenuCommand } from './shell/docs-coordinator.js'
