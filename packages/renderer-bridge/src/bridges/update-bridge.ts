/**
 * createUpdateBridge — maps window.aiOfficeUpdate (UpdateWindowApi) to a
 * dedicated update service.
 *
 * The update service is not yet a formal capability in @genoffice/platform.
 * Until it is, the bridge accepts it as an explicit constructor dependency.
 *
 * ZERO type assertions. The update capability is passed in, not extracted
 * from the runtime via a cast.
 */
import type { UpdateWindowApi, UpdateUiState } from '@genoffice/shell-update-shared'

interface UpdateCapability {
  getState(): Promise<UpdateUiState | null>
  download(): void
  install(): void
  later(): void
  openDownload(): void
  onState(handler: (state: UpdateUiState) => void): () => void
}

export interface UpdateBridgeDeps {
  updater: UpdateCapability
}

export function createUpdateBridge(deps: UpdateBridgeDeps): UpdateWindowApi {
  const { updater } = deps
  return {
    getState: () => updater.getState(),
    download: () => updater.download(),
    install: () => updater.install(),
    later: () => updater.later(),
    openDownload: () => updater.openDownload(),
    onState: (handler) => updater.onState(handler),
  }
}
