import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePersistedObservationRecord,
  validatePersistedAcceptedSupportRecord,
  PERSISTED_OBSERVATION_KEYS,
  PERSISTED_ACCEPTED_SUPPORT_KEYS,
  SUPPORT_PROPOSAL_ALLOWED_KEYS,
  RECEIPT_ALLOWED_KEYS,
  DISPOSITION_ALLOWED_KEYS,
  OBSERVATION_ALLOWED_KEYS,
  SOURCE_REFERENCE_ALLOWED_KEYS,
  ALPHA_ONE_PASS_WIRE_VERSION,
  ALPHA_DEVELOPMENT_WIRE_VERSION,
  STRUCTURED_SEGMENT_KINDS,
  APPEARANCE_FORM_ITEM_KEYS,
  IMPORTANT_MEMORY_ITEM_KEYS,
  NON_PLAYER_RELATIONSHIP_ITEM_KEYS,
  AXIS_SUPPORT_ENTRY_KEYS,
} from '../src/contract/wire-schemas.js';
import * as wireSchemas from '../src/contract/wire-schemas.js';

test('Wire Schemas: exported key allowlists are defined arrays of non-empty strings', () => {
  const allowlists = [
    { name: 'PERSISTED_OBSERVATION_KEYS', list: PERSISTED_OBSERVATION_KEYS },
    { name: 'PERSISTED_ACCEPTED_SUPPORT_KEYS', list: PERSISTED_ACCEPTED_SUPPORT_KEYS },
    { name: 'SUPPORT_PROPOSAL_ALLOWED_KEYS', list: SUPPORT_PROPOSAL_ALLOWED_KEYS },
    { name: 'RECEIPT_ALLOWED_KEYS', list: RECEIPT_ALLOWED_KEYS },
    { name: 'DISPOSITION_ALLOWED_KEYS', list: DISPOSITION_ALLOWED_KEYS },
    { name: 'OBSERVATION_ALLOWED_KEYS', list: OBSERVATION_ALLOWED_KEYS },
    { name: 'SOURCE_REFERENCE_ALLOWED_KEYS', list: SOURCE_REFERENCE_ALLOWED_KEYS },
    { name: 'APPEARANCE_FORM_ITEM_KEYS', list: APPEARANCE_FORM_ITEM_KEYS },
    { name: 'IMPORTANT_MEMORY_ITEM_KEYS', list: IMPORTANT_MEMORY_ITEM_KEYS },
    { name: 'NON_PLAYER_RELATIONSHIP_ITEM_KEYS', list: NON_PLAYER_RELATIONSHIP_ITEM_KEYS },
    { name: 'AXIS_SUPPORT_ENTRY_KEYS', list: AXIS_SUPPORT_ENTRY_KEYS },
  ];

  for (const { name, list } of allowlists) {
    assert.ok(Array.isArray(list), `${name} must be an array`);
    assert.ok(list.length > 0, `${name} must not be empty`);
    for (const key of list) {
      assert.equal(typeof key, 'string', `${name} key must be string`);
      assert.ok(key.trim().length > 0, `${name} key must not be blank`);
    }
  }
});

