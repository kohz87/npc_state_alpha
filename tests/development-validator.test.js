import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDevelopmentEnvelope,
  validatePersistedObservationRecord,
  validatePersistedAcceptedSupportRecord,
  VALIDATION_ERROR_CODES,
} from '../src/contract/validator.js';
import {
  validDevelopmentEstablishment,
  validDevelopmentEnrichment,
  validObservationsWithDispositions,
  validNarrowReviewReceipt,
  validNoOpReceipt,
  invalidDevelopmentWritingImmediate,
  invalidDurableStructuredOnly,
  invalidObservationWithPersistentId,
  invalidObservationDuplicateLocalRef,
  invalidDispositionMissingLink,
  invalidUnrestrictedReceiptWithFieldSubset,
  invalidRestrictedReceiptWithInternalBookkeeping,
  invalidSupportProposalMissingObservation,
  invalidSupportProposalTargetMismatch,
  invalidSupportProposalFieldMismatch,
  invalidDevelopmentUnknownTopLevelKey,
  invalidDevelopmentUnknownProposalKey,
  invalidPersonalitySmugglingSpeech,
  invalidPersonalitySmugglingMannerisms,
  invalidPersonalitySmugglingBehavioralProfile,
  invalidPersonalityUnknownKey,
  validDurableDomainsFixture,
  invalidAppearanceFormUnknownKey,
  invalidAppearanceFormMissingId,
  invalidMemoryMissingText,
  invalidMemoryUnknownKey,
  invalidNonPlayerRelationshipMissingTarget,
  invalidNonPlayerRelationshipUnknownKey,
  invalidScalarOperation,
  invalidCollectionOperation,
  invalidWorldStateCanonicalAppearanceProposal,
  invalidWorldStatePersonalityProposal,
  invalidWorldStateMemoryProposal,
  invalidWorldStateFormProposal,
  invalidWorldStateNonPlayerRelationProposal,
  invalidWorldStateRelationshipDynamicProposal,
  validInnerChatterRelationshipDynamicProposal,
  invalidWorldStateObservationField,
  invalidSelfCitationDurableSource,
  invalidMalformedDurableSource,
  invalidDevelopmentWithAcceptedSupport,
  invalidAppearanceFormDestructiveLocalOnly,
  validAppearanceFormDestructiveStableFormId,
  invalidMemoryDestructiveLocalOnly,
  validMemoryDestructiveStableMemoryId,
  invalidNonPlayerRelationshipDestructiveLocalOnly,
  validNonPlayerRelationshipDestructiveStableRelationId,
} from './fixtures/development-fixtures.js';

test('Development Validator: direct durable establishment on first review is valid', () => {
  const res = validateDevelopmentEnvelope(validDevelopmentEstablishment);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('Development Validator: later enrichment refining established traits is valid', () => {
  const res = validateDevelopmentEnvelope(validDevelopmentEnrichment);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('Development Validator: C08 observations with dispositions and accepted support are valid', () => {
  const res = validateDevelopmentEnvelope(validObservationsWithDispositions);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('Development Validator: narrow review receipt with fieldSubset is valid', () => {
  const res = validateDevelopmentEnvelope(validNarrowReviewReceipt);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('Development Validator: target/no-op receipt (reviewed_no_proposals) is valid', () => {
  const res = validateDevelopmentEnvelope(validNoOpReceipt);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('Development Validator: wrong-writer rejection when development envelope contains fast fields', () => {
  const res = validateDevelopmentEnvelope(invalidDevelopmentWritingImmediate);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.WRONG_WRITER));
});

test('Development Validator: rejects structured-only durable fact modification', () => {
  const res = validateDevelopmentEnvelope(invalidDurableStructuredOnly);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('Development Validator: model observation cannot author persistent ID', () => {
  const res = validateDevelopmentEnvelope(invalidObservationWithPersistentId);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OBSERVATION));
  assert.match(res.errors[0].errorMessage, /persistent observation 'id'/);
});

test('Development Validator: duplicate localObservationRef rejected in same envelope', () => {
  const res = validateDevelopmentEnvelope(invalidObservationDuplicateLocalRef);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.DUPLICATE_LOCAL_REF));
});

test('Development Validator: disposition missing required linked references is rejected', () => {
  const res = validateDevelopmentEnvelope(invalidDispositionMissingLink);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OBSERVATION));
});

test('Development Validator: unrestricted receipt cannot carry fieldSubset', () => {
  const res = validateDevelopmentEnvelope(invalidUnrestrictedReceiptWithFieldSubset);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RECEIPT));
  assert.match(res.errors[0].errorMessage, /Unrestricted review receipt cannot specify 'fieldSubset'/);
});

test('Development Validator: restricted receipt with runtime bookkeeping in fieldSubset rejected', () => {
  const res = validateDevelopmentEnvelope(invalidRestrictedReceiptWithInternalBookkeeping);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RECEIPT));
});

test('Development Validator: support proposal referencing missing observation rejected', () => {
  const res = validateDevelopmentEnvelope(invalidSupportProposalMissingObservation);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT));
  assert.match(res.errors[0].errorMessage, /references missing observation/);
});

test('Development Validator: support proposal target mismatch rejected', () => {
  const res = validateDevelopmentEnvelope(invalidSupportProposalTargetMismatch);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT));
  assert.match(res.errors[0].errorMessage, /Target mismatch/);
});

test('Development Validator: support proposal field mismatch rejected', () => {
  const res = validateDevelopmentEnvelope(invalidSupportProposalFieldMismatch);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT));
  assert.match(res.errors[0].errorMessage, /Field mismatch/);
});

