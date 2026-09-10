import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOnePassEnvelope,
  VALIDATION_ERROR_CODES,
} from '../src/contract/validator.js';
import {
  validNewNamedAndRoleLabel,
  validMultipleNewAmbiguousNames,
  invalidNewMissingLocalRef,
  invalidNewDuplicateLocalRef,
  validExistingLiveDelta,
  validZeroScoreInteraction,
  invalidActiveMissingEvaluation,
  invalidOnePassWritingDurable,
  validNewFormBeforeDurableDefinition,
  validTerminalDeath,
  invalidResurrectionLivingReturn,
  invalidContradictoryLifecycle,
  invalidDeathStructuredOnly,
  invalidAdmissionStructuredOnly,
  validMistakenVictimSemanticBoundary,
  invalidDirectLifeStateBypass,
  invalidArbitraryOnePassSourceRef,
  invalidExistingWithNewIdentityMetadata,
  invalidShiftedTrueAllZeroAxes,
  invalidOnePassUnknownTopLevelKey,
  invalidOnePassUnknownProposalKey,
  invalidRelationshipAxesUnknownKey,
  invalidLifecycleUndeadState,
  invalidLifecycleAliveState,
  invalidLifecycleMissingSource,
  invalidWorldStateMood,
  invalidInnerChatterLocation,
  invalidInnerChatterRelationshipEvaluation,
} from './fixtures/one-pass-fixtures.js';

test('One-Pass Validator: minimal empty envelope is valid', () => {
  const envelope = { version: '1', proposals: [] };
  const res = validateOnePassEnvelope(envelope);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
});

test('One-Pass Validator: admits valid NEW named and role-label candidates with evidence', () => {
  const res = validateOnePassEnvelope(validNewNamedAndRoleLabel);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('One-Pass Validator: multiple NEW people with ambiguous/identical names disambiguated by localRef', () => {
  const res = validateOnePassEnvelope(validMultipleNewAmbiguousNames);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('One-Pass Validator: rejects NEW candidate missing localRef (no array-order fallback)', () => {
  const res = validateOnePassEnvelope(invalidNewMissingLocalRef);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_IDENTITY));
});

test('One-Pass Validator: rejects duplicate localRef in same envelope', () => {
  const res = validateOnePassEnvelope(invalidNewDuplicateLocalRef);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.DUPLICATE_LOCAL_REF));
});

test('One-Pass Validator: existing live delta preserves omitted fields (omission preserves)', () => {
  const res = validateOnePassEnvelope(validExistingLiveDelta);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('One-Pass Validator: explicit zero-relationship evaluation is valid', () => {
  const res = validateOnePassEnvelope(validZeroScoreInteraction);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('One-Pass Validator: rejects exchange-active NPC with missing relationship evaluation', () => {
  const res = validateOnePassEnvelope(invalidActiveMissingEvaluation);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.MISSING_RELATIONSHIP_EVALUATION));
});

test('One-Pass Validator: wrong-writer rejection when one-pass envelope contains development fields', () => {
  const res = validateOnePassEnvelope(invalidOnePassWritingDurable);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.WRONG_WRITER));
});

test('One-Pass Validator: allows new form observation before durable definition exists (unresolved form selector)', () => {
  const res = validateOnePassEnvelope(validNewFormBeforeDurableDefinition);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('One-Pass Validator: allows grounded terminal death proposal', () => {
  const res = validateOnePassEnvelope(validTerminalDeath);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('One-Pass Validator: rejects livingReturn and automatic resurrection', () => {
  const res = validateOnePassEnvelope(invalidResurrectionLivingReturn);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION));
});

test('One-Pass Validator: rejects contradictory lifecycle (dead while active/present)', () => {
  const res = validateOnePassEnvelope(invalidContradictoryLifecycle);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.CONTRADICTORY_LIFECYCLE));
});

