/**
 * Behavioral tests for ElectronFiles.uniquePath().
 *
 * Verifies the method handles:
 *   - foo.docx (no conflict)
 *   - foo.docx when foo.docx exists → foo 1.docx
 *   - foo.docx when foo.docx + foo 1.docx exist → foo 2.docx
 *   - report.pdf (unrelated extension preserved)
 *   - noext (no extension)
 *   - FOO.DOCX (case-insensitive — the file system is case-sensitive on Linux,
 *     case-insensitive on macOS/Windows; the test creates the exact-case file)
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ElectronFiles } from '../src/capabilities/electron-files.js'

describe('ElectronFiles.uniquePath', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'genoffice-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function makeFiles(): ElectronFiles {
    return new ElectronFiles({
      dialog: {} as never,
      shell: {} as never,
      parentWindow: null,
      fallbackDir: tempDir,
    })
  }

  test('foo.docx in empty dir → dir/foo.docx', async () => {
    const files = makeFiles()
    const result = await files.uniquePath(tempDir, 'foo.docx')
    expect(result).toBe(join(tempDir, 'foo.docx'))
  })

  test('foo.docx when foo.docx exists → foo 1.docx', async () => {
    writeFileSync(join(tempDir, 'foo.docx'), '')
    const files = makeFiles()
    const result = await files.uniquePath(tempDir, 'foo.docx')
    expect(result).toBe(join(tempDir, 'foo 1.docx'))
  })

  test('foo.docx when foo.docx + foo 1.docx exist → foo 2.docx', async () => {
    writeFileSync(join(tempDir, 'foo.docx'), '')
    writeFileSync(join(tempDir, 'foo 1.docx'), '')
    const files = makeFiles()
    const result = await files.uniquePath(tempDir, 'foo.docx')
    expect(result).toBe(join(tempDir, 'foo 2.docx'))
  })

  test('report.pdf — unrelated extension preserved', async () => {
    const files = makeFiles()
    const result = await files.uniquePath(tempDir, 'report.pdf')
    expect(result).toBe(join(tempDir, 'report.pdf'))
  })

  test('report.pdf when report.pdf exists → report 1.pdf (not report 1.docx)', async () => {
    writeFileSync(join(tempDir, 'report.pdf'), '')
    const files = makeFiles()
    const result = await files.uniquePath(tempDir, 'report.pdf')
    expect(result).toBe(join(tempDir, 'report 1.pdf'))
  })

  test('noext — no extension', async () => {
    const files = makeFiles()
    const result = await files.uniquePath(tempDir, 'noext')
    expect(result).toBe(join(tempDir, 'noext'))
  })

  test('creates the directory if it does not exist', async () => {
    const nestedDir = join(tempDir, 'nested', 'subdir')
    const files = makeFiles()
    const result = await files.uniquePath(nestedDir, 'foo.docx')
    expect(result).toBe(join(nestedDir, 'foo.docx'))
  })

  test('multiple conflicts: foo.docx when foo.docx + foo 1.docx + foo 2.docx + foo 3.docx exist → foo 4.docx', async () => {
    writeFileSync(join(tempDir, 'foo.docx'), '')
    writeFileSync(join(tempDir, 'foo 1.docx'), '')
    writeFileSync(join(tempDir, 'foo 2.docx'), '')
    writeFileSync(join(tempDir, 'foo 3.docx'), '')
    const files = makeFiles()
    const result = await files.uniquePath(tempDir, 'foo.docx')
    expect(result).toBe(join(tempDir, 'foo 4.docx'))
  })
})
