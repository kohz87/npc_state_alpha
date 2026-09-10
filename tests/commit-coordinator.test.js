import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommitCoordinator,
  generateObservationId,
  resetObservationIdCounterForTesting,
  extractConcreteSourceReferences,
} from '../src/runtime/commit-coordinator.js';
import {
  MemoryStorageAdapter,
} from '../src/state/storage.js';
import {
  createInitialState,
  createDefaultNpcRecord,
} from '../src/state/schema.js';
import {
  WRITERS,
} from '../src/contract/registry.js';
import {
  STRUCTURED_SEGMENT_KINDS,
} from '../src/contract/wire-schemas.js';
import {
  validateOnePassEnvelope,
  validateDevelopmentEnvelope,
} from '../src/contract/validator.js';
import {
  captureSourceDependency,
} from '../src/runtime/source-resolver.js';

test('Commit Coordinator: coupled atomic success persists state, checkpoint, and returns receipt', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const commitRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    expectedRevision: 0,
    identityProposals: [
      { localRef: 'new_npc_1', name: 'Garrick', identityKind: 'named' },
    ],
    fieldProposals: {
      new_npc_1: {
        mood: 'curious',
        location: 'town square',
      },
    },
    sourceDependencies: ['chat_001:msg_0'],
    operationMode: 'one_pass',
  });

  assert.equal(commitRes.success, true, commitRes.error);
  assert.equal(commitRes.commitRevision, 1);
  assert.ok(commitRes.checkpointId);
  assert.equal(commitRes.assignedNpcs.length, 1);

  const assignedId = commitRes.assignedNpcs[0].assignedId;

  // Verify state in storage
  const loaded = await adapter.load();
  assert.equal(loaded.revision, 1);
  const npc = loaded.state.npcs[assignedId];
  assert.ok(npc);
  assert.equal(npc.name, 'Garrick');
  assert.equal(npc.mood, 'curious');
  assert.equal(npc.location, 'town square');

  // Verify checkpoint
  assert.equal(loaded.state.history.checkpoints.length, 1);
  const chk = loaded.state.history.checkpoints[0];
  assert.equal(chk.id, commitRes.checkpointId);
  assert.deepEqual(chk.sourceDependencies, ['chat_001:msg_0']);
});

test('Commit Coordinator: failed identity dependency leaves zero orphan mutations', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // One valid, one invalid target
  const commitRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [
      { id: 'non_existent_npc' }, // Invalid!
      { localRef: 'valid_new', name: 'Valid Newbie' },
    ],
    fieldProposals: {
      valid_new: { mood: 'cheerful' },
    },
  });

  assert.equal(commitRes.success, false);
  assert.match(commitRes.error, /Target NPC ID 'non_existent_npc' not found/);

  // Storage remains pristine at revision 0
  const loaded = await adapter.load();
  assert.equal(loaded.revision, 0);
  assert.deepEqual(loaded.state.npcs, {});
  assert.equal(loaded.state.history.checkpoints.length, 0);
});

test('Commit Coordinator: unrelated newer live field survives late durable commit', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initial commit: add NPC Garrick
  await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'garrick_ref', name: 'Garrick' }],
    fieldProposals: {
      garrick_ref: { mood: 'neutral', location: 'library' },
    },
  });

  const { state: state1 } = await adapter.load();
  const garrickId = Object.keys(state1.npcs)[0];

  // Capture read dependencies for a slow durable development review
  // It only read canonicalAppearance and role (revision 1)
  const readDependencies = {
    [garrickId]: {
      canonicalAppearance: state1.npcs[garrickId].fieldRevisions.canonicalAppearance,
      role: state1.npcs[garrickId].fieldRevisions.role,
    },
  };

  // Meanwhile, a fast one-pass turn updates Garrick's mood to 'alarmed'
  await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: garrickId }],
    fieldProposals: {
      [garrickId]: { mood: 'alarmed' },
    },
  });

  // Verify immediate state has mood: 'alarmed'
  const { state: state2 } = await adapter.load();
  assert.equal(state2.npcs[garrickId].mood, 'alarmed');

  // Now, the slow development review finishes proposing role and canonicalAppearance
  const devCommit = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: garrickId }],
    readFieldRevisions: readDependencies,
    fieldProposals: {
      [garrickId]: {
        role: 'Master Blacksmith',
        canonicalAppearance: 'Broad-shouldered with scarred forearms',
      },
    },
  });

  assert.equal(devCommit.success, true);

  // Verify final state in storage:
  // - newer live field (mood: 'alarmed') survived!
  // - durable fields (role, canonicalAppearance) were applied!
  const { state: finalState } = await adapter.load();
  const finalGarrick = finalState.npcs[garrickId];
  assert.equal(finalGarrick.mood, 'alarmed'); // Unrelated newer live change survived!
  assert.equal(finalGarrick.role, 'Master Blacksmith');
  assert.equal(finalGarrick.canonicalAppearance, 'Broad-shouldered with scarred forearms');
});

test('Commit Coordinator: relevant dependency change rejects or defers stale proposal', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena_ref', name: 'Elena' }],
  });
  const elenaId = initRes.assignedNpcs[0].assignedId;

  await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: elenaId }],
    fieldProposals: {
      [elenaId]: { role: 'Apprentice' },
    },
  });

  const { state: s1 } = await adapter.load();

  // Capture read revision of role (rev 1)
  const readDependencies = {
    [elenaId]: {
      role: s1.npcs[elenaId].fieldRevisions.role,
    },
  };

  // An intermediate commit changes Elena's role to 'Journeyman' (increments role rev to 2)
  await coordinator.commit({
    writer: WRITERS.USER,
    identityProposals: [{ id: elenaId }],
    fieldProposals: {
      [elenaId]: { role: 'Journeyman' },
    },
  });

  // Late development commit attempts to propose role with stale read dependency
  const lateCommit = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: elenaId }],
    readFieldRevisions: readDependencies,
    fieldProposals: {
      [elenaId]: { role: 'Senior Scholar' },
    },
  });

  assert.equal(lateCommit.success, true);
  // The stale proposal was deferred due to relevant dependency change!
  assert.equal(lateCommit.deferred.length, 1);
  assert.equal(lateCommit.deferred[0].field, 'role');
  assert.equal(lateCommit.deferred[0].reason, 'read_dependency_changed');

  // Stored role remains 'Journeyman'
  const { state: sFinal } = await adapter.load();
  assert.equal(sFinal.npcs[elenaId].role, 'Journeyman');
});

test('Commit Coordinator: CAS persistence failure leaves state, receipts, and checkpoint unchanged', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  adapter.setFailNextSave(true);

  const res = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'fail_ref', name: 'FailNPC' }],
    fieldProposals: { fail_ref: { mood: 'sad' } },
  });

  assert.equal(res.success, false);
  assert.match(res.error, /persistence failure/i);

  // Storage has no state changes or checkpoints
  const loaded = await adapter.load();
  assert.equal(loaded.revision, 0);
  assert.deepEqual(loaded.state.npcs, {});
  assert.equal(loaded.state.history.checkpoints.length, 0);
});

test('Commit Coordinator: lock and tombstone races rechecked before commit', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initial NPC
  await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_race', name: 'RaceNPC' }],
  });

  const { state: s } = await adapter.load();
  const raceId = Object.keys(s.npcs)[0];

  // Manually tombstone the NPC
  s.tombstones[raceId] = { deletedAt: 'now', reason: 'deleted' };
  delete s.npcs[raceId];
  await adapter.save(s);

  // Late commit attempting to modify now-tombstoned NPC fails
  const lateCommit = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: raceId }],
    fieldProposals: { [raceId]: { mood: 'excited' } },
  });

  assert.equal(lateCommit.success, false);
  assert.match(lateCommit.error, /tombstoned/);
});

test('Commit Coordinator: checkpoint revision strictly matches committed boundary revision', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const res = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_1', name: 'Althea' }],
    fieldProposals: { npc_1: { mood: 'pensive' } },
  });

  assert.equal(res.success, true);
  assert.equal(res.commitRevision, 1);

  const { state, revision } = await adapter.load();
  assert.equal(revision, 1);
  assert.equal(state.revision, 1);
  assert.equal(state.history.checkpoints.length, 1);
  assert.equal(state.history.checkpoints[0].commitRevision, 1);
  assert.equal(state.history.checkpoints[0].commitRevision, res.commitRevision);
});

test('Commit Coordinator: source lineage mismatch rejects with source_lineage_conflict', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_1', name: 'Dragon' }],
  });
  const dragonId = initRes.assignedNpcs[0].assignedId;

  const exchangeContext = {
    chatId: 'chat_session_42',
    sources: new Map([
      ['msg_1', {
        chatId: 'chat_session_wrong', // Wrong chat ID!
        position: 0,
        role: 'assistant',
        contentFingerprint: 'fp_msg_1',
        precedingLineage: [],
        text: 'The dragon roared loudly in anger.',
      }],
    ]),
  };

  const res = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: dragonId }],
    fieldProposals: { [dragonId]: { role: 'Fire Dragon' } },
    sourceDependencies: [
      { sourceRef: 'msg_1', excerpt: 'dragon roared' },
    ],
    exchangeContext,
  });

  assert.equal(res.success, false);
  assert.equal(res.conflict, true);
  assert.equal(res.conflictType, 'source_lineage_conflict');
  assert.match(res.error, /Wrong chat/);
});

