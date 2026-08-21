/**
 * createSlidesDesktopBridge — maps window.desktop (DesktopFilesApi, slides variant)
 * to the Files capability + SpreadsheetService for attachment operations.
 *
 * The SpreadsheetService is NOT_YET_WIRED. All methods throw via `notYet()`.
 *
 * NO `as never` / `as any` casts.
 */
import type { DesktopFilesApi } from '@genoffice/slides-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import { notYet } from './not-yet.js'

export function createSlidesDesktopBridge(_runtime: RuntimeContext): DesktopFilesApi {
  return {
    pickAttachments: notYet.bind(null, 'SpreadsheetService'),
    addAttachmentPaths: notYet.bind(null, 'SpreadsheetService'),
    addPastedImage: notYet.bind(null, 'SpreadsheetService'),
    readAttachment: notYet.bind(null, 'SpreadsheetService'),
    readAttachmentImage: notYet.bind(null, 'SpreadsheetService'),
    getPathForFile: notYet.bind(null, 'SpreadsheetService'),
  }
}
