/**
 * createUpdateBridge — maps window.aiOfficeUpdate (UpdateWindowApi) to a
 * dedicated update service.
 *
 * For Milestone 1, the update service is a stub on runtime (not yet a formal
 * capability). The bridge delegates 1:1. In Phase 1, the UpdaterProvider
 * becomes a formal capability.
 */
import type { UpdateWindowApi } from '@genoffice/shell-update-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'

// The update capability doesn't exist as a formal interface in @genoffice/platform
// yet (ADR-001 §6.2 listed UpdaterProvider but it wasn't included in the 9
// capabilities). For Milestone 1, we read it from runtime via a cast.
type UpdateCapability = {
  getState(): Promise<import('@genoffice/shell-update-shared').UpdateUiState | null>
  download(): void
  install(): void
  later(): void
  openDownload(): void
  onState(handler: (state: import('@genoffice/shell-update-shared').UpdateUiState) => void): () => void
}

export function createUpdateBridge(runtime: RuntimeContext): UpdateWindowApi {
  const updater = (runtime as unknown as { updater: UpdateCapability }).updater
  return {
    getState: () => updater.getState(),
    download: () => updater.download(),
    install: () => updater.install(),
    later: () => updater.later(),
    openDownload: () => updater.openDownload(),
    onState: (handler) => updater.onState(handler),
  }
}
