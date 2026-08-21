/**
 * Dispatch test for createDocsDesktopBridge.
 *
 * Verifies the bridge is genuinely thin — each DesktopApi method maps to
 * the correct IPC channel name and payload shape, using the injected
 * IpcTransport. No session management, no coordinator, no runtime.
 *
 * The IPC channel names and payload shapes match the frozen preload
 * (apps/docs/src/preload/index.ts).
 */
import { describe, test, expect, vi } from 'vitest'
import { createDocsDesktopBridge } from '../../src/bridges/docs-bridge.js'
import type { IpcTransport } from '../../src/ipc-transport.js'

function mockTransport(): IpcTransport & {
  invoke: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
} {
  return {
    invoke: vi.fn().mockResolvedValue(null),
    send: vi.fn(),
    on: vi.fn().mockReturnValue(() => {}),
  }
}

function makeBridge() {
  const transport = mockTransport()
  const bridge = createDocsDesktopBridge({
    transport,
    getPathForFile: vi.fn().mockReturnValue('/mock/path'),
  })
  return { bridge, transport }
}

describe('createDocsDesktopBridge IPC dispatch', () => {
  // ── Request mapping: DesktopApi method → ipcRenderer.invoke(channel, ...args) ──

  test('openDocx() → invoke("docs:open")', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.openDocx()
    expect(transport.invoke).toHaveBeenCalledWith('docs:open')
  })

  test('openDocxPath(path) → invoke("docs:open-path", path)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.openDocxPath('/test/file.docx')
    expect(transport.invoke).toHaveBeenCalledWith('docs:open-path', '/test/file.docx')
  })

  test('consumePendingOpenDocx() → invoke("docs:consume-pending-open")', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.consumePendingOpenDocx()
    expect(transport.invoke).toHaveBeenCalledWith('docs:consume-pending-open')
  })

  test('consumeNewBlankDoc() → invoke("docs:consume-new-blank")', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.consumeNewBlankDoc()
    expect(transport.invoke).toHaveBeenCalledWith('docs:consume-new-blank')
  })

  test('saveDocx(path, data, auto) → invoke("docs:save", path, data, auto===true)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.saveDocx('/p.docx', new ArrayBuffer(2), true)
    expect(transport.invoke).toHaveBeenCalledWith('docs:save', '/p.docx', expect.any(ArrayBuffer), true)
  })

  test('saveDocx auto defaults to false (not undefined)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.saveDocx('/p.docx', new ArrayBuffer(2))
    expect(transport.invoke).toHaveBeenCalledWith('docs:save', '/p.docx', expect.any(ArrayBuffer), false)
  })

  test('writeRecoveryCopy(path, data) → invoke("docs:write-recovery", path, data)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.writeRecoveryCopy('/p.docx', new ArrayBuffer(2))
    expect(transport.invoke).toHaveBeenCalledWith('docs:write-recovery', '/p.docx', expect.any(ArrayBuffer))
  })

  test('saveDocxAs(defaultName, data) → invoke("docs:save-as", defaultName, data)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.saveDocxAs('name.docx', new ArrayBuffer(2))
    expect(transport.invoke).toHaveBeenCalledWith('docs:save-as', 'name.docx', expect.any(ArrayBuffer))
  })

  test('saveDocxNew(defaultName, data) → invoke("docs:save-new", defaultName, data)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.saveDocxNew('name.docx', new ArrayBuffer(2))
    expect(transport.invoke).toHaveBeenCalledWith('docs:save-new', 'name.docx', expect.any(ArrayBuffer))
  })

  test('getRecentFiles() → invoke("docs:recent")', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.getRecentFiles()
    expect(transport.invoke).toHaveBeenCalledWith('docs:recent')
  })

  test('pickImage() → invoke("docs:pick-image")', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.pickImage()
    expect(transport.invoke).toHaveBeenCalledWith('docs:pick-image')
  })

  test('fontMetrics(family) → invoke("docs:font-metrics", family)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.fontMetrics('Arial')
    expect(transport.invoke).toHaveBeenCalledWith('docs:font-metrics', 'Arial')
  })

  test('print() → invoke("docs:print")', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.print()
    expect(transport.invoke).toHaveBeenCalledWith('docs:print')
  })

  test('exportPdf(defaultName, w, h, outPath) → invoke("docs:export-pdf", ...)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.exportPdf('name.pdf', 12240, 15840, '/out.pdf')
    expect(transport.invoke).toHaveBeenCalledWith('docs:export-pdf', 'name.pdf', 12240, 15840, '/out.pdf')
  })

  test('printPdfBuffer(w, h) → invoke("docs:print-pdf-buffer", w, h)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.printPdfBuffer(12240, 15840)
    expect(transport.invoke).toHaveBeenCalledWith('docs:print-pdf-buffer', 12240, 15840)
  })

  test('saveMergedPdf(defaultName, parts, outPath) → invoke("docs:save-merged-pdf", ...)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.saveMergedPdf('name.pdf', ['part1'], '/out.pdf')
    expect(transport.invoke).toHaveBeenCalledWith('docs:save-merged-pdf', 'name.pdf', ['part1'], '/out.pdf')
  })

  test('pickAttachments() → invoke("files:pick")', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.pickAttachments()
    expect(transport.invoke).toHaveBeenCalledWith('files:pick')
  })

  test('addAttachmentPaths(paths) → invoke("files:add", paths)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.addAttachmentPaths(['/a.docx'])
    expect(transport.invoke).toHaveBeenCalledWith('files:add', ['/a.docx'])
  })

  test('readAttachment(path, offset, maxChars) → invoke("files:read", ...)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.readAttachment('/a.docx', 0, 1000)
    expect(transport.invoke).toHaveBeenCalledWith('files:read', '/a.docx', 0, 1000)
  })

  test('readAttachmentImage(path) → invoke("files:read-image", path)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.readAttachmentImage('/img.png')
    expect(transport.invoke).toHaveBeenCalledWith('files:read-image', '/img.png')
  })

  test('openNewTab(openPath) → invoke("win:new", openPath ?? null)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.openNewTab('/p.docx')
    expect(transport.invoke).toHaveBeenCalledWith('win:new', '/p.docx')
  })

  test('openNewTab(null) → invoke("win:new", null)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.openNewTab(null)
    expect(transport.invoke).toHaveBeenCalledWith('win:new', null)
  })

  test('listDocsTabs() → invoke("win:list")', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.listDocsTabs()
    expect(transport.invoke).toHaveBeenCalledWith('win:list')
  })

  test('focusDocsTab(id) → invoke("win:focus", id)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.focusDocsTab('tab-1')
    expect(transport.invoke).toHaveBeenCalledWith('win:focus', 'tab-1')
  })

  // ── Settings ──

  test('getLanguage() → invoke("app:get-language")', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.getLanguage()
    expect(transport.invoke).toHaveBeenCalledWith('app:get-language')
  })

  test('getTheme() → invoke("app:get-theme")', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.getTheme()
    expect(transport.invoke).toHaveBeenCalledWith('app:get-theme')
  })

  // ── AI ──

  test('aiChat(request) → invoke("ai:chat", request)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.aiChat({} as never)
    expect(transport.invoke).toHaveBeenCalledWith('ai:chat', expect.anything())
  })

  test('aiStream(request) → invoke("ai:stream", request)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.aiStream({} as never)
    expect(transport.invoke).toHaveBeenCalledWith('ai:stream', expect.anything())
  })

  test('webSearch(query, maxResults) → invoke("ai:web-search", query, maxResults)', async () => {
    const { bridge, transport } = makeBridge()
    await bridge.webSearch('query', 10)
    expect(transport.invoke).toHaveBeenCalledWith('ai:web-search', 'query', 10)
  })

  // ── Send (fire-and-forget) ──

  test('reportViewMenuState(state) → send("docs:view-menu-state", {aiSidebar, darkCanvas})', () => {
    const { bridge, transport } = makeBridge()
    bridge.reportViewMenuState({ aiSidebar: true, darkCanvas: false })
    expect(transport.send).toHaveBeenCalledWith('docs:view-menu-state', {
      aiSidebar: true,
      darkCanvas: false,
    })
  })

  test('reportCloseCheck(state) → send("docs:close-check-result", {dirty, autoSave, filePath})', () => {
    const { bridge, transport } = makeBridge()
    bridge.reportCloseCheck({ dirty: true, autoSave: false, filePath: '/p.docx' })
    expect(transport.send).toHaveBeenCalledWith('docs:close-check-result', {
      dirty: true,
      autoSave: false,
      filePath: '/p.docx',
    })
  })

  test('reportCloseSaveResult(ok) → send("docs:close-save-result", ok===true)', () => {
    const { bridge, transport } = makeBridge()
    bridge.reportCloseSaveResult(true)
    expect(transport.send).toHaveBeenCalledWith('docs:close-save-result', true)
  })

  // ── getPathForFile (preload-only, no IPC) ──

  test('getPathForFile delegates to the injected function (no IPC)', () => {
    const getPathForFile = vi.fn().mockReturnValue('/mock/path')
    const bridge = createDocsDesktopBridge({
      transport: mockTransport(),
      getPathForFile,
    })
    const file = new File([], 'test.docx')
    const result = bridge.getPathForFile(file)
    expect(getPathForFile).toHaveBeenCalledWith(file)
    expect(result).toBe('/mock/path')
  })
})
