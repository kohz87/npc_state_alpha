import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFieldProposal,
  applyNpcProposals,
} from '../src/runtime/field-applier.js';
import {
  normalizeRelationshipScore,
  createDefaultRelationshipState,
} from '../src/runtime/relationship-mechanics.js';
import {
  createDefaultNpcRecord,
} from '../src/state/schema.js';
import {
  WRITERS,
} from '../src/contract/registry.js';

test('Field Applier: one-pass fields accepted under ONE_PASS writer', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  const proposals = {
    mood: 'focused',
    location: 'guild library',
    goal: 'research ancient script',
    status: 'reading intently',
    currentPresentation: 'wearing traveler cloak and dusty boots',
  };

  const res = applyNpcProposals(npc, proposals, WRITERS.ONE_PASS);
  assert.equal(res.applied, true, res.errors.join('; '));
  assert.equal(npc.mood, 'focused');
  assert.equal(npc.location, 'guild library');
  assert.equal(npc.goal, 'research ancient script');
  assert.equal(npc.status, 'reading intently');
  assert.equal(npc.currentPresentation, 'wearing traveler cloak and dusty boots');
  assert.equal(npc.fieldRevisions.mood, 2);
});

test('Field Applier: development fields accepted under DEVELOPMENT writer', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  const proposals = {
    role: 'Chief Archivist',
    species: 'Human',
    canonicalAppearance: 'Tall with raven hair tied back and sharp hazel eyes',
    relationshipDynamic: 'Professional respect with guarded curiosity',
  };

  const res = applyNpcProposals(npc, proposals, WRITERS.DEVELOPMENT);
  assert.equal(res.applied, true, res.errors.join('; '));
  assert.equal(npc.role, 'Chief Archivist');
  assert.equal(npc.species, 'Human');
  assert.equal(npc.canonicalAppearance, 'Tall with raven hair tied back and sharp hazel eyes');
  assert.equal(npc.relationshipDynamic, 'Professional respect with guarded curiosity');
});

test('Field Applier: wrong writer rejected in both directions (C02)', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');

  // ONE_PASS attempting development-owned field (canonicalAppearance)
  const onePassAttempt = applyFieldProposal(npc, 'canonicalAppearance', 'Dark hair', WRITERS.ONE_PASS);
  assert.equal(onePassAttempt.applied, false);
  assert.match(onePassAttempt.error, /Wrong-writer rejection/);

  // DEVELOPMENT attempting one-pass field (mood)
  const devAttempt = applyFieldProposal(npc, 'mood', 'joyful', WRITERS.DEVELOPMENT);
  assert.equal(devAttempt.applied, false);
  assert.match(devAttempt.error, /Wrong-writer rejection/);
});

test('Field Applier: omission preserves existing state (C05)', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena', {
    mood: 'serene',
    location: 'temple garden',
  });

  // Proposal updates only location; mood is omitted
  const res = applyNpcProposals(npc, { location: 'inner sanctum' }, WRITERS.ONE_PASS);
  assert.equal(res.applied, true);
  assert.equal(npc.location, 'inner sanctum');
  assert.equal(npc.mood, 'serene'); // Preserved untouched
});

test('Field Applier: field-level lock blocks automatic writes', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.location = 'sacred grove';
  npc.locks.location = true; // User locked location

  const res = applyFieldProposal(npc, 'location', 'tavern', WRITERS.ONE_PASS);
  assert.equal(res.applied, false);
  assert.equal(res.reason, 'locked');
  assert.equal(npc.location, 'sacred grove'); // Untouched
});

test('Field Applier: manual correction remains distinct from an explicit automatic-write lock (C02, C05)', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.mood = 'calm';
  npc.manualCorrections.mood = {
    value: 'calm',
    correctedAt: '2026-09-10T00:00:00Z',
    writer: WRITERS.USER,
    reason: 'User corrected mood',
  };

  // A correction alone does not freeze future automatic evolution.
  const automatic = applyFieldProposal(npc, 'mood', 'alarmed', WRITERS.ONE_PASS);
  assert.equal(automatic.applied, true);
  assert.equal(npc.mood, 'alarmed');
  assert.ok(npc.manualCorrections.mood, 'Correction provenance remains retained separately.');

  // The explicit lock is the mechanism that blocks future automatic writes.
  npc.locks.mood = true;
  const locked = applyFieldProposal(npc, 'mood', 'furious', WRITERS.ONE_PASS);
  assert.equal(locked.applied, false);
  assert.equal(locked.reason, 'locked');
  assert.equal(npc.mood, 'alarmed');
});

