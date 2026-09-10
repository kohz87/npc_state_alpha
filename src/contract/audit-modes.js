/**
 * NPC State Alpha — Audit Operation Masks and Field-Level Outcome Shapes
 *
 * Single behavior authority: docs/core-contract.md (C12)
 *
 * Routine development and fast deltas are delta-oriented and do NOT
 * require exhaustive field outcomes.
 * Audit modes (e.g. Refresh dossier, Recheck missing details) report
 * field-level outcomes: applied, rejected, unchanged, insufficient,
 * unavailable, unaccounted.
 */

import { CANONICAL_FIELDS, WRITERS, DURABLE_DOSSIER_FIELDS } from './registry.js';

export const AUDIT_OUTCOMES = Object.freeze({
  APPLIED: 'applied',
  REJECTED: 'rejected',
  UNCHANGED: 'unchanged',
  INSUFFICIENT: 'insufficient',
  UNAVAILABLE: 'unavailable',
  UNACCOUNTED: 'unaccounted',
});

export const AUDIT_OPERATIONS = Object.freeze({
  RETRY_IMMEDIATE: 'retry_immediate',
  REVIEW_PENDING: 'review_pending',
  RECHECK_MISSING: 'recheck_missing',
  REFRESH_DOSSIER: 'refresh_dossier',
  RECOVERY_REBUILD: 'recovery_rebuild',
});

export const AUDIT_OPERATIONS_LIST = Object.freeze(Object.values(AUDIT_OPERATIONS));

/**
 * Field masks for audit and operational modes.
 * Excludes runtime bookkeeping (acceptedSupport, reviewReceipts) and includes
 * all eligible durable dossier fields.
 */
export const OPERATION_MASKS = Object.freeze({
  [AUDIT_OPERATIONS.RETRY_IMMEDIATE]: Object.freeze(
    Object.entries(CANONICAL_FIELDS)
      .filter(([_, def]) => def.automaticWriter === WRITERS.ONE_PASS)
      .map(([name]) => name)
  ),
  [AUDIT_OPERATIONS.REVIEW_PENDING]: Object.freeze([
    ...DURABLE_DOSSIER_FIELDS,
  ]),
  [AUDIT_OPERATIONS.RECHECK_MISSING]: Object.freeze([
    'relationshipDynamic',
    'canonicalAppearance',
    'personality',
    'behavioralProfile',
    'speech',
    'mannerisms',
    'role',
    'species',
    'background',
    'actualAge',
    'apparentAge',
    'birthday',
  ]),
  [AUDIT_OPERATIONS.REFRESH_DOSSIER]: Object.freeze([
    ...DURABLE_DOSSIER_FIELDS,
  ]),
  [AUDIT_OPERATIONS.RECOVERY_REBUILD]: Object.freeze(
    Object.entries(CANONICAL_FIELDS)
      .filter(([_, def]) => def.automaticWriter !== null && def.automaticWriter !== WRITERS.RUNTIME)
      .map(([name]) => name)
  ),
});

export const FIELD_OUTCOME_ALLOWED_KEYS = Object.freeze([
  'field',
  'outcome',
  'reason',
]);

/**
 * Validates a field-level audit outcome record.
 * Optionally validates eligibility for a specific operation.
 * @param {object} outcomeRecord
 * @param {string} [operation]
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFieldOutcome(outcomeRecord, operation) {
  if (!outcomeRecord || typeof outcomeRecord !== 'object' || Array.isArray(outcomeRecord)) {
    return { valid: false, error: 'Field outcome record must be an object.' };
  }

  for (const key of Object.keys(outcomeRecord)) {
    if (!FIELD_OUTCOME_ALLOWED_KEYS.includes(key)) {
      return {
        valid: false,
        error: `Unknown key '${key}' in field outcome record. Allowed keys: ${FIELD_OUTCOME_ALLOWED_KEYS.join(', ')}.`,
      };
    }
  }

  const { field, outcome, reason } = outcomeRecord;
  if (typeof field !== 'string' || field.trim() === '') {
    return { valid: false, error: 'Field outcome record must specify a non-empty field name string.' };
  }

  const baseField = field.split('.')[0];
  if (!CANONICAL_FIELDS[baseField]) {
    return {
      valid: false,
      error: `Field '${field}' is not a recognized canonical field.`,
    };
  }

  if (operation !== undefined) {
    if (!AUDIT_OPERATIONS_LIST.includes(operation)) {
      return {
        valid: false,
        error: `Unknown audit operation '${operation}'. Allowed operations: ${AUDIT_OPERATIONS_LIST.join(', ')}.`,
      };
    }
    const mask = OPERATION_MASKS[operation];
    if (mask && !mask.includes(baseField)) {
      return {
        valid: false,
        error: `Field '${field}' is not eligible for audit operation '${operation}'.`,
      };
    }
  }

  if (!Object.values(AUDIT_OUTCOMES).includes(outcome)) {
    return {
      valid: false,
      error: `Invalid audit outcome '${outcome}'. Allowed values: ${Object.values(AUDIT_OUTCOMES).join(', ')}.`,
    };
  }

  if (reason !== undefined && (typeof reason !== 'string' || reason.trim() === '')) {
    return { valid: false, error: 'Outcome reason, if provided, must be a non-empty string.' };
  }

  return { valid: true };
}

/**
 * Checks whether an operation requires exhaustive field accounting.
 * Routine REVIEW_PENDING and RETRY_IMMEDIATE do not.
 * REFRESH_DOSSIER requires exhaustive accounting for eligible target fields.
 * @param {string} operation
 * @returns {boolean}
 */
export function requiresExhaustiveAccounting(operation) {
  if (!AUDIT_OPERATIONS_LIST.includes(operation)) {
    throw new Error(`Unknown audit operation: '${operation}'. Allowed operations: ${AUDIT_OPERATIONS_LIST.join(', ')}.`);
  }
  return operation === AUDIT_OPERATIONS.REFRESH_DOSSIER;
}
