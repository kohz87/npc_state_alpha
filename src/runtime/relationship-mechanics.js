/**
 * NPC State Alpha — Shared Relationship Primitives
 *
 * Implements S2 baseline numeric axis delta foundation (C02, C07).
 * This module provides the mechanical state storage and finite-number delta
 * accumulator for relationship axes ({ trust, affection, desire, tension }).
 * It does NOT claim high-level relationship mechanics completion; narrative
 * semantics and speculative multi-axis dynamic calculations belong to later
 * stages (e.g. S5).
 * Preserves numeric and fractional axis deltas without artificial caps or clamping.
 */

/**
 * Normalizes a relationship score to ensure it is a finite number,
 * preserving numeric and fractional precision without artificial bounds.
 * @param {number} val
 * @returns {number}
 */
export function normalizeRelationshipScore(val) {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    return 0;
  }
  return val;
}

/**
 * Creates default zero relationship scores.
 * @returns {{ trust: number, affection: number, desire: number, tension: number, lastEvaluationExchange: null }}
 */
export function createDefaultRelationshipState() {
  return {
    trust: 0,
    affection: 0,
    desire: 0,
    tension: 0,
    lastEvaluationExchange: null,
  };
}

