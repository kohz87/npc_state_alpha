import { createDefaultNpcRecord, createInitialState } from '../../src/state/schema.js';
import { normalizeAlphaSettings } from '../../src/contract/settings.js';

function makeNpc(id, name, overrides = {}) {
  const npc = createDefaultNpcRecord(id, name);
  Object.assign(npc, overrides);
  return npc;
}

function source(sourceRef, role, text) {
  return { sourceRef, role, text };
}

export function makeImmediateMeasurementCases() {
  const simple = createInitialState();
  simple.npcs.npc_alice = makeNpc('npc_alice', 'Alice', {
    present: true,
    activeInExchange: true,
    mood: 'calm and attentive',
    location: 'archive reading room',
    goal: 'help Lucien identify the ledger seal',
    status: 'sorting a stack of registry ledgers',
    currentPresentation: 'ink-stained sleeves rolled to the elbows',
    relationshipDynamic: 'Professional, increasingly cooperative',
    relationship: { ...createDefaultNpcRecord('tmp', 'tmp').relationship, trust: 3.5, affection: 0.5, tension: -0.5 },
  });

  const multi = createInitialState();
  const multiSpecs = [
    ['npc_alice', 'Alice', true, true, 'watchful', 'north gate'],
    ['npc_mira', 'Mira', true, true, 'amused', 'north gate'],
    ['npc_kaelen', 'Kaelen', true, false, 'guarded', 'rampart'],
    ['npc_soren', 'Soren', false, false, 'busy', 'lower ward'],
    ['npc_ilya', 'Ilya', false, false, 'uncertain', 'clinic'],
  ];
  for (const [id, name, present, active, mood, location] of multiSpecs) {
    multi.npcs[id] = makeNpc(id, name, {
      aliases: name === 'Kaelen' ? ['Captain Kaelen'] : [],
      present,
      activeInExchange: active,
      mood,
      location,
      goal: `continue the ${name.toLowerCase()} task`,
      status: present ? 'engaged in the current scene' : 'occupied elsewhere',
      currentPresentation: `${name} wears practical frontier clothing`,
      relationshipDynamic: `${name} has a distinct but stable working relationship with the player`,
      relationship: { ...createDefaultNpcRecord('tmp', 'tmp').relationship, trust: name.length / 2, tension: -0.25 },
      appearanceForms: name === 'Mira' ? [{ formId: 'human', name: 'Human' }, { formId: 'wolf', name: 'Wolf' }] : [],
      currentForm: name === 'Mira' ? 'human' : null,
    });
  }

  const rich = createInitialState();
  for (let i = 1; i <= 8; i++) {
    const id = `npc_rich_${i}`;
    rich.npcs[id] = makeNpc(id, `Resident ${i}`, {
      aliases: [`R${i}`, `Resident-${i}`],
      present: i <= 3,
      activeInExchange: i <= 2,
      offscreenActivity: i > 3 ? `handling a separate district duty ${i}` : null,
      mood: `measured mood ${i}`,
      location: i <= 3 ? 'council chamber' : `district ${i}`,
      goal: `pursue a standing objective with qualification ${i}`,
      status: `current situational status ${i}`,
      currentPresentation: `layered field attire with distinguishing marker ${i} and scene-specific condition`,
      currentForm: 'human',
      appearanceForms: [
        { formId: 'human', name: 'Human' },
        { formId: `alternate_${i}`, name: `Alternate ${i}` },
        { formId: `formal_${i}`, name: `Formal ${i}` },
      ],
      relationshipDynamic: `Long-form accepted durable relationship context for resident ${i}, including boundaries and role expectations.`,
      relationship: { ...createDefaultNpcRecord('tmp', 'tmp').relationship, trust: i * 2.5, affection: i * 0.5, tension: i * -0.25 },
      importance: i === 8,
    });
  }

  const longExchange = structuredClone(rich);
  longExchange.npcs.npc_rich_8.present = false;
  longExchange.npcs.npc_rich_8.currentPresentation = 'A long scene-specific presentation detail that is useful only when this otherwise off-screen identity becomes relevant to the current user exchange.';

  return [
    { id: 'immediate_simple_existing', state: simple, options: { admissionPolicy: 'named_preferred', routineDossierDetailBudget: 'auto', currentUserText: 'Alice, show me what you found.' } },
    { id: 'immediate_multi_npc', state: multi, options: { admissionPolicy: 'named_preferred', routineDossierDetailBudget: 3, currentUserText: 'Alice asks Mira while Captain Kaelen watches.' } },
    { id: 'immediate_rich_dossier', state: rich, options: { admissionPolicy: 'balanced_unique_role_label', routineDossierDetailBudget: 4, currentUserText: 'Continue the council scene.' } },
    { id: 'immediate_long_exchange', state: longExchange, options: { admissionPolicy: 'named_preferred', routineDossierDetailBudget: 4, currentUserText: 'Resident 8 sends a message into the crowded council discussion while Residents 1 and 2 answer.' } },
  ];
}

