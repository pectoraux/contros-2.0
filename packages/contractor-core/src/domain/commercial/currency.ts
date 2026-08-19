/**
 * Currency contract — ISO 4217 codes + minor-unit precision.
 *
 * Money is always expressed in a specific currency. The currency defines
 * the minor-unit precision (decimals). All monetary arithmetic uses the
 * minor-unit (integer) representation internally to avoid floating-point
 * error; values are only converted to decimal for display.
 *
 * Phase 2A scope: currency CODE + minor-unit precision + exchange-rate
 * provenance boundary (no FX system implemented). (Phase 2A §10.)
 */

/** ISO 4217 currency code (3 uppercase letters). */
export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' }

/** Validate and brand a currency code. */
export function currencyCode(code: string): CurrencyCode {
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`Invalid currency code (must be 3 uppercase letters): ${code}`)
  }
  return code as CurrencyCode
}

/** Minor-unit precision (decimals) for a currency. Most currencies use 2; JPY uses 0. */
export interface CurrencySpec {
  readonly code: CurrencyCode
  readonly decimals: 0 | 2 | 3
}

/** Common currencies (extensible). */
export const CURRENCIES: Readonly<Record<string, CurrencySpec>> = {
  GHS: { code: currencyCode('GHS'), decimals: 2 },
  USD: { code: currencyCode('USD'), decimals: 2 },
  EUR: { code: currencyCode('EUR'), decimals: 2 },
  GBP: { code: currencyCode('GBP'), decimals: 2 },
  NGN: { code: currencyCode('NGN'), decimals: 2 },
  KES: { code: currencyCode('KES'), decimals: 2 },
  ZAR: { code: currencyCode('ZAR'), decimals: 2 },
  JPY: { code: currencyCode('JPY'), decimals: 0 },
  KWD: { code: currencyCode('KWD'), decimals: 3 },
}

/** Look up a currency spec by code; throws if unknown. */
export function currencySpec(code: CurrencyCode | string): CurrencySpec {
  const c = typeof code === 'string' ? currencyCode(code) : code
  const spec = CURRENCIES[c]
  if (!spec) throw new Error(`Unknown currency code: ${c}`)
  return spec
}

/**
 * Exchange-rate provenance — the boundary contract for currency conversion.
 *
 * NOT an FX system. A rate is an immutable observation: how many units of
 * the target currency equal one unit of the source currency at a specific
 * effective date. Rates are never mutable hidden state; they are
 * observations with provenance. (Phase 2A §10: "Do not make exchange rates
 * mutable hidden state.")
 *
 * Phase 2A does NOT implement conversion; this type exists to define the
 * boundary for future Pricing Knowledge.
 */
export interface ExchangeRateObservation {
  readonly sourceCurrency: CurrencyCode
  readonly targetCurrency: CurrencyCode
  /** How many units of target = 1 unit of source. */
  readonly rate: number
  readonly effectiveDate: string
  readonly provenance: string
  readonly sourceReference?: string
}
