import { describe, it, expect } from 'vitest'
import { ulid, entityId, ID_PREFIX } from '../../src/domain/ids.js'

describe('ULID entity IDs', () => {
  it('produces a 26-char ULID', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('produces prefixed IDs', () => {
    const id = entityId(ID_PREFIX.organization)
    expect(id).toMatch(/^org_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(entityId(ID_PREFIX.user)).toMatch(/^usr_/)
    expect(entityId(ID_PREFIX.project)).toMatch(/^proj_/)
    expect(entityId(ID_PREFIX.revision)).toMatch(/^rev_/)
    expect(entityId(ID_PREFIX.audit)).toMatch(/^aud_/)
  })

  it('is monotonically sortable (later timestamp sorts after earlier)', () => {
    const early = ulid(1_700_000_000_000) // 2023-11-14
    const late = ulid(1_800_000_000_000) // 2027-01-15
    expect(early < late).toBe(true)
  })

  it('generates unique IDs (1000 iterations)', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) ids.add(ulid())
    expect(ids.size).toBe(1000)
  })

  it('ID_PREFIX is complete (all foundation entities covered)', () => {
    const prefixes = Object.values(ID_PREFIX)
    expect(prefixes).toContain('usr')
    expect(prefixes).toContain('org')
    expect(prefixes).toContain('mbr')
    expect(prefixes).toContain('ws')
    expect(prefixes).toContain('proj')
    expect(prefixes).toContain('aud')
    expect(prefixes).toContain('rev')
    // distinct prefixes
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })
})