test('Field Applier: stable collection operations (add, replace, remove)', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.mannerisms = ['taps chin when thinking'];

  // Add mannerism
  const addRes = applyFieldProposal(npc, 'mannerisms', {
    operation: 'add',
    value: 'adjusts spectacles frequently',
  }, WRITERS.DEVELOPMENT);
  assert.equal(addRes.applied, true);
  assert.deepEqual(npc.mannerisms, ['taps chin when thinking', 'adjusts spectacles frequently']);

  // Remove mannerism
  const remRes = applyFieldProposal(npc, 'mannerisms', {
    operation: 'remove',
    value: 'taps chin when thinking',
  }, WRITERS.DEVELOPMENT);
  assert.equal(remRes.applied, true);
  assert.deepEqual(npc.mannerisms, ['adjusts spectacles frequently']);
});

test('Field Applier: currentPresentation does not rewrite canonical appearance', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.canonicalAppearance = 'Slender elven frame with silver hair';

  const res = applyFieldProposal(npc, 'currentPresentation', 'Splattered in mud and soaked by rain', WRITERS.ONE_PASS);
  assert.equal(res.applied, true);
  assert.equal(npc.currentPresentation, 'Splattered in mud and soaked by rain');
  assert.equal(npc.canonicalAppearance, 'Slender elven frame with silver hair'); // Canonical appearance preserved
});

test('Field Applier: currentForm null is valid; known form verified against appearanceForms', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.appearanceForms = [
    { formId: 'form_human', name: 'Human Disguise' },
    { formId: 'form_raven', name: 'Raven Form' },
  ];

  // Start with established form
  npc.currentForm = 'form_human';

  // Null is valid unresolved selector transitioning back to unresolved
  const nullRes = applyFieldProposal(npc, 'currentForm', null, WRITERS.ONE_PASS);
  assert.equal(nullRes.applied, true);
  assert.equal(npc.currentForm, null);

  // Known form succeeds
  const formRes = applyFieldProposal(npc, 'currentForm', 'form_raven', WRITERS.ONE_PASS);
  assert.equal(formRes.applied, true);
  assert.equal(npc.currentForm, 'form_raven');

  // Unknown form remains unresolved (null)
  const unknownRes = applyFieldProposal(npc, 'currentForm', 'form_dragon_unknown', WRITERS.ONE_PASS);
  assert.equal(npc.currentForm, null);
});

test('Field Applier: death clears incompatible live/action states (C06 projection)', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.present = true;
  npc.activeInExchange = true;
  npc.offscreenActivity = 'patrolling the yard';

  const res = applyFieldProposal(npc, 'lifeState', 'dead', WRITERS.ONE_PASS);
  assert.equal(res.applied, true);
  assert.equal(npc.lifeState, 'dead');
  assert.equal(npc.present, false);
  assert.equal(npc.activeInExchange, false);
  assert.equal(npc.offscreenActivity, null);
});

test('Field Applier: automatic dead->alive transition is forbidden (C06 terminal death)', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.lifeState = 'dead';

  const onePassRes = applyFieldProposal(npc, 'lifeState', 'alive', WRITERS.ONE_PASS);
  assert.equal(onePassRes.applied, false);
  assert.match(onePassRes.error, /Automatic dead->alive lifecycle transition is forbidden/);

  const devRes = applyFieldProposal(npc, 'lifeState', 'alive', WRITERS.DEVELOPMENT);
  assert.equal(devRes.applied, false);
  assert.ok(devRes.error);

  assert.equal(npc.lifeState, 'dead');
});

