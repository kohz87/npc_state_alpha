/**
 * Acceptance Fixtures for NPC State Alpha Development Review Boundary
 *
 * Implements test fixtures required by S1 workplan:
 * - Direct durable establishment on first review
 * - Development observations, dispositions, and enrichment
 * - Observation-to-accepted-field support references
 * - Contradiction and supersession links
 * - Narrowly scoped review receipts and no-op target receipts
 * - Wrong-writer rejections (development attempting fast writes)
 * - Structured adapter firewall (structured segments cannot rewrite durable canon)
 */

import {
  ALPHA_DEVELOPMENT_WIRE_VERSION,
  STRUCTURED_SEGMENT_KINDS,
} from '../../src/contract/wire-schemas.js';

export const validDevelopmentEstablishment = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  reviewReceipts: [
    {
      targetId: 'npc_elena_101',
      sourceScope: ['msg:1', 'msg:2'],
      status: 'reviewed',
    },
  ],
  proposals: [
    {
      targetId: 'npc_elena_101',
      facts: {
        role: 'Assistant Archivist at the Royal Athenaeum',
        species: 'Human',
        actualAge: '24',
        birthday: 'Autumn 14th',
        source: {
          sourceRef: 'msg:2',
          excerpt: '"I have been an assistant archivist at the Athenaeum since my twenty-fourth year," Elena explained.',
        },
      },
      personality: {
        traits: ['Intellectual', 'Methodical', 'Reserved'],
        source: {
          sourceRef: 'msg:2',
          excerpt: 'She pushed her silver spectacles up her nose and cited the library charter.',
        },
        operation: 'establish',
      },
      speech: {
        value: 'Academic and formal vocabulary with occasional hesitant pauses',
        source: {
          sourceRef: 'msg:2',
          excerpt: 'She pushed her silver spectacles up her nose and cited the library charter.',
        },
        operation: 'establish',
      },
      mannerisms: {
        items: ['Pushes spectacles up the bridge of her nose when nervous'],
        source: {
          sourceRef: 'msg:2',
          excerpt: 'She pushed her silver spectacles up her nose and cited the library charter.',
        },
        operation: 'establish',
      },
      relationshipDynamic: {
        value: 'Cautious academic acquaintance who respects intellectual curiosity',
        source: {
          sourceRef: 'msg:2',
          excerpt: '"Your questions show genuine insight, traveller," she noted with a small nod.',
        },
      },
    },
  ],
};

export const validDevelopmentEnrichment = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  reviewReceipts: [
    {
      targetId: 'npc_elena_101',
      sourceScope: ['msg:3', 'msg:4'],
      status: 'reviewed',
    },
  ],
  proposals: [
    {
      targetId: 'npc_elena_101',
      personality: {
        traits: ['Intellectual', 'Methodical', 'Reserved', 'Fiercely protective of ancient texts'],
        source: {
          sourceRef: 'msg:4',
          excerpt: 'Elena shielded the ancient tome with her body, eyes blazing with unexpected fury.',
        },
        operation: 'enrich',
      },
    },
  ],
};

