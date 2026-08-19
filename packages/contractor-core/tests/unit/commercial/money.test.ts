/**
 * Money tests — canonical monetary value, arithmetic, rounding.
 *
 * Pure, deterministic. No DB, no network, no filesystem. (Phase 2A §19.)
 */

import { describe, it, expect } from 'vitest'
import {
  money, moneyFromMinor, zeroMoney, toDecimal, formatMoney,
  add, subtract, multiply, divide, sumMoney, allocate,
  isEqual, isLessThan, isGreaterThan, isNegative, isZero,
  bankerRound, currencyCode,
} from '../../../src/domain/commercial/money.js'

describe('Money: creation + minor-unit representation', () => {
  it('creates from decimal (2-decimal currency)', () => {
    const m = money(123.45, 'GHS')
    expect(m.amount).toBe(12345) // 123.45 GHS = 12345 minor units (cents)
    expect(m.currency).toBe('GHS')
  })

  it('creates from decimal (0-decimal currency: JPY)', () => {
    const m = money(1234, 'JPY')
    expect(m.amount).toBe(1234) // JPY has no minor units
  })

  it('creates from decimal (3-decimal currency: KWD)', () => {
    const m = money(12.345, 'KWD')
    expect(m.amount).toBe(12345) // 12.345 KWD = 12345 fils
  })

  it('banker\'s rounding on creation (round half to even)', () => {
    // 1.015 → should round to 1.02 (0.5 rounds to even — 1 is odd, so up to 2)
    // But 1.025 → 1.02 (2 is even, stays)
    expect(money(1.015, 'GHS').amount).toBe(102)  // 1.02
    expect(money(1.025, 'GHS').amount).toBe(102)  // 1.02 (banker's: round to even)
    expect(money(1.035, 'GHS').amount).toBe(104)  // 1.04 (3 is odd, round up to 4)
    expect(money(1.045, 'GHS').amount).toBe(104)  // 1.04 (4 is even, stays)
  })

  it('handles negative amounts', () => {
    const m = money(-12.34, 'GHS')
    expect(m.amount).toBe(-1234)
    expect(isNegative(m)).toBe(true)
  })

  it('rejects NaN/Infinity', () => {
    expect(() => money(NaN, 'GHS')).toThrow()
    expect(() => money(Infinity, 'GHS')).toThrow()
  })

  it('rejects invalid currency codes', () => {
    expect(() => money(1, 'ghs')).toThrow() // lowercase
    expect(() => money(1, 'GH')).toThrow()  // 2 letters
    expect(() => money(1, 'GHSS')).toThrow() // 4 letters
  })
})

describe('Money: arithmetic (same-currency only)', () => {
  it('add', () => {
    expect(add(money(1.50, 'GHS'), money(2.50, 'GHS')).amount).toBe(400) // 4.00
  })

  it('subtract', () => {
    expect(subtract(money(5.00, 'GHS'), money(2.50, 'GHS')).amount).toBe(250) // 2.50
  })

  it('multiply (scalar, banker\'s rounded)', () => {
    // 10.00 × 1.1 = 11.00
    expect(multiply(money(10.00, 'GHS'), 1.1).amount).toBe(1100)
    // 10.05 × 2 = 20.10
    expect(multiply(money(10.05, 'GHS'), 2).amount).toBe(2010)
    // 0.33 × 3 = 0.99 (no rounding drift)
    expect(multiply(money(0.33, 'GHS'), 3).amount).toBe(99)
  })

  it('divide (scalar, banker\'s rounded)', () => {
    expect(divide(money(10.00, 'GHS'), 4).amount).toBe(250) // 2.50
    expect(divide(money(1.00, 'GHS'), 3).amount).toBe(33)  // 0.33 (banker's: 0.3333... → 0.33)
  })

  it('rejects cross-currency arithmetic', () => {
    expect(() => add(money(1, 'GHS'), money(1, 'USD'))).toThrow(/currency mismatch/)
    expect(() => subtract(money(1, 'GHS'), money(1, 'USD'))).toThrow(/currency mismatch/)
  })

  it('sum', () => {
    const total = sumMoney([money(1.00, 'GHS'), money(2.50, 'GHS'), money(0.50, 'GHS')])
    expect(total.amount).toBe(400) // 4.00
  })

  it('allocate (no rounding drift)', () => {
    // 10.00 / 3 = 3.34 + 3.33 + 3.33 = 10.00 (remainder distributed)
    const parts = allocate(money(10.00, 'GHS'), 3)
    expect(parts.length).toBe(3)
    const sum = parts.reduce((s, p) => s + p.amount, 0)
    expect(sum).toBe(1000) // exactly 10.00
  })
})

describe('Money: comparison', () => {
  it('isEqual', () => {
    expect(isEqual(money(1.00, 'GHS'), money(1.00, 'GHS'))).toBe(true)
    expect(isEqual(money(1.00, 'GHS'), money(1.01, 'GHS'))).toBe(false)
    expect(isEqual(money(1.00, 'GHS'), money(1.00, 'USD'))).toBe(false)
  })

  it('isLessThan / isGreaterThan', () => {
    expect(isLessThan(money(1.00, 'GHS'), money(2.00, 'GHS'))).toBe(true)
    expect(isGreaterThan(money(2.00, 'GHS'), money(1.00, 'GHS'))).toBe(true)
  })

  it('isZero', () => {
    expect(isZero(zeroMoney('GHS'))).toBe(true)
    expect(isZero(money(0.01, 'GHS'))).toBe(false)
  })
})

describe('Money: display formatting (NOT canonical)', () => {
  it('toDecimal', () => {
    expect(toDecimal(money(123.45, 'GHS'))).toBeCloseTo(123.45, 2)
    expect(toDecimal(moneyFromMinor(1000, 'GHS'))).toBeCloseTo(10.00, 2)
  })

  it('formatMoney (display, not canonical)', () => {
    expect(formatMoney(money(1234.50, 'GHS'))).toBe('GHS 1,234.50')
    expect(formatMoney(money(0.50, 'GHS'))).toBe('GHS 0.50')
    expect(formatMoney(money(-12.34, 'GHS'))).toBe('-GHS 12.34')
    expect(formatMoney(money(1000, 'JPY'))).toBe('JPY 1,000')
  })
})

describe('Money: bankerRound (round half to even)', () => {
  it('rounds half to even (no upward bias)', () => {
    expect(bankerRound(0.5)).toBe(0)   // 0 is even
    expect(bankerRound(1.5)).toBe(2)   // 2 is even
    expect(bankerRound(2.5)).toBe(2)   // 2 is even (NOT 3)
    expect(bankerRound(3.5)).toBe(4)   // 4 is even
    expect(bankerRound(4.5)).toBe(4)   // 4 is even (NOT 5)
  })

  it('rounds non-half normally', () => {
    expect(bankerRound(0.4)).toBe(0)
    expect(bankerRound(0.6)).toBe(1)
    expect(bankerRound(2.4)).toBe(2)
    expect(bankerRound(2.6)).toBe(3)
  })
})
