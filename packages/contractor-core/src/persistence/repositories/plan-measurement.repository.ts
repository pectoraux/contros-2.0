/**
 * PlanMeasurement repository — tenant-scoped.
 *
 * Stores measurement evidence (NOT commercial authority). Every query
 * enforces tenant scope. (Phase 2B.1 §12, §16.)
 */

import type { DbClient, DbRow } from '../db-client.js'
import type { PlanMeasurement } from '../../domain/commercial/plan-measurement.js'
import type { MeasurementMethod, MeasurementBasis } from '../../domain/commercial/plan-measurement.js'

interface PlanMeasurementRow extends DbRow {
  measurement_id: string
  tenant_id: string
  project_id: string
  source_artifact_id: string
  source_artifact_hash: string
  sheet_id: string | null
  sheet_revision: string | null
  element_reference: string
  quantity_value: number
  quantity_unit: string
  measurement_method: string
  measurement_basis: string
  measurement_engine_version: string
  actor_id: string
  measured_at: Date
  provisional: boolean
  created_at: Date
}

function mapRow(r: PlanMeasurementRow): PlanMeasurement {
  return {
    __brand: 'PlanMeasurement',
    measurementId: r.measurement_id,
    sourceArtifactId: r.source_artifact_id,
    sourceArtifactHash: r.source_artifact_hash,
    sheetId: r.sheet_id,
    sheetRevision: r.sheet_revision,
    elementReference: r.element_reference,
    quantity: {
      __brand: 'Quantity',
      value: Number(r.quantity_value),
      unit: r.quantity_unit,
    } as PlanMeasurement['quantity'],
    measurementMethod: r.measurement_method as MeasurementMethod,
    measurementBasis: r.measurement_basis as MeasurementBasis,
    measurementEngineVersion: r.measurement_engine_version,
    actorId: r.actor_id,
    measuredAt: r.measured_at instanceof Date ? r.measured_at.toISOString() : String(r.measured_at),
    provisional: r.provisional,
  }
}

export class PlanMeasurementRepository {
  constructor(private readonly db: DbClient) {}

  async create(pm: PlanMeasurement, tenantId: string, projectId: string): Promise<PlanMeasurement> {
    const rows = await this.db.queryReturning<PlanMeasurementRow>(
      `INSERT INTO plan_measurements (measurement_id, tenant_id, project_id, source_artifact_id, source_artifact_hash, sheet_id, sheet_revision, element_reference, quantity_value, quantity_unit, measurement_method, measurement_basis, measurement_engine_version, actor_id, measured_at, provisional)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        pm.measurementId, tenantId, projectId,
        pm.sourceArtifactId, pm.sourceArtifactHash, pm.sheetId, pm.sheetRevision,
        pm.elementReference, pm.quantity.value, pm.quantity.unit,
        pm.measurementMethod, pm.measurementBasis, pm.measurementEngineVersion,
        pm.actorId, pm.measuredAt, pm.provisional,
      ],
    )
    return mapRow(rows[0]!)
  }

  async getById(measurementId: string, tenantId: string): Promise<PlanMeasurement | null> {
    const rows = await this.db.query<PlanMeasurementRow>(
      `SELECT * FROM plan_measurements WHERE measurement_id = $1 AND tenant_id = $2`,
      [measurementId, tenantId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  async listForProject(tenantId: string, projectId: string): Promise<PlanMeasurement[]> {
    const rows = await this.db.query<PlanMeasurementRow>(
      `SELECT * FROM plan_measurements WHERE tenant_id = $1 AND project_id = $2 ORDER BY measured_at DESC`,
      [tenantId, projectId],
    )
    return rows.map(mapRow)
  }
}
