/**
 * Clipboard capability — text, HTML, and image read/write.
 *
 * Electron: clipboard + nativeImage.
 * Web: navigator.clipboard + ClipboardItem.
 */
import type { ClipboardContent } from '../types.js'

export interface Clipboard {
  /** Read clipboard text/HTML. */
  read(): Promise<ClipboardContent>
  /** Write clipboard text/HTML. */
  write(content: ClipboardContent): Promise<void>
  /** Read an image from the clipboard; null when no image. */
  readImage(): Promise<{ data: ArrayBuffer; ext: string } | null>
  /** Write an image to the clipboard. */
  writeImage(data: ArrayBuffer, ext: string): Promise<void>
}
