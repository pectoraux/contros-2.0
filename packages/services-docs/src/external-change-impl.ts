/**
 * External-change detection — mtime+size+hash check.
 *
 * Phase 1 increment 1: this is a self-contained copy of the logic in
 * apps/docs/src/main/external-change.ts. The original stays in place for now.
 */

/** Disk snapshot recorded at the last read/write of a document path. */
export interface DiskFileState {
  mtimeMs: number
  size: number
  hash: string
}

/**
 * True when the file on disk no longer matches the recorded state, i.e. another
 * program wrote it since we last read/saved it. No record (path never tracked)
 * or a missing file (deleted externally) is not a conflict — the save proceeds
 * and recreates the file. The hash read only runs when mtime+size already
 * disagree, so the common no-conflict save never rereads the file.
 */
export async function isExternallyModified(
  recorded: DiskFileState | undefined,
  current: { mtimeMs: number; size: number } | null,
  readHash: () => string | null | Promise<string | null>,
): Promise<boolean> {
  if (!recorded || !current) return false
  if (current.mtimeMs === recorded.mtimeMs && current.size === recorded.size) return false
  const hash = await readHash()
  return hash !== null && hash !== recorded.hash
}
