/**
 * HTTP host adapter — thin Node `http.createServer` wrapping `CoreApi.handle()`.
 *
 * Responsibilities (ADR-0008, Phase 2C.1):
 *  - parse HTTP requests → ApiRequest
 *  - route /api/auth/* to the auth endpoints (dev-login, memberships, select-tenant, logout, dev-mode)
 *  - route /api/* to CoreApi.handle() (passing the Cookie header as the session "token")
 *  - write ApiResponse → HTTP response
 *  - serve the built browser bundle from apps/web/dist for non-/api routes (production)
 *
 * The host does NO business logic, NO SQL, NO pricing, NO audit, NO tenant resolution.
 * It is a transport adapter. Tenant resolution happens inside WebSessionResolver →
 * IdentityService → TenantContext (the frozen path).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { CoreApi, ApiRequest, ApiServices, ApiResponse } from '@contractor/core/api'
import type { UserRepository, MembershipRepository, OrganizationRepository } from '@contractor/core/persistence'
import type { SessionConfig } from './session.js'
import {
  signSession, sessionCookieHeader, clearSessionCookieHeader, readSessionCookie, verifySession,
} from './session.js'
import type { WebSessionResolver } from './resolver.js'

export interface WebHostDeps {
  readonly coreApi: CoreApi
  readonly resolver: WebSessionResolver
  readonly users: UserRepository
  readonly memberships: MembershipRepository
  readonly organizations: OrganizationRepository
  readonly config: SessionConfig
  /** Absolute path to the built browser bundle dir (apps/web/dist). Null in dev (Vite serves). */
  readonly staticDir: string | null
  readonly secure: boolean // true when served over HTTPS (production)
}

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

export function startWebHost(deps: WebHostDeps, port: number): ReturnType<typeof createServer> {
  const server = createServer((req, res) => handleRequest(req, res, deps))
  server.listen(port)
  return server
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, deps: WebHostDeps): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = req.method ?? 'GET'

    // Auth routes (not delegated to CoreApi — these establish the session)
    if (path === '/api/auth/dev-mode' && method === 'GET') {
      return sendJson(res, 200, { devAuth: deps.config.devAuthEnabled })
    }
    if (path === '/api/auth/dev-login' && method === 'POST') {
      return handleDevLogin(req, res, deps)
    }
    if (path === '/api/auth/memberships' && method === 'GET') {
      return handleListMemberships(req, res, deps)
    }
    if (path === '/api/auth/select-tenant' && method === 'POST') {
      return handleSelectTenant(req, res, deps)
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      res.setHeader('Set-Cookie', clearSessionCookieHeader(deps.secure))
      return sendJson(res, 200, { ok: true })
    }
    if (path === '/api/auth/session' && method === 'GET') {
      return handleSession(req, res, deps)
    }

    // Core API routes — delegate to CoreApi.handle()
    if (path.startsWith('/api/')) {
      let body: unknown
      try {
        body = method === 'GET' || method === 'HEAD' ? null : await readJsonBody(req)
      } catch (e) {
        // Malformed JSON / oversized payload → 400 (validation), not 500.
        const msg = e instanceof Error ? e.message : 'invalid_body'
        if (msg === 'invalid_json' || msg === 'payload_too_large') {
          return sendJson(res, 400, { error: 'validation', message: msg === 'payload_too_large' ? 'Payload too large' : 'Invalid JSON' })
        }
        return sendJson(res, 400, { error: 'validation', message: 'Invalid request body' })
      }
      const cookieHeader = req.headers.cookie
      const apiReq: ApiRequest = {
        method,
        path: path.slice('/api'.length), // CoreApi routes are relative (e.g. "/projects/x/estimates")
        headers: { authorization: `Bearer ${cookieHeader ?? ''}` }, // CoreApi reads Bearer token; we pass the cookie
        body,
      }
      const apiRes = await deps.coreApi.handle(apiReq)
      return sendApiResponse(res, apiRes, deps)
    }

    // Static file serving (production — built browser bundle)
    if (deps.staticDir) {
      return serveStatic(req, res, deps)
    }

    // Dev mode — Vite serves the browser; the host only handles /api/*
    return sendJson(res, 404, { error: 'not_found', message: 'Not found' })
  } catch (e) {
    // Never leak internal details
    return sendJson(res, 500, { error: 'internal_error', message: 'Internal server error' })
  }
}