test('Development Validator: unknown top-level key rejected', () => {
  const res = validateDevelopmentEnvelope(invalidDevelopmentUnknownTopLevelKey);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Development Validator: unknown proposal key rejected', () => {
  const res = validateDevelopmentEnvelope(invalidDevelopmentUnknownProposalKey);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Development Validator: persisted observation record validation', () => {
  const validPersisted = {
    id: 'obs_stable_uuid_01',
    targetId: 'npc_elena_101',
    field: 'personality',
    observation: 'Prefers reading alone',
    source: { sourceRef: 'msg:1', excerpt: 'She read alone.' },
  };
  assert.equal(validatePersistedObservationRecord(validPersisted).valid, true);

  const missingId = { ...validPersisted, id: '' };
  assert.equal(validatePersistedObservationRecord(missingId).valid, false);
});

test('Development Validator: persisted accepted support requires committed fieldRevision reference (C08)', () => {
  const validAcceptedSupport = {
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    fieldRevision: 'rev_elena_mannerisms_01', // Committed revision reference required by C08!
    supportingObservationIds: ['obs_stable_uuid_01'],
    sourceRefs: ['msg:1'],
  };
  assert.equal(validatePersistedAcceptedSupportRecord(validAcceptedSupport).valid, true);

  const missingRevision = {
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    supportingObservationIds: ['obs_stable_uuid_01'],
  };
  const res = validatePersistedAcceptedSupportRecord(missingRevision);
  assert.equal(res.valid, false);
  assert.match(res.error, /fieldRevision/);
});

test('Development Validator (M-01): rejects smuggled facets inside personality object', () => {
  const speechRes = validateDevelopmentEnvelope(invalidPersonalitySmugglingSpeech);
  assert.equal(speechRes.valid, false);
  assert.ok(speechRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
  assert.match(speechRes.errors[0].errorMessage, /Unknown or unauthorized key 'speech'/);

  const manRes = validateDevelopmentEnvelope(invalidPersonalitySmugglingMannerisms);
  assert.equal(manRes.valid, false);
  assert.ok(manRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
  assert.match(manRes.errors[0].errorMessage, /Unknown or unauthorized key 'mannerisms'/);

  const bpRes = validateDevelopmentEnvelope(invalidPersonalitySmugglingBehavioralProfile);
  assert.equal(bpRes.valid, false);
  assert.ok(bpRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
  assert.match(bpRes.errors[0].errorMessage, /Unknown or unauthorized key 'behavioralProfile'/);

  const unkRes = validateDevelopmentEnvelope(invalidPersonalityUnknownKey);
  assert.equal(unkRes.valid, false);
  assert.ok(unkRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Development Validator (M-02): validates full durable domains (forms, memories, NPR, profile)', () => {
  const validRes = validateDevelopmentEnvelope(validDurableDomainsFixture);
  assert.equal(validRes.valid, true, JSON.stringify(validRes.errors));
});

test('Development Validator (M-02): rejects invalid appearance form shapes', () => {
  const unkRes = validateDevelopmentEnvelope(invalidAppearanceFormUnknownKey);
  assert.equal(unkRes.valid, false);
  assert.ok(unkRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));

  const missRes = validateDevelopmentEnvelope(invalidAppearanceFormMissingId);
  assert.equal(missRes.valid, false);
  assert.ok(missRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD));
});

test('Development Validator (M-02): rejects invalid important memory shapes', () => {
  const missRes = validateDevelopmentEnvelope(invalidMemoryMissingText);
  assert.equal(missRes.valid, false);
  assert.ok(missRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD));

  const unkRes = validateDevelopmentEnvelope(invalidMemoryUnknownKey);
  assert.equal(unkRes.valid, false);
  assert.ok(unkRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Development Validator (M-02): rejects invalid non-player relationship shapes', () => {
  const missRes = validateDevelopmentEnvelope(invalidNonPlayerRelationshipMissingTarget);
  assert.equal(missRes.valid, false);
  assert.ok(missRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD));

  const unkRes = validateDevelopmentEnvelope(invalidNonPlayerRelationshipUnknownKey);
  assert.equal(unkRes.valid, false);
  assert.ok(unkRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Development Validator (M-02): rejects invalid operations on durable fields', () => {
  const scalarRes = validateDevelopmentEnvelope(invalidScalarOperation);
  assert.equal(scalarRes.valid, false);
  assert.ok(scalarRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OPERATION));

  const collRes = validateDevelopmentEnvelope(invalidCollectionOperation);
  assert.equal(collRes.valid, false);
  assert.ok(collRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OPERATION));
});

