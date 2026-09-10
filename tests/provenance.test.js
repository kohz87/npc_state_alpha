import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOwnedSourceRecord,
  OWNED_SOURCE_RECORD_ALLOWED_KEYS,
} from '../src/contract/validator.js';

test('Provenance: valid chat source record passes validation', () => {
  const record = {
    chatId: 'chat_session_001',
    position: 3,
    role: 'assistant',
    contentFingerprint: 'sha256:abc123def456',
    precedingLineage: ['msg:0', 'msg:1', 'msg:2'],
  };
  const res = validateOwnedSourceRecord(record);
  assert.equal(res.valid, true, res.error);
});

test('Provenance: valid sidecar source record passes validation', () => {
  const record = {
    sidecarId: 'sidecar_summary_001',
    position: 0,
    role: 'system',
    contentFingerprint: 'sha256:sidecar789',
    precedingLineage: [],
  };
  const res = validateOwnedSourceRecord(record);
  assert.equal(res.valid, true, res.error);
});

test('Provenance: valid record with swipe and revision passes validation', () => {
  const record = {
    chatId: 'chat_session_001',
    position: 4,
    role: 'user',
    contentFingerprint: 'sha256:user123',
    swipe: 2,
    revision: 1,
    precedingLineage: ['msg:0', 'msg:1', 'msg:2', 'msg:3'],
  };
  const res = validateOwnedSourceRecord(record);
  assert.equal(res.valid, true, res.error);
});

test('Provenance: valid record with precedingLineage passes validation', () => {
  const recordWithArray = {
    chatId: 'chat_session_001',
    position: 2,
    role: 'assistant',
    contentFingerprint: 'sha256:fp001',
    precedingLineage: ['msg:0', 'msg:1'],
  };
  assert.equal(validateOwnedSourceRecord(recordWithArray).valid, true);

  const recordWithString = {
    chatId: 'chat_session_001',
    position: 2,
    role: 'assistant',
    contentFingerprint: 'sha256:fp001',
    precedingLineage: 'root->branch1->msg2',
  };
  const res = validateOwnedSourceRecord(recordWithString);
  assert.equal(res.valid, false);
  assert.match(res.error, /must be an array/);
});

test('Provenance: non-object inputs are rejected', () => {
  assert.equal(validateOwnedSourceRecord(null).valid, false);
  assert.equal(validateOwnedSourceRecord(undefined).valid, false);
  assert.equal(validateOwnedSourceRecord('not_an_object').valid, false);
  assert.equal(validateOwnedSourceRecord(123).valid, false);
});

test('Provenance: missing both chatId and sidecarId is rejected', () => {
  const res = validateOwnedSourceRecord({
    position: 0,
    role: 'assistant',
    contentFingerprint: 'fp',
  });
  assert.equal(res.valid, false);
  assert.match(res.error, /chatId.*sidecarId/);
});

test('Provenance: empty chatId or sidecarId is rejected', () => {
  assert.equal(validateOwnedSourceRecord({
    chatId: '   ',
    position: 0,
    role: 'assistant',
    contentFingerprint: 'fp',
  }).valid, false);
});

test('Provenance: invalid position values are rejected', () => {
  const base = {
    chatId: 'chat_01',
    role: 'assistant',
    contentFingerprint: 'fp',
    precedingLineage: [],
  };
  assert.equal(validateOwnedSourceRecord({ ...base, position: -1 }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, position: 1.5 }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, position: '2' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base }).valid, false);
});

test('Provenance: invalid role values are rejected', () => {
  const base = {
    chatId: 'chat_01',
    position: 0,
    contentFingerprint: 'fp',
    precedingLineage: [],
  };
  assert.equal(validateOwnedSourceRecord({ ...base, role: 'developer' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, role: 'model' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, role: '' }).valid, false);
});

test('Provenance: invalid contentFingerprint values are rejected', () => {
  const base = {
    chatId: 'chat_01',
    position: 0,
    role: 'assistant',
    precedingLineage: [],
  };
  assert.equal(validateOwnedSourceRecord({ ...base, contentFingerprint: '' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, contentFingerprint: '   ' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, contentFingerprint: 123 }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base }).valid, false);
});

test('Provenance: invalid swipe or revision values are rejected', () => {
  const base = {
    chatId: 'chat_01',
    position: 0,
    role: 'assistant',
    contentFingerprint: 'fp',
    precedingLineage: [],
  };
  assert.equal(validateOwnedSourceRecord({ ...base, swipe: true }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, swipe: {} }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, revision: false }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, revision: [] }).valid, false);
});

test('Provenance: invalid precedingLineage is rejected', () => {
  const base = {
    chatId: 'chat_01',
    position: 0,
    role: 'assistant',
    contentFingerprint: 'fp',
  };
  assert.equal(validateOwnedSourceRecord({ ...base, precedingLineage: 123 }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, precedingLineage: {} }).valid, false);
});

