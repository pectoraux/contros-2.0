import { describe, it, expect } from 'vitest'
import { contentHash, canonicalize, verifyContentHash } from '../../src/domain/hashing.js'

describe('canonical content hashing', () => {
  it('is deterministic: same content -> same hash', () => {
    const a = { name: 'Acme', workspace: 'Main', items: [1, 2, 3] }
    const b = { workspace: 'Main', name: 'Acme', items: [1, 2, 3] } // different key order
    expect(contentHash(a)).toBe(contentHash(b))
  })

  it('produces a 64-char hex SHA-256', () => {
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/)
  })

  it('distinguishes different content', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }))
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: '1' }))
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1])) // array order matters
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 1, b: 2 }))
  })

  it('omits undefined fields (undefined is not canonical content)', () => {
    expect(contentHash({ a: 1, b: undefined })).toBe(contentHash({ a: 1 }))
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 1, b: null })) // null is meaningful
  })

  it('preserves null (explicitly absent is meaningful)', () => {
    expect(contentHash({ a: null })).not.toBe(contentHash({}))
    expect(contentHash({ a: null })).not.toBe(contentHash({ a: '' }))
  })

  it('handles nested objects recursively (stable key ordering)', () => {
    const a = { x: { c: 3, b: 2, a: 1 }, y: [1, 2] }
    const b = { y: [1, 2], x: { a: 1, b: 2, c: 3 } }
    expect(contentHash(a)).toBe(contentHash(b))
  })

  it('handles booleans, numbers, strings, bigints distinctly', () => {
    expect(contentHash(true)).not.toBe(contentHash(1))
    expect(contentHash(1)).not.toBe(contentHash('1'))
    expect(contentHash(1n)).not.toBe(contentHash(1))
  })

  it('canonicalize produces stable string output', () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }))
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  it('verifyContentHash matches a recomputed hash', () => {
    const h = contentHash({ estimate: { lines: [{ qty: 10, rate: 5 }] } })
    expect(verifyContentHash({ estimate: { lines: [{ qty: 10, rate: 5 }] } }, h)).toBe(true)
    expect(verifyContentHash({ estimate: { lines: [{ qty: 11, rate: 5 }] } }, h)).toBe(false)
  })

  it('treats dates as canonical ISO strings (deterministic domain values, not wall-clock)', () => {
    const d = new Date('2026-01-15T00:00:00.000Z')
    expect(contentHash({ contractDate: d })).toBe(
      contentHash({ contractDate: new Date('2026-01-15T00:00:00.000Z') }),
    )
  })

  it('does not leak object identity (two equal-literal objects hash the same)', () => {
    const make = () => ({ a: 1, b: [1, 2], c: { x: true } })
    expect(contentHash(make())).toBe(contentHash(make()))
  })
})