test('Commit Coordinator: noncanonical read-field dependency fails closed', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_1', name: 'Kaelen' }],
    fieldProposals: { npc_1: { mood: 'serene' } },
  });
  const kaelenId = initRes.assignedNpcs[0].assignedId;

  const res = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: kaelenId }],
    readFieldRevisions: {
      [kaelenId]: {
        nonExistentField: 1,
      },
    },
    fieldProposals: {
      [kaelenId]: { personality: { value: 'Wise elder' } },
    },
  });

  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'invalid_read_field_revision');
  assert.match(res.error, /not a canonical C02 field/);

  const { state } = await adapter.load();
  assert.equal(state.npcs[kaelenId].personality, null);
});

test('Commit Coordinator: deferred targets do not receive status reviewed receipt', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_1', name: 'Valen' }],
    fieldProposals: { npc_1: { mood: 'idle' } },
  });

  const { state: s1 } = await adapter.load();
  const valenId = Object.keys(s1.npcs)[0];

  // Intermediate update to mood (increments mood rev)
  await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: valenId }],
    fieldProposals: { [valenId]: { mood: 'active' } },
  });

  // Stale review dispatch attempting to commit with stale read dependency
  const res = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: valenId }],
    readFieldRevisions: {
      [valenId]: { mood: 1 }, // Stale! Mood rev is now 2
    },
    fieldProposals: {
      [valenId]: { role: 'Captain' },
    },
    reviewReceipts: [
      { targetId: valenId, status: 'reviewed', summary: 'Reviewed captaincy', sourceScope: ['msg:1'] },
    ],
  });

  assert.equal(res.success, true);
  assert.equal(res.deferred.length, 1);

  const { state: sFinal } = await adapter.load();
  const receipts = sFinal.npcs[valenId].development.reviewReceipts;
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].status, 'deferred'); // NOT reviewed!
});

test('Commit Coordinator: unresolvable local observation ref in supportProposals fails commit', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_1', name: 'Valen' }],
  });

  const { state } = await adapter.load();
  const valenId = Object.keys(state.npcs)[0];

  // Attempting to commit supportProposals referencing non-existent local observation ref
  const res = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: valenId }],
    supportProposals: [
      {
        targetId: valenId,
        field: 'role',
        supportingObservationRefs: ['unresolvable_obs_ref_123'],
      },
    ],
  });

  assert.equal(res.success, false);
  assert.match(res.error, /Unresolvable supporting observation ref 'unresolvable_obs_ref_123'/);
});

test('Commit Coordinator: S1-S2 convergence integration (One-Pass and Development)', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // 1. One-Pass: Validate raw S1 envelope through S1 validator
  const rawOnePassEnvelope = {
    version: '1',
    proposals: [
      {
        id: null,
        localRef: 'elena_ref',
        name: 'Elena',
        identityKind: 'named',
        evidence: {
          sourceRef: 'current:assistant',
          excerpt: 'Elena smiled warmly at the traveller.',
        },
        present: true,
        presenceSource: {
          sourceRef: 'current:assistant',
          excerpt: 'Elena smiled warmly at the traveller.',
        },
        activeInExchange: true,
        relationshipEvaluation: {
          shifted: true,
          axes: { trust: 1.5 },
          impact: 'Elena feels a spark of trust toward the player.',
          axisSupport: {
            trust: {
              reason: 'Shared a warm greeting',
              source: {
                sourceRef: 'current:assistant',
                excerpt: 'Elena smiled warmly at the traveller.',
              },
            },
          },
        },
      },
    ],
  };

  const onePassVal = validateOnePassEnvelope(rawOnePassEnvelope);
  assert.equal(onePassVal.valid, true, JSON.stringify(onePassVal.errors));

  const exchangeContext1 = {
    chatId: 'chat_conv_01',
    currentAssistantMessage: {
      chatId: 'chat_conv_01',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:asst1',
      precedingLineage: ['sha256:user0'],
      text: 'Elena smiled warmly at the traveller. Welcome to our sanctuary.',
    },
  };

  // Pass validated envelope directly to commitValidatedEnvelope
  const commit1 = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.ONE_PASS,
    envelope: rawOnePassEnvelope,
    exchangeContext: exchangeContext1,
  });

  assert.equal(commit1.success, true, commit1.error);
  assert.equal(commit1.commitRevision, 1);
  assert.equal(commit1.assignedNpcs.length, 1);
  const elenaId = commit1.assignedNpcs[0].assignedId;

  // Verify stored state after One-Pass commit
  const { state: s1 } = await adapter.load();
  const elena1 = s1.npcs[elenaId];
  assert.equal(elena1.name, 'Elena');
  assert.equal(elena1.present, true);
  assert.equal(elena1.activeInExchange, true);
  assert.equal(elena1.relationship.trust, 1.5);

  // 2. Development: Validate raw S1 envelope through S1 validator
  const rawDevEnvelope = {
    version: '1',
    reviewReceipts: [
      {
        targetId: elenaId,
        sourceScope: ['msg:1'],
        status: 'reviewed',
      },
    ],
    proposals: [
      {
        targetId: elenaId,
        canonicalAppearance: {
          value: 'Tall silver-haired sorceress in cerulean robes',
          source: {
            sourceRef: 'msg:1',
            excerpt: 'silver-haired sorceress in cerulean robes',
          },
        },
        appearanceForms: {
          operation: 'add',
          forms: [
            {
              formId: 'form_wolf',
              name: 'White Wolf',
              description: 'Lithe dire wolf with pure white fur',
              source: {
                sourceRef: 'msg:1',
                excerpt: 'transformed into a white wolf',
              },
            },
          ],
        },
      },
    ],
    observations: [
      {
        targetId: elenaId,
        field: 'canonicalAppearance',
        localObservationRef: 'obs_app_01',
        observation: 'Noticed Elena wearing cerulean robes',
        source: {
          sourceRef: 'msg:1',
          excerpt: 'silver-haired sorceress in cerulean robes',
        },
        disposition: {
          role: 'supporting',
          linkedFieldRevision: '1',
        },
      },
    ],
    supportProposals: [
      {
        targetId: elenaId,
        field: 'canonicalAppearance',
        supportingObservationRefs: ['obs_app_01'],
        sourceRefs: ['msg:1'],
      },
    ],
  };

  const devVal = validateDevelopmentEnvelope(rawDevEnvelope);
  assert.equal(devVal.valid, true, JSON.stringify(devVal.errors));

  const exchangeContext2 = {
    chatId: 'chat_conv_01',
    sources: new Map([
      ['msg:1', {
        chatId: 'chat_conv_01',
        position: 1,
        role: 'assistant',
        contentFingerprint: 'sha256:asst1',
        precedingLineage: ['sha256:user0'],
        text: 'The silver-haired sorceress in cerulean robes transformed into a white wolf before our eyes.',
      }],
    ]),
  };

  // Pass validated envelope directly to commitValidatedEnvelope
  const commit2 = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: rawDevEnvelope,
    exchangeContext: exchangeContext2,
  });

  assert.equal(commit2.success, true, commit2.error);
  assert.equal(commit2.commitRevision, 2);
  assert.equal(commit2.observationIds.length, 1);
  const persistentObsId = commit2.observationIds[0];

  // Verify stored state after Development commit
  const { state: s2 } = await adapter.load();
  const elena2 = s2.npcs[elenaId];
  assert.equal(elena2.canonicalAppearance, 'Tall silver-haired sorceress in cerulean robes');
  assert.equal(elena2.appearanceForms.length, 1);
  assert.equal(elena2.appearanceForms[0].formId, 'form_wolf');

  // Verify C08 Development records in NPC:
  // - local observation ref was converted to persistent ID
  // - transient keys (localObservationRef) were stripped
  assert.equal(elena2.development.observations.length, 1);
  assert.equal(elena2.development.observations[0].id, persistentObsId);
  assert.equal(elena2.development.observations[0].localObservationRef, undefined);

  // - accepted support linked the persistent observation ID
  assert.equal(elena2.development.acceptedSupport.length, 1);
  assert.deepEqual(elena2.development.acceptedSupport[0].supportingObservationIds, [persistentObsId]);
  assert.equal(elena2.development.acceptedSupport[0].supportingObservationRefs, undefined);

  // Checkpoints verify coherent boundaries
  assert.equal(s2.history.checkpoints.length, 2);
  assert.equal(s2.history.checkpoints[0].commitRevision, 1);
  assert.equal(s2.history.checkpoints[1].commitRevision, 2);
});

test('Commit Coordinator (C02, C08): rejects direct acceptedSupport from Development writer and permits WRITERS.RUNTIME', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const init = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_1', name: 'Althea' }],
  });
  const altheaId = init.assignedNpcs[0].assignedId;

  // Development writer attempting direct acceptedSupport must be rejected (Item C)
  const devDirectRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: altheaId }],
    acceptedSupport: [
      {
        targetId: altheaId,
        field: 'role',
        fieldRevision: '1',
      },
    ],
  });

  assert.equal(devDirectRes.success, false);
  assert.match(devDirectRes.error, /Direct 'acceptedSupport' submission is reserved strictly for WRITERS.RUNTIME/);

  // Establish the canonical value first; this test is about Runtime ownership of
  // the accepted-support record, not permission to support an unknown field.
  const establishRole = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: altheaId }],
    fieldProposals: { [altheaId]: { role: 'Archivist' } },
  });
  assert.equal(establishRole.success, true, establishRole.error);
  const { state: roleState } = await adapter.load();
  const roleRevision = String(roleState.npcs[altheaId].fieldRevisions.role);

  // WRITERS.RUNTIME submitting acceptedSupport succeeds
  const runtimeRes = await coordinator.commit({
    writer: WRITERS.RUNTIME,
    identityProposals: [{ id: altheaId }],
    acceptedSupport: [
      {
        targetId: altheaId,
        field: 'role',
        fieldRevision: roleRevision,
        sourceRefs: ['msg_1'],
        notes: 'Runtime verified role support',
      },
    ],
  });

  assert.equal(runtimeRes.success, true, runtimeRes.error);
  const { state } = await adapter.load();
  assert.equal(state.npcs[altheaId].development.acceptedSupport.length, 1);
  assert.equal(state.npcs[altheaId].development.acceptedSupport[0].notes, 'Runtime verified role support');
});

