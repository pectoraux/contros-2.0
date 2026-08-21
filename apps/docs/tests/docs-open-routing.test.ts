/**
 * Increment 2D — Fix #1: docs:opened per-wcId routing tests.
 *
 * Proves:
 *   - Renderer A opens → only A receives docs:opened
 *   - Renderer B opens → only B receives docs:opened
 *   - A and B can open the same file independently
 *   - focus changes do not change event recipient
 *   - destroyed renderer receives no event
 *   - no duplicate event
 *
 * The coordinator's sendOpened(wcId, result) sends docs:opened to the
 * wcId-specific webContents ONLY — never broadcast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── Mock electron ────────────────────────────────────────────────────────
//
// The coordinator imports { dialog, BrowserWindow, WebContents } from 'electron'.
// In the jsdom test environment, electron is not available, so we mock it.
//
// dialog.showMessageBox is only called when a recovery file exists (which we
// ensure it doesn't by pointing userDataDir at a temp dir). BrowserWindow is
// used as a type only (no runtime value needed). WebContents is a type only.

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

// ── Mock DocumentService ─────────────────────────────────────────────────
//
// The coordinator calls deps.docs.open(path) (the shell owns the dialog).
// We mock open() to return a controlled { session, result } without touching
// the real filesystem (except for the recovery-exists check, which we
// bypass by pointing userDataDir at an empty temp dir).

import type { DocumentService, DocumentSession, DocumentOpenResult } from '@genoffice/runtime-contracts'

interface MockWebContents {
  id: number
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
}

function makeMockWebContents(id: number): MockWebContents {
  return {
    id,
    isDestroyed: () => false,
    send: vi.fn(),
  }
}

function makeMockDocumentService(): DocumentService {
  const open = vi.fn(async (filePath: string): Promise<{ session: DocumentSession; result: DocumentOpenResult } | null> => {
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

  return {
    // Increment 2F: openDialog/pickImage/pickAttachments removed from the service.
    // The service receives already-resolved paths.
    open,
    save: vi.fn(async () => ({ ok: true })),
    saveAs: vi.fn(async () => ({ ok: true, path: '/test/saved.docx' })),
    saveNew: vi.fn(async () => ({ ok: true, path: '/test/new.docx' })),
    writeRecovery: vi.fn(async () => ({ ok: true })),
    recentFiles: vi.fn(async () => []),
    readImage: vi.fn(async () => null),
    collectAttachments: vi.fn(async () => ({ accepted: [], rejected: [] })),
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
  } as unknown as DocumentService
}

// ── Test harness ─────────────────────────────────────────────────────────

import { DocsShellCoordinatorImpl } from '../src/main/docs-coordinator-impl'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'genoffice-2d-'))
  showMessageBoxMock.mockReset()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

type PickOpenFn = (parent: unknown, opts?: { accept?: string[]; multiple?: boolean }) => Promise<string[] | null>
type PickSaveFn = (parent: unknown, opts: { defaultName: string; accept?: string[] }) => Promise<string | null>

function makeCoordinator(
  filesOverride?: Partial<{ pickOpen: ReturnType<typeof vi.fn>; pickSave: ReturnType<typeof vi.fn> }>,
): { coordinator: DocsShellCoordinatorImpl; docs: DocumentService } {
  const docs = makeMockDocumentService()
  const defaultPickOpen: PickOpenFn = async () => ['/test/file.docx']
  const defaultPickSave: PickSaveFn = async () => null
  const coordinator = new DocsShellCoordinatorImpl({
    docs,
    userDataDir: tempDir,
    shellHooks: undefined,
    files: {
      pickOpen: (filesOverride?.pickOpen as PickOpenFn | undefined) ?? defaultPickOpen,
      pickSave: (filesOverride?.pickSave as PickSaveFn | undefined) ?? defaultPickSave,
    },
    printToPDF: vi.fn(async () => Buffer.alloc(0)),
    print: vi.fn(async () => ({ ok: true })),
  })
  return { coordinator, docs }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Increment 2D — docs:opened per-wcId routing', () => {
  it('Renderer A opens → only A receives docs:opened (openDocx)', async () => {
    const { coordinator } = makeCoordinator()
    const wcA = makeMockWebContents(1001)
    const wcB = makeMockWebContents(1002)
    coordinator.registerWebContents(wcA.id, wcA as never)
    coordinator.registerWebContents(wcB.id, wcB as never)

    await coordinator.openDocx(wcA.id, null)

    expect(wcA.send).toHaveBeenCalledTimes(1)
    expect(wcA.send).toHaveBeenCalledWith('docs:opened', expect.objectContaining({ path: expect.any(String) }))
    expect(wcB.send).not.toHaveBeenCalled()
  })

  it('Renderer B opens → only B receives docs:opened (openDocxPath)', async () => {
    const { coordinator } = makeCoordinator()
    const wcA = makeMockWebContents(2001)
    const wcB = makeMockWebContents(2002)
    coordinator.registerWebContents(wcA.id, wcA as never)
    coordinator.registerWebContents(wcB.id, wcB as never)

    await coordinator.openDocxPath(wcB.id, '/test/other.docx', null)

    expect(wcB.send).toHaveBeenCalledTimes(1)
    expect(wcB.send).toHaveBeenCalledWith('docs:opened', expect.objectContaining({ path: '/test/other.docx' }))
    expect(wcA.send).not.toHaveBeenCalled()
  })

  it('A and B can open the same file independently — each receives its own docs:opened', async () => {
    const { coordinator } = makeCoordinator()
    const wcA = makeMockWebContents(3001)
    const wcB = makeMockWebContents(3002)
    coordinator.registerWebContents(wcA.id, wcA as never)
    coordinator.registerWebContents(wcB.id, wcB as never)
    const filePath = '/test/shared.docx'

    await coordinator.openDocxPath(wcA.id, filePath, null)
    await coordinator.openDocxPath(wcB.id, filePath, null)

    // Each renderer received exactly ONE docs:opened event
    expect(wcA.send).toHaveBeenCalledTimes(1)
    expect(wcB.send).toHaveBeenCalledTimes(1)
    // Both received the same file path
    const aResult = (wcA.send as ReturnType<typeof vi.fn>).mock.calls[0][1]
    const bResult = (wcB.send as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(aResult.path).toBe(filePath)
    expect(bResult.path).toBe(filePath)
    // The events are distinct objects (independent results)
    expect(aResult).not.toBe(bResult)
  })

  it('focus changes do not change event recipient — no focus state in routing', async () => {
    const { coordinator } = makeCoordinator()
    const wcA = makeMockWebContents(4001)
    const wcB = makeMockWebContents(4002)
    coordinator.registerWebContents(wcA.id, wcA as never)
    coordinator.registerWebContents(wcB.id, wcB as never)

    // A opens — only A receives the event
    await coordinator.openDocxPath(wcA.id, '/test/focus-a.docx', null)
    expect(wcA.send).toHaveBeenCalledTimes(1)
    expect(wcB.send).not.toHaveBeenCalled()

    // B opens — only B receives the event (A is not "focused" anymore, but that doesn't matter)
    await coordinator.openDocxPath(wcB.id, '/test/focus-b.docx', null)
    expect(wcA.send).toHaveBeenCalledTimes(1) // still just 1 — A didn't get B's event
    expect(wcB.send).toHaveBeenCalledTimes(1)
  })

  it('destroyed renderer receives no event', async () => {
    const { coordinator } = makeCoordinator()
    const wcA = makeMockWebContents(5001)
    coordinator.registerWebContents(wcA.id, wcA as never)
    // Simulate destruction: isDestroyed() returns true
    wcA.isDestroyed = () => true

    await coordinator.openDocxPath(wcA.id, '/test/destroyed.docx', null)

    // The wc.send was never called because the wc is destroyed
    expect(wcA.send).not.toHaveBeenCalled()
  })

  it('torn-down renderer receives no event', async () => {
    const { coordinator } = makeCoordinator()
    const wcA = makeMockWebContents(6001)
    coordinator.registerWebContents(wcA.id, wcA as never)

    // Mark the renderer as torn down BEFORE the open
    DocsShellCoordinatorImpl.markTornDown(wcA.id)

    const result = await coordinator.openDocxPath(wcA.id, '/test/torn-down.docx', null)

    // openDocxPath returns null for a torn-down renderer
    expect(result).toBeNull()
    // The wc.send was never called
    expect(wcA.send).not.toHaveBeenCalledWith('docs:opened', expect.anything())
  })

  it('no duplicate event — docs:opened fires exactly once per open', async () => {
    const { coordinator } = makeCoordinator()
    const wcA = makeMockWebContents(7001)
    coordinator.registerWebContents(wcA.id, wcA as never)

    await coordinator.openDocxPath(wcA.id, '/test/no-dup.docx', null)

    // Exactly one docs:opened event — not two, not zero
    const openedCalls = (wcA.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([channel]) => channel === 'docs:opened',
    )
    expect(openedCalls).toHaveLength(1)
  })

  it('sendOpened directly routes to a specific wcId — no broadcast', () => {
    const { coordinator } = makeCoordinator()
    const wcA = makeMockWebContents(8001)
    const wcB = makeMockWebContents(8002)
    const wcC = makeMockWebContents(8003)
    coordinator.registerWebContents(wcA.id, wcA as never)
    coordinator.registerWebContents(wcB.id, wcB as never)
    coordinator.registerWebContents(wcC.id, wcC as never)

    const result: DocumentOpenResult = {
      path: '/test/direct.docx',
      name: 'direct.docx',
      data: new ArrayBuffer(4),
      hash: 'abc',
    }
    coordinator.sendOpened(wcB.id, result)

    // Only B received the event
    expect(wcB.send).toHaveBeenCalledWith('docs:opened', result)
    expect(wcA.send).not.toHaveBeenCalled()
    expect(wcC.send).not.toHaveBeenCalled()
  })

  it('sendOpened on an unregistered wcId sends nothing — no spurious events', () => {
    const { coordinator } = makeCoordinator()
    const wcA = makeMockWebContents(9001)
    // wcA is NOT registered

    const result: DocumentOpenResult = {
      path: '/test/unregistered.docx',
      name: 'unregistered.docx',
      data: new ArrayBuffer(4),
      hash: 'xyz',
    }
    // Should not throw, should not send
    expect(() => coordinator.sendOpened(99999, result)).not.toThrow()
    expect(wcA.send).not.toHaveBeenCalled()
  })

  it('recovery bytes are carried in the docs:opened event (post-recovery, not pre-recovery)', async () => {
    // This test verifies that sendOpened carries the POST-RECOVERY bytes.
    // We simulate a recovery file by creating one in the userDataDir,
    // and an original file that is OLDER than the recovery copy.
    const { coordinator, docs } = makeCoordinator()
    const wcA = makeMockWebContents(9101)
    coordinator.registerWebContents(wcA.id, wcA as never)

    // Create a real original file in a temp dir
    const { writeFileSync } = await import('node:fs')
    const origDir = mkdtempSync(join(tmpdir(), 'genoffice-recovery-'))
    const filePath = join(origDir, 'recovery-test.docx')
    writeFileSync(filePath, Buffer.from('orig'))
    // Set the original file's mtime to the past so the recovery copy is newer
    const pastTime = new Date(Date.now() - 60000) // 60s ago
    const { utimesSync } = await import('node:fs')
    utimesSync(filePath, pastTime, pastTime)

    // Create the recovery copy in the userDataDir's docs-autosave folder
    const recoveryDir = join(tempDir, 'docs-autosave')
    mkdirSync(recoveryDir, { recursive: true })
    const { createHash } = await import('node:crypto')
    const recoveryName = createHash('sha1').update(filePath).digest('hex').slice(0, 16) + '.docx'
    writeFileSync(join(recoveryDir, recoveryName), Buffer.from('recovered-content'))

    // Make the mock service return this file path
    const mockOpen = docs.open as ReturnType<typeof vi.fn>
    mockOpen.mockResolvedValueOnce({
      session: {
        filePath,
        hash: 'orig-hash',
        diskState: { mtimeMs: pastTime.getTime(), size: 4, hash: 'orig-hash' },
      },
      result: {
        path: filePath,
        name: 'recovery-test.docx',
        data: new TextEncoder().encode('orig').buffer,
        hash: 'orig-hash',
      },
    })

    // User clicks "Restore" (response === 0)
    showMessageBoxMock.mockResolvedValueOnce({ response: 0 })

    const r = await coordinator.openDocxPath(wcA.id, filePath, null)

    // The result should contain the recovered bytes, not the original
    expect(r).not.toBeNull()
    const sentResult = (wcA.send as ReturnType<typeof vi.fn>).mock.calls[0][1]
    const sentBytes = new Uint8Array(sentResult.data)
    expect(new TextDecoder().decode(sentBytes)).toBe('recovered-content')

    // Cleanup
    rmSync(origDir, { recursive: true, force: true })
  })
})
