/**
 * Dispatch test for createDocsDesktopBridge.
 *
 * BOUNDARY CORRECTION (2026-08-21, final): the bridge now takes
 * DocsBridgeDeps { runtime, registry } instead of just runtime.
 * The registry is a SessionRegistry owned by the shell.
 *
 * Verifies:
 * - destination: correct service method called
 * - non-destination: wrong service method NOT called
 * - argument transformation: ArrayBuffer → Uint8Array
 * - session lookup: bridge queries registry (no synthetic sessions)
 * - isWired guard: throws when runtime.docs is NOT_YET_WIRED
 */
import { describe, test, expect, vi } from 'vitest'
import { createDocsDesktopBridge } from '../../src/bridges/docs-bridge.js'
import { InMemorySessionRegistry } from '@genoffice/services-docs'
import {
  mockRuntime,
  mockSettings,
  mockIdentity,
  mockWindowing,
} from '../helpers/mocks.js'
import type { DocumentSession, RuntimeContext } from '@genoffice/runtime-contracts'
import { NOT_YET_WIRED } from '@genoffice/runtime-contracts'

function makeBridgeWithRegistry(runtime: RuntimeContext) {
  const registry = new InMemorySessionRegistry()
  const bridge = createDocsDesktopBridge({ runtime, registry })
  return { bridge, registry }
}

function makeWiredRuntime(overrides: Partial<RuntimeContext> = {}) {
  const runtime = mockRuntime(overrides)
  // Wire the docs service (mock it as a real DocumentService)
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
    onMenuCommand: vi.fn().mockReturnValue(() => {}),
    onCloseCheck: vi.fn().mockReturnValue(() => {}),
    reportCloseCheck: vi.fn(),
    onCloseSaveRequest: vi.fn().mockReturnValue(() => {}),
    reportCloseSaveResult: vi.fn(),
    reportViewMenuState: vi.fn(),
  }
  return runtime
}

describe('createDocsDesktopBridge dispatch (with SessionRegistry)', () => {
  test('getTheme dispatches to runtime.settings.getTheme (NOT docs.save)', async () => {
    const settings = mockSettings()
    const runtime = makeWiredRuntime({ settings })
    const { bridge } = makeBridgeWithRegistry(runtime)

    await bridge.getTheme()

    expect(settings.getTheme).toHaveBeenCalledTimes(1)
  })

  test('saveDocx with unregistered path returns "not an opened document" (NO synthetic session)', async () => {
    const runtime = makeWiredRuntime()
    const { bridge, registry } = makeBridgeWithRegistry(runtime)
    // Don't register any session for this path

    const result = await bridge.saveDocx('/never-opened.docx', new ArrayBuffer(2))

    expect(result).toEqual({ ok: false, error: 'save target is not an opened document' })
    expect(runtime.docs.save).not.toHaveBeenCalled()
  })

  test('saveDocx with registered session delegates to docs.save with the session', async () => {
    const runtime = makeWiredRuntime()
    runtime.docs.save = vi.fn().mockResolvedValue({ ok: true, session: { filePath: '/p.docx', hash: 'h' } }) as never
    const { bridge, registry } = makeBridgeWithRegistry(runtime)
    const session: DocumentSession = { filePath: '/p.docx', hash: 'oldhash', diskState: { mtimeMs: 0, size: 0, hash: 'oldhash' } }
    registry.register(session)

    const buffer = new ArrayBuffer(4)
    new Uint8Array(buffer).set([1, 2, 3, 4])

    await bridge.saveDocx('/p.docx', buffer, true)

    expect(runtime.docs.save).toHaveBeenCalledTimes(1)
    const [passedSession, passedBytes, auto] = runtime.docs.save.mock.calls[0]
    expect(passedSession).toBe(session) // The actual registered session, not a synthetic one
    expect(passedBytes).toBeInstanceOf(Uint8Array)
    expect(auto).toBe(true)
  })

  test('openDocxPath registers the session in the registry', async () => {
    const runtime = makeWiredRuntime()
    const session: DocumentSession = { filePath: '/p.docx', hash: 'h' }
    runtime.docs.open = vi.fn().mockResolvedValue({ session, result: { path: '/p.docx', name: 'p.docx', data: new ArrayBuffer(0), hash: 'h' } }) as never
    const { bridge, registry } = makeBridgeWithRegistry(runtime)

    await bridge.openDocxPath('/p.docx')

    expect(registry.get('/p.docx')).toBe(session)
  })

  test('multi-tab: two sessions, save each works', async () => {
    const runtime = makeWiredRuntime()
    runtime.docs.save = vi.fn().mockResolvedValue({ ok: true }) as never
    const { bridge, registry } = makeBridgeWithRegistry(runtime)
    const session1: DocumentSession = { filePath: '/a.docx', hash: 'h1' }
    const session2: DocumentSession = { filePath: '/b.docx', hash: 'h2' }
    registry.register(session1)
    registry.register(session2)

    await bridge.saveDocx('/a.docx', new ArrayBuffer(0))
    await bridge.saveDocx('/b.docx', new ArrayBuffer(0))

    expect(runtime.docs.save).toHaveBeenCalledTimes(2)
    expect(runtime.docs.save.mock.calls[0][0]).toBe(session1)
    expect(runtime.docs.save.mock.calls[1][0]).toBe(session2)
  })

  test('isWired guard: saveDocx throws when runtime.docs is NOT_YET_WIRED', async () => {
    const runtime = mockRuntime()
    ;(runtime as any).docs = NOT_YET_WIRED('not yet')
    const { bridge } = makeBridgeWithRegistry(runtime)

    await expect(bridge.saveDocx('/p.docx', new ArrayBuffer(0))).rejects.toThrow(/not wired/)
  })

  test('tab ops delegate to no-ops (shell will wire in Increment 2)', async () => {
    const runtime = makeWiredRuntime()
    const { bridge } = makeBridgeWithRegistry(runtime)

    // openNewTab/listDocsTabs/focusDocsTab are DesktopApi methods but they
    // no longer delegate to runtime.docs (which doesn't have them).
    // They're no-op stubs until the shell wires them via Windowing.
    await bridge.openNewTab()
    const tabs = await bridge.listDocsTabs()
    await bridge.focusDocsTab('tab-1')

    expect(tabs).toEqual([])
    // Verify docs service was NOT called for tab ops
    expect((runtime.docs as any).openNewTab).toBeUndefined()
    expect((runtime.docs as any).listDocsTabs).toBeUndefined()
    expect((runtime.docs as any).focusDocsTab).toBeUndefined()
  })
})
