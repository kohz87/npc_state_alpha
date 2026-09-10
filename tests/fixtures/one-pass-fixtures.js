/**
 * Acceptance Fixtures for NPC State Alpha One-Pass Immediate Wire Boundary
 *
 * Implements test fixtures required by S1 workplan:
 * - NEW named and role-label people
 * - Multiple NEW local refs and ambiguous names
 * - Existing live delta with no durable mutation
 * - No-change and zero-score interaction
 * - Wrong-writer rejections
 * - New form before durable definition
 * - Terminal death, contradictory lifecycle, attempted resurrection
 * - Structured-source permissions and firewall
 */

import {
  ALPHA_ONE_PASS_WIRE_VERSION,
  STRUCTURED_SEGMENT_KINDS,
} from '../../src/contract/wire-schemas.js';

export const validNewNamedAndRoleLabel = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: null,
      localRef: 'new:barkeep',
      name: 'Barkeep',
      identityKind: 'role_label',
      evidence: {
        sourceRef: 'current:assistant',
        excerpt: 'The barkeep wiped down the counter with an oily rag.',
      },
      present: true,
      activeInExchange: false,
      location: 'Behind the bar',
    },
    {
      id: null,
      localRef: 'new:elena',
      name: 'Elena',
      identityKind: 'named',
      evidence: {
        sourceRef: 'current:assistant',
        excerpt: '"My name is Elena," the young scholar offered shyly.',
      },
      present: true,
      activeInExchange: true,
      mood: 'shy',
      relationshipEvaluation: {
        shifted: true,
        axes: { trust: 1, affection: 0, desire: 0, tension: 0 },
        impact: 'minor',
        axisSupport: {
          trust: {
            reason: 'Polite introductory exchange with initial guarded trust',
            source: {
              sourceRef: 'current:assistant',
              excerpt: '"My name is Elena," the young scholar offered shyly.',
            },
          },
        },
      },
    },
  ],
};

export const validMultipleNewAmbiguousNames = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: null,
      localRef: 'new:guard_gate',
      name: 'Town Guard',
      identityKind: 'role_label',
      evidence: {
        sourceRef: 'current:assistant',
        excerpt: 'The first Town Guard stood resolute at the iron gate.',
      },
      present: true,
      location: 'North Gate',
    },
    {
      id: null,
      localRef: 'new:guard_wall',
      name: 'Town Guard',
      identityKind: 'role_label',
      evidence: {
        sourceRef: 'current:assistant',
        excerpt: 'Another Town Guard peered down from the crenellations.',
      },
      present: true,
      location: 'Upper Wall',
    },
  ],
};

export const invalidNewMissingLocalRef = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: null,
      name: 'Mysterious Stranger',
      identityKind: 'role_label',
      evidence: {
        sourceRef: 'current:assistant',
        excerpt: 'A stranger watched from the dark alley.',
      },
      present: true,
    },
  ],
};

export const invalidNewDuplicateLocalRef = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: null,
      localRef: 'new:scout',
      name: 'Scout A',
      identityKind: 'role_label',
      evidence: {
        sourceRef: 'current:assistant',
        excerpt: 'The first scout signaled with three whistles.',
      },
    },
    {
      id: null,
      localRef: 'new:scout',
      name: 'Scout B',
      identityKind: 'role_label',
      evidence: {
        sourceRef: 'current:assistant',
        excerpt: 'The second scout crept forward through the brush.',
      },
    },
  ],
};

export const validExistingLiveDelta = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      mood: 'alarmed',
      location: 'Tavern cellar',
      status: 'Examining broken wine casks',
      currentPresentation: 'Soot-streaked face and torn scholar robes',
      source: {
        sourceRef: 'current:assistant',
        excerpt: 'Elena examined the broken wine casks in the tavern cellar, her soot-streaked face alarmed.',
      },
    },
  ],
};

export const validZeroScoreInteraction = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_barkeep_102',
      present: true,
      activeInExchange: true,
      presenceSource: {
        sourceRef: 'current:assistant',
        excerpt: 'The barkeep swept the silver into his palm without looking up.',
      },
      relationshipEvaluation: {
        shifted: false,
        reason: 'Transactional exchange; took the coin without any relational movement',
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'The barkeep swept the silver into his palm without looking up.',
        },
      },
    },
  ],
};