test('Field Applier: relationshipEvaluation supports S1 axes and preserves fractional precision', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.relationship = {
    trust: 10,
    affection: 5,
    desire: 0,
    tension: 2,
    lastEvaluationExchange: null,
  };

  const evalRes = applyFieldProposal(npc, 'relationshipEvaluation', {
    shifted: true,
    impact: 'Warm and teasing gesture',
    axes: {
      trust: 1.5,
      affection: 2.25,
      tension: -0.5,
    },
  }, WRITERS.ONE_PASS);

  assert.equal(evalRes.applied, true);
  assert.equal(npc.relationship.trust, 11.5);
  assert.equal(npc.relationship.affection, 7.25);
  assert.equal(npc.relationship.tension, 1.5);
  assert.equal(npc.relationship.desire, 0);
});

test('Field Applier: S1 collection containers with forms, memories, and relationships', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');

  // 1. appearanceForms container with forms array and formId
  const afRes = applyFieldProposal(npc, 'appearanceForms', {
    operation: 'add',
    forms: [
      { formId: 'form_wolf_01', name: 'Dire Wolf' },
      { formId: 'form_raven_01', name: 'Shadow Raven' },
    ],
  }, WRITERS.DEVELOPMENT);
  assert.equal(afRes.applied, true);
  assert.equal(npc.appearanceForms.length, 2);
  assert.equal(npc.appearanceForms[0].formId, 'form_wolf_01');

  // Replace form
  const afRep = applyFieldProposal(npc, 'appearanceForms', {
    operation: 'replace',
    forms: [{ formId: 'form_wolf_01', name: 'Alpha Dire Wolf' }],
  }, WRITERS.DEVELOPMENT);
  assert.equal(afRep.applied, true);
  assert.equal(npc.appearanceForms[0].name, 'Alpha Dire Wolf');

  // Remove form
  const afRem = applyFieldProposal(npc, 'appearanceForms', {
    operation: 'remove',
    forms: [{ formId: 'form_raven_01' }],
  }, WRITERS.DEVELOPMENT);
  assert.equal(afRem.applied, true);
  assert.equal(npc.appearanceForms.length, 1);
  assert.equal(npc.appearanceForms[0].formId, 'form_wolf_01');

  // 2. importantMemories container with memories array and memoryId
  const memRes = applyFieldProposal(npc, 'importantMemories', {
    operation: 'add',
    memories: [
      { memoryId: 'mem_01', text: 'Survived the siege of Oakhaven' },
    ],
  }, WRITERS.DEVELOPMENT);
  assert.equal(memRes.applied, true);
  assert.equal(npc.importantMemories.length, 1);
  assert.equal(npc.importantMemories[0].memoryId, 'mem_01');

  // 3. nonPlayerRelationships container with relationships array and relationId
  const nprRes = applyFieldProposal(npc, 'nonPlayerRelationships', {
    operation: 'establish',
    relationships: [
      { relationId: 'rel_01', targetId: 'npc_garrick', relationKind: 'rival', description: 'Friendly rival blacksmith' },
    ],
  }, WRITERS.DEVELOPMENT);
  assert.equal(nprRes.applied, true);
  assert.equal(npc.nonPlayerRelationships.length, 1);
  assert.equal(npc.nonPlayerRelationships[0].relationId, 'rel_01');
});

test('Field Applier: applyNpcProposals transaction containment prevents partial mutation on error', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.present = false;
  npc.mood = 'calm';

  // Proposal has a valid field ('mood') and an unauthorized field for ONE_PASS ('personality')
  const batch = {
    mood: 'excited',
    personality: 'Extroverted scholar', // Not writable by ONE_PASS (DEVELOPMENT only)
  };

  const res = applyNpcProposals(npc, batch, WRITERS.ONE_PASS);
  assert.equal(res.applied, false);
  assert.ok(res.errors.length > 0);

  // Caller's npc object was NOT mutated at all (transaction containment)
  assert.equal(npc.mood, 'calm');
  assert.equal(npc.present, false);
  assert.equal(npc.personality, null);
});

