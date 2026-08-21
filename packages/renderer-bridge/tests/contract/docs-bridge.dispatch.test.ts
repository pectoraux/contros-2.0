/**
 * Dispatch test for createDocsDesktopBridge.
 *
 * The bridge delegates to a DocsShellCoordinator (mocked here).
 * Verifies the bridge is genuinely thin — no session management, no stubs.
 */
import { describe, test, expect, vi } from 'vitest'
import { createDocsDesktopBridge } from '../../src/bridges/docs-bridge.js'
import type { DocsShellCoordinator } from '../../src/shell/docs-coordinator.js'
import { mockRuntime } from '../helpers/mocks.js'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import { NOT_YET_WIRED } from '@genoffice/runtime-contracts'

function mockCoordinator(): DocsShellCoordinator {
  return {
    openDocx: vi.fn().mockResolvedValue(null),
    openDocxPath: vi.fn().mockResolvedValue(null),
    consumePendingOpen: vi.fn().mockResolvedValue(null),
    consumeNewBlank: vi.fn().mockResolvedValue(false),
    saveDocx: vi.fn().mockResolvedValue({ ok: true }),
    saveDocxAs: vi.fn().mockResolvedValue({ ok: false }),
    saveDocxNew: vi.fn().mockResolvedValue({ ok: false }),
    writeRecovery: vi.fn().mockResolvedValue({ ok: true }),
    openNewTab: vi.fn().mockResolvedValue(undefined),
    listDocsTabs: vi.fn().mockResolvedValue([]),
    focusDocsTab: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockReturnValue(null),
    registerSession: vi.fn(),
    onMenuCommand: vi.fn().mockReturnValue(() => {}),
    reportViewMenuState: vi.fn(),
  }
}

function makeBridge(runtime: RuntimeContext) {
  const coordinator = mockCoordinator()
  return { bridge: createDocsDesktopBridge({ runtime, coordinator }), coordinator }
}

function makeWiredRuntime() {
  const runtime = mockRuntime()
  ;(runtime as any).docs = {
    openDialog: vi.fn().mockResolvedValue(null),
    open: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue({ ok: true }),
    saveAs: vi.fn().mockResolvedValue({ ok: false }),
    saveNew: vi.fn().mockResolvedValue({ ok: false }),
    writeRecovery: vi.fn().mockResolvedValue({ ok: true }),
    recentFiles: vi.fn().mockResolvedValue([]),
    pickImage: vi.fn().mockResolvedValue(null),
    pickAttachments: vi.fn().mockResolvedValue(null),
    addAttachmentPaths: vi.fn().mockResolvedValue({ accepted: [], rejected: [] }),
    addPastedImage: vi.fn().mockResolvedValue({ accepted: [], rejected: [] }),
    readAttachment: vi.fn().mockResolvedValue({ ok: false, error: '' }),
    readAttachmentImage: vi.fn().mockResolvedValue({ ok: false, error: '' }),
    fontMetrics: vi.fn().mockResolvedValue(null),
    print: vi.fn().mockResolvedValue({ ok: true }),
    exportPdf: vi.fn().mockResolvedValue({ ok: false }),
    printPdfBuffer: vi.fn().mockResolvedValue({ ok: false }),
    saveMergedPdf: vi.fn().mockResolvedValue({ ok: false }),
    getAiSettings: vi.fn().mockResolvedValue({}),
    setAiSettings: vi.fn().mockResolvedValue(undefined),
    aiChat: vi.fn().mockResolvedValue({}),
    aiStream: vi.fn().mockResolvedValue(undefined),
    aiStreamCancel: vi.fn().mockResolvedValue(undefined),
    onAiStream: vi.fn().mockReturnValue(() => {}),
    onOpened: vi.fn().mockReturnValue(() => {}),
    onRenamed: vi.fn().mockReturnValue(() => {}),
    onTeardown: vi.fn().mockReturnValue(() => {}),
    onCloseCheck: vi.fn().mockReturnValue(() => {}),
    reportCloseCheck: vi.fn(),
    onCloseSaveRequest: vi.fn().mockReturnValue(() => {}),
    reportCloseSaveResult: vi.fn(),
  }
  return runtime
}

describe('createDocsDesktopBridge dispatch', () => {
  test('getTheme dispatches to runtime.settings.getTheme', async () => {
    const runtime = makeWiredRuntime()
    const { bridge } = makeBridge(runtime)
    await bridge.getTheme()
    expect(runtime.settings.getTheme).toHaveBeenCalledTimes(1)
  })

  test('saveDocx delegates to coordinator (NOT to docs service)', async () => {
    const runtime = makeWiredRuntime()
    const { bridge, coordinator } = makeBridge(runtime)
    await bridge.saveDocx('/p.docx', new ArrayBuffer(2), true)
    expect(coordinator.saveDocx).toHaveBeenCalledWith('/p.docx', expect.any(Uint8Array), true)
    expect(runtime.docs.save).not.toHaveBeenCalled()
  })

  test('openNewTab delegates to coordinator', async () => {
    const runtime = makeWiredRuntime()
    const { bridge, coordinator } = makeBridge(runtime)
    await bridge.openNewTab('/p.docx')
    expect(coordinator.openNewTab).toHaveBeenCalledWith('/p.docx')
  })

  test('consumeNewBlankDoc delegates to coordinator', async () => {
    const runtime = makeWiredRuntime()
    const { bridge, coordinator } = makeBridge(runtime)
    await bridge.consumeNewBlankDoc()
    expect(coordinator.consumeNewBlank).toHaveBeenCalledTimes(1)
  })

  test('requireWired throws when runtime.docs is NOT_YET_WIRED', () => {
    const runtime = mockRuntime()
    ;(runtime as any).docs = NOT_YET_WIRED('not yet')
    const { bridge } = makeBridge(runtime)
    expect(() => bridge.getRecentFiles()).toThrow(/not wired/)
  })

  test('ArrayBuffer is converted to Uint8Array before passing to coordinator', async () => {
    const runtime = makeWiredRuntime()
    const { bridge, coordinator } = makeBridge(runtime)
    const buffer = new ArrayBuffer(3)
    new Uint8Array(buffer).set([1, 2, 3])
    await bridge.saveDocx('/p.docx', buffer)
    const passedBytes = coordinator.saveDocx.mock.calls[0][1]
    expect(passedBytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(passedBytes)).toEqual([1, 2, 3])
  })
})
