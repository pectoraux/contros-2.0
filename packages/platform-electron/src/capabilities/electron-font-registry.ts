/**
 * ElectronFontRegistry — wraps @genoffice/font-metrics' familyVerticalMetrics
 * behind a platform-neutral FontRegistry interface.
 *
 * The docs renderer already has a pure-JS heuristic fallback in line-metrics.ts;
 * the IPC channel exists but is mostly unused. Phase 1 keeps the wrapper thin
 * so the bridge can delegate to it.
 */
import { configureMetricsCache, familyVerticalMetrics } from '@genoffice/font-metrics'
import type { FaceVerticalMetrics } from '@genoffice/font-metrics'

export interface ElectronFontRegistryDeps {
  /** Path to the userData/font-metrics cache directory. */
  cacheDir: string
}

export class ElectronFontRegistry {
  private cacheConfigured = false

  constructor(private readonly deps: ElectronFontRegistryDeps) {}

  /** Returns the vertical metrics for an installed font family, or null when missing. */
  async fontMetrics(family: string): Promise<FaceVerticalMetrics | null> {
    if (!this.cacheConfigured) {
      configureMetricsCache(this.deps.cacheDir)
      this.cacheConfigured = true
    }
    if (typeof family !== 'string') return null
    return familyVerticalMetrics(family)
  }
}
