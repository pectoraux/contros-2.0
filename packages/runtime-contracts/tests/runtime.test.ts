/**
 * Runtime contract test: getRuntime() throws before setRuntime() is called,
 * and round-trips the context after setRuntime().
 *
 * Verifies the bootstrap-only mechanism (ADR-001 Correction A).
 */
import { describe, test, expect, beforeEach } from 'vitest'
import {
  getRuntime,
  setRuntime,
  __resetRuntimeForTesting,
  type RuntimeContext,
} from '../src/runtime.js'

describe('RuntimeContext bootstrap', () => {
  beforeEach(() => {
    __resetRuntimeForTesting()
  })

  test('getRuntime() throws before setRuntime() is called', () => {
    expect(() => getRuntime()).toThrow(/not initialized/)
  })

  test('setRuntime() + getRuntime() round-trips the context', () => {
    const mock = {
      platform: 'electron',
      version: '0.0.0-test',
    } as unknown as RuntimeContext
    setRuntime(mock)
    expect(getRuntime()).toBe(mock)
  })

  test('getRuntime() throws with a message mentioning constructor injection', () => {
    expect(() => getRuntime()).toThrow(/constructor/)
  })

  test('__resetRuntimeForTesting() clears the singleton', () => {
    const mock = {} as unknown as RuntimeContext
    setRuntime(mock)
    __resetRuntimeForTesting()
    expect(() => getRuntime()).toThrow(/not initialized/)
  })
})
