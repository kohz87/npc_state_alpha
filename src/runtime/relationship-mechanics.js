/**
 * NPC State Alpha — shared C07 relationship mechanics owner.
 *
 * The model proposes semantic axis deltas. Runtime alone applies deterministic
 * numeric mechanics, bounded history, milestones, and replay protection.
 * Development Relationship Dynamic never enters this module.
 */

import {
  RELATIONSHIP_DEFAULT_SCORE_CAP,
  RELATIONSHIP_DEFAULT_INERTIA,
  RELATIONSHIP_DEFAULT_HISTORY_LIMIT as SETTINGS_RELATIONSHIP_HISTORY_LIMIT,
} from '../contract/settings.js';

export const RELATIONSHIP_AXES = Object.freeze(['trust', 'affection', 'desire', 'tension']);
export const RELATIONSHIP_AXIS_PRIORITY = Object.freeze(['tension', 'desire', 'affection', 'trust']);

export const RELATIONSHIP_DEFAULT_CAP = RELATIONSHIP_DEFAULT_SCORE_CAP;
export const RELATIONSHIP_DEFAULT_HISTORY_LIMIT = SETTINGS_RELATIONSHIP_HISTORY_LIMIT;

export function normalizeRelationshipScore(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeCap(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : RELATIONSHIP_DEFAULT_SCORE_CAP;
}

function normalizeInertia(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : RELATIONSHIP_DEFAULT_INERTIA;
}

function normalizeHistoryLimit(value) {
  return Number.isInteger(value) && value > 0 ? value : RELATIONSHIP_DEFAULT_HISTORY_LIMIT;
}

export function createDefaultRelationshipState(options = {}) {
  const state = {
    trust: normalizeRelationshipScore(options.trust),
    affection: normalizeRelationshipScore(options.affection),
    desire: normalizeRelationshipScore(options.desire),
    tension: normalizeRelationshipScore(options.tension),
    lastEvaluationExchange: options.lastEvaluationExchange ?? null,
  };
  if (options.progress !== undefined) state.progress = { ...options.progress };
  if (options.milestones !== undefined) state.milestones = [...options.milestones];
  if (options.scoringHistory !== undefined) state.scoringHistory = structuredClone(options.scoringHistory);
  return state;
}

function threshold(cap, ratio) {
  // Milestones remain interpretable on the long-standing 100-point relationship
  // scale. Smaller configured caps compress thresholds so milestones stay reachable;
  // larger caps increase headroom without moving familiar milestone semantics.
  return Math.min(normalizeCap(cap), 100) * ratio;
}

/** Milestones scale with the configured cap so valid small caps remain usable. */
export function calculateAxisMilestone(axis, score, { cap = RELATIONSHIP_DEFAULT_SCORE_CAP } = {}) {
  const normalizedCap = normalizeCap(cap);
  const q1 = threshold(normalizedCap, 0.25);
  const q2 = threshold(normalizedCap, 0.50);
  const q3 = threshold(normalizedCap, 0.75);

  switch (axis) {
    case 'trust':
      if (score <= -q3) return 'trust:betrayed';
      if (score <= -q2) return 'trust:distrusted';
      if (score <= -q1) return 'trust:wary';
      if (score >= q3) return 'trust:confidant';
      if (score >= q2) return 'trust:trusted';
      if (score >= q1) return 'trust:receptive';
      return 'trust:neutral';
    case 'affection':
      if (score <= -q3) return 'affection:hated';
      if (score <= -q2) return 'affection:hostile';
      if (score <= -q1) return 'affection:cold';
      if (score >= q3) return 'affection:devoted';
      if (score >= q2) return 'affection:fond';
      if (score >= q1) return 'affection:warm';
      return 'affection:neutral';
    case 'desire':
      if (score <= -q2) return 'desire:repulsed';
      if (score <= -q1) return 'desire:averse';
      if (score >= q3) return 'desire:infatuated';
      if (score >= q2) return 'desire:attracted';
      if (score >= q1) return 'desire:intrigued';
      return 'desire:indifferent';
    case 'tension':
      if (score >= q3) return 'tension:volatile';
      if (score >= q2) return 'tension:strained';
      if (score >= q1) return 'tension:guarded';
      return 'tension:relaxed';
    default:
      return `${axis}:unknown`;
  }
}

export function calculateRelationshipMilestones(relationship, { cap = RELATIONSHIP_DEFAULT_SCORE_CAP } = {}) {
  if (!relationship || typeof relationship !== 'object') return [];
  return RELATIONSHIP_AXES.map((axis) => calculateAxisMilestone(axis, normalizeRelationshipScore(relationship[axis]), { cap }));
}

/**
 * Applies one raw model delta mechanically. Inertia resists larger moves as the
 * existing score approaches its configured cap; it never changes the sign or
 * invents a semantic delta.
 */
export function calculateAxisDelta(
  currentScore,
  rawDelta,
  { cap = RELATIONSHIP_DEFAULT_SCORE_CAP, inertia = RELATIONSHIP_DEFAULT_INERTIA } = {},
) {
  const current = normalizeRelationshipScore(currentScore);
  const delta = normalizeRelationshipScore(rawDelta);
  const normalizedCap = normalizeCap(cap);
  const normalizedInertia = normalizeInertia(inertia);

  if (delta === 0) return { appliedDelta: 0, newScore: current };

  const distanceRatio = Math.min(1, Math.abs(current) / normalizedCap);
  const damping = 1 / (1 + normalizedInertia * distanceRatio);
  let appliedDelta = delta * damping;
  let newScore = Math.max(-normalizedCap, Math.min(normalizedCap, current + appliedDelta));
  appliedDelta = newScore - current;

  return { appliedDelta, newScore: normalizeRelationshipScore(newScore) };
}

function fractionalProgress(score) {
  const value = normalizeRelationshipScore(score);
  return Math.abs(value - Math.trunc(value));
}

function scoresOf(relationship) {
  return Object.fromEntries(RELATIONSHIP_AXES.map((axis) => [axis, normalizeRelationshipScore(relationship?.[axis])]));
}

function zeroAxisMap() {
  return { trust: 0, affection: 0, desire: 0, tension: 0 };
}

function appendHistory(relationship, record, historyLimit) {
  if (!Array.isArray(relationship.scoringHistory)) relationship.scoringHistory = [];
  relationship.scoringHistory.push(record);
  if (relationship.scoringHistory.length > historyLimit) {
    relationship.scoringHistory = relationship.scoringHistory.slice(-historyLimit);
  }
}

/**
 * Applies a validated C07 relationshipEvaluation proposal.
 * A valid explicit no-shift is a mechanical no-op for canonical relationship state:
 * numeric axes, scoring history, and relationship field revision remain untouched.
 * The owned exchange itself is still represented by the ordinary S3 checkpoint/dedup path.
 */
export function applyRelationshipMechanics(npc, evalProposal, options = {}) {
  if (!evalProposal || typeof evalProposal !== 'object' || Array.isArray(evalProposal)) {
    return { applied: false, error: 'relationshipEvaluation must be an object.' };
  }

  const settings = options.settings || {};
  const cap = normalizeCap(options.cap ?? settings.relationshipScoreCap);
  const inertia = normalizeInertia(options.inertia ?? settings.relationshipInertia);
  const historyLimit = normalizeHistoryLimit(options.historyLimit ?? settings.relationshipHistoryLimit);
  const exchangeId = options.exchangeId ?? evalProposal.exchangeId ?? null;

  if (!npc.relationship || typeof npc.relationship !== 'object' || Array.isArray(npc.relationship)) {
    npc.relationship = createDefaultRelationshipState({ cap });
  }

  const oldValue = structuredClone(npc.relationship);
  const shifted = evalProposal.shifted === true;
  if (!shifted) {
    return {
      applied: false,
      bookkeepingOnly: true,
      reason: 'explicit_zero_shift',
      oldValue,
      newValue: structuredClone(npc.relationship),
      appliedDeltas: zeroAxisMap(),
      milestones: calculateRelationshipMilestones(npc.relationship, { cap }),
    };
  }

  if (!npc.relationship.progress || typeof npc.relationship.progress !== 'object' || Array.isArray(npc.relationship.progress)) {
    npc.relationship.progress = zeroAxisMap();
  }
  if (!Array.isArray(npc.relationship.milestones)) {
    npc.relationship.milestones = calculateRelationshipMilestones(npc.relationship, { cap });
  }
  if (!Array.isArray(npc.relationship.scoringHistory)) npc.relationship.scoringHistory = [];

  if (exchangeId !== null && npc.relationship.scoringHistory.some((entry) => entry?.exchangeId === exchangeId)) {
    const snapshot = structuredClone(npc.relationship);
    return {
      applied: false,
      reason: 'replay_suppressed',
      deduplicated: true,
      oldValue: snapshot,
      newValue: snapshot,
    };
  }
  if (shifted) {
    if (!evalProposal.axes || typeof evalProposal.axes !== 'object' || Array.isArray(evalProposal.axes)) {
      return { applied: false, error: 'A shifted relationship evaluation requires an axes object.' };
    }
    const suppliedAxes = Object.entries(evalProposal.axes);
    if (suppliedAxes.some(([axis, value]) => !RELATIONSHIP_AXES.includes(axis) || typeof value !== 'number' || !Number.isFinite(value))) {
      return { applied: false, error: 'Relationship axes must contain only finite trust/affection/desire/tension deltas.' };
    }
    if (!suppliedAxes.some(([, value]) => value !== 0)) {
      return { applied: false, error: 'A shifted relationship evaluation requires at least one non-zero axis delta.' };
    }
  }
  const rawDeltas = shifted
    ? Object.fromEntries(RELATIONSHIP_AXES.map((axis) => [axis, evalProposal.axes?.[axis] ?? 0]))
    : zeroAxisMap();
  const appliedDeltas = zeroAxisMap();

  if (shifted) {
    for (const axis of RELATIONSHIP_AXIS_PRIORITY) {
      const { appliedDelta, newScore } = calculateAxisDelta(
        npc.relationship[axis],
        rawDeltas[axis],
        { cap, inertia },
      );
      npc.relationship[axis] = newScore;
      appliedDeltas[axis] = appliedDelta;
      npc.relationship.progress[axis] = fractionalProgress(newScore);
    }
  }

  npc.relationship.milestones = calculateRelationshipMilestones(npc.relationship, { cap });
  if (exchangeId !== null) npc.relationship.lastEvaluationExchange = exchangeId;

  const historyRecord = {
    exchangeId,
    timestamp: options.timestamp || new Date().toISOString(),
    shifted,
    reason: evalProposal.reason ?? null,
    impact: evalProposal.impact ?? null,
    source: evalProposal.source ? structuredClone(evalProposal.source) : null,
    rawDeltas,
    appliedDeltas,
    resultingScores: scoresOf(npc.relationship),
    milestones: [...npc.relationship.milestones],
    axisSupport: evalProposal.axisSupport ? structuredClone(evalProposal.axisSupport) : null,
  };
  appendHistory(npc.relationship, historyRecord, historyLimit);

  const anyNumericChange = RELATIONSHIP_AXES.some((axis) => appliedDeltas[axis] !== 0);
  return {
    // Explicit no-shift is recorded as evidence/history but remains a numeric
    // no-op, preserving the accepted S2/S3 field-revision semantics.
    applied: shifted,
    bookkeepingOnly: !anyNumericChange,
    reason: shifted ? (anyNumericChange ? 'relationship_shift_applied' : 'relationship_shift_clamped') : 'explicit_zero_shift',
    oldValue,
    newValue: structuredClone(npc.relationship),
    appliedDeltas,
    milestones: [...npc.relationship.milestones],
    historyRecord,
  };
}
