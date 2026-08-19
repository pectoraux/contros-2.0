/**
 * Commercial API routes — HTTP adapters for the 4 Commercial application
 * services (PlanMeasurement, BOQ, Estimate, Bid).
 *
 * Responsibilities (Phase 2B.3 §3, §7):
 *  - transport validation (payload shape, required fields, enum strings)
 *  - delegate to the application service (which owns business rules,
 *    authorization, transaction, audit)
 *  - map domain results to API responses via commercial-mappers
 *
 * The API does NOT:
 *  - calculate pricing (§12)
 *  - mutate repositories directly
 *  - access pg/PGlite
 *  - construct tenant identity from the request body (§5)
 *  - emit audit directly (§16)
 *  - BEGIN/COMMIT/ROLLBACK (§17 — the service owns the transaction)
 *
 * Path conventions (resource-oriented):
 *   POST   /projects/:projectId/measurements
 *   GET    /projects/:projectId/measurements
 *   GET    /measurements/:measurementId
 *   POST   /projects/:projectId/boqs
 *   GET    /projects/:projectId/boqs
 *   GET    /boqs/:boqId
 *   POST   /boqs/:boqId/items
 *   GET    /boqs/:boqId/items
 *   PATCH  /boq-items/:itemId/quantity
 *   POST   /projects/:projectId/estimates
 *   GET    /projects/:projectId/estimates
 *   GET    /estimates/:revisionId
 *   PATCH  /estimates/:revisionId
 *   POST   /estimates/:revisionId/finalize
 *   POST   /estimates/:revisionId/supersede
 *   GET    /estimates/:revisionId/replay
 *   POST   /projects/:projectId/bids
 *   GET    /projects/:projectId/bids
 *   GET    /bids/:bidId
 *   POST   /bids/:bidId/submit
 *   POST   /bids/:bidId/outcome
 *   POST   /bids/:bidId/withdraw
 */

import type { TenantContext } from '../domain/types.js'
import type { EstimateRevisionPayload } from '../domain/commercial/estimate-revision.js'
import type { PlanMeasurementService, BOQService, EstimateService, BidService } from '../service/index.js'
import type { ApiResponse } from './core-api.js'
import { ValidationError } from '../domain/errors.js'
import {
  mapEstimateRevision, mapEstimateReplay, mapBid, mapBOQ, mapBOQItem, mapPlanMeasurement,
} from './commercial-mappers.js'
import {
  estimateRevisionPayload,
} from '../domain/commercial/estimate-revision.js'
import { estimateLine } from '../domain/commercial/estimate-line.js'
import { moneyFromMinor } from '../domain/commercial/money.js'
import { quantity } from '../domain/commercial/quantity.js'
import { ratio } from '../domain/commercial/pricing.js'
import { currencyCode } from '../domain/commercial/currency.js'

/** The 4 Commercial application services the routes delegate to. */
export interface CommercialApiServices {
  measurements: PlanMeasurementService
  boqs: BOQService
  estimates: EstimateService
  bids: BidService
}

/**
 * Route a Commercial API request. Returns null if the path does not match a
 * Commercial route (so the caller can fall through to foundation routes or
 * a 404). Throws DomainError subclasses for validation/authorization/etc;
 * the caller (CoreApi.handle) maps these to HTTP status codes.
 */
