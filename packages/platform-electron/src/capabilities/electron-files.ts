/**
 * ElectronFiles — implements the Files capability using Electron's dialog +
 * node:fs + shell.trashItem/showItemInFolder/openPath.
 *
 * Wraps the existing patterns from apps/docs/src/main/docs-main.ts and
 * packages/electron-utils/src/dialog-memory.ts.
 *
 * IMPORTANT (ADR-001 Correction A): this class receives its dependencies via
 * constructor. It does NOT call getRuntime() internally.
 *
 * For Phase 1 increment 1, file handles are absolute path strings. The Web
 * adapter (in a later phase) will use FileSystemFileHandle instead.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Buffer } from 'node:buffer'
import {
  showOpenDialogWithMemory,
  showSaveDialogWithMemory,
} from '@genoffice/electron-utils'
import type { Files, FileHandle, DirectoryHandle, FileStat } from '@genoffice/platform'

export interface ElectronFilesDeps {
  /** The Electron dialog module (electron.dialog) — injected for testability. */
  dialog: {
    showOpenDialog: (opts?: any) => Promise<{ canceled: boolean; filePaths: string[] }>
    showSaveDialog: (opts?: any) => Promise<{ canceled: boolean; filePath?: string }>
  }
  /** The Electron shell module (electron.shell) — injected for testability. */
  shell: {
    trashItem: (path: string) => Promise<void>
    showItemInFolder: (path: string) => void
    openPath: (path: string) => Promise<string>
  }
  /** The Electron BrowserWindow (for dialog parent), or null. Passed as `any` to avoid coupling. */
  parentWindow: (() => any | null) | null
  /** Fallback directory for the dialog-memory (the default save dir). */
  fallbackDir?: string
}

export class ElectronFiles implements Files {
  constructor(private readonly deps: ElectronFilesDeps) {}

  async pickOpen(opts?: {
    accept?: string[]
    multiple?: boolean
  }): Promise<FileHandle[] | null> {
    const result = await showOpenDialogWithMemory(
      this.deps.dialog as any,
      this.deps.parentWindow?.() ?? null,
      {
        title: 'Open',
        filters: opts?.accept
          ? [{ name: 'Supported', extensions: opts.accept.map((e) => e.replace(/^\./, '')) }]
          : undefined,
        properties: [
          'openFile',
          ...(opts?.multiple ? (['multiSelections'] as const) : []),
        ],
      },
      this.deps.fallbackDir,
    )
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  }

  async pickSave(opts: {
    defaultName: string
    accept?: string[]
  }): Promise<FileHandle | null> {
    const result = await showSaveDialogWithMemory(
      this.deps.dialog as any,
      this.deps.parentWindow?.() ?? null,
      {
        title: 'Save As',
        defaultPath: opts.defaultName,
        filters: opts?.accept
          ? [{ name: 'Save', extensions: opts.accept.map((e) => e.replace(/^\./, '')) }]
          : undefined,
      },
      this.deps.fallbackDir,
    )
    if (result.canceled || !result.filePath) return null
    return result.filePath
  }

  async pickDirectory(): Promise<DirectoryHandle | null> {
    const result = await showOpenDialogWithMemory(
      this.deps.dialog as any,
      this.deps.parentWindow?.() ?? null,
      {
        title: 'Choose Directory',
        properties: ['openDirectory'],
      },
      this.deps.fallbackDir,
    )
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] as unknown as DirectoryHandle
  }

  async read(handle: FileHandle | string): Promise<{ bytes: Uint8Array; stat: FileStat }> {
    const path = typeof handle === 'string' ? handle : String(handle)
    const buf = readFileSync(path)
    const st = statSync(path)
    return {
      bytes: new Uint8Array(buf),
      stat: { mtimeMs: st.mtimeMs, sizeBytes: st.size },
    }
  }

  async write(handle: FileHandle | string, bytes: Uint8Array): Promise<void> {
    const path = typeof handle === 'string' ? handle : String(handle)
    mkdirSync(dirname(path), { recursive: true })
    // Atomic write: tmp + rename, with Windows retry (mirrors apps/docs/src/main/atomic-write.ts)
    const tmp = join(dirname(path), `.${basename(path)}.${randomBytesHex(6)}.tmp`)
    try {
      writeFileSync(tmp, bytes)
      try {
        renameSync(tmp, path)
        return
      } catch (err: any) {
        const code = err?.code ?? ''
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(code)) throw err
        // Retry once with a small delay (Windows Defender/indexer lock)
        await sleep(50)
        try {
          renameSync(tmp, path)
          return
        } catch {
          // Fall through to in-place write
        }
      }
    } catch (err: any) {
      try {
        unlinkSync(tmp)
      } catch {
        /* tmp never created */
      }
      if (['EPERM', 'EACCES', 'EBUSY'].includes(err?.code ?? '')) {
        writeFileSync(path, bytes)
        return
      }
      throw err
    }
    // Final fallback if rename failed all retries
    writeFileSync(path, bytes)
  }

  async stat(handle: FileHandle | string): Promise<FileStat> {
    const path = typeof handle === 'string' ? handle : String(handle)
    const st = statSync(path)
    return { mtimeMs: st.mtimeMs, sizeBytes: st.size }
  }

  async rename(handle: FileHandle | string, newName: string): Promise<FileHandle | string> {
    const path = typeof handle === 'string' ? handle : String(handle)
    const newPath = join(dirname(path), newName)
    renameSync(path, newPath)
    return newPath
  }

  async trash(paths: string[]): Promise<void> {
    for (const p of paths) {
      await this.deps.shell.trashItem(p)
    }
  }

  async revealInFolder(path: string): Promise<void> {
    this.deps.shell.showItemInFolder(path)
  }

  async openPath(path: string): Promise<void> {
    await this.deps.shell.openPath(path)
  }

  /**
   * Returns the absolute path of a File dropped onto the window (Electron webUtils).
   * Browsers cannot expose absolute paths; this is an Electron-only capability.
   */
  getPathForFile(file: File): string {
    // webUtils.getPathForFile is the Electron API; apps/docs/src/preload/index.ts
    // calls it directly via `webUtils.getPathForFile(file)`. The bridge forwards
    // to this method. Phase 1's bridge calls webUtils directly (preserves behavior
    // exactly); this method exists for future use by services that need the path
    // without going through the renderer.
    // (The actual webUtils import is in the preload; this is a stub for services.)
    throw new Error('ElectronFiles.getPathForFile requires webUtils — call from preload, not from main')
  }
}

function randomBytesHex(bytes: number): string {
  // Synchronous random hex (avoids the node:crypto import in the preload)
  const buf = Buffer.alloc(bytes)
  for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256)
  return buf.toString('hex')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Compute a sha256 hash of file bytes (for external-change detection). */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

/** Check if a path exists (convenience for services). */
export function pathExists(path: string): boolean {
  return existsSync(path)
}