test('Development Validator (H-01): rejects World_State for durable domains', () => {
  const appRes = validateDevelopmentEnvelope(invalidWorldStateCanonicalAppearanceProposal);
  assert.equal(appRes.valid, false);
  assert.ok(appRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));

  const persRes = validateDevelopmentEnvelope(invalidWorldStatePersonalityProposal);
  assert.equal(persRes.valid, false);
  assert.ok(persRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));

  const memRes = validateDevelopmentEnvelope(invalidWorldStateMemoryProposal);
  assert.equal(memRes.valid, false);
  assert.ok(memRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));

  const formRes = validateDevelopmentEnvelope(invalidWorldStateFormProposal);
  assert.equal(formRes.valid, false);
  assert.ok(formRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));

  const nprRes = validateDevelopmentEnvelope(invalidWorldStateNonPlayerRelationProposal);
  assert.equal(nprRes.valid, false);
  assert.ok(nprRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));

  const dynRes = validateDevelopmentEnvelope(invalidWorldStateRelationshipDynamicProposal);
  assert.equal(dynRes.valid, false);
  assert.ok(dynRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('Development Validator (H-01): allows Inner_Chatter for relationshipDynamic proposal', () => {
  const res = validateDevelopmentEnvelope(validInnerChatterRelationshipDynamicProposal);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('Development Validator (H-01): rejects World_State on observation against non-permitted field', () => {
  const res = validateDevelopmentEnvelope(invalidWorldStateObservationField);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('Development Validator: rejects trailer self-citation and malformed source on durable fields', () => {
  const selfRes = validateDevelopmentEnvelope(invalidSelfCitationDurableSource);
  assert.equal(selfRes.valid, false);
  assert.ok(selfRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.TRAILER_SELF_CITATION));

  const malRes = validateDevelopmentEnvelope(invalidMalformedDurableSource);
  assert.equal(malRes.valid, false);
  assert.ok(malRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));
});

test('Development Validator (L-03): rejects development envelope carrying runtime acceptedSupport', () => {
  const res = validateDevelopmentEnvelope(invalidDevelopmentWithAcceptedSupport);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.WRONG_WRITER));
  assert.match(res.errors[0].errorMessage, /acceptedSupport.*strictly runtime-owned/);
});

test('Development Validator (L-06): rejects null, array, and non-object envelopes', () => {
  const nullRes = validateDevelopmentEnvelope(null);
  assert.equal(nullRes.valid, false);
  assert.equal(nullRes.errors[0].errorCode, VALIDATION_ERROR_CODES.INVALID_ENVELOPE);

  const arrRes = validateDevelopmentEnvelope([]);
  assert.equal(arrRes.valid, false);
  assert.equal(arrRes.errors[0].errorCode, VALIDATION_ERROR_CODES.INVALID_ENVELOPE);

  const strRes = validateDevelopmentEnvelope('bad_envelope');
  assert.equal(strRes.valid, false);
  assert.equal(strRes.errors[0].errorCode, VALIDATION_ERROR_CODES.INVALID_ENVELOPE);
});

test('Development Validator (L-06): rejects envelope version mismatch', () => {
  const res = validateDevelopmentEnvelope({ version: '99', proposals: [] });
  assert.equal(res.valid, false);
  assert.equal(res.errors[0].errorCode, VALIDATION_ERROR_CODES.VERSION_MISMATCH);
});

test('Development Validator (H-01): rejects World_State source inside mannerism array item', () => {
  const proposal = {
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        mannerisms: [
          {
            value: 'Taps spectacles with quill',
            source: {
              sourceRef: 'msg:1',
              segmentKind: 'world_state',
              excerpt: 'world_state: mannerism=tap_spectacles',
            },
          },
        ],
      },
    ],
  };
  const res = validateDevelopmentEnvelope(proposal);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('Development Validator (H-01): rejects unknown item keys in mannerism array item', () => {
  const proposal = {
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        mannerisms: [
          {
            value: 'Taps spectacles with quill',
            smuggledField: 'unauthorized',
          },
        ],
      },
    ],
  };
  const res = validateDevelopmentEnvelope(proposal);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Development Validator (H-02): rejects ungrounded durable mutation lacking inline source or support proposal', () => {
  const proposal = {
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        personality: {
          traits: ['Intellectual'],
          operation: 'establish',
        },
      },
    ],
  };
  const res = validateDevelopmentEnvelope(proposal);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));
  assert.match(res.errors[0].errorMessage, /carry valid source evidence or explicit supportProposal/);
});

test('Development Validator (H-03): rejects support proposal referencing local observation absent from envelope', () => {
  const envelope = {
    version: '1',
    reviewReceipts: [
      {
        targetId: 'npc_elena_101',
        sourceScope: ['msg:1'],
        status: 'reviewed',
      },
    ],
    supportProposals: [
      {
        targetId: 'npc_elena_101',
        field: 'mannerisms',
        supportingObservationRefs: ['obs:nonexistent:01'],
      },
    ],
  };
  const res = validateDevelopmentEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT));
  assert.match(res.errors[0].errorMessage, /references missing observation/);
});

test('Development Validator (H-03): allows supportingObservationIds without local observation in envelope', () => {
  const envelope = {
    version: '1',
    reviewReceipts: [
      {
        targetId: 'npc_elena_101',
        sourceScope: ['msg:1'],
        status: 'reviewed',
      },
    ],
    proposals: [
      {
        targetId: 'npc_elena_101',
        speech: {
          value: 'Formal academic speech',
          operation: 'establish',
        },
      },
    ],
    supportProposals: [
      {
        targetId: 'npc_elena_101',
        field: 'speech',
        supportingObservationIds: ['obs_persisted_in_runtime_123'],
      },
    ],
  };
  const res = validateDevelopmentEnvelope(envelope);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('Development Validator (M-04): rejects unknown keys in review receipt', () => {
  const envelope = {
    version: '1',
    reviewReceipts: [
      {
        targetId: 'npc_elena_101',
        sourceScope: ['msg:1'],
        status: 'reviewed',
        unknownKey: 'invalid',
      },
    ],
  };
  const res = validateDevelopmentEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Development Validator (M-04): rejects unknown keys in observation', () => {
  const envelope = {
    version: '1',
    observations: [
      {
        localObservationRef: 'obs:1',
        targetId: 'npc_elena_101',
        field: 'mannerisms',
        observation: 'Taps quill',
        source: { sourceRef: 'msg:1', excerpt: 'Taps quill' },
        bogusProperty: 123,
      },
    ],
  };
  const res = validateDevelopmentEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Development Validator (M-04): rejects unknown keys in disposition', () => {
  const envelope = {
    version: '1',
    observations: [
      {
        localObservationRef: 'obs:1',
        targetId: 'npc_elena_101',
        field: 'mannerisms',
        observation: 'Taps quill',
        source: { sourceRef: 'msg:1', excerpt: 'Taps quill' },
        disposition: {
          role: 'tentative',
          extraField: 'not_allowed',
        },
      },
    ],
  };
  const res = validateDevelopmentEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Development Validator (M-04): rejects unknown keys in supportProposal', () => {
  const envelope = {
    version: '1',
    observations: [
      {
        localObservationRef: 'obs:1',
        targetId: 'npc_elena_101',
        field: 'mannerisms',
        observation: 'Taps quill',
        source: { sourceRef: 'msg:1', excerpt: 'Taps quill' },
      },
    ],
    supportProposals: [
      {
        targetId: 'npc_elena_101',
        field: 'mannerisms',
        supportingObservationRefs: ['obs:1'],
        unrecognizedKey: true,
      },
    ],
  };
  const res = validateDevelopmentEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Development Validator (M-04): rejects personality.traits containing non-string values', () => {
  const envelope = {
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        personality: {
          traits: ['Intellectual', 123],
          source: { sourceRef: 'msg:1', excerpt: 'Elena was intellectual.' },
        },
      },
    ],
  };
  const res = validateDevelopmentEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD));
});