function observation(i, field, sourceRef) {
  return {
    id: `obs_${i}`,
    field,
    observation: `Concise retained observation ${i} for ${field}.`,
    disposition: { role: i % 3 === 0 ? 'contradicting' : 'tentative' },
    source: { sourceRef, excerpt: `evidence ${i}` },
  };
}

function support(field, revision, sourceRef, observationId = null) {
  return {
    field,
    fieldRevision: revision,
    ...(observationId ? { supportingObservationIds: [observationId] } : {}),
    sourceRefs: [sourceRef],
  };
}

export function makeDevelopmentMeasurementCases() {
  const settings = normalizeAlphaSettings({ developmentResponseLimit: 1600 });
  const durableMenuCurrent = {
    relationshipDynamic: 'Professional but cautious',
    canonicalAppearance: 'Tall, dark-haired woman with a scar at the jaw.',
    personality: 'Methodical, reserved, dryly humorous.',
    behavioralProfile: 'Plans before acting and verifies records twice.',
    speech: 'Clipped formal sentences with occasional dry understatement.',
    mannerisms: ['Taps one finger against a ledger before answering.'],
    role: 'Archivist',
    species: 'Human',
    background: 'Served in the provincial records office before transfer.',
    actualAge: '31',
    apparentAge: 'early thirties',
    birthday: '18 Frostwane',
    importantMemories: [{ id: 'mem_1', text: 'Promised to protect the sealed census ledger.' }],
    nonPlayerRelationships: [{ id: 'rel_1', targetId: 'npc_mira', relation: 'older sister' }],
  };

  const newSources = [
    source('chat:dev:0', 'user', 'What do you do here?'),
    source('chat:dev:1', 'assistant', 'Elena closes the registry ledger. "I am the senior archivist assigned to the eastern stacks," she says.'),
  ];
  const newTarget = {
    id: 'npc_elena',
    name: 'Elena',
    lifeState: 'unknown',
    current: {},
    relationshipAxesReadOnly: { trust: 0, affection: 0, desire: 0, tension: 0 },
    currentFormReadOnly: null,
    locks: [],
    observations: [],
    acceptedSupport: [],
  };

  const ordinarySources = [];
  for (let i = 0; i < 3; i++) {
    ordinarySources.push(source(`chat:dev:${i * 2}`, 'user', `Exchange ${i + 1}: ask Elena about archival procedure.`));
    ordinarySources.push(source(`chat:dev:${i * 2 + 1}`, 'assistant', `Exchange ${i + 1}: Elena answers precisely, then checks the seal twice before returning the ledger.`));
  }
  const ordinaryTarget = {
    id: 'npc_elena',
    name: 'Elena',
    lifeState: 'unknown',
    current: {
      role: 'Archivist',
      personality: 'Reserved and precise',
      speech: 'Formal and concise',
      relationshipDynamic: 'Professional and cautiously cooperative',
    },
    relationshipAxesReadOnly: { trust: 4.5, affection: 0, desire: 0, tension: -0.5 },
    currentFormReadOnly: null,
    locks: [],
    observations: [observation(1, 'behavioralProfile', 'chat:dev:1'), observation(2, 'mannerisms', 'chat:dev:3')],
    acceptedSupport: [support('role', 2, 'chat:dev:1')],
  };

  const richSources = [
    source('chat:rich:20', 'user', 'You still check every seal twice?'),
    source('chat:rich:21', 'assistant', 'Elena gives a thin smile. "Twice prevents apologies later." She taps one finger on the ledger before opening it.'),
    source('chat:rich:22', 'user', 'And your sister Mira?'),
    source('chat:rich:23', 'assistant', '"Mira is still my older sister, not my supervisor," Elena replies with practiced patience.'),
  ];
  const richObservations = Array.from({ length: 12 }, (_, i) => observation(i + 1, i % 2 === 0 ? 'mannerisms' : 'behavioralProfile', richSources[i % richSources.length].sourceRef));
  const richSupport = Array.from({ length: 8 }, (_, i) => support(i % 2 === 0 ? 'personality' : 'speech', i + 2, richSources[i % richSources.length].sourceRef, richObservations[i].id));
  const richTarget = {
    id: 'npc_elena',
    name: 'Elena',
    lifeState: 'unknown',
    current: structuredClone(durableMenuCurrent),
    relationshipAxesReadOnly: { trust: 17.5, affection: 3.5, desire: 0, tension: -2.25 },
    currentFormReadOnly: 'human',
    locks: ['actualAge'],
    observations: richObservations,
    acceptedSupport: richSupport,
  };

  const sixSources = [];
  for (let i = 0; i < 6; i++) {
    sixSources.push(source(`chat:six:${i * 2}`, 'user', `Batch exchange ${i + 1}: continue the station conversation.`));
    sixSources.push(source(`chat:six:${i * 2 + 1}`, 'assistant', `Batch exchange ${i + 1}: Elena and Mira discuss their duties, family expectations, and the frontier roster with distinct dialogue.`));
  }
  const secondTarget = {
    id: 'npc_mira',
    name: 'Mira',
    lifeState: 'unknown',
    current: { role: 'Quartermaster', personality: 'Practical and sociable', relationshipDynamic: 'Friendly but professionally bounded' },
    relationshipAxesReadOnly: { trust: 8, affection: 2, desire: 0, tension: 0 },
    currentFormReadOnly: null,
    locks: [],
    observations: [observation(20, 'speech', 'chat:six:3')],
    acceptedSupport: [],
  };

  const cases = [
    {
      id: 'development_new_npc_early',
      args: {
        targets: [newTarget],
        targetSourceScope: { npc_elena: newSources.map((item) => item.sourceRef) },
        targetFieldSubset: { npc_elena: null },
        sources: newSources,
        settings,
      },
    },
    {
      id: 'development_ordinary_cadence',
      args: {
        targets: [ordinaryTarget],
        targetSourceScope: { npc_elena: ordinarySources.map((item) => item.sourceRef) },
        targetFieldSubset: { npc_elena: null },
        sources: ordinarySources,
        settings,
      },
    },
    {
      id: 'development_rich_mature',
      args: {
        targets: [richTarget],
        targetSourceScope: { npc_elena: richSources.map((item) => item.sourceRef) },
        targetFieldSubset: { npc_elena: null },
        sources: richSources,
        settings,
      },
    },
    {
      id: 'development_six_exchange_batch',
      args: {
        targets: [ordinaryTarget, secondTarget],
        targetSourceScope: {
          npc_elena: sixSources.map((item) => item.sourceRef),
          npc_mira: sixSources.map((item) => item.sourceRef),
        },
        targetFieldSubset: { npc_elena: null, npc_mira: null },
        sources: sixSources,
        settings,
      },
    },
  ];
  return cases;
}
