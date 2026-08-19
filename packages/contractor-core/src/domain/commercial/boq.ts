/**
 * BOQ — Bill of Quantities (scope structure, NOT commercial authority).
 *
 * A BOQ represents scope structure: item code, description, unit, quantity,
 * source/provenance. The final commercial authority remains EstimateRevision.
 * (Phase 2A §6.)
 *
 * A BOQ is typically derived from PlanMeasurement evidence, but it may also
 * be imported (e.g. from a client-provided bill). Either way, it is scope
 * structure — the pricing lives in EstimateLine → EstimateRevision.
 *
 * PURE contract — no persistence, no UI, no Electron.
 */

import type { Quantity } from './quantity.js'

export type BOQItemProvenance =
  | 'plan-measurement'    // derived from PlanMeasurement evidence
  | 'imported'            // imported from an external bill
  | 'manual'              // manually authored

/**
 * A BOQItem — one line of scope structure.
 */
export interface BOQItem {
  readonly __brand: 'BOQItem'
  readonly itemId: string
  readonly itemCode: string       // e.g. "1.2.3.a"
  readonly description: string
  readonly unit: string           // unit of measure
  readonly quantity: Quantity      // the quantity
  readonly provenance: BOQItemProvenance
  /** If provenance='plan-measurement', the source measurement(s). */
  readonly sourceMeasurementIds: readonly string[]
}

/**
 * A BOQ — a collection of BOQItems representing scope structure for a project.
 */
export interface BOQ {
  readonly __brand: 'BOQ'
  readonly boqId: string
  readonly projectId: string
  readonly items: readonly BOQItem[]
}

export function boqItem(input: {
  itemId: string
  itemCode: string
  description: string
  unit: string
  quantity: Quantity
  provenance: BOQItemProvenance
  sourceMeasurementIds?: readonly string[]
}): BOQItem {
  if (!input.itemCode) throw new Error('BOQItem: itemCode required')
  if (!input.description) throw new Error('BOQItem: description required')
  return {
    __brand: 'BOQItem',
    ...input,
    sourceMeasurementIds: input.sourceMeasurementIds ?? [],
  } as BOQItem
}

export function boq(input: {
  boqId: string
  projectId: string
  items: readonly BOQItem[]
}): BOQ {
  if (!input.projectId) throw new Error('BOQ: projectId required')
  return {
    __brand: 'BOQ',
    boqId: input.boqId,
    projectId: input.projectId,
    items: input.items,
  } as BOQ
}