test('Field Applier (Item A): Alpha strictly requires formId and axes; legacy id and shifts rejected/ignored', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.appearanceForms = [
    { formId: 'form_wolf_1', name: 'Wolf' },
  ];

  // currentForm matching legacy 'id' instead of formId fails resolution to null
  npc.currentForm = 'form_wolf_1';
  npc.appearanceForms.push({ id: 'legacy_form_id', name: 'Legacy Form' });
  const formRes = applyFieldProposal(npc, 'currentForm', 'legacy_form_id', WRITERS.ONE_PASS);
  assert.equal(formRes.applied, true);
  // Unknown formId resolves to null (Item A)
  assert.equal(npc.currentForm, null);

  // relationshipEvaluation with legacy shifts without axes is rejected.
  const legacyRes = applyFieldProposal(npc, 'relationshipEvaluation', {
    shifted: true,
    shifts: { trust: 5 }, // legacy key, not axes!
  }, WRITERS.ONE_PASS);
  assert.equal(legacyRes.applied, false);
  assert.match(legacyRes.error, /requires an axes object/i);
  assert.equal(npc.relationship.trust, 0);

  // With axes it succeeds
  const axesRes = applyFieldProposal(npc, 'relationshipEvaluation', {
    shifted: true,
    axes: { trust: 5 },
  }, WRITERS.ONE_PASS);
  assert.equal(axesRes.applied, true);
  assert.equal(npc.relationship.trust, 5);
});

test('Field Applier (Item B): fail-closed collection semantics and wire metadata stripping', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.appearanceForms = [
    { formId: 'form_raven_1', name: 'Raven' },
  ];

  // 1. replace of missing item must NOT silently append; fails closed
  const replaceMissing = applyFieldProposal(npc, 'appearanceForms', {
    operation: 'replace',
    forms: [{ formId: 'form_nonexistent', name: 'Ghost' }],
  }, WRITERS.DEVELOPMENT);
  assert.equal(replaceMissing.applied, false);
  assert.equal(replaceMissing.reason, 'target_not_found');
  assert.equal(npc.appearanceForms.length, 1);

  // 2. add/establish against existing stable ID must NOT silently replace; fails closed
  const addExisting = applyFieldProposal(npc, 'appearanceForms', {
    operation: 'add',
    forms: [{ formId: 'form_raven_1', name: 'Shadow Raven' }],
  }, WRITERS.DEVELOPMENT);
  assert.equal(addExisting.applied, false);
  assert.equal(addExisting.reason, 'already_exists');
  assert.equal(npc.appearanceForms[0].name, 'Raven'); // preserved

  // 3. remove of missing target returns applied: false
  const removeMissing = applyFieldProposal(npc, 'appearanceForms', {
    operation: 'remove',
    forms: [{ formId: 'form_missing' }],
  }, WRITERS.DEVELOPMENT);
  assert.equal(removeMissing.applied, false);
  assert.equal(removeMissing.reason, 'not_found');
  assert.equal(npc.appearanceForms.length, 1);

  // 4. Storing items strips wire metadata (source, operation, evidence)
  const addWithWireMeta = applyFieldProposal(npc, 'appearanceForms', {
    operation: 'add',
    forms: [
      {
        formId: 'form_wolf_1',
        name: 'White Wolf',
        source: { sourceRef: 'msg_1', excerpt: 'wolf' },
        operation: 'add',
        evidence: 'transformed',
      },
    ],
  }, WRITERS.DEVELOPMENT);
  assert.equal(addWithWireMeta.applied, true);
  assert.equal(npc.appearanceForms.length, 2);
  const storedWolf = npc.appearanceForms[1];
  assert.equal(storedWolf.formId, 'form_wolf_1');
  assert.equal(storedWolf.name, 'White Wolf');
  assert.equal(storedWolf.source, undefined);
  assert.equal(storedWolf.operation, undefined);
  assert.equal(storedWolf.evidence, undefined);

  // 5. consolidate authorized whole-array overwrite with metadata stripped
  const consolidateRes = applyFieldProposal(npc, 'appearanceForms', {
    operation: 'consolidate',
    forms: [
      {
        formId: 'form_dragon_1',
        name: 'Elder Dragon',
        source: { sourceRef: 'msg_5' },
      },
    ],
  }, WRITERS.DEVELOPMENT);
  assert.equal(consolidateRes.applied, true);
  assert.equal(npc.appearanceForms.length, 1);
  assert.equal(npc.appearanceForms[0].formId, 'form_dragon_1');
  assert.equal(npc.appearanceForms[0].source, undefined);
});

