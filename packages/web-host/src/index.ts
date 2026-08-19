/**
 * @contractor/web-host — thin HTTP host adapter for Contractor GenOffice.
 *
 * Wraps CoreApi.handle() with a Node http.createServer. Implements the
 * signed-cookie session (ADR-0008 D1) and the DEV-only auth boundary
 * (ADR-0008 D2). No business logic — pure transport.
 */

export {
  signSession, verifySession, sessionCookieHeader, clearSessionCookieHeader,
  readSessionCookie, validateSessionConfig, loadSessionConfigFromEnv, cookieName,
  type SessionPayload, type SessionConfig,
} from './session.js'
export { WebSessionResolver, type WebSessionResolverDeps } from './resolver.js'
export { startWebHost, type WebHostDeps } from './server.js'
