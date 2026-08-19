# ADR-0008: Browser Session Authentication & Tenant Selection

> **Status: DECIDED (Phase 2C.1).** Records the browser authentication
> boundary, the development-only authentication mode, the signed-session
> cookie semantics, and the multi-membership tenant-selection flow. This ADR
> does NOT introduce a production authentication provider — that is deferred.
> The frozen identity hierarchy (`User → Membership → Organization/Tenant →
> TenantContext`) is unchanged; this ADR defines how a browser obtains a
> trusted session that resolves to that hierarchy.

## Context

Phase 2B established a framework-neutral Core API (`CoreApi.handle(ApiRequest)
→ ApiResponse`) with an `ApiSessionResolver` seam: the only way the API learns
the tenant is `resolveSession(token) → { provider, subject, tenantId } | null`,
resolved server-side. The Phase 2B.3 tests use a synthetic resolver
(`tok_<userId>::<tenantId>` tokens) which is acceptable for API integration
tests but is NOT a real authentication boundary — it trusts the client to
supply `tenantId`, which violates the constitution (tenant isolation must be
server-authoritative).

Phase 2C.1 introduces the first browser-facing surface. A real session
boundary is required: the browser must authenticate, the server must resolve
the user's memberships, the user must select a tenant, and the server must
establish the selected `TenantContext` in a trusted session the browser cannot
forge. The browser must NEVER supply `tenantId`/`organizationId`/`role`/
`permissions` as authority.

## Decision 1 — Browser session mechanism

### QUESTION

How does the browser establish and carry a trusted authenticated session that
resolves to the frozen `TenantContext` without letting the browser become the
tenant authority?

### EVIDENCE

- The `CoreApi` already accepts an `ApiSessionResolver`; the seam is stable.
- The browser cannot hold `tenantId` as authority (constitution: tenant
  isolation is server-authoritative).
- A user may hold multiple `Membership` rows (one per organization/tenant).
  The Phase 2B synthetic resolver assumed one membership per user — that is
  wrong for the general case and must be corrected.
- No HTTP server, no auth library, no session store exists in the repository.
  Adding a full auth provider (NextAuth/Passport/OIDC) is out of scope for
  the first vertical slice.

### OPTIONS

1. **Stateless signed cookie** carrying `{ userId, selectedMembershipId, exp }`,
   HMAC-signed with a server secret. The server resolves `tenantId` from the
   `selectedMembershipId` on every request via `MembershipRepository`.
2. **Server-side session store** (in-memory or Redis) keyed by an opaque
   session id; the cookie carries only the opaque id.
3. **JWT** carrying claims including `tenantId`.

### TRADE-OFFS

- Option 1 is stateless, adds no infrastructure, and is the smallest
  mechanism that satisfies the contract. The cookie carries
  `selectedMembershipId` (not `tenantId`) — the server re-validates the
  membership on every request, so a forged or stale membership selection is
  rejected. The cost is one membership lookup per request (acceptable for
  the first slice; can be cached later).
- Option 2 is more secure (opaque id; server can revoke) but requires a
  session store. Out of scope for the first slice; the stateless cookie is
  sufficient and the `ApiSessionResolver` seam is unchanged if a session
  store is added later.
- Option 3 (JWT) is rejected: it invites putting `tenantId`/`role`/`perms`
  in the token, which would make the browser an authority. JWTs are also
  harder to revoke.

### DECISION

**Option 1 — stateless signed cookie.** The session cookie carries
`{ userId, selectedMembershipId, exp }`, HMAC-SHA256-signed with a server
secret. The server:

1. Verifies the signature + expiry.
2. Loads the `Membership` by `selectedMembershipId` + `userId` (rejects if
   not found, not active, or not belonging to the authenticated user).
3. Derives `tenantId = membership.organizationId`.
4. Resolves `TenantContext` via `IdentityService.resolveTenantContext`.

The browser NEVER sees `tenantId` in the cookie. The browser sends only the
opaque signed cookie. A forged cookie (wrong signature) → 401. A stale
membership (revoked) → 403.

Cookie attributes: `HttpOnly` (no JS access), `SameSite=Strict` (CSRF
resistance), `Secure` when served over HTTPS (production), `Path=/`,
`Max-Age` bounded by `exp`.

### CONSEQUENCES

- One membership lookup per request (server-side, parameterized, tenant-
  scoped). Acceptable for the first slice.
- The session secret MUST come from the environment
  (`CG_SESSION_SECRET`), never from source. The host refuses to start if
  the secret is missing or below a minimum length.
- Logout = clear the cookie. There is no server-side revocation list in
  this phase (deferred).

## Decision 2 — Development Authentication Mode (DEV-only)

### QUESTION

How does a developer authenticate locally for the first browser slice
without building a full password-based auth provider?

### EVIDENCE

