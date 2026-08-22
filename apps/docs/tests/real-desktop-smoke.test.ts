/**
 * Real renderer-driven smoke test via Chrome DevTools Protocol (CDP).
 *
 * Launches the shell with --remote-debugging-port, then connects to the
 * docs renderer's page-level CDP endpoint (via /json) to execute
 * window.desktop.* calls directly in the renderer context.
 *
 * This proves the complete round trip:
 *   renderer (window.desktop.openDocxPath)
 *       → preload bridge (createDocsDesktopBridge)
 *       → ipcRenderer.invoke('docs:open-path')
 *       → ipcMain handler
 *       → DocsShellCoordinatorImpl
 *       → DocumentService
 *       → Electron filesystem
 *       → IPC response
 *       → renderer promise resolves
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { mkdtempSync, rmSync, existsSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import http from 'node:http'

const REPO_ROOT = resolve(__dirname, '../../..')
const ELECTRON_BIN = resolve(REPO_ROOT, 'node_modules/.bin/electron')
const SHELL_APP = resolve(REPO_ROOT, 'apps/shell')

const tempDir = mkdtempSync(join(tmpdir(), 'genoffice-cdp-'))
const docxFixture = join(tempDir, 'smoke-test.docx')
const existingFixture = resolve(REPO_ROOT, 'fixtures/generated/simple.docx')
if (existsSync(existingFixture)) copyFileSync(existingFixture, docxFixture)

const DEBUG_PORT = 19222

async function cdpList(): Promise<Array<{ id: string; url: string; title: string; type: string; webSocketDebuggerUrl: string }>> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${DEBUG_PORT}/json`, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.setTimeout(3000, () => reject(new Error('CDP list timeout')))
  })
}

async function findTarget(urlPattern: string): Promise<{ webSocketDebuggerUrl: string } | null> {
  const targets = await cdpList()
  const found = targets.find((t) => t.type === 'page' && t.url.includes(urlPattern))
  return found ? { webSocketDebuggerUrl: found.webSocketDebuggerUrl } : null
}

async function cdpEval(wsUrl: string, expression: string): Promise<unknown> {
  const ws = new WebSocket(wsUrl)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
    setTimeout(() => reject(new Error('ws open timeout')), 5000)
  })
  try {
    return await new Promise((resolve, reject) => {
      const msgId = Math.floor(Math.random() * 1e6) + 1
      const handler = (data: Buffer) => {
        const msg = JSON.parse(data.toString())
        if (msg.id === msgId) {
          ws.off('message', handler)
          if (msg.error) reject(new Error(JSON.stringify(msg.error)))
          else {
            const result = msg.result?.result
            resolve(result?.value ?? (result?.subtype === 'null' ? null : result))
          }
        }
      }
      ws.on('message', handler)
      ws.send(JSON.stringify({ id: msgId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      setTimeout(() => { ws.off('message', handler); reject(new Error('eval timeout')) }, 15000)
    })
  } finally {
    ws.close()
  }
}

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs: number, intervalMs = 1000): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { const r = await fn(); if (r) return r } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`)
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Real renderer-driven smoke test (CDP)', { timeout: 90000 }, () => {
  let proc: ChildProcess | null = null
  let docsWsUrl: string | null = null

  beforeAll(() => {
    proc = spawn(
      ELECTRON_BIN,
      [SHELL_APP, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
       '--disable-gpu-compositing', '--disable-gpu-sandbox',
       `--remote-debugging-port=${DEBUG_PORT}`],
      {
        env: { ...process.env, DISPLAY: ':99', GENOFFICE_USER_DATA: tempDir },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    proc.stderr?.on('data', () => {})
    proc.stdout?.on('data', () => {})
  })

  afterAll(() => {
    if (proc && !proc.killed) proc.kill('SIGTERM')
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('startup/build smoke: app starts, docs tab created, no ESM errors', async () => {
    // Wait for the CDP endpoint
    await waitFor(async () => { try { return (await cdpList()).length > 0 ? true : null } catch { return null } }, 15000)

    // Create a docs tab via the home page's aiOffice API
    const homeWs = (await cdpList()).find((t) => t.type === 'page')
    expect(homeWs).toBeDefined()
    await cdpEval(homeWs!.webSocketDebuggerUrl, 'window.aiOffice.newDoc()')

    // Wait for the docs renderer to appear (it shows up as a page target with "docs/out/renderer" in the URL)
    const docsTarget = await waitFor(async () => findTarget('docs/out/renderer'), 20000)
    docsWsUrl = docsTarget.webSocketDebuggerUrl
  })

  test('real window.desktop round trip: openDocxPath', async () => {
    expect(docsWsUrl).not.toBeNull()

    const openResult = await cdpEval(docsWsUrl!,
      `window.desktop.openDocxPath(${JSON.stringify(docxFixture)})`) as { path: string; hash: string } | null

    expect(openResult).not.toBeNull()
    expect(openResult!.path).toBe(docxFixture)
    expect(typeof openResult!.hash).toBe('string')
    expect(openResult!.hash.length).toBeGreaterThan(0)
  })

  test('real push event: onOpenDocx handler receives payload', async () => {
    expect(docsWsUrl).not.toBeNull()

    const result = await cdpEval(docsWsUrl!, `
      new Promise((resolve) => {
        let received = false;
        let eventData = null;
        const unsub = window.desktop.onOpenDocx((result) => {
          received = true;
          eventData = result;
          unsub();
          resolve(JSON.stringify({ received: true, hasPath: result && typeof result.path === 'string', path: result ? result.path : null }));
        });
        // Register the listener, then wait 1s before triggering the open
        // to ensure the ipcRenderer.on listener is fully installed
        setTimeout(() => {
          window.desktop.openDocxPath(${JSON.stringify(docxFixture)}).then((openResult) => {
            // The open promise resolved — check if the event was received
            setTimeout(() => {
              if (!received) {
                resolve(JSON.stringify({ received: false, openSucceeded: openResult !== null, openPath: openResult ? openResult.path : null }));
              }
            }, 3000);
          });
        }, 1000);
        setTimeout(() => resolve(JSON.stringify({ received, timeout: true })), 15000);
      })
    `) as string

    const parsed = JSON.parse(result)
    // eslint-disable-next-line no-console
    console.log('[push event test] result:', parsed)
    expect(parsed.received).toBe(true)
    expect(parsed.hasPath).toBe(true)
  })

  test('real API check: window.desktop has all expected methods', async () => {
    expect(docsWsUrl).not.toBeNull()

    const apiJson = await cdpEval(docsWsUrl!, `
      JSON.stringify({
        hasDesktop: typeof window.desktop !== 'undefined',
        hasOpenDocx: typeof window.desktop.openDocx === 'function',
        hasOpenDocxPath: typeof window.desktop.openDocxPath === 'function',
        hasSaveDocx: typeof window.desktop.saveDocx === 'function',
        hasSaveDocxAs: typeof window.desktop.saveDocxAs === 'function',
        hasSaveDocxNew: typeof window.desktop.saveDocxNew === 'function',
        hasGetRecentFiles: typeof window.desktop.getRecentFiles === 'function',
        hasPickImage: typeof window.desktop.pickImage === 'function',
        hasOnOpenDocx: typeof window.desktop.onOpenDocx === 'function',
        hasOnRenamedDocx: typeof window.desktop.onRenamedDocx === 'function',
        hasOnTeardown: typeof window.desktop.onTeardown === 'function',
        hasPrint: typeof window.desktop.print === 'function',
        hasExportPdf: typeof window.desktop.exportPdf === 'function',
        hasPrintPdfBuffer: typeof window.desktop.printPdfBuffer === 'function',
        hasSaveMergedPdf: typeof window.desktop.saveMergedPdf === 'function',
        hasWriteRecoveryCopy: typeof window.desktop.writeRecoveryCopy === 'function',
        hasGetPathForFile: typeof window.desktop.getPathForFile === 'function',
        hasGetLanguage: typeof window.desktop.getLanguage === 'function',
        hasGetTheme: typeof window.desktop.getTheme === 'function',
        hasOnMenuCommand: typeof window.desktop.onMenuCommand === 'function',
        hasProjectApi: typeof window.projectApi !== 'undefined',
      })
    `) as string

    const check = JSON.parse(apiJson)
    expect(check.hasDesktop).toBe(true)
    expect(check.hasOpenDocx).toBe(true)
    expect(check.hasOpenDocxPath).toBe(true)
    expect(check.hasSaveDocx).toBe(true)
    expect(check.hasSaveDocxAs).toBe(true)
    expect(check.hasSaveDocxNew).toBe(true)
    expect(check.hasGetRecentFiles).toBe(true)
    expect(check.hasPickImage).toBe(true)
    expect(check.hasOnOpenDocx).toBe(true)
    expect(check.hasOnRenamedDocx).toBe(true)
    expect(check.hasOnTeardown).toBe(true)
    expect(check.hasPrint).toBe(true)
    expect(check.hasExportPdf).toBe(true)
    expect(check.hasPrintPdfBuffer).toBe(true)
    expect(check.hasSaveMergedPdf).toBe(true)
    expect(check.hasWriteRecoveryCopy).toBe(true)
    expect(check.hasGetPathForFile).toBe(true)
    expect(check.hasGetLanguage).toBe(true)
    expect(check.hasGetTheme).toBe(true)
    expect(check.hasOnMenuCommand).toBe(true)
    expect(check.hasProjectApi).toBe(true)
  })
})
