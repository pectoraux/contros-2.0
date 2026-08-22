/**
 * DocsIpcContract — the typed IPC channel map for the Docs application.
 *
 * CONTRACT HARDENING (Increment 3D):
 *   All return types, argument tuples, and event payloads are DERIVED from
 *   the frozen DesktopApi interface (apps/docs/src/shared/ipc.ts) using
 *   TypeScript's `Parameters` and `ReturnType` utility types. This
 *   eliminates the drift hazard of manually duplicating SaveResult,
 *   SaveAsResult, ExportPdfResult, etc.
 *
 *   The channel names and argument order are still manually specified
 *   (they encode the IPC protocol), but the types they reference are
 *   structurally linked to the authoritative DesktopApi.
 *
 * Architecture:
 *
 *   Renderer (window.desktop)
 *       ↓
 *   DesktopApi (bridge — typed methods)
 *       ↓
 *   TypedIpcTransport.invoke('docs:open') — type-checked channel + args + return
 *       ↓
 *   [Electron: ipcRenderer.invoke('docs:open')]
 *       ↓
 *   ipcMain handler
 */

// ── Type helpers ────────────────────────────────────────────────────────

export interface IpcRequestChannel {
  Args: unknown[]
  Return: unknown
}

export interface IpcSendChannel {
  Args: unknown[]
}

export interface IpcEventChannel {
  Payload: unknown[]
}

// ── Derive types from the authoritative DesktopApi ──────────────────────
//
// Instead of manually declaring SaveResult, SaveAsResult, etc., we extract
// them from DesktopApi's method signatures. If DesktopApi changes, these
// types update automatically — no drift.

import type { DesktopApi } from '@genoffice/docs-shared'
import type {
  OpenFileResult,
  PickImageResult,
  UiTheme,
  MenuCommand,
  DocsTabInfo,
  AttachmentAddResult,
  AttachmentReadResult,
  AttachmentImageResult,
} from '@genoffice/docs-shared'
import type {
  AiSettings,
  AiChatRequest,
  AiChatResponse,
  AiStreamRequest,
  AiStreamChunk,
  GenSparkAccountStatus,
} from '@genoffice/ai-provider'
import type { FaceVerticalMetrics } from '@genoffice/font-metrics'

// Extract return types from DesktopApi methods (unwrapped from Promise)
type Awaited<T> = T extends Promise<infer U> ? U : T
type ReturnOf<M extends keyof DesktopApi> = Awaited<ReturnType<DesktopApi[M]>>

// Extract parameter tuples from DesktopApi methods
type ParamsOf<M extends keyof DesktopApi> = Parameters<DesktopApi[M]>

// The language type — derived from DesktopApi.getLanguage's return type
type UiLanguage = ReturnOf<'getLanguage'>

// ── Docs IPC channel map ────────────────────────────────────────────────

