/** Dispatch test for createPdfApiBridge. */
import { describe, test, expect } from 'vitest'
import { createPdfApiBridge } from '../../src/bridges/pdf-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

describe('createPdfApiBridge dispatch', () => {
  test('readFile dispatches to runtime.pdf.readFile (NOT save, NOT extractPages)', async () => {
    const runtime = mockRuntime()
    const pdf = runtime.pdf
    const bridge = createPdfApiBridge(runtime)

    await bridge.readFile('/path/to/file.pdf')

    expect(pdf.readFile).toHaveBeenCalledWith('/path/to/file.pdf')
    expect(pdf.save).not.toHaveBeenCalled()
    expect(pdf.extractPages).not.toHaveBeenCalled()
  })

  test('save passes the request through (argument transformation)', async () => {
    const runtime = mockRuntime()
    const pdf = runtime.pdf
    const bridge = createPdfApiBridge(runtime)

    const request = { path: '/p.pdf', markups: [] } as never
    await bridge.save(request)

    expect(pdf.save).toHaveBeenCalledWith(request)
  })

  test('extractPages dispatches to runtime.pdf.extractPages (NOT mergePdf)', async () => {
    const runtime = mockRuntime()
    const pdf = runtime.pdf
    const bridge = createPdfApiBridge(runtime)

    const request = { path: '/p.pdf', pages: [0, 2] } as never
    await bridge.extractPages(request)

    expect(pdf.extractPages).toHaveBeenCalledWith(request)
    expect(pdf.mergePdf).not.toHaveBeenCalled()
  })

  test('setDirty is fire-and-forget (passes the boolean through)', () => {
    const runtime = mockRuntime()
    const pdf = runtime.pdf
    const bridge = createPdfApiBridge(runtime)

    bridge.setDirty(true)

    expect(pdf.setDirty).toHaveBeenCalledWith(true)
  })
})