test('Development Validator (M-04): rejects mannerisms items containing empty string values', () => {
  const envelope = {
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        mannerisms: {
          items: [''],
          source: { sourceRef: 'msg:1', excerpt: 'Elena tapped her spectacles.' },
        },
      },
    ],
  };
  const res = validateDevelopmentEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD));
});

test('Development Validator (M-04): rejects receipt.sourceScope containing non-string or empty elements', () => {
  const envelope = {
    version: '1',
    reviewReceipts: [
      {
        targetId: 'npc_elena_101',
        sourceScope: ['msg:1', ''],
        status: 'reviewed',
      },
    ],
  };
  const res = validateDevelopmentEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RECEIPT));
});

test('Development Validator (L-09): rejects observations ledger as field target in observations and supportProposals', () => {
  const obsEnvelope = {
    version: '1',
    observations: [
      {
        localObservationRef: 'obs:1',
        targetId: 'npc_elena_101',
        field: 'observations',
        observation: 'Meta-observation',
        source: { sourceRef: 'msg:1', excerpt: 'text' },
      },
    ],
  };
  const obsRes = validateDevelopmentEnvelope(obsEnvelope);
  assert.equal(obsRes.valid, false);
  assert.ok(obsRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD));

  const supEnvelope = {
    version: '1',
    supportProposals: [
      {
        targetId: 'npc_elena_101',
        field: 'observations',
        supportingObservationIds: ['obs_123'],
      },
    ],
  };
  const supRes = validateDevelopmentEnvelope(supEnvelope);
  assert.equal(supRes.valid, false);
  assert.ok(supRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT));
});

test('Development Validator (L-10): rejects envelope specifying both reviewReceipts and targetAcknowledgments', () => {
  const envelope = {
    version: '1',
    reviewReceipts: [
      {
        targetId: 'npc_elena_101',
        sourceScope: ['msg:1'],
        status: 'reviewed',
      },
    ],
    targetAcknowledgments: [
      {
        targetId: 'npc_elena_101',
        sourceScope: ['msg:1'],
        status: 'reviewed',
      },
    ],
  };
  const res = validateDevelopmentEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RECEIPT));
  assert.match(res.errors[0].errorMessage, /cannot specify both 'targetAcknowledgments' and 'reviewReceipts'/i);
});

test('Development Validator (Strictness Pass): durable field source cannot be shadowed by supportProposal', () => {
  const validSupport = [
    {
      targetId: 'npc_elena_101',
      field: 'personality',
      sourceRefs: ['msg:1'],
    },
    {
      targetId: 'npc_elena_101',
      field: 'mannerisms',
      sourceRefs: ['msg:1'],
    },
    {
      targetId: 'npc_elena_101',
      field: 'appearanceForms',
      sourceRefs: ['msg:1'],
    },
    {
      targetId: 'npc_elena_101',
      field: 'importantMemories',
      sourceRefs: ['msg:1'],
    },
    {
      targetId: 'npc_elena_101',
      field: 'nonPlayerRelationships',
      sourceRefs: ['msg:1'],
    },
    {
      targetId: 'npc_elena_101',
      field: 'facts',
      sourceRefs: ['msg:1'],
    },
    {
      targetId: 'npc_elena_101',
      field: 'role',
      sourceRefs: ['msg:1'],
    },
  ];

  // 1. personality with malformed source but valid supportProposal
  const badPersSource = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: validSupport,
    proposals: [
      {
        targetId: 'npc_elena_101',
        personality: {
          traits: ['scholarly'],
          source: { invalidProp: 123 },
        },
      },
    ],
  });
  assert.equal(badPersSource.valid, false);
  assert.ok(badPersSource.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY || e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));

  // 2. mannerisms item with source: false but valid supportProposal
  const badMannerismSource = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: validSupport,
    proposals: [
      {
        targetId: 'npc_elena_101',
        mannerisms: {
          items: [
            {
              value: 'adjusts spectacles',
              source: false,
            },
          ],
        },
      },
    ],
  });
  assert.equal(badMannerismSource.valid, false);
  assert.ok(badMannerismSource.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));

  // 3. appearanceForms item with source: null but valid supportProposal
  const badAppearanceSource = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: validSupport,
    proposals: [
      {
        targetId: 'npc_elena_101',
        appearanceForms: {
          forms: [
            {
              formId: 'form_battle',
              description: 'battle armor',
              source: null,
            },
          ],
        },
      },
    ],
  });
  assert.equal(badAppearanceSource.valid, false);
  assert.ok(badAppearanceSource.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));

  // 4. importantMemories item with malformed source but valid supportProposal
  const badMemorySource = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: validSupport,
    proposals: [
      {
        targetId: 'npc_elena_101',
        importantMemories: {
          memories: [
            {
              text: 'Remembers the library burning',
              source: { sourceRef: '' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(badMemorySource.valid, false);
  assert.ok(badMemorySource.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));

  // 5. facts container with source: null but valid supportProposal
  const badFactsSource = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: validSupport,
    proposals: [
      {
        targetId: 'npc_elena_101',
        facts: {
          role: 'Scholar',
          source: null,
        },
      },
    ],
  });
  assert.equal(badFactsSource.valid, false);
  assert.ok(badFactsSource.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));

  // 6. scalar durable field (role) with source: null but valid supportProposal
  const badRoleSource = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: validSupport,
    proposals: [
      {
        targetId: 'npc_elena_101',
        role: {
          value: 'Scholar',
          source: null,
        },
      },
    ],
  });
  assert.equal(badRoleSource.valid, false);
  assert.ok(badRoleSource.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));
});