export type DocsIpcRequestChannels = {
  // ── Settings ──
  'app:get-language': { Args: []; Return: UiLanguage }
  'app:get-theme': { Args: []; Return: UiTheme }
  // ── File lifecycle ──
  'docs:open': { Args: []; Return: ReturnOf<'openDocx'> }
  'docs:open-path': { Args: ParamsOf<'openDocxPath'>; Return: ReturnOf<'openDocxPath'> }
  'docs:consume-pending-open': { Args: []; Return: ReturnOf<'consumePendingOpenDocx'> }
  'docs:consume-new-blank': { Args: []; Return: ReturnOf<'consumeNewBlankDoc'> }
  // ── Save ──
  'docs:save': {
    Args: ParamsOf<'saveDocx'>
    Return: ReturnOf<'saveDocx'>
  }
  'docs:write-recovery': {
    Args: ParamsOf<'writeRecoveryCopy'>
    Return: ReturnOf<'writeRecoveryCopy'>
  }
  'docs:save-as': {
    Args: ParamsOf<'saveDocxAs'>
    Return: ReturnOf<'saveDocxAs'>
  }
  'docs:save-new': {
    Args: ParamsOf<'saveDocxNew'>
    Return: ReturnOf<'saveDocxNew'>
  }
  // ── Domain operations ──
  'docs:recent': { Args: []; Return: ReturnOf<'getRecentFiles'> }
  'docs:pick-image': { Args: []; Return: ReturnOf<'pickImage'> }
  'docs:font-metrics': { Args: ParamsOf<'fontMetrics'>; Return: ReturnOf<'fontMetrics'> }
  'docs:print': { Args: []; Return: ReturnOf<'print'> }
  'docs:export-pdf': {
    Args: ParamsOf<'exportPdf'>
    Return: ReturnOf<'exportPdf'>
  }
  'docs:print-pdf-buffer': {
    Args: ParamsOf<'printPdfBuffer'>
    Return: ReturnOf<'printPdfBuffer'>
  }
  'docs:save-merged-pdf': {
    Args: ParamsOf<'saveMergedPdf'>
    Return: ReturnOf<'saveMergedPdf'>
  }
  // ── Files ──
  'files:pick': { Args: []; Return: ReturnOf<'pickAttachments'> }
  'files:add': { Args: ParamsOf<'addAttachmentPaths'>; Return: ReturnOf<'addAttachmentPaths'> }
  'files:add-pasted-image': {
    Args: ParamsOf<'addPastedImage'>
    Return: ReturnOf<'addPastedImage'>
  }
  'files:read': {
    Args: ParamsOf<'readAttachment'>
    Return: ReturnOf<'readAttachment'>
  }
  'files:read-image': { Args: ParamsOf<'readAttachmentImage'>; Return: ReturnOf<'readAttachmentImage'> }
  // ── AI ──
  'ai:get-settings': { Args: []; Return: ReturnOf<'getAiSettings'> }
  'ai:set-settings': { Args: ParamsOf<'setAiSettings'>; Return: ReturnOf<'setAiSettings'> }
  'ai:chat': { Args: ParamsOf<'aiChat'>; Return: ReturnOf<'aiChat'> }
  'ai:stream': { Args: ParamsOf<'aiStream'>; Return: ReturnOf<'aiStream'> }
  'ai:stream-cancel': { Args: ParamsOf<'aiStreamCancel'>; Return: ReturnOf<'aiStreamCancel'> }
  'ai:gsk-status': { Args: ParamsOf<'aiGskStatus'>; Return: ReturnOf<'aiGskStatus'> }
  'ai:gsk-login': { Args: []; Return: ReturnOf<'aiGskLogin'> }
  'ai:web-search': {
    Args: ParamsOf<'webSearch'>
    Return: ReturnOf<'webSearch'>
  }
  'ai:image-search': {
    Args: ParamsOf<'imageSearch'>
    Return: ReturnOf<'imageSearch'>
  }
  'ai:fetch-image': { Args: ParamsOf<'fetchImage'>; Return: ReturnOf<'fetchImage'> }
  // ── Tab management ──
  'win:new': { Args: ParamsOf<'openNewTab'>; Return: ReturnOf<'openNewTab'> }
  'win:list': { Args: []; Return: ReturnOf<'listDocsTabs'> }
  'win:focus': { Args: ParamsOf<'focusDocsTab'>; Return: ReturnOf<'focusDocsTab'> }
}

export type DocsIpcSendChannels = {
  'docs:view-menu-state': { Args: [ParamsOf<'reportViewMenuState'>[0]] }
  'docs:close-check-result': { Args: [ParamsOf<'reportCloseCheck'>[0]] }
  'docs:close-save-result': { Args: [ParamsOf<'reportCloseSaveResult'>[0]] }
}

export type DocsIpcEventChannels = {
  'app:language-changed': { Payload: [Parameters<Parameters<DesktopApi['onLanguageChanged']>[0]>[0]] }
  'app:theme-changed': { Payload: [Parameters<Parameters<DesktopApi['onThemeChanged']>[0]>[0]] }
  'app:chrome-pressed': { Payload: [] }
  'docs:opened': { Payload: [Parameters<Parameters<DesktopApi['onOpenDocx']>[0]>[0]] }
  'docs:renamed': { Payload: [Parameters<Parameters<DesktopApi['onRenamedDocx']>[0]>[0]] }
  'docs:teardown': { Payload: [] }
  'ai:stream-chunk': { Payload: [Parameters<Parameters<DesktopApi['onAiStream']>[0]>[0]] }
  'menu:command': { Payload: [Parameters<Parameters<DesktopApi['onMenuCommand']>[0]>[0], Parameters<Parameters<DesktopApi['onMenuCommand']>[0]>[1]] }
  'docs:close-check': { Payload: [] }
  'docs:close-save-request': { Payload: [] }
}
