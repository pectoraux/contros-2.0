/**
 * Typed API client — thin fetch wrapper for the Contractor GenOffice Core API.
 *
 * Responsibilities (Phase 2C.1 §16):
 *  - use fetch with credentials/cookies
 *  - decode the { error, message, details } envelope
 *  - expose typed errors
 *  - NOT contain business rules
 *  - NOT contain pricing formulas
 *  - NOT accept caller-selected tenant authority
 */

export interface ApiError {
  readonly status: number
  readonly error: string // the DomainErrorKind: 'unauthenticated' | 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'immutable_revision_mutation' | 'immutable_audit_mutation' | 'internal'
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly error: string
  readonly details?: Readonly<Record<string, unknown>>
  constructor(e: ApiError) {
    super(e.message)
    this.name = 'ApiRequestError'
    this.status = e.status
    this.error = e.error
    if (e.details) this.details = e.details
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin', // send the session cookie
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null
  } catch {
    throw new ApiRequestError({ status: res.status, error: 'internal', message: 'Invalid JSON response' })
  }
  if (!res.ok) {
    const err = parsed as { error?: string; message?: string; details?: Record<string, unknown> } | null
    throw new ApiRequestError({
      status: res.status,
      error: err?.error ?? 'internal',
      message: err?.message ?? `Request failed (${res.status})`,
      details: err?.details,
    })
  }
  return parsed as T
}

// ── Auth ────────────────────────────────────────────────────────────────────

export interface DevModeInfo { devAuth: boolean }
export interface SessionInfo {
  authenticated: boolean
  userId?: string
  email?: string | null
  displayName?: string | null
  tenantSelected?: boolean
}
export interface LoginResult { userId: string; email: string | null; displayName: string | null }
export interface MembershipChoice {
  membershipId: string
  organizationId: string
  organizationName: string
  role: string
}
export interface TenantSelectionResult { tenantId: string; membershipId: string; role: string }

export const authApi = {
  devMode: () => request<DevModeInfo>('GET', '/auth/dev-mode'),
  session: () => request<SessionInfo>('GET', '/auth/session'),
  devLogin: (credential: string) => request<LoginResult>('POST', '/auth/dev-login', { credential }),
  passwordLogin: (email: string, password: string) =>
    request<{ userId: string }>('POST', '/auth/password-login', { email, password }),
  signup: (email: string, displayName?: string) =>
    request<{ id: string; email: string; status: string; message: string }>('POST', '/auth/signup', { email, displayName: displayName ?? null }),
  demoLogin: (role: 'owner' | 'member' | 'viewer') =>
    request<{ userId: string; role: string }>('POST', '/auth/demo-login', { role }),
  listWaitlist: () =>
    request<{ entries: Array<{ id: string; email: string; status: string; createdAt: string; displayName: string | null }> }>('GET', '/auth/waitlist'),
  approveWaitlist: (waitlistId: string, password: string) =>
    request<{ userId: string; email: string; message: string }>('POST', '/auth/waitlist', { waitlistId, password }),
  memberships: () => request<{ memberships: MembershipChoice[] }>('GET', '/auth/memberships'),
  selectTenant: (membershipId: string) =>
    request<TenantSelectionResult>('POST', '/auth/select-tenant', { membershipId }),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),
}

// ── Projects ────────────────────────────────────────────────────────────────

export interface Project {
  id: string
  tenantId: string
  workspaceId: string
  name: string
  status: string
  createdAt: string
}

export const projectsApi = {
  list: () => request<Project[]>('GET', '/projects'),
  create: (workspaceId: string, name: string) =>
    request<Project>('POST', '/projects', { workspaceId, name }),
}

// ── Workspaces ──────────────────────────────────────────────────────────────

export interface Workspace { id: string; name: string; tenantId: string }
export const workspacesApi = {
  list: () => request<Workspace[]>('GET', '/workspaces'),
}

// ── BOQ ──────────────────────────────────────────────────────────────────────

export interface BOQ { boqId: string; projectId: string }
export interface BOQItem {
  itemId: string
  itemCode: string
  description: string
  unit: string
  quantity: { value: number; unit: string }
  provenance: string
  sourceMeasurementIds: string[]
}

export const boqApi = {
  listForProject: (projectId: string) => request<BOQ[]>(`GET`, `/projects/${projectId}/boqs`),
  create: (projectId: string, name?: string) =>
    request<BOQ>('POST', `/projects/${projectId}/boqs`, { name: name ?? null }),
  get: (boqId: string) => request<BOQ>('GET', `/boqs/${boqId}`),
  listItems: (boqId: string) => request<BOQItem[]>('GET', `/boqs/${boqId}/items`),
  addItem: (boqId: string, input: {
    itemCode: string; description: string; unit: string;
    quantityValue: number; quantityUnit: string; provenance: string;
  }) => request<BOQItem>('POST', `/boqs/${boqId}/items`, input),
  updateQuantity: (itemId: string, quantityValue: number, quantityUnit: string) =>
    request<{ updated: boolean }>('PATCH', `/boq-items/${itemId}/quantity`, { quantityValue, quantityUnit }),
}