test('One-Pass Validator: rejects structured-only death proposal', () => {
  const res = validateOnePassEnvelope(invalidDeathStructuredOnly);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('One-Pass Validator: rejects structured-only admission proposal', () => {
  const res = validateOnePassEnvelope(invalidAdmissionStructuredOnly);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('One-Pass Validator: mistaken-victim fixture passes mechanical validation without lexical heuristic', () => {
  const res = validateOnePassEnvelope(validMistakenVictimSemanticBoundary);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('One-Pass Validator: rejects direct lifeState bypass on proposal', () => {
  const res = validateOnePassEnvelope(invalidDirectLifeStateBypass);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION));
});

test('One-Pass Validator: rejects arbitrary one-pass sourceRef at wire boundary', () => {
  const res = validateOnePassEnvelope(invalidArbitraryOnePassSourceRef);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));
});

test('One-Pass Validator: rejects existing NPC with malformed NEW-only identity metadata', () => {
  const res = validateOnePassEnvelope(invalidExistingWithNewIdentityMetadata);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_IDENTITY));
});

test('One-Pass Validator: rejects shifted:true with all-zero axes', () => {
  const res = validateOnePassEnvelope(invalidShiftedTrueAllZeroAxes);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION));
});

test('One-Pass Validator: rejects unknown top-level key', () => {
  const res = validateOnePassEnvelope(invalidOnePassUnknownTopLevelKey);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('One-Pass Validator: rejects unknown proposal key', () => {
  const res = validateOnePassEnvelope(invalidOnePassUnknownProposalKey);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('One-Pass Validator (M-03): rejects unknown relationship axis key', () => {
  const res = validateOnePassEnvelope(invalidRelationshipAxesUnknownKey);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
  assert.match(res.errors[0].errorMessage, /Unknown relationship axis 'charisma'/);
});

test('One-Pass Validator (M-03): rejects non-dead lifeState (undead and alive)', () => {
  const undeadRes = validateOnePassEnvelope(invalidLifecycleUndeadState);
  assert.equal(undeadRes.valid, false);
  assert.ok(undeadRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION));
  assert.match(undeadRes.errors[0].errorMessage, /Invalid lifeState 'undead'/);

  const aliveRes = validateOnePassEnvelope(invalidLifecycleAliveState);
  assert.equal(aliveRes.valid, false);
  assert.ok(aliveRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION));
  assert.match(aliveRes.errors[0].errorMessage, /Invalid lifeState 'alive'/);
});

test('One-Pass Validator: rejects lifecycle death proposal missing source evidence', () => {
  const res = validateOnePassEnvelope(invalidLifecycleMissingSource);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION));
  assert.match(res.errors[0].errorMessage, /source evidence/);
});

test('One-Pass Validator (H-01): rejects World_State as source for mood', () => {
  const res = validateOnePassEnvelope(invalidWorldStateMood);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
  assert.match(res.errors[0].errorMessage, /cannot support field 'mood'/);
});

test('One-Pass Validator (H-01): rejects Inner_Chatter as source for location', () => {
  const res = validateOnePassEnvelope(invalidInnerChatterLocation);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
  assert.match(res.errors[0].errorMessage, /cannot support field 'location'/);
});

test('One-Pass Validator (H-01): rejects Inner_Chatter as source for relationship evaluation scoring', () => {
  const res = validateOnePassEnvelope(invalidInnerChatterRelationshipEvaluation);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
  assert.match(res.errors[0].errorMessage, /cannot support numeric relationship scoring/);
});

test('One-Pass Validator (L-06): rejects null, array, and non-object envelopes', () => {
  const nullRes = validateOnePassEnvelope(null);
  assert.equal(nullRes.valid, false);
  assert.equal(nullRes.errors[0].errorCode, VALIDATION_ERROR_CODES.INVALID_ENVELOPE);

  const arrRes = validateOnePassEnvelope([]);
  assert.equal(arrRes.valid, false);
  assert.equal(arrRes.errors[0].errorCode, VALIDATION_ERROR_CODES.INVALID_ENVELOPE);

  const strRes = validateOnePassEnvelope('invalid');
  assert.equal(strRes.valid, false);
  assert.equal(strRes.errors[0].errorCode, VALIDATION_ERROR_CODES.INVALID_ENVELOPE);
});