test('Wire Schemas: collection item schemas enforce exact explicit precondition keys and remove deleted keys', () => {
  // Appearance forms: stable formId and localFormRef, expectedValue deleted
  assert.ok(APPEARANCE_FORM_ITEM_KEYS.includes('formId'));
  assert.ok(APPEARANCE_FORM_ITEM_KEYS.includes('localFormRef'));
  assert.equal(APPEARANCE_FORM_ITEM_KEYS.includes('expectedValue'), false, 'expectedValue must not be in APPEARANCE_FORM_ITEM_KEYS');

  // Important memories: stable memoryId and localMemoryRef, expectedText deleted
  assert.ok(IMPORTANT_MEMORY_ITEM_KEYS.includes('memoryId'));
  assert.ok(IMPORTANT_MEMORY_ITEM_KEYS.includes('localMemoryRef'));
  assert.equal(IMPORTANT_MEMORY_ITEM_KEYS.includes('expectedText'), false, 'expectedText must not be in IMPORTANT_MEMORY_ITEM_KEYS');
  assert.equal(IMPORTANT_MEMORY_ITEM_KEYS.includes('expectedValue'), false, 'expectedValue must not be in IMPORTANT_MEMORY_ITEM_KEYS');

  // Non-player relationships: stable relationId and targetId, expectedRelationship deleted
  assert.ok(NON_PLAYER_RELATIONSHIP_ITEM_KEYS.includes('relationId'));
  assert.ok(NON_PLAYER_RELATIONSHIP_ITEM_KEYS.includes('targetId'));
  assert.equal(NON_PLAYER_RELATIONSHIP_ITEM_KEYS.includes('expectedRelationship'), false, 'expectedRelationship must not be in NON_PLAYER_RELATIONSHIP_ITEM_KEYS');
  assert.equal(NON_PLAYER_RELATIONSHIP_ITEM_KEYS.includes('edgeId'), false, 'edgeId must not be in NON_PLAYER_RELATIONSHIP_ITEM_KEYS');
  assert.equal(NON_PLAYER_RELATIONSHIP_ITEM_KEYS.includes('expectedValue'), false, 'expectedValue must not be in NON_PLAYER_RELATIONSHIP_ITEM_KEYS');

  // Axis support entry keys: strictly source and reason, explanation deleted
  assert.ok(AXIS_SUPPORT_ENTRY_KEYS.includes('source'));
  assert.ok(AXIS_SUPPORT_ENTRY_KEYS.includes('reason'));
  assert.equal(AXIS_SUPPORT_ENTRY_KEYS.includes('explanation'), false, 'explanation must not be in AXIS_SUPPORT_ENTRY_KEYS');
  assert.equal(wireSchemas.AXIS_SUPPORT_ARRAY_ITEM_KEYS, undefined, 'AXIS_SUPPORT_ARRAY_ITEM_KEYS must be deleted');
});

test('Wire Schemas (C08 / MEDIUM 5): validatePersistedObservationRecord validates valid record', () => {
  const validRecord = {
    id: 'obs_rec_001',
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    observation: 'Elena adjusts her spectacles when anxious.',
    source: {
      sourceRef: 'msg:5',
      segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
      excerpt: 'Elena pushed her silver spectacles up nervously.',
    },
    disposition: {
      role: 'supporting',
      linkedFieldRevision: 'rev_elena_mannerisms_01',
    },
  };

  const res = validatePersistedObservationRecord(validRecord);
  assert.equal(res.valid, true, res.error);
});

test('Wire Schemas (C08 / MEDIUM 4 / MEDIUM 5): validatePersistedObservationRecord rejects unknown keys', () => {
  const record = {
    id: 'obs_rec_001',
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    observation: 'Elena adjusts spectacles.',
    source: {
      sourceRef: 'msg:5',
      excerpt: 'Elena pushed her silver spectacles up nervously.',
    },
    unknownField: 'unauthorized',
  };

  const res = validatePersistedObservationRecord(record);
  assert.equal(res.valid, false);
  assert.match(res.error, /Unknown key 'unknownField'/);
});

test('Wire Schemas (C08 / MEDIUM 5 / LOW 9): validatePersistedObservationRecord rejects observations ledger as target field', () => {
  const record = {
    id: 'obs_rec_001',
    targetId: 'npc_elena_101',
    field: 'observations',
    observation: 'Meta observation about observations ledger.',
    source: {
      sourceRef: 'msg:5',
      excerpt: 'Observation text.',
    },
  };

  const res = validatePersistedObservationRecord(record);
  assert.equal(res.valid, false);
  assert.match(res.error, /observations ledger is not a valid target/);
});

test('Wire Schemas (C08 / MEDIUM 5): validatePersistedObservationRecord rejects non-durable target field', () => {
  const record = {
    id: 'obs_rec_001',
    targetId: 'npc_elena_101',
    field: 'present',
    observation: 'Elena was present in room.',
    source: {
      sourceRef: 'msg:5',
      excerpt: 'Elena entered.',
    },
  };

  const res = validatePersistedObservationRecord(record);
  assert.equal(res.valid, false);
  assert.match(res.error, /must target an eligible Development durable field/);
});

