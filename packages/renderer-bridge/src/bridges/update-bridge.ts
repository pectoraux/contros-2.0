/**
 * createUpdateBridge — maps window.aiOfficeUpdate (UpdateWindowApi) to a
 * dedicated update service.
 *
 * The update service is not yet a formal capability in @genoffice/platform.
 * Until it is, the bridge reads it from the runtime via a typed accessor.
 *
 * This is NOT a compiler-suppression cast — the `updater` field is an
 * explicit extension point on the runtime, accessed via a typed interface.
 */
import type { UpdateWindowApi, UpdateUiState } from '@genoffice/shell-update-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'

/** Typed extension for the update capability (not yet formalized). */
interface RuntimeWithUpdater extends RuntimeContext {
  updater?: UpdateCapability
}

interface UpdateCapability {
  getState(): Promise<UpdateUiState | null>
  download(): void
  install(): void
  later(): void
  openDownload(): void
  onState(handler: (state: UpdateUiState) => void): () => void
}

export function createUpdateBridge(runtime: RuntimeContext): UpdateWindowApi {
  const updater = (runtime as RuntimeWithUpdater).updater
  if (!updater) {
    throw new Error('RuntimeContext does not have an updater capability')
  }
  return {
    getState: () => updater.getState(),
    download: () => updater.download(),
    install: () => updater.install(),
    later: () => updater.later(),
    openDownload: () => updater.openDownload(),
    onState: (handler) => updater.onState(handler),
  }
}