test('One-Pass Validator (L-06): rejects envelope version mismatch', () => {
  const res = validateOnePassEnvelope({ version: '99', proposals: [] });
  assert.equal(res.valid, false);
  assert.equal(res.errors[0].errorCode, VALIDATION_ERROR_CODES.VERSION_MISMATCH);
});

test('One-Pass Validator (H-01): rejects structured generic source with present:false', () => {
  const envelope = {
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        present: false,
        source: {
          sourceRef: 'current:assistant',
          segmentKind: 'world_state',
          excerpt: 'world_state: present=false',
        },
      },
    ],
  };
  const res = validateOnePassEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('One-Pass Validator (H-01): rejects structured generic source with activeInExchange', () => {
  const envelope = {
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        activeInExchange: false,
        source: {
          sourceRef: 'current:assistant',
          segmentKind: 'world_state',
          excerpt: 'world_state: activeInExchange=false',
        },
      },
    ],
  };
  const res = validateOnePassEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
  assert.match(res.errors[0].errorMessage, /activeInExchange/);
});

test('One-Pass Validator (H-01): rejects structured generic source with currentForm', () => {
  const envelope = {
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        currentForm: null,
        source: {
          sourceRef: 'current:assistant',
          segmentKind: 'world_state',
          excerpt: 'world_state: currentForm=none',
        },
      },
    ],
  };
  const res = validateOnePassEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
  assert.match(res.errors[0].errorMessage, /currentForm/);
});

test('One-Pass Validator (C03): rejects World_State as source on shifted:false relationship evaluation', () => {
  const envelope = {
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        activeInExchange: true,
        relationshipEvaluation: {
          shifted: false,
          source: {
            sourceRef: 'current:assistant',
            segmentKind: 'world_state',
            excerpt: 'world_state: neutral stance',
          },
        },
      },
    ],
  };
  const res = validateOnePassEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
  assert.match(res.errors[0].errorMessage, /cannot support numeric relationship scoring/);
});

test('One-Pass Validator (C03): rejects Inner_Chatter as source on shifted:false relationship evaluation', () => {
  const envelope = {
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        activeInExchange: true,
        relationshipEvaluation: {
          shifted: false,
          source: {
            sourceRef: 'current:assistant',
            segmentKind: 'inner_chatter',
            excerpt: 'inner_chatter: felt indifferent',
          },
        },
      },
    ],
  };
  const res = validateOnePassEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
  assert.match(res.errors[0].errorMessage, /cannot support numeric relationship scoring/);
});

test('One-Pass Validator (C03): allows narrative source on shifted:false relationship evaluation', () => {
  const envelope = {
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        activeInExchange: true,
        relationshipEvaluation: {
          shifted: false,
          source: {
            sourceRef: 'current:assistant',
            segmentKind: 'narrative',
            excerpt: 'Elena listened impassively without reacting.',
          },
        },
      },
    ],
  };
  const res = validateOnePassEnvelope(envelope);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('One-Pass Validator (C03): rejects structured generic source accompanying explicit zero relationship evaluation', () => {
  const envelope = {
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        activeInExchange: true,
        relationshipEvaluation: {
          shifted: false,
        },
        source: {
          sourceRef: 'current:assistant',
          segmentKind: 'world_state',
          excerpt: 'world_state: presence verified',
        },
      },
    ],
  };
  const res = validateOnePassEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
  assert.ok(res.errors.some((e) => e.errorMessage.includes('relationshipEvaluation')));
});