test('Wire Schemas (C08 / MEDIUM 5): validatePersistedObservationRecord enforces disposition linkage for supporting role', () => {
  const recordWithoutLink = {
    id: 'obs_rec_001',
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    observation: 'Elena adjusts spectacles.',
    source: {
      sourceRef: 'msg:5',
      excerpt: 'Elena pushed spectacles up.',
    },
    disposition: {
      role: 'supporting',
    },
  };

  const res = validatePersistedObservationRecord(recordWithoutLink);
  assert.equal(res.valid, false);
  assert.match(res.error, /requires linked reference/);
});

test('Wire Schemas (C08 / MEDIUM 5): validatePersistedObservationRecord rejects unknown keys in source reference', () => {
  const record = {
    id: 'obs_rec_001',
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    observation: 'Elena adjusts spectacles.',
    source: {
      sourceRef: 'msg:5',
      excerpt: 'Elena pushed spectacles up.',
      illegalSourceProp: true,
    },
  };

  const res = validatePersistedObservationRecord(record);
  assert.equal(res.valid, false);
  assert.match(res.error, /Unknown key 'illegalSourceProp' in persisted observation source reference/);
});

test('Wire Schemas (C08 / MEDIUM 5): validatePersistedAcceptedSupportRecord validates valid record with supportingObservationIds', () => {
  const validRecord = {
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    fieldRevision: 'rev_elena_mannerisms_02',
    supportingObservationIds: ['obs_rec_001'],
    notes: 'Reinforced spectacles habit',
  };

  const res = validatePersistedAcceptedSupportRecord(validRecord);
  assert.equal(res.valid, true, res.error);
});

test('Wire Schemas (C08 / MEDIUM 5): validatePersistedAcceptedSupportRecord validates valid record with sourceRefs', () => {
  const validRecord = {
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    fieldRevision: 'rev_elena_mannerisms_02',
    sourceRefs: ['msg:5'],
    reason: 'Corroborated by direct excerpt',
  };

  const res = validatePersistedAcceptedSupportRecord(validRecord);
  assert.equal(res.valid, true, res.error);
});

test('Wire Schemas (C08 / MEDIUM 5): validatePersistedAcceptedSupportRecord requires committed fieldRevision (C08)', () => {
  const record = {
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    supportingObservationIds: ['obs_rec_001'],
  };

  const res = validatePersistedAcceptedSupportRecord(record);
  assert.equal(res.valid, false);
  assert.match(res.error, /requires committed non-empty string 'fieldRevision'/);
});

test('Wire Schemas (C08 / MEDIUM 5): validatePersistedAcceptedSupportRecord rejects unknown keys', () => {
  const record = {
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    fieldRevision: 'rev_elena_mannerisms_02',
    supportingObservationIds: ['obs_rec_001'],
    unexpectedKey: 42,
  };

  const res = validatePersistedAcceptedSupportRecord(record);
  assert.equal(res.valid, false);
  assert.match(res.error, /Unknown key 'unexpectedKey'/);
});

test('Wire Schemas (C08 / MEDIUM 5): validatePersistedAcceptedSupportRecord requires either supportingObservationIds or sourceRefs', () => {
  const record = {
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    fieldRevision: 'rev_elena_mannerisms_02',
  };

  const res = validatePersistedAcceptedSupportRecord(record);
  assert.equal(res.valid, false);
  assert.match(res.error, /requires non-empty 'supportingObservationIds' or 'sourceRefs' array/);
});

test('Wire Schemas (C08 / MEDIUM 5): validatePersistedAcceptedSupportRecord rejects invalid field target', () => {
  const record = {
    targetId: 'npc_elena_101',
    field: 'observations',
    fieldRevision: 'rev_obs_01',
    supportingObservationIds: ['obs_rec_001'],
  };

  const res = validatePersistedAcceptedSupportRecord(record);
  assert.equal(res.valid, false);
  assert.match(res.error, /must target an eligible Development durable field/);
});