test('Commit Coordinator (C10 Concurrency): stale expectedRevision triggers CAS conflict', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_1', name: 'Boran' }],
  });

  // Current revision is 1, caller specifies expectedRevision: 0
  const staleRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    expectedRevision: 0,
    identityProposals: [{ localRef: 'npc_2', name: 'Cedric' }],
  });

  assert.equal(staleRes.success, false);
  assert.equal(staleRes.conflict, true);
  assert.equal(staleRes.conflictType, 'storage_cas_conflict');
  assert.match(staleRes.error, /CAS revision conflict/);

  // Verify storage was not modified
  const { revision, state } = await adapter.load();
  assert.equal(revision, 1);
  assert.equal(Object.keys(state.npcs).length, 1);
});

test('Commit Coordinator (C10 Concurrency): parallel racing commits on same revision yield exactly one winner and one CAS conflict', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Baseline commit: revision goes to 1
  const baseRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'base_npc', name: 'Base NPC' }],
  });
  assert.equal(baseRes.commitRevision, 1);
  const baseNpcId = baseRes.assignedNpcs[0].assignedId;

  // Two racing commits both reading revision 1 simultaneously
  const racePromise1 = coordinator.commit({
    writer: WRITERS.ONE_PASS,
    expectedRevision: 1,
    identityProposals: [{ id: baseNpcId }],
    fieldProposals: {
      [baseNpcId]: { mood: 'pensive' },
    },
  });

  const racePromise2 = coordinator.commit({
    writer: WRITERS.ONE_PASS,
    expectedRevision: 1,
    identityProposals: [{ id: baseNpcId }],
    fieldProposals: {
      [baseNpcId]: { location: 'library' },
    },
  });

  const [res1, res2] = await Promise.all([racePromise1, racePromise2]);

  // Exactly one must succeed and one must fail with conflict
  const winner = res1.success ? res1 : (res2.success ? res2 : null);
  const loser = !res1.success ? res1 : (!res2.success ? res2 : null);

  assert.ok(winner, 'One racing commit must succeed');
  assert.ok(loser, 'One racing commit must fail');
  assert.equal(winner.success, true);
  assert.equal(winner.commitRevision, 2);
  assert.equal(loser.success, false);
  assert.equal(loser.conflict, true);

  // Storage should be cleanly at revision 2 with only winner's mutation
  const { revision, state } = await adapter.load();
  assert.equal(revision, 2);
  assert.equal(state.history.checkpoints.length, 2);
  assert.equal(state.history.checkpoints[1].commitRevision, 2);
});

// ============================================================================
// Item 11: C10 Race Tests (5 Distinct Race Scenarios Without Provider Calls)
// ============================================================================

test('Commit Coordinator (Item 11 Race 1): lock change between dispatch and commit blocks locked field', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initial commit: add Garrick at revision 1
  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'garrick', name: 'Garrick' }],
    fieldProposals: { garrick: { location: 'guardhouse', mood: 'vigilant' } },
  });
  const garrickId = initRes.assignedNpcs[0].assignedId;

  // Between dispatch and commit: User locks location at revision 2
  const { state: s1 } = await adapter.load();
  s1.npcs[garrickId].locks.location = true;
  await adapter.save(s1, 1);

  // In-flight One-Pass commit arrives, attempting to change location to 'tavern' and mood to 'relaxed'
  const raceRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: garrickId }],
    fieldProposals: {
      [garrickId]: {
        location: 'tavern',
        mood: 'relaxed',
      },
    },
  });

  assert.equal(raceRes.success, true);
  const { state: sFinal } = await adapter.load();
  // Location was locked, so it was blocked and remains 'guardhouse'
  assert.equal(sFinal.npcs[garrickId].location, 'guardhouse');
  // Unlocked field 'mood' was applied
  assert.equal(sFinal.npcs[garrickId].mood, 'relaxed');
});

test('Commit Coordinator (Item 11 Race 2): lifecycle change between dispatch and commit enforces terminal death', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
    fieldProposals: { elena: { mood: 'cheerful' } },
  });
  const elenaId = initRes.assignedNpcs[0].assignedId;

  // Turn A marks Elena dead at revision 2
  await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: elenaId }],
    fieldProposals: { [elenaId]: { lifeState: 'dead' } },
  });

  const { state: sDead } = await adapter.load();
  assert.equal(sDead.npcs[elenaId].lifeState, 'dead');

  // Racing turn attempts to transition dead Elena back to alive
  const reviveRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: elenaId }],
    fieldProposals: { [elenaId]: { lifeState: 'alive' } },
  });

  assert.equal(reviveRes.success, false);
  assert.match(reviveRes.error, /Automatic dead->alive lifecycle transition is forbidden/);

  // Storage retains death
  const { state: sFinal } = await adapter.load();
  assert.equal(sFinal.npcs[elenaId].lifeState, 'dead');
});

test('Commit Coordinator (Item 11 Race 3): tombstone change between dispatch and commit fails closed', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'marcus', name: 'Marcus' }],
  });
  const marcusId = initRes.assignedNpcs[0].assignedId;

  // Between dispatch and commit, Marcus is manually tombstoned
  const { state: s1 } = await adapter.load();
  s1.tombstones[marcusId] = { deletedAt: '2026-09-10T00:00:00Z', reason: 'User deleted' };
  delete s1.npcs[marcusId];
  await adapter.save(s1, 1);

  // In-flight commit targeting Marcus fails closed
  const raceRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: marcusId }],
    fieldProposals: { [marcusId]: { mood: 'gloomy' } },
  });

  assert.equal(raceRes.success, false);
  assert.match(raceRes.error, /has been tombstoned/);
});

test('Commit Coordinator (Item 11 Race 4): source ownership change between dispatch and commit causes source_lineage_conflict', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const exchangeContext = {
    chatId: 'chat_race_01',
    currentAssistantMessage: {
      chatId: 'chat_race_01',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:orig_asst',
      precedingLineage: ['sha256:user0'],
      swipe: 'swipe_0',
      revision: 'rev_1',
      text: 'Elena smiled warmly.',
    },
  };

  // Dispatch captures source dependency
  const captureRes = captureSourceDependency(
    { sourceRef: 'current:assistant', excerpt: 'Elena smiled' },
    exchangeContext,
    { writer: WRITERS.ONE_PASS, targetField: 'mood' }
  );
  assert.equal(captureRes.valid, true);

  // Between dispatch and commit: user re-swipes or regenerates assistant message
  exchangeContext.currentAssistantMessage.swipe = 'swipe_1';
  exchangeContext.currentAssistantMessage.contentFingerprint = 'sha256:swiped_asst';
  exchangeContext.currentAssistantMessage.text = 'Elena frowned sternly.';

  // Commit runs with captured dependency and mutated exchangeContext
  const commitRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
    fieldProposals: { elena: { mood: 'cheerful' } },
    sourceDependencies: [captureRes.capturedDependency],
    exchangeContext,
  });

  assert.equal(commitRes.success, false);
  assert.equal(commitRes.conflict, true);
  assert.equal(commitRes.conflictType, 'source_lineage_conflict');
  assert.match(commitRes.error, /Source contentFingerprint changed/);
});

test('Commit Coordinator (Item 11 Race 5): relevant field dependency change defers proposal without provider calls', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initial state: One-Pass admits Boran, then Development establishes role.
  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'boran', name: 'Boran' }],
  });
  const boranId = initRes.assignedNpcs[0].assignedId;

  await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: boranId }],
    fieldProposals: { [boranId]: { role: 'Guard' } },
  });

  // Capture read dependencies for slow review
  const readDependencies = {
    [boranId]: { role: 1 },
  };

  // Intermediate commit updates Boran's role to 'Sergeant' (rev 2)
  await coordinator.commit({
    writer: WRITERS.USER,
    identityProposals: [{ id: boranId }],
    fieldProposals: { [boranId]: { role: 'Sergeant' } },
  });

  // Slow development review attempts to propose role 'Captain' with stale read revision 1
  const slowCommitRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: boranId }],
    readFieldRevisions: readDependencies,
    fieldProposals: { [boranId]: { role: 'Captain' } },
  });

  assert.equal(slowCommitRes.success, true);
  assert.equal(slowCommitRes.deferred.length, 1);
  assert.equal(slowCommitRes.deferred[0].field, 'role');
  assert.equal(slowCommitRes.deferred[0].reason, 'read_dependency_changed');

  // Stored role remains 'Sergeant'
  const { state: sFinal } = await adapter.load();
  assert.equal(sFinal.npcs[boranId].role, 'Sergeant');
});

// ============================================================================
// Item 3: C10 expectedRevision Merge Semantics
// ============================================================================