test('One-Pass Validator (C03): rejects structured generic source accompanying lifecycle death proposal', () => {
  const envelope = {
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        lifecycle: {
          lifeState: 'dead',
          source: {
            sourceRef: 'current:assistant',
            segmentKind: 'narrative',
            excerpt: 'Elena fell in battle.',
          },
        },
        source: {
          sourceRef: 'current:assistant',
          segmentKind: 'world_state',
          excerpt: 'world_state: hp=0',
        },
      },
    ],
  };
  const res = validateOnePassEnvelope(envelope);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
  assert.ok(res.errors.some((e) => e.errorMessage.includes('lifecycle')));
});

test('One-Pass Validator (HIGH 1): rejects non-canonical immediate types', () => {
  // present must be boolean
  const strPresent = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', present: 'true', source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(strPresent.valid, false);
  assert.ok(strPresent.errors.some((e) => e.errorMessage.includes('present must be a boolean')));

  // activeInExchange must be boolean
  const numActive = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', activeInExchange: 1, source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(numActive.valid, false);
  assert.ok(numActive.errors.some((e) => e.errorMessage.includes('activeInExchange must be a boolean')));

  // aliases must be array of non-empty strings
  const strAliases = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', aliases: 'stranger', source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(strAliases.valid, false);
  assert.ok(strAliases.errors.some((e) => e.errorMessage.includes('aliases must be an array of non-empty strings')));

  const emptyItemAliases = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', aliases: [''], source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(emptyItemAliases.valid, false);
  assert.ok(emptyItemAliases.errors.some((e) => e.errorMessage.includes('aliases must be an array of non-empty strings')));

  // currentForm cannot be empty string
  const emptyForm = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', currentForm: '', source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(emptyForm.valid, false);
  assert.ok(emptyForm.errors.some((e) => e.errorMessage.includes('currentForm must be a non-empty string or null')));

  // live scalar cannot be empty string
  const emptyMood = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', mood: '   ', source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(emptyMood.valid, false);
  assert.ok(emptyMood.errors.some((e) => e.errorMessage.includes('mood cannot be an empty string')));

  // Point 1: live scalar fields must reject non-string values (no {value,source} object wrapper)
  const objMood = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', mood: { value: 'calm' }, source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(objMood.valid, false);
  assert.ok(objMood.errors.some((e) => e.errorMessage.includes('mood must be a non-empty string')));
});

test('One-Pass Validator (HIGH 1): rejects ungrounded immediate mutation', () => {
  const ungrounded = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        location: 'Tavern cellar',
        // No source, presenceSource, or field-level source
      },
    ],
  });
  assert.equal(ungrounded.valid, false);
  assert.ok(ungrounded.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));
  assert.ok(ungrounded.errors.some((e) => e.errorMessage.includes('Proposed immediate mutation must carry valid source evidence')));
});

test('One-Pass Validator (MEDIUM 7): death contradiction rejects present, active, and offscreenActivity', () => {
  const deadPresent = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_bandit_01',
        present: true,
        lifecycle: {
          lifeState: 'dead',
          source: { sourceRef: 'current:assistant', excerpt: 'He fell lifeless.' },
        },
      },
    ],
  });
  assert.equal(deadPresent.valid, false);
  assert.ok(deadPresent.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.CONTRADICTORY_LIFECYCLE && e.errorMessage.includes('present=true')));

  const deadActive = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_bandit_01',
        activeInExchange: true,
        relationshipEvaluation: {
          shifted: false,
          source: { sourceRef: 'current:assistant', excerpt: 'He fell lifeless.' },
        },
        lifecycle: {
          lifeState: 'dead',
          source: { sourceRef: 'current:assistant', excerpt: 'He fell lifeless.' },
        },
      },
    ],
  });
  assert.equal(deadActive.valid, false);
  assert.ok(deadActive.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.CONTRADICTORY_LIFECYCLE && e.errorMessage.includes('activeInExchange=true')));

  const deadOffscreen = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_bandit_01',
        offscreenActivity: 'Riding through the valley',
        lifecycle: {
          lifeState: 'dead',
          source: { sourceRef: 'current:assistant', excerpt: 'He fell lifeless.' },
        },
      },
    ],
  });
  assert.equal(deadOffscreen.valid, false);
  assert.ok(deadOffscreen.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.CONTRADICTORY_LIFECYCLE && e.errorMessage.includes('offscreenActivity')));
});

