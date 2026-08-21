/**
 * createSlidesDesktopBridge — maps window.desktop (DesktopFilesApi, slides variant)
 * to the Files capability + SpreadsheetService for attachment operations.
 *
 * Note: the slides renderer exposes TWO globals:
 *   window.slidesApi → SlidesApi (the main slides API, ~140 methods)
 *   window.desktop   → DesktopFilesApi (a smaller 6-method files/attachments API)
 *
 * This bridge produces the DesktopFilesApi shape.
 */
import type { DesktopFilesApi } from '@genoffice/slides-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import { requireWired } from './require-wired.js'

export function createSlidesDesktopBridge(runtime: RuntimeContext): DesktopFilesApi {
  const sheets = requireWired(runtime.sheets, "sheetsService") as any // slides renderer reuses sheets attachment methods
  return {
    pickAttachments: () => sheets.pickAttachments(),
    addAttachmentPaths: (paths) => sheets.addAttachmentPaths(paths),
    addPastedImage: (data, ext) => sheets.addPastedImage(data, ext),
    readAttachment: (path, offset, maxChars) => sheets.readAttachment(path, offset, maxChars),
    readAttachmentImage: (path) => sheets.readAttachmentImage(path),
    getPathForFile: (file) => sheets.getPathForFile(file),
  }
}