export const validObservationsWithDispositions = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  reviewReceipts: [
    {
      targetId: 'npc_elena_101',
      sourceScope: ['msg:5'],
      status: 'reviewed',
    },
  ],
  observations: [
    {
      localObservationRef: 'obs:elena:01',
      targetId: 'npc_elena_101',
      field: 'personality',
      observation: 'Displays subtle distaste for martial weapons',
      source: {
        sourceRef: 'msg:5',
        excerpt: 'Elena stepped back with a visible shudder as the heavy broadsword was drawn.',
      },
      disposition: {
        role: 'tentative',
      },
    },
    {
      localObservationRef: 'obs:elena:02',
      targetId: 'npc_elena_101',
      field: 'mannerisms',
      observation: 'Consistent nervous tic pushing spectacles during confrontation',
      source: {
        sourceRef: 'msg:5',
        excerpt: 'Her fingers flew to her spectacles again, shoving them upward.',
      },
      disposition: {
        role: 'supporting',
        linkedFieldRevision: 'rev_elena_mannerisms_01',
      },
    },
    {
      localObservationRef: 'obs:elena:03',
      targetId: 'npc_elena_101',
      field: 'background',
      observation: 'Contradicts earlier claim of noble lineage by admitting orphan heritage',
      source: {
        sourceRef: 'msg:5',
        excerpt: '"I never knew my father; the Guild took me from the streets," she confessed.',
      },
      disposition: {
        role: 'contradicting',
        linkedObservationRefs: ['obs_elena_prior_noble_claim'],
      },
    },
    {
      localObservationRef: 'obs:elena:04',
      targetId: 'npc_elena_101',
      field: 'speech',
      observation: 'Replaced formal diction with casual street slang during high stress',
      source: {
        sourceRef: 'msg:5',
        excerpt: '"Cut the crap," she snapped, dropping all pretense of nobility.',
      },
      disposition: {
        role: 'superseded',
        linkedObservationRefs: ['obs_elena_formal_speech_01'],
      },
    },
  ],
  supportProposals: [
    {
      targetId: 'npc_elena_101',
      field: 'mannerisms',
      supportingObservationRefs: ['obs:elena:02'],
      sourceRefs: ['msg:5'],
      notes: 'Reinforced evidence for spectacle-adjusting mannerism',
    },
  ],
};

export const validNarrowReviewReceipt = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  reviewReceipts: [
    {
      targetId: 'npc_elena_101',
      sourceScope: ['msg:6'],
      status: 'reviewed',
      restricted: true,
      fieldSubset: ['speech', 'mannerisms'],
    },
  ],
  proposals: [],
};

export const validNoOpReceipt = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  reviewReceipts: [
    {
      targetId: 'npc_brom_01',
      sourceScope: ['msg:1', 'msg:2'],
      status: 'reviewed_no_proposals',
    },
  ],
  proposals: [],
};

export const invalidDevelopmentWritingImmediate = {
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
      // Wrong-writer: mood, location, presence, and lifeState are one-pass-owned!
      mood: 'happy',
      location: 'Athenaeum Courtyard',
      present: true,
      lifeState: 'dead',
    },
  ],
};

export const invalidDurableStructuredOnly = {
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
        role: 'High Priestess',
        source: {
          sourceRef: 'msg:1',
          segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
          excerpt: 'world_state: role=high_priestess',
        },
      },
    },
  ],
};

/**
 * Rejected: Model observation authoring persistent ID (Requirement 2).
 */
export const invalidObservationWithPersistentId = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  observations: [
    {
      id: 'obs_author_attempt_01', // Forbidden! Persistent ID must be runtime-assigned
      targetId: 'npc_elena_101',
      field: 'personality',
      observation: 'Prefers quiet corners',
      source: {
        sourceRef: 'msg:1',
        excerpt: 'Elena sat alone in the quietest alcove.',
      },
    },
  ],
};

/**
 * Rejected: Duplicate localObservationRef in same envelope (Requirement 2).
 */
export const invalidObservationDuplicateLocalRef = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  observations: [
    {
      localObservationRef: 'obs:1',
      targetId: 'npc_elena_101',
      field: 'personality',
      observation: 'Quiet scholar',
      source: { sourceRef: 'msg:1', excerpt: 'She read quietly.' },
    },
    {
      localObservationRef: 'obs:1', // Duplicate!
      targetId: 'npc_elena_101',
      field: 'speech',
      observation: 'Soft voice',
      source: { sourceRef: 'msg:1', excerpt: 'She spoke in a whisper.' },
    },
  ],
};

/**
 * Rejected: Evidence disposition missing required linked references (Requirement 2).
 */
