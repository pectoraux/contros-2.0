import { app } from 'electron'
import { startSheetsStandalone } from './sheets-main'
import { reconcileSheetsSaveCommits } from './sheets-shell-coordinator'

// Reconcile leftover save-commit markers from a previous crash BEFORE
// any workbook operations can begin. This runs after app.whenReady()
// (guaranteed by Electron's main entry point) and before
// startSheetsStandalone() registers IPC handlers.
//
// The reconciliation is safe and idempotent — if no markers exist,
// it's a no-op. If markers exist (from a crash during save), they
// are cleaned up deterministically.
void (async () => {
  await app.whenReady()
  await reconcileSheetsSaveCommits()
  startSheetsStandalone()
})()