export const invalidActiveMissingEvaluation = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_barkeep_102',
      present: true,
      activeInExchange: true,
      mood: 'busy',
      // Missing relationshipEvaluation when activeInExchange is true!
    },
  ],
};

export const invalidOnePassWritingDurable = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      mood: 'thoughtful',
      // Wrong-writer: personality and relationshipDynamic are development-owned!
      personality: {
        traits: ['Curious', 'Bookish'],
      },
      relationshipDynamic: 'Warm scholarly ally',
    },
  ],
};

export const validNewFormBeforeDurableDefinition = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_lyra_202',
      present: true,
      activeInExchange: true,
      source: {
        sourceRef: 'current:assistant',
        excerpt: 'Black feathers erupted from her shoulders as her eyes flared with violet light.',
      },
      currentPresentation: 'Sprouted immense midnight-black feathered wings and luminescent violet eyes',
      currentForm: null, // Unknown/new form remains unresolved while presentation is captured!
      relationshipEvaluation: {
        shifted: true,
        axes: { trust: 0, affection: 0, desire: 0, tension: 2 },
        impact: 'moderate',
        axisSupport: {
          tension: {
            reason: 'Startling demonic transformation increases tension sharply',
            source: {
              sourceRef: 'current:assistant',
              excerpt: 'Black feathers erupted from her shoulders as her eyes flared with violet light.',
            },
          },
        },
      },
    },
  ],
};

export const validTerminalDeath = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_bandit_leader_303',
      present: false,
      activeInExchange: false,
      lifecycle: {
        lifeState: 'dead',
        cause: 'Slain in duel by the player blade',
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'The bandit leader collapsed to the stone floor, lifeless.',
        },
      },
    },
  ],
};

export const invalidResurrectionLivingReturn = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_bandit_leader_303',
      lifecycle: {
        lifeState: 'alive',
        livingReturn: true, // Forbidden automatic channel!
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'He gasped and rose from the grave.',
        },
      },
    },
  ],
};

export const invalidContradictoryLifecycle = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_guard_404',
      present: true, // Contradiction: claiming present and active while dead!
      activeInExchange: true,
      lifecycle: {
        lifeState: 'dead',
        cause: 'Arrow wound',
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'The guard fell dead.',
        },
      },
    },
  ],
};

export const invalidDeathStructuredOnly = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_villager_505',
      lifecycle: {
        lifeState: 'dead',
        cause: 'Epidemic',
        source: {
          sourceRef: 'current:assistant',
          segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
          excerpt: 'Villager status: deceased',
        },
      },
    },
  ],
};

export const invalidAdmissionStructuredOnly = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: null,
      localRef: 'new:ghost',
      name: 'Specter',
      identityKind: 'role_label',
      evidence: {
        sourceRef: 'current:assistant',
        segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
        excerpt: 'world_state: entity specter detected',
      },
    },
  ],
};

/**
 * Mistaken-victim fixture (Requirement 10):
 * Narrative: "Elena gasped as Brom's heavy warhammer crushed the bandit leader, whose lifeless corpse crashed into the mud."
 * Although Elena and Brom (possessive: "Brom's") are present in the narrative sentence,
 * the actual victim is the bandit leader.
 * Proves the wire requires explicit target identity ('npc_bandit_leader_303') plus grounded source,
 * and that the mechanical validator does NOT use lexical or possessive heuristics to decide the victim.
 */
export const validMistakenVictimSemanticBoundary = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_bandit_leader_303',
      present: false,
      activeInExchange: false,
      lifecycle: {
        lifeState: 'dead',
        cause: 'Struck down by Brom in battle',
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'whose lifeless corpse crashed into the mud',
        },
      },
    },
  ],
};

/**
 * Rejected: Direct lifeState on proposal bypassing lifecycle object (Requirement 5).
 */
export const invalidDirectLifeStateBypass = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_bandit_leader_303',
      lifeState: 'dead', // Bypasses lifecycle object!
    },
  ],
};

/**
 * Rejected: One-pass sourceRef using arbitrary reference instead of reserved ones (Requirement 5).
 */
export const invalidArbitraryOnePassSourceRef = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: null,
      localRef: 'new:scout',
      name: 'Scout',
      identityKind: 'role_label',
      evidence: {
        sourceRef: 'current:other_actor', // Arbitrary reference, not current:user or current:assistant
        excerpt: 'The scout appeared on the ridge.',
      },
    },
  ],
};

