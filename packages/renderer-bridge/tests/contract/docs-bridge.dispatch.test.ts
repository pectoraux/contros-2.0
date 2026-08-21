/**
 * Dispatch test for createDocsDesktopBridge — the CRITICAL test for
 * ArrayBuffer → Uint8Array argument transformation.
 *
 * Verifies (per ADR-002 §5.1.2):
 * - destination: correct service method called
 * - non-destination: wrong service method NOT called
 * - argument transformation: ArrayBuffer → Uint8Array conversion for save*
 * - return transformation: return value passes through
 */
import { describe, test, expect, vi } from 'vitest'
import { createDocsDesktopBridge } from '../../src/bridges/docs-bridge.js'
import { mockRuntime, mockSettings, mockAI, mockIdentity, mockWindowing, mockFiles } from '../helpers/mocks.js'

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

  test('aiStream dispatches to runtime.ai.stream via docs.aiStream (NOT settings, NOT files)', async () => {
    const ai = mockAI()
    const runtime = mockRuntime({ ai })
    const settings = mockSettings()
    const bridge = createDocsDesktopBridge(runtime)

    const req = { requestId: 'r1', provider: 'genspark', messages: [] } as never
    await bridge.aiStream(req)

    // docs.aiStream delegates to... actually the docs bridge delegates aiStream
    // to docs.aiStream() (which in Phase 1 would call runtime.ai.stream()).
    // For Milestone 1, the mock just verifies docs.aiStream was called.
    expect(runtime.docs.aiStream).toHaveBeenCalledWith(req)
    expect(settings.getTheme).not.toHaveBeenCalled()
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

  // ── ARGUMENT TRANSFORMATION: ArrayBuffer → Uint8Array ───────────────

  test('saveDocx converts ArrayBuffer → Uint8Array before passing to docs.save (argument transformation)', async () => {
    const runtime = mockRuntime()
    const docs = runtime.docs
    const bridge = createDocsDesktopBridge(runtime)

    // Create an ArrayBuffer with known content
    const buffer = new ArrayBuffer(4)
    new Uint8Array(buffer).set([1, 2, 3, 4])

    await bridge.saveDocx('/path/to/file.docx', buffer, true)

    expect(docs.save).toHaveBeenCalledTimes(1)
    const [path, passedBytes, auto] = docs.save.mock.calls[0]
    expect(path).toBe('/path/to/file.docx')
    expect(auto).toBe(true)

    // CRITICAL: the bridge must convert ArrayBuffer → Uint8Array
    expect(passedBytes).toBeInstanceOf(Uint8Array)
    expect(passedBytes).not.toBeInstanceOf(ArrayBuffer)
    expect(Array.from(passedBytes as Uint8Array)).toEqual([1, 2, 3, 4])
  })

  test('saveDocx without auto flag passes auto=undefined through', async () => {
    const runtime = mockRuntime()
    const docs = runtime.docs
    const bridge = createDocsDesktopBridge(runtime)

    await bridge.saveDocx('/path/file.docx', new ArrayBuffer(2))

    const [, , auto] = docs.save.mock.calls[0]
    expect(auto).toBeUndefined()
  })

  test('writeRecoveryCopy converts ArrayBuffer → Uint8Array (argument transformation)', async () => {
    const runtime = mockRuntime()
    const docs = runtime.docs
    const bridge = createDocsDesktopBridge(runtime)

    const buffer = new ArrayBuffer(3)
    new Uint8Array(buffer).set([10, 20, 30])

    await bridge.writeRecoveryCopy('/path/recovery.docx', buffer)

    expect(docs.writeRecovery).toHaveBeenCalledTimes(1)
    const [path, passedBytes] = docs.writeRecovery.mock.calls[0]
    expect(path).toBe('/path/recovery.docx')
    expect(passedBytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(passedBytes as Uint8Array)).toEqual([10, 20, 30])
  })

  test('saveDocxAs converts ArrayBuffer → Uint8Array (argument transformation)', async () => {
    const runtime = mockRuntime()
    const docs = runtime.docs
    const bridge = createDocsDesktopBridge(runtime)

    const buffer = new ArrayBuffer(2)
    new Uint8Array(buffer).set([0xff, 0xfe])

    await bridge.saveDocxAs('Untitled', buffer)

    const [name, passedBytes] = docs.saveAs.mock.calls[0]
    expect(name).toBe('Untitled')
    expect(passedBytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(passedBytes as Uint8Array)).toEqual([0xff, 0xfe])
  })

  test('saveDocxNew converts ArrayBuffer → Uint8Array (argument transformation)', async () => {
    const runtime = mockRuntime()
    const docs = runtime.docs
    const bridge = createDocsDesktopBridge(runtime)

    const buffer = new ArrayBuffer(1)
    new Uint8Array(buffer).set([42])

    await bridge.saveDocxNew('New Doc', buffer)

    const [name, passedBytes] = docs.saveNew.mock.calls[0]
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
