import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_OUTCOMES,
  AUDIT_OPERATIONS,
  AUDIT_OPERATIONS_LIST,
  OPERATION_MASKS,
  FIELD_OUTCOME_ALLOWED_KEYS,
  validateFieldOutcome,
  requiresExhaustiveAccounting,
} from '../src/contract/audit-modes.js';

test('Audit Modes: Validates field-level outcome records', () => {
  const validApplied = { field: 'personality', outcome: AUDIT_OUTCOMES.APPLIED, reason: 'Refined traits' };
  assert.equal(validateFieldOutcome(validApplied).valid, true);

  const validUnchanged = { field: 'role', outcome: AUDIT_OUTCOMES.UNCHANGED };
  assert.equal(validateFieldOutcome(validUnchanged).valid, true);

  const validInsufficient = { field: 'species', outcome: AUDIT_OUTCOMES.INSUFFICIENT, reason: 'No species clues in scene' };
  assert.equal(validateFieldOutcome(validInsufficient).valid, true);

  const invalidOutcome = { field: 'species', outcome: 'guessed' };
  const res = validateFieldOutcome(invalidOutcome);
  assert.equal(res.valid, false);
  assert.match(res.error, /Invalid audit outcome/);
});

test('Audit Modes: Routine review does not require exhaustive accounting, Refresh dossier does', () => {
  assert.equal(requiresExhaustiveAccounting(AUDIT_OPERATIONS.REVIEW_PENDING), false);
  assert.equal(requiresExhaustiveAccounting(AUDIT_OPERATIONS.RETRY_IMMEDIATE), false);
  assert.equal(requiresExhaustiveAccounting(AUDIT_OPERATIONS.REFRESH_DOSSIER), true);
});

test('Audit Modes: Masks accurately cover operational scopes', () => {
  const fastMask = OPERATION_MASKS[AUDIT_OPERATIONS.RETRY_IMMEDIATE];
  assert.ok(fastMask.includes('mood'));
  assert.ok(fastMask.includes('location'));
  assert.ok(!fastMask.includes('personality'));

  const devMask = OPERATION_MASKS[AUDIT_OPERATIONS.REVIEW_PENDING];
  assert.ok(devMask.includes('personality'));
  assert.ok(devMask.includes('behavioralProfile'));
  assert.ok(devMask.includes('speech'));
  assert.ok(devMask.includes('mannerisms'));
  assert.ok(devMask.includes('role'));
  assert.ok(!devMask.includes('mood'));
  // C02 Invariant: reviewReceipts and acceptedSupport are runtime-owned and NOT in Development audit mask
  assert.ok(!devMask.includes('reviewReceipts'), 'reviewReceipts must not be in Development audit mask');
  assert.ok(!devMask.includes('acceptedSupport'), 'acceptedSupport must not be in Development audit mask');

  const refreshMask = OPERATION_MASKS[AUDIT_OPERATIONS.REFRESH_DOSSIER];
  assert.ok(refreshMask.includes('importantMemories'));
  assert.ok(refreshMask.includes('canonicalAppearance'));
  assert.ok(refreshMask.includes('behavioralProfile'));
  assert.ok(refreshMask.includes('speech'));
  assert.ok(refreshMask.includes('mannerisms'));
  assert.ok(!refreshMask.includes('reviewReceipts'));
  assert.ok(!refreshMask.includes('acceptedSupport'));
  assert.ok(!refreshMask.includes('observations'));

  const recoveryMask = OPERATION_MASKS[AUDIT_OPERATIONS.RECOVERY_REBUILD];
  assert.ok(recoveryMask.includes('mood'));
  assert.ok(recoveryMask.includes('personality'));
  assert.ok(recoveryMask.includes('importantMemories'));
  // Recovery rebuild mask strictly excludes runtime bookkeeping
  assert.ok(!recoveryMask.includes('acceptedSupport'), 'acceptedSupport must not be in RECOVERY_REBUILD mask');
  assert.ok(!recoveryMask.includes('reviewReceipts'), 'reviewReceipts must not be in RECOVERY_REBUILD mask');
});