test('One-Pass Validator (MEDIUM 4): rejects unknown nested keys in relationshipEvaluation and lifecycle', () => {
  const badREKey = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        activeInExchange: true,
        relationshipEvaluation: {
          shifted: false,
          rogueKey: 'disallowed',
          source: { sourceRef: 'current:assistant', excerpt: 'She nodded.' },
        },
      },
    ],
  });
  assert.equal(badREKey.valid, false);
  assert.ok(badREKey.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY && e.errorMessage.includes("Unknown key 'rogueKey'")));

  const badLifecycleKey = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_bandit_01',
        lifecycle: {
          lifeState: 'dead',
          source: { sourceRef: 'current:assistant', excerpt: 'He fell lifeless.' },
          extraProperty: 42,
        },
      },
    ],
  });
  assert.equal(badLifecycleKey.valid, false);
  assert.ok(badLifecycleKey.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY && e.errorMessage.includes("Unknown key 'extraProperty'")));
});

test('One-Pass Validator (Point 1): live scalar fields reject object wrappers and non-strings', () => {
  const fields = ['mood', 'location', 'goal', 'status', 'offscreenActivity', 'currentPresentation'];
  for (const f of fields) {
    // Rejects { value, source } object wrapper
    const objRes = validateOnePassEnvelope({
      version: '1',
      proposals: [{
        id: 'npc_1',
        [f]: { value: 'test_val', source: { sourceRef: 'current:assistant', excerpt: 'here' } },
        source: { sourceRef: 'current:assistant', excerpt: 'here' },
      }],
    });
    assert.equal(objRes.valid, false, `Expected rejection of object wrapper for ${f}`);
    assert.ok(objRes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD && e.errorMessage.includes(`${f} must be a non-empty string`)));

    // Rejects boolean
    const boolRes = validateOnePassEnvelope({
      version: '1',
      proposals: [{ id: 'npc_1', [f]: true, source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
    });
    assert.equal(boolRes.valid, false);

    // Rejects number
    const numRes = validateOnePassEnvelope({
      version: '1',
      proposals: [{ id: 'npc_1', [f]: 123, source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
    });
    assert.equal(numRes.valid, false);
  }
});

test('One-Pass Validator (Point 2): currentForm:null and shifted:false require grounding evidence', () => {
  // currentForm: null without source is rejected
  const ungroundedNullForm = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        currentForm: null,
      },
    ],
  });
  assert.equal(ungroundedNullForm.valid, false);
  assert.ok(ungroundedNullForm.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE && e.errorMessage.includes('currentForm')));

  // currentForm: null with source is accepted
  const groundedNullForm = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        currentForm: null,
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'She was unrecognizable, form unclear.',
        },
      },
    ],
  });
  assert.equal(groundedNullForm.valid, true, JSON.stringify(groundedNullForm.errors));

  // shifted: false relationshipEvaluation without source is rejected
  const ungroundedZeroShift = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        activeInExchange: true,
        presenceSource: {
          sourceRef: 'current:assistant',
          excerpt: 'Elena stood there.',
        },
        relationshipEvaluation: {
          shifted: false,
          reason: 'No change in relation',
        },
      },
    ],
  });
  assert.equal(ungroundedZeroShift.valid, false);
  assert.ok(ungroundedZeroShift.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION && e.errorMessage.includes('explicit evaluation requires supporting source evidence')));

  // shifted: false relationshipEvaluation with re.source is accepted
  const groundedZeroShift = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        activeInExchange: true,
        presenceSource: {
          sourceRef: 'current:assistant',
          excerpt: 'Elena stood there.',
        },
        relationshipEvaluation: {
          shifted: false,
          reason: 'No change in relation',
          source: {
            sourceRef: 'current:assistant',
            excerpt: 'Elena stared impassively.',
          },
        },
      },
    ],
  });
  assert.equal(groundedZeroShift.valid, true, JSON.stringify(groundedZeroShift.errors));
});