test('Provenance: array record is rejected', () => {
  assert.equal(validateOwnedSourceRecord([]).valid, false);
  assert.match(validateOwnedSourceRecord([]).error, /must be an object/);
});

test('Provenance: unknown keys are rejected and allowed keys exported', () => {
  const base = {
    chatId: 'chat_01',
    position: 0,
    role: 'assistant',
    contentFingerprint: 'fp',
    precedingLineage: [],
  };
  const withUnknown = { ...base, invalidProp: true };
  const res = validateOwnedSourceRecord(withUnknown);
  assert.equal(res.valid, false);
  assert.match(res.error, /Unknown key 'invalidProp'/);

  assert.ok(Array.isArray(OWNED_SOURCE_RECORD_ALLOWED_KEYS));
  assert.ok(Object.isFrozen(OWNED_SOURCE_RECORD_ALLOWED_KEYS));
  assert.deepEqual([...OWNED_SOURCE_RECORD_ALLOWED_KEYS].sort(), [
    'chatId',
    'contentFingerprint',
    'position',
    'precedingLineage',
    'revision',
    'role',
    'sidecarId',
    'swipe',
  ].sort());
});

test('Provenance: valid sibling cannot mask malformed supplied sibling (chatId and sidecarId)', () => {
  const base = {
    position: 0,
    role: 'assistant',
    contentFingerprint: 'fp',
    precedingLineage: [],
  };

  // Valid chatId with malformed sidecarId
  assert.equal(validateOwnedSourceRecord({ ...base, chatId: 'chat_01', sidecarId: '' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, chatId: 'chat_01', sidecarId: '   ' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, chatId: 'chat_01', sidecarId: 123 }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, chatId: 'chat_01', sidecarId: null }).valid, false);

  // Valid sidecarId with malformed chatId
  assert.equal(validateOwnedSourceRecord({ ...base, sidecarId: 'sidecar_01', chatId: '' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, sidecarId: 'sidecar_01', chatId: '   ' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, sidecarId: 'sidecar_01', chatId: 123 }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, sidecarId: 'sidecar_01', chatId: null }).valid, false);

  // Both valid
  assert.equal(validateOwnedSourceRecord({ ...base, chatId: 'chat_01', sidecarId: 'sidecar_01' }).valid, true);
});

test('Provenance: empty or malformed precedingLineage variants are rejected', () => {
  const base = {
    chatId: 'chat_01',
    position: 0,
    role: 'assistant',
    contentFingerprint: 'fp',
  };
  // position 0 with [] is valid root
  assert.equal(validateOwnedSourceRecord({ ...base, precedingLineage: [] }).valid, true);
  // position 0 with non-empty array is rejected
  assert.equal(validateOwnedSourceRecord({ ...base, precedingLineage: ['msg:0'] }).valid, false);

  // position 1 with [] is rejected
  assert.equal(validateOwnedSourceRecord({ ...base, position: 1, precedingLineage: [] }).valid, false);
  // position 1 with non-empty array is valid
  assert.equal(validateOwnedSourceRecord({ ...base, position: 1, precedingLineage: ['msg:0'] }).valid, true);

  // malformed variants
  assert.equal(validateOwnedSourceRecord({ ...base, precedingLineage: '' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, precedingLineage: '   ' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, precedingLineage: 'root->branch' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, precedingLineage: [''] }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, precedingLineage: ['   '] }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, precedingLineage: [123] }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, precedingLineage: ['valid_ref', ''] }).valid, false);

  // omitted precedingLineage is rejected
  assert.equal(validateOwnedSourceRecord(base).valid, false);
  assert.match(validateOwnedSourceRecord(base).error, /requires explicit 'precedingLineage'/);
});

test('Provenance: swipe and revision reject negative, fractional, empty strings, and accept non-empty strings', () => {
  const base = {
    chatId: 'chat_01',
    position: 0,
    role: 'assistant',
    contentFingerprint: 'fp',
    precedingLineage: [],
  };

  // Rejections for swipe
  assert.equal(validateOwnedSourceRecord({ ...base, swipe: -1 }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, swipe: 1.5 }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, swipe: '' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, swipe: '   ' }).valid, false);

  // Rejections for revision
  assert.equal(validateOwnedSourceRecord({ ...base, revision: -1 }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, revision: 2.2 }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, revision: '' }).valid, false);
  assert.equal(validateOwnedSourceRecord({ ...base, revision: '   ' }).valid, false);

  // String values accepted
  assert.equal(validateOwnedSourceRecord({ ...base, swipe: 'swipe_0' }).valid, true);
  assert.equal(validateOwnedSourceRecord({ ...base, revision: 'rev_1a' }).valid, true);
  assert.equal(validateOwnedSourceRecord({ ...base, swipe: 0, revision: 0 }).valid, true);
});
