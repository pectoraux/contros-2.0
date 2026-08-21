/**
 * Increment 2H — Push-event IPC mapping tests.
 *
 * Proves:
 *   - ipcRenderer.on('docs:opened', ...) → DesktopApi.onOpenDocx(handler)
 *   - ipcRenderer.on('docs:renamed', ...) → DesktopApi.onRenamedDocx(handler)
 *   - ipcRenderer.on('docs:teardown', ...) → DesktopApi.onTeardown(handler)
 *   - ipcRenderer.on('ai:stream-chunk', ...) → DesktopApi.onAiStream(handler)
 *   - ipcRenderer.on('menu:command', ...) → DesktopApi.onMenuCommand(handler)
 *   - ipcRenderer.on('docs:close-check', ...) → DesktopApi.onCloseCheck(handler)
 *   - ipcRenderer.on('docs:close-save-request', ...) → DesktopApi.onCloseSaveRequest(handler)
 *   - The handler receives only the payload (NOT the IpcRendererEvent)
 *   - The unsubscribe function removes the listener
 *
 * The bridge wraps the IPC listener — the renderer handler receives
 * only the payload. The IpcTransport implementation (in the preload)
 * strips the IpcRendererEvent.
 */
import { describe, test, expect, vi } from 'vitest'
import { createDocsDesktopBridge } from '../../src/bridges/docs-bridge.js'
import type { DocsIpcTransport } from '../../src/ipc-transport.js'

type Listener = (...args: unknown[]) => void

function makeTransportWithListeners(): {
  transport: DocsIpcTransport
  listeners: Map<string, Listener[]>
  emit: (channel: string, ...args: unknown[]) => void
} {
  const listeners = new Map<string, Listener[]>()
  const transport: DocsIpcTransport = {
    invoke: vi.fn().mockResolvedValue(null),
    send: vi.fn(),
    on: vi.fn((channel: string, listener: Listener) => {
      const arr = listeners.get(channel) ?? []
      arr.push(listener)
      listeners.set(channel, arr)
      return () => {
        const arr = listeners.get(channel) ?? []
        const idx = arr.indexOf(listener)
        if (idx >= 0) arr.splice(idx, 1)
        listeners.set(channel, arr)
      }
    }),
  }
  return {
    transport,
    listeners,
    emit: (channel: string, ...args: unknown[]) => {
      for (const l of listeners.get(channel) ?? []) l(...args)
    },
  }
}

describe('createDocsDesktopBridge push-event mapping', () => {
  test('onOpenDocx: transport.on("docs:opened") → handler(result)', () => {
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    const unsub = bridge.onOpenDocx(handler)

    const payload = { path: '/test.docx', name: 'test.docx', data: new ArrayBuffer(0), hash: 'abc' }
    emit('docs:opened', payload)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(payload)

    // Unsubscribe removes the listener
    unsub()
    handler.mockClear()
    emit('docs:opened', payload)
    expect(handler).not.toHaveBeenCalled()
  })

  test('onRenamedDocx: transport.on("docs:renamed") → handler({oldPath, newPath})', () => {
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    bridge.onRenamedDocx(handler)

    const payload = { oldPath: '/old.docx', newPath: '/new.docx' }
    emit('docs:renamed', payload)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(payload)
  })

  test('onTeardown: transport.on("docs:teardown") → handler()', () => {
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    bridge.onTeardown(handler)

    emit('docs:teardown')

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith()
  })

  test('onAiStream: transport.on("ai:stream-chunk") → handler(chunk)', () => {
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    bridge.onAiStream(handler)

    const chunk = { type: 'text', text: 'hello' }
    emit('ai:stream-chunk', chunk)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(chunk)
  })

  test('onLanguageChanged: transport.on("app:language-changed") → handler(lang)', () => {
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    bridge.onLanguageChanged(handler)

    emit('app:language-changed', 'en')

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('en')
  })

  test('onThemeChanged: transport.on("app:theme-changed") → handler(theme)', () => {
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    bridge.onThemeChanged(handler)

    emit('app:theme-changed', 'dark')

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('dark')
  })

  test('onChromePressed: transport.on("app:chrome-pressed") → handler()', () => {
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    bridge.onChromePressed(handler)

    emit('app:chrome-pressed')

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith()
  })

  test('onMenuCommand: transport.on("menu:command") → handler(command, payload)', () => {
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    bridge.onMenuCommand(handler)

    emit('menu:command', 'save', undefined)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('save', undefined)
  })

  test('onMenuCommand with payload: transport.on("menu:command") → handler(command, payload)', () => {
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    bridge.onMenuCommand(handler)

    emit('menu:command', 'open-path', '/test.docx')

    expect(handler).toHaveBeenCalledWith('open-path', '/test.docx')
  })

  test('onCloseCheck: transport.on("docs:close-check") → handler()', () => {
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    bridge.onCloseCheck(handler)

    emit('docs:close-check')

    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('onCloseSaveRequest: transport.on("docs:close-save-request") → handler()', () => {
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    bridge.onCloseSaveRequest(handler)

    emit('docs:close-save-request')

    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('handler receives ONLY the payload (NOT the IpcRendererEvent)', () => {
    // The IpcTransport implementation (in the preload) strips the
    // IpcRendererEvent before calling the listener. The bridge handler
    // receives only the payload args.
    const { transport, emit } = makeTransportWithListeners()
    const bridge = createDocsDesktopBridge({
      transport,
      getPathForFile: () => '/mock',
    })
    const handler = vi.fn()
    bridge.onOpenDocx(handler)

    // Emit with just the payload (the transport already stripped the event)
    const payload = { path: '/x.docx', name: 'x.docx', data: new ArrayBuffer(0), hash: 'h' }
    emit('docs:opened', payload)

    // The handler received exactly 1 arg (the payload), not 2 (event + payload)
    expect(handler.mock.calls[0]).toHaveLength(1)
    expect(handler.mock.calls[0][0]).toBe(payload)
  })
})
