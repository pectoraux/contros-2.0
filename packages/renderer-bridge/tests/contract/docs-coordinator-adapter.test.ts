/**
 * Increment 2G — DocsShellCoordinatorAdapter caller-ownership tests.
 *
 * Proves:
 *   - Renderer A bridge call uses A's wcId/context
 *   - Renderer B bridge call uses B's wcId/context
 *   - A cannot accidentally use B's session
 *   - focus changes do not affect the selected caller
 *   - multiple renderers can open/save the same file independently
 *   - file dialogs still use the correct caller window
 *
 * The adapter implements the bridge-facing DocsShellCoordinator interface
 * (no caller identity) and delegates to the PerRendererDocsCoordinator impl
 * (caller-specific) using an injected CallerContextResolver.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createDocsShellCoordinatorAdapter,
  type PerRendererDocsCoordinator,
  type CallerContext,
} from '../../src/shell/docs-coordinator-adapter.js'
import type { DocumentOpenResult, DocumentSession } from '@genoffice/runtime-contracts'

// ── Mock electron ────────────────────────────────────────────────────────
//
// BrowserWindow is used as a type in the adapter; we mock the module so
// the import doesn't fail in jsdom. We only need the type, not the runtime.

vi.mock('electron', () => ({
  BrowserWindow: class MockBrowserWindow {},
}))

// ── Helpers ─────────────────────────────────────────────────────────────

/** A fake BrowserWindow — just an object with an `id` for identity. */
function makeFakeWindow(id: number): unknown {
  return { id, isDestroyed: () => false }
}

/** A fake CallerContext — what the resolver returns. */
function makeCallerContext(wcId: number, callerWindow: unknown): CallerContext {
  return { wcId, callerWindow: callerWindow as never }
}

/**
 * A mock PerRendererDocsCoordinator that records every call's (wcId, callerWindow).
 * This lets us verify the adapter forwarded the CORRECT caller context.
 */