test('Commit Coordinator (Item 3): stale expectedRevision merges when readFieldRevisions match all proposed fields', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Revision 1: create Elena
  const r1 = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
    fieldProposals: { elena: { mood: 'calm', location: 'library' } },
  });
  const elenaId = r1.assignedNpcs[0].assignedId;

  // Revision 2: unrelated update bumps storage revision to 2
  await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'boran', name: 'Boran' }],
    fieldProposals: { boran: { mood: 'eager' } },
  });

  const { revision: revAfterBoran, state: s2 } = await adapter.load();
  assert.equal(revAfterBoran, 2);

  // Commit with stale expectedRevision: 1, but providing explicit matching readFieldRevisions for all proposed fields
  const mergeRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    expectedRevision: 1, // Stale! Current storage is 2
    identityProposals: [{ id: elenaId }],
    readFieldRevisions: {
      [elenaId]: {
        role: s2.npcs[elenaId].fieldRevisions.role, // role rev 1
      },
    },
    fieldProposals: {
      [elenaId]: { role: 'Chief Archivist' },
    },
  });

  assert.equal(mergeRes.success, true, mergeRes.error);
  assert.equal(mergeRes.commitRevision, 3);

  const { state: sFinal, revision: finalRev } = await adapter.load();
  assert.equal(finalRev, 3);
  assert.equal(sFinal.npcs[elenaId].role, 'Chief Archivist');
  assert.equal(sFinal.npcs[elenaId].mood, 'calm'); // Preserved!
});

test('Commit Coordinator (Item 3): stale expectedRevision without complete readFieldRevisions fails closed with storage_cas_conflict', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const r1 = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
    fieldProposals: { elena: { mood: 'calm' } },
  });
  const elenaId = r1.assignedNpcs[0].assignedId;

  // Unrelated commit bumps storage to rev 2
  await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'other', name: 'Other' }],
  });

  const { state: s2 } = await adapter.load();
  const matchingMoodRevision = s2.npcs[elenaId].fieldRevisions.mood;
  assert.equal(matchingMoodRevision, 2);

  // Stale expectedRevision: 1 proposing mood and location. Mood has a genuinely
  // matching read token, while location is deliberately uncovered.
  const failRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    expectedRevision: 1,
    identityProposals: [{ id: elenaId }],
    readFieldRevisions: {
      [elenaId]: { mood: matchingMoodRevision },
    },
    fieldProposals: {
      [elenaId]: { mood: 'excited', location: 'docks' },
    },
  });

  assert.equal(failRes.success, false);
  assert.equal(failRes.conflict, true);
  assert.equal(failRes.conflictType, 'storage_cas_conflict');
  assert.match(failRes.error, /CAS revision conflict/);
});

// ============================================================================
// Items 1, 2, 5: Bridge Semantics & Authoritative Validators
// ============================================================================

test('Commit Coordinator (Item 1): bridge preserves name and aliases updates for existing NPCs', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initial NPC
  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena_init', name: 'Elena' }],
  });
  const elenaId = initRes.assignedNpcs[0].assignedId;

  // S1 wire proposal targeting existing NPC with id, but also specifying name, aliases, and valid source
  const envelope = {
    version: '1',
    proposals: [
      {
        id: elenaId,
        name: 'Elena the Wise',
        aliases: ['Grand Scholar Elena'],
        mood: 'thoughtful',
        source: {
          sourceRef: 'current:assistant',
          excerpt: 'Elena the Wise',
        },
      },
    ],
  };

  const exchangeContext = {
    chatId: 'chat_name_01',
    currentAssistantMessage: {
      chatId: 'chat_name_01',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:asst_name',
      precedingLineage: ['sha256:user0'],
      text: 'Elena the Wise smiled thoughtfully at the council.',
    },
  };

  const bridgeRes = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.ONE_PASS,
    envelope,
    exchangeContext,
  });

  assert.equal(bridgeRes.success, true, bridgeRes.error);
  const { state } = await adapter.load();
  assert.equal(state.npcs[elenaId].name, 'Elena the Wise');
  assert.deepEqual(state.npcs[elenaId].aliases, ['Grand Scholar Elena']);
  assert.equal(state.npcs[elenaId].mood, 'thoughtful');
});

test('Commit Coordinator (Item 1): bridge translates synthetic lifecycle to canonical lifeState and flattens facts', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Create NPC
  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'kaelen', name: 'Kaelen' }],
    fieldProposals: { kaelen: { present: true, activeInExchange: true } },
  });
  const kaelenId = initRes.assignedNpcs[0].assignedId;

  // 1. One-pass with synthetic lifecycle: { lifeState: 'dead' }
  const deathEnvelope = {
    version: '1',
    proposals: [
      {
        id: kaelenId,
        lifecycle: {
          lifeState: 'dead',
          source: { sourceRef: 'current:assistant', excerpt: 'fell in battle' },
        },
      },
    ],
  };

  const deathExchangeContext = {
    chatId: 'chat_death_01',
    currentAssistantMessage: {
      chatId: 'chat_death_01',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:asst_death',
      precedingLineage: ['sha256:user0'],
      text: 'Kaelen fell in battle defending the gate.',
    },
  };

  const deathRes = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.ONE_PASS,
    envelope: deathEnvelope,
    exchangeContext: deathExchangeContext,
  });

  assert.equal(deathRes.success, true, deathRes.error);
  const { state: sDead } = await adapter.load();
  assert.equal(sDead.npcs[kaelenId].lifeState, 'dead');
  // Projections of death (present and active cleared)
  assert.equal(sDead.npcs[kaelenId].present, false);
  assert.equal(sDead.npcs[kaelenId].activeInExchange, false);

  // 2. Development envelope with wire facts container
  const devEnvelope = {
    version: '1',
    proposals: [
      {
        targetId: kaelenId,
        facts: {
          role: 'Fallen Commander',
          species: 'Human',
          source: { sourceRef: 'msg:1', excerpt: 'Fallen Commander' },
          operation: 'update',
        },
      },
    ],
  };

  const devExchangeContext = {
    chatId: 'chat_death_01',
    sources: new Map([
      ['msg:1', {
        chatId: 'chat_death_01',
        position: 1,
        role: 'assistant',
        contentFingerprint: 'sha256:asst_death',
        precedingLineage: ['sha256:user0'],
        text: 'Kaelen, the Fallen Commander, was a legendary human warrior.',
      }],
    ]),
  };

  const devRes = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: devEnvelope,
    exchangeContext: devExchangeContext,
  });

  assert.equal(devRes.success, true, devRes.error);
  const { state: sFinal } = await adapter.load();
  assert.equal(sFinal.npcs[kaelenId].role, 'Fallen Commander');
  assert.equal(sFinal.npcs[kaelenId].species, 'Human');
  // Verify wire metadata was not persisted
  assert.equal(sFinal.npcs[kaelenId].facts, undefined);
});

test('Commit Coordinator (Item 2): bridge enforces authoritative S1 validators and fails closed on invalid envelope', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Invalid One-Pass envelope (version !== '1')
  const badOnePass = {
    version: 'invalid_version',
    proposals: [],
  };
  const opRes = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.ONE_PASS,
    envelope: badOnePass,
  });
  assert.equal(opRes.success, false);
  assert.match(opRes.error, /One-Pass envelope validation failed/);

  // Invalid Development envelope (root is not object or invalid reviewReceipts)
  const badDev = {
    version: '1',
    reviewReceipts: 'not_an_array',
    proposals: [],
  };
  const devRes = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: badDev,
  });
  assert.equal(devRes.success, false);
  assert.match(devRes.error, /Development envelope validation failed/);
});

test('Commit Coordinator (Item 4): raw string dependency is strictly rejected when exchangeContext is present', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const exchangeContext = {
    chatId: 'chat_001',
    sources: new Map(),
  };

  const res = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_1', name: 'Althea' }],
    sourceDependencies: ['raw_string_dependency_without_provenance'],
    exchangeContext,
  });

  assert.equal(res.success, false);
  assert.equal(res.conflict, true);
  assert.equal(res.conflictType, 'source_lineage_conflict');
  assert.match(res.error, /cannot be validated for lineage; captured dependency descriptor required/);
});

// ============================================================================
// Item 6: C08 Support Resolution Hardening
// ============================================================================

test('Commit Coordinator (Item 6): verifies supportingObservationIds against target NPC and derives base fieldRevision', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Create NPC with an existing observation in development.observations
  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'althea', name: 'Althea' }],
  });
  const altheaId = initRes.assignedNpcs[0].assignedId;

  // Add observation via RUNTIME writer
  const obsId = 'obs_althea_role_01';
  const { state: s1 } = await adapter.load();
  s1.npcs[altheaId].development.observations.push({
    id: obsId,
    targetId: altheaId,
    field: 'role',
    observation: 'Observed as High Priestess',
    source: { sourceRef: 'msg:1', excerpt: 'High Priestess' },
    disposition: { role: 'supporting', linkedFieldRevision: '1' },
  });
  const saveRes = await adapter.save(s1, 1);
  assert.equal(saveRes.success, true, saveRes.error);

  // 1. Support proposal with valid supportingObservationId referencing target NPC succeeds
  const validSuppRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: altheaId }],
    fieldProposals: { [altheaId]: { role: 'High Priestess' } },
    supportProposals: [
      {
        targetId: altheaId,
        field: 'role',
        supportingObservationIds: [obsId],
      },
    ],
  });
  assert.equal(validSuppRes.success, true, validSuppRes.error);

  const { state: s2 } = await adapter.load();
  assert.equal(s2.npcs[altheaId].development.acceptedSupport.length, 1);
  assert.deepEqual(s2.npcs[altheaId].development.acceptedSupport[0].supportingObservationIds, [obsId]);

  // 2. Support proposal referencing non-existent observation ID on target NPC fails
  const invalidSuppRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: altheaId }],
    fieldProposals: { [altheaId]: { species: 'Elf' } },
    supportProposals: [
      {
        targetId: altheaId,
        field: 'species',
        supportingObservationIds: ['obs_nonexistent_id'],
      },
    ],
  });
  assert.equal(invalidSuppRes.success, false);
  assert.match(invalidSuppRes.error, /does not exist in target .* persisted observations/);
});