export async function routeCommercial(
  segments: readonly string[],
  method: string,
  body: unknown,
  ctx: TenantContext,
  services: CommercialApiServices,
): Promise<ApiResponse | null> {
  // ── PlanMeasurement ───────────────────────────────────────────
  // POST/GET /projects/:projectId/measurements
  if (segments[0] === 'projects' && segments[2] === 'measurements') {
    const projectId = segments[1]!
    if (method === 'POST') {
      const b = asObject(body)
      const pm = await services.measurements.createMeasurement(ctx, projectId, {
        sourceArtifactId: asString(b, 'sourceArtifactId'),
        sourceArtifactHash: asString(b, 'sourceArtifactHash'),
        sheetId: asStringOrNull(b, 'sheetId'),
        sheetRevision: asStringOrNull(b, 'sheetRevision'),
        elementReference: asString(b, 'elementReference'),
        quantityValue: asNumber(b, 'quantityValue'),
        quantityUnit: asString(b, 'quantityUnit'),
        measurementMethod: asEnum(b, 'measurementMethod', ['manual-takeoff', 'auto-takeoff', 'ai-proposed', 'imported']),
        measurementBasis: asEnum(b, 'measurementBasis', ['count', 'length', 'area', 'volume', 'mass', 'time']),
        measurementEngineVersion: asString(b, 'measurementEngineVersion'),
      })
      return ok(mapPlanMeasurement(pm))
    }
    if (method === 'GET') {
      const list = await services.measurements.listMeasurements(ctx, projectId)
      return ok(list.map(mapPlanMeasurement))
    }
  }
  // GET /measurements/:measurementId
  if (segments[0] === 'measurements' && segments[1] && !segments[2]) {
    if (method === 'GET') {
      const pm = await services.measurements.getMeasurement(ctx, segments[1]!)
      return ok(mapPlanMeasurement(pm))
    }
  }

  // ── BOQ ───────────────────────────────────────────────────────
  // POST/GET /projects/:projectId/boqs
  if (segments[0] === 'projects' && segments[2] === 'boqs') {
    const projectId = segments[1]!
    if (method === 'POST') {
      const b = asObject(body)
      const boq = await services.boqs.createBOQ(ctx, projectId, asStringOrNull(b, 'name') ?? undefined)
      return ok(mapBOQ(boq))
    }
    if (method === 'GET') {
      const list = await services.boqs.listBOQs(ctx, projectId)
      return ok(list.map(mapBOQ))
    }
  }
  // GET /boqs/:boqId  +  POST /boqs/:boqId/items  +  GET /boqs/:boqId/items
  if (segments[0] === 'boqs' && segments[1]) {
    const boqId = segments[1]!
    if (method === 'GET' && !segments[2]) {
      const boq = await services.boqs.getBOQ(ctx, boqId)
      return ok(mapBOQ(boq))
    }
    if (method === 'POST' && segments[2] === 'items') {
      const b = asObject(body)
      const item = await services.boqs.addBOQItem(ctx, boqId, {
        itemCode: asString(b, 'itemCode'),
        description: asString(b, 'description'),
        unit: asString(b, 'unit'),
        quantityValue: asNumber(b, 'quantityValue'),
        quantityUnit: asString(b, 'quantityUnit'),
        provenance: asEnum(b, 'provenance', ['plan-measurement', 'imported', 'manual']),
        sourceMeasurementIds: asStringArray(b, 'sourceMeasurementIds'),
      })
      return ok(mapBOQItem(item))
    }
    if (method === 'GET' && segments[2] === 'items') {
      const items = await services.boqs.getBOQItems(ctx, boqId)
      return ok(items.map(mapBOQItem))
    }
  }
  // PATCH /boq-items/:itemId/quantity
  if (segments[0] === 'boq-items' && segments[1] && segments[2] === 'quantity' && !segments[3]) {
    if (method === 'PATCH') {
      const b = asObject(body)
      const updated = await services.boqs.updateBOQItemQuantity(
        ctx, segments[1]!,
        asNumber(b, 'quantityValue'),
        asString(b, 'quantityUnit'),
      )
      return ok({ updated })
    }
  }

  // ── Estimate ─────────────────────────────────────────────────
  // POST/GET /projects/:projectId/estimates
  if (segments[0] === 'projects' && segments[2] === 'estimates') {
    const projectId = segments[1]!
    if (method === 'POST') {
      const payload = parseEstimatePayload(asObject(body), projectId)
      const rev = await services.estimates.createEstimateDraft(ctx, projectId, payload)
      return ok(mapEstimateRevision(rev))
    }
    if (method === 'GET') {
      const list = await services.estimates.listEstimateRevisions(ctx, projectId)
      return ok(list.map(mapEstimateRevision))
    }
  }
  // /estimates/:revisionId/{GET, PATCH, finalize, supersede, replay}
  if (segments[0] === 'estimates' && segments[1]) {
    const revisionId = segments[1]!
    if (method === 'GET' && !segments[2]) {
      const rev = await services.estimates.getEstimateRevision(ctx, revisionId)
      return ok(mapEstimateRevision(rev))
    }
    if (method === 'PATCH' && !segments[2]) {
      // Reload to get the existing project id (payload.projectId must match)
      const existing = await services.estimates.getEstimateRevision(ctx, revisionId)
      const payload = parseEstimatePayload(asObject(body), existing.metadata.projectId)
      const updated = await services.estimates.updateEstimateDraft(ctx, revisionId, payload)
      return ok(mapEstimateRevision(updated))
    }
    if (method === 'POST' && segments[2] === 'finalize' && !segments[3]) {
      const finalized = await services.estimates.finalizeEstimate(ctx, revisionId)
      return ok(mapEstimateRevision(finalized))
    }
    if (method === 'POST' && segments[2] === 'supersede' && !segments[3]) {
      const superseded = await services.estimates.supersedeEstimate(ctx, revisionId)
      return ok(mapEstimateRevision(superseded))
    }
    if (method === 'GET' && segments[2] === 'replay' && !segments[3]) {
      const replay = await services.estimates.replayEstimate(ctx, revisionId)
      return ok(mapEstimateReplay(revisionId, replay))
    }
  }

  // ── Bid ──────────────────────────────────────────────────────
  // POST/GET /projects/:projectId/bids
  if (segments[0] === 'projects' && segments[2] === 'bids') {
    const projectId = segments[1]!
    if (method === 'POST') {
      const b = asObject(body)
      const bid = await services.bids.createBid(
        ctx, projectId,
        asString(b, 'estimateRevisionId'),
        parseMoney(b, 'finalPrice'),
        parseMoneyOrNull(b, 'directorAdjustment'),
        asStringOrNull(b, 'adjustmentRationale'),
      )
      return ok(mapBid(bid))
    }
    if (method === 'GET') {
      const list = await services.bids.listBids(ctx, projectId)
      return ok(list.map(mapBid))
    }
  }
  // /bids/:bidId/{GET, submit, outcome, withdraw}
  if (segments[0] === 'bids' && segments[1]) {
    const bidId = segments[1]!
    if (method === 'GET' && !segments[2]) {
      const bid = await services.bids.getBid(ctx, bidId)
      return ok(mapBid(bid))
    }
    if (method === 'POST' && segments[2] === 'submit' && !segments[3]) {
      const submitted = await services.bids.submitBid(ctx, bidId)
      return ok(mapBid(submitted))
    }
    if (method === 'POST' && segments[2] === 'outcome' && !segments[3]) {
      const b = asObject(body)
      const outcome = asEnum(b, 'outcome', ['won', 'lost'])
      const note = asStringOrNull(b, 'note') ?? undefined
      const updated = await services.bids.recordBidOutcome(ctx, bidId, outcome, note)
      return ok(mapBid(updated))
    }
    if (method === 'POST' && segments[2] === 'withdraw' && !segments[3]) {
      const withdrawn = await services.bids.withdrawBid(ctx, bidId)
      return ok(mapBid(withdrawn))
    }
  }

  return null
}

