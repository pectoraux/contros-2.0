/**
 * Atomic write — same-dir temp file + rename, with Windows retry.
 *
 * Re-exported from apps/docs/src/main/atomic-write.ts (which stays in place
 * during Phase 1 increment 1 — moving it is a cosmetic cleanup that happens
 * in a later phase).
 *
 * This file exists so services-docs has a stable import path that doesn't
 * cross package boundaries into an app.
 */
export { atomicWriteFile, looksLikeZip } from './atomic-write-impl.js'
