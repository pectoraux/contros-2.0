/**
 * ElectronClipboard — implements the Clipboard capability using Electron's
 * clipboard + nativeImage.
 */
import type { Clipboard, ClipboardContent } from '@genoffice/platform'

export interface ElectronClipboardDeps {
  /** Electron's clipboard module. */
  clipboard: {
    readText: () => string
    writeText: (text: string) => void
    readHTML: () => string
    writeHTML: (html: string) => void
    readImage: () => { toPNG: () => Buffer; toBitmap: () => Buffer; isEmpty: () => boolean }
    writeImage: (image: { toPNG: () => Buffer } | Buffer) => void
  }
  /** nativeImage.createFromBuffer (lazy import to avoid Electron import in tests). */
  nativeImageFromBuffer?: (buf: Buffer) => { toPNG: () => Buffer }
}

export class ElectronClipboard implements Clipboard {
  constructor(private readonly deps: ElectronClipboardDeps) {}

  async read(): Promise<ClipboardContent> {
    return {
      text: this.deps.clipboard.readText() || null,
      html: this.deps.clipboard.readHTML() || null,
    }
  }

  async write(content: ClipboardContent): Promise<void> {
    if (content.text !== undefined) this.deps.clipboard.writeText(content.text ?? '')
    if (content.html !== undefined) this.deps.clipboard.writeHTML(content.html ?? '')
  }

  async readImage(): Promise<{ data: ArrayBuffer; ext: string } | null> {
    const img = this.deps.clipboard.readImage()
    if (img.isEmpty()) return null
    const buf = img.toPNG()
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, ext: 'png' }
  }

  async writeImage(data: ArrayBuffer, ext: string): Promise<void> {
    const buf = Buffer.from(data)
    if (this.deps.nativeImageFromBuffer) {
      const img = this.deps.nativeImageFromBuffer(buf)
      this.deps.clipboard.writeImage(img)
    } else {
      this.deps.clipboard.writeImage(buf)
    }
  }
}
