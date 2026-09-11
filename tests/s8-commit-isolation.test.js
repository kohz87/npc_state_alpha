import test from 'node:test';
import assert from 'node:assert/strict';

import { WRITERS } from '../src/contract/registry.js';
import { createDefaultNpcRecord, createInitialState } from '../src/state/schema.js';
import { MemoryStorageAdapter } from '../src/state/storage.js';
import { CommitCoordinator } from '../src/runtime/commit-coordinator.js';

function pending(id, targetId) {
  return {
    id,
    targetId,
    sourceScope: [`chat:s8:${id}`],
    exchangeId: `s8:${id}`,
    reason: 'routine_exchange',
    createdAt: '2026-09-11T00:00:00.000Z',
  };
}

test('S8 CommitCoordinator: rejected existing One-Pass target is atomic while independent sibling and its pending scope commit', async () => {
  const alice = createDefaultNpcRecord('alice', 'Alice', {
    lifeState: 'dead',
    present: false,
    activeInExchange: false,
    mood: 'final',
  });
  const bob = createDefaultNpcRecord('bob', 'Bob', { mood: 'calm' });
  const storage = new MemoryStorageAdapter(createInitialState({ npcs: { alice, bob } }));
  const coordinator = new CommitCoordinator({ storage });

  const result = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: 'alice' }, { id: 'bob' }],
    fieldProposals: {
      alice: { mood: 'impossible live mood', present: true },
      bob: { mood: 'irritated' },
    },
    pendingReviewEntries: [pending('alice-review', 'alice'), pending('bob-review', 'bob')],
    operationMode: 'one_pass',
  });

  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.rejected.map((item) => item.targetId), ['alice']);
  const loaded = await storage.load();
  assert.equal(loaded.state.npcs.alice.mood, 'final', 'rejected target must not leak an earlier partial field mutation');
  assert.equal(loaded.state.npcs.alice.present, false);
  assert.equal(loaded.state.npcs.bob.mood, 'irritated');
  assert.deepEqual(loaded.state.pendingReview.entries.map((entry) => entry.targetId), ['bob']);
});

test('S8 CommitCoordinator: all-rejected existing One-Pass transaction still fails closed', async () => {
  const alice = createDefaultNpcRecord('alice', 'Alice', {
    lifeState: 'dead',
    present: false,
    activeInExchange: false,
    mood: 'final',
  });
  const storage = new MemoryStorageAdapter(createInitialState({ npcs: { alice } }));
  const coordinator = new CommitCoordinator({ storage });

  const result = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: 'alice' }],
    fieldProposals: { alice: { mood: 'impossible live mood', present: true } },
    pendingReviewEntries: [pending('alice-review', 'alice')],
    operationMode: 'one_pass',
  });

  assert.equal(result.success, false);
  assert.deepEqual(result.rejected.map((item) => item.targetId), ['alice']);
  const loaded = await storage.load();
  assert.equal(loaded.revision, 0);
  assert.equal(loaded.state.npcs.alice.mood, 'final');
  assert.equal(loaded.state.pendingReview.entries.length, 0);
});

test('S8 CommitCoordinator: failed NEW admission remains transaction-coupled and leaves zero orphan identity or pending work', async () => {
  const storage = new MemoryStorageAdapter(createInitialState());
  const coordinator = new CommitCoordinator({ storage });

  const result = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ localRef: 'new:alice', name: 'Alice', identityKind: 'named' }],
    fieldProposals: {
      'new:alice': { lifeState: 'dead', present: true, mood: 'contradictory' },
    },
    pendingReviewEntries: [pending('alice-review', 'new:alice')],
    operationMode: 'one_pass',
  });

  assert.equal(result.success, false);
  const loaded = await storage.load();
  assert.equal(loaded.revision, 0);
  assert.deepEqual(loaded.state.npcs, {});
  assert.equal(loaded.state.pendingReview.entries.length, 0);
  assert.equal(loaded.state.history.checkpoints.length, 0);
});