- No password hashing, credential store, or reset flow exists.
- Building one is a full auth provider, out of scope for Phase 2C.1.
- The recon proposal (`POST /login { email }` authenticating any email
  without a server-side gate) is REJECTED: it is an identity-spoofing path
  and must not be implemented.

### DECISION

**Development Authentication Mode** — an explicitly DEV-only authentication
boundary, gated by an environment flag.

Mechanism:
1. The host starts in DEV auth mode only when `CONTRACTOR_DEV_AUTH=1` is set
   AND `NODE_ENV !== 'production'`.
2. The host refuses to start if `CONTRACTOR_DEV_AUTH=1` and
   `NODE_ENV=production` (structural guard against accidental production
   enablement).
3. The dev login endpoint (`POST /api/auth/dev-login`) accepts
   `{ credential }` where `credential` MUST equal a server-side development
   secret (`CG_DEV_CREDENTIAL`, from environment). The browser does NOT
   supply an arbitrary email.
4. The server resolves a known development user (seeded into the dev DB) by
   matching the credential. The user must already exist in the database —
   no user is invented by the login call.
5. On match, the server issues the signed session cookie carrying
   `{ userId, selectedMembershipId: null, exp }` — `selectedMembershipId`
   is null until the user selects a tenant (Decision 3).

This is NOT "authentication" in production terms — it is a development
convenience gated by a server-side secret. The ADR explicitly records that
production requires a real provider (OIDC/SAML/NextAuth) wired to the same
`ApiSessionResolver` seam (Decision 4).

### CONSEQUENCES

- The dev login UI visibly indicates "Development Environment" and that
  DEV auth is active (per §8 of the phase prompt).
- `GET /api/auth/dev-mode` returns `{ devAuth: boolean }` so the UI can
  render the dev login form only when dev auth is enabled.
- A production deployment without `CONTRACTOR_DEV_AUTH=1` exposes NO login
  endpoint — the browser cannot authenticate at all until a real provider
  is wired. This is the intended safe default.

## Decision 3 — Multi-membership tenant selection

### QUESTION

How does the browser handle a user with multiple memberships (multiple
organizations/tenants)?

### EVIDENCE

- The identity model permits `User → Membership × N → Organization`.
- The Phase 2B synthetic resolver assumed one membership per user — wrong.
- The browser must not invent the tenant list; it renders what the server
  returns.

### DECISION

After authentication, the browser fetches the user's memberships from the
server:

```
GET /api/auth/memberships
→ 200 { memberships: [{ membershipId, organizationId, organizationName, role }] }
```

The server resolves these from the database (`MembershipRepository.listForUser` +
`OrganizationRepository.getById`). The browser renders a tenant selector. On
selection:

```
POST /api/auth/select-tenant { membershipId }
→ 200 { tenantId, organizationName, role }   (and Set-Cookie with selectedMembershipId)
```

The server validates that the membership belongs to the authenticated user
(`userId` from the session cookie) and is active. A forged `membershipId`
not belonging to the user → 403. The cookie is reissued with the
`selectedMembershipId` set.

Until a tenant is selected, `ApiSessionResolver.resolveSession` returns the
session WITHOUT a `tenantId` (the `selectedMembershipId` is null) — the
CoreApi routes that require a tenant return 403 ("tenant not selected"). The
browser is redirected to the tenant-selection screen.

### CONSEQUENCES

- A user with one membership still goes through the selection screen (it
  auto-selects if exactly one membership is returned). This keeps the flow
  uniform and avoids the "assume one membership" bug.
- `MembershipRepository.listForUser(userId)` is a new additive read method
  (does not change the domain model or tenancy enforcement). It is
  tenant-scoped only in the sense that memberships carry `tenant_id`; the
  list spans the user's memberships across tenants (necessary for tenant
  selection — the user must see all tenants they can act in).

## Decision 4 — Production authentication deferred

### DECISION

Production authentication is deferred to a real provider (OIDC/SAML/NextAuth/
Passport). The `ApiSessionResolver` seam is stable; a production resolver
will validate the provider's token, resolve the `User` via the existing
`AuthProviderBinding` table (`UserRepository.getBindingBySubject`), and issue
the same signed session cookie. The session contract (Decision 1) and the
tenant-selection flow (Decision 3) are unchanged.

No password storage, password hashing, or credential-reset flow will be
invented in this phase.

### DEFERRED QUESTIONS

- **Real auth provider selection** (OIDC vs SAML vs NextAuth vs custom):
  deferred. The seam is stable; the selection is a deployment decision.
- **Session revocation list** (for logout-everywhere): deferred. Logout in
  this phase clears the cookie only.
- **Session expiry refresh / sliding window**: deferred. The cookie has a
  fixed `exp`; refresh is polish.
- **Multi-membership tenant switching mid-session**: supported (the user
  can re-select), but UX polish (a tenant switcher in the header) is
  deferred.
- **Rate limiting on dev-login**: deferred (dev-only, local network).
