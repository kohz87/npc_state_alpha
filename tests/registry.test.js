import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WRITERS,
  DOMAINS,
  CANONICAL_FIELDS,
  getFieldDefinition,
  getAllFieldNames,
  getFieldsByWriter,
  isFieldAllowedForWriter,
  validateWriterAuthority,
  assertWriterAuthority,
} from '../src/contract/registry.js';
import { validateOnePassEnvelope } from '../src/contract/validator.js';

test('C02 Registry: Canonical ownership matrix preserves exact C02 rules', () => {
  // One-Pass Automatic Writers
  assert.equal(CANONICAL_FIELDS.id.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.localRef.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.name.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.present.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.activeInExchange.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.offscreenActivity.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.mood.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.location.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.goal.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.status.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.currentPresentation.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.currentForm.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.relationshipEvaluation.automaticWriter, WRITERS.ONE_PASS);
  assert.equal(CANONICAL_FIELDS.lifeState.automaticWriter, WRITERS.ONE_PASS);

  // Development Scan Automatic Writers
  assert.equal(CANONICAL_FIELDS.relationshipDynamic.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.canonicalAppearance.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.appearanceForms.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.personality.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.behavioralProfile.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.speech.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.mannerisms.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.role.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.species.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.background.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.actualAge.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.apparentAge.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.birthday.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.importantMemories.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.nonPlayerRelationships.automaticWriter, WRITERS.DEVELOPMENT);
  assert.equal(CANONICAL_FIELDS.observations.automaticWriter, WRITERS.DEVELOPMENT);

  // Runtime Bookkeeping Owned (C02, C08 - NOT Development automatic fields)
  assert.equal(CANONICAL_FIELDS.acceptedSupport.automaticWriter, WRITERS.RUNTIME);
  assert.equal(CANONICAL_FIELDS.reviewReceipts.automaticWriter, WRITERS.RUNTIME);
  assert.deepEqual(CANONICAL_FIELDS.acceptedSupport.allowedWriters, [WRITERS.RUNTIME]);
  assert.deepEqual(CANONICAL_FIELDS.reviewReceipts.allowedWriters, [WRITERS.RUNTIME]);

  // Runtime and User-Owned Only (No Automatic Model Writer)
  assert.equal(CANONICAL_FIELDS.portrait.automaticWriter, null);
  assert.equal(CANONICAL_FIELDS.importance.automaticWriter, null);
  assert.equal(CANONICAL_FIELDS.locks.automaticWriter, null);
  assert.equal(CANONICAL_FIELDS.manualCorrections.automaticWriter, null);
  assert.deepEqual(CANONICAL_FIELDS.manualCorrections.allowedWriters, [WRITERS.USER, WRITERS.RUNTIME]);
});

test('C02 Registry: Automatic writers are strictly disjoint', () => {
  const onePassFields = getFieldsByWriter(WRITERS.ONE_PASS);
  const devFields = getFieldsByWriter(WRITERS.DEVELOPMENT);

  const overlap = onePassFields.filter((f) => devFields.includes(f));
  assert.equal(overlap.length, 0, `Disjoint ownership violation: overlapping fields: ${overlap.join(', ')}`);
});