// ============================================================================
// Item 7: NPR targetRef Resolution in Same Transaction
// ============================================================================

test('Commit Coordinator (Item 7): resolves NPR targetRef pointing to new candidate in same transaction batch', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // In a single transaction batch under WRITERS.USER:
  // Elena and Garrick are admitted as new candidates with localRefs,
  // and Garrick establishes NPR pointing to Elena via targetRef
  const commitRes = await coordinator.commit({
    writer: WRITERS.USER,
    identityProposals: [
      { localRef: 'new_elena', name: 'Elena', identityKind: 'named' },
      { localRef: 'new_garrick', name: 'Garrick', identityKind: 'named' },
    ],
    fieldProposals: {
      new_garrick: {
        nonPlayerRelationships: {
          operation: 'establish',
          relationships: [
            {
              targetRef: 'new_elena',
              relationKind: 'ally',
              description: 'Trusted companion',
            },
          ],
        },
      },
    },
  });

  assert.equal(commitRes.success, true, commitRes.error);
  assert.equal(commitRes.assignedNpcs.length, 2);

  const elenaAssignedId = commitRes.assignedNpcs.find(a => a.localRef === 'new_elena').assignedId;
  const garrickAssignedId = commitRes.assignedNpcs.find(a => a.localRef === 'new_garrick').assignedId;

  const { state } = await adapter.load();
  const garrick = state.npcs[garrickAssignedId];
  assert.equal(garrick.nonPlayerRelationships.length, 1);
  assert.equal(garrick.nonPlayerRelationships[0].targetId, elenaAssignedId);
  assert.equal(garrick.nonPlayerRelationships[0].targetRef, undefined);
  assert.ok(garrick.nonPlayerRelationships[0].relationId);
});

// ============================================================================
// Item 9: Writer Gates on Commit Coordinator
// ============================================================================

test('Commit Coordinator (Item 9): rejects direct observations, supportProposals, and reviewReceipts from WRITERS.ONE_PASS', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_1', name: 'Valen' }],
  });
  const valenId = initRes.assignedNpcs[0].assignedId;

  // ONE_PASS attempting observations
  const obsRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: valenId }],
    observations: [{ targetId: valenId, field: 'role', observation: 'test' }],
  });
  assert.equal(obsRes.success, false);
  assert.match(obsRes.error, /cannot author direct 'observations'/);

  // ONE_PASS attempting supportProposals
  const suppRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: valenId }],
    supportProposals: [{ targetId: valenId, field: 'role' }],
  });
  assert.equal(suppRes.success, false);
  assert.match(suppRes.error, /cannot author direct 'supportProposals'/);

  // ONE_PASS attempting reviewReceipts
  const recRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: valenId }],
    reviewReceipts: [{ targetId: valenId, status: 'reviewed' }],
  });
  assert.equal(recRes.success, false);
  assert.match(recRes.error, /cannot author direct 'reviewReceipts'/);
});

test('Commit Coordinator (S2 authority): rejects an unknown writer before mutation', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const res = await coordinator.commit({
    writer: 'development_typo',
    identityProposals: [{ localRef: 'npc_bad_writer', name: 'Bad Writer NPC' }],
    fieldProposals: { npc_bad_writer: { role: 'Archivist' } },
  });

  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'invalid_writer');
  assert.match(res.error, /Unsupported writer/);

  const { state, revision } = await adapter.load();
  assert.equal(revision, 0);
  assert.deepEqual(state.npcs, {});
});

test('Commit Coordinator (S2 authority): Development cannot admit a NEW localRef', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const res = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ localRef: 'new_dev_npc', name: 'Unauthorised Candidate' }],
    fieldProposals: { new_dev_npc: { role: 'Archivist' } },
  });

  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'development_new_admission_forbidden');
  assert.match(res.error, /Candidate admission is One-Pass-owned/);

  const { state, revision } = await adapter.load();
  assert.equal(revision, 0);
  assert.deepEqual(state.npcs, {});
});

test('Commit Coordinator (S2 authority): stale wrong-writer field cannot bypass C02 rejection', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
    fieldProposals: { elena: { mood: 'calm' } },
  });
  const elenaId = initRes.assignedNpcs[0].assignedId;

  const { state: before } = await adapter.load();
  const staleMoodRevision = before.npcs[elenaId].fieldRevisions.mood - 1;

  const res = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: elenaId }],
    readFieldRevisions: { [elenaId]: { mood: staleMoodRevision } },
    fieldProposals: { [elenaId]: { mood: 'curious' } },
  });

  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'wrong_writer');
  assert.match(res.error, /Wrong-writer rejection/);

  const { state: after, revision } = await adapter.load();
  assert.equal(revision, 1);
  assert.equal(after.npcs[elenaId].mood, 'calm');
});

// ============================================================================
// Item 12: Minimal Atomic Bookkeeping Hooks
// ============================================================================

test('Commit Coordinator (Item 12): persists dedupKeys and pendingReviewEntries atomically in commit()', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const commitRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_1', name: 'Lyra' }],
    fieldProposals: { npc_1: { mood: 'curious' } },
    dedupKeys: ['chat_001:msg_42', 'sidecar_001:task_1'],
    pendingReviewEntries: [
      { targetId: 'npc_1', reason: 'unfamiliar_accent', priority: 'normal', sourceScope: ['chat_001:msg_42'] },
    ],
  });

  assert.equal(commitRes.success, true, commitRes.error);
  const assignedId = commitRes.assignedNpcs[0].assignedId;

  const { state } = await adapter.load();
  assert.deepEqual(state.dedup.processedSourceKeys, ['chat_001:msg_42', 'sidecar_001:task_1']);
  assert.equal(state.pendingReview.entries.length, 1);
  assert.equal(state.pendingReview.entries[0].targetId, assignedId); // localRef resolved to assignedId
  assert.equal(state.pendingReview.entries[0].reason, 'unfamiliar_accent');
});

// ============================================================================
// S2 Hardening Regressions (Tasks 1, 2, 3, 4, 5, 8, 9, 13)
// ============================================================================

test('Commit Coordinator (Task 1): bridge fails closed with provenance_context_required when evidence-bearing envelope lacks exchangeContext and capturedDependencies', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const envelope = {
    version: '1',
    proposals: [
      {
        id: null,
        localRef: 'kael',
        identityKind: 'named',
        name: 'Kael',
        evidence: { sourceRef: 'current:assistant', excerpt: 'Kael walked into the hall.' },
        present: true,
      },
    ],
  };

  const res = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.ONE_PASS,
    envelope,
    // Neither exchangeContext nor capturedDependencies supplied!
  });

  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'provenance_context_required');
  assert.match(res.error, /provenance context required/);

  // Assert no state mutation occurred
  const { state, revision } = await adapter.load();
  assert.equal(revision, 0);
  assert.deepEqual(state.npcs, {});
});

test('Commit Coordinator (Task 1): pre-captured dependencies pass without exchangeContext and revalidate with exchangeContext', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const capturedDep = {
    sourceRef: 'current:assistant',
    excerpt: 'Kael walked into the hall.',
    capturedProvenance: {
      chatId: 'chat_01',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:fp_kael',
      precedingLineage: ['sha256:user0'],
    },
  };

  const envelope = {
    version: '1',
    proposals: [
      {
        id: null,
        localRef: 'kael',
        identityKind: 'named',
        name: 'Kael',
        evidence: { sourceRef: 'current:assistant', excerpt: 'Kael walked into the hall.' },
        present: true,
      },
    ],
  };

  // 1. Pass with pre-captured dependencies without exchangeContext
  const res1 = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.ONE_PASS,
    envelope,
    capturedDependencies: [capturedDep],
  });

  assert.equal(res1.success, true, res1.error);
  assert.equal(res1.commitRevision, 1);

  // 2. Revalidate with matching exchangeContext succeeds
  const exchangeContext = {
    chatId: 'chat_01',
    currentAssistantMessage: {
      chatId: 'chat_01',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:fp_kael',
      precedingLineage: ['sha256:user0'],
      text: 'Kael walked into the hall.',
    },
  };

  const envelope2 = {
    version: '1',
    proposals: [
      {
        id: res1.assignedNpcs[0].assignedId,
        mood: 'calm',
        source: { sourceRef: 'current:assistant', excerpt: 'Kael walked into the hall.' },
      },
    ],
  };

  const res2 = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.ONE_PASS,
    envelope: envelope2,
    capturedDependencies: [capturedDep],
    exchangeContext,
  });

  assert.equal(res2.success, true, res2.error);
  assert.equal(res2.commitRevision, 2);
});

test('Commit Coordinator (Task 1): explicitly field-bound captured dependency cannot cover a different concrete field', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
  });
  const elenaId = initRes.assignedNpcs[0].assignedId;

  const envelope = {
    version: '1',
    proposals: [
      {
        targetId: elenaId,
        role: {
          value: 'Archivist',
          source: { sourceRef: 'msg:1', excerpt: 'served as the archivist' },
        },
      },
    ],
  };

  const mismatchedCapturedDependency = {
    sourceRef: 'msg:1',
    targetField: 'species',
    excerpt: 'served as the archivist',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
    capturedProvenance: {
      chatId: 'chat_01',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:fp_archivist',
      precedingLineage: ['sha256:root'],
    },
  };

  const res = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope,
    capturedDependencies: [mismatchedCapturedDependency],
  });

  assert.equal(res.success, false);
  assert.equal(res.errorCode, 'provenance_context_required');
  assert.match(res.error, /not covered by pre-captured dependencies/);

  const { state, revision } = await adapter.load();
  assert.equal(revision, 1);
  assert.equal(state.npcs[elenaId].role, null);
});

