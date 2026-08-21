/**
 * Architecture-boundary test for @genoffice/services-docs.
 *
 * Enforces (per Principal Architect review, 2026-08-21):
 *   - ZERO imports of node:* (no node:fs, node:crypto, node:path, node:buffer)
 *   - ZERO imports of electron
 *   - ZERO references to BrowserWindow / webContents / wcId
 *   - ZERO shell-hook deps (canWrite / allowWrite / getActiveWcId / openTab /
 *     listTabs / focusTab / saveDialog)
 *
 * The service is a PURE DOMAIN layer. All filesystem operations go through
 * the Files / Storage capability interfaces.
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

function scanForImports(rootDir: string, forbidden: Array<string | RegExp>): Array<{ file: string; line: number; text: string }> {
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

describe('@genoffice/services-docs architecture boundary', () => {
  test('ZERO imports of node:* (no node:fs, node:crypto, node:path, node:buffer)', () => {
    const hits = scanForImports(SRC, [/^node:/])
    expect(hits).toEqual([])
  })

  test('ZERO imports of electron', () => {
    const hits = scanForImports(SRC, ['electron', '@genoffice/electron-utils'])
    expect(hits).toEqual([])
  })

  test('ZERO references to BrowserWindow / webContents / wcId', () => {
    const hits = scanForTokens(SRC, [
      'BrowserWindow',
      'webContents',
      'wcId',
      'WebContentsView',
    ]).filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO shell-hook deps (canWrite / allowWrite / getActiveWcId / openTab / listTabs / focusTab / saveDialog) in DocumentServiceDeps', () => {
    // The dep interface should not declare these shell hooks.
    // (The service may call eventBus.requestOpenTab etc., but those are
    // semantic events the shell subscribes to — not direct shell callbacks.)
    const hits = scanForTokens(SRC, [
      'canWrite:',
      'allowWrite:',
      'getActiveWcId:',
      'openTab?:',
      'listTabs?:',
      'focusTab?:',
      'saveDialog?:',
    ]).filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO direct fs API calls (mkdirSync / copyFileSync / writeFileSync / etc.)', () => {
    const hits = scanForTokens(SRC, [
      'mkdirSync(',
      'copyFileSync(',
      'writeFileSync(',
      'existsSync(',
      'readdirSync(',
      'statSync(',
      'unlinkSync(',
      'readFileSync(',
      'renameSync(',
    ]).filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to attachDocsService or getRuntimeForAttach (service-locator escape hatch)', () => {
    const hits = scanForTokens(SRC, ['attachDocsService', 'getRuntimeForAttach', "require('@genoffice/runtime-contracts')"])
    expect(hits).toEqual([])
  })
})
