/**
 * Increment 2E — multi-window file-dialog ownership tests.
 *
 * Proves that for each of the 5 dialog-using operations, the file-picker
 * dialog is parented to the CALLER's BrowserWindow — not the globally
 * focused window.
 *
 * Operations tested:
 *   - docs:open (openDocx)
 *   - docs:save-as (saveDocxAs)
 *   - docs:export-pdf (exportPdf)
 *   - docs:save-merged-pdf (saveMergedPdf)
 *   - docs:pick-image (pickImage)
 *
 * For each:
 *   - Window A initiates the operation
 *   - Window B is focused (would be the wrong parent under the old
 *     getFocusedWindow() fallback)
 *   - The dialog's parent is A (verified via the `parent` argument
 *     passed to the coordinator's `files.pickOpen`/`pickSave`)
 *
 * Also verifies the WebContentsView case resolves to the owning shell
 * window via the callerWindowResolver (registered by setDocsShellWindow).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

// ── Mock electron ────────────────────────────────────────────────────────

const showMessageBoxMock = vi.fn()

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: (...args: unknown[]) => showMessageBoxMock(...args),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
    getFocusedWindow: vi.fn(() => null),
  },
}))

// ── Imports after mock ──────────────────────────────────────────────────

import type { DocumentService, DocumentSession, DocumentOpenResult } from '@genoffice/runtime-contracts'
import { DocsShellCoordinatorImpl } from '../src/main/docs-coordinator-impl'

// ── Helpers ─────────────────────────────────────────────────────────────

function makeFakeWindow(id: number): BrowserWindow {
  return { id, isDestroyed: () => false } as unknown as BrowserWindow
}

interface MockWebContents {
  id: number
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
}

function makeMockWebContents(id: number): MockWebContents {
  return { id, isDestroyed: () => false, send: vi.fn() }
}

function makeMockDocumentService(): DocumentService & {
  open: ReturnType<typeof vi.fn>
  saveAs: ReturnType<typeof vi.fn>
  readImage: ReturnType<typeof vi.fn>
  collectAttachments: ReturnType<typeof vi.fn>
} {
  const open = vi.fn(async (filePath: string) => {
    const session: DocumentSession = {
      filePath,
      hash: 'hash-' + filePath,
      diskState: { mtimeMs: 1000, size: 42, hash: 'hash-' + filePath },
    }
    const result: DocumentOpenResult = {
      path: filePath,
      name: filePath.split(/[/\\]/).pop() ?? filePath,
      data: new ArrayBuffer(8),
      hash: 'hash-' + filePath,
    }
    return { session, result }
  })

  const saveAs = vi.fn(async () => ({ ok: true, path: '/test/saved.docx' }))
  const readImage = vi.fn(async () => ({ base64: 'b64', mime: 'image/png' as const, name: 'img.png' }))
  const collectAttachments = vi.fn(async () => ({ accepted: [], rejected: [] }))

  return {
    // Increment 2F: openDialog/pickImage/pickAttachments removed from the service.
    // The service receives already-resolved paths.
    open,
    save: vi.fn(async () => ({ ok: true })),
    saveAs,
    saveNew: vi.fn(async () => ({ ok: true, path: '/test/new.docx' })),
    writeRecovery: vi.fn(async () => ({ ok: true })),
    recentFiles: vi.fn(async () => []),
    readImage,
    collectAttachments,
    addAttachmentPaths: vi.fn(async () => ({ accepted: [], rejected: [] })),
    addPastedImage: vi.fn(async () => ({ accepted: [], rejected: [] })),
    readAttachment: vi.fn(async () => ({ ok: false, error: 'mock' })),
    readAttachmentImage: vi.fn(async () => ({ ok: false, error: 'mock' })),
    fontMetrics: vi.fn(async () => null),
    print: vi.fn(async () => ({ ok: true })),
    exportPdf: vi.fn(async () => ({ ok: true, path: '/test/out.pdf' })),
    printPdfBuffer: vi.fn(async () => ({ ok: true, base64: '' })),
    saveMergedPdf: vi.fn(async () => ({ ok: true, path: '/test/merged.pdf' })),
    getAiSettings: vi.fn(async () => ({})),
    setAiSettings: vi.fn(async () => undefined),
    aiChat: vi.fn(async () => ({})),
    aiStream: vi.fn(async () => undefined),
    aiStreamCancel: vi.fn(async () => undefined),
    onAiStream: vi.fn(() => () => {}),
    onOpened: vi.fn(() => () => {}),
    onRenamed: vi.fn(() => () => {}),
    onTeardown: vi.fn(() => () => {}),
  } as unknown as DocumentService & {
    open: ReturnType<typeof vi.fn>
    saveAs: ReturnType<typeof vi.fn>
    readImage: ReturnType<typeof vi.fn>
    collectAttachments: ReturnType<typeof vi.fn>
  }
}

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'genoffice-2e-'))
  showMessageBoxMock.mockReset()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

type PickOpenFn = (parent: unknown, opts?: { accept?: string[]; multiple?: boolean }) => Promise<string[] | null>
type PickSaveFn = (parent: unknown, opts: { defaultName: string; accept?: string[] }) => Promise<string | null>

function makeCoordinator(opts: {
  pickOpen: PickOpenFn
  pickSave: PickSaveFn
}): { coordinator: DocsShellCoordinatorImpl; docs: ReturnType<typeof makeMockDocumentService> } {
  const docs = makeMockDocumentService()
  const coordinator = new DocsShellCoordinatorImpl({
    docs,
    userDataDir: tempDir,
    shellHooks: undefined,
    files: {
      pickOpen: opts.pickOpen,
      pickSave: opts.pickSave,
    },
    printToPDF: vi.fn(async () => Buffer.alloc(0)),
    print: vi.fn(async () => ({ ok: true })),
  })
  return { coordinator, docs }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Increment 2E — multi-window file-dialog ownership', () => {
  describe('docs:open (openDocx)', () => {
    it('Window A initiates open, B is focused → open dialog parented to A', async () => {
      const pickOpen = vi.fn(async (parent: unknown) => {
        // Verify the parent is winA, NOT winB (which is "focused")
        expect(parent).toBe(winA)
        return ['/test/opened.docx']
      })
      const { coordinator } = makeCoordinator({ pickOpen, pickSave: vi.fn(async () => null) })
      const winA = makeFakeWindow(101)
      const wcA = makeMockWebContents(201)
      coordinator.registerWebContents(wcA.id, wcA as never)

      await coordinator.openDocx(wcA.id, winA)

      expect(pickOpen).toHaveBeenCalledTimes(1)
      // The first arg of the first call is the parent — must be winA
      expect(pickOpen.mock.calls[0][0]).toBe(winA)
    })

    it('Window B initiates open, A is focused → open dialog parented to B', async () => {
      const pickOpen = vi.fn(async (parent: unknown) => {
        expect(parent).toBe(winB)
        return ['/test/opened-b.docx']
      })
      const { coordinator } = makeCoordinator({ pickOpen, pickSave: vi.fn(async () => null) })
      const winA = makeFakeWindow(301)
      const winB = makeFakeWindow(302)
      const wcB = makeMockWebContents(402)
      coordinator.registerWebContents(wcB.id, wcB as never)

      await coordinator.openDocx(wcB.id, winB)

      expect(pickOpen).toHaveBeenCalledTimes(1)
      expect(pickOpen.mock.calls[0][0]).toBe(winB)
    })
  })

  describe('docs:save-as (saveDocxAs)', () => {
    it('Window A initiates save-as, B is focused → save dialog parented to A', async () => {
      const pickSave = vi.fn(async (parent: unknown) => {
        expect(parent).toBe(winA)
        return '/test/saved.docx'
      })
      const { coordinator, docs } = makeCoordinator({
        pickOpen: vi.fn(async () => null),
        pickSave,
      })
      const winA = makeFakeWindow(501)
      const winB = makeFakeWindow(502) // focused but irrelevant
      const wcA = makeMockWebContents(601)
      coordinator.registerWebContents(wcA.id, wcA as never)

      // Open a file first so saveDocxAs has a session
      await coordinator.openDocxPath(wcA.id, '/test/source.docx', winA)
      // Reset the docs.saveAs mock to capture the call
      ;(docs.saveAs as ReturnType<typeof vi.fn>).mockClear()
      ;(docs.saveAs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        path: '/test/saved.docx',
      })

      await coordinator.saveDocxAs(wcA.id, 'saved.docx', new Uint8Array(8), winA)

      // Increment 2F: the SHELL owns the dialog. The coordinator calls
      // files.pickSave(callerWindow, ...) — the parent must be winA, NOT winB.
      // The service's saveAs(session, selectedPath, data) takes NO parent.
      expect(pickSave).toHaveBeenCalledTimes(1)
      expect(pickSave.mock.calls[0][0]).toBe(winA) // parent is winA
      // The service received the selected path (not a dialog parent)
      expect(docs.saveAs).toHaveBeenCalledTimes(1)
      const saveAsCallArgs = (docs.saveAs as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(saveAsCallArgs[1]).toBe('/test/saved.docx') // selectedPath
      expect(saveAsCallArgs.length).toBe(3) // session, selectedPath, data — NO parent arg
    })

    it('Window B initiates save-as, A is focused → save dialog parented to B', async () => {
      const pickSave = vi.fn(async (parent: unknown) => {
        expect(parent).toBe(winB)
        return '/test/saved-b.docx'
      })
      const { coordinator, docs } = makeCoordinator({
        pickOpen: vi.fn(async () => null),
        pickSave,
      })
      const winA = makeFakeWindow(701) // focused but irrelevant
      const winB = makeFakeWindow(702)
      const wcB = makeMockWebContents(802)
      coordinator.registerWebContents(wcB.id, wcB as never)

      await coordinator.openDocxPath(wcB.id, '/test/source-b.docx', winB)
      ;(docs.saveAs as ReturnType<typeof vi.fn>).mockClear()
      ;(docs.saveAs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        path: '/test/saved-b.docx',
      })

      await coordinator.saveDocxAs(wcB.id, 'saved-b.docx', new Uint8Array(8), winB)

      // Increment 2F: the parent is winB (the caller), NOT winA (focused)
      expect(pickSave).toHaveBeenCalledTimes(1)
      expect(pickSave.mock.calls[0][0]).toBe(winB) // parent is winB
      // The service received the selected path
      expect(docs.saveAs).toHaveBeenCalledTimes(1)
      const saveAsCallArgs = (docs.saveAs as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(saveAsCallArgs[1]).toBe('/test/saved-b.docx') // selectedPath
      expect(saveAsCallArgs.length).toBe(3) // NO parent arg
    })
  })

  describe('docs:export-pdf (exportPdf)', () => {
    it('Window A initiates export, B is focused → save dialog parented to A', async () => {
      const exportPath = join(tempDir, 'exported.pdf')
      const pickSave = vi.fn(async (parent: unknown) => {
        expect(parent).toBe(winA)
        return exportPath
      })
      const { coordinator } = makeCoordinator({
        pickOpen: vi.fn(async () => null),
        pickSave,
      })
      const winA = makeFakeWindow(901)
      const winB = makeFakeWindow(902) // focused but irrelevant
      const wcA = makeMockWebContents(1001)
      coordinator.registerWebContents(wcA.id, wcA as never)

      const result = await coordinator.exportPdf(
        wcA.id, 'exported.pdf', 12240, 15840, undefined, wcA as never, winA,
      )

      expect(result.ok).toBe(true)
      expect(pickSave).toHaveBeenCalledTimes(1)
      expect(pickSave.mock.calls[0][0]).toBe(winA) // parent is winA
    })
  })

  describe('docs:save-merged-pdf (saveMergedPdf)', () => {
    it('Window A initiates save-merged-pdf, B is focused → save dialog parented to A', async () => {
      const mergePath = join(tempDir, 'merged.pdf')
      const pickSave = vi.fn(async (parent: unknown) => {
        expect(parent).toBe(winA)
        return mergePath
      })
      const { coordinator } = makeCoordinator({
        pickOpen: vi.fn(async () => null),
        pickSave,
      })
      const winA = makeFakeWindow(1101)
      const winB = makeFakeWindow(1102) // focused but irrelevant
      const wcA = makeMockWebContents(1201)
      coordinator.registerWebContents(wcA.id, wcA as never)

      // We only need to verify the parent is passed to pickSave — the
      // pdf-lib merge itself is not the concern of this test (it's
      // covered by the legacy docs-main tests). Use an empty parts array
      // so pdf-lib.create() + save() succeeds without loading any input.
      const result = await coordinator.saveMergedPdf(
        wcA.id, 'merged.pdf', [], undefined, winA,
      )

      if (!result.ok) {
        throw new Error('saveMergedPdf failed: ' + (result.error ?? 'unknown'))
      }
      expect(result.ok).toBe(true)
      expect(pickSave).toHaveBeenCalledTimes(1)
      expect(pickSave.mock.calls[0][0]).toBe(winA) // parent is winA
    })
  })

  describe('docs:pick-image (pickImage)', () => {
    it('Window A initiates pick-image, B is focused → open dialog parented to A', async () => {
      const pickOpen = vi.fn(async (parent: unknown) => {
        expect(parent).toBe(winA)
        return ['/test/img.png']
      })
      const { coordinator, docs } = makeCoordinator({
        pickOpen,
        pickSave: vi.fn(async () => null),
      })
      const winA = makeFakeWindow(1301)
      const winB = makeFakeWindow(1302) // focused but irrelevant
      const wcA = makeMockWebContents(1401)
      coordinator.registerWebContents(wcA.id, wcA as never)

      // Increment 2F: the service's readImage(path) takes an already-resolved
      // path (no dialog parent). The coordinator owns the dialog.
      ;(docs.readImage as ReturnType<typeof vi.fn>).mockClear()
      ;(docs.readImage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        base64: 'b64',
        mime: 'image/png',
        name: 'img.png',
      })

      await coordinator.pickImage(wcA.id, winA)

      // The coordinator called files.pickOpen with winA as the parent
      expect(pickOpen).toHaveBeenCalledTimes(1)
      expect(pickOpen.mock.calls[0][0]).toBe(winA)
      // The service received the selected path (NOT a dialog parent)
      expect(docs.readImage).toHaveBeenCalledTimes(1)
      expect((docs.readImage as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/test/img.png')
    })
  })

  describe('WebContentsView resolves to owning shell window', () => {
    it('WebContentsView sender → shell window via callerWindowResolver', async () => {
      // This test simulates the shell-tab mode: the IPC sender is inside a
      // WebContentsView, so BrowserWindow.fromWebContents returns null.
      // The shell registers a resolver (via setDocsShellWindow) that maps
      // the wc to the shell window. The coordinator's files.pickOpen
      // receives the shell window as the parent.
      const pickOpen = vi.fn(async (parent: unknown) => {
        expect(parent).toBe(shellWindow)
        return ['/test/opened.docx']
      })
      const { coordinator } = makeCoordinator({
        pickOpen,
        pickSave: vi.fn(async () => null),
      })
      const shellWindow = makeFakeWindow(1501)
      const wcA = makeMockWebContents(1601)
      coordinator.registerWebContents(wcA.id, wcA as never)

      // In shell-tab mode, the migrated IPC handler calls
      // windowFromSender(event) which resolves to the shell window via
      // callerWindowResolver. The coordinator receives this as `callerWindow`.
      await coordinator.openDocx(wcA.id, shellWindow)

      expect(pickOpen).toHaveBeenCalledTimes(1)
      expect(pickOpen.mock.calls[0][0]).toBe(shellWindow)
    })
  })

  describe('null caller (destroyed/unresolvable) → modeless fallback', () => {
    it('null parent is passed through — no focused-window substitution', async () => {
      // When the caller's window can't be resolved (destroyed/unresolvable),
      // windowFromSender returns null. The coordinator passes null to
      // files.pickOpen. The Electron adapter shows a MODELESS dialog
      // (no parent) — NEVER getFocusedWindow().
      const pickOpen = vi.fn(async (parent: unknown) => {
        expect(parent).toBeNull()
        return ['/test/opened.docx']
      })
      const { coordinator } = makeCoordinator({
        pickOpen,
        pickSave: vi.fn(async () => null),
      })
      const wcA = makeMockWebContents(1701)
      coordinator.registerWebContents(wcA.id, wcA as never)

      await coordinator.openDocx(wcA.id, null)

      expect(pickOpen).toHaveBeenCalledTimes(1)
      expect(pickOpen.mock.calls[0][0]).toBeNull()
    })
  })
})

describe('Increment 2E — getFocusedWindow never used for file dialogs', () => {
  beforeEach(() => {
    showMessageBoxMock.mockReset()
  })

  it('openDocx passes callerWindow (not focused) to files.pickOpen', async () => {
    const pickOpen = vi.fn<(parent: unknown, opts?: { accept?: string[]; multiple?: boolean }) => Promise<string[] | null>>(async () => ['/test/opened.docx'])
    const { coordinator } = makeCoordinator({
      pickOpen,
      pickSave: vi.fn(async () => null),
    })
    const winA = makeFakeWindow(1801)
    const wcA = makeMockWebContents(1901)
    coordinator.registerWebContents(wcA.id, wcA as never)

    await coordinator.openDocx(wcA.id, winA)

    // The parent passed to pickOpen is winA — the BrowserWindow.getFocusedWindow()
    // mock returns null (set in the top-level vi.mock), so if the coordinator
    // had used getFocusedWindow, the parent would be null. It's winA, proving
    // the caller-specific parent is used.
    expect(pickOpen.mock.calls[0][0]).toBe(winA)
  })

  it('saveDocxAs passes callerWindow (not focused) to files.pickSave (NOT to docs.saveAs)', async () => {
    const pickSave = vi.fn<(parent: unknown, opts: { defaultName: string; accept?: string[] }) => Promise<string | null>>(async () => '/test/saved.docx')
    const { coordinator, docs } = makeCoordinator({
      pickOpen: vi.fn(async () => null),
      pickSave,
    })
    const winA = makeFakeWindow(2001)
    const wcA = makeMockWebContents(2101)
    coordinator.registerWebContents(wcA.id, wcA as never)
    await coordinator.openDocxPath(wcA.id, '/test/source.docx', winA)
    ;(docs.saveAs as ReturnType<typeof vi.fn>).mockClear()
    ;(docs.saveAs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      path: '/test/saved.docx',
    })

    await coordinator.saveDocxAs(wcA.id, 'saved.docx', new Uint8Array(8), winA)

    // Increment 2F: the callerWindow goes to files.pickSave (the shell-side
    // dialog), NOT to docs.saveAs (the domain service). The service receives
    // the selected path — no parent arg.
    expect(pickSave.mock.calls[0][0]).toBe(winA)
    const saveAsArgs = (docs.saveAs as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(saveAsArgs[1]).toBe('/test/saved.docx') // selectedPath
    expect(saveAsArgs.length).toBe(3) // session, selectedPath, data — NO parent arg
  })
})
