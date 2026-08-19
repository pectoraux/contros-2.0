/**
 * Session service — signed-cookie session for the browser.
 *
 * The session cookie carries { userId, selectedMembershipId, exp } HMAC-signed
 * with a server secret. The server re-validates the membership on every
 * request via the WebSessionResolver (see resolver.ts). The browser NEVER
 * sees tenantId in the cookie — the server derives it from the
 * selectedMembershipId.
 *
 * DEV-ONLY authentication (ADR-0008 Decision 2):
 *  - Enabled only when CONTRACTOR_DEV_AUTH=1 AND NODE_ENV !== 'production'.
 *  - The host refuses to start if CONTRACTOR_DEV_AUTH=1 AND NODE_ENV=production.
 *  - The dev-login endpoint requires a server-side development credential
 *    (CG_DEV_CREDENTIAL). The browser does NOT supply an arbitrary email.
 *  - The dev credential resolves to a known development user that must already
 *    exist in the database. No user is invented by the login call.
 *
 * NO password storage, NO password hashing, NO credential-reset flow.
 * Production auth is deferred to a real provider (ADR-0008 Decision 4).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export interface SessionPayload {
  readonly userId: string
  /** null until the user selects a tenant (multi-membership). */
  readonly selectedMembershipId: string | null
  readonly exp: number // epoch seconds
}

export interface SessionConfig {
  /** HMAC signing secret — from environment, never source. Min 32 bytes. */
  readonly sessionSecret: string
  /** Session lifetime in seconds. */
  readonly sessionTtlSeconds: number
  /** True only when CONTRACTOR_DEV_AUTH=1 AND NODE_ENV !== 'production'. */
  readonly devAuthEnabled: boolean
  /** Server-side dev credential — required when devAuthEnabled. */
  readonly devCredential: string | null
}

const COOKIE_NAME = 'cg_session'
const SIG_BYTES = 32

export function cookieName(): string {
  return COOKIE_NAME
}

/**
 * Sign a session payload with HMAC-SHA256. Returns a base64url string
 * `payload.signature`.
 */
export function signSession(payload: SessionPayload, secret: string): string {
  const payloadJson = JSON.stringify(payload)
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

/**
 * Verify a signed session string. Returns the payload if the signature is
 * valid and the session has not expired, else null. Uses timingSafeEqual to
 * resist timing attacks.
 */
export function verifySession(token: string | undefined, secret: string): SessionPayload | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url')
  // Constant-time compare
  const a = Buffer.from(sig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8')
    const payload = JSON.parse(payloadJson) as SessionPayload
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
    if (typeof payload.userId !== 'string' || payload.userId.length === 0) return null
    return payload
  } catch {
    return null
  }
}

/**
 * Build the Set-Cookie header value for a signed session.
 */
export function sessionCookieHeader(token: string, ttlSeconds: number, secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${ttlSeconds}`,
    'Path=/',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Build the Set-Cookie header to clear the session (logout).
 */
export function clearSessionCookieHeader(secure: boolean): string {
  const parts = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Strict', 'Max-Age=0', 'Path=/']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Extract the session cookie value from a Cookie header.
 */
export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
      return trimmed.slice(COOKIE_NAME.length + 1)
    }
  }
  return undefined
}

/**
 * Validate the session config at host startup. Throws if the secret is missing
 * or too short, or if DEV auth is enabled in production.
 */
export function validateSessionConfig(cfg: SessionConfig): void {
  if (!cfg.sessionSecret || cfg.sessionSecret.length < SIG_BYTES) {
    throw new Error(
      `CG_SESSION_SECRET must be set to at least ${SIG_BYTES} bytes. ` +
        'Refusing to start without a valid session secret.',
    )
  }
  if (cfg.devAuthEnabled && cfg.devCredential === null) {
    throw new Error(
      'DEV auth is enabled (CONTRACTOR_DEV_AUTH=1) but CG_DEV_CREDENTIAL is not set. ' +
        'Refusing to start without a dev credential.',
    )
  }
  // Structural guard: DEV auth in production is forbidden (ADR-0008 D2).
  if (cfg.devAuthEnabled && process.env.NODE_ENV === 'production') {
    throw new Error(
      'DEV auth (CONTRACTOR_DEV_AUTH=1) is forbidden in production (NODE_ENV=production). ' +
        'Refusing to start. Wire a real auth provider instead (ADR-0008 D4).',
    )
  }
}

/**
 * Load session config from environment. Throws on invalid configuration.
 */
export function loadSessionConfigFromEnv(): SessionConfig {
  const sessionSecret = process.env.CG_SESSION_SECRET ?? ''
  const devAuthEnabled = process.env.CONTRACTOR_DEV_AUTH === '1' && process.env.NODE_ENV !== 'production'
  const devCredential = process.env.CG_DEV_CREDENTIAL ?? null
  const sessionTtlSeconds = Number(process.env.CG_SESSION_TTL_SECONDS ?? 86400)
  const cfg: SessionConfig = { sessionSecret, sessionTtlSeconds, devAuthEnabled, devCredential }
  validateSessionConfig(cfg)
  return cfg
}