test('Development Validator (Strictness Pass): receipt aliases and receipt items strictness', () => {
  // targetAcknowledgments: null rejected as non-array
  const nullReceipts = validateDevelopmentEnvelope({
    version: '1',
    targetAcknowledgments: null,
  });
  assert.equal(nullReceipts.valid, false);
  assert.ok(nullReceipts.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RECEIPT && e.errorMessage.includes("'targetAcknowledgments' must be an array")));

  // receipt missing status rejected
  const missingStatus = validateDevelopmentEnvelope({
    version: '1',
    targetAcknowledgments: [
      {
        targetId: 'npc_elena_101',
        sourceScope: ['msg:1'],
      },
    ],
  });
  assert.equal(missingStatus.valid, false);
  assert.ok(missingStatus.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RECEIPT && e.errorMessage.includes("requires valid 'status'")));

  // receipt restricted non-boolean rejected
  const badRestricted = validateDevelopmentEnvelope({
    version: '1',
    targetAcknowledgments: [
      {
        targetId: 'npc_elena_101',
        sourceScope: ['msg:1'],
        status: 'reviewed',
        restricted: 'true',
      },
    ],
  });
  assert.equal(badRestricted.valid, false);
  assert.ok(badRestricted.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RECEIPT && e.errorMessage.includes("'restricted', if provided, must be a boolean")));

  // receipt reason empty string rejected
  const emptyReason = validateDevelopmentEnvelope({
    version: '1',
    targetAcknowledgments: [
      {
        targetId: 'npc_elena_101',
        sourceScope: ['msg:1'],
        status: 'reviewed',
        reason: '   ',
      },
    ],
  });
  assert.equal(emptyReason.valid, false);
  assert.ok(emptyReason.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RECEIPT && e.errorMessage.includes("'reason', if provided, must be a non-empty string")));
});

test('Development Validator (Strictness Pass): observation aliases, independent disposition linkages, sameEventLinks', () => {
  // Observation specifying both localObservationRef and localRef rejected
  const dualAlias = validateDevelopmentEnvelope({
    version: '1',
    observations: [
      {
        localObservationRef: 'obs:1',
        localRef: 'obs:1',
        targetId: 'npc_elena_101',
        field: 'mannerisms',
        observation: 'Elena adjusts spectacles.',
        source: { sourceRef: 'msg:1', excerpt: 'text' },
      },
    ],
  });
  assert.equal(dualAlias.valid, false);
  assert.ok(dualAlias.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OBSERVATION && e.errorMessage.includes("Cannot specify both 'localObservationRef' and 'localRef'")));

  // Disposition with empty linkedFieldRevision rejected
  const emptyLinkedFieldRev = validateDevelopmentEnvelope({
    version: '1',
    observations: [
      {
        localObservationRef: 'obs:1',
        targetId: 'npc_elena_101',
        field: 'mannerisms',
        observation: 'Elena adjusts spectacles.',
        source: { sourceRef: 'msg:1', excerpt: 'text' },
        disposition: { role: 'supporting', linkedFieldRevision: '   ' },
      },
    ],
  });
  assert.equal(emptyLinkedFieldRev.valid, false);
  assert.ok(emptyLinkedFieldRev.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OBSERVATION && e.errorMessage.includes("'linkedFieldRevision', if provided, must be a non-empty string")));

  // Disposition with empty linkedObservationRefs array rejected
  const emptyLinkedObsRefs = validateDevelopmentEnvelope({
    version: '1',
    observations: [
      {
        localObservationRef: 'obs:1',
        targetId: 'npc_elena_101',
        field: 'mannerisms',
        observation: 'Elena adjusts spectacles.',
        source: { sourceRef: 'msg:1', excerpt: 'text' },
        disposition: { role: 'supporting', linkedObservationRefs: [] },
      },
    ],
  });
  assert.equal(emptyLinkedObsRefs.valid, false);
  assert.ok(emptyLinkedObsRefs.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OBSERVATION && e.errorMessage.includes("'linkedObservationRefs' array must contain non-empty strings")));

  // Observation with empty sameEventLinks string rejected
  const emptySameEventLinks = validateDevelopmentEnvelope({
    version: '1',
    observations: [
      {
        localObservationRef: 'obs:1',
        targetId: 'npc_elena_101',
        field: 'mannerisms',
        observation: 'Elena adjusts spectacles.',
        source: { sourceRef: 'msg:1', excerpt: 'text' },
        sameEventLinks: '   ',
      },
    ],
  });
  assert.equal(emptySameEventLinks.valid, false);
  assert.ok(emptySameEventLinks.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OBSERVATION && e.errorMessage.includes('sameEventLinks string cannot be empty')));

  // Observation with empty sameEventRef rejected
  const emptySameEventRef = validateDevelopmentEnvelope({
    version: '1',
    observations: [
      {
        localObservationRef: 'obs:1',
        targetId: 'npc_elena_101',
        field: 'mannerisms',
        observation: 'Elena adjusts spectacles.',
        source: { sourceRef: 'msg:1', excerpt: 'text' },
        sameEventRef: '   ',
      },
    ],
  });
  assert.equal(emptySameEventRef.valid, false);
  assert.ok(emptySameEventRef.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OBSERVATION && e.errorMessage.includes('sameEventRef, if provided, must be a non-empty string')));
});

test('Development Validator (Strictness Pass): facts container requires at least one canonical fact string', () => {
  const source = { sourceRef: 'msg:1', excerpt: 'She was an archivist.' };

  // facts: {} without any canonical subfield rejected
  const emptyFacts = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        facts: { source },
      },
    ],
  });
  assert.equal(emptyFacts.valid, false);
  assert.ok(emptyFacts.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes('must specify at least one canonical fact subfield')));

  // facts: { role: { value: "Guard" } } (object wrapper instead of string) rejected
  const objFacts = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        facts: {
          role: { value: 'Guard' },
          source,
        },
      },
    ],
  });
  assert.equal(objFacts.valid, false);
  assert.ok(objFacts.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes('facts.role must be a non-empty string')));

  // facts: { species: ["Human"] } (array instead of string) rejected
  const arrFacts = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        facts: {
          species: ['Human'],
          source,
        },
      },
    ],
  });
  assert.equal(arrFacts.valid, false);
  assert.ok(arrFacts.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes('facts.species must be a non-empty string')));
});

