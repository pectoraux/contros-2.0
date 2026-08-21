/**
 * Files capability — file-system operations (open, read, write, rename, trash).
 *
 * Electron: dialog.showOpenDialog/showSaveDialog + node:fs + shell.trashItem/showItemInFolder/openPath.
 * Web: showOpenFilePicker/showSaveFilePicker (FS Access API) + FileSystemFileHandle;
 *      trash/reveal degrade to download (no backend) or call backend (when available).
 */
import type { FileHandle, DirectoryHandle, FileStat, SaveResult } from '../types.js'

export interface Files {
  /** Pick one or more files to open; null when canceled. */
  pickOpen(opts?: { accept?: string[]; multiple?: boolean }): Promise<FileHandle[] | null>
  /** Pick a save destination; null when canceled. */
  pickSave(opts: { defaultName: string; accept?: string[] }): Promise<FileHandle | null>
  /** Pick a directory; null when canceled. */
  pickDirectory(): Promise<DirectoryHandle | null>

  /** Read file bytes + stat. */
  read(handle: FileHandle | string): Promise<{ bytes: Uint8Array; stat: FileStat }>
  /** Atomic write (tmp + rename on Electron; createWritable on Web). */
  write(handle: FileHandle | string, bytes: Uint8Array): Promise<void>
  /** Stat a file without reading it. Returns null when the file is missing (instead of throwing). */
  stat(handle: FileHandle | string): Promise<FileStat | null>
  /** Rename a file in place; returns the new handle/path. */
  rename(handle: FileHandle | string, newName: string): Promise<FileHandle | string>
  /** Move paths to the OS trash (recoverable). */
  trash(paths: string[]): Promise<void>
  /** Reveal a file in Finder/Explorer. */
  revealInFolder(path: string): Promise<void>
  /** Open a local file in the default application. */
  openPath(path: string): Promise<void>
  /**
   * Find a non-conflicting filename in a directory. If `<dir>/<fileName>`
   * already exists, appends " 1", " 2", etc. before the extension until
   * the path is free. Creates the directory if it doesn't exist.
   */
  uniquePath(dir: string, fileName: string): Promise<string>

  /**
   * Absolute path of a File dropped onto the window (Electron webUtils).
   * Browsers do not expose absolute paths; the Web adapter returns a placeholder
   * or throws. Used by editors for drag-and-drop file resolution.
   */
  getPathForFile(file: File): string
}
