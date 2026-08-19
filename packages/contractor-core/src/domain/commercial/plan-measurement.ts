/**
 * PlanMeasurement — measurement evidence (NOT commercial authority).
 *
 * A PlanMeasurement preserves sufficient provenance to answer:
 *   what was measured? from which artifact? which sheet? which sheet revision?
 *   which element? which quantity? which unit? which method? which engine
 *   version? who measured it? when?
 *
 * It is EVIDENCE that feeds BOQ → EstimateLine → EstimateRevision, but it
 * is NOT the commercial authority itself. (Phase 2A §5; DOMAIN-AUTHORITY §3.3.)
 *
 * AI may propose measurements; AI cannot establish commercial authority.
 *
 * PURE contract — no persistence, no UI, no Electron.
 */

import type { Quantity } from './quantity.js'

export type MeasurementMethod =
  | 'manual-takeoff'
  | 'auto-takeoff'
  | 'ai-proposed'
  | 'imported'

export type MeasurementBasis =
  | 'count'      // number of elements
  | 'length'     // linear measurement
  | 'area'       // surface area
  | 'volume'     // volumetric
  | 'mass'       // weight
  | 'time'       // duration

/**
 * A PlanMeasurement — measured evidence from a plan/BIM artifact.
 */
export interface PlanMeasurement {
  readonly __brand: 'PlanMeasurement'
  readonly measurementId: string
  readonly sourceArtifactId: string    // IFC/PDF/DXF/DWG reference
  readonly sourceArtifactHash: string  // content hash of the artifact (immutability)
  readonly sheetId: string | null     // sheet within the artifact (e.g. PDF page, IFC floor)
  readonly sheetRevision: string | null
  readonly elementReference: string    // element id within the sheet/artifact
  readonly quantity: Quantity           // measured quantity + unit
  readonly measurementMethod: MeasurementMethod
  readonly measurementBasis: MeasurementBasis
  readonly measurementEngineVersion: string  // the algorithm/tool that measured
  readonly actorId: string             // who measured
  readonly measuredAt: string          // when (ISO; not part of canonical content hash)
  readonly provisional: boolean       // browser/provisional until promoted through the boundary
}

/**
 * Create a PlanMeasurement value (pure). The caller supplies all fields.
 * The measurement is evidence; it does NOT carry pricing.
 */
export function planMeasurement(input: {
  measurementId: string
  sourceArtifactId: string
  sourceArtifactHash: string
  sheetId: string | null
  sheetRevision: string | null
  elementReference: string
  quantity: Quantity
  measurementMethod: MeasurementMethod
  measurementBasis: MeasurementBasis
  measurementEngineVersion: string
  actorId: string
  measuredAt: string
  provisional?: boolean
}): PlanMeasurement {
  if (!input.sourceArtifactId) throw new Error('PlanMeasurement: sourceArtifactId required')
  if (!input.sourceArtifactHash) throw new Error('PlanMeasurement: sourceArtifactHash required')
  if (!input.elementReference) throw new Error('PlanMeasurement: elementReference required')
  if (!input.measurementEngineVersion) throw new Error('PlanMeasurement: measurementEngineVersion required')
  return {
    __brand: 'PlanMeasurement',
    ...input,
    provisional: input.provisional ?? false,
  } as PlanMeasurement
}