test('Commit Coordinator (Task 2): canonical DEVELOPMENT_REVIEW_RAW_TEXT pattern succeeds with compact strings, rejects orphan arbitrary sourceRef', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Admit NPC
  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
  });
  const elenaId = initRes.assignedNpcs[0].assignedId;

  const exchangeContext = {
    chatId: 'chat_01',
    sources: new Map([
      ['msg:2', {
        chatId: 'chat_01',
        position: 2,
        role: 'assistant',
        contentFingerprint: 'sha256:fp2',
        precedingLineage: ['sha256:root'],
        text: 'Elena studied the ancient codex diligently.',
      }],
    ]),
  };

  // 1. Valid pattern: msg:2 is concrete SourceReference in canonicalAppearance, and supportProposals cites ['msg:2']
  const devEnvelope = {
    version: '1',
    reviewReceipts: [
      { targetId: elenaId, sourceScope: ['msg:2'], status: 'reviewed' },
    ],
    proposals: [
      {
        targetId: elenaId,
        canonicalAppearance: {
          value: 'Scholar studying ancient codex',
          source: { sourceRef: 'msg:2', excerpt: 'ancient codex diligently' },
        },
      },
    ],
    supportProposals: [
      {
        targetId: elenaId,
        field: 'canonicalAppearance',
        sourceRefs: ['msg:2'],
      },
    ],
  };

  const okRes = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: devEnvelope,
    exchangeContext,
  });

  assert.equal(okRes.success, true, okRes.error);
  const { state } = await adapter.load();
  const acceptedSupport = state.npcs[elenaId].development.acceptedSupport;
  assert.equal(acceptedSupport.length, 1);
  // Persisted compact string refs, not fake excerpt objects!
  assert.deepEqual(acceptedSupport[0].sourceRefs, ['msg:2']);

  // 2. Orphan sourceRef rejected: citing 'msg:999' which does not exist in concrete sources or captured dependencies
  const badEnvelope = {
    version: '1',
    reviewReceipts: [
      { targetId: elenaId, sourceScope: ['msg:2'], status: 'reviewed' },
    ],
    proposals: [
      {
        targetId: elenaId,
        role: {
          value: 'Archivist',
          source: { sourceRef: 'msg:2', excerpt: 'ancient codex' },
        },
      },
    ],
    supportProposals: [
      {
        targetId: elenaId,
        field: 'role',
        sourceRefs: ['msg:999'], // Orphan!
      },
    ],
  };

  const badRes = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: badEnvelope,
    exchangeContext,
  });

  assert.equal(badRes.success, false);
  assert.equal(badRes.errorCode, 'orphan_source_reference');
  assert.match(badRes.error, /unverified/);
});

test('Commit Coordinator (Task 3): extractConcreteSourceReferences traverses container and collection item sources without masking', () => {
  const envelope = {
    version: '1',
    source: { sourceRef: 'msg:root', excerpt: 'root text' },
    observations: [
      {
        targetId: 'npc_1',
        field: 'role',
        observation: 'obs text',
        source: { sourceRef: 'msg:obs', excerpt: 'obs excerpt' },
      },
    ],
    proposals: [
      {
        targetId: 'npc_1',
        appearanceForms: {
          source: { sourceRef: 'msg:forms_container', excerpt: 'container excerpt' },
          operation: 'add',
          forms: [
            {
              formId: 'form_1',
              name: 'Wolf',
              description: 'Wolf form',
              source: { sourceRef: 'msg:form_item_1', excerpt: 'form 1 excerpt' },
            },
          ],
        },
        facts: {
          role: {
            value: 'Guard',
            source: { sourceRef: 'msg:fact_role', excerpt: 'fact role excerpt' },
          },
        },
      },
    ],
  };

  const extracted = extractConcreteSourceReferences(envelope);
  const sourceRefs = extracted.map((e) => e.ref.sourceRef);

  assert.ok(sourceRefs.includes('msg:root'));
  assert.ok(sourceRefs.includes('msg:obs'));
  assert.ok(sourceRefs.includes('msg:forms_container'));
  assert.ok(sourceRefs.includes('msg:form_item_1'));
  assert.ok(sourceRefs.includes('msg:fact_role'));
  assert.equal(sourceRefs.length, 5);
});

test('Commit Coordinator (Tasks 4 & 13): C08 supportingObservationIds and supportingObservationRefs reject base field mismatches', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initialize NPC with speech observation
  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
  });
  const elenaId = initRes.assignedNpcs[0].assignedId;

  // Add a persisted observation on 'speech'
  const obsRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: elenaId }],
    observations: [
      {
        targetId: elenaId,
        field: 'speech',
        observation: 'Speaks with formal tone',
        source: { sourceRef: 'msg:1', excerpt: 'formal tone' },
        disposition: { role: 'tentative' },
      },
    ],
  });
  assert.equal(obsRes.success, true);
  const speechObsId = obsRes.observationIds[0];

  // 1. Task 4: supportingObservationIds field mismatch: supportProposal targets 'role', but observation is for 'speech'
  const mismatchIdRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: elenaId }],
    fieldProposals: { [elenaId]: { role: 'Archivist' } },
    supportProposals: [
      {
        targetId: elenaId,
        field: 'role', // role vs speech!
        supportingObservationIds: [speechObsId],
      },
    ],
  });

  assert.equal(mismatchIdRes.success, false);
  assert.match(mismatchIdRes.error, /field mismatch: observation base field 'speech' does not match support proposal base field 'role'/);

  // 2. Task 13: supportingObservationRefs field mismatch
  const mismatchRefRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: elenaId }],
    fieldProposals: { [elenaId]: { role: 'Archivist' } },
    observations: [
      {
        localObservationRef: 'obs_local_species',
        targetId: elenaId,
        field: 'species',
        observation: 'Appears human',
        source: { sourceRef: 'msg:2', excerpt: 'human' },
        disposition: { role: 'tentative' },
      },
    ],
    supportProposals: [
      {
        targetId: elenaId,
        field: 'role', // role vs species!
        supportingObservationRefs: ['obs_local_species'],
      },
    ],
  });

  assert.equal(mismatchRefRes.success, false);
  assert.match(mismatchRefRes.error, /field mismatch: observation base field 'species' does not match support proposal base field 'role'/);
});

test('Commit Coordinator (Task 5): field-scoped deferral blocks only matching support and restricted receipt', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
  });
  const elenaId = initRes.assignedNpcs[0].assignedId;

  const baseline = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: elenaId }],
    fieldProposals: {
      [elenaId]: { role: 'Archivist', species: 'Human' },
    },
  });
  assert.equal(baseline.success, true, baseline.error);

  const { state: baselineState } = await adapter.load();
  const roleRevision = baselineState.npcs[elenaId].fieldRevisions.role;
  const speciesRevision = baselineState.npcs[elenaId].fieldRevisions.species;

  // A user correction changes only role after Development captured its read tokens.
  const userUpdate = await coordinator.commit({
    writer: WRITERS.USER,
    identityProposals: [{ id: elenaId }],
    fieldProposals: { [elenaId]: { role: 'Senior Archivist' } },
  });
  assert.equal(userUpdate.success, true, userUpdate.error);

  const devRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: elenaId }],
    readFieldRevisions: {
      [elenaId]: { role: roleRevision, species: speciesRevision },
    },
    fieldProposals: {
      [elenaId]: { role: 'Chief Archivist', species: 'Elf' },
    },
    supportProposals: [
      { targetId: elenaId, field: 'role', sourceRefs: ['msg:role'] },
      { targetId: elenaId, field: 'species', sourceRefs: ['msg:species'] },
    ],
    reviewReceipts: [
      {
        targetId: elenaId,
        status: 'reviewed',
        sourceScope: ['msg:role'],
        restricted: true,
        fieldSubset: ['role'],
      },
      {
        targetId: elenaId,
        status: 'reviewed',
        sourceScope: ['msg:species'],
        restricted: true,
        fieldSubset: ['species'],
      },
    ],
  });

  assert.equal(devRes.success, true, devRes.error);
  assert.equal(devRes.deferred.length, 1);
  assert.equal(devRes.deferred[0].field, 'role');
  assert.equal(devRes.deferred[0].reason, 'read_dependency_changed');

  const { state } = await adapter.load();
  assert.equal(state.npcs[elenaId].role, 'Senior Archivist');
  assert.equal(state.npcs[elenaId].species, 'Elf');

  const acceptedSupport = state.npcs[elenaId].development.acceptedSupport;
  assert.equal(acceptedSupport.length, 1);
  assert.equal(acceptedSupport[0].field, 'species');
  assert.deepEqual(acceptedSupport[0].sourceRefs, ['msg:species']);

  const receipts = state.npcs[elenaId].development.reviewReceipts;
  assert.equal(receipts.length, 2);
  assert.equal(receipts.find((r) => r.fieldSubset.includes('role')).status, 'deferred');
  assert.equal(receipts.find((r) => r.fieldSubset.includes('species')).status, 'reviewed');
});