function makeMockImpl(): PerRendererDocsCoordinator & {
  calls: Array<{ method: string; wcId: number; callerWindow: unknown; args: unknown[] }>
  reset(): void
} {
  const calls: Array<{ method: string; wcId: number; callerWindow: unknown; args: unknown[] }> = []
  const record = (method: string) => (wcId: number, ...args: unknown[]) => {
    // For methods that take callerWindow as the 2nd arg (after wcId):
    // openDocx(wcId, callerWindow), openDocxPath(wcId, filePath, callerWindow), etc.
    // We extract callerWindow from the args heuristically based on the method.
    let callerWindow: unknown = null
    if (method === 'openDocx') {
      callerWindow = args[0] // (wcId, callerWindow)
    } else if (method === 'openDocxPath') {
      callerWindow = args[1] // (wcId, filePath, callerWindow)
    } else if (method === 'saveDocx') {
      callerWindow = args[2] // (wcId, filePath, data, callerWindow, auto?)
    } else if (method === 'saveDocxAs') {
      callerWindow = args[2] // (wcId, defaultName, data, callerWindow)
    } else if (method === 'pickImage' || method === 'pickAttachments') {
      callerWindow = args[0] // (wcId, callerWindow)
    }
    calls.push({ method, wcId, callerWindow, args })
    return Promise.resolve(null)
  }

  const impl: PerRendererDocsCoordinator = {
    registerWebContents: vi.fn(),
    openDocx: vi.fn(async (wcId: number, callerWindow: unknown) => {
      calls.push({ method: 'openDocx', wcId, callerWindow, args: [] })
      return { result: { path: '/test/open.docx', name: 'open.docx', data: new ArrayBuffer(0), hash: 'h' } }
    }) as never,
    openDocxPath: vi.fn(async (wcId: number, filePath: string, callerWindow: unknown) => {
      calls.push({ method: 'openDocxPath', wcId, callerWindow, args: [filePath] })
      return { result: { path: filePath, name: 'open.docx', data: new ArrayBuffer(0), hash: 'h' } }
    }) as never,
    saveDocx: vi.fn(async (wcId: number, filePath: string, data: Uint8Array, callerWindow: unknown) => {
      calls.push({ method: 'saveDocx', wcId, callerWindow, args: [filePath] })
      return { ok: true }
    }) as never,
    saveDocxAs: vi.fn(async (wcId: number, defaultName: string, data: Uint8Array, callerWindow: unknown) => {
      calls.push({ method: 'saveDocxAs', wcId, callerWindow, args: [defaultName] })
      return { ok: true, path: '/test/saved.docx' }
    }) as never,
    saveDocxNew: vi.fn(async (wcId: number) => {
      calls.push({ method: 'saveDocxNew', wcId, callerWindow: null, args: [] })
      return { ok: true, path: '/test/new.docx' }
    }) as never,
    writeRecovery: vi.fn(async (wcId: number) => {
      calls.push({ method: 'writeRecovery', wcId, callerWindow: null, args: [] })
      return { ok: true }
    }) as never,
    pickImage: vi.fn(async (wcId: number, callerWindow: unknown) => {
      calls.push({ method: 'pickImage', wcId, callerWindow, args: [] })
      return null
    }) as never,
    pickAttachments: vi.fn(async (wcId: number, callerWindow: unknown) => {
      calls.push({ method: 'pickAttachments', wcId, callerWindow, args: [] })
      return null
    }) as never,
    print: vi.fn(async () => ({ ok: true })) as never,
    printPdfBuffer: vi.fn(async () => ({ ok: true })) as never,
    exportPdf: vi.fn(async (wcId: number, defaultName: string, w: number, h: number, outPath: string | undefined, wc: unknown, callerWindow: unknown) => {
      calls.push({ method: 'exportPdf', wcId, callerWindow, args: [defaultName] })
      return { ok: true, path: outPath ?? '/test/out.pdf' }
    }) as never,
    saveMergedPdf: vi.fn(async (wcId: number, defaultName: string, parts: string[], outPath: string | undefined, callerWindow: unknown) => {
      calls.push({ method: 'saveMergedPdf', wcId, callerWindow, args: [defaultName] })
      return { ok: true, path: outPath ?? '/test/merged.pdf' }
    }) as never,
    openNewTab: vi.fn(async () => undefined) as never,
    listDocsTabs: vi.fn(async () => []) as never,
    focusDocsTab: vi.fn(async () => undefined) as never,
    sendOpened: vi.fn() as never,
    sendRenamedToCaller: vi.fn() as never,
    sendTeardown: vi.fn() as never,
    onMenuCommand: vi.fn(() => () => {}) as never,
    reportViewMenuState: vi.fn() as never,
    onCloseCheck: vi.fn(() => () => {}) as never,
    reportCloseCheck: vi.fn() as never,
    onCloseSaveRequest: vi.fn(() => () => {}) as never,
    reportCloseSaveResult: vi.fn() as never,
  }

  return {
    ...impl,
    calls,
    reset() { calls.length = 0 },
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Increment 2G — DocsShellCoordinatorAdapter caller ownership', () => {
  test('Renderer A bridge call uses A\'s wcId/context', async () => {
    const mockImpl = makeMockImpl()
    const winA = makeFakeWindow(101)
    const ctxA = makeCallerContext(1001, winA)

    const adapter = createDocsShellCoordinatorAdapter({
      impl: mockImpl,
      resolveCaller: () => ctxA,
    })

    await adapter.openDocx()

    expect(mockImpl.calls).toHaveLength(1)
    expect(mockImpl.calls[0].method).toBe('openDocx')
    expect(mockImpl.calls[0].wcId).toBe(1001) // A's wcId
    // Verify the impl was called with A's callerWindow
    expect((mockImpl.openDocx as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe(winA)
  })

  test('Renderer B bridge call uses B\'s wcId/context', async () => {
    const mockImpl = makeMockImpl()
    const winB = makeFakeWindow(202)
    const ctxB = makeCallerContext(2002, winB)

    const adapter = createDocsShellCoordinatorAdapter({
      impl: mockImpl,
      resolveCaller: () => ctxB,
    })

    await adapter.openDocxPath('/test/file.docx')

    expect(mockImpl.calls).toHaveLength(1)
    expect(mockImpl.calls[0].method).toBe('openDocxPath')
    expect(mockImpl.calls[0].wcId).toBe(2002) // B's wcId
    expect(mockImpl.calls[0].callerWindow).toBe(winB)
  })

  test('A cannot accidentally use B\'s session — context is per-call', async () => {
    const mockImpl = makeMockImpl()
    const winA = makeFakeWindow(301)
    const winB = makeFakeWindow(302)

    // Simulate two IPC calls in sequence: A calls first, then B.
    // The resolver returns different contexts for each call.
    let currentCtx = makeCallerContext(3001, winA)
    const adapter = createDocsShellCoordinatorAdapter({
      impl: mockImpl,
      resolveCaller: () => currentCtx,
    })

    // A's call
    currentCtx = makeCallerContext(3001, winA)
    await adapter.saveDocx('/test/shared.docx', new Uint8Array(4))

    // B's call — context switched to B
    currentCtx = makeCallerContext(3002, winB)
    await adapter.saveDocx('/test/shared.docx', new Uint8Array(4))

    expect(mockImpl.calls).toHaveLength(2)
    // First call used A's context
    expect(mockImpl.calls[0].wcId).toBe(3001)
    expect(mockImpl.calls[0].callerWindow).toBe(winA)
    // Second call used B's context
    expect(mockImpl.calls[1].wcId).toBe(3002)
    expect(mockImpl.calls[1].callerWindow).toBe(winB)
  })

  test('focus changes do not affect the selected caller', async () => {
    const mockImpl = makeMockImpl()
    const winA = makeFakeWindow(401)
    const winB = makeFakeWindow(402) // B is "focused" but irrelevant

    // The resolver always returns A's context, regardless of focus.
    // The adapter does NOT consult BrowserWindow.getFocusedWindow().
    const ctxA = makeCallerContext(4001, winA)
    const adapter = createDocsShellCoordinatorAdapter({
      impl: mockImpl,
      resolveCaller: () => ctxA,
    })

    // A calls — even though B is "focused" (the resolver doesn't know that)
    await adapter.pickImage()

    expect(mockImpl.calls).toHaveLength(1)
    expect(mockImpl.calls[0].wcId).toBe(4001) // A's wcId, NOT B's
    expect(mockImpl.calls[0].callerWindow).toBe(winA) // A's window, NOT B's
  })

  test('multiple renderers can open/save the same file independently', async () => {
    const mockImpl = makeMockImpl()
    const winA = makeFakeWindow(501)
    const winB = makeFakeWindow(502)
    const filePath = '/test/shared.docx'

    let currentCtx = makeCallerContext(5001, winA)
    const adapter = createDocsShellCoordinatorAdapter({
      impl: mockImpl,
      resolveCaller: () => currentCtx,
    })

    // A opens the file
    currentCtx = makeCallerContext(5001, winA)
    await adapter.openDocxPath(filePath)

    // B opens the same file
    currentCtx = makeCallerContext(5002, winB)
    await adapter.openDocxPath(filePath)

    // A saves
    currentCtx = makeCallerContext(5001, winA)
    await adapter.saveDocx(filePath, new Uint8Array(4))

    // B saves
    currentCtx = makeCallerContext(5002, winB)
    await adapter.saveDocx(filePath, new Uint8Array(4))

    expect(mockImpl.calls).toHaveLength(4)
    // A's open used A's context
    expect(mockImpl.calls[0].wcId).toBe(5001)
    expect(mockImpl.calls[0].callerWindow).toBe(winA)
    // B's open used B's context
    expect(mockImpl.calls[1].wcId).toBe(5002)
    expect(mockImpl.calls[1].callerWindow).toBe(winB)
    // A's save used A's context (not B's, even though B opened the same file)
    expect(mockImpl.calls[2].wcId).toBe(5001)
    expect(mockImpl.calls[2].callerWindow).toBe(winA)
    // B's save used B's context
    expect(mockImpl.calls[3].wcId).toBe(5002)
    expect(mockImpl.calls[3].callerWindow).toBe(winB)
  })

  test('file dialogs still use the correct caller window', async () => {
    const mockImpl = makeMockImpl()
    const winA = makeFakeWindow(601)
    const winB = makeFakeWindow(602) // focused but irrelevant

    const ctxA = makeCallerContext(6001, winA)
    const adapter = createDocsShellCoordinatorAdapter({
      impl: mockImpl,
      resolveCaller: () => ctxA,
    })

    // A initiates save-as — the dialog should be parented to A, NOT B
    await adapter.saveDocxAs('saved.docx', new Uint8Array(4))

    expect(mockImpl.calls).toHaveLength(1)
    expect(mockImpl.calls[0].method).toBe('saveDocxAs')
    expect(mockImpl.calls[0].callerWindow).toBe(winA) // A's window, NOT B's
  })

  test('saveDocxNew uses wcId from resolver (no callerWindow needed)', async () => {
    const mockImpl = makeMockImpl()
    const winA = makeFakeWindow(701)
    const ctxA = makeCallerContext(7001, winA)

    const adapter = createDocsShellCoordinatorAdapter({
      impl: mockImpl,
      resolveCaller: () => ctxA,
    })

    await adapter.saveDocxNew('new.docx', new Uint8Array(4))

    expect(mockImpl.calls).toHaveLength(1)
    expect(mockImpl.calls[0].wcId).toBe(7001)
  })

  test('writeRecovery uses wcId from resolver', async () => {
    const mockImpl = makeMockImpl()
    const winA = makeFakeWindow(801)
    const ctxA = makeCallerContext(8001, winA)

    const adapter = createDocsShellCoordinatorAdapter({
      impl: mockImpl,
      resolveCaller: () => ctxA,
    })

    await adapter.writeRecovery('/test/file.docx', new Uint8Array(4))

    expect(mockImpl.calls).toHaveLength(1)
    expect(mockImpl.calls[0].wcId).toBe(8001)
  })

  test('pickAttachments uses caller context', async () => {
    const mockImpl = makeMockImpl()
    const winA = makeFakeWindow(901)
    const ctxA = makeCallerContext(9001, winA)

    const adapter = createDocsShellCoordinatorAdapter({
      impl: mockImpl,
      resolveCaller: () => ctxA,
    })

    await adapter.pickAttachments()

    expect(mockImpl.calls).toHaveLength(1)
    expect(mockImpl.calls[0].method).toBe('pickAttachments')
    expect(mockImpl.calls[0].wcId).toBe(9001)
    expect(mockImpl.calls[0].callerWindow).toBe(winA)
  })

  test('adapter throws if resolveCaller is called outside an IPC scope', async () => {
    const mockImpl = makeMockImpl()
    // A resolver that throws — simulates "no current IPC context"
    const adapter = createDocsShellCoordinatorAdapter({
      impl: mockImpl,
      resolveCaller: () => { throw new Error('No current IPC context — bridge called outside IPC scope') },
    })

    await expect(adapter.openDocx()).rejects.toThrow(/No current IPC context/)
  })
})

describe('Increment 2G — adapter does NOT introduce global state', () => {
  test('two adapters with different resolvers are independent', async () => {
    const mockImplA = makeMockImpl()
    const mockImplB = makeMockImpl()
    const winA = makeFakeWindow(1001)
    const winB = makeFakeWindow(1002)

    const adapterA = createDocsShellCoordinatorAdapter({
      impl: mockImplA,
      resolveCaller: () => makeCallerContext(10001, winA),
    })
    const adapterB = createDocsShellCoordinatorAdapter({
      impl: mockImplB,
      resolveCaller: () => makeCallerContext(10002, winB),
    })

    await adapterA.openDocx()
    await adapterB.openDocx()

    // Adapter A forwarded to impl A with A's context
    expect(mockImplA.calls[0].wcId).toBe(10001)
    expect(mockImplA.calls[0].callerWindow).toBe(winA)
    // Adapter B forwarded to impl B with B's context
    expect(mockImplB.calls[0].wcId).toBe(10002)
    expect(mockImplB.calls[0].callerWindow).toBe(winB)
    // No cross-contamination
    expect(mockImplA.calls).toHaveLength(1)
    expect(mockImplB.calls).toHaveLength(1)
  })

  test('the resolver is called fresh on every bridge call (no caching)', async () => {
    const mockImpl = makeMockImpl()
    let callCount = 0
    const contexts = [
      makeCallerContext(11001, makeFakeWindow(1101)),
      makeCallerContext(11002, makeFakeWindow(1102)),
      makeCallerContext(11003, makeFakeWindow(1103)),
    ]

    const adapter = createDocsShellCoordinatorAdapter({
      impl: mockImpl,
      resolveCaller: () => {
        const ctx = contexts[callCount]
        callCount++
        return ctx
      },
    })

    await adapter.openDocx()
    await adapter.openDocx()
    await adapter.openDocx()

    expect(callCount).toBe(3) // resolver called 3 times, once per bridge call
    expect(mockImpl.calls[0].wcId).toBe(11001)
    expect(mockImpl.calls[1].wcId).toBe(11002)
    expect(mockImpl.calls[2].wcId).toBe(11003)
  })
})