test('Development Validator (Strictness Pass): collection containers reject empty arrays, dual aliases, and empty item scalars', () => {
  const source = { sourceRef: 'msg:1', excerpt: 'She was seen.' };

  // 1. appearanceForms: [] empty array rejected
  const emptyAfArr = validateDevelopmentEnvelope({
    version: '1',
    proposals: [{ targetId: 'npc_elena_101', appearanceForms: [] }],
  });
  assert.equal(emptyAfArr.valid, false);
  assert.ok(emptyAfArr.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes('appearanceForms array cannot be empty')));

  // appearanceForms: { forms: [], items: [] } dual alias rejected
  const dualAf = validateDevelopmentEnvelope({
    version: '1',
    proposals: [{ targetId: 'npc_elena_101', appearanceForms: { forms: [], items: [], source } }],
  });
  assert.equal(dualAf.valid, false);
  assert.ok(dualAf.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes("Cannot supply both 'forms' and 'items'")));

  // appearanceForms[0].name: "" empty string rejected
  const emptyAfName = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        appearanceForms: {
          forms: [{ formId: 'form_1', name: '   ', source }],
        },
      },
    ],
  });
  assert.equal(emptyAfName.valid, false);
  assert.ok(emptyAfName.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes("'name' must be a non-empty string")));

  // 2. importantMemories: [] empty array rejected
  const emptyImArr = validateDevelopmentEnvelope({
    version: '1',
    proposals: [{ targetId: 'npc_elena_101', importantMemories: [] }],
  });
  assert.equal(emptyImArr.valid, false);
  assert.ok(emptyImArr.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes('importantMemories array cannot be empty')));

  // importantMemories: { memories: [], items: [] } dual alias rejected
  const dualIm = validateDevelopmentEnvelope({
    version: '1',
    proposals: [{ targetId: 'npc_elena_101', importantMemories: { memories: [], items: [], source } }],
  });
  assert.equal(dualIm.valid, false);
  assert.ok(dualIm.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes("Cannot supply both 'memories' and 'items'")));

  // importantMemories[0].memoryId: "" rejected
  const emptyMemId = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        importantMemories: {
          memories: [{ memoryId: '', text: 'A memory', source }],
        },
      },
    ],
  });
  assert.equal(emptyMemId.valid, false);
  assert.ok(emptyMemId.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes("'memoryId' must be a non-empty string")));

  // 3. nonPlayerRelationships: [] empty array rejected
  const emptyNprArr = validateDevelopmentEnvelope({
    version: '1',
    proposals: [{ targetId: 'npc_elena_101', nonPlayerRelationships: [] }],
  });
  assert.equal(emptyNprArr.valid, false);
  assert.ok(emptyNprArr.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes('nonPlayerRelationships array cannot be empty')));

  // nonPlayerRelationships: { relationships: [], items: [] } dual alias rejected
  const dualNpr = validateDevelopmentEnvelope({
    version: '1',
    proposals: [{ targetId: 'npc_elena_101', nonPlayerRelationships: { relationships: [], items: [], source } }],
  });
  assert.equal(dualNpr.valid, false);
  assert.ok(dualNpr.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes("Cannot supply both 'relationships' and 'items'")));

  // nonPlayerRelationships[0].targetId: "" rejected
  const emptyNprTarget = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        nonPlayerRelationships: {
          relationships: [{ targetId: '   ', relationship: 'ally', source }],
        },
      },
    ],
  });
  assert.equal(emptyNprTarget.valid, false);
  assert.ok(emptyNprTarget.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes("'targetId' must be a non-empty string")));
});

test('Development Validator (Strictness Pass): supportProposals reject empty or non-string notes and reason', () => {
  const baseProposal = {
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    supportingObservationIds: ['obs_101'],
  };

  // notes: "" rejected
  const resEmptyNotes = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: [{ ...baseProposal, notes: '' }],
  });
  assert.equal(resEmptyNotes.valid, false);
  assert.ok(resEmptyNotes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT && e.errorMessage.includes("'notes', if provided, must be a non-empty string")));

  // notes: "   " rejected
  const resWhitespaceNotes = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: [{ ...baseProposal, notes: '   ' }],
  });
  assert.equal(resWhitespaceNotes.valid, false);
  assert.ok(resWhitespaceNotes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT && e.errorMessage.includes("'notes', if provided, must be a non-empty string")));

  // notes: 123 rejected
  const resNumNotes = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: [{ ...baseProposal, notes: 123 }],
  });
  assert.equal(resNumNotes.valid, false);
  assert.ok(resNumNotes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT && e.errorMessage.includes("'notes', if provided, must be a non-empty string")));

  // reason: "" rejected
  const resEmptyReason = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: [{ ...baseProposal, reason: '' }],
  });
  assert.equal(resEmptyReason.valid, false);
  assert.ok(resEmptyReason.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT && e.errorMessage.includes("'reason', if provided, must be a non-empty string")));

  // reason: "   " rejected
  const resWhitespaceReason = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: [{ ...baseProposal, reason: '   ' }],
  });
  assert.equal(resWhitespaceReason.valid, false);
  assert.ok(resWhitespaceReason.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT && e.errorMessage.includes("'reason', if provided, must be a non-empty string")));

  // reason: true rejected
  const resBoolReason = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: [{ ...baseProposal, reason: true }],
  });
  assert.equal(resBoolReason.valid, false);
  assert.ok(resBoolReason.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT && e.errorMessage.includes("'reason', if provided, must be a non-empty string")));

  // Valid notes and reason accepted
  const resValid = validateDevelopmentEnvelope({
    version: '1',
    supportProposals: [
      {
        ...baseProposal,
        notes: 'Discussion note',
        reason: 'Observation alignment',
      },
    ],
  });
  assert.equal(resValid.valid, true);
});