export const invalidDispositionMissingLink = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  observations: [
    {
      localObservationRef: 'obs:1',
      targetId: 'npc_elena_101',
      field: 'mannerisms',
      observation: 'Pushes spectacles nervously',
      source: { sourceRef: 'msg:1', excerpt: 'Her hand touched her glasses.' },
      disposition: {
        role: 'supporting', // Requires linkedFieldRevision or linkedObservationRefs!
      },
    },
  ],
};

/**
 * Rejected: Unrestricted receipt carrying fieldSubset (Requirement 4).
 */
export const invalidUnrestrictedReceiptWithFieldSubset = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  reviewReceipts: [
    {
      targetId: 'npc_elena_101',
      sourceScope: ['msg:1'],
      status: 'reviewed',
      fieldSubset: ['personality'], // Forbidden when restricted is not true!
    },
  ],
};

/**
 * Rejected: Restricted receipt with runtime bookkeeping or observations in fieldSubset (Requirement 4).
 */
export const invalidRestrictedReceiptWithInternalBookkeeping = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  reviewReceipts: [
    {
      targetId: 'npc_elena_101',
      sourceScope: ['msg:1'],
      status: 'reviewed',
      restricted: true,
      fieldSubset: ['observations', 'reviewReceipts'], // Ineligible fields!
    },
  ],
};

/**
 * Rejected: Support proposal referencing non-existent observation (Requirement 3).
 */
export const invalidSupportProposalMissingObservation = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  observations: [
    {
      localObservationRef: 'obs:elena:01',
      targetId: 'npc_elena_101',
      field: 'personality',
      observation: 'Observant',
      source: { sourceRef: 'msg:1', excerpt: 'She noticed everything.' },
    },
  ],
  supportProposals: [
    {
      targetId: 'npc_elena_101',
      field: 'personality',
      supportingObservationRefs: ['obs:non_existent_ref'], // Missing!
      sourceRefs: ['msg:1'],
    },
  ],
};

/**
 * Rejected: Support proposal target mismatch with referenced observation (Requirement 3).
 */
export const invalidSupportProposalTargetMismatch = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  observations: [
    {
      localObservationRef: 'obs:elena:01',
      targetId: 'npc_elena_101',
      field: 'personality',
      observation: 'Observant',
      source: { sourceRef: 'msg:1', excerpt: 'She noticed everything.' },
    },
  ],
  supportProposals: [
    {
      targetId: 'npc_brom_01', // Mismatched target!
      field: 'personality',
      supportingObservationRefs: ['obs:elena:01'],
      sourceRefs: ['msg:1'],
    },
  ],
};

/**
 * Rejected: Support proposal field mismatch with referenced observation (Requirement 3).
 */
export const invalidSupportProposalFieldMismatch = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  observations: [
    {
      localObservationRef: 'obs:elena:01',
      targetId: 'npc_elena_101',
      field: 'mannerisms',
      observation: 'Fidgets with pen',
      source: { sourceRef: 'msg:1', excerpt: 'Her pen tapped the wood.' },
    },
  ],
  supportProposals: [
    {
      targetId: 'npc_elena_101',
      field: 'role', // Mismatched field (role vs mannerisms)!
      supportingObservationRefs: ['obs:elena:01'],
      sourceRefs: ['msg:1'],
    },
  ],
};

/**
 * Rejected: Unknown top-level key on development envelope (Requirement 5).
 */
export const invalidDevelopmentUnknownTopLevelKey = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [],
  unknownDurableConfig: true,
};

/**
 * Rejected: Unknown proposal key on development proposal (Requirement 5).
 */
export const invalidDevelopmentUnknownProposalKey = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      unauthorizedProposalField: 'bad_value',
    },
  ],
};

/**
 * M-01: Rejected - Personality smuggling speech facet inside personality object.
 */
export const invalidPersonalitySmugglingSpeech = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      personality: {
        traits: ['Methodical'],
        speech: 'Formal academic diction',
      },
    },
  ],
};

/**
 * M-01: Rejected - Personality smuggling mannerisms facet inside personality object.
 */