test('Commit Coordinator (Task 8): exact dedup replay returns noop and prevents duplicate relationship delta application', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // First commit applying relationship delta with a dedupKey
  const commit1 = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_1', name: 'Lyra' }],
    fieldProposals: {
      npc_1: {
        relationshipEvaluation: {
          shifted: true,
          axes: { trust: 2.0 },
          impact: 'Gained trust',
        },
      },
    },
    dedupKeys: ['exchange_turn_42:asst'],
  });

  assert.equal(commit1.success, true);
  const assignedId = commit1.assignedNpcs[0].assignedId;
  const { state: s1, revision: rev1 } = await adapter.load();
  assert.equal(s1.npcs[assignedId].relationship.trust, 2.0);

  // Exact replay of the same dedupKey
  const replayCommit = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: assignedId }],
    fieldProposals: {
      [assignedId]: {
        relationshipEvaluation: {
          shifted: true,
          axes: { trust: 2.0 },
          impact: 'Gained trust again?',
        },
      },
    },
    dedupKeys: ['exchange_turn_42:asst'],
  });

  assert.equal(replayCommit.success, true);
  assert.equal(replayCommit.replay, true);
  assert.equal(replayCommit.noop, true);
  assert.equal(replayCommit.reason, 'dedup_exact_replay');

  // Verify state and storage revision are unchanged, score was NOT double-applied
  const { state: s2, revision: rev2 } = await adapter.load();
  assert.equal(rev2, rev1);
  assert.equal(s2.npcs[assignedId].relationship.trust, 2.0);
});

test('Commit Coordinator (Task 9): pending-review hooks fail atomically on invalid target, tombstone, or duplicate identity', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initialize NPC and tombstone another
  const initRes = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'npc_alive', name: 'Lyra' }],
  });
  const aliveId = initRes.assignedNpcs[0].assignedId;

  // Add tombstone manually to state for test
  const { state } = await adapter.load();
  state.tombstones.npc_tomb = { deletedAt: '2026-09-10T00:00:00Z', reason: 'removed' };
  await adapter.save(state, 1);

  // 1. Invalid non-existent target fails atomically
  const badTargetRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    pendingReviewEntries: [
      { targetId: 'npc_does_not_exist', reason: 'check', sourceScope: ['msg:1'] },
    ],
  });
  assert.equal(badTargetRes.success, false);
  assert.match(badTargetRes.error, /does not exist in state/);

  // 2. Tombstoned target fails atomically
  const badTombRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    pendingReviewEntries: [
      { targetId: 'npc_tomb', reason: 'check', sourceScope: ['msg:1'] },
    ],
  });
  assert.equal(badTombRes.success, false);
  assert.match(badTombRes.error, /is tombstoned/);

  // 3. Duplicate pending identity in batch fails atomically
  const dupRes = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    pendingReviewEntries: [
      { targetId: aliveId, reason: 'check', sourceScope: ['msg:1'] },
      { targetId: aliveId, reason: 'duplicate check', sourceScope: ['msg:1'] },
    ],
  });
  assert.equal(dupRes.success, false);
  assert.match(dupRes.error, /Duplicate pending review entry/);

  // Verify workingState was never mutated
  const { state: finalState } = await adapter.load();
  assert.deepEqual(finalState.pendingReview.entries, []);
});

test('Commit Coordinator (Task 1): malformed/missing capturedProvenance or unknown keys fail closed', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  const envelope = {
    version: '1',
    proposals: [
      {
        id: null,
        localRef: 'kael',
        identityKind: 'named',
        name: 'Kael',
        evidence: { sourceRef: 'current:assistant', excerpt: 'Kael walked into the hall.' },
        present: true,
      },
    ],
  };

  // 1. Missing capturedProvenance in caller-supplied dependency
  const resMissing = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.ONE_PASS,
    envelope,
    capturedDependencies: [
      { sourceRef: 'current:assistant', excerpt: 'Kael walked into the hall.' },
    ],
  });
  assert.equal(resMissing.success, false);
  assert.equal(resMissing.errorCode, 'invalid_captured_dependency');
  assert.match(resMissing.error, /requires 'capturedProvenance' object/);

  // 2. Unknown keys in caller-supplied dependency
  const resUnknown = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.ONE_PASS,
    envelope,
    capturedDependencies: [
      {
        sourceRef: 'current:assistant',
        excerpt: 'Kael walked into the hall.',
        unknownField: 'bad',
        capturedProvenance: {
          chatId: 'chat_01',
          position: 1,
          role: 'assistant',
          contentFingerprint: 'sha256:fp1',
          precedingLineage: ['sha256:root'],
        },
      },
    ],
  });
  assert.equal(resUnknown.success, false);
  assert.equal(resUnknown.errorCode, 'invalid_captured_dependency');
  assert.match(resUnknown.error, /Unknown key 'unknownField'/);

  // 3. Excerpt mismatch without exchangeContext fails closed
  const resExcerptMismatch = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.ONE_PASS,
    envelope,
    capturedDependencies: [
      {
        sourceRef: 'current:assistant',
        excerpt: 'Different excerpt entirely', // does not match proposal evidence!
        capturedProvenance: {
          chatId: 'chat_01',
          position: 1,
          role: 'assistant',
          contentFingerprint: 'sha256:fp1',
          precedingLineage: ['sha256:root'],
        },
      },
    ],
  });
  assert.equal(resExcerptMismatch.success, false);
  assert.equal(resExcerptMismatch.errorCode, 'provenance_context_required');
  assert.match(resExcerptMismatch.error, /not covered by pre-captured dependencies with matching excerpt/);
});

test('Commit Coordinator (Task 2): receipt-only envelope requires provenance context and verifies owned scope', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initialize NPC
  const init = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
  });
  const elenaId = init.assignedNpcs[0].assignedId;

  // Development envelope containing only reviewReceipts, NO concrete source references
  const receiptOnlyEnvelope = {
    version: '1',
    reviewReceipts: [
      {
        targetId: elenaId,
        sourceScope: ['msg:1'],
        status: 'reviewed',
      },
    ],
  };

  // 1. Without exchangeContext and without capturedDependencies: fails closed!
  const resNoContext = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: receiptOnlyEnvelope,
  });
  assert.equal(resNoContext.success, false);
  assert.equal(resNoContext.errorCode, 'provenance_context_required');

  // Verify no mutation occurred
  const { state: s0 } = await adapter.load();
  assert.equal(s0.npcs[elenaId].development?.reviewReceipts?.length || 0, 0);

  // 2. With exchangeContext: succeeds, resolves owned scope, captures provenance without fabricating excerpt
  const exchangeContext = {
    chatId: 'chat_01',
    sources: [
      {
        id: 'msg:1',
        chatId: 'chat_01',
        position: 1,
        role: 'user',
        contentFingerprint: 'sha256:user1_fp',
        precedingLineage: ['sha256:root'],
        text: 'Hello Elena',
      },
    ],
  };

  const resWithContext = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: receiptOnlyEnvelope,
    exchangeContext,
  });
  assert.equal(resWithContext.success, true);

  const { state: s1 } = await adapter.load();
  assert.equal(s1.npcs[elenaId].development.reviewReceipts.length, 1);
  assert.equal(s1.npcs[elenaId].development.reviewReceipts[0].status, 'reviewed');
  assert.deepEqual(s1.npcs[elenaId].development.reviewReceipts[0].sourceScope, ['msg:1']);

  // Checkpoint sourceDependencies recorded msg:1 with capturedProvenance and NO excerpt
  const latestChk = s1.history.checkpoints[s1.history.checkpoints.length - 1];
  const scopeDep = latestChk.sourceDependencies.find((d) => d.sourceRef === 'msg:1');
  assert.ok(scopeDep);
  assert.equal(scopeDep.excerpt, undefined);
  assert.equal(scopeDep.capturedProvenance.chatId, 'chat_01');
  assert.equal(scopeDep.capturedProvenance.contentFingerprint, 'sha256:user1_fp');

  // 3. Wrong/stale scope in exchangeContext fails closed
  const staleContext = {
    chatId: 'chat_01',
    sources: [
      {
        id: 'msg:1',
        chatId: 'chat_DIFFERENT', // wrong chat!
        position: 1,
        role: 'user',
        contentFingerprint: 'sha256:user1_fp',
        precedingLineage: ['sha256:root'],
        text: 'Hello Elena',
      },
    ],
  };
  const resStale = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: receiptOnlyEnvelope,
    exchangeContext: staleContext,
  });
  assert.equal(resStale.success, false);
  assert.equal(resStale.errorCode, 'wrong_chat');

  // 4. Pre-captured scope success and failure
  const validPreCaptured = [
    {
      sourceRef: 'msg:1',
      capturedProvenance: {
        chatId: 'chat_01',
        position: 1,
        role: 'user',
        contentFingerprint: 'sha256:user1_fp',
        precedingLineage: ['sha256:root'],
      },
    },
  ];

  const resPreCaptured = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: receiptOnlyEnvelope,
    capturedDependencies: validPreCaptured,
  });
  assert.equal(resPreCaptured.success, true);

  // Missing pre-captured scope fails closed
  const resMissingPre = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: receiptOnlyEnvelope,
    capturedDependencies: [
      {
        sourceRef: 'msg:OTHER',
        capturedProvenance: {
          chatId: 'chat_01',
          position: 2,
          role: 'user',
          contentFingerprint: 'sha256:other',
          precedingLineage: ['sha256:root'],
        },
      },
    ],
  });
  assert.equal(resMissingPre.success, false);
  assert.equal(resMissingPre.errorCode, 'provenance_context_required');
});

