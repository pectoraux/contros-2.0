/**
 * Test that the pure SHA-256 implementation (sha256Hex) produces the same
 * output as node:crypto.createHash('sha256') for representative inputs.
 */
import { describe, test, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { sha256Hex } from '../src/sha256.js'

describe('pure sha256Hex (Increment 3F)', () => {
  test('matches node:crypto for "hello world"', () => {
    const input = Buffer.from('hello world')
    const expected = createHash('sha256').update(input).digest('hex')
    expect(sha256Hex(new Uint8Array(input))).toBe(expected)
  })

  test('matches node:crypto for empty input', () => {
    const input = Buffer.from('')
    const expected = createHash('sha256').update(input).digest('hex')
    expect(sha256Hex(new Uint8Array(input))).toBe(expected)
  })

  test('matches node:crypto for a longer string', () => {
    const input = Buffer.from('The quick brown fox jumps over the lazy dog')
    const expected = createHash('sha256').update(input).digest('hex')
    expect(sha256Hex(new Uint8Array(input))).toBe(expected)
  })

  test('matches node:crypto for 1000 bytes', () => {
    const input = Buffer.alloc(1000, 0x61) // 'a' * 1000
    const expected = createHash('sha256').update(input).digest('hex')
    expect(sha256Hex(new Uint8Array(input))).toBe(expected)
  })

  test('produces 64-character hex output', () => {
    const result = sha256Hex(new Uint8Array([1, 2, 3]))
    expect(result).toHaveLength(64)
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })
})