// ── Auth route handlers ────────────────────────────────────────────────────

async function handleDevLogin(req: IncomingMessage, res: ServerResponse, deps: WebHostDeps): Promise<void> {
  if (!deps.config.devAuthEnabled) {
    return sendJson(res, 404, { error: 'not_found', message: 'Dev auth is not enabled' })
  }
  const body = await readJsonBody(req)
  if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'validation', message: 'Invalid body' })
  const credential = (body as Record<string, unknown>).credential
  if (typeof credential !== 'string' || credential.length === 0) {
    return sendJson(res, 400, { error: 'validation', message: 'credential required' })
  }
  // The dev credential must equal the server-side secret.
  if (credential !== deps.config.devCredential) {
    return sendJson(res, 401, { error: 'unauthenticated', message: 'Invalid dev credential' })
  }
  // Resolve the dev user — they must already exist in the DB.
  // The dev user is identified by a known email configured via CG_DEV_USER_EMAIL.
  const devUserEmail = process.env.CG_DEV_USER_EMAIL
  if (!devUserEmail) {
    return sendJson(res, 500, { error: 'internal_error', message: 'Dev user email not configured' })
  }
  const user = await deps.users.getByEmail(devUserEmail)
  if (!user || user.status !== 'active') {
    return sendJson(res, 401, { error: 'unauthenticated', message: 'Dev user not found or inactive' })
  }
  // Ensure an auth binding exists for the web provider (idempotent) so that
  // IdentityService.resolveTenantContext('web', userId, tenantId) can resolve the user.
  // The binding's subject is the userId (the signed-cookie carries userId).
  const existingBinding = await deps.users.getBindingBySubject('web', user.id)
  if (!existingBinding) {
    await deps.users.createBinding({
      id: 'dev-binding-' + user.id, userId: user.id, provider: 'web', subject: user.id,
      createdAt: new Date().toISOString(), lastUsedAt: null,
    })
  }
  // Issue a session cookie with NO selectedMembershipId yet (tenant selection follows).
  const exp = Math.floor(Date.now() / 1000) + deps.config.sessionTtlSeconds
  const token = signSession(
    { userId: user.id, selectedMembershipId: null, exp },
    deps.config.sessionSecret,
  )
  res.setHeader('Set-Cookie', sessionCookieHeader(token, deps.config.sessionTtlSeconds, deps.secure))
  return sendJson(res, 200, { userId: user.id, email: user.email, displayName: user.displayName })
}

async function handleListMemberships(req: IncomingMessage, res: ServerResponse, deps: WebHostDeps): Promise<void> {
  const payload = deps.resolver.resolvePayload(req.headers.cookie)
  if (!payload) return sendJson(res, 401, { error: 'unauthenticated', message: 'Not authenticated' })
  const user = await deps.users.getById(payload.userId)
  if (!user || user.status !== 'active') {
    return sendJson(res, 401, { error: 'unauthenticated', message: 'User not found or inactive' })
  }
  const memberships = await deps.memberships.listTenantsForUser(payload.userId)
  // Resolve organization names (org.id == org.tenant_id, so getById(orgId, orgId) works)
  const result = []
  for (const m of memberships) {
    const org = await deps.organizations.getById(m.organizationId, m.organizationId)
    result.push({
      membershipId: m.id,
      organizationId: m.organizationId,
      organizationName: org?.name ?? m.organizationId,
      role: m.role,
    })
  }
  return sendJson(res, 200, { memberships: result })
}