test('Commit Coordinator (Task 3): targetAcknowledgments persists exactly as runtime reviewReceipts bookkeeping', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initialize NPC
  const init = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
  });
  const elenaId = init.assignedNpcs[0].assignedId;

  const envelopeWithTargetAcks = {
    version: '1',
    targetAcknowledgments: [
      {
        targetId: elenaId,
        sourceScope: ['msg:1'],
        status: 'reviewed',
      },
    ],
  };

  const exchangeContext = {
    chatId: 'chat_01',
    sources: [
      {
        id: 'msg:1',
        chatId: 'chat_01',
        position: 1,
        role: 'user',
        contentFingerprint: 'sha256:user1_fp',
        precedingLineage: ['sha256:root'],
        text: 'Hello Elena',
      },
    ],
  };

  const res = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: envelopeWithTargetAcks,
    exchangeContext,
  });

  assert.equal(res.success, true, res.error);
  const { state } = await adapter.load();
  assert.equal(state.npcs[elenaId].development.reviewReceipts.length, 1);
  assert.equal(state.npcs[elenaId].development.reviewReceipts[0].status, 'reviewed');
  assert.deepEqual(state.npcs[elenaId].development.reviewReceipts[0].sourceScope, ['msg:1']);
});

test('Commit Coordinator (Task 4): review receipt targeting non-existent or tombstoned NPC fails atomically', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initialize NPC
  const init = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
  });
  const elenaId = init.assignedNpcs[0].assignedId;

  // Add tombstone
  const { state } = await adapter.load();
  state.tombstones.npc_tomb = { deletedAt: '2026-09-10T00:00:00Z', reason: 'deleted' };
  await adapter.save(state, 1);

  // 1. Target does not exist
  const resNonExistent = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    reviewReceipts: [
      { targetId: 'npc_ghost', sourceScope: ['msg:1'], status: 'reviewed' },
    ],
  });
  assert.equal(resNonExistent.success, false);
  assert.match(resNonExistent.error, /does not exist in state/);

  // 2. Target is tombstoned
  const resTomb = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    reviewReceipts: [
      { targetId: 'npc_tomb', sourceScope: ['msg:1'], status: 'reviewed' },
    ],
  });
  assert.equal(resTomb.success, false);
  assert.match(resTomb.error, /is tombstoned/);

  // Verify revision has not incremented
  const { revision } = await adapter.load();
  assert.equal(revision, 2);
});

test('Commit Coordinator (Task 5): runtime acceptedSupport enforces canonical base-field revision truth', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initialize NPC
  const init = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
    fieldProposals: { elena: { mood: 'calm' } },
  });
  assert.equal(init.success, true);
  const elenaId = init.assignedNpcs[0].assignedId;

  // 1. Supplying a mismatched fieldRevision fails closed
  const resMismatch = await coordinator.commit({
    writer: WRITERS.RUNTIME,
    acceptedSupport: [
      {
        targetId: elenaId,
        field: 'role',
        fieldRevision: '99', // Mismatched! Current is 1
        sourceRefs: ['msg:1'],
      },
    ],
  });
  assert.equal(resMismatch.success, false);
  assert.match(resMismatch.error, /does not match canonical base-field revision '1' for 'role'/);

  // Establish the dotted field's canonical base value before supporting it.
  const personalitySet = await coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: elenaId }],
    fieldProposals: { [elenaId]: { personality: { traits: ['Observant'] } } },
  });
  assert.equal(personalitySet.success, true, personalitySet.error);
  const { state: personalityState } = await adapter.load();
  const personalityRevision = String(personalityState.npcs[elenaId].fieldRevisions.personality);

  // 2. Dotted field maps to canonical base-field revision
  const resDotted = await coordinator.commit({
    writer: WRITERS.RUNTIME,
    acceptedSupport: [
      {
        targetId: elenaId,
        field: 'personality.traits',
        fieldRevision: personalityRevision,
        sourceRefs: ['msg:1'],
      },
    ],
  });
  assert.equal(resDotted.success, true);
  const { state } = await adapter.load();
  const supp = state.npcs[elenaId].development.acceptedSupport[0];
  assert.equal(supp.field, 'personality.traits');
  assert.equal(supp.fieldRevision, personalityRevision); // dotted support uses the canonical personality revision
});

test('Commit Coordinator (Task 6): supportProposals.sourceRefs requires mechanically permitted segment kind for field', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initialize NPC
  const init = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
    fieldProposals: { elena: { mood: 'calm' } },
  });
  assert.equal(init.success, true);
  const elenaId = init.assignedNpcs[0].assignedId;

  const exchangeContext = {
    chatId: 'chat_01',
    sources: [
      {
        id: 'msg:ws',
        chatId: 'chat_01',
        position: 1,
        role: 'system',
        contentFingerprint: 'sha256:ws_fp',
        precedingLineage: ['sha256:root'],
        worldStateText: 'Elena is in the library.',
      },
      {
        id: 'msg:nar',
        chatId: 'chat_01',
        position: 2,
        role: 'assistant',
        contentFingerprint: 'sha256:nar_fp',
        precedingLineage: ['sha256:ws_fp'],
        text: 'Elena studied the old archives with careful precision.',
      },
    ],
  };

  // 1. Envelope where msg:ws is a world_state source (permitted for location/activeInExchange, NOT permitted for role/personality)
  // 1. Envelope where msg:ws is a world_state source (permitted for location/activeInExchange, NOT permitted for role/personality)
  // Trying to cite msg:ws in supportProposals for 'role' must fail closed!
  const badSupportEnvelope = {
    version: '1',
    supportProposals: [
      {
        targetId: elenaId,
        field: 'role', // world_state forbidden for role!
        sourceRefs: ['msg:ws'],
      },
    ],
  };

  const resForbidden = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: badSupportEnvelope,
    capturedDependencies: [
      {
        sourceRef: 'msg:ws',
        segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
        capturedProvenance: {
          chatId: 'chat_01',
          position: 1,
          role: 'system',
          contentFingerprint: 'sha256:ws_fp',
          precedingLineage: ['sha256:root'],
        },
      },
    ],
    exchangeContext,
  });
  assert.equal(resForbidden.success, false);
  assert.equal(resForbidden.errorCode, 'segment_permission_violation');
  assert.match(resForbidden.error, /has segment kind not permitted for durable field 'role'/);

  // 2. Valid support proposal citing msg:nar (narrative segment kind, permitted for role)
  const goodSupportEnvelope = {
    version: '1',
    proposals: [
      {
        targetId: elenaId,
        role: {
          value: 'Chief Archivist',
          source: {
            sourceRef: 'msg:nar',
            excerpt: 'careful precision',
            segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
          },
        },
      },
    ],
    supportProposals: [
      {
        targetId: elenaId,
        field: 'role',
        sourceRefs: ['msg:nar'],
      },
    ],
  };

  const resPermitted = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope: goodSupportEnvelope,
    exchangeContext,
  });
  assert.equal(resPermitted.success, true, resPermitted.error);
  const { state } = await adapter.load();
  assert.equal(state.npcs[elenaId].role, 'Chief Archivist');
  assert.equal(state.npcs[elenaId].development.acceptedSupport.length, 1);
  assert.deepEqual(state.npcs[elenaId].development.acceptedSupport[0].sourceRefs, ['msg:nar']);
});

test('Commit Coordinator (Task 7): current lock blocks field mutation, prevents support promotion, and defers restricted receipt', async () => {
  const adapter = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage: adapter });

  // Initialize NPC with locked 'role' field
  const init = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'elena', name: 'Elena' }],
    fieldProposals: { elena: { mood: 'curious' } },
  });
  assert.equal(init.success, true);
  const elenaId = init.assignedNpcs[0].assignedId;

  // Add lock on 'role'
  const { state: s0 } = await adapter.load();
  s0.npcs[elenaId].role = 'Scholar';
  s0.npcs[elenaId].locks = { role: true };
  await adapter.save(s0, 1);

  const exchangeContext = {
    chatId: 'chat_01',
    sources: [
      {
        id: 'msg:1',
        chatId: 'chat_01',
        position: 1,
        role: 'assistant',
        contentFingerprint: 'sha256:fp1',
        precedingLineage: ['sha256:root'],
        text: 'Elena declared herself high archivist.',
      },
    ],
  };

  // Development proposes mutation to 'role', support for 'role', and restricted reviewReceipt for ['role']
  const envelope = {
    version: '1',
    proposals: [
      {
        targetId: elenaId,
        role: {
          value: 'High Archivist',
          source: { sourceRef: 'msg:1', excerpt: 'high archivist' },
        },
      },
    ],
    supportProposals: [
      {
        targetId: elenaId,
        field: 'role',
        sourceRefs: ['msg:1'],
      },
    ],
    reviewReceipts: [
      {
        targetId: elenaId,
        sourceScope: ['msg:1'],
        status: 'reviewed',
        restricted: true,
        fieldSubset: ['role'],
      },
    ],
  };

  const res = await coordinator.commitValidatedEnvelope({
    writer: WRITERS.DEVELOPMENT,
    envelope,
    exchangeContext,
  });

  assert.equal(res.success, true, res.error);
  // Verify lock blocked the proposal: reported in deferred
  assert.ok(res.deferred.some((d) => d.targetId === elenaId && d.field === 'role' && d.reason === 'locked'));

  const { state: s1 } = await adapter.load();
  // 1. No field write: role remains 'Scholar'
  assert.equal(s1.npcs[elenaId].role, 'Scholar');

  // 2. No accepted-support blessing: acceptedSupport empty
  assert.equal(s1.npcs[elenaId].development.acceptedSupport.length, 0);

  // 3. No false reviewed receipt: receipt status is 'deferred' (not 'reviewed')
  assert.equal(s1.npcs[elenaId].development.reviewReceipts.length, 1);
  assert.equal(s1.npcs[elenaId].development.reviewReceipts[0].status, 'deferred');
  assert.equal(s1.npcs[elenaId].development.reviewReceipts[0].restricted, true);
  assert.deepEqual(s1.npcs[elenaId].development.reviewReceipts[0].fieldSubset, ['role']);
});



