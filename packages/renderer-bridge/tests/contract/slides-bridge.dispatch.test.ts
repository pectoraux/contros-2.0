/** Dispatch test for createSlidesApiBridge. */
import { describe, test, expect, vi } from 'vitest'
import { createSlidesApiBridge } from '../../src/bridges/slides-bridge.js'
import { mockRuntime, mockSettings, mockAI, mockIdentity, mockWindowing } from '../helpers/mocks.js'

describe('createSlidesApiBridge dispatch', () => {
  test('getTheme dispatches to runtime.settings.getTheme (NOT slides.editText)', async () => {
    const settings = mockSettings()
    const runtime = mockRuntime({ settings })
    const slides = runtime.slides
    const bridge = createSlidesApiBridge(runtime)

    await (bridge as never as { getTheme: () => Promise<unknown> }).getTheme()

    expect(settings.getTheme).toHaveBeenCalledTimes(1)
    expect(slides.editText).not.toHaveBeenCalled()
  })

  test('aiStream dispatches to runtime.ai.stream (NOT settings, NOT slides)', async () => {
    const ai = mockAI()
    const runtime = mockRuntime({ ai })
    const slides = runtime.slides
    const settings = mockSettings()
    const bridge = createSlidesApiBridge(runtime)

    const req = { requestId: 'r1', provider: 'genspark', messages: [] } as never
    await (bridge as never as { aiStream: (r: unknown) => Promise<void> }).aiStream(req)

    expect(ai.stream).toHaveBeenCalledTimes(1)
    expect(settings.getTheme).not.toHaveBeenCalled()
    expect(slides.editText).not.toHaveBeenCalled()
  })

  test('openExternal dispatches to runtime.windowing.openExternal (NOT settings)', async () => {
    const windowing = mockWindowing()
    const settings = mockSettings()
    const runtime = mockRuntime({ windowing, settings })
    const bridge = createSlidesApiBridge(runtime)

    await (bridge as never as { openExternal: (url: string) => Promise<void> }).openExternal('https://example.com')

    expect(windowing.openExternal).toHaveBeenCalledWith('https://example.com')
    expect(settings.getTheme).not.toHaveBeenCalled()
  })

  test('slides-specific method (editText) delegates to PresentationService (NOT ai, NOT settings)', async () => {
    const runtime = mockRuntime()
    const slides = runtime.slides
    const ai = mockAI()
    const settings = mockSettings()
    const bridge = createSlidesApiBridge(runtime)

    const op = { slideIndex: 0, sourceId: 'el1', paragraphs: [] } as never
    await (bridge as never as { editText: (op: unknown) => Promise<unknown> }).editText(op)

    expect(slides.editText).toHaveBeenCalledWith(op)
    expect(ai.stream).not.toHaveBeenCalled()
    expect(settings.getTheme).not.toHaveBeenCalled()
  })

  test('slides-specific method (undo) delegates to PresentationService', async () => {
    const runtime = mockRuntime()
    const slides = runtime.slides
    const bridge = createSlidesApiBridge(runtime)

    await (bridge as never as { undo: () => Promise<unknown> }).undo()

    expect(slides.undo).toHaveBeenCalledTimes(1)
  })

  test('slides-specific method (save) delegates to PresentationService', async () => {
    const runtime = mockRuntime()
    const slides = runtime.slides
    const bridge = createSlidesApiBridge(runtime)

    await (bridge as never as { save: () => Promise<unknown> }).save()

    expect(slides.save).toHaveBeenCalledTimes(1)
  })
})
