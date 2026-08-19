/**
 * Money — canonical monetary value.
 *
 * Internally represented as an INTEGER count of minor units (e.g. cents for
 * USD/GHS, whole yen for JPY) to avoid IEEE-754 floating-point error. This
 * is the standard deterministic-money pattern.
 *
 * Every Money value carries its CurrencyCode. Arithmetic is only allowed
 * between same-currency Money values (cross-currency requires an explicit
 * ExchangeRateObservation — not implemented in Phase 2A).
 *
 * Rounding: banker's rounding (round half to even) at the currency's
 * minor-unit precision. This avoids the systematic upward bias of
 * "round half up" and matches the legacy Contros behavior (round2).
 * (Phase 2A §8/§9.)
 *
 * PURE: no Math.random, no Date.now, no I/O. (master prompt §14.)
 */

import type { CurrencyCode, CurrencySpec } from './currency.js'
import { currencySpec, currencyCode } from './currency.js'

/**
 * A monetary value. The `minorUnits` field is the canonical integer
 * representation (e.g. 12345 = $123.45 for a 2-decimal currency).
 */
export interface Money {
  readonly __brand: 'Money'
  readonly amount: number // minor units (integer)
  readonly currency: CurrencyCode
}

/** Create a Money value from a decimal amount (e.g. dollars, not cents). */
export function money(decimalAmount: number, currency: CurrencyCode | string): Money {
  const c = typeof currency === 'string' ? currencyCode(currency) : currency
  const spec = currencySpec(c)
  // Banker's rounding (round half to even) at the currency's decimals
  const minorUnits = toMinorUnits(decimalAmount, spec.decimals)
  return { __brand: 'Money', amount: minorUnits, currency: c } as Money
}

/** Create a Money value from an already-integer minor-unit count. */
export function moneyFromMinor(minorUnits: number, currency: CurrencyCode | string): Money {
  if (!Number.isInteger(minorUnits)) {
    throw new Error(`moneyFromMinor: minorUnits must be an integer, got ${minorUnits}`)
  }
  const c = typeof currency === 'string' ? currencyCode(currency) : currency
  return { __brand: 'Money', amount: minorUnits, currency: c } as Money
}

/** The zero value for a currency. */
export function zeroMoney(currency: CurrencyCode | string): Money {
  return moneyFromMinor(0, currency)
}

/** Convert a Money value back to a decimal (display). */
export function toDecimal(m: Money): number {
  const spec = currencySpec(m.currency)
  const factor = Math.pow(10, spec.decimals)
  return m.amount / factor
}

/** Format a Money value as a string (display, not canonical). */
export function formatMoney(m: Money): string {
  const spec = currencySpec(m.currency)
  const factor = Math.pow(10, spec.decimals)
  const abs = Math.abs(m.amount)
  const sign = m.amount < 0 ? '-' : ''
  const intPart = Math.floor(abs / factor)
  const fracPart = abs % factor
  const intStr = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (spec.decimals === 0) return `${sign}${m.currency} ${intStr}`
  const fracStr = fracPart.toString().padStart(spec.decimals, '0')
  return `${sign}${m.currency} ${intStr}.${fracStr}`
}