test('Development Validator (C05): destructive targeting on appearanceForms requires stable formId only', () => {
  // 1. Destructive remove rejects localFormRef
  const resLocalRef = validateDevelopmentEnvelope(invalidAppearanceFormDestructiveLocalOnly);
  assert.equal(resLocalRef.valid, false);
  assert.ok(resLocalRef.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OPERATION && e.errorMessage.includes("cannot use request-local ref 'localFormRef'")));

  // 2. Destructive replace with label-only rejects (no stable formId)
  const resLabelOnly = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        appearanceForms: {
          operation: 'replace',
          forms: [
            {
              label: 'Wolf Form',
              source: { sourceRef: 'msg:2', excerpt: 'Elena changed.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resLabelOnly.valid, false);
  assert.ok(resLabelOnly.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OPERATION && e.errorMessage.includes("requires non-empty stable persisted 'formId'")));

  // 3. Destructive remove rejects removed 'expectedValue' key as unknown
  const resExpectedKey = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        appearanceForms: {
          operation: 'remove',
          forms: [
            {
              formId: 'form_wolf_01',
              expectedValue: 'Dire Wolf Form',
              source: { sourceRef: 'msg:2', excerpt: 'Elena shed the guise.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resExpectedKey.valid, false);
  assert.ok(resExpectedKey.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY && e.errorMessage.includes("Unknown key 'expectedValue'")));

  // 4. Destructive remove with stable formId passes
  const resGoodFormId = validateDevelopmentEnvelope(validAppearanceFormDestructiveStableFormId);
  assert.equal(resGoodFormId.valid, true, JSON.stringify(resGoodFormId.errors));

  // 5. Destructive replace with stable formId and proposed description passes
  const resGoodReplace = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        appearanceForms: {
          operation: 'replace',
          forms: [
            {
              formId: 'form_wolf_01',
              description: 'Updated dire wolf features',
              source: { sourceRef: 'msg:2', excerpt: 'Elena changed.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resGoodReplace.valid, true, JSON.stringify(resGoodReplace.errors));

  // 6. Destructive replace with stable formId but missing proposed form value rejects
  const resReplaceNoValue = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        appearanceForms: {
          operation: 'replace',
          forms: [
            {
              formId: 'form_wolf_01',
              source: { sourceRef: 'msg:2', excerpt: 'Elena changed.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resReplaceNoValue.valid, false);
  assert.ok(resReplaceNoValue.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes("requires proposed new form value")));

  // 7. Non-destructive operation (add) with localFormRef passes
  const resAddLocal = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        appearanceForms: {
          operation: 'add',
          forms: [
            {
              localFormRef: 'form:temporary_wolf',
              label: 'Wolf Form',
              description: 'A temporary wolf shape',
              source: { sourceRef: 'msg:2', excerpt: 'Elena took wolf shape.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resAddLocal.valid, true, JSON.stringify(resAddLocal.errors));

  // 8. Non-destructive operation (add) with formId passes
  const resAddFormId = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        appearanceForms: {
          operation: 'add',
          forms: [
            {
              formId: 'form_stable_wolf',
              label: 'Wolf Form',
              description: 'A stable wolf shape',
              source: { sourceRef: 'msg:2', excerpt: 'Elena took wolf shape.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resAddFormId.valid, true, JSON.stringify(resAddFormId.errors));
});

test('Development Validator (C05): destructive targeting on importantMemories requires stable memoryId only', () => {
  // 1. Destructive remove rejects localMemoryRef
  const resBad = validateDevelopmentEnvelope(invalidMemoryDestructiveLocalOnly);
  assert.equal(resBad.valid, false);
  assert.ok(resBad.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OPERATION && e.errorMessage.includes("cannot use request-local ref 'localMemoryRef'")));

  // 2. Destructive replace with text-only rejects (no stable memoryId)
  const resTextOnly = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        importantMemories: {
          operation: 'replace',
          memories: [
            {
              text: 'Survived the fire',
              source: { sourceRef: 'msg:2', excerpt: 'Elena recalled the fire.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resTextOnly.valid, false);
  assert.ok(resTextOnly.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OPERATION && e.errorMessage.includes("requires non-empty stable persisted 'memoryId'")));

  // 3. Destructive remove rejects removed 'expectedText' key as unknown
  const resExpectedKey = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        importantMemories: {
          operation: 'remove',
          memories: [
            {
              memoryId: 'mem_rec_001',
              expectedText: 'Survived the fire',
              source: { sourceRef: 'msg:2', excerpt: 'Elena wiped the slate.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resExpectedKey.valid, false);
  assert.ok(resExpectedKey.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY && e.errorMessage.includes("Unknown key 'expectedText'")));

  // 4. Destructive remove with stable memoryId passes
  const resGoodMemoryId = validateDevelopmentEnvelope(validMemoryDestructiveStableMemoryId);
  assert.equal(resGoodMemoryId.valid, true, JSON.stringify(resGoodMemoryId.errors));

  // 5. Destructive replace with stable memoryId + proposed text passes
  const resGoodReplace = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        importantMemories: {
          operation: 'replace',
          memories: [
            {
              memoryId: 'mem_rec_001',
              text: 'Survived the Grand Archive fire of year 102 and rescued the Codex',
              source: { sourceRef: 'msg:2', excerpt: 'Elena clarified she saved the Codex.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resGoodReplace.valid, true, JSON.stringify(resGoodReplace.errors));

  // 6. Destructive replace with stable memoryId but missing proposed text/summary rejects
  const resReplaceNoText = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        importantMemories: {
          operation: 'replace',
          memories: [
            {
              memoryId: 'mem_rec_001',
              source: { sourceRef: 'msg:2', excerpt: 'Elena clarified.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resReplaceNoText.valid, false);
  assert.ok(resReplaceNoText.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes("requires proposed new 'text' or 'summary'")));

  // 7. Non-destructive operation (add) with localMemoryRef passes
  const resAdd = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        importantMemories: {
          operation: 'add',
          memories: [
            {
              localMemoryRef: 'mem:grand_archive_fire',
              text: 'Survived the Grand Archive fire of year 102',
              source: { sourceRef: 'msg:2', excerpt: 'Elena remembered the fire.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resAdd.valid, true, JSON.stringify(resAdd.errors));

  // 8. Non-destructive operation (add) with memoryId passes
  const resAddMemoryId = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        importantMemories: {
          operation: 'add',
          memories: [
            {
              memoryId: 'mem_rec_stable_001',
              text: 'Survived the Grand Archive fire of year 102',
              source: { sourceRef: 'msg:2', excerpt: 'Elena remembered the fire.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resAddMemoryId.valid, true, JSON.stringify(resAddMemoryId.errors));
});

test('Development Validator (C05): destructive targeting on nonPlayerRelationships requires stable relationId only', () => {
  // 1. Destructive remove rejects targetRef
  const resBadLocal = validateDevelopmentEnvelope(invalidNonPlayerRelationshipDestructiveLocalOnly);
  assert.equal(resBadLocal.valid, false);
  assert.ok(resBadLocal.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OPERATION && e.errorMessage.includes("cannot use request-local ref 'targetRef'")));

  // 2. Destructive remove rejects targetName
  const resBadName = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        nonPlayerRelationships: {
          operation: 'remove',
          relationships: [
            {
              targetName: 'Barkeep Bob',
              source: { sourceRef: 'msg:2', excerpt: 'She severed ties.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resBadName.valid, false);
  assert.ok(resBadName.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OPERATION && e.errorMessage.includes("cannot use ambiguous 'targetName'")));

  // 3. Destructive remove rejects targetId (targetId is endpoint data for non-destructive ops, not a destructive target)
  const resBadTargetId = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        nonPlayerRelationships: {
          operation: 'remove',
          relationships: [
            {
              targetId: 'npc_barkeep_01',
              source: { sourceRef: 'msg:2', excerpt: 'Elena broke ties.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resBadTargetId.valid, false);
  assert.ok(resBadTargetId.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OPERATION && e.errorMessage.includes("cannot use 'targetId'; destructive operations require stable persisted 'relationId'")));

  // 4. Destructive replace with targetId + relationship rejects (missing relationId)
  const resTargetIdWithoutRelationId = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        nonPlayerRelationships: {
          operation: 'replace',
          relationships: [
            {
              targetId: 'npc_barkeep_01',
              relationship: 'Suspicious acquaintance',
              source: { sourceRef: 'msg:2', excerpt: 'Elena glared at barkeep.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resTargetIdWithoutRelationId.valid, false);
  assert.ok(resTargetIdWithoutRelationId.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OPERATION && e.errorMessage.includes("requires non-empty stable persisted 'relationId'")));

  // 5. Destructive remove rejects removed 'expectedRelationship' key as unknown
  const resExpectedKey = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        nonPlayerRelationships: {
          operation: 'remove',
          relationships: [
            {
              relationId: 'rel_01',
              expectedRelationship: 'Friendly patron',
              source: { sourceRef: 'msg:2', excerpt: 'Elena broke ties.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resExpectedKey.valid, false);
  assert.ok(resExpectedKey.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY && e.errorMessage.includes("Unknown key 'expectedRelationship'")));

  // 6. Valid destructive remove with relationId only passes
  const resGoodRelationId = validateDevelopmentEnvelope(validNonPlayerRelationshipDestructiveStableRelationId);
  assert.equal(resGoodRelationId.valid, true, JSON.stringify(resGoodRelationId.errors));

  // 7. Valid destructive replace with relationId only + proposed relationship passes
  const resGoodRelationIdReplace = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        nonPlayerRelationships: {
          operation: 'replace',
          relationships: [
            {
              relationId: 'rel_elena_vane_01',
              relationship: 'Former apprentice',
              source: { sourceRef: 'msg:2', excerpt: 'Elena concluded her formal apprenticeship.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resGoodRelationIdReplace.valid, true, JSON.stringify(resGoodRelationIdReplace.errors));

  // 8. Destructive replace with relationId but missing proposed relationship rejects
  const resReplaceNoRel = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        nonPlayerRelationships: {
          operation: 'replace',
          relationships: [
            {
              relationId: 'rel_elena_vane_01',
              source: { sourceRef: 'msg:2', excerpt: 'Elena concluded her apprenticeship.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resReplaceNoRel.valid, false);
  assert.ok(resReplaceNoRel.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes("requires proposed new relationship description")));

  // 9. Non-destructive establish with targetId passes
  const resEstablishTargetId = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        nonPlayerRelationships: {
          operation: 'establish',
          relationships: [
            {
              targetId: 'npc_barkeep_01',
              relationship: 'Friendly patron',
              source: { sourceRef: 'msg:2', excerpt: 'Elena greeted the barkeep.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resEstablishTargetId.valid, true, JSON.stringify(resEstablishTargetId.errors));

  // 10. Non-destructive operation (establish) with targetRef passes
  const resEstablishTargetRef = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        nonPlayerRelationships: {
          operation: 'establish',
          relationships: [
            {
              targetRef: 'new:barkeep',
              relationship: 'Friendly patron',
              source: { sourceRef: 'msg:2', excerpt: 'Elena smiled at the newcomer.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resEstablishTargetRef.valid, true, JSON.stringify(resEstablishTargetRef.errors));

  // 11. Non-destructive operation (establish) with targetName passes
  const resEstablishTargetName = validateDevelopmentEnvelope({
    version: '1',
    proposals: [
      {
        targetId: 'npc_elena_101',
        nonPlayerRelationships: {
          operation: 'establish',
          relationships: [
            {
              targetName: 'Barkeep Bob',
              relationship: 'Friendly patron',
              source: { sourceRef: 'msg:2', excerpt: 'Elena greeted Bob.' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(resEstablishTargetName.valid, true, JSON.stringify(resEstablishTargetName.errors));
});





