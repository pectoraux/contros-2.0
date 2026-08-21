/**
 * requireWired — unwraps a ServiceSlot<T>, throwing if the service is not yet wired.
 *
 * Used by bridge factories that need the actual service. Each bridge calls this
 * once at the top; if the service isn't wired (NOT_YET_WIRED), every method throws.
 *
 * This is the type-safe replacement for `null as any` placeholders.
 */
import { isWired, type ServiceSlot } from '@genoffice/runtime-contracts'

export function requireWired<T>(slot: ServiceSlot<T>, serviceName: string): T {
  if (!isWired(slot)) {
    throw new Error(
      `${serviceName} is not wired — the service has not been constructed yet. ` +
        `This bridge method cannot be called until the service is wired in its Phase 1 increment.`,
    )
  }
  return slot
}
