/**
 * notYet — throws an error for a service that is NOT_YET_WIRED.
 *
 * Returns `never` (because it throws), which TypeScript accepts as
 * the return type for any function signature. This is the type-safe
 * replacement for `as never` / `as any` casts on unwired services.
 *
 * Usage:
 *   return {
 *     openPptx: notYet('PresentationService'),
 *     editText: notYet('PresentationService'),
 *   }
 *
 * TypeScript accepts this because `never` is the bottom type —
 * a function that always throws is assignable to any function type.
 */
export function notYet(serviceName: string): never {
  throw new Error(
    `${serviceName} is not wired — this bridge method cannot be called ` +
      `until the service is constructed in its Phase 1 increment.`,
  )
}