test('Wire Schemas (Strictness Pass): validatePersistedObservationRecord independently checks disposition links and notes/reason', () => {
  const base = {
    id: 'obs_rec_001',
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    observation: 'Elena adjusts spectacles.',
    source: {
      sourceRef: 'msg:5',
      excerpt: 'Elena pushed spectacles up.',
    },
  };

  // Empty string linkedFieldRevision rejected
  const res1 = validatePersistedObservationRecord({
    ...base,
    disposition: { role: 'supporting', linkedFieldRevision: '   ' },
  });
  assert.equal(res1.valid, false);
  assert.match(res1.error, /linkedFieldRevision/);

  // Empty string or array linkedObservationRefs rejected
  const res2 = validatePersistedObservationRecord({
    ...base,
    disposition: { role: 'supporting', linkedObservationRefs: '   ' },
  });
  assert.equal(res2.valid, false);
  assert.match(res2.error, /linkedObservationRefs/);

  const res3 = validatePersistedObservationRecord({
    ...base,
    disposition: { role: 'supporting', linkedObservationRefs: [] },
  });
  assert.equal(res3.valid, false);
  assert.match(res3.error, /linkedObservationRefs/);

  // Scalar string linkedObservationIds rejected (must be non-empty array of strings)
  const resScalarObsIds = validatePersistedObservationRecord({
    ...base,
    disposition: { role: 'supporting', linkedObservationIds: 'obs_rec_prior_01' },
  });
  assert.equal(resScalarObsIds.valid, false);
  assert.match(resScalarObsIds.error, /'linkedObservationIds' must be a non-empty array/);

  // Empty string or array linkedObservationIds rejected
  const res4 = validatePersistedObservationRecord({
    ...base,
    disposition: { role: 'supporting', linkedObservationIds: '' },
  });
  assert.equal(res4.valid, false);
  assert.match(res4.error, /linkedObservationIds/);

  const resEmptyArrayObsIds = validatePersistedObservationRecord({
    ...base,
    disposition: { role: 'supporting', linkedObservationIds: [] },
  });
  assert.equal(resEmptyArrayObsIds.valid, false);
  assert.match(resEmptyArrayObsIds.error, /linkedObservationIds/);

  // Empty reason and notes rejected
  const res5 = validatePersistedObservationRecord({
    ...base,
    disposition: { role: 'supporting', linkedFieldRevision: 'rev_01', reason: '' },
  });
  assert.equal(res5.valid, false);
  assert.match(res5.error, /reason/);

  const res6 = validatePersistedObservationRecord({
    ...base,
    disposition: { role: 'supporting', linkedFieldRevision: 'rev_01', notes: '   ' },
  });
  assert.equal(res6.valid, false);
  assert.match(res6.error, /notes/);
});

test('Wire Schemas (Strictness Pass): validatePersistedObservationRecord strictly validates sameEventLinks and sameEventRef', () => {
  const base = {
    id: 'obs_rec_001',
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    observation: 'Elena adjusts spectacles.',
    source: {
      sourceRef: 'msg:5',
      excerpt: 'Elena pushed spectacles up.',
    },
  };

  // sameEventLinks: "" rejected
  const res1 = validatePersistedObservationRecord({
    ...base,
    sameEventLinks: '',
  });
  assert.equal(res1.valid, false);
  assert.match(res1.error, /sameEventLinks/);

  // sameEventLinks: [] rejected
  const res2 = validatePersistedObservationRecord({
    ...base,
    sameEventLinks: [],
  });
  assert.equal(res2.valid, false);
  assert.match(res2.error, /sameEventLinks/);

  // sameEventLinks: [123] rejected
  const res3 = validatePersistedObservationRecord({
    ...base,
    sameEventLinks: [123],
  });
  assert.equal(res3.valid, false);
  assert.match(res3.error, /sameEventLinks/);

  // sameEventRef: "" rejected
  const res4 = validatePersistedObservationRecord({
    ...base,
    sameEventRef: '   ',
  });
  assert.equal(res4.valid, false);
  assert.match(res4.error, /sameEventRef/);

  // Valid sameEventLinks and sameEventRef accepted
  const res5 = validatePersistedObservationRecord({
    ...base,
    sameEventLinks: ['obs_rec_002'],
    sameEventRef: 'event_market_01',
  });
  assert.equal(res5.valid, true);
});