// ── Estimate payload parsing (transport validation → domain payload) ──────

function parseEstimatePayload(b: Record<string, unknown>, expectedProjectId: string): EstimateRevisionPayload {
  const projectId = asString(b, 'projectId')
  if (projectId !== expectedProjectId) {
    throw new ValidationError(`Payload projectId (${projectId}) does not match the route project (${expectedProjectId})`)
  }
  const currencyStr = asString(b, 'currency')
  const policyRaw = asObjectField(b, 'policy')
  const linesRaw = asArrayField(b, 'lines')
  return estimateRevisionPayload({
    projectId,
    currency: currencyCode(currencyStr),
    policy: {
      overheadPct: ratio(asNumber(policyRaw, 'overheadPct')),
      contingencyPct: ratio(asNumber(policyRaw, 'contingencyPct')),
      targetProfitMode: asEnum(policyRaw, 'targetProfitMode', ['markup', 'margin']),
      targetProfitRatio: ratio(asNumber(policyRaw, 'targetProfitRatio')),
    },
    lines: linesRaw.map((l, i) => {
      const lineObj = asObjectValue(l, `lines[${i}]`)
      return estimateLine({
        lineId: asString(lineObj, 'lineId'),
        boqItemId: asStringOrNull(lineObj, 'boqItemId'),
        description: asString(lineObj, 'description'),
        quantity: quantity(asNumber(lineObj, 'quantityValue'), asString(lineObj, 'quantityUnit')),
        costBasis: asEnum(lineObj, 'costBasis', ['unit-rate', 'lump-sum', 'provisional', 'scheduled']),
        rate: moneyFromMinor(asNumber(lineObj, 'rateMinor'), currencyStr),
        pricingStrategy: asEnum(lineObj, 'pricingStrategy', ['markup', 'margin']),
        pricingRatio: ratio(asNumber(lineObj, 'pricingRatio')),
      })
    }),
    note: asStringOrNull(b, 'note'),
    pricingAlgorithmVersion: asString(b, 'pricingAlgorithmVersion'),
  })
}

