/** Dispatch test for createMarkdownApiBridge. */
import { describe, test, expect } from 'vitest'
import { createMarkdownApiBridge } from '../../src/bridges/markdown-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

describe('createMarkdownApiBridge dispatch', () => {
  test('readFile dispatches to runtime.markdown.readFile (NOT save, NOT exportDocx)', async () => {
    const runtime = mockRuntime()
    const md = runtime.markdown
    const bridge = createMarkdownApiBridge(runtime)

    await bridge.readFile('/path/to/file.md')

    expect(md.readFile).toHaveBeenCalledWith('/path/to/file.md')
    expect(md.save).not.toHaveBeenCalled()
    expect(md.exportDocx).not.toHaveBeenCalled()
  })

  test('save passes the request through (argument transformation)', async () => {
    const runtime = mockRuntime()
    const md = runtime.markdown
    const bridge = createMarkdownApiBridge(runtime)

    const request = { text: '# Hello', mode: 'save' } as never
    await bridge.save(request)

    expect(md.save).toHaveBeenCalledWith(request)
  })

  test('setDirty is fire-and-forget (passes the boolean through)', () => {
    const runtime = mockRuntime()
    const md = runtime.markdown
    const bridge = createMarkdownApiBridge(runtime)

    bridge.setDirty(true)

    expect(md.setDirty).toHaveBeenCalledWith(true)
  })

  test('exportDocx dispatches to runtime.markdown.exportDocx (NOT exportPdf)', async () => {
    const runtime = mockRuntime()
    const md = runtime.markdown
    const bridge = createMarkdownApiBridge(runtime)

    const request = { base64: '...', suggestedName: 'doc', mode: 'dialog' } as never
    await bridge.exportDocx(request)

    expect(md.exportDocx).toHaveBeenCalledWith(request)
    expect(md.exportPdf).not.toHaveBeenCalled()
  })
})
