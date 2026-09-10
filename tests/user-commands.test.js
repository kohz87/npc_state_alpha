import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorageAdapter } from '../src/state/storage.js';
import { CommitCoordinator } from '../src/runtime/commit-coordinator.js';
import {
  applyNpcEdit,
  updateNpcField,
  setFieldLock,
  setImportance,
  setPortrait,
  deleteNpc,
  correctLifecycle,
} from '../src/runtime/user-commands.js';
import { createDefaultNpcRecord, createInitialState } from '../src/state/schema.js';
import { WRITERS } from '../src/contract/registry.js';

async function harness(npc = createDefaultNpcRecord('alice', 'Alice')) {
  const storage = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage });
  await storage.save({ ...createInitialState(), npcs: { [npc.id]: npc } }, 0);
  return { storage, coordinator };
}

test('User Commands: one atomic edit writes corrections, locks, portrait, and importance through shared coordinator', async () => {
  const { storage, coordinator } = await harness();
  const before = await storage.load();
  const result = await applyNpcEdit(coordinator, {
    npcId: 'alice',
    expectedRevision: before.revision,
    fields: {
      role: 'Royal Archivist',
      background: 'Raised in the river quarter',
    },
    locks: { role: true, background: false },
    portrait: '/user/images/alice.png',
    importance: 7,
    reason: 'Player corrected the dossier',
  });
  assert.equal(result.success, true, result.error);

  const loaded = await storage.load();
  const alice = loaded.state.npcs.alice;
  assert.equal(alice.role, 'Royal Archivist');
  assert.equal(alice.background, 'Raised in the river quarter');
  assert.equal(alice.portrait, '/user/images/alice.png');
  assert.equal(alice.importance, 7);
  assert.equal(alice.locks.role, true);
  assert.equal(alice.locks.background, false);
  assert.equal(alice.manualCorrections.role.reason, 'Player corrected the dossier');
  assert.equal(alice.manualCorrections.background.writer, WRITERS.USER);
  assert.equal(alice.manualCorrections.locks, undefined);
});

test('User Commands: correction alone does not lock; explicit lock blocks later automatic writer', async () => {
  const { storage, coordinator } = await harness();
  await updateNpcField(coordinator, { npcId: 'alice', fieldName: 'mood', value: 'calm', reason: 'Manual correction' });

  let automatic = await coordinator.commit({ writer: WRITERS.ONE_PASS, fieldProposals: { alice: { mood: 'alarmed' } } });
  assert.equal(automatic.success, true, automatic.error);
  let loaded = await storage.load();
  assert.equal(loaded.state.npcs.alice.mood, 'alarmed');
  assert.ok(loaded.state.npcs.alice.manualCorrections.mood);

  await setFieldLock(coordinator, { npcId: 'alice', fieldName: 'mood', locked: true });
  automatic = await coordinator.commit({ writer: WRITERS.ONE_PASS, fieldProposals: { alice: { mood: 'furious' } } });
  assert.equal(automatic.success, true, automatic.error);
  loaded = await storage.load();
  assert.equal(loaded.state.npcs.alice.mood, 'alarmed');
  assert.equal(loaded.state.npcs.alice.locks.mood, true);
});

test('User Commands: stale atomic edit fails without partial mutation', async () => {
  const { storage, coordinator } = await harness();
  const snapshot = await storage.load();
  await updateNpcField(coordinator, { npcId: 'alice', fieldName: 'mood', value: 'busy' });

  const stale = await applyNpcEdit(coordinator, {
    npcId: 'alice',
    expectedRevision: snapshot.revision,
    fields: { role: 'Mage', background: 'Changed' },
    portrait: '/user/images/new.png',
    importance: 9,
  });
  assert.equal(stale.success, false);
  assert.equal(stale.casConflict, true);

  const loaded = await storage.load();
  assert.equal(loaded.state.npcs.alice.role, null);
  assert.equal(loaded.state.npcs.alice.background, null);
  assert.equal(loaded.state.npcs.alice.portrait, null);
  assert.equal(loaded.state.npcs.alice.importance, null);
  assert.equal(loaded.state.npcs.alice.mood, 'busy');
});

test('User Commands: portrait and importance validate user-owned inputs', async () => {
  const { coordinator } = await harness();
  const badPortrait = await setPortrait(coordinator, { npcId: 'alice', portrait: 'data:image/png;base64,AAAA' });
  assert.equal(badPortrait.success, false);
  assert.equal(badPortrait.errorCode, 'invalid_portrait');

  const badImportance = await setImportance(coordinator, { npcId: 'alice', importance: 11 });
  assert.equal(badImportance.success, false);
  assert.equal(badImportance.errorCode, 'invalid_importance');
});

test('User Commands: user lifecycle correction may fix mistaken death; automatic resurrection remains forbidden', async () => {
  const npc = createDefaultNpcRecord('alice', 'Alice');
  npc.lifeState = 'dead';
  npc.present = false;
  npc.activeInExchange = false;
  const { storage, coordinator } = await harness(npc);

  const automatic = await coordinator.commit({ writer: WRITERS.ONE_PASS, fieldProposals: { alice: { lifeState: 'alive' } } });
  assert.equal(automatic.success, false);
  assert.match(automatic.error, /dead->alive|resurrection/i);

  const correction = await correctLifecycle(coordinator, { npcId: 'alice', lifeState: 'alive', reason: 'Death scene was mistaken' });
  assert.equal(correction.success, true, correction.error);
  const loaded = await storage.load();
  assert.equal(loaded.state.npcs.alice.lifeState, 'alive');
  assert.equal(loaded.state.npcs.alice.manualCorrections.lifeState.reason, 'Death scene was mistaken');
});

test('User Commands: deletion tombstones atomically; restoration remains an explicit S6 recovery boundary', async () => {
  const { storage, coordinator } = await harness();
  const deletion = await deleteNpc(coordinator, { npcId: 'alice', reason: 'Player removed duplicate NPC' });
  assert.equal(deletion.success, true, deletion.error);
  let loaded = await storage.load();
  assert.equal(loaded.state.npcs.alice, undefined);
  assert.equal(loaded.state.tombstones.alice.reason, 'Player removed duplicate NPC');
  assert.ok(loaded.state.tombstones.alice.deletedAt);

  const restoreAttempt = await coordinator.commit({ writer: WRITERS.USER, restoreProposals: ['alice'] });
  assert.equal(restoreAttempt.success, false);
  assert.equal(restoreAttempt.errorCode, 'history_recovery_required');
  loaded = await storage.load();
  assert.equal(loaded.state.npcs.alice, undefined);
  assert.ok(loaded.state.tombstones.alice);
});
