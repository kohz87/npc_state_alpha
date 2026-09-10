/**
 * Acceptance Fixtures for NPC State Alpha Structured Adapter Boundary
 *
 * Implements test fixtures required by S1 workplan:
 * - Generic structured-source segment metadata/permissions
 * - World_State corroborating location/status
 * - Inner_Chatter supporting mood/goal/relationship dynamic
 * - Rejection of structured-source authority broadening (admission, physical presence, death, durable facts)
 * - Rejection and quarantine of unsupported/unverified adapter formats (Megumin, Freaky Frankenstein)
 *   without verified format fixtures.
 */

import {
  ALPHA_ONE_PASS_WIRE_VERSION,
  ALPHA_DEVELOPMENT_WIRE_VERSION,
  STRUCTURED_SEGMENT_KINDS,
} from '../../src/contract/wire-schemas.js';

/**
 * Valid: World_State corroborating live location and status.
 */
export const validWorldStateCorroboration = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_guard_01',
      location: 'Barracks Courtyard',
      status: 'Standing watch at armory entrance',
      source: {
        sourceRef: 'current:assistant',
        segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
        excerpt: 'world_state.location: Barracks Courtyard; entities.guard_01.status: standing watch',
      },
      presenceSource: {
        sourceRef: 'current:assistant',
        segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
        excerpt: 'The guard remained posted by the courtyard armory.',
      },
    },
  ],
};

/**
 * Valid: Inner_Chatter supporting private mood, goal, and relationship dynamic.
 */
export const validInnerChatterSupport = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      mood: 'secretly terrified',
      goal: 'Hide the forbidden grimoire before dawn',
      source: {
        sourceRef: 'current:assistant',
        segmentKind: STRUCTURED_SEGMENT_KINDS.INNER_CHATTER,
        excerpt: '<thought>I must remain calm, but inside I am terrified... I have to hide the grimoire before dawn.</thought>',
      },
    },
  ],
};

/**
 * Rejected: World_State attempting to independently admit an NPC.
 */
export const rejectedWorldStateAdmission = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: null,
      localRef: 'new:assassin',
      name: 'Shadow Assassin',
      identityKind: 'role_label',
      evidence: {
        sourceRef: 'current:assistant',
        segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
        excerpt: 'entities: [{ type: "npc", role: "assassin", stealth: true }]',
      },
    },
  ],
};

/**
 * Rejected: World_State attempting to establish terminal death.
 */
export const rejectedWorldStateDeath = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_guard_01',
      lifecycle: {
        lifeState: 'dead',
        cause: 'System flagged zero HP',
        source: {
          sourceRef: 'current:assistant',
          segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
          excerpt: 'world_state.entities.guard_01.health: 0',
        },
      },
    },
  ],
};

/**
 * Rejected: Inner_Chatter attempting to prove physical in-scene presence.
 */
export const rejectedInnerChatterPresence = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      present: true,
      presenceSource: {
        sourceRef: 'current:assistant',
        segmentKind: STRUCTURED_SEGMENT_KINDS.INNER_CHATTER,
        excerpt: '<thought>I am standing right here beside them.</thought>',
      },
    },
  ],
};

/**
 * Rejected: World_State attempting to score numeric player relationship.
 */
export const rejectedWorldStateRelationshipScoring = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      present: true,
      activeInExchange: true,
      relationshipEvaluation: {
        shifted: true,
        axes: { trust: 2, affection: 1, desire: 0, tension: 0 },
        impact: 'moderate',
        axisSupport: {
          trust: {
            reason: 'World state affinity variable increased',
            source: {
              sourceRef: 'current:assistant',
              segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
              excerpt: 'affinity.elena += 2',
            },
          },
          affection: {
            reason: 'World state affection variable increased',
            source: {
              sourceRef: 'current:assistant',
              segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
              excerpt: 'affection.elena += 1',
            },
          },
        },
      },
    },
  ],
};

/**
 * Rejected: World_State attempting to rewrite durable profile facts.
 */
export const rejectedWorldStateDurableFacts = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
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
      facts: {
        species: 'Elf',
        source: {
          sourceRef: 'msg:1',
          segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
          excerpt: 'metadata.species = "Elf"',
        },
      },
    },
  ],
};

/**
 * Rejected & Quarantined: Unverified adapter block / unsupported dialect.
 * Unverified formats (e.g. hypothetical Megumin or Freaky Frankenstein without verified fixtures)
 * fail closed and must not fall back to visible narration.
 */
export const rejectedUnverifiedAdapterSegment = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      mood: 'curious',
      presenceSource: {
        sourceRef: 'current:assistant',
        segmentKind: 'unverified_freaky_frankenstein_v1',
        excerpt: 'FF_BLOCK::state={mood:"curious"}',
      },
    },
  ],
};

/**
 * Generic sameEvent / copy linkage metadata fixture (Requirement 9, C03):
 * Shows that a derived structured representation (e.g. World_State mirroring narrative)
 * carries copy linkage metadata ('copiedFrom' / 'sameEventRef').
 * Asserts structural preservation and validation of 'copiedFrom' and 'sameEventRef'
 * on the wire source record, without claiming runtime recurrence processing behavior.
 */
export const validSameEventCopyLinkageFixture = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_guard_01',
      location: 'Barracks Courtyard',
      status: 'Standing watch at armory entrance',
      source: {
        sourceRef: 'current:assistant',
        segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
        excerpt: 'entities.guard_01.location = "Barracks Courtyard"',
        copiedFrom: 'current:assistant#narrative:1',
        sameEventRef: 'evt_guard_post_01',
      },
    },
  ],
};