// ── Estimates ──────────────────────────────────────────────────────────────────

export interface EstimateLine {
  lineId: string
  boqItemId: string | null
  description: string
  quantity: { value: number; unit: string }
  costBasis: string
  rate: { amount: number; currency: string } | null
  pricingStrategy: string
  pricingRatio: number
}
export interface EstimatePolicy {
  overheadPct: number
  contingencyPct: number
  targetProfitMode: string
  targetProfitRatio: number
}
export interface EstimatePayload {
  projectId: string
  currency: string
  policy: EstimatePolicy
  lines: EstimateLine[]
  note: string | null
  pricingAlgorithmVersion: string
}
export interface EstimateRevision {
  revisionId: string
  tenantId: string
  projectId: string
  authorityKind: string
  revisionNumber: number
  status: string
  createdBy: string
  createdAt: string
  finalizedAt: string | null
  algorithmVersion: string
  contentHash: string
  payload: EstimatePayload
}
export interface EstimateTotals {
  totalLineCost: { amount: number; currency: string }
  overhead: { amount: number; currency: string }
  contingency: { amount: number; currency: string }
  totalCost: { amount: number; currency: string }
  profit: { amount: number; currency: string }
  sellPrice: { amount: number; currency: string }
  grossProfit: { amount: number; currency: string }
  grossMargin: number
}
export interface EstimateReplay {
  revisionId: string
  contentHashMatches: boolean
  storedHash: string
  calculatedHash: string
  totals: EstimateTotals
}

// Build the estimate-payload shape expected by the API (transport validation).
export function buildEstimatePayload(input: {
  projectId: string
  currency: string
  overheadPct: number
  contingencyPct: number
  targetProfitMode: 'markup' | 'margin'
  targetProfitRatio: number
  lines: Array<{
    lineId: string
    description: string
    quantityValue: number
    quantityUnit: string
    rateMinor: number
    costBasis: string
    pricingStrategy: string
    pricingRatio: number
  }>
  pricingAlgorithmVersion: string
}): EstimatePayload {
  return {
    projectId: input.projectId,
    currency: input.currency,
    policy: {
      overheadPct: input.overheadPct,
      contingencyPct: input.contingencyPct,
      targetProfitMode: input.targetProfitMode,
      targetProfitRatio: input.targetProfitRatio,
    },
    lines: input.lines.map((l) => ({
      lineId: l.lineId,
      boqItemId: null,
      description: l.description,
      quantity: { value: l.quantityValue, unit: l.quantityUnit },
      costBasis: l.costBasis,
      rate: { amount: l.rateMinor, currency: input.currency },
      pricingStrategy: l.pricingStrategy,
      pricingRatio: l.pricingRatio,
    })),
    note: null,
    pricingAlgorithmVersion: input.pricingAlgorithmVersion,
  }
}

export const estimateApi = {
  listForProject: (projectId: string) =>
    request<EstimateRevision[]>('GET', `/projects/${projectId}/estimates`),
  create: (projectId: string, payload: EstimatePayload) =>
    request<EstimateRevision>('POST', `/projects/${projectId}/estimates`, payload),
  get: (revisionId: string) =>
    request<EstimateRevision>('GET', `/estimates/${revisionId}`),
  update: (revisionId: string, payload: EstimatePayload) =>
    request<EstimateRevision>('PATCH', `/estimates/${revisionId}`, payload),
  finalize: (revisionId: string) =>
    request<EstimateRevision>('POST', `/estimates/${revisionId}/finalize`),
  supersede: (revisionId: string) =>
    request<EstimateRevision>('POST', `/estimates/${revisionId}/supersede`),
  replay: (revisionId: string) =>
    request<EstimateReplay>('GET', `/estimates/${revisionId}/replay`),
}

// ── Bids ──────────────────────────────────────────────────────────────────────

export interface Bid {
  bidId: string
  projectId: string
  estimateRevisionId: string
  estimateRevisionContentHash: string
  status: string
  finalPrice: { amount: number; currency: string } | null
  directorAdjustment: { amount: number; currency: string } | null
  adjustmentRationale: string | null
  submittedAt: string | null
  outcomeAt: string | null
  outcomeNote: string | null
}

export const bidApi = {
  listForProject: (projectId: string) =>
    request<Bid[]>('GET', `/projects/${projectId}/bids`),
  create: (projectId: string, input: {
    estimateRevisionId: string
    finalPrice: { amount: number; currency: string } | null
    directorAdjustment?: { amount: number; currency: string } | null
    adjustmentRationale?: string | null
  }) => request<Bid>('POST', `/projects/${projectId}/bids`, input),
  get: (bidId: string) => request<Bid>('GET', `/bids/${bidId}`),
  submit: (bidId: string) => request<Bid>('POST', `/bids/${bidId}/submit`),
  recordOutcome: (bidId: string, outcome: 'won' | 'lost', note?: string) =>
    request<Bid>('POST', `/bids/${bidId}/outcome`, { outcome, note: note ?? null }),
  withdraw: (bidId: string) => request<Bid>('POST', `/bids/${bidId}/withdraw`),
}
