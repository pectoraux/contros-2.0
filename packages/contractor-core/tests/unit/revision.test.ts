import { describe, it, expect } from 'vitest'
import { canTransition, assertCanTransition, isImmutable, isMutable, assertMutable, isValidStatus } from '../../src/domain/revision.js'
import { ImmutableRevisionMutationError } from '../../src/domain/errors.js'

describe('revision status transition rules (pure)', () => {
  describe('allowed transitions', () => {
    it('draft -> finalized is allowed', () => {
      expect(canTransition('draft', 'finalized')).toBe(true)
    })
    it('draft -> superseded is allowed (discard)', () => {
      expect(canTransition('draft', 'superseded')).toBe(true)
    })
    it('finalized -> superseded is allowed (newer revision supersedes)', () => {
      expect(canTransition('finalized', 'superseded')).toBe(true)
    })
  })

  describe('forbidden transitions', () => {
    it('finalized -> draft is forbidden (cannot un-finalize)', () => {
      expect(canTransition('finalized', 'draft')).toBe(false)
    })
    it('superseded -> anything is forbidden (terminal)', () => {
      expect(canTransition('superseded', 'draft')).toBe(false)
      expect(canTransition('superseded', 'finalized')).toBe(false)
    })
  })

  describe('immutability', () => {
    it('draft is mutable', () => {
      expect(isMutable('draft')).toBe(true)
      expect(isImmutable('draft')).toBe(false)
    })
    it('finalized is immutable', () => {
      expect(isImmutable('finalized')).toBe(true)
      expect(isMutable('finalized')).toBe(false)
    })
    it('superseded is immutable', () => {
      expect(isImmutable('superseded')).toBe(true)
      expect(isMutable('superseded')).toBe(false)
    })
  })

  describe('assertions', () => {
    it('assertCanTransition passes for allowed transition', () => {
      expect(() => assertCanTransition('rev_1', 'draft', 'finalized')).not.toThrow()
    })
    it('assertCanTransition throws ImmutableRevisionMutation for forbidden transition', () => {
      expect(() => assertCanTransition('rev_1', 'finalized', 'draft')).toThrow(ImmutableRevisionMutationError)
    })
    it('assertMutable passes for draft', () => {
      expect(() => assertMutable('rev_1', 'draft')).not.toThrow()
    })
    it('assertMutable throws for finalized', () => {
      expect(() => assertMutable('rev_1', 'finalized')).toThrow(ImmutableRevisionMutationError)
    })
    it('assertMutable throws for superseded', () => {
      expect(() => assertMutable('rev_1', 'superseded')).toThrow(ImmutableRevisionMutationError)
    })
  })

  describe('validation', () => {
    it('isValidStatus accepts the three valid statuses', () => {
      expect(isValidStatus('draft')).toBe(true)
      expect(isValidStatus('finalized')).toBe(true)
      expect(isValidStatus('superseded')).toBe(true)
    })
    it('isValidStatus rejects invalid values', () => {
      expect(isValidStatus('published')).toBe(false)
      expect(isValidStatus(null)).toBe(false)
      expect(isValidStatus(undefined)).toBe(false)
    })
  })
})
