import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOnePassEnvelope,
  validateDevelopmentEnvelope,
  VALIDATION_ERROR_CODES,
} from '../src/contract/validator.js';
import {
  validWorldStateCorroboration,
  validInnerChatterSupport,
  rejectedWorldStateAdmission,
  rejectedWorldStateDeath,
  rejectedInnerChatterPresence,
  rejectedWorldStateRelationshipScoring,
  rejectedWorldStateDurableFacts,
  rejectedUnverifiedAdapterSegment,
  validSameEventCopyLinkageFixture,
} from './fixtures/structured-adapter-fixtures.js';

test('Structured Adapter: World_State corroborating live location and status is permitted', () => {
  const res = validateOnePassEnvelope(validWorldStateCorroboration);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('Structured Adapter: Inner_Chatter supporting private mood and goal is permitted', () => {
  const res = validateOnePassEnvelope(validInnerChatterSupport);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('Structured Adapter: rejects World_State attempting NPC admission', () => {
  const res = validateOnePassEnvelope(rejectedWorldStateAdmission);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('Structured Adapter: rejects World_State attempting death proposal', () => {
  const res = validateOnePassEnvelope(rejectedWorldStateDeath);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('Structured Adapter: rejects Inner_Chatter attempting physical in-scene presence', () => {
  const res = validateOnePassEnvelope(rejectedInnerChatterPresence);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('Structured Adapter: rejects World_State attempting player relationship scoring', () => {
  const res = validateOnePassEnvelope(rejectedWorldStateRelationshipScoring);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('Structured Adapter: rejects Inner_Chatter attempting player relationship scoring', () => {
  const proposal = {
    version: '1',
    proposals: [
      {
        id: 'npc_elena_101',
        present: true,
        activeInExchange: true,
        relationshipEvaluation: {
          shifted: true,
          axes: { trust: 1 },
          impact: 'minor',
          axisSupport: {
            trust: {
              reason: 'Thought analysis',
              source: {
                sourceRef: 'current:assistant',
                segmentKind: 'inner_chatter',
                excerpt: '<thought>I trust this person</thought>',
              },
            },
          },
        },
      },
    ],
  };
  const res = validateOnePassEnvelope(proposal);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('Structured Adapter: rejects World_State attempting durable profile fact synthesis', () => {
  const res = validateDevelopmentEnvelope(rejectedWorldStateDurableFacts);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));
});

test('Structured Adapter: unverified adapter dialect fails closed and is quarantined', () => {
  const res = validateOnePassEnvelope(rejectedUnverifiedAdapterSegment);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT));
});

test('Structured Adapter: structurally preserves and validates copiedFrom and sameEventRef linkage fields', () => {
  const res = validateOnePassEnvelope(validSameEventCopyLinkageFixture);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
  // Structurally preserves and validates copiedFrom and sameEventRef metadata without claiming runtime recurrence processing behavior
  assert.equal(validSameEventCopyLinkageFixture.proposals[0].source.copiedFrom, 'current:assistant#narrative:1');
  assert.equal(validSameEventCopyLinkageFixture.proposals[0].source.sameEventRef, 'evt_guard_post_01');
});

test('Structured Adapter (LOW 11): positive fixtures carry actual world_state and inner_chatter segmentKinds', () => {
  assert.equal(typeof validWorldStateCorroboration.proposals[0].location, 'string');
  assert.equal(typeof validWorldStateCorroboration.proposals[0].status, 'string');
  assert.equal(validWorldStateCorroboration.proposals[0].source.segmentKind, 'world_state');
  assert.equal(typeof validInnerChatterSupport.proposals[0].mood, 'string');
  assert.equal(typeof validInnerChatterSupport.proposals[0].goal, 'string');
  assert.equal(validInnerChatterSupport.proposals[0].source.segmentKind, 'inner_chatter');
});

test('Structured Adapter (LOW 8): independently validates sameEventRef, copiedFrom, and derivedFrom linkage fields', () => {
  // Valid derivedFrom
  const validDerived = {
    version: '1',
    proposals: [
      {
        id: 'npc_guard_01',
        location: 'Barracks Courtyard',
        source: {
          sourceRef: 'current:assistant',
          segmentKind: 'world_state',
          excerpt: 'world_state.location: Barracks Courtyard',
          derivedFrom: 'source_log_entry_42',
        },
        presenceSource: {
          sourceRef: 'current:assistant',
          excerpt: 'Guard is present.',
        },
      },
    ],
  };
  const resValid = validateOnePassEnvelope(validDerived);
  assert.equal(resValid.valid, true, JSON.stringify(resValid.errors));

  // Invalid sameEventRef: empty string
  const badSameEvent = {
    version: '1',
    proposals: [
      {
        id: 'npc_guard_01',
        location: 'Barracks Courtyard',
        source: {
          sourceRef: 'current:assistant',
          segmentKind: 'world_state',
          excerpt: 'world_state.location: Barracks Courtyard',
          sameEventRef: '  ',
        },
        presenceSource: {
          sourceRef: 'current:assistant',
          excerpt: 'Guard is present.',
        },
      },
    ],
  };
  const resSameEvent = validateOnePassEnvelope(badSameEvent);
  assert.equal(resSameEvent.valid, false);
  assert.ok(resSameEvent.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));
  assert.match(resSameEvent.errors[0].errorMessage, /Linkage reference 'sameEventRef'/);

  // Invalid copiedFrom: empty string
  const badCopiedFrom = {
    version: '1',
    proposals: [
      {
        id: 'npc_guard_01',
        location: 'Barracks Courtyard',
        source: {
          sourceRef: 'current:assistant',
          segmentKind: 'world_state',
          excerpt: 'world_state.location: Barracks Courtyard',
          copiedFrom: '',
        },
        presenceSource: {
          sourceRef: 'current:assistant',
          excerpt: 'Guard is present.',
        },
      },
    ],
  };
  const resCopiedFrom = validateOnePassEnvelope(badCopiedFrom);
  assert.equal(resCopiedFrom.valid, false);
  assert.ok(resCopiedFrom.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));
  assert.match(resCopiedFrom.errors[0].errorMessage, /Linkage reference 'copiedFrom'/);

  // Invalid derivedFrom: non-string
  const badDerivedFrom = {
    version: '1',
    proposals: [
      {
        id: 'npc_guard_01',
        location: 'Barracks Courtyard',
        source: {
          sourceRef: 'current:assistant',
          segmentKind: 'world_state',
          excerpt: 'world_state.location: Barracks Courtyard',
          derivedFrom: 99999,
        },
        presenceSource: {
          sourceRef: 'current:assistant',
          excerpt: 'Guard is present.',
        },
      },
    ],
  };
  const resDerivedFrom = validateOnePassEnvelope(badDerivedFrom);
  assert.equal(resDerivedFrom.valid, false);
  assert.ok(resDerivedFrom.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));
  assert.match(resDerivedFrom.errors[0].errorMessage, /Linkage reference 'derivedFrom'/);
});


