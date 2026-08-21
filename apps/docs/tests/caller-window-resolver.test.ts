/**
 * Increment 2D — Fix #2: caller-window resolver tests.
 *
 * Proves:
 *   - A opens while B is focused → dialog parent is A
 *   - B opens while A is focused → dialog parent is B
 *   - WebContentsView resolves to its owning shell window
 *   - focused window is never selected merely because sender-to-window resolution failed
 *   - destroyed/unresolvable caller follows an explicit safe fallback policy
 *
 * The `windowFromSender` function resolves the BrowserWindow for an IPC event
 * sender via:
 *   1. BrowserWindow.fromWebContents(event.sender) — standalone mode
 *   2. callerWindowResolver?.(event.sender) — shell-tab / WebContentsView mode
 *   3. null — modeless fallback (see FALLBACK POLICY in docs-migrated-handlers.ts)
 *
 * BrowserWindow.getFocusedWindow() is NEVER used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent, BrowserWindow } from 'electron'

// ── Mock electron ────────────────────────────────────────────────────────

// BrowserWindow.fromWebContents and getFocusedWindow are the two functions
// we need to control. fromWebContents returns the BrowserWindow for a
// standalone wc, or null for a WebContentsView wc. getFocusedWindow should
// NEVER be called.

const fromWebContentsMock = vi.fn<(wc: unknown) => unknown>(() => null)
const getFocusedWindowMock = vi.fn<() => unknown>(() => null)

vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn() },
  BrowserWindow: {
    fromWebContents: (wc: unknown) => fromWebContentsMock(wc),
    getFocusedWindow: () => getFocusedWindowMock(),
  },
  ipcMain: { removeHandler: vi.fn(), handle: vi.fn() },
}))

// ── Import after mock ───────────────────────────────────────────────────

import {
  windowFromSender,
  setCallerWindowResolver,
} from '../src/main/docs-migrated-handlers'

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * A fake BrowserWindow — structural stand-in carrying just `id` (for assertion
 * identity) and `isDestroyed`. Cast through `unknown` because BrowserWindow has
 * 175+ members we don't need to implement; the coordinator only calls
 * `isDestroyed()` and uses the reference as a dialog parent (passed to
 * `dialog.showMessageBox(parent, opts)` which we mock).
 *
 * This cast is test-only — production code (apps/docs/src/main/** and
 * packages/**) never uses `as unknown as`.
 */
function makeFakeWindow(id: number): BrowserWindow {
  return { id, isDestroyed: () => false } as unknown as BrowserWindow
}