export const invalidPersonalitySmugglingMannerisms = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      personality: {
        traits: ['Methodical'],
        mannerisms: ['Pushes spectacles up nose'],
      },
    },
  ],
};

/**
 * M-01: Rejected - Personality smuggling behavioralProfile facet inside personality object.
 */
export const invalidPersonalitySmugglingBehavioralProfile = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      personality: {
        traits: ['Methodical'],
        behavioralProfile: 'Cautious researcher',
      },
    },
  ],
};

/**
 * M-01: Rejected - Unknown key in personality facet object.
 */
export const invalidPersonalityUnknownKey = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      personality: {
        traits: ['Methodical'],
        arbitraryKey: 'illegal_smuggle',
      },
    },
  ],
};

/**
 * M-02: Valid durable domains envelope covering canonicalAppearance, behavioralProfile,
 * appearanceForms, importantMemories, and nonPlayerRelationships.
 */
export const validDurableDomainsFixture = {
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
      canonicalAppearance: {
        value: 'Slender woman in indigo archivist robes with silver spectacles',
        source: {
          sourceRef: 'msg:1',
          excerpt: 'Elena wore indigo archivist robes and silver spectacles.',
        },
        operation: 'establish',
      },
      behavioralProfile: {
        value: 'Meticulous researcher who prioritizes document preservation',
        source: {
          sourceRef: 'msg:1',
          excerpt: 'She refused to abandon the library until folios were safe.',
        },
        operation: 'establish',
      },
      appearanceForms: {
        operation: 'add',
        forms: [
          {
            formId: 'form_human_archivist',
            label: 'Human Archivist',
            description: 'Default humanoid form wearing robes and spectacles',
            source: {
              sourceRef: 'msg:1',
              excerpt: 'Elena stood in her normal archivist robes.',
            },
          },
        ],
      },
      importantMemories: {
        operation: 'add',
        memories: [
          {
            localMemoryRef: 'mem:grand_archive_fire',
            summary: 'Survived the Grand Archive fire of year 102',
            source: {
              sourceRef: 'msg:1',
              excerpt: 'Elena recalled the Great Archive fire that shaped her youth.',
            },
          },
        ],
      },
      nonPlayerRelationships: {
        operation: 'establish',
        relationships: [
          {
            targetId: 'npc_archivist_master_01',
            relationship: 'Apprentice to Head Archivist Vane',
            source: {
              sourceRef: 'msg:1',
              excerpt: 'Vane had apprenticed Elena five years prior.',
            },
          },
        ],
      },
    },
  ],
};

/**
 * M-02: Rejected - Appearance form item with unknown key.
 */
export const invalidAppearanceFormUnknownKey = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      appearanceForms: [
        {
          formId: 'form_wolf',
          label: 'Dire Wolf',
          smuggledField: 'unauthorized',
        },
      ],
    },
  ],
};

/**
 * M-02: Rejected - Appearance form item missing formId / localFormRef.
 */
export const invalidAppearanceFormMissingId = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      appearanceForms: [
        {
          label: 'Dire Wolf',
          description: 'A large grey wolf form',
        },
      ],
    },
  ],
};

/**
 * M-02: Rejected - Memory item missing text / summary.
 */
export const invalidMemoryMissingText = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      importantMemories: [
        {
          localMemoryRef: 'mem:fire',
          operation: 'add',
        },
      ],
    },
  ],
};

/**
 * M-02: Rejected - Memory item with unknown key.
 */
export const invalidMemoryUnknownKey = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      importantMemories: [
        {
          localMemoryRef: 'mem:fire',
          summary: 'Survived the fire',
          unknownMemoryAttr: true,
        },
      ],
    },
  ],
};

/**
 * M-02: Rejected - Non-player relationship missing target reference.
 */
export const invalidNonPlayerRelationshipMissingTarget = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      nonPlayerRelationships: [
        {
          relationship: 'Sworn ally',
        },
      ],
    },
  ],
};

