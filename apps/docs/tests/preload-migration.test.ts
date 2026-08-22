/**
 * Increment 3 — Preload integration tests.
 *
 * Verifies the migrated preload correctly:
 *   - Maps DesktopApi methods to ipcRenderer.invoke(channel, ...args)
 *   - Maps push events to ipcRenderer.on(channel, wrappedListener)
 *   - Strips the IpcRendererEvent before delivering the payload
 *   - Unsubscribes via ipcRenderer.removeListener(channel, wrappedListener)
 *   - Preserves getPathForFile (webUtils)
 *
 * These tests mock the `electron` module (ipcRenderer, webUtils) and
 * verify the transport behavior. The bridge itself is already tested in
 * renderer-bridge; these tests verify the PRELOAD-SIDE wiring.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

// ── Mock electron ────────────────────────────────────────────────────────
//
// The preload imports { contextBridge, ipcRenderer, webUtils } from 'electron'.
// We mock all three so the preload can be imported in the test environment.
//
// vi.hoisted ensures the mock objects exist before vi.mock's factory runs
// (vi.mock is hoisted to the top of the file by vitest).

type IpcListener = (event: unknown, ...args: unknown[]) => void

const mocks = vi.hoisted(() => {
  const ipcRendererMock = {
    invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(),
    send: vi.fn<(channel: string, ...args: unknown[]) => void>(),
    on: vi.fn<(channel: string, listener: IpcListener) => void>(),
    removeListener: vi.fn<(channel: string, listener: IpcListener) => void>(),
  }
  const webUtilsMock = {
    getPathForFile: vi.fn<(file: File) => string>().mockReturnValue('/mock/path'),
  }
  const contextBridgeMock = {
    exposeInMainWorld: vi.fn(),
  }
  return { ipcRendererMock, webUtilsMock, contextBridgeMock }
})

vi.mock('electron', () => ({
  contextBridge: mocks.contextBridgeMock,
  ipcRenderer: mocks.ipcRendererMock,
  webUtils: mocks.webUtilsMock,
}))

const { ipcRendererMock, webUtilsMock, contextBridgeMock } = mocks

// ── Import after mock ────────────────────────────────────────────────────
//
// The preload module is imported AFTER the mock is set up. The preload
// calls contextBridge.exposeInMainWorld at module load time, so we capture
// the `api` object from the mock's call.

import '../src/preload/index'

// Extract the `api` (DesktopApi) that was passed to contextBridge.exposeInMainWorld
function getDesktopApi(): Record<string, unknown> {
  const calls = contextBridgeMock.exposeInMainWorld.mock.calls
  // First call is exposeInMainWorld('desktop', api)
  const desktopCall = calls.find((c) => c[0] === 'desktop')
  if (!desktopCall) throw new Error('contextBridge.exposeInMainWorld("desktop", ...) was not called')
  return desktopCall[1] as Record<string, unknown>
}

beforeEach(() => {
  // Clear only the IPC method mocks — NOT contextBridge.exposeInMainWorld,
  // which was called once at module load time and whose calls we need to
  // extract the `api` object from.
  mocks.ipcRendererMock.invoke.mockClear()
  mocks.ipcRendererMock.send.mockClear()
  mocks.ipcRendererMock.on.mockClear()
  mocks.ipcRendererMock.removeListener.mockClear()
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('Increment 3 — Preload DesktopApi migration', () => {
  describe('Request mapping (DesktopApi → ipcRenderer.invoke)', () => {
    test('openDocx() → ipcRenderer.invoke("docs:open")', async () => {
      const api = getDesktopApi()
      ipcRendererMock.invoke.mockResolvedValueOnce(null)
      await (api.openDocx as () => Promise<unknown>)()
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:open')
    })

    test('openDocxPath(path) → ipcRenderer.invoke("docs:open-path", path)', async () => {
      const api = getDesktopApi()
      await (api.openDocxPath as (p: string) => Promise<unknown>)('/test.docx')
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:open-path', '/test.docx')
    })

    test('saveDocx(path, data, auto) → ipcRenderer.invoke("docs:save", path, data, auto===true)', async () => {
      const api = getDesktopApi()
      const buf = new ArrayBuffer(2)
      await (api.saveDocx as (p: string, d: ArrayBuffer, a?: boolean) => Promise<unknown>)(
        '/p.docx', buf, true,
      )
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:save', '/p.docx', buf, true)
    })

    test('saveDocx auto defaults to false', async () => {
      const api = getDesktopApi()
      await (api.saveDocx as (p: string, d: ArrayBuffer, a?: boolean) => Promise<unknown>)(
        '/p.docx', new ArrayBuffer(0),
      )
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:save', '/p.docx', expect.any(ArrayBuffer), false)
    })

    test('saveDocxAs(name, data) → ipcRenderer.invoke("docs:save-as", name, data)', async () => {
      const api = getDesktopApi()
      await (api.saveDocxAs as (n: string, d: ArrayBuffer) => Promise<unknown>)('name.docx', new ArrayBuffer(0))
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:save-as', 'name.docx', expect.any(ArrayBuffer))
    })

    test('saveDocxNew(name, data) → ipcRenderer.invoke("docs:save-new", name, data)', async () => {
      const api = getDesktopApi()
      await (api.saveDocxNew as (n: string, d: ArrayBuffer) => Promise<unknown>)('name.docx', new ArrayBuffer(0))
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:save-new', 'name.docx', expect.any(ArrayBuffer))
    })

    test('writeRecoveryCopy(path, data) → ipcRenderer.invoke("docs:write-recovery", path, data)', async () => {
      const api = getDesktopApi()
      await (api.writeRecoveryCopy as (p: string, d: ArrayBuffer) => Promise<unknown>)('/p.docx', new ArrayBuffer(0))
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:write-recovery', '/p.docx', expect.any(ArrayBuffer))
    })

    test('getRecentFiles() → ipcRenderer.invoke("docs:recent")', async () => {
      const api = getDesktopApi()
      await (api.getRecentFiles as () => Promise<unknown>)()
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:recent')
    })

    test('pickImage() → ipcRenderer.invoke("docs:pick-image")', async () => {
      const api = getDesktopApi()
      await (api.pickImage as () => Promise<unknown>)()
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:pick-image')
    })

    test('fontMetrics(family) → ipcRenderer.invoke("docs:font-metrics", family)', async () => {
      const api = getDesktopApi()
      await (api.fontMetrics as (f: string) => Promise<unknown>)('Arial')
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:font-metrics', 'Arial')
    })

    test('print() → ipcRenderer.invoke("docs:print")', async () => {
      const api = getDesktopApi()
      await (api.print as () => Promise<unknown>)()
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:print')
    })

    test('exportPdf(...) → ipcRenderer.invoke("docs:export-pdf", ...)', async () => {
      const api = getDesktopApi()
      await (api.exportPdf as (n: string, w: number, h: number, o?: string) => Promise<unknown>)(
        'name.pdf', 12240, 15840, '/out.pdf',
      )
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:export-pdf', 'name.pdf', 12240, 15840, '/out.pdf')
    })

    test('printPdfBuffer(w, h) → ipcRenderer.invoke("docs:print-pdf-buffer", w, h)', async () => {
      const api = getDesktopApi()
      await (api.printPdfBuffer as (w: number, h: number) => Promise<unknown>)(12240, 15840)
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:print-pdf-buffer', 12240, 15840)
    })

    test('saveMergedPdf(...) → ipcRenderer.invoke("docs:save-merged-pdf", ...)', async () => {
      const api = getDesktopApi()
      await (api.saveMergedPdf as (n: string, p: string[], o?: string) => Promise<unknown>)(
        'name.pdf', ['part1'], '/out.pdf',
      )
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:save-merged-pdf', 'name.pdf', ['part1'], '/out.pdf')
    })

    test('consumePendingOpenDocx() → ipcRenderer.invoke("docs:consume-pending-open")', async () => {
      const api = getDesktopApi()
      await (api.consumePendingOpenDocx as () => Promise<unknown>)()
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:consume-pending-open')
    })

    test('consumeNewBlankDoc() → ipcRenderer.invoke("docs:consume-new-blank")', async () => {
      const api = getDesktopApi()
      await (api.consumeNewBlankDoc as () => Promise<unknown>)()
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('docs:consume-new-blank')
    })

    test('getLanguage() → ipcRenderer.invoke("app:get-language")', async () => {
      const api = getDesktopApi()
      await (api.getLanguage as () => Promise<unknown>)()
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('app:get-language')
    })

    test('getTheme() → ipcRenderer.invoke("app:get-theme")', async () => {
      const api = getDesktopApi()
      await (api.getTheme as () => Promise<unknown>)()
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('app:get-theme')
    })

    test('openNewTab(openPath) → ipcRenderer.invoke("win:new", openPath ?? null)', async () => {
      const api = getDesktopApi()
      await (api.openNewTab as (p?: string | null) => Promise<unknown>)('/p.docx')
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('win:new', '/p.docx')
    })

    test('openNewTab(null) → ipcRenderer.invoke("win:new", null)', async () => {
      const api = getDesktopApi()
      await (api.openNewTab as (p?: string | null) => Promise<unknown>)(null)
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('win:new', null)
    })

    test('listDocsTabs() → ipcRenderer.invoke("win:list")', async () => {
      const api = getDesktopApi()
      await (api.listDocsTabs as () => Promise<unknown>)()
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('win:list')
    })

    test('focusDocsTab(id) → ipcRenderer.invoke("win:focus", id)', async () => {
      const api = getDesktopApi()
      await (api.focusDocsTab as (id: string) => Promise<unknown>)('tab-1')
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('win:focus', 'tab-1')
    })
  })

  describe('Send mapping (DesktopApi → ipcRenderer.send)', () => {
    test('reportViewMenuState → ipcRenderer.send("docs:view-menu-state", {aiSidebar, darkCanvas})', () => {
      const api = getDesktopApi()
      ;(api.reportViewMenuState as (s: { aiSidebar: boolean; darkCanvas: boolean }) => void)({
        aiSidebar: true,
        darkCanvas: false,
      })
      expect(ipcRendererMock.send).toHaveBeenCalledWith('docs:view-menu-state', {
        aiSidebar: true,
        darkCanvas: false,
      })
    })

    test('reportCloseCheck → ipcRenderer.send("docs:close-check-result", {...})', () => {
      const api = getDesktopApi()
      ;(api.reportCloseCheck as (s: { dirty: boolean; autoSave: boolean; filePath?: string | null }) => void)({
        dirty: true,
        autoSave: false,
        filePath: '/p.docx',
      })
      expect(ipcRendererMock.send).toHaveBeenCalledWith('docs:close-check-result', {
        dirty: true,
        autoSave: false,
        filePath: '/p.docx',
      })
    })

    test('reportCloseSaveResult → ipcRenderer.send("docs:close-save-result", ok===true)', () => {
      const api = getDesktopApi()
      ;(api.reportCloseSaveResult as (ok: boolean) => void)(true)
      expect(ipcRendererMock.send).toHaveBeenCalledWith('docs:close-save-result', true)
    })
  })

  describe('Push event mapping (ipcRenderer.on → DesktopApi handler)', () => {
    test('onOpenDocx: ipcRenderer.on("docs:opened") → handler(result)', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      const unsub = (api.onOpenDocx as (h: (r: unknown) => void) => () => void)(handler)

      // Verify ipcRenderer.on was called with the channel
      expect(ipcRendererMock.on).toHaveBeenCalledWith('docs:opened', expect.any(Function))

      // Get the wrapped listener that was registered
      const wrappedListener = ipcRendererMock.on.mock.calls[0][1]

      // Simulate the main process sending the event
      const payload = { path: '/test.docx', name: 'test.docx', data: new ArrayBuffer(0), hash: 'abc' }
      wrappedListener({}, payload) // first arg is the IpcRendererEvent (stripped)

      // The handler received ONLY the payload (not the event)
      expect(handler).toHaveBeenCalledWith(payload)
      expect(handler).toHaveBeenCalledTimes(1)

      // Unsubscribe removes the listener
      unsub()
      expect(ipcRendererMock.removeListener).toHaveBeenCalledWith('docs:opened', wrappedListener)
    })

    test('onRenamedDocx: ipcRenderer.on("docs:renamed") → handler({oldPath, newPath})', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      const unsub = (api.onRenamedDocx as (h: (p: unknown) => void) => () => void)(handler)

      const wrappedListener = ipcRendererMock.on.mock.calls[0][1]
      const payload = { oldPath: '/old.docx', newPath: '/new.docx' }
      wrappedListener({}, payload)

      expect(handler).toHaveBeenCalledWith(payload)

      unsub()
      expect(ipcRendererMock.removeListener).toHaveBeenCalledWith('docs:renamed', wrappedListener)
    })

    test('onTeardown: ipcRenderer.on("docs:teardown") → handler()', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      const unsub = (api.onTeardown as (h: () => void) => () => void)(handler)

      const wrappedListener = ipcRendererMock.on.mock.calls[0][1]
      wrappedListener({}) // no payload args

      expect(handler).toHaveBeenCalledWith()
      expect(handler).toHaveBeenCalledTimes(1)

      unsub()
      expect(ipcRendererMock.removeListener).toHaveBeenCalledWith('docs:teardown', wrappedListener)
    })

    test('onLanguageChanged: strips IpcRendererEvent, delivers lang', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      ;(api.onLanguageChanged as (h: (l: unknown) => void) => () => void)(handler)

      const wrappedListener = ipcRendererMock.on.mock.calls[0][1]
      wrappedListener({}, 'en') // event + lang

      expect(handler).toHaveBeenCalledWith('en')
    })

    test('onThemeChanged: strips IpcRendererEvent, delivers theme', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      ;(api.onThemeChanged as (h: (t: unknown) => void) => () => void)(handler)

      const wrappedListener = ipcRendererMock.on.mock.calls[0][1]
      wrappedListener({}, 'dark')

      expect(handler).toHaveBeenCalledWith('dark')
    })

    test('onChromePressed: handler called with no args', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      ;(api.onChromePressed as (h: () => void) => () => void)(handler)

      const wrappedListener = ipcRendererMock.on.mock.calls[0][1]
      wrappedListener({})

      expect(handler).toHaveBeenCalledWith()
    })

    test('onAiStream: strips IpcRendererEvent, delivers chunk', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      ;(api.onAiStream as (h: (c: unknown) => void) => () => void)(handler)

      const wrappedListener = ipcRendererMock.on.mock.calls[0][1]
      const chunk = { type: 'text', text: 'hello' }
      wrappedListener({}, chunk)

      expect(handler).toHaveBeenCalledWith(chunk)
    })

    test('onMenuCommand: strips IpcRendererEvent, delivers (command, payload)', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      ;(api.onMenuCommand as (h: (c: unknown, p?: string) => void) => () => void)(handler)

      const wrappedListener = ipcRendererMock.on.mock.calls[0][1]
      wrappedListener({}, 'save', undefined)

      expect(handler).toHaveBeenCalledWith('save', undefined)
    })

    test('onCloseCheck: handler called with no args', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      ;(api.onCloseCheck as (h: () => void) => () => void)(handler)

      const wrappedListener = ipcRendererMock.on.mock.calls[0][1]
      wrappedListener({})

      expect(handler).toHaveBeenCalledWith()
    })

    test('onCloseSaveRequest: handler called with no args', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      ;(api.onCloseSaveRequest as (h: () => void) => () => void)(handler)

      const wrappedListener = ipcRendererMock.on.mock.calls[0][1]
      wrappedListener({})

      expect(handler).toHaveBeenCalledWith()
    })
  })

  describe('Unsubscribe semantics', () => {
    test('unsubscribe calls ipcRenderer.removeListener with the SAME wrapped listener', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      const unsub = (api.onOpenDocx as (h: (r: unknown) => void) => () => void)(handler)

      // The wrapped listener was registered via ipcRenderer.on
      const registeredListener = ipcRendererMock.on.mock.calls[0][1]

      // Unsubscribe
      unsub()

      // removeListener was called with the SAME listener reference
      expect(ipcRendererMock.removeListener).toHaveBeenCalledWith('docs:opened', registeredListener)
      expect(ipcRendererMock.removeListener).toHaveBeenCalledTimes(1)
    })

    test('unsubscribe is idempotent-safe (calling the returned function)', () => {
      const api = getDesktopApi()
      const handler = vi.fn()
      const unsub = (api.onTeardown as (h: () => void) => () => void)(handler)

      // Calling unsub should not throw
      expect(() => unsub()).not.toThrow()
    })
  })

  describe('getPathForFile (webUtils)', () => {
    test('delegates to webUtils.getPathForFile', () => {
      const api = getDesktopApi()
      const file = new File([], 'test.docx')
      const result = (api.getPathForFile as (f: File) => string)(file)

      expect(webUtilsMock.getPathForFile).toHaveBeenCalledWith(file)
      expect(result).toBe('/mock/path')
    })
  })

  describe('projectApi unchanged', () => {
    test('projectApi is still exposed via contextBridge', () => {
      const calls = contextBridgeMock.exposeInMainWorld.mock.calls
      const projectCall = calls.find((c) => c[0] === 'projectApi')
      expect(projectCall).toBeDefined()
    })

    test('projectApi.resolveChat → ipcRenderer.invoke("project:resolveChat")', async () => {
      const calls = contextBridgeMock.exposeInMainWorld.mock.calls
      const projectCall = calls.find((c) => c[0] === 'projectApi')
      const projectApi = projectCall![1] as Record<string, unknown>
      await (projectApi.resolveChat as (a: unknown) => Promise<unknown>)({})
      expect(ipcRendererMock.invoke).toHaveBeenCalledWith('project:resolveChat', {})
    })
  })

  describe('Single implementation (no duplication)', () => {
    test('contextBridge.exposeInMainWorld is called exactly twice (desktop + projectApi)', () => {
      expect(contextBridgeMock.exposeInMainWorld).toHaveBeenCalledTimes(2)
      const channels = contextBridgeMock.exposeInMainWorld.mock.calls.map((c) => c[0])
      expect(channels).toContain('desktop')
      expect(channels).toContain('projectApi')
    })
  })
})