/**
 * Rejected: Existing NPC masquerading with NEW-only identity metadata (Requirement 5).
 */
export const invalidExistingWithNewIdentityMetadata = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      localRef: 'new:elena', // Forbidden on existing NPC!
      identityKind: 'named',
      mood: 'calm',
    },
  ],
};

/**
 * Rejected: shifted:true with all-zero axes (Requirement 6).
 */
export const invalidShiftedTrueAllZeroAxes = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      present: true,
      activeInExchange: true,
      relationshipEvaluation: {
        shifted: true,
        axes: { trust: 0, affection: 0, desire: 0, tension: 0 }, // All zero!
        reason: 'Claimed shift but all axes are zero',
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'Elena nodded thoughtfully.',
        },
      },
    },
  ],
};

/**
 * Rejected: Unknown top-level key on one-pass envelope (Requirement 5).
 */
export const invalidOnePassUnknownTopLevelKey = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [],
  unknownKey: 'forbidden_payload',
};

/**
 * Rejected: Unknown proposal key on one-pass proposal (Requirement 5).
 */
export const invalidOnePassUnknownProposalKey = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      mood: 'happy',
      arbitraryDataField: 'unexpected_value',
    },
  ],
};

/**
 * M-03: Rejected - Unknown axis key in relationshipEvaluation.axes.
 */
export const invalidRelationshipAxesUnknownKey = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      present: true,
      activeInExchange: true,
      relationshipEvaluation: {
        shifted: true,
        axes: { trust: 1, affection: 0, desire: 0, tension: 0, charisma: 2 },
        impact: 'minor',
        axisSupport: {
          trust: {
            reason: 'Trust evidence provided',
            source: {
              sourceRef: 'current:assistant',
              excerpt: 'She nodded gently.',
            },
          },
        },
      },
    },
  ],
};

/**
 * M-03: Rejected - Lifecycle proposal specifying lifeState 'undead'.
 */
export const invalidLifecycleUndeadState = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_bandit_303',
      lifecycle: {
        lifeState: 'undead',
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'Risen as a zombie.',
        },
      },
    },
  ],
};

/**
 * M-03: Rejected - Lifecycle proposal specifying lifeState 'alive'.
 */
export const invalidLifecycleAliveState = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_bandit_303',
      lifecycle: {
        lifeState: 'alive',
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'Still alive.',
        },
      },
    },
  ],
};

/**
 * Rejected - Lifecycle death proposal missing source evidence.
 */
export const invalidLifecycleMissingSource = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_bandit_303',
      lifecycle: {
        lifeState: 'dead',
      },
    },
  ],
};

/**
 * H-01: Rejected - World_State as source for mood.
 */
export const invalidWorldStateMood = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      mood: 'furious',
      source: {
        sourceRef: 'current:assistant',
        segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
        excerpt: 'world_state: mood=furious',
      },
    },
  ],
};

/**
 * H-01: Rejected - Inner_Chatter as source for location.
 */
export const invalidInnerChatterLocation = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_guard_01',
      location: 'Dungeon Barracks',
      presenceSource: {
        sourceRef: 'current:assistant',
        segmentKind: STRUCTURED_SEGMENT_KINDS.INNER_CHATTER,
        excerpt: '<thought>I am sitting in the dungeon barracks.</thought>',
      },
    },
  ],
};

/**
 * H-01: Rejected - Inner_Chatter as source for relationship evaluation scoring.
 */
export const invalidInnerChatterRelationshipEvaluation = {
  version: ALPHA_ONE_PASS_WIRE_VERSION,
  proposals: [
    {
      id: 'npc_elena_101',
      present: true,
      activeInExchange: true,
      relationshipEvaluation: {
        shifted: true,
        axes: { trust: 1, affection: 0, desire: 0, tension: 0 },
        impact: 'minor',
        axisSupport: {
          trust: {
            reason: 'Appears to trust',
            source: {
              sourceRef: 'current:assistant',
              segmentKind: STRUCTURED_SEGMENT_KINDS.INNER_CHATTER,
              excerpt: '<thought>I should trust them slightly.</thought>',
            },
          },
        },
      },
    },
  ],
};


