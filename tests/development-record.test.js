import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommitCoordinator,
} from '../src/runtime/commit-coordinator.js';
import {
  MemoryStorageAdapter,
} from '../src/state/storage.js';
import {
  WRITERS,
} from '../src/contract/registry.js';
import {
  STRUCTURED_SEGMENT_KINDS,
} from '../src/contract/wire-schemas.js';

test('Development Record (C08): observations and accepted support persist and reload in same Alpha state', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // 1. Initial NPC admission
  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena_ref', name: 'Elena' }],
    fieldProposals: { elena_ref: { mood: 'calm' } },
  });
  const elenaId = initRes.assignedNpcs[0].assignedId;

  // 2. Development commit with observations, accepted-support, and review receipt
  const devRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: elenaId }],
    fieldProposals: {
      [elenaId]: {
        role: 'Senior Archivist',
      },
    },
    observations: [
      {
        targetId: elenaId,
        field: 'speech',
        observation: 'Speaks with formal diction and slight southern cadence.',
        source: {
          sourceRef: 'msg_1',
          excerpt: ' southern cadence',
          segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
        },
        disposition: {
          role: 'tentative',
        },
      },
    ],
    supportProposals: [
      {
        targetId: elenaId,
        field: 'role',
        sourceRefs: ['msg_1'],
        notes: 'Promoted to Senior Archivist per guild decrees',
      },
    ],
    reviewReceipts: [
      {
        targetId: elenaId,
        sourceScope: ['msg_1'],
        status: 'reviewed',
      },
    ],
  });

  assert.equal(devRes.success, true, devRes.error);
  assert.equal(devRes.observationIds.length, 1);
  const obsId = devRes.observationIds[0];
  assert.match(obsId, /^obs_\d+_\d+$/);

  // 3. Reload from storage to prove persistence in same Alpha state
  const loaded = await adapter.load();
  const elena = loaded.state.npcs[elenaId];
  assert.ok(elena);

  // Observations persist in development record, NOT as accepted traits
  assert.equal(elena.development.observations.length, 1);
  const persistedObs = elena.development.observations[0];
  assert.equal(persistedObs.id, obsId);
  assert.equal(persistedObs.field, 'speech');
  assert.equal(persistedObs.observation, 'Speaks with formal diction and slight southern cadence.');

  // Note: speech field itself was NOT mutated by tentative observation!
  assert.equal(elena.speech, null);

  // Accepted support persists and links to committed field revision
  assert.equal(elena.development.acceptedSupport.length, 1);
  const persistedSupp = elena.development.acceptedSupport[0];
  assert.equal(persistedSupp.field, 'role');
  assert.equal(persistedSupp.fieldRevision, '2');
  assert.deepEqual(persistedSupp.sourceRefs, ['msg_1']);

  // Review receipt persists as runtime-owned record
  assert.equal(elena.development.reviewReceipts.length, 1);
  assert.equal(elena.development.reviewReceipts[0].status, 'reviewed');
});

test('Development Record (C08): request-local observation refs resolve to persistent IDs before save', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initial NPC
  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'kael_ref', name: 'Kael' }],
  });
  const kaelId = initRes.assignedNpcs[0].assignedId;

  // Development commit with local observation ref linked in another observation disposition
  const devRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: kaelId }],
    observations: [
      {
        localObservationRef: 'obs_local_prior',
        targetId: kaelId,
        field: 'personality',
        observation: 'Shows deep reluctance when discussing noble houses.',
        source: {
          sourceRef: 'msg_2',
          excerpt: 'reluctance',
          segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
        },
        disposition: { role: 'tentative' },
      },
      {
        targetId: kaelId,
        field: 'personality',
        observation: 'Openly denounced the Duke at tavern.',
        source: {
          sourceRef: 'msg_3',
          excerpt: 'denounced the Duke',
          segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
        },
        disposition: {
          role: 'supporting',
          // Request-local ref to the first observation
          linkedObservationRefs: ['obs_local_prior'],
        },
      },
    ],
  });

  assert.equal(devRes.success, true, devRes.error);
  assert.equal(devRes.observationIds.length, 2);

  const [priorId, secondId] = devRes.observationIds;

  // Reload and verify that local ref was resolved to persistent runtime ID
  const loaded = await adapter.load();
  const kael = loaded.state.npcs[kaelId];
  const secondObs = kael.development.observations.find((o) => o.id === secondId);
  assert.ok(secondObs);
  assert.equal(secondObs.disposition.linkedObservationRefs, undefined);
  assert.deepEqual(secondObs.disposition.linkedObservationIds, [priorId]);
});

test('Development Record (C08): unresolvable local observation ref is rejected before persistence', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_ref', name: 'TestNPC' }],
  });
  const npcId = initRes.assignedNpcs[0].assignedId;

  const devRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: npcId }],
    observations: [
      {
        targetId: npcId,
        field: 'personality',
        observation: 'Observation with missing link.',
        source: {
          sourceRef: 'msg_1',
          excerpt: 'excerpt',
          segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
        },
        disposition: {
          role: 'supporting',
          linkedObservationRefs: ['unresolvable_local_ref_xyz'], // Missing!
        },
      },
    ],
  });

  assert.equal(devRes.success, false);
  assert.match(devRes.error, /Unresolvable local observation ref/);
});

test('Development Record (C08): tentative observation does not mutate durable trait', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'lyra_ref', name: 'Lyra' }],
  });
  const lyraId = initRes.assignedNpcs[0].assignedId;

  await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: lyraId }],
    observations: [
      {
        targetId: lyraId,
        field: 'mannerisms',
        observation: 'Taps her fingers rhythmically when anxious.',
        source: {
          sourceRef: 'msg_1',
          excerpt: 'taps fingers',
          segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
        },
        disposition: { role: 'tentative' },
      },
    ],
  });

  const loaded = await adapter.load();
  const lyra = loaded.state.npcs[lyraId];

  // Observation recorded in development
  assert.equal(lyra.development.observations.length, 1);
  // Mannerisms array remains empty (tentative observation did not mutate durable trait!)
  assert.deepEqual(lyra.mannerisms, []);
});