test('One-Pass Validator (Point 3): existing-NPC identity mutations (name, aliases) are typed and grounded', () => {
  // Existing NPC name without source rejected
  const ungroundedName = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        name: 'Elena the Wise',
      },
    ],
  });
  assert.equal(ungroundedName.valid, false);
  assert.ok(ungroundedName.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE && e.errorMessage.includes('name')));

  // Existing NPC name with source accepted
  const groundedName = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        name: 'Elena the Wise',
        source: {
          sourceRef: 'current:assistant',
          excerpt: '"Call me Elena the Wise," she declared.',
        },
      },
    ],
  });
  assert.equal(groundedName.valid, true, JSON.stringify(groundedName.errors));

  // Existing NPC aliases without source rejected
  const ungroundedAliases = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        aliases: ['Old Nick', 'The Librarian'],
      },
    ],
  });
  assert.equal(ungroundedAliases.valid, false);
  assert.ok(ungroundedAliases.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE && e.errorMessage.includes('aliases')));

  // Existing NPC aliases with source accepted
  const groundedAliases = validateOnePassEnvelope({
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        aliases: ['Old Nick', 'The Librarian'],
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'Some knew her as Old Nick, others as The Librarian.',
        },
      },
    ],
  });
  assert.equal(groundedAliases.valid, true, JSON.stringify(groundedAliases.errors));
});

test('One-Pass Validator (Point 4): falsy malformed values cannot evade validation', () => {
  // present: 0 rejected as non-boolean
  const badPresent = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', present: 0, source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(badPresent.valid, false);
  assert.ok(badPresent.errors.some((e) => e.errorMessage.includes('present must be a boolean')));

  // activeInExchange: "" rejected as non-boolean
  const badActive = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', activeInExchange: '', source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(badActive.valid, false);
  assert.ok(badActive.errors.some((e) => e.errorMessage.includes('activeInExchange must be a boolean')));

  // shifted: 0 rejected as non-boolean
  const badShifted = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: { shifted: 0, reason: 'r', source: { sourceRef: 'current:assistant', excerpt: 'here' } },
    }],
  });
  assert.equal(badShifted.valid, false);
  assert.ok(badShifted.errors.some((e) => e.errorMessage.includes('shifted')));

  // currentForm: false rejected as non-string/non-null
  const badCurrentForm = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', currentForm: false, source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(badCurrentForm.valid, false);
  assert.ok(badCurrentForm.errors.some((e) => e.errorMessage.includes('currentForm must be a non-empty string or null')));

  // currentForm: "" rejected
  const emptyCurrentForm = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', currentForm: '', source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(emptyCurrentForm.valid, false);
  assert.ok(emptyCurrentForm.errors.some((e) => e.errorMessage.includes('currentForm must be a non-empty string or null')));
});

test('One-Pass Validator (Strictness Pass): falsy source, presenceSource, and lifecycle values are strictly validated', () => {
  // source: null cannot evade validation
  const nullSource = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', source: null }],
  });
  assert.equal(nullSource.valid, false);
  assert.ok(nullSource.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));

  // source: false cannot evade validation
  const falseSource = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', source: false }],
  });
  assert.equal(falseSource.valid, false);
  assert.ok(falseSource.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));

  // presenceSource: null cannot evade validation
  const nullPresence = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', presenceSource: null, source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(nullPresence.valid, false);
  assert.ok(nullPresence.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));

  // presenceSource: false cannot evade validation
  const falsePresence = validateOnePassEnvelope({
    version: '1',
    proposals: [{ id: 'npc_1', presenceSource: false, source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
  });
  assert.equal(falsePresence.valid, false);
  assert.ok(falsePresence.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));

  // lifecycle: null / false / 0 / '' emit FORBIDDEN_LIFECYCLE_MUTATION
  for (const badLc of [null, false, 0, '']) {
    const res = validateOnePassEnvelope({
      version: '1',
      proposals: [{ id: 'npc_1', lifecycle: badLc, source: { sourceRef: 'current:assistant', excerpt: 'here' } }],
    });
    assert.equal(res.valid, false, `Expected lifecycle: ${JSON.stringify(badLc)} to be rejected`);
    assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION));
  }
});