/** A fake IpcMainInvokeEvent with a sender (webContents). */
function makeEvent(senderId: number): IpcMainInvokeEvent {
  return {
    sender: { id: senderId },
  } as unknown as IpcMainInvokeEvent
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Increment 2D — caller-window resolver', () => {
  beforeEach(() => {
    fromWebContentsMock.mockReset()
    getFocusedWindowMock.mockReset()
    setCallerWindowResolver(null)
  })

  afterEach(() => {
    setCallerWindowResolver(null)
  })

  it('standalone mode: fromWebContents returns the caller’s window', () => {
    const winA = makeFakeWindow(101)
    fromWebContentsMock.mockReturnValue(winA)

    const event = makeEvent(201)
    const result = windowFromSender(event)

    expect(result).toBe(winA)
    expect(fromWebContentsMock).toHaveBeenCalledTimes(1)
    expect(getFocusedWindowMock).not.toHaveBeenCalled()
  })

  it('A opens while B is focused → dialog parent is A (standalone)', () => {
    const winA = makeFakeWindow(301)
    const winB = makeFakeWindow(302)

    // fromWebContents returns winA (A is the caller, standalone)
    fromWebContentsMock.mockImplementation((wc) => {
      // wc.sender.id === 401 → winA; otherwise null
      const wcId = (wc as { id: number }).id
      return wcId === 401 ? winA : null
    })

    // getFocusedWindow would return winB (B is focused) — but it must NEVER be called
    getFocusedWindowMock.mockReturnValue(winB)

    const eventA = makeEvent(401)
    const result = windowFromSender(eventA)

    expect(result).toBe(winA)
    expect(getFocusedWindowMock).not.toHaveBeenCalled()
  })

  it('B opens while A is focused → dialog parent is B (standalone)', () => {
    const winA = makeFakeWindow(501)
    const winB = makeFakeWindow(502)

    fromWebContentsMock.mockImplementation((wc) => {
      const wcId = (wc as { id: number }).id
      return wcId === 602 ? winB : null
    })

    // getFocusedWindow would return winA (A is focused) — but it must NEVER be called
    getFocusedWindowMock.mockReturnValue(winA)

    const eventB = makeEvent(602)
    const result = windowFromSender(eventB)

    expect(result).toBe(winB)
    expect(getFocusedWindowMock).not.toHaveBeenCalled()
  })

  it('WebContentsView resolves to its owning shell window via the resolver', () => {
    const shellWindow = makeFakeWindow(701)

    // fromWebContents returns null (the wc is in a WebContentsView, not a BrowserWindow)
    fromWebContentsMock.mockReturnValue(null)

    // The shell registers a resolver that maps any wc to the shell window
    setCallerWindowResolver(() => shellWindow)

    const event = makeEvent(801)
    const result = windowFromSender(event)

    expect(result).toBe(shellWindow)
    expect(getFocusedWindowMock).not.toHaveBeenCalled()
  })

  it('focused window is never selected merely because sender-to-window resolution failed', () => {
    const focusedWindow = makeFakeWindow(901)

    // fromWebContents returns null (resolution failed — e.g., destroyed wc)
    fromWebContentsMock.mockReturnValue(null)

    // No resolver registered — the fallback should be null, NOT the focused window
    setCallerWindowResolver(null)

    // getFocusedWindow would return focusedWindow — but it must NEVER be called
    getFocusedWindowMock.mockReturnValue(focusedWindow)

    const event = makeEvent(1001)
    const result = windowFromSender(event)

    // Result is null (modeless fallback), NOT the focused window
    expect(result).toBeNull()
    expect(getFocusedWindowMock).not.toHaveBeenCalled()
  })

  it('destroyed/unresolvable caller follows the explicit safe fallback policy (null → modeless)', () => {
    // fromWebContents returns null (caller destroyed or unresolvable)
    fromWebContentsMock.mockReturnValue(null)

    // The resolver also returns null (shell can't find the wc either)
    const resolver = vi.fn(() => null)
    setCallerWindowResolver(resolver)

    const event = makeEvent(1101)
    const result = windowFromSender(event)

    // Explicit safe fallback: null (modeless dialog, no parent)
    expect(result).toBeNull()
    expect(getFocusedWindowMock).not.toHaveBeenCalled()
  })

  it('resolver receives the sender webContents (per-wc resolution, not a global constant)', () => {
    const shellWindowA = makeFakeWindow(1201)
    const shellWindowB = makeFakeWindow(1202)

    fromWebContentsMock.mockReturnValue(null)

    // The resolver maps wc.id → shellWindow (A's wc → A's shell, B's wc → B's shell)
    const resolver = vi.fn((wc: unknown) => {
      const wcId = (wc as { id: number }).id
      return wcId === 1301 ? shellWindowA : wcId === 1302 ? shellWindowB : null
    })
    setCallerWindowResolver(resolver)

    const eventA = makeEvent(1301)
    const eventB = makeEvent(1302)

    expect(windowFromSender(eventA)).toBe(shellWindowA)
    expect(windowFromSender(eventB)).toBe(shellWindowB)

    // The resolver was called with the sender webContents, not a global
    expect(resolver).toHaveBeenCalledWith(eventA.sender)
    expect(resolver).toHaveBeenCalledWith(eventB.sender)
    expect(getFocusedWindowMock).not.toHaveBeenCalled()
  })

  it('clearing the resolver (null) restores modeless fallback for WebContentsView wcs', () => {
    const shellWindow = makeFakeWindow(1401)

    fromWebContentsMock.mockReturnValue(null)
    setCallerWindowResolver(() => shellWindow)

    const event1 = makeEvent(1501)
    expect(windowFromSender(event1)).toBe(shellWindow)

    // Clear the resolver (e.g., shell window closed)
    setCallerWindowResolver(null)

    const event2 = makeEvent(1502)
    const result = windowFromSender(event2)

    // Now the fallback is null (modeless), NOT the focused window
    expect(result).toBeNull()
    expect(getFocusedWindowMock).not.toHaveBeenCalled()
  })

  it('fromWebContents takes precedence over the resolver (standalone wins)', () => {
    const standaloneWindow = makeFakeWindow(1601)
    const shellWindow = makeFakeWindow(1602)

    // fromWebContents returns the standalone window
    fromWebContentsMock.mockReturnValue(standaloneWindow)

    // The resolver would return the shell window — but it should NOT be called
    // because fromWebContents already resolved the caller
    const resolver = vi.fn(() => shellWindow)
    setCallerWindowResolver(resolver)

    const event = makeEvent(1701)
    const result = windowFromSender(event)

    expect(result).toBe(standaloneWindow)
    expect(resolver).not.toHaveBeenCalled()
    expect(getFocusedWindowMock).not.toHaveBeenCalled()
  })
})

describe('Increment 2D — caller-window resolver never uses getFocusedWindow', () => {
  beforeEach(() => {
    fromWebContentsMock.mockReset()
    getFocusedWindowMock.mockReset()
    setCallerWindowResolver(null)
  })

  afterEach(() => {
    setCallerWindowResolver(null)
  })

  it('getFocusedWindow is never called across all resolution paths', () => {
    // Path 1: fromWebContents resolves (standalone)
    fromWebContentsMock.mockReturnValue(makeFakeWindow(1))
    windowFromSender(makeEvent(1))
    expect(getFocusedWindowMock).not.toHaveBeenCalled()

    // Path 2: resolver resolves (shell-tab)
    fromWebContentsMock.mockReturnValue(null)
    setCallerWindowResolver(() => makeFakeWindow(2))
    windowFromSender(makeEvent(2))
    expect(getFocusedWindowMock).not.toHaveBeenCalled()

    // Path 3: both fail (modeless fallback)
    fromWebContentsMock.mockReturnValue(null)
    setCallerWindowResolver(null)
    windowFromSender(makeEvent(3))
    expect(getFocusedWindowMock).not.toHaveBeenCalled()
  })
})