/**
 * M-02: Rejected - Non-player relationship with unknown key.
 */
export const invalidNonPlayerRelationshipUnknownKey = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      nonPlayerRelationships: [
        {
          targetId: 'npc_ally_01',
          relationship: 'Sworn ally',
          unauthorizedRelField: 123,
        },
      ],
    },
  ],
};

/**
 * M-02: Rejected - Scalar durable field with invalid operation.
 */
export const invalidScalarOperation = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      canonicalAppearance: {
        value: 'Slender woman in robes',
        operation: 'append', // Invalid for scalar!
      },
    },
  ],
};

/**
 * M-02: Rejected - Collection durable field with invalid operation.
 */
export const invalidCollectionOperation = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      appearanceForms: {
        operation: 'rewrite_all', // Invalid collection operation!
        forms: [],
      },
    },
  ],
};

/**
 * H-01: Rejected - World_State attempting canonicalAppearance durable proposal.
 */
export const invalidWorldStateCanonicalAppearanceProposal = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      canonicalAppearance: {
        value: 'Slender woman in robes',
        source: {
          sourceRef: 'msg:1',
          segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
          excerpt: 'world_state: appearance=slender_robes',
        },
      },
    },
  ],
};

/**
 * H-01: Rejected - World_State attempting personality durable proposal.
 */
export const invalidWorldStatePersonalityProposal = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      personality: {
        traits: ['Methodical'],
        source: {
          sourceRef: 'msg:1',
          segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
          excerpt: 'world_state: personality=methodical',
        },
      },
    },
  ],
};

/**
 * H-01: Rejected - World_State attempting importantMemories durable proposal.
 */
export const invalidWorldStateMemoryProposal = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      importantMemories: [
        {
          summary: 'Survived fire',
          source: {
            sourceRef: 'msg:1',
            segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
            excerpt: 'world_state: memory=fire',
          },
        },
      ],
    },
  ],
};

/**
 * H-01: Rejected - World_State attempting appearanceForms durable proposal.
 */
export const invalidWorldStateFormProposal = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      appearanceForms: [
        {
          formId: 'form_wolf',
          source: {
            sourceRef: 'msg:1',
            segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
            excerpt: 'world_state: form=wolf',
          },
        },
      ],
    },
  ],
};

/**
 * H-01: Rejected - World_State attempting nonPlayerRelationships durable proposal.
 */
export const invalidWorldStateNonPlayerRelationProposal = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      nonPlayerRelationships: [
        {
          targetId: 'npc_vane_01',
          relationship: 'Apprentice',
          source: {
            sourceRef: 'msg:1',
            segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
            excerpt: 'world_state: relation=apprentice',
          },
        },
      ],
    },
  ],
};

/**
 * H-01: Rejected - World_State attempting relationshipDynamic durable proposal.
 */
export const invalidWorldStateRelationshipDynamicProposal = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      relationshipDynamic: {
        value: 'Guarded academic acquaintance',
        source: {
          sourceRef: 'msg:1',
          segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
          excerpt: 'world_state: dynamic=guarded',
        },
      },
    },
  ],
};

/**
 * H-01: Valid - Inner_Chatter supporting relationshipDynamic durable proposal.
 */
export const validInnerChatterRelationshipDynamicProposal = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      relationshipDynamic: {
        value: 'Secretly admires the traveler but maintains reserve',
        source: {
          sourceRef: 'msg:1',
          segmentKind: STRUCTURED_SEGMENT_KINDS.INNER_CHATTER,
          excerpt: '<thought>I admire their diligence, but I must stay guarded.</thought>',
        },
      },
    },
  ],
};

/**
 * H-01: Rejected - World_State as source for observation on canonicalAppearance.
 */
export const invalidWorldStateObservationField = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  observations: [
    {
      localObservationRef: 'obs:elena:01',
      targetId: 'npc_elena_101',
      field: 'canonicalAppearance',
      observation: 'Silver spectacles observed',
      source: {
        sourceRef: 'msg:1',
        segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
        excerpt: 'world_state: spectacles=silver',
      },
    },
  ],
};

