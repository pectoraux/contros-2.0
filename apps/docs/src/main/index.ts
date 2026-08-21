import { app } from 'electron'
import { startDocsStandalone } from './docs-main'
import { initDocsRuntime, runtimeBundle } from './docs-runtime'
import { registerMigratedDocsIpc } from './docs-migrated-handlers'

// Construct the runtime during app bootstrap, then start the app.
// The runtime is available via getRuntime() for the rest of the main process.
app.whenReady().then(() => {
  initDocsRuntime()
}).then(() => {
  startDocsStandalone()
  // Override specific IPC handlers with runtime-backed implementations.
  // This runs AFTER registerDocsIpc() (called synchronously inside startDocsStandalone)
  // and BEFORE the window is created (which happens in the whenReady callback inside
  // startDocsStandalone — a microtask that fires after this synchronous code).
  if (runtimeBundle) {
    registerMigratedDocsIpc(runtimeBundle)
  }
})
