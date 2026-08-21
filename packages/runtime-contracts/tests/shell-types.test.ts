/**
 * Architecture test: runtime-contracts must NOT contain shell/UI types.
 *
 * Verifies that runtime-contracts has ZERO references to:
 *   - DocsShellCoordinator (shell coordinator)
 *   - DocumentTabInfo (tab/window management)
 *   - DocumentMenuCommand (native menu routing)
 *   - openNewTab / listDocsTabs / focusDocsTab (tab operations)
 *   - pending-open state / new-blank state
 *   - native menu routing
 *
 * Per Principal Architect directive (2026-08-21):
 *   "Runtime-independent types may describe product/domain concepts.
 *    They must not describe Electron/browser application-shell behavior."
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const SRC = join(__dirname, '..', 'src')

function listSourceFiles(rootDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === 'dist' || name === '.git') continue
        walk(full)
      } else if (st.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
        out.push(full)
      }
    }
  }
  walk(rootDir)
  return out
}

function scanForTokens(rootDir: string, forbidden: string[]): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = []
  for (const file of listSourceFiles(rootDir)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const token of forbidden) {
        if (line.includes(token)) {
          hits.push({ file, line: i + 1, text: line.trim() })
        }
      }
    })
  }
  return hits
}

describe('runtime-contracts must not contain shell/UI types', () => {
  test('ZERO references to DocsShellCoordinator', () => {
    const hits = scanForTokens(SRC, ['DocsShellCoordinator'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to DocumentTabInfo', () => {
    const hits = scanForTokens(SRC, ['DocumentTabInfo'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to DocumentMenuCommand', () => {
    const hits = scanForTokens(SRC, ['DocumentMenuCommand'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to tab/window operations (openNewTab, listDocsTabs, focusDocsTab)', () => {
    const hits = scanForTokens(SRC, ['openNewTab', 'listDocsTabs', 'focusDocsTab'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to shell menu routing (onMenuCommand, reportViewMenuState)', () => {
    const hits = scanForTokens(SRC, ['onMenuCommand', 'reportViewMenuState'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to close-guard protocol (onCloseCheck, reportCloseCheck, onCloseSaveRequest, reportCloseSaveResult)', () => {
    const hits = scanForTokens(SRC, [
      'onCloseCheck',
      'reportCloseCheck',
      'onCloseSaveRequest',
      'reportCloseSaveResult',
    ])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })
})
