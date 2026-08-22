/**
 * Increment 9 — Files/attachments migration tests.
 *
 * Tests:
 *   1. Attachment adapter functions exist and are callable
 *   2. collectAttachments: validates extensions, rejects unsupported
 *   3. readAttachmentText: reads text, handles offset/maxChars
 *   4. readAttachmentImage: reads bytes, detects MIME, enforces size limit
 *   5. savePastedImage: persists to temp file, rejects non-images
 *   6. Architecture: handler delegates to adapter, zero parseFileToText in handler
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const { mockApp } = vi.hoisted(() => ({
  mockApp: { getPath: vi.fn((name: string) => join(tmpdir(), `genoffice-test-${name}-${randomUUID()}`)) },
}))
vi.mock('electron', () => ({
  app: mockApp,
  dialog: vi.fn(),
  BrowserWindow: vi.fn(),
}))

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `genoffice-test-${randomUUID()}`)
  mkdirSync(testDir, { recursive: true })
})

describe('Increment 9 — Files/attachments migration', () => {
  describe('attachment adapter', () => {
    test('collectAttachments exists and is callable', async () => {
      const adapter = await import('../src/main/sheets-attachment-adapter')
      expect(typeof adapter.collectAttachments).toBe('function')
    })

    test('collectAttachments validates extensions and returns metadata', async () => {
      const adapter = await import('../src/main/sheets-attachment-adapter')
      const txtPath = join(testDir, 'test.txt')
      writeFileSync(txtPath, 'hello world')
      const result = adapter.collectAttachments([txtPath])
      expect(result.accepted.length).toBe(1)
      expect(result.accepted[0].name).toBe('test.txt')
      expect(result.accepted[0].ext).toBe('txt')
      expect(result.accepted[0].sizeBytes).toBe(11)
      expect(result.rejected.length).toBe(0)
    })

    test('collectAttachments rejects unsupported extensions', async () => {
      const adapter = await import('../src/main/sheets-attachment-adapter')
      const badPath = join(testDir, 'test.xyz')
      writeFileSync(badPath, 'unknown')
      const result = adapter.collectAttachments([badPath])
      expect(result.accepted.length).toBe(0)
      expect(result.rejected.length).toBe(1)
    })

    test('readAttachmentText reads text content with offset', async () => {
      const adapter = await import('../src/main/sheets-attachment-adapter')
      const txtPath = join(testDir, 'text.txt')
      writeFileSync(txtPath, 'Hello World ABC DEF')
      const result = await adapter.readAttachmentText(txtPath, 6, 5)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.name).toBe('text.txt')
        expect(result.totalChars).toBe(19)
        expect(result.offset).toBe(6)
        expect(result.text).toBe('World')
      }
    })

    test('readAttachmentText rejects image files', async () => {
      const adapter = await import('../src/main/sheets-attachment-adapter')
      const pngPath = join(testDir, 'image.png')
      writeFileSync(pngPath, 'fake-png-data')
      const result = await adapter.readAttachmentText(pngPath, 0, 100)
      expect(result.ok).toBe(false)
    })

    test('readAttachmentImage reads bytes as base64 with MIME', async () => {
      const adapter = await import('../src/main/sheets-attachment-adapter')
      const pngPath = join(testDir, 'test.png')
      writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])) // PNG magic
      const result = adapter.readAttachmentImage(pngPath)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.mime).toBe('image/png')
        expect(result.base64.length).toBeGreaterThan(0)
      }
    })

    test('readAttachmentImage rejects non-image extensions', async () => {
      const adapter = await import('../src/main/sheets-attachment-adapter')
      const txtPath = join(testDir, 'test.txt')
      writeFileSync(txtPath, 'text')
      const result = adapter.readAttachmentImage(txtPath)
      expect(result.ok).toBe(false)
    })

    test('savePastedImage persists base64 to temp file', async () => {
      const adapter = await import('../src/main/sheets-attachment-adapter')
      const bytes = new ArrayBuffer(4)
      const view = new Uint8Array(bytes)
      view[0] = 0x89; view[1] = 0x50; view[2] = 0x4e; view[3] = 0x47
      const filePath = adapter.savePastedImage(bytes, 'png')
      expect(filePath).not.toBeNull()
      expect(existsSync(filePath!)).toBe(true)
      rmSync(filePath!, { force: true })
    })

    test('savePastedImage rejects non-image extensions', async () => {
      const adapter = await import('../src/main/sheets-attachment-adapter')
      const bytes = new ArrayBuffer(4)
      const filePath = adapter.savePastedImage(bytes, 'txt')
      expect(filePath).toBeNull()
    })

    test('getAttachmentExtensions returns list with known extensions', async () => {
      const adapter = await import('../src/main/sheets-attachment-adapter')
      const exts = adapter.getAttachmentExtensions()
      expect(exts).toContain('txt')
      expect(exts).toContain('docx')
      expect(exts).toContain('pdf')
      expect(exts).toContain('png')
      expect(exts).toContain('xlsx')
    })
  })

  describe('handler delegation (source inspection)', () => {
    test('handler imports from sheets-attachment-adapter', () => {
      const src = require('fs').readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-migrated-handlers.ts'),
        'utf8',
      )
      expect(src).toMatch(/from\s+['"]\.\/sheets-attachment-adapter['"]/)
      expect(src).toMatch(/collectAttachments/)
      expect(src).toMatch(/readAttachmentText/)
      expect(src).toMatch(/readAttachmentImage/)
      expect(src).toMatch(/savePastedImage/)
    })

    test('handler replaces all 5 legacy file handlers', () => {
      const src = require('fs').readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-migrated-handlers.ts'),
        'utf8',
      )
      expect(src).toMatch(/removeHandler\(IPC_CHANNELS\.filesPick\)/)
      expect(src).toMatch(/removeHandler\(IPC_CHANNELS\.filesAdd\)/)
      expect(src).toMatch(/removeHandler\(IPC_CHANNELS\.filesRead\)/)
      expect(src).toMatch(/removeHandler\(IPC_CHANNELS\.filesReadImage\)/)
      expect(src).toMatch(/removeHandler\(IPC_CHANNELS\.filesAddPastedImage\)/)
    })

    test('handler has ZERO parseFileToText calls', () => {
      const src = require('fs').readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-migrated-handlers.ts'),
        'utf8',
      )
      const stripped = src.replace(/\/\*\*?[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(stripped).not.toMatch(/parseFileToText/)
    })

    test('handler has ZERO node:fs imports', () => {
      const src = require('fs').readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-migrated-handlers.ts'),
        'utf8',
      )
      const stripped = src.replace(/\/\*\*?[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(stripped).not.toMatch(/^import.*node:fs/m)
    })

    test('handler has ZERO getFocusedWindow calls', () => {
      const src = require('fs').readFileSync(
        join(__dirname, '..', 'src', 'main', 'sheets-migrated-handlers.ts'),
        'utf8',
      )
      expect(src).not.toMatch(/getFocusedWindow\s*\(/)
    })
  })
})