test('Wire Schemas (Strictness Pass): validatePersistedAcceptedSupportRecord strictly rejects empty or non-string notes and reason', () => {
  const base = {
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    fieldRevision: 'rev_elena_mannerisms_02',
    supportingObservationIds: ['obs_rec_001'],
  };

  // Rejection of empty string notes
  const resEmptyNotes = validatePersistedAcceptedSupportRecord({ ...base, notes: '' });
  assert.equal(resEmptyNotes.valid, false);
  assert.match(resEmptyNotes.error, /'notes', if provided, must be a non-empty string/);

  const resWhitespaceNotes = validatePersistedAcceptedSupportRecord({ ...base, notes: '   ' });
  assert.equal(resWhitespaceNotes.valid, false);
  assert.match(resWhitespaceNotes.error, /'notes', if provided, must be a non-empty string/);

  // Rejection of non-string notes
  const resNumNotes = validatePersistedAcceptedSupportRecord({ ...base, notes: 123 });
  assert.equal(resNumNotes.valid, false);
  assert.match(resNumNotes.error, /'notes', if provided, must be a non-empty string/);

  // Rejection of empty string reason
  const resEmptyReason = validatePersistedAcceptedSupportRecord({ ...base, reason: '' });
  assert.equal(resEmptyReason.valid, false);
  assert.match(resEmptyReason.error, /'reason', if provided, must be a non-empty string/);

  const resWhitespaceReason = validatePersistedAcceptedSupportRecord({ ...base, reason: '   ' });
  assert.equal(resWhitespaceReason.valid, false);
  assert.match(resWhitespaceReason.error, /'reason', if provided, must be a non-empty string/);

  // Rejection of non-string reason
  const resBoolReason = validatePersistedAcceptedSupportRecord({ ...base, reason: false });
  assert.equal(resBoolReason.valid, false);
  assert.match(resBoolReason.error, /'reason', if provided, must be a non-empty string/);

  // Valid non-empty notes and reason accepted
  const resValid = validatePersistedAcceptedSupportRecord({
    ...base,
    notes: 'Observed during tavern argument',
    reason: 'Corroborates speech pattern',
  });
  assert.equal(resValid.valid, true);
});

test('Wire Schemas (C08): separate transient vs persisted disposition refs in validatePersistedObservationRecord', () => {
  const base = {
    id: 'obs_rec_001',
    targetId: 'npc_elena_101',
    field: 'mannerisms',
    observation: 'Elena adjusts spectacles.',
    source: {
      sourceRef: 'msg:5',
      excerpt: 'Elena pushed spectacles up.',
    },
  };

  // 1. Persisted disposition with request-local linkedObservationRefs is rejected
  const withLocalRefs = {
    ...base,
    disposition: {
      role: 'supporting',
      linkedObservationRefs: ['local:obs_1'],
    },
  };
  const resLocal = validatePersistedObservationRecord(withLocalRefs);
  assert.equal(resLocal.valid, false);
  assert.match(resLocal.error, /cannot contain request-local 'linkedObservationRefs'/);

  // 2. Persisted disposition with resolved linkedObservationIds passes
  const withResolvedObsIds = {
    ...base,
    disposition: {
      role: 'supporting',
      linkedObservationIds: ['obs_rec_prior_01'],
    },
  };
  const resObsIds = validatePersistedObservationRecord(withResolvedObsIds);
  assert.equal(resObsIds.valid, true, resObsIds.error);

  // 3. Persisted disposition with resolved linkedFieldRevision passes
  const withResolvedFieldRev = {
    ...base,
    disposition: {
      role: 'supporting',
      linkedFieldRevision: 'rev_mannerisms_001',
    },
  };
  const resFieldRev = validatePersistedObservationRecord(withResolvedFieldRev);
  assert.equal(resFieldRev.valid, true, resFieldRev.error);
});
