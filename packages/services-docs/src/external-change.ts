/**
 * External-change detection — mtime+size+hash check.
 *
 * Re-exported from apps/docs/src/main/external-change.ts (which stays in place
 * during Phase 1 increment 1 — moving it is a cosmetic cleanup that happens
 * in a later phase).
 */
export { isExternallyModified, type DiskFileState } from './external-change-impl.js'
