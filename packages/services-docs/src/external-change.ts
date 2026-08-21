/**
 * External-change detection — re-export from the implementation.
 * Pure logic, no fs imports.
 */
export { isExternallyModified, type DiskFileState } from './external-change-impl.js'