test('Field Applier (Item E): relationship scoring mechanics removes artificial bounds clamping', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.relationship = {
    trust: 95,
    affection: -95,
    desire: 0,
    tension: 50,
    lastEvaluationExchange: null,
  };

  // Delta pushing score beyond +100 and -100 is NOT clamped to [-100, 100]
  const evalRes = applyFieldProposal(npc, 'relationshipEvaluation', {
    shifted: true,
    axes: {
      trust: 15.75,      // 95 + 15.75 = 110.75 (exceeds 100)
      affection: -15.5,  // -95 - 15.5 = -110.5 (below -100)
      tension: 0.125,
    },
  }, WRITERS.ONE_PASS);

  assert.equal(evalRes.applied, true);
  assert.equal(npc.relationship.trust, 110.75);
  assert.equal(npc.relationship.affection, -110.5);
  assert.equal(npc.relationship.tension, 50.125);
});

test('Field Applier (Item F): death projection only bumps revisions when values actually change', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.lifeState = 'alive';
  npc.present = true;
  npc.activeInExchange = true;
  npc.offscreenActivity = 'patrolling the market';

  const initialRevPresent = npc.fieldRevisions.present;
  const initialRevActive = npc.fieldRevisions.activeInExchange;
  const initialRevOffscreen = npc.fieldRevisions.offscreenActivity;

  // First transition to dead: values change from true/truthy to false/null -> revisions bump
  const deathRes = applyFieldProposal(npc, 'lifeState', 'dead', WRITERS.ONE_PASS);
  assert.equal(deathRes.applied, true);
  assert.equal(npc.lifeState, 'dead');
  assert.equal(npc.present, false);
  assert.equal(npc.activeInExchange, false);
  assert.equal(npc.offscreenActivity, null);
  assert.equal(npc.fieldRevisions.present, initialRevPresent + 1);
  assert.equal(npc.fieldRevisions.activeInExchange, initialRevActive + 1);
  assert.equal(npc.fieldRevisions.offscreenActivity, initialRevOffscreen + 1);

  // Now create an NPC that was ALREADY dead/not present/not active/null offscreen
  const deadNpc = createDefaultNpcRecord('npc_2', 'Marcus');
  deadNpc.lifeState = 'alive';
  deadNpc.present = false;
  deadNpc.activeInExchange = false;
  deadNpc.offscreenActivity = null;

  const marcusRevPresent = deadNpc.fieldRevisions.present;
  const marcusRevActive = deadNpc.fieldRevisions.activeInExchange;
  const marcusRevOffscreen = deadNpc.fieldRevisions.offscreenActivity;

  // Marcus becomes dead: present, activeInExchange, offscreenActivity were ALREADY false/null!
  const marcusDeath = applyFieldProposal(deadNpc, 'lifeState', 'dead', WRITERS.ONE_PASS);
  assert.equal(marcusDeath.applied, true);
  assert.equal(deadNpc.lifeState, 'dead');
  // Revisions must NOT have been incremented because values did not change!
  assert.equal(deadNpc.fieldRevisions.present, marcusRevPresent);
  assert.equal(deadNpc.fieldRevisions.activeInExchange, marcusRevActive);
  assert.equal(deadNpc.fieldRevisions.offscreenActivity, marcusRevOffscreen);
});

test('Relationship Mechanics: normalizeRelationshipScore enforces finite-number primitive and createDefaultRelationshipState initializes zero axes', () => {
  // Finite numbers preserved
  assert.equal(normalizeRelationshipScore(42), 42);
  assert.equal(normalizeRelationshipScore(-15.75), -15.75);
  assert.equal(normalizeRelationshipScore(0), 0);
  assert.equal(normalizeRelationshipScore(150.25), 150.25);

  // Non-finite values fallback to 0
  assert.equal(normalizeRelationshipScore(NaN), 0);
  assert.equal(normalizeRelationshipScore(Infinity), 0);
  assert.equal(normalizeRelationshipScore(-Infinity), 0);
  assert.equal(normalizeRelationshipScore(null), 0);
  assert.equal(normalizeRelationshipScore(undefined), 0);
  assert.equal(normalizeRelationshipScore('50'), 0);

  // createDefaultRelationshipState initializes all zero axes
  const defaultState = createDefaultRelationshipState();
  assert.deepEqual(defaultState, {
    trust: 0,
    affection: 0,
    desire: 0,
    tension: 0,
    lastEvaluationExchange: null,
  });
});