// ── Money parsing (finalPrice, directorAdjustment) ────────────────────────

function parseMoney(b: Record<string, unknown>, field: string) {
  const raw = b[field]
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object') throw new ValidationError(`'${field}' must be an object { amount, currency }`)
  const o = raw as Record<string, unknown>
  return moneyFromMinor(asNumber(o, 'amount'), asString(o, 'currency'))
}

function parseMoneyOrNull(b: Record<string, unknown>, field: string) {
  if (!(field in b) || b[field] === null || b[field] === undefined) return null
  return parseMoney(b, field)
}

// ── Transport validation helpers (throw ValidationError on bad shape) ───

function ok(body: unknown): ApiResponse {
  return { status: 200, body }
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object')
  }
  return body as Record<string, unknown>
}

function asObjectField(b: Record<string, unknown>, field: string): Record<string, unknown> {
  const v = b[field]
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new ValidationError(`Field '${field}' must be an object`)
  }
  return v as Record<string, unknown>
}

function asArrayField(b: Record<string, unknown>, field: string): unknown[] {
  const v = b[field]
  if (!Array.isArray(v)) throw new ValidationError(`Field '${field}' must be an array`)
  return v
}

function asObjectValue(v: unknown, ctx: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new ValidationError(`Field '${ctx}' must be an object`)
  }
  return v as Record<string, unknown>
}

function asString(b: Record<string, unknown>, field: string): string {
  const v = b[field]
  if (typeof v !== 'string' || v.length === 0) {
    throw new ValidationError(`Field '${field}' must be a non-empty string`)
  }
  return v
}

function asStringOrNull(b: Record<string, unknown>, field: string): string | null {
  const v = b[field]
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') throw new ValidationError(`Field '${field}' must be a string or null`)
  return v
}

function asStringArray(b: Record<string, unknown>, field: string): string[] {
  const v = b[field]
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new ValidationError(`Field '${field}' must be an array of strings`)
  return v.map((x, i) => {
    if (typeof x !== 'string') throw new ValidationError(`Field '${field}[${i}]' must be a string`)
    return x
  })
}

function asNumber(b: Record<string, unknown>, field: string): number {
  const v = b[field]
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ValidationError(`Field '${field}' must be a finite number`)
  }
  return v
}

function asEnum<T extends string>(b: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const v = b[field]
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new ValidationError(`Field '${field}' must be one of: ${allowed.join(', ')}`)
  }
  return v as T
}