// ── Arithmetic (same-currency only) ──────────────────────────

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Money currency mismatch: ${a.currency} vs ${b.currency}`)
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return { __brand: 'Money', amount: a.amount + b.amount, currency: a.currency } as Money
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return { __brand: 'Money', amount: a.amount - b.amount, currency: a.currency } as Money
}

/**
 * Multiply a Money value by a dimensionless scalar. The result is rounded
 * to the currency's minor-unit precision using banker's rounding.
 */
export function multiply(m: Money, scalar: number): Money {
  const product = m.amount * scalar
  const rounded = bankerRound(product) // product is already in minor units; round to integer
  return { __brand: 'Money', amount: rounded, currency: m.currency } as Money
}

/**
 * Divide a Money value by a dimensionless scalar. The result is rounded
 * to the currency's minor-unit precision using banker's rounding.
 */
export function divide(m: Money, scalar: number): Money {
  if (scalar === 0) throw new Error('Money divide by zero')
  const quotient = m.amount / scalar
  const rounded = bankerRound(quotient)
  return { __brand: 'Money', amount: rounded, currency: m.currency } as Money
}

/**
 * Sum a list of same-currency Money values.
 */
export function sumMoney(values: Money[]): Money {
  if (values.length === 0) throw new Error('sumMoney: empty list')
  const currency = values[0]!.currency
  let total = 0
  for (const v of values) {
    assertSameCurrency(v, { __brand: 'Money', amount: 0, currency } as Money)
    total += v.amount
  }
  return { __brand: 'Money', amount: total, currency } as Money
}

/**
 * Allocate a Money value into N parts that sum exactly to the original
 * (no rounding drift). Uses the largest-remainder method. Returns N parts.
 */
export function allocate(m: Money, n: number): Money[] {
  if (n <= 0) throw new Error('allocate: n must be positive')
  if (!Number.isInteger(n)) throw new Error('allocate: n must be an integer')
  const baseShare = Math.floor(m.amount / n)
  const remainder = m.amount - baseShare * n
  const parts: Money[] = []
  for (let i = 0; i < n; i++) {
    parts.push({ __brand: 'Money', amount: baseShare, currency: m.currency } as Money)
  }
  // Distribute the remainder (1 minor unit each) to the first `remainder` parts
  for (let i = 0; i < remainder; i++) {
    parts[i] = { __brand: 'Money', amount: parts[i]!.amount + 1, currency: m.currency } as Money
  }
  return parts
}

// ── Comparison ───────────────────────────────────────────────

export function isEqual(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount
}

export function isLessThan(a: Money, b: Money): boolean {
  assertSameCurrency(a, b)
  return a.amount < b.amount
}

export function isGreaterThan(a: Money, b: Money): boolean {
  assertSameCurrency(a, b)
  return a.amount > b.amount
}

export function isNegative(m: Money): boolean {
  return m.amount < 0
}

export function isZero(m: Money): boolean {
  return m.amount === 0
}

// ── Banker's rounding (round half to even) ───────────────────

/**
 * Banker's rounding: round half to even. Avoids the systematic upward
 * bias of "round half up". Matches the legacy Contros round2 behavior.
 * (Phase 2A §8.)
 */
export function bankerRound(n: number): number {
  if (!Number.isFinite(n)) return 0
  const floor = Math.floor(n)
  const frac = n - floor
  if (frac < 0.5) return floor
  if (frac > 0.5) return floor + 1
  // Exactly halfway — round to even
  return floor % 2 === 0 ? floor : floor + 1
}

/**
 * Convert a decimal amount to minor units (integer) using banker's rounding
 * at the specified decimal precision. Absorbs floating-point representation
 * noise (e.g. 1.015 stored as 1.0149999...).
 */
function toMinorUnits(decimalAmount: number, decimals: 0 | 2 | 3): number {
  if (!Number.isFinite(decimalAmount)) {
    throw new Error(`Invalid monetary amount (NaN/Infinity): ${decimalAmount}`)
  }
  const sign = decimalAmount < 0 ? -1 : 1
  const abs = Math.abs(decimalAmount)
  // Scale by 1e(decimals+6) to absorb float noise, then to minor units, then round
  const noiseAbsorber = Math.pow(10, decimals + 6)
  const minorFactor = Math.pow(10, decimals)
  const scaled = Math.round(abs * noiseAbsorber) / (noiseAbsorber / minorFactor)
  const rounded = bankerRound(scaled)
  return sign * rounded
}

// Re-export currencyCode for convenience
export { currencyCode } from './currency.js'
export type { CurrencyCode, CurrencySpec } from './currency.js'
