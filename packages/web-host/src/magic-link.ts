/**
 * Magic-link auth service — passwordless email authentication (ADR-0009 D3).
 *
 * Flow:
 *  1. requestLink(email) — generate a single-use HMAC-signed token, store its
 *     SHA-256 hash in the magic_links table, and return the raw token + the
 *     link URL. The caller (host) is responsible for delivering the link
 *     (email for production; console.log for dev).
 *  2. verifyLink(rawToken) — hash the token, find the valid (unused, non-expired)
 *     record, consume it (single-use), resolve-or-create the User +
 *     AuthProviderBinding (provider='email', subject=email), and return the
 *     userId. The caller (host) issues the signed session cookie.
 *
 * NO password storage. NO password hashing. The raw token is never stored —
 * only its SHA-256 hash. Tokens are short-lived (default 15 min) and
 * single-use (enforced atomically via the consume UPDATE).
 */

import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { UserRepository } from '@contractor/core/persistence'
import type { MagicLinkRepository } from '@contractor/core/persistence'
import { entityId, ID_PREFIX } from '@contractor/core/domain'

export interface MagicLinkConfig {
  /** HMAC secret for signing tokens — from environment, min 32 bytes. */
  readonly linkSecret: string
  /** Token lifetime in seconds (default 900 = 15 min). */
  readonly linkTtlSeconds: number
  /** The base URL of the deployed app (e.g. https://app.example.com) — for link generation. */
  readonly appBaseUrl: string
}

export interface MagicLinkRequest {
  readonly token: string       // the raw HMAC-signed token to deliver
  readonly linkUrl: string     // the full verify URL
  readonly email: string
}

export interface MagicLinkVerifyResult {
  readonly userId: string
  readonly email: string
  readonly isNewUser: boolean   // true if a new User + binding was created
}

const TOKEN_BYTES = 32

export class MagicLinkAuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly magicLinks: MagicLinkRepository,
    private readonly config: MagicLinkConfig,
  ) {}

  /**
   * Step 1: generate + store a magic-link token for the given email.
   * Returns the raw token + link URL. The caller delivers the link.
   */
  async requestLink(email: string): Promise<MagicLinkRequest> {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('valid email required')
    }
    // Generate a random token + HMAC-sign it.
    const raw = randomBytes(TOKEN_BYTES).toString('base64url')
    const signed = `${raw}.${createHmac('sha256', this.config.linkSecret).update(raw).digest('base64url')}`
    // Store the SHA-256 hash (never the raw token).
    const tokenHash = createHash('sha256').update(signed).digest('hex')
    const now = Date.now()
    const expiresAt = new Date(now + this.config.linkTtlSeconds * 1000).toISOString()
    await this.magicLinks.create(tokenHash, email.toLowerCase(), expiresAt, new Date(now).toISOString())
    const linkUrl = `${this.config.appBaseUrl}/api/auth/verify?token=${encodeURIComponent(signed)}`
    return { token: signed, linkUrl, email }
  }

  /**
   * Step 2: verify a magic-link token. Consumes it (single-use), resolves or
   * creates the User + AuthProviderBinding, returns the userId. The caller
   * issues the session cookie.
   */
  async verifyLink(rawToken: string): Promise<MagicLinkVerifyResult> {
    // Recompute the hash to look up the stored record.
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    // Find a valid (unused, non-expired) link.
    const link = await this.magicLinks.findValid(tokenHash)
    if (!link) {
      throw new Error('invalid_or_expired_token')
    }
    // Consume it (single-use, race-safe — the UPDATE only affects rows with used_at IS NULL).
    const consumed = await this.magicLinks.consume(tokenHash)
    if (!consumed) {
      // Race: another request consumed it first.
      throw new Error('token_already_used')
    }
    // Resolve or create the User + AuthProviderBinding (provider='email', subject=email).
    const email = link.email
    let isNewUser = false
    let userId: string
    const existingBinding = await this.users.getBindingBySubject('email', email)
    if (existingBinding) {
      const user = await this.users.getById(existingBinding.userId)
      if (!user || user.status !== 'active') {
        throw new Error('user_inactive')
      }
      userId = user.id
    } else {
      // Create a new user + binding. The new user has NO memberships yet —
      // an admin must add them to an org, OR the first-deployment bootstrap
      // creates the initial org/membership (deploy script concern).
      userId = entityId(ID_PREFIX.user)
      await this.users.create({
        id: userId, email, displayName: email.split('@')[0] ?? email,
        status: 'active', createdAt: new Date().toISOString(),
      })
      await this.users.createBinding({
        id: entityId(ID_PREFIX.authBinding), userId, provider: 'email', subject: email,
        createdAt: new Date().toISOString(), lastUsedAt: null,
      })
      isNewUser = true
    }
    return { userId, email, isNewUser }
  }
}
