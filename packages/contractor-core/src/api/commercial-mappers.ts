/**
 * Commercial API response mappers — domain entity → API representation.
 *
 * The API MUST NOT leak raw repository rows or persistence internals. Each
 * domain entity is mapped to a stable API object with explicitly-named fields.
 * (Phase 2B.3 §8 — Response Contract.)
 *
 * These mappers perform NO business calculation. Derived values (totalCost,
 * profit, sellPrice, grossMargin) are only surfaced when supplied by the
 * application service (e.g. replayEstimate). The API never computes them.
 * (Phase 2B.3 §12.)
 */

import type { EstimateRevision, EstimateRevisionTotals } from '../domain/commercial/estimate-revision.js'
import type { EstimateReplayResult } from '../service/estimate.service.js'
import type { Bid } from '../domain/commercial/bid.js'
import type { BOQ, BOQItem } from '../domain/commercial/boq.js'
import type { PlanMeasurement } from '../domain/commercial/plan-measurement.js'
import type { Money } from '../domain/commercial/money.js'

/** Money → { amount (minor units), currency }. No decimal re-parsing. */
export function mapMoney(m: Money | null): { amount: number; currency: string } | null {
  if (!m) return null
  return { amount: m.amount, currency: m.currency }
}

/** EstimateRevision → API representation (metadata + payload, no derived totals). */
export function mapEstimateRevision(r: EstimateRevision) {
  return {
    revisionId: r.metadata.revisionId,
    tenantId: r.metadata.tenantId,
    projectId: r.metadata.projectId,
    authorityKind: r.metadata.authorityKind,
    revisionNumber: r.metadata.revisionNumber,
    status: r.metadata.status,
    createdBy: r.metadata.createdBy,
    createdAt: r.metadata.createdAt,
    finalizedAt: r.metadata.finalizedAt ?? null,
    algorithmVersion: r.metadata.algorithmVersion,
    contentHash: r.metadata.contentHash,
    payload: mapEstimatePayload(r.payload),
  }
}

function mapEstimatePayload(p: EstimateRevision['payload']) {
  return {
    projectId: p.projectId,
    currency: p.currency,
    policy: {
      overheadPct: p.policy.overheadPct,
      contingencyPct: p.policy.contingencyPct,
      targetProfitMode: p.policy.targetProfitMode,
      targetProfitRatio: p.policy.targetProfitRatio,
    },
    lines: p.lines.map((l) => ({
      lineId: l.lineId,
      boqItemId: l.boqItemId,
      description: l.description,
      quantity: { value: l.quantity.value, unit: l.quantity.unit },
      costBasis: l.costBasis,
      rate: mapMoney(l.rate),
      pricingStrategy: l.pricingStrategy,
      pricingRatio: l.pricingRatio,
    })),
    note: p.note,
    pricingAlgorithmVersion: p.pricingAlgorithmVersion,
  }
}

/** EstimateReplayResult → API representation (includes derived totals — supplied by the service). */
export function mapEstimateReplay(revisionId: string, replay: EstimateReplayResult) {
  return {
    revisionId,
    contentHashMatches: replay.contentHashMatches,
    storedHash: replay.storedHash,
    calculatedHash: replay.calculatedHash,
    totals: mapTotals(replay.totals),
  }
}

function mapTotals(t: EstimateRevisionTotals) {
  return {
    totalLineCost: mapMoney(t.totalLineCost),
    overhead: mapMoney(t.overhead),
    contingency: mapMoney(t.contingency),
    totalCost: mapMoney(t.totalCost),
    profit: mapMoney(t.profit),
    sellPrice: mapMoney(t.sellPrice),
    grossProfit: mapMoney(t.grossProfit),
    grossMargin: t.grossMargin,
  }
}

/** Bid → API representation. submittedAt/outcomeAt/outcomeNote surfaced (Me2 fix). */
export function mapBid(b: Bid) {
  return {
    bidId: b.bidId,
    projectId: b.projectId,
    estimateRevisionId: b.estimateRevisionId,
    estimateRevisionContentHash: b.estimateRevisionContentHash,
    status: b.status,
    finalPrice: mapMoney(b.finalPrice),
    directorAdjustment: mapMoney(b.directorAdjustment),
    adjustmentRationale: b.adjustmentRationale,
    submittedAt: b.submittedAt,
    outcomeAt: b.outcomeAt,
    outcomeNote: b.outcomeNote,
  }
}

/** BOQ → API representation. (The BOQ domain type carries boqId + projectId + items;
 *  the optional name is a persistence-level field, surfaced via getBOQ's item list.) */
export function mapBOQ(b: BOQ) {
  return {
    boqId: b.boqId,
    projectId: b.projectId,
  }
}

/** BOQItem → API representation. */
export function mapBOQItem(item: BOQItem) {
  return {
    itemId: item.itemId,
    itemCode: item.itemCode,
    description: item.description,
    unit: item.unit,
    quantity: { value: item.quantity.value, unit: item.quantity.unit },
    provenance: item.provenance,
    sourceMeasurementIds: item.sourceMeasurementIds,
  }
}

/** PlanMeasurement → API representation. NO pricing fields surfaced. */
export function mapPlanMeasurement(pm: PlanMeasurement) {
  return {
    measurementId: pm.measurementId,
    sourceArtifactId: pm.sourceArtifactId,
    sourceArtifactHash: pm.sourceArtifactHash,
    sheetId: pm.sheetId,
    sheetRevision: pm.sheetRevision,
    elementReference: pm.elementReference,
    quantity: { value: pm.quantity.value, unit: pm.quantity.unit },
    measurementMethod: pm.measurementMethod,
    measurementBasis: pm.measurementBasis,
    measurementEngineVersion: pm.measurementEngineVersion,
    actorId: pm.actorId,
    measuredAt: pm.measuredAt,
    provisional: pm.provisional,
  }
}
