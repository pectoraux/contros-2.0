/**
 * Dispatch test for createDocsDesktopBridge — the CRITICAL test for
 * ArrayBuffer → Uint8Array argument transformation.
 *
 * BOUNDARY CORRECTION (2026-08-21): the DocumentService is now session-scoped.
 * open() returns { session, result }; save() accepts the session.
 * The bridge holds the active session slot and passes it to save().
 *
 * Verifies (per ADR-002 §5.1.2):
 * - destination: correct service method called
 * - non-destination: wrong service method NOT called
 * - argument transformation: ArrayBuffer → Uint8Array conversion for save*
 * - return transformation: return value passes through
 */
import { describe, test, expect, vi } from 'vitest'
import { createDocsDesktopBridge } from '../../src/bridges/docs-bridge.js'
import {
  mockRuntime,
  mockSettings,
  mockAI,
  mockIdentity,
  mockWindowing,
  mockFiles,
} from '../helpers/mocks.js'

describe('createDocsDesktopBridge dispatch', () => {
  // ── Destination + non-destination ────────────────────────────────────

  test('getTheme dispatches to runtime.settings.getTheme (NOT docs.save, NOT ai)', async () => {
    const settings = mockSettings()
    const runtime = mockRuntime({ settings })
    const docs = runtime.docs
    const bridge = createDocsDesktopBridge(runtime)

    await bridge.getTheme()

    expect(settings.getTheme).toHaveBeenCalledTimes(1)
    expect(docs.save).not.toHaveBeenCalled()
  })

  test('aiGskStatus dispatches to runtime.identity.accountStatus (NOT docs, NOT settings)', async () => {
    const identity = mockIdentity()
    const settings = mockSettings()
    const runtime = mockRuntime({ identity, settings })
    const bridge = createDocsDesktopBridge(runtime)

    await bridge.aiGskStatus()

    expect(identity.accountStatus).toHaveBeenCalledTimes(1)
    expect(settings.getTheme).not.toHaveBeenCalled()
  })

  test('webSearch dispatches to runtime.ai.webSearch (NOT docs, NOT identity)', async () => {
    const ai = mockAI()
    const identity = mockIdentity()
    const runtime = mockRuntime({ ai, identity })
    const bridge = createDocsDesktopBridge(runtime)

    await bridge.webSearch('query', 10)

    expect(ai.webSearch).toHaveBeenCalledWith('query', 10)
    expect(identity.accountStatus).not.toHaveBeenCalled()
  })

  test('onChromePressed dispatches to runtime.windowing.onChromePressed (NOT settings)', () => {
    const windowing = mockWindowing()
    const settings = mockSettings()
    const runtime = mockRuntime({ windowing, settings })
    const bridge = createDocsDesktopBridge(runtime)

    const handler = () => {}
    bridge.onChromePressed(handler)

    expect(windowing.onChromePressed).toHaveBeenCalledWith(handler)
    expect(settings.onThemeChanged).not.toHaveBeenCalled()
  })

  // ── ARGUMENT TRANSFORMATION: ArrayBuffer → Uint8Array (session-scoped) ──

  test('saveDocx converts ArrayBuffer → Uint8Array and passes a session (argument transformation)', async () => {
    const runtime = mockRuntime()
    const docs = runtime.docs
    docs.save = vi.fn().mockResolvedValue({ ok: true, session: { filePath: '/path/to/file.docx', hash: 'h' } }) as never
    const bridge = createDocsDesktopBridge(runtime)

    const buffer = new ArrayBuffer(4)
    new Uint8Array(buffer).set([1, 2, 3, 4])

    await bridge.saveDocx('/path/to/file.docx', buffer, true)

    expect(docs.save).toHaveBeenCalledTimes(1)
    const [session, passedBytes, auto] = docs.save.mock.calls[0]
    // Session is passed (the bridge holds the active session slot)
    expect(session).toBeDefined()
    expect(session.filePath).toBe('/path/to/file.docx')
    expect(auto).toBe(true)

    // CRITICAL: the bridge must convert ArrayBuffer → Uint8Array
    expect(passedBytes).toBeInstanceOf(Uint8Array)
    expect(passedBytes).not.toBeInstanceOf(ArrayBuffer)
    expect(Array.from(passedBytes as Uint8Array)).toEqual([1, 2, 3, 4])
  })

  test('saveDocx without auto flag passes auto=undefined through', async () => {
    const runtime = mockRuntime()
    const docs = runtime.docs
    docs.save = vi.fn().mockResolvedValue({ ok: true }) as never
    const bridge = createDocsDesktopBridge(runtime)

    await bridge.saveDocx('/path/file.docx', new ArrayBuffer(2))

    const [, , auto] = docs.save.mock.calls[0]
    expect(auto).toBeUndefined()
  })

  test('writeRecoveryCopy converts ArrayBuffer → Uint8Array and passes a session (argument transformation)', async () => {
    const runtime = mockRuntime()
    const docs = runtime.docs
    docs.writeRecovery = vi.fn().mockResolvedValue({ ok: true }) as never
    const bridge = createDocsDesktopBridge(runtime)

    const buffer = new ArrayBuffer(3)
    new Uint8Array(buffer).set([10, 20, 30])

    await bridge.writeRecoveryCopy('/path/recovery.docx', buffer)

    expect(docs.writeRecovery).toHaveBeenCalledTimes(1)
    const [session, passedBytes] = docs.writeRecovery.mock.calls[0]
    expect(session).toBeDefined()
    expect(passedBytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(passedBytes as Uint8Array)).toEqual([10, 20, 30])
  })

  test('saveDocxAs converts ArrayBuffer → Uint8Array and passes a session (argument transformation)', async () => {
    const runtime = mockRuntime()
    const docs = runtime.docs
    docs.saveAs = vi.fn().mockResolvedValue({ ok: true, path: '/p.docx', session: { filePath: '/p.docx', hash: 'h' } }) as never
    const bridge = createDocsDesktopBridge(runtime)

    const buffer = new ArrayBuffer(2)
    new Uint8Array(buffer).set([0xff, 0xfe])

    await bridge.saveDocxAs('Untitled', buffer)

    const [session, name, passedBytes] = docs.saveAs.mock.calls[0]
    expect(session).toBeDefined() // session-scoped — bridge passes a session (possibly transient)
    expect(name).toBe('Untitled')
    expect(passedBytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(passedBytes as Uint8Array)).toEqual([0xff, 0xfe])
  })

  test('saveDocxNew converts ArrayBuffer → Uint8Array and passes the active session (argument transformation)', async () => {
    const runtime = mockRuntime()
    const docs = runtime.docs
    docs.saveNew = vi.fn().mockResolvedValue({ ok: true, path: '/p.docx', session: { filePath: '/p.docx', hash: 'h' } }) as never
    const bridge = createDocsDesktopBridge(runtime)

    const buffer = new ArrayBuffer(1)
    new Uint8Array(buffer).set([42])

    await bridge.saveDocxNew('New Doc', buffer)

    const [session, name, passedBytes] = docs.saveNew.mock.calls[0]
    expect(session).toBeDefined() // null active session is acceptable — bridge passes null
    expect(name).toBe('New Doc')
    expect(passedBytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(passedBytes as Uint8Array)).toEqual([42])
  })

  // ── RETURN TRANSFORMATION ───────────────────────────────────────────

  test('saveDocx returns the docs.save result unchanged (return transformation)', async () => {
    const runtime = mockRuntime()
    runtime.docs.save = vi.fn().mockResolvedValue({ ok: true }) as never
    const bridge = createDocsDesktopBridge(runtime)

    const result = await bridge.saveDocx('/p.docx', new ArrayBuffer(0))

    expect(result).toEqual({ ok: true })
  })

  test('saveDocx returns the external-modified reason when docs.save rejects with reason (return transformation)', async () => {
    const runtime = mockRuntime()
    runtime.docs.save = vi
      .fn()
      .mockResolvedValue({ ok: false, error: 'file changed', reason: 'external-modified' }) as never
    const bridge = createDocsDesktopBridge(runtime)

    const result = await bridge.saveDocx('/p.docx', new ArrayBuffer(0))

    expect(result).toEqual({ ok: false, error: 'file changed', reason: 'external-modified' })
  })

  // ── Files passthrough ───────────────────────────────────────────────

  test('getPathForFile dispatches to runtime.files.getPathForFile', () => {
    const files = mockFiles()
    const runtime = mockRuntime({ files })
    const docs = runtime.docs
    const bridge = createDocsDesktopBridge(runtime)

    const file = new File([''], 'test.docx')
    const result = bridge.getPathForFile(file)

    expect(files.getPathForFile).toHaveBeenCalledWith(file)
    expect(docs.save).not.toHaveBeenCalled()
  })
})