test('C02 Registry: Authority validation and wrong-writer rejection', () => {
  // Valid one-pass writes
  assert.ok(isFieldAllowedForWriter('mood', WRITERS.ONE_PASS));
  assert.ok(isFieldAllowedForWriter('location', WRITERS.ONE_PASS));
  assert.ok(isFieldAllowedForWriter('currentPresentation', WRITERS.ONE_PASS));
  assert.ok(validateWriterAuthority('mood', WRITERS.ONE_PASS).valid);

  // Wrong writer: one-pass attempting development fields
  const onePassAttemptDev = validateWriterAuthority('personality', WRITERS.ONE_PASS);
  assert.equal(onePassAttemptDev.valid, false);
  assert.match(onePassAttemptDev.error, /Wrong-writer rejection/);

  const onePassAttemptDynamic = validateWriterAuthority('relationshipDynamic', WRITERS.ONE_PASS);
  assert.equal(onePassAttemptDynamic.valid, false);
  assert.match(onePassAttemptDynamic.error, /Wrong-writer rejection/);

  // Wrong writer: development attempting one-pass fields
  const devAttemptMood = validateWriterAuthority('mood', WRITERS.DEVELOPMENT);
  assert.equal(devAttemptMood.valid, false);
  assert.match(devAttemptMood.error, /Wrong-writer rejection/);

  const devAttemptLifeState = validateWriterAuthority('lifeState', WRITERS.DEVELOPMENT);
  assert.equal(devAttemptLifeState.valid, false);
  assert.match(devAttemptLifeState.error, /Wrong-writer rejection/);

  // Automatic model writer attempting user-only field
  const onePassAttemptLock = validateWriterAuthority('locks', WRITERS.ONE_PASS);
  assert.equal(onePassAttemptLock.valid, false);
  assert.match(onePassAttemptLock.error, /strictly/);

  // Automatic model writer attempting runtime-only bookkeeping
  const devAttemptReceipts = validateWriterAuthority('reviewReceipts', WRITERS.DEVELOPMENT);
  assert.equal(devAttemptReceipts.valid, false);
  assert.match(devAttemptReceipts.error, /Wrong-writer rejection/);

  const devAttemptSupport = validateWriterAuthority('acceptedSupport', WRITERS.DEVELOPMENT);
  assert.equal(devAttemptSupport.valid, false);
  assert.match(devAttemptSupport.error, /Wrong-writer rejection/);

  // Separated personality fields: behavioralProfile, speech, mannerisms
  assert.ok(validateWriterAuthority('personality', WRITERS.DEVELOPMENT).valid);
  assert.ok(validateWriterAuthority('behavioralProfile', WRITERS.DEVELOPMENT).valid);
  assert.ok(validateWriterAuthority('speech', WRITERS.DEVELOPMENT).valid);
  assert.ok(validateWriterAuthority('mannerisms', WRITERS.DEVELOPMENT).valid);

  // assertWriterAuthority throws on error
  assert.throws(() => {
    assertWriterAuthority('role', WRITERS.ONE_PASS);
  }, /Wrong-writer rejection/);

  assert.doesNotThrow(() => {
    assertWriterAuthority('role', WRITERS.DEVELOPMENT);
  });
});

test('C02 Registry / One-Pass: currentForm registry nullability and validator handling', () => {
  // 1. Check CANONICAL_FIELDS.currentForm.nullable === true
  assert.equal(CANONICAL_FIELDS.currentForm.nullable, true);
  assert.equal(getFieldDefinition('currentForm').nullable, true);

  // 2. Validator accepts currentForm: null (with valid source evidence)
  const validNullForm = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_hooded_stranger_01',
        currentForm: null,
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'The stranger cast off all disguises.',
        },
      },
    ],
  });
  assert.equal(validNullForm.valid, true, JSON.stringify(validNullForm.errors));

  // 3. Validator accepts currentForm: 'wolf_form' (with valid source evidence)
  const validStringForm = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_hooded_stranger_01',
        currentForm: 'wolf_form',
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'The stranger shifted into a great grey wolf.',
        },
      },
    ],
  });
  assert.equal(validStringForm.valid, true, JSON.stringify(validStringForm.errors));

  // 4. Validator rejects non-string / non-null values (e.g. number, boolean, object, empty string)
  for (const badVal of [123, true, {}, '   ']) {
    const invalidForm = validateOnePassEnvelope({
      version: '1',
      proposals: [
        {
          id: 'npc_hooded_stranger_01',
          currentForm: badVal,
          source: {
            sourceRef: 'current:assistant',
            excerpt: 'The stranger shifted.',
          },
        },
      ],
    });
    assert.equal(invalidForm.valid, false, `Expected currentForm: ${JSON.stringify(badVal)} to be rejected`);
  }
});