test('Audit Modes: validateFieldOutcome rejects unknown or ineligible fields for the operation', () => {
  // Unknown field
  const unknownRes = validateFieldOutcome({ field: 'unknownField123', outcome: AUDIT_OUTCOMES.APPLIED });
  assert.equal(unknownRes.valid, false);
  assert.match(unknownRes.error, /not a recognized canonical field/);

  // Ineligible field for operation: 'mood' during REFRESH_DOSSIER
  const wrongOpRes = validateFieldOutcome(
    { field: 'mood', outcome: AUDIT_OUTCOMES.APPLIED },
    AUDIT_OPERATIONS.REFRESH_DOSSIER
  );
  assert.equal(wrongOpRes.valid, false);
  assert.match(wrongOpRes.error, /not eligible for audit operation/);

  // Eligible field for operation: 'personality' during REFRESH_DOSSIER
  const validOpRes = validateFieldOutcome(
    { field: 'personality', outcome: AUDIT_OUTCOMES.APPLIED },
    AUDIT_OPERATIONS.REFRESH_DOSSIER
  );
  assert.equal(validOpRes.valid, true);

  // MEDIUM 6: Rejection of unknown audit operation
  const unknownOpRes = validateFieldOutcome(
    { field: 'personality', outcome: AUDIT_OUTCOMES.APPLIED },
    'unauthorized_audit_op'
  );
  assert.equal(unknownOpRes.valid, false);
  assert.match(unknownOpRes.error, /Unknown audit operation/);
});

test('Audit Modes (Strictness Pass): requiresExhaustiveAccounting fails closed on unknown operations', () => {
  // AUDIT_OPERATIONS_LIST is exported and complete
  assert.ok(Array.isArray(AUDIT_OPERATIONS_LIST));
  assert.equal(AUDIT_OPERATIONS_LIST.length, Object.values(AUDIT_OPERATIONS).length);
  for (const op of Object.values(AUDIT_OPERATIONS)) {
    assert.ok(AUDIT_OPERATIONS_LIST.includes(op));
  }

  // Unknown operations throw Error
  for (const badOp of ['unknown_op', '', null, undefined, 123, false]) {
    assert.throws(
      () => requiresExhaustiveAccounting(badOp),
      (err) => {
        assert.match(err.message, /Unknown audit operation/);
        return true;
      },
      `Expected requiresExhaustiveAccounting(${JSON.stringify(badOp)}) to throw Error`
    );
  }
});

test('Audit Modes (Strictness Pass): validateFieldOutcome strictly enforces object shape, allowed keys, non-empty field, and non-empty reason', () => {
  // Non-object / array rejections
  assert.equal(validateFieldOutcome(null).valid, false);
  assert.equal(validateFieldOutcome(undefined).valid, false);
  assert.equal(validateFieldOutcome('string').valid, false);
  assert.equal(validateFieldOutcome([]).valid, false);
  assert.match(validateFieldOutcome([]).error, /Field outcome record must be an object/);

  // FIELD_OUTCOME_ALLOWED_KEYS checks
  assert.ok(Array.isArray(FIELD_OUTCOME_ALLOWED_KEYS));
  assert.ok(Object.isFrozen(FIELD_OUTCOME_ALLOWED_KEYS));
  assert.deepEqual([...FIELD_OUTCOME_ALLOWED_KEYS].sort(), ['field', 'outcome', 'reason'].sort());

  // Unknown keys rejected
  const unknownKeyRes = validateFieldOutcome({
    field: 'personality',
    outcome: AUDIT_OUTCOMES.APPLIED,
    extraKey: 'bad',
  });
  assert.equal(unknownKeyRes.valid, false);
  assert.match(unknownKeyRes.error, /Unknown key 'extraKey'/);

  // Empty string field rejected
  assert.equal(validateFieldOutcome({ field: '', outcome: AUDIT_OUTCOMES.APPLIED }).valid, false);
  assert.equal(validateFieldOutcome({ field: '   ', outcome: AUDIT_OUTCOMES.APPLIED }).valid, false);
  assert.equal(validateFieldOutcome({ field: 123, outcome: AUDIT_OUTCOMES.APPLIED }).valid, false);

  // Empty or non-string reason rejected when provided
  assert.equal(validateFieldOutcome({ field: 'personality', outcome: AUDIT_OUTCOMES.APPLIED, reason: '' }).valid, false);
  assert.equal(validateFieldOutcome({ field: 'personality', outcome: AUDIT_OUTCOMES.APPLIED, reason: '   ' }).valid, false);
  assert.equal(validateFieldOutcome({ field: 'personality', outcome: AUDIT_OUTCOMES.APPLIED, reason: 123 }).valid, false);

  // Non-empty string reason accepted
  assert.equal(validateFieldOutcome({ field: 'personality', outcome: AUDIT_OUTCOMES.APPLIED, reason: 'valid reason' }).valid, true);
});