test('Field Applier (Item 9): blocks direct proposals for observations, acceptedSupport, reviewReceipts, and development under any writer', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');

  for (const field of ['observations', 'acceptedSupport', 'reviewReceipts', 'development']) {
    const onePassRes = applyFieldProposal(npc, field, [], WRITERS.ONE_PASS);
    assert.equal(onePassRes.applied, false);
    assert.equal(onePassRes.reason, 'bookkeeping_field_reserved');

    const devRes = applyFieldProposal(npc, field, [], WRITERS.DEVELOPMENT);
    assert.equal(devRes.applied, false);
    assert.equal(devRes.reason, 'bookkeeping_field_reserved');
  }
});

test('Field Applier (Item 7): auto-generates stable collection IDs and resolves NPR targetRef via resolvedIdentityMap', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');

  const resolvedIdentityMap = new Map([
    ['new_garrick_ref', { assignedId: 'npc_garrick_99', name: 'Garrick' }],
  ]);

  // 1. appearanceForms without formId generates formId and strips localFormRef
  const afRes = applyFieldProposal(
    npc,
    'appearanceForms',
    {
      operation: 'add',
      forms: [
        { localFormRef: 'wolf_temp', name: 'Dire Wolf', description: 'Large silver wolf' },
      ],
    },
    WRITERS.DEVELOPMENT,
    { resolvedIdentityMap }
  );
  assert.equal(afRes.applied, true);
  assert.equal(npc.appearanceForms.length, 1);
  assert.match(npc.appearanceForms[0].formId, /^form_\d+_\d+$/);
  assert.equal(npc.appearanceForms[0].localFormRef, undefined);

  // 2. importantMemories without memoryId generates memoryId and strips localMemoryRef
  const memRes = applyFieldProposal(
    npc,
    'importantMemories',
    {
      operation: 'add',
      memories: [
        { localMemoryRef: 'mem_temp', text: 'Survived the Great Flood' },
      ],
    },
    WRITERS.DEVELOPMENT,
    { resolvedIdentityMap }
  );
  assert.equal(memRes.applied, true);
  assert.equal(npc.importantMemories.length, 1);
  assert.match(npc.importantMemories[0].memoryId, /^mem_\d+_\d+$/);
  assert.equal(npc.importantMemories[0].localMemoryRef, undefined);

  // 3. nonPlayerRelationships with targetRef resolves to targetId via resolvedIdentityMap and generates relationId
  const nprRes = applyFieldProposal(
    npc,
    'nonPlayerRelationships',
    {
      operation: 'establish',
      relationships: [
        {
          targetRef: 'new_garrick_ref',
          relationKind: 'ally',
          description: 'Trusty smith partner',
        },
      ],
    },
    WRITERS.DEVELOPMENT,
    { resolvedIdentityMap }
  );
  assert.equal(nprRes.applied, true);
  assert.equal(npc.nonPlayerRelationships.length, 1);
  assert.match(npc.nonPlayerRelationships[0].relationId, /^rel_\d+_\d+$/);
  assert.equal(npc.nonPlayerRelationships[0].targetId, 'npc_garrick_99');
  assert.equal(npc.nonPlayerRelationships[0].targetRef, undefined);
});

test('Field Applier (Item 1): normalizes personality wire metadata and strips wire-only facts metadata', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');

  // Personality wire object with traits, value, and wire metadata (source, operation, evidence)
  const personalityProposal = {
    traits: ['curious', 'stoic'],
    value: 'A stoic yet curious researcher',
    source: { sourceRef: 'msg:1', excerpt: 'stoic yet curious' },
    operation: 'replace',
    evidence: 'observed in library',
  };

  const persRes = applyFieldProposal(npc, 'personality', personalityProposal, WRITERS.DEVELOPMENT);
  assert.equal(persRes.applied, true);
  assert.deepEqual(npc.personality, {
    traits: ['curious', 'stoic'],
    value: 'A stoic yet curious researcher',
  });
  // Wire metadata strictly stripped
  assert.equal(npc.personality.source, undefined);
  assert.equal(npc.personality.operation, undefined);
  assert.equal(npc.personality.evidence, undefined);

  // Scalar field with wire metadata: object with { value, source, operation } strips metadata
  const roleRes = applyFieldProposal(npc, 'role', {
    value: 'Chief Archivist',
    source: { sourceRef: 'msg:1', excerpt: 'archivist' },
    operation: 'update',
  }, WRITERS.DEVELOPMENT);
  assert.equal(roleRes.applied, true);
  assert.equal(npc.role, 'Chief Archivist');
});

