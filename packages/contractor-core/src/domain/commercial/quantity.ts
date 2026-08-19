/**
 * Quantity — canonical measurement quantity.
 *
 * A Quantity is a numeric amount + a unit of measure (e.g. "12.5 m2",
 * "3 nos", "8 hours"). Quantities are NOT money — they have their own
 * precision rules.
 *
 * Quantity precision: 4 decimal places (sufficient for construction takeoff:
 * e.g. 12.3456 m2). Banker's rounding at 4 decimals.
 *
 * PURE: no Math.random, no Date.now, no I/O. (master prompt §14.)
 */

/** A unit of measure (free-form string; not a closed enum). */
export type Unit = string & { readonly __brand: 'Unit' }

/** Create/validate a unit of measure. */
export function unit(u: string): Unit {
  if (!u || typeof u !== 'string') throw new Error(`Invalid unit: ${u}`)
  return u as Unit
}

/** Common units (extensible, not exhaustive). */
export const UNITS = {
  SQUARE_METRE: unit('m2'),
  CUBIC_METRE: unit('m3'),
  LINEAR_METRE: unit('m'),
  NUMBER: unit('nos'),
  HOUR: unit('hr'),
  DAY: unit('day'),
  TONNE: unit('t'),
  KILOGRAM: unit('kg'),
  LITRE: unit('l'),
  SET: unit('set'),
} as const

export interface Quantity {
  readonly __brand: 'Quantity'
  readonly value: number // rounded to 4 decimals (banker's)
  readonly unit: Unit
}

const QUANTITY_DECIMALS = 4
const QUANTITY_FACTOR = Math.pow(10, QUANTITY_DECIMALS)

/** Create a Quantity from a numeric amount + unit. */
export function quantity(amount: number, u: Unit | string): Quantity {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid quantity (negative or non-finite): ${amount}`)
  }
  const uVal = typeof u === 'string' ? unit(u) : u
  // Banker's rounding at 4 decimals
  const noiseAbsorber = Math.pow(10, QUANTITY_DECIMALS + 6)
  const scaled = Math.round(amount * noiseAbsorber) / (noiseAbsorber / QUANTITY_FACTOR)
  const rounded = bankerRound4(scaled)
  return { __brand: 'Quantity', value: rounded / QUANTITY_FACTOR, unit: uVal } as Quantity
}

function bankerRound4(n: number): number {
  if (!Number.isFinite(n)) return 0
  const floor = Math.floor(n)
  const frac = n - floor
  if (frac < 0.5) return floor
  if (frac > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

// ── Arithmetic (same-unit only) ───────────────────────────────

function assertSameUnit(a: Quantity, b: Quantity): void {
  if (a.unit !== b.unit) {
    throw new Error(`Quantity unit mismatch: ${a.unit} vs ${b.unit}`)
  }
}

export function addQuantity(a: Quantity, b: Quantity): Quantity {
  assertSameUnit(a, b)
  return quantity(a.value + b.value, a.unit)
}

export function multiplyQuantity(q: Quantity, scalar: number): Quantity {
  return quantity(q.value * scalar, q.unit)
}

export function divideQuantity(q: Quantity, scalar: number): Quantity {
  if (scalar === 0) throw new Error('Quantity divide by zero')
  return quantity(q.value / scalar, q.unit)
}

export function sumQuantity(values: Quantity[]): Quantity {
  if (values.length === 0) throw new Error('sumQuantity: empty list')
  const u = values[0]!.unit
  let total = 0
  for (const v of values) {
    assertSameUnit(v, { __brand: 'Quantity', value: 0, unit: u } as Quantity)
    total += v.value
  }
  return quantity(total, u)
}

export function isEqualQuantity(a: Quantity, b: Quantity): boolean {
  return a.unit === b.unit && a.value === b.value
}

export { bankerRound } from './money.js'
