/**
 * @contractor/web-host — thin HTTP host adapter for Contractor GenOffice.
 *
 * Wraps CoreApi.handle() with:
 *  - a Node http.createServer (dev server / standalone hosting)
 *  - a Vercel serverless function adapter (production — ADR-0009 D1)
 *  - signed-cookie session (ADR-0008 D1)
 *  - DEV-only auth boundary (ADR-0008 D2) + magic-link production auth (ADR-0009 D3)
 *
 * No business logic — pure transport.
 */

export {
  signSession, verifySession, sessionCookieHeader, clearSessionCookieHeader,
  readSessionCookie, validateSessionConfig, loadSessionConfigFromEnv, cookieName,
  type SessionPayload, type SessionConfig,
} from './session.js'
export { WebSessionResolver, type WebSessionResolverDeps } from './resolver.js'
export { startWebHost, type WebHostDeps } from './server.js'
export { MagicLinkAuthService, type MagicLinkConfig, type MagicLinkRequest, type MagicLinkVerifyResult } from './magic-link.js'
export { default as vercelHandler } from './vercel-handler.js'
