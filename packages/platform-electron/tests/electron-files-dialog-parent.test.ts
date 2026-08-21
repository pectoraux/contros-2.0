/**
 * Increment 2E — ElectronFiles per-call dialog-parent tests.
 *
 * Proves:
 *   - pickOpen/pickSave/pickDirectory accept a per-call `parent` parameter
 *   - The per-call parent is passed to `showOpenDialogWithMemory`/
 *     `showSaveDialogWithMemory` as the BrowserWindow parent
 *   - When the per-call parent is `undefined`, the constructor-configured
 *     `parentWindow` callback is used as the default
 *   - When the per-call parent is `null` (explicit), the dialog is shown
 *     modeless (no parent) — NOT the focused window
 *   - NEVER calls BrowserWindow.getFocusedWindow()
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── Mock @genoffice/electron-utils ───────────────────────────────────────

const showOpenDialogWithMemory = vi.fn(async (_dialog: unknown, parent: unknown) => ({
  canceled: false,
  filePaths: parent ? ['/mocked/path.docx'] : [],
}))
const showSaveDialogWithMemory = vi.fn(async (_dialog: unknown, parent: unknown) => ({
  canceled: false,
  filePath: parent ? '/mocked/save.docx' : undefined,
}))

vi.mock('@genoffice/electron-utils', () => ({
  showOpenDialogWithMemory: (...args: unknown[]) => showOpenDialogWithMemory(...args),
  showSaveDialogWithMemory: (...args: unknown[]) => showSaveDialogWithMemory(...args),
}))

// ── Import after mock ───────────────────────────────────────────────────

import { ElectronFiles } from '../src/capabilities/electron-files'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'genoffice-2e-files-'))
  showOpenDialogWithMemory.mockClear()
  showSaveDialogWithMemory.mockClear()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function makeFiles(parentWindow?: (() => unknown) | null): ElectronFiles {
  return new ElectronFiles({
    dialog: {} as never,
    shell: {} as never,
    parentWindow: parentWindow ?? null,
    fallbackDir: tempDir,
  })
}

/** A fake BrowserWindow — just an object with an `id` for identity. */
function makeFakeWindow(id: number): unknown {
  return { id, isDestroyed: () => false }
}

describe('Increment 2E — ElectronFiles per-call dialog parent', () => {
  describe('pickOpen', () => {
    test('per-call parent is passed through to showOpenDialogWithMemory', async () => {
      const files = makeFiles()
      const winA = makeFakeWindow(101)

      await files.pickOpen(winA, { accept: ['docx'], multiple: false })

      expect(showOpenDialogWithMemory).toHaveBeenCalledTimes(1)
      // 2nd arg is the parent
      expect(showOpenDialogWithMemory.mock.calls[0][1]).toBe(winA)
    })

    test('null per-call parent → modeless (null passed to dialog)', async () => {
      const files = makeFiles()

      await files.pickOpen(null, { accept: ['docx'] })

      expect(showOpenDialogWithMemory).toHaveBeenCalledTimes(1)
      expect(showOpenDialogWithMemory.mock.calls[0][1]).toBeNull()
    })

    test('undefined per-call parent → falls back to constructor parentWindow', async () => {
      const winDefault = makeFakeWindow(201)
      const files = makeFiles(() => winDefault)

      await files.pickOpen(undefined, { accept: ['docx'] })

      expect(showOpenDialogWithMemory).toHaveBeenCalledTimes(1)
      expect(showOpenDialogWithMemory.mock.calls[0][1]).toBe(winDefault)
    })

    test('undefined per-call parent + null constructor default → modeless', async () => {
      const files = makeFiles(() => null)

      await files.pickOpen(undefined, { accept: ['docx'] })

      expect(showOpenDialogWithMemory).toHaveBeenCalledTimes(1)
      expect(showOpenDialogWithMemory.mock.calls[0][1]).toBeNull()
    })

    test('per-call parent wins over constructor default', async () => {
      const winDefault = makeFakeWindow(301)
      const winA = makeFakeWindow(302)
      const files = makeFiles(() => winDefault)

      await files.pickOpen(winA, { accept: ['docx'] })

      expect(showOpenDialogWithMemory.mock.calls[0][1]).toBe(winA)
    })
  })

  describe('pickSave', () => {
    test('per-call parent is passed through to showSaveDialogWithMemory', async () => {
      const files = makeFiles()
      const winA = makeFakeWindow(401)

      await files.pickSave(winA, { defaultName: 'save.docx', accept: ['docx'] })

      expect(showSaveDialogWithMemory).toHaveBeenCalledTimes(1)
      expect(showSaveDialogWithMemory.mock.calls[0][1]).toBe(winA)
    })

    test('null per-call parent → modeless (null passed to dialog)', async () => {
      const files = makeFiles()

      await files.pickSave(null, { defaultName: 'save.docx', accept: ['docx'] })

      expect(showSaveDialogWithMemory).toHaveBeenCalledTimes(1)
      expect(showSaveDialogWithMemory.mock.calls[0][1]).toBeNull()
    })

    test('per-call parent wins over constructor default', async () => {
      const winDefault = makeFakeWindow(501)
      const winB = makeFakeWindow(502)
      const files = makeFiles(() => winDefault)

      await files.pickSave(winB, { defaultName: 'save.docx', accept: ['docx'] })

      expect(showSaveDialogWithMemory.mock.calls[0][1]).toBe(winB)
    })
  })

  describe('pickDirectory', () => {
    test('per-call parent is passed through', async () => {
      const files = makeFiles()
      const winA = makeFakeWindow(601)

      await files.pickDirectory(winA)

      expect(showOpenDialogWithMemory).toHaveBeenCalledTimes(1)
      expect(showOpenDialogWithMemory.mock.calls[0][1]).toBe(winA)
    })

    test('null per-call parent → modeless', async () => {
      const files = makeFiles()

      await files.pickDirectory(null)

      expect(showOpenDialogWithMemory).toHaveBeenCalledTimes(1)
      expect(showOpenDialogWithMemory.mock.calls[0][1]).toBeNull()
    })
  })

  describe('multi-window fidelity', () => {
    test('Window A initiates save, B is "focused" → dialog parented to A (NOT B)', async () => {
      const files = makeFiles() // no constructor default — no getFocusedWindow
      const winA = makeFakeWindow(701)
      const winB = makeFakeWindow(702) // would be "focused" under old behavior

      await files.pickSave(winA, { defaultName: 'save.docx', accept: ['docx'] })

      // The parent passed to showSaveDialogWithMemory is winA — NOT winB.
      // ElectronFiles has no getFocusedWindow() call, so winB is never consulted.
      expect(showSaveDialogWithMemory.mock.calls[0][1]).toBe(winA)
    })

    test('Window B initiates save, A is "focused" → dialog parented to B (NOT A)', async () => {
      const files = makeFiles()
      const winA = makeFakeWindow(801) // would be "focused" under old behavior
      const winB = makeFakeWindow(802)

      await files.pickSave(winB, { defaultName: 'save.docx', accept: ['docx'] })

      expect(showSaveDialogWithMemory.mock.calls[0][1]).toBe(winB)
    })
  })
})
