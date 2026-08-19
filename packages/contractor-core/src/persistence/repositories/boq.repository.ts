/**
 * BOQ repository — tenant-scoped. Stores scope structure (NOT commercial authority).
 * Includes BOQItem management. (Phase 2B.1 §13, §16.)
 */

import type { DbClient, DbRow } from '../db-client.js'
import type { BOQ, BOQItem } from '../../domain/commercial/boq.js'
import type { BOQItemProvenance } from '../../domain/commercial/boq.js'

interface BOQRow extends DbRow {
  boq_id: string
  tenant_id: string
  project_id: string
  name: string | null
  created_at: Date
}

interface BOQItemRow extends DbRow {
  item_id: string
  boq_id: string
  tenant_id: string
  item_code: string
  description: string
  unit: string
  quantity_value: number
  quantity_unit: string
  provenance: string
  source_measurement_ids: string | null
  created_at: Date
}

function mapBOQRow(r: BOQRow): BOQ {
  return {
    __brand: 'BOQ',
    boqId: r.boq_id,
    projectId: r.project_id,
    items: [], // loaded separately via getItems
  }
}

function mapItemRow(r: BOQItemRow): BOQItem {
  let sourceIds: string[] = []
  if (r.source_measurement_ids) {
    try {
      const parsed = typeof r.source_measurement_ids === 'string'
        ? JSON.parse(r.source_measurement_ids)
        : r.source_measurement_ids
      if (Array.isArray(parsed)) sourceIds = parsed
    } catch { /* skip */ }
  }
  return {
    __brand: 'BOQItem',
    itemId: r.item_id,
    itemCode: r.item_code,
    description: r.description,
    unit: r.unit,
    quantity: {
      __brand: 'Quantity',
      value: Number(r.quantity_value),
      unit: r.quantity_unit,
    } as BOQItem['quantity'],
    provenance: r.provenance as BOQItemProvenance,
    sourceMeasurementIds: sourceIds,
  }
}

export class BOQRepository {
  constructor(private readonly db: DbClient) {}

  async create(boqId: string, tenantId: string, projectId: string, name?: string): Promise<BOQ> {
    const rows = await this.db.queryReturning<BOQRow>(
      `INSERT INTO boqs (boq_id, tenant_id, project_id, name) VALUES ($1, $2, $3, $4) RETURNING *`,
      [boqId, tenantId, projectId, name ?? null],
    )
    return mapBOQRow(rows[0]!)
  }

  async getById(boqId: string, tenantId: string): Promise<BOQ | null> {
    const rows = await this.db.query<BOQRow>(
      `SELECT * FROM boqs WHERE boq_id = $1 AND tenant_id = $2`, [boqId, tenantId],
    )
    if (!rows[0]) return null
    const items = await this.listItems(boqId, tenantId)
    return { ...mapBOQRow(rows[0]), items }
  }

  async listForProject(tenantId: string, projectId: string): Promise<BOQ[]> {
    const rows = await this.db.query<BOQRow>(
      `SELECT * FROM boqs WHERE tenant_id = $1 AND project_id = $2 ORDER BY created_at`, [tenantId, projectId],
    )
    const result: BOQ[] = []
    for (const r of rows) {
      const items = await this.listItems(r.boq_id, tenantId)
      result.push({ ...mapBOQRow(r), items })
    }
    return result
  }

  async addItem(item: BOQItem, boqId: string, tenantId: string): Promise<BOQItem> {
    const rows = await this.db.queryReturning<BOQItemRow>(
      `INSERT INTO boq_items (item_id, boq_id, tenant_id, item_code, description, unit, quantity_value, quantity_unit, provenance, source_measurement_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        item.itemId, boqId, tenantId, item.itemCode, item.description, item.unit,
        item.quantity.value, item.quantity.unit, item.provenance,
        item.sourceMeasurementIds.length > 0 ? JSON.stringify(item.sourceMeasurementIds) : null,
      ],
    )
    return mapItemRow(rows[0]!)
  }

  async listItems(boqId: string, tenantId: string): Promise<BOQItem[]> {
    const rows = await this.db.query<BOQItemRow>(
      `SELECT * FROM boq_items WHERE boq_id = $1 AND tenant_id = $2 ORDER BY item_code`, [boqId, tenantId],
    )
    return rows.map(mapItemRow)
  }

  async getItem(itemId: string, tenantId: string): Promise<BOQItem | null> {
    const rows = await this.db.query<BOQItemRow>(
      `SELECT * FROM boq_items WHERE item_id = $1 AND tenant_id = $2`, [itemId, tenantId],
    )
    return rows[0] ? mapItemRow(rows[0]) : null
  }

  async updateItemQuantity(itemId: string, tenantId: string, quantityValue: number, quantityUnit: string): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE boq_items SET quantity_value = $3, quantity_unit = $4 WHERE item_id = $1 AND tenant_id = $2`,
      [itemId, tenantId, quantityValue, quantityUnit],
    )
    return result.affectedRows > 0
  }
}