test('Field Applier (Task 6): nonPlayerRelationships replace preserves existing targetId while updating relation', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.nonPlayerRelationships = [
    {
      relationId: 'rel_1',
      targetId: 'npc_garrick',
      relationKind: 'ally',
      description: 'Blacksmith partner',
    },
  ];

  const res = applyFieldProposal(
    npc,
    'nonPlayerRelationships',
    {
      operation: 'replace',
      relationId: 'rel_1',
      relationKind: 'rival',
      description: 'Rival blacksmith',
    },
    WRITERS.DEVELOPMENT
  );

  assert.equal(res.applied, true);
  assert.equal(npc.nonPlayerRelationships.length, 1);
  assert.equal(npc.nonPlayerRelationships[0].relationId, 'rel_1');
  assert.equal(npc.nonPlayerRelationships[0].targetId, 'npc_garrick');
  assert.equal(npc.nonPlayerRelationships[0].relationKind, 'rival');
  assert.equal(npc.nonPlayerRelationships[0].description, 'Rival blacksmith');
});

test('Field Applier (Task 7): generateCollectionId mechanically retries against existing and allocated IDs', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  npc.appearanceForms = [
    { formId: 'form_1', name: 'Wolf Form', description: 'Dire wolf' },
  ];

  // Add multiple forms with localFormRef in single proposal batch
  const res = applyFieldProposal(
    npc,
    'appearanceForms',
    {
      operation: 'add',
      forms: [
        { localFormRef: 'form_ref_a', name: 'Raven Form', description: 'Large raven' },
        { localFormRef: 'form_ref_b', name: 'Bear Form', description: 'Brown bear' },
      ],
    },
    WRITERS.DEVELOPMENT
  );

  assert.equal(res.applied, true);
  assert.equal(npc.appearanceForms.length, 3);
  const ids = npc.appearanceForms.map((f) => f.formId);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every((id) => typeof id === 'string' && id.startsWith('form_')));
});

test('Field Applier (Task 14): explicit zero relationship evaluation returns applied: false, reason: explicit_zero_shift and does not bump revision', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');
  const initialRev = npc.fieldRevisions.relationshipEvaluation;
  const initialRel = { ...npc.relationship };

  const evalProposal = {
    shifted: false,
    reason: 'Routine interaction without relationship shift',
  };

  const res = applyFieldProposal(npc, 'relationshipEvaluation', evalProposal, WRITERS.ONE_PASS);
  assert.equal(res.applied, false);
  assert.equal(res.reason, 'explicit_zero_shift');
  assert.equal(npc.fieldRevisions.relationshipEvaluation, initialRev);
  assert.deepEqual(npc.relationship, initialRel);
});

test('Field Applier: personality update, remove, and syntax safety preceding locks', () => {
  const npc = createDefaultNpcRecord('npc_1', 'Elena');

  // 1. Update personality with traits and value
  const updateRes = applyFieldProposal(npc, 'personality', {
    traits: ['sharp', 'reserved'],
    value: 'A sharp, reserved archivist',
  }, WRITERS.DEVELOPMENT);
  assert.equal(updateRes.applied, true);
  assert.deepEqual(npc.personality, {
    traits: ['sharp', 'reserved'],
    value: 'A sharp, reserved archivist',
  });

  // 2. Remove personality
  const remRes = applyFieldProposal(npc, 'personality', {
    operation: 'remove',
  }, WRITERS.DEVELOPMENT);
  assert.equal(remRes.applied, true);
  assert.equal(npc.personality, null);

  // 3. Subsequent locks application succeeds cleanly (verifying syntax safety before locks branch)
  const lockRes = applyFieldProposal(npc, 'locks', { background: true }, WRITERS.USER);
  assert.equal(lockRes.applied, true);
  assert.equal(npc.locks.background, true);
});
