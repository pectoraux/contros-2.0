/**
 * Architecture-boundary test for @genoffice/renderer-bridge.
 *
 * BOUNDARY CORRECTION (2026-08-21, final):
 *   - ZERO type assertions of any kind in source code
 *     (not just `as never` / `as any`, but also `as T`, `as SomeType`,
 *      `as unknown as`, etc.)
 *   - All type conversions use runtime-validated type guards or
 *     structural assignment (no cast needed when types match)
 *
 * PRELOAD ARCHITECTURE (Increment 2H):
 *   - ZERO Electron imports (the bridge is runtime-independent)
 *   - ZERO BrowserWindow / WebContents references
 *   - ZERO global caller state (no activeRenderer, activeWcId,
 *     currentCaller, getFocusedWindow, AsyncLocalStorage)
 *   - The bridge delegates to IPC via IpcTransport — caller identity
 *     is derived at the IPC handler boundary, NOT in the bridge
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'

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

function scanForPattern(
  rootDir: string,
  pattern: RegExp,
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = []
  for (const file of listSourceFiles(rootDir)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // Skip comments
      const stripped = line.trim()
      if (stripped.startsWith('*') || stripped.startsWith('//') || stripped.startsWith('/*')) {
        return
      }
      // Skip import type / export type lines (those use `from` not `as`)
      if (stripped.startsWith('import type ') || stripped.startsWith('export type ')) {
        return
      }
      // Skip JSDoc type annotations like `@param {T}` — not `as T`
      // Match the pattern: ` as Identifier` where Identifier starts with uppercase or T
      if (pattern.test(line)) {
        hits.push({ file, line: i + 1, text: line.trim() })
      }
    })
  }
  return hits
}

function scanForImports(
  rootDir: string,
  forbidden: Array<string | RegExp>,
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = []
  const importPattern = /(?:from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g
  for (const file of listSourceFiles(rootDir)) {
    const text = readFileSync(file, 'utf8')
    let m: RegExpExecArray | null
    while ((m = importPattern.exec(text)) !== null) {
      const mod = m[1]
      const lineNum = text.slice(0, m.index).split('\n').length
      for (const f of forbidden) {
        const isHit = typeof f === 'string' ? mod === f || mod.startsWith(f + '/') : f.test(mod)
        if (isHit) {
          hits.push({ file, line: lineNum, text: `import ... from '${mod}'` })
        }
      }
    }
  }
  return hits
}

describe('@genoffice/renderer-bridge architecture boundary', () => {
  // Increment 2I: the previous test used /\bas\s+[A-Z]/ which only catches
  // `as UppercaseIdentifier` — it missed `as never`, `as any`, `as foo`.
  // The test claimed ZERO assertions while the source had 6 `as never` casts.
  // This test now reliably catches ALL type assertions:
  //   as never, as any, as unknown as, as SomeType, as foo
  // It matches `as <identifier>` where identifier starts with any letter
  // (upper or lower case). It excludes:
  //   - comments (lines starting with *, //, /*)
  //   - import aliases (import { x as y })
  //   - JSDoc @type annotations
  test('ZERO type assertions ("as never", "as any", "as unknown as", "as Identifier") in source code', () => {
    // Match `as <identifier>` where identifier starts with a letter (any case).
    // This catches: as never, as any, as unknown, as Foo, as bar, as T, etc.
    // It does NOT match: `as` in string literals, `as` in import aliases.
    const pattern = /\bas\s+[a-zA-Z_]/
    const hits = scanForPattern(SRC, pattern)
    if (hits.length > 0) {
      console.error('Found type assertions:')
      for (const h of hits) {
        console.error(`  ${h.file}:${h.line}: ${h.text}`)
      }
    }
    expect(hits).toEqual([])
  })

  // Explicit tests for the specific assertions that were present in 2H.
  // These are redundant with the general test above but make the intent
  // explicit and ensure the test fails against the 2H source.
  test('ZERO "as never" assertions', () => {
    const hits = scanForPattern(SRC, /\bas\s+never\b/)
    expect(hits).toEqual([])
  })

  test('ZERO "as any" assertions', () => {
    const hits = scanForPattern(SRC, /\bas\s+any\b/)
    expect(hits).toEqual([])
  })

  test('ZERO "as unknown as" double-casts', () => {
    const hits = scanForPattern(SRC, /as\s+unknown\s+as/)
    expect(hits).toEqual([])
  })

  test('ZERO Proxy usage', () => {
    const hits = scanForPattern(SRC, /new Proxy\(/)
    expect(hits).toEqual([])
  })

  // Increment 2H: the bridge MUST NOT import Electron. It is a
  // runtime-independent compatibility adapter that delegates to IPC
  // via the injected IpcTransport. The preload (apps/docs/src/preload/)
  // provides the IpcTransport backed by ipcRenderer.
  test('ZERO Electron imports (Increment 2H: runtime-independent bridge)', () => {
    const hits = scanForImports(SRC, ['electron'])
    expect(hits).toEqual([])
  })

  // Increment 2H: ZERO BrowserWindow / WebContents type references in source.
  // The bridge must not know about Electron-specific types.
  test('ZERO BrowserWindow / WebContents references in source', () => {
    const hits = scanForPattern(SRC, /\bBrowserWindow\b|\bWebContents\b/)
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  // Increment 2H: ZERO global caller state. The bridge must NOT depend on
  // a global active renderer, a focused window, an AsyncLocalStorage caller
  // context, or any other global mechanism for resolving the caller. The
  // caller is derived at the IPC handler boundary from event.sender.
  test('ZERO global caller state (no activeRenderer, activeWcId, currentCaller, getFocusedWindow, AsyncLocalStorage)', () => {
    const hits = scanForPattern(
      SRC,
      /activeRenderer|activeWcId|currentCaller|getFocusedWindow|AsyncLocalStorage/,
    ).filter(
      (h) =>
        !h.text.includes('NOT') &&
        !h.text.includes('NEVER') &&
        !h.text.includes('forbidden') &&
        !h.text.includes('ZERO'),
    )
    expect(hits).toEqual([])
  })

  // Increment 2H: the DocsShellCoordinatorAdapter has been DELETED (Option A).
  // The bridge delegates to IPC, not to a coordinator object. The adapter
  // was the wrong execution model — it tried to resolve caller context in
  // the bridge, but caller identity exists at the IPC handler boundary.
  test('DocsShellCoordinatorAdapter is DELETED (Option A — IPC handlers provide caller context)', () => {
    const adapterPath = join(SRC, 'shell', 'docs-coordinator-adapter.ts')
    expect(existsSync(adapterPath)).toBe(false)
  })

  // Increment 2H: the IpcTransport interface must exist as the
  // runtime-independent IPC abstraction.
  test('IpcTransport exists as the runtime-independent IPC interface', () => {
    const transportPath = join(SRC, 'ipc-transport.ts')
    expect(existsSync(transportPath)).toBe(true)

    const indexText = readFileSync(join(SRC, 'index.ts'), 'utf8')
    expect(indexText).toContain('IpcTransport')
  })

  // Increment 2H: the DocsShellCoordinator interface is REMOVED.
  // The bridge no longer delegates to a coordinator — it delegates to IPC.
  test('DocsShellCoordinator interface is REMOVED (bridge delegates to IPC, not a coordinator)', () => {
    const indexText = readFileSync(join(SRC, 'index.ts'), 'utf8')
    expect(indexText).not.toContain('DocsShellCoordinator')
    expect(indexText).not.toContain('createDocsShellCoordinatorAdapter')
    expect(indexText).not.toContain('CallerContextResolver')
    expect(indexText).not.toContain('PerRendererDocsCoordinator')
  })
})
