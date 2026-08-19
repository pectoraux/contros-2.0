/**
 * Core API adapter — the boundary between clients (web/Electron) and
 * application services.
 *
 * Responsibilities (Phase 1 section 20):
 *  - authentication context extraction (from the session header)
 *  - request validation (zod)
 *  - tenant context establishment (server-side, from session — never from client)
 *  - calling application services
 *  - mapping results/errors to HTTP responses
 *
 * It does NOT implement business rules. It is a thin transport.
 *
 * Both the web client and the Electron main process call the SAME
 * application services through this adapter (or an equivalent).
 * (ADR-0001 Decision 4.)
 */

import type { IdentityService } from '../service/identity.service.js'
import type { OrganizationService } from '../service/organization.service.js'
import type { WorkspaceService } from '../service/workspace.service.js'
import type { ProjectService } from '../service/project.service.js'
import type { AuditService } from '../service/audit.service.js'
import type { RevisionService } from '../service/revision.service.js'
import type { PlanMeasurementService } from '../service/plan-measurement.service.js'
import type { BOQService } from '../service/boq.service.js'
import type { EstimateService } from '../service/estimate.service.js'
import type { BidService } from '../service/bid.service.js'
import type { TenantContext } from '../domain/types.js'
import type { DomainError } from '../domain/errors.js'
import { httpStatusForError, asDomainError } from '../domain/errors.js'
import { UnauthenticatedError } from '../domain/errors.js'
import { routeCommercial, type CommercialApiServices } from './commercial-routes.js'

export interface ApiRequest {
  method: string
  path: string
  headers: Record<string, string>
  body: unknown
}

export interface ApiResponse {
  status: number
  body: unknown
}

export interface ApiServices {
  identity: IdentityService
  organizations: OrganizationService
  workspaces: WorkspaceService
  projects: ProjectService
  audit: AuditService
  revisions: RevisionService
  // Phase 2B.3 — Commercial application services
  measurements: PlanMeasurementService
  boqs: BOQService
  estimates: EstimateService
  bids: BidService
}

export interface ApiSessionResolver {
  /**
   * Resolve the authenticated (provider, subject) + tenantId from a
   * session token. Returns null if unauthenticated.
   *
   * This is the ONLY way the API adapter learns the tenant — never from
   * the request body or URL. (Phase 1 section 6.)
   */
  resolveSession(token: string | undefined): Promise<{
    provider: string
    subject: string
    tenantId: string
  } | null>
}

export class CoreApi {
  constructor(
    private readonly services: ApiServices,
    private readonly sessionResolver: ApiSessionResolver,
  ) {}

  async handle(req: ApiRequest): Promise<ApiResponse> {
    try {
      // 1. Extract session token from Authorization header
      const authHeader = req.headers['authorization'] ?? ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
      const session = await this.sessionResolver.resolveSession(token)
      if (!session) {
        // Phase 2B.3: no session = UNAUTHENTICATED (401), not unauthorized (403).
        // (Authorization failure — wrong role/tenant — is a separate 403 condition
        // raised by the application service's requirePermission.)
        return errorResponse(new UnauthenticatedError())
      }

      // 2. Resolve the trusted TenantContext (server-side)
      const { ctx } = await this.services.identity.resolveTenantContext(
        session.provider,
        session.subject,
        session.tenantId,
      )

      // 3. Route to the application service
      return await this.route(req, ctx)
    } catch (e) {
      const de = asDomainError(e)
      if (de) return errorResponse(de)
      // Unexpected internal error — do not leak details
      return { status: 500, body: { error: 'internal_error' } }
    }
  }

  private async route(req: ApiRequest, ctx: TenantContext): Promise<ApiResponse> {
    const segments = req.path.split('/').filter(Boolean)

    // Phase 2B.3 — Commercial routes (estimates, bids, boqs, measurements,
    // and their nested sub-resources). routeCommercial returns null if the
    // path is not a Commercial route, falling through to foundation routes.
    const commercialServices: CommercialApiServices = {
      measurements: this.services.measurements,
      boqs: this.services.boqs,
      estimates: this.services.estimates,
      bids: this.services.bids,
    }
    const commercial = await routeCommercial(segments, req.method, req.body, ctx, commercialServices)
    if (commercial) return commercial

    const [resource, id] = segments
    switch (resource) {
      case 'workspaces':
        if (req.method === 'GET' && !id) return json(await this.services.workspaces.listWorkspaces(ctx))
        if (req.method === 'POST' && !id) return json(await this.services.workspaces.createWorkspace(ctx, asString(req.body, 'name')))
        if (req.method === 'GET' && id) return json(await this.services.workspaces.getWorkspace(ctx, id))
        break
      case 'projects':
        if (req.method === 'POST' && !id) {
          const b = asObject(req.body, ['workspaceId', 'name'])
          return json(await this.services.projects.createProject(ctx, b.workspaceId, b.name))
        }
        if (req.method === 'GET' && id) return json(await this.services.projects.getProject(ctx, id))
        if (req.method === 'GET' && !id) return json(await this.services.projects.listProjectsForTenant(ctx))
        if (req.method === 'GET' && id && req.path.endsWith('projects/' + id)) return json(await this.services.projects.getProject(ctx, id))
        break
      case 'audit':
        if (req.method === 'GET' && !id) return json(await this.services.audit.listForTenant(ctx))
        break
      case 'revisions':
        if (req.method === 'POST' && !id) {
          const b = asObject(req.body, ['projectId', 'authorityKind', 'algorithmVersion', 'contentHash'])
          return json(await this.services.revisions.createDraft(ctx, b.projectId, b.authorityKind, b.algorithmVersion, b.contentHash, null))
        }
        if (req.method === 'GET' && id) return json(await this.services.revisions.getById(ctx, id))
        if (req.method === 'POST' && id && req.path.endsWith('/finalize'))
          return json(await this.services.revisions.finalize(ctx, id))
        break
    }
    return { status: 404, body: { error: 'not_found' } }
  }
}

function json(body: unknown): ApiResponse {
  return { status: 200, body }
}

function errorResponse(e: DomainError, _fallbackMsg?: string): ApiResponse {
  return {
    status: httpStatusForError(e.kind),
    body: { error: e.kind, message: e.message, details: e.details },
  }
}

function asString(body: unknown, field: string): string {
  if (body && typeof body === 'object' && field in body) {
    const v = (body as Record<string, unknown>)[field]
    if (typeof v === 'string') return v
  }
  throw new Error(`validation: missing string field '${field}'`)
}

function asObject(body: unknown, fields: string[]): Record<string, string> {
  if (!body || typeof body !== 'object') throw new Error('validation: body is not an object')
  const obj = body as Record<string, unknown>
  const result: Record<string, string> = {}
  for (const f of fields) {
    const v = obj[f]
    if (typeof v !== 'string') throw new Error(`validation: missing string field '${f}'`)
    result[f] = v
  }
  return result
}