test('One-Pass Validator (Strictness Pass): shifted:false requires reason to be non-empty string when supplied', () => {
  // reason: "" rejected for shifted: false
  const emptyReason = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: false,
        reason: '   ',
        source: { sourceRef: 'current:assistant', excerpt: 'She nodded.' },
      },
    }],
  });
  assert.equal(emptyReason.valid, false);
  assert.ok(emptyReason.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION && e.errorMessage.includes("'reason', if provided, must be a non-empty string")));

  // reason: 123 (non-string) rejected
  const nonStringReason = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: false,
        reason: 123,
        source: { sourceRef: 'current:assistant', excerpt: 'She nodded.' },
      },
    }],
  });
  assert.equal(nonStringReason.valid, false);
  assert.ok(nonStringReason.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION && e.errorMessage.includes("'reason', if provided, must be a non-empty string")));

  // reason: valid non-empty string accepted
  const validReason = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: false,
        reason: 'No shift occurred during brief encounter.',
        source: { sourceRef: 'current:assistant', excerpt: 'She nodded.' },
      },
    }],
  });
  assert.equal(validReason.valid, true);
});

test('One-Pass Validator (C07): per-axis numeric relationship evidence requirements', () => {
  // 1. Two changed axes with only one support entry is rejected
  const missingAxisSupport = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: true,
        impact: 'moderate',
        axes: { trust: 2, tension: -1 },
        axisSupport: {
          trust: {
            reason: 'Elena smiles warmly at the gesture.',
            source: { sourceRef: 'current:assistant', excerpt: 'Elena smiled warmly.' },
          },
        },
      },
    }],
  });
  assert.equal(missingAxisSupport.valid, false);
  assert.ok(missingAxisSupport.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION && e.errorMessage.includes("Missing axisSupport for changed axis 'tension'")));

  // 2. Two changed axes with independent matching support pass
  const validTwoAxes = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: true,
        impact: 'moderate',
        axes: { trust: 2, tension: -1 },
        axisSupport: {
          trust: {
            reason: 'Elena smiles warmly at the gesture.',
            source: { sourceRef: 'current:assistant', excerpt: 'Elena smiled warmly.' },
          },
          tension: {
            reason: 'Elena relaxes her guarded stance.',
            source: { sourceRef: 'current:assistant', excerpt: 'Elena relaxed her shoulders.' },
          },
        },
      },
    }],
  });
  assert.equal(validTwoAxes.valid, true, JSON.stringify(validTwoAxes.errors));

  // 3. Missing impact is rejected on shifted:true
  const missingImpact = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: true,
        axes: { trust: 1 },
        axisSupport: {
          trust: {
            reason: 'Shared a friendly nod.',
            source: { sourceRef: 'current:assistant', excerpt: 'A nod was exchanged.' },
          },
        },
      },
    }],
  });
  assert.equal(missingImpact.valid, false);
  assert.ok(missingImpact.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION && e.errorMessage.includes("'shifted:true' requires non-empty 'impact' string")));

  // 4. Unknown support axis is rejected
  const unknownSupportAxis = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: true,
        impact: 'minor',
        axes: { trust: 1 },
        axisSupport: {
          trust: {
            reason: 'Shared a friendly nod.',
            source: { sourceRef: 'current:assistant', excerpt: 'A nod was exchanged.' },
          },
          charisma: {
            reason: 'Exuded charm.',
            source: { sourceRef: 'current:assistant', excerpt: 'Very charming.' },
          },
        },
      },
    }],
  });
  assert.equal(unknownSupportAxis.valid, false);
  assert.ok(unknownSupportAxis.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION && e.errorMessage.includes("Unknown or invalid support axis 'charisma'")));

  // 5. Support provided for zero axis is rejected
  const zeroAxisSupport = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: true,
        impact: 'minor',
        axes: { trust: 1, tension: 0 },
        axisSupport: {
          trust: {
            reason: 'Shared a friendly nod.',
            source: { sourceRef: 'current:assistant', excerpt: 'A nod was exchanged.' },
          },
          tension: {
            reason: 'No tension change occurred.',
            source: { sourceRef: 'current:assistant', excerpt: 'Still calm.' },
          },
        },
      },
    }],
  });
  assert.equal(zeroAxisSupport.valid, false);
  assert.ok(zeroAxisSupport.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION && e.errorMessage.includes("Axis 'tension' is zero or unchanged; per-axis support cannot be provided for zero axes")));

  // 6. Array-form axisSupport is rejected (canonical wire requires object map)
  const arrayAxisSupport = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: true,
        impact: 'minor',
        axes: { trust: 1 },
        axisSupport: [
          {
            axis: 'trust',
            reason: 'Shared a friendly nod.',
            source: { sourceRef: 'current:assistant', excerpt: 'A nod was exchanged.' },
          },
        ],
      },
    }],
  });
  assert.equal(arrayAxisSupport.valid, false);
  assert.ok(arrayAxisSupport.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION && e.errorMessage.includes("'axisSupport' must be an object map of axis names to support entries")));

  // 7. shifted:false explicitly rejects axisSupport if supplied
  const shiftedFalseWithSupport = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: false,
        reason: 'Casual passing interaction, no change.',
        source: { sourceRef: 'current:assistant', excerpt: 'Just passing by.' },
        axisSupport: {
          trust: {
            reason: 'No shift occurred.',
            source: { sourceRef: 'current:assistant', excerpt: 'Just passing by.' },
          },
        },
      },
    }],
  });
  assert.equal(shiftedFalseWithSupport.valid, false);
  assert.ok(shiftedFalseWithSupport.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION && e.errorMessage.includes("'shifted:false' must not specify 'axisSupport'")));

  // 8. shifted:false remains valid in compact form without per-axis support
  const compactShiftedFalse = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: false,
        reason: 'Casual passing interaction, no change.',
        source: { sourceRef: 'current:assistant', excerpt: 'Just passing by.' },
      },
    }],
  });
  assert.equal(compactShiftedFalse.valid, true, JSON.stringify(compactShiftedFalse.errors));

  // 9. Extra 'explanation' key in axisSupport entry is rejected as unknown key
  const extraExplanationSupport = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: true,
        impact: 'minor',
        axes: { trust: 1 },
        axisSupport: {
          trust: {
            reason: 'Shared a friendly nod.',
            explanation: 'Extra explanation alias',
            source: { sourceRef: 'current:assistant', excerpt: 'A nod was exchanged.' },
          },
        },
      },
    }],
  });
  assert.equal(extraExplanationSupport.valid, false);
  assert.ok(extraExplanationSupport.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY && e.errorMessage.includes("Unknown key 'explanation'")));

  // 10. 'explanation'-only axisSupport entry (missing reason) is rejected
  const explanationOnlySupport = validateOnePassEnvelope({
    version: '1',
    proposals: [{
      id: 'npc_1',
      relationshipEvaluation: {
        shifted: true,
        impact: 'minor',
        axes: { trust: 1 },
        axisSupport: {
          trust: {
            explanation: 'Sole explanation without reason',
            source: { sourceRef: 'current:assistant', excerpt: 'A nod was exchanged.' },
          },
        },
      },
    }],
  });
  assert.equal(explanationOnlySupport.valid, false);
  assert.ok(explanationOnlySupport.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY && e.errorMessage.includes("Unknown key 'explanation'")));
  assert.ok(explanationOnlySupport.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION && e.errorMessage.includes("requires a non-empty concise 'reason' string")));
});
