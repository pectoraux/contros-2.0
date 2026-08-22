/**
 * Runtime XLSX file operations — Node filesystem I/O for the XLSX gateway.
 *
 * These functions were previously in packages/xlsx-gateway/src/gateway/
 * xlsx-gateway.ts but were moved here (Increment 3F) because they use
 * node:crypto, node:fs/promises, node:path — the xlsx-gateway package
 * must be pure (ZERO node:* imports).
 *
 * The pure planner (planCellEditsToXlsx) operates on EntrySource + Buffers.
 * These runtime functions handle the filesystem concerns: atomic writes,
 * sha256 hashing, and the file-based mutation pipeline.
 */

import { createHash } from 'node:crypto'
import { open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { ChangePlan, XlsxMutation } from '@genoffice/xlsx-gateway'
import { applyPlanToXlsx } from '@genoffice/xlsx-gateway'

/**
 * Flush a freshly written file before it is renamed into place. The handle
 * must be writable — Windows' FlushFileBuffers rejects read-only handles
 * with EPERM (#356) — and the flush is best-effort on top of that: inside
 * cloud-sync folders (OneDrive/Dropbox) or under AV locks, reopening or
 * syncing can still be refused with EPERM/EACCES/EBUSY. The bytes are
 * already written at this point, so a refused flush only weakens crash
 * durability and must not fail the save itself.
 */
export async function syncFileBestEffort(path: string): Promise<void> {
  const tolerated = (error: unknown) =>
    ['EPERM', 'EACCES', 'EBUSY', 'EINVAL', 'ENOSYS'].includes(
      (error as NodeJS.ErrnoException).code ?? '',
    )
  let handle
  try {
    handle = await open(path, 'r+')
  } catch (error: unknown) {
    if (tolerated(error)) return
    throw error
  }
  try {
    await handle.sync()
  } catch (error: unknown) {
    if (!tolerated(error)) throw error
  } finally {
    await handle.close()
  }
}

export async function writeXlsxAtomically(path: string, buffer: Buffer): Promise<void> {
  const temporaryPath = join(dirname(path), `.${randomUUID()}.tmp.xlsx`)
  try {
    await writeFile(temporaryPath, buffer, { flag: 'wx' })
    await syncFileBestEffort(temporaryPath)
    await rename(temporaryPath, path)
  } catch (error: unknown) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

export async function mutateXlsxFile(
  path: string,
  expectedSha256: string,
  plan: ChangePlan,
  sheetNamesById: Readonly<Record<string, string>>,
): Promise<XlsxMutation> {
  const source = await readFile(path)
  if (sha256(source) !== expectedSha256) {
    throw new Error('The workbook changed on disk after preview.')
  }
  const mutation = await applyPlanToXlsx(source, plan, sheetNamesById)
  await writeXlsxAtomically(path, mutation.buffer)
  return mutation
}

export function sha256(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex')
}