async function handleSelectTenant(req: IncomingMessage, res: ServerResponse, deps: WebHostDeps): Promise<void> {
  const payload = deps.resolver.resolvePayload(req.headers.cookie)
  if (!payload) return sendJson(res, 401, { error: 'unauthenticated', message: 'Not authenticated' })
  const body = await readJsonBody(req)
  if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'validation', message: 'Invalid body' })
  const membershipId = (body as Record<string, unknown>).membershipId
  if (typeof membershipId !== 'string' || membershipId.length === 0) {
    return sendJson(res, 400, { error: 'validation', message: 'membershipId required' })
  }
  // Validate the membership belongs to the authenticated user + is active.
  const userMemberships = await deps.memberships.listTenantsForUser(payload.userId)
  const found = userMemberships.find((m) => m.id === membershipId)
  if (!found) {
    return sendJson(res, 403, { error: 'forbidden', message: 'Membership not found or not yours' })
  }
  // Reissue the cookie with the selectedMembershipId set.
  const exp = Math.floor(Date.now() / 1000) + deps.config.sessionTtlSeconds
  const token = signSession(
    { userId: payload.userId, selectedMembershipId: membershipId, exp },
    deps.config.sessionSecret,
  )
  res.setHeader('Set-Cookie', sessionCookieHeader(token, deps.config.sessionTtlSeconds, deps.secure))
  return sendJson(res, 200, {
    tenantId: found.organizationId,
    membershipId: found.id,
    role: found.role,
  })
}

async function handleSession(req: IncomingMessage, res: ServerResponse, deps: WebHostDeps): Promise<void> {
  const payload = deps.resolver.resolvePayload(req.headers.cookie)
  if (!payload) return sendJson(res, 200, { authenticated: false })
  const user = await deps.users.getById(payload.userId)
  if (!user || user.status !== 'active') {
    return sendJson(res, 200, { authenticated: false })
  }
  return sendJson(res, 200, {
    authenticated: true,
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    tenantSelected: payload.selectedMembershipId !== null,
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  // Cap body size to 1MB to resist oversized payloads (Phase 2C.1 §19/§25).
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > 1024 * 1024) {
      throw new Error('payload_too_large')
    }
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return null
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('invalid_json')
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': JSON_CONTENT_TYPE, 'Content-Length': Buffer.byteLength(json) })
  res.end(json)
}

function sendApiResponse(res: ServerResponse, apiRes: ApiResponse, _deps: WebHostDeps): void {
  // Forward the CoreApi response body + status. CoreApi already guarantees
  // the { error, message, details } envelope with no internal leakage.
  const body = typeof apiRes.body === 'string' ? apiRes.body : JSON.stringify(apiRes.body)
  const headers: Record<string, string> = {
    'Content-Type': typeof apiRes.body === 'string' ? 'text/plain; charset=utf-8' : JSON_CONTENT_TYPE,
    'Content-Length': String(Buffer.byteLength(body)),
  }
  res.writeHead(apiRes.status, headers)
  res.end(body)
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, deps: WebHostDeps): Promise<void> {
  if (!deps.staticDir) return sendJson(res, 404, { error: 'not_found' })
  const url = new URL(req.url ?? '/', 'http://localhost')
  let path = normalize(url.pathname)
  if (path === '/' || path === '') path = '/index.html'
  // Prevent path traversal
  const full = join(deps.staticDir, path)
  if (!full.startsWith(deps.staticDir)) return sendJson(res, 403, { error: 'forbidden' })
  if (!existsSync(full)) {
    // SPA fallback — serve index.html for client-side routing
    const index = join(deps.staticDir, 'index.html')
    if (existsSync(index)) {
      const html = await readFile(index)
      res.writeHead(200, { 'Content-Type': MIME['.html']! })
      res.end(html)
      return
    }
    return sendJson(res, 404, { error: 'not_found' })
  }
  const ext = extname(full)
  const mime = MIME[ext] ?? 'application/octet-stream'
  const content = await readFile(full)
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length })
  res.end(content)
}