/**
 * Rejected: Source excerpt contains trailer self-citation (C03).
 */
export const invalidSelfCitationDurableSource = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      personality: {
        traits: ['Methodical'],
        source: {
          sourceRef: 'msg:1',
          excerpt: 'Prior narrative <npc_state_alpha_v1>{"version":"1"}</npc_state_alpha_v1>',
        },
      },
    },
  ],
};

/**
 * Rejected: Malformed source record on durable field (missing sourceRef).
 */
export const invalidMalformedDurableSource = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      personality: {
        traits: ['Methodical'],
        source: {
          excerpt: 'She worked diligently.',
        },
      },
    },
  ],
};

/**
 * L-03: Rejected - Development wire carrying runtime-owned acceptedSupport field.
 */
export const invalidDevelopmentWithAcceptedSupport = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  acceptedSupport: [
    {
      targetId: 'npc_elena_101',
      field: 'personality',
    },
  ],
  proposals: [],
};

/**
 * C05: Rejected - Destructive operation on appearanceForms with only localFormRef.
 */
export const invalidAppearanceFormDestructiveLocalOnly = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      appearanceForms: {
        operation: 'remove',
        forms: [
          {
            localFormRef: 'form:temporary_wolf',
            source: {
              sourceRef: 'msg:2',
              excerpt: 'Elena shifted back to human form.',
            },
          },
        ],
      },
    },
  ],
};

/**
 * C05: Valid - Destructive operation on appearanceForms with stable formId.
 */
export const validAppearanceFormDestructiveStableFormId = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      appearanceForms: {
        operation: 'remove',
        forms: [
          {
            formId: 'form_wolf_01',
            source: {
              sourceRef: 'msg:2',
              excerpt: 'Elena shed the dire wolf guise permanently.',
            },
          },
        ],
      },
    },
  ],
};

/**
 * C05: Rejected - Destructive operation on importantMemories with only localMemoryRef.
 */
export const invalidMemoryDestructiveLocalOnly = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      importantMemories: {
        operation: 'remove',
        memories: [
          {
            localMemoryRef: 'mem:grand_archive_fire',
            source: {
              sourceRef: 'msg:2',
              excerpt: 'She let go of that ancient memory.',
            },
          },
        ],
      },
    },
  ],
};

/**
 * C05: Valid - Destructive operation on importantMemories with stable memoryId.
 */
export const validMemoryDestructiveStableMemoryId = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      importantMemories: {
        operation: 'remove',
        memories: [
          {
            memoryId: 'mem_rec_001',
            source: {
              sourceRef: 'msg:2',
              excerpt: 'Elena wiped the slate clean regarding that rumor.',
            },
          },
        ],
      },
    },
  ],
};

/**
 * C05: Rejected - Destructive operation on nonPlayerRelationships with only targetRef.
 */
export const invalidNonPlayerRelationshipDestructiveLocalOnly = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      nonPlayerRelationships: {
        operation: 'remove',
        relationships: [
          {
            targetRef: 'new:barkeep',
            source: {
              sourceRef: 'msg:2',
              excerpt: 'They severed all ties with the newcomer.',
            },
          },
        ],
      },
    },
  ],
};

/**
 * C05: Valid - Destructive operation on nonPlayerRelationships with stable relationId.
 */
export const validNonPlayerRelationshipDestructiveStableRelationId = {
  version: ALPHA_DEVELOPMENT_WIRE_VERSION,
  proposals: [
    {
      targetId: 'npc_elena_101',
      nonPlayerRelationships: {
        operation: 'remove',
        relationships: [
          {
            relationId: 'rel_elena_vane_01',
            source: {
              sourceRef: 'msg:2',
              excerpt: 'Elena officially dissolved her apprenticeship.',
            },
          },
        ],
      },
    },
  ],
};



