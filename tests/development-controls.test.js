import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSillyTavernHost } from './fixtures/host-harness.js';
import { SillyTavernStorageAdapter } from '../src/host/storage-adapter.js';
import { CommitCoordinator } from '../src/runtime/commit-coordinator.js';
import { DevelopmentReviewQueue } from '../src/host/development-queue.js';
import { createDefaultNpcRecord, createInitialState, ALPHA_NAMESPACE } from '../src/state/schema.js';
import { createCheckpoint } from '../src/state/checkpoints.js';
import { computeContentFingerprint } from '../src/host/content-hash.js';
import { stripMachineTrailer } from '../src/runtime/source-resolver.js';
import { getMessageSwipeId } from '../src/host/sillytavern-adapter.js';
import { AUDIT_OPERATIONS, OPERATION_MASKS, validateFieldOutcome } from '../src/contract/audit-modes.js';
import { WRITERS } from '../src/contract/registry.js';

function parseTargets(prompt) {
  const line = prompt.split('\n').find((value) => value.startsWith('TARGETS='));
  return line ? JSON.parse(line.slice('TARGETS='.length)) : [];
}

function noOpResponse(prompt) {
  const targets = parseTargets(prompt);
  return JSON.stringify({
    version: '1',
    reviewReceipts: targets.map((target) => ({
      targetId: target.id,
      sourceScope: target.sourceScope,
      status: 'reviewed_no_proposals',
      ...(Array.isArray(target.fieldSubset) ? { restricted: true, fieldSubset: target.fieldSubset } : {}),
    })),
    proposals: [],
    observations: [],
    supportProposals: [],
  });
}

class ScriptedProvider {
  constructor(handler = ({ prompt }) => noOpResponse(prompt)) {
    this.requiresConfiguredProfile = false;
    this.handler = handler;
    this.calls = [];
  }
  async sendReview(request) {
    this.calls.push(request);
    const value = await this.handler(request, this.calls.length);
    return typeof value === 'string' ? { text: value } : value;
  }
}

function createHarness({ ownedSourceMode = 'pending', provider = new ScriptedProvider() } = {}) {
  const host = new MockSillyTavernHost({ chatId: 'chat_s5' });
  const userText = 'Alice, tell me about your work.';
  const assistantText = 'Alice closes the ledger and says she still works in the archive.';
  host.chat.push({ is_user: true, is_system: false, mes: userText, swipe_id: 0, swipes: [userText] });
  host.chat.push({ is_user: false, is_system: false, mes: assistantText, swipe_id: 0, swipes: [assistantText], extra: {} });

  const state = createInitialState();
  const alice = createDefaultNpcRecord('alice', 'Alice');
  alice.role = 'Guide';
  alice.background = null;
  alice.speech = null;
  alice.locks.speech = true;
  state.npcs.alice = alice;

  const ownedScope = ['chat:chat_s5:0', 'chat:chat_s5:1'];
  if (ownedSourceMode === 'pending') {
    state.pendingReview.entries.push({
      id: 'pending_s5_alice',
      targetId: 'alice',
      sourceScope: ownedScope,
      exchangeId: 'chat_s5:1',
      reason: 'fast_proposal',
      createdAt: '2026-09-10T12:00:00.000Z',
      metadata: {
        userPosition: 0,
        userSwipe: getMessageSwipeId(host.chat[0]),
        userFingerprint: computeContentFingerprint(userText),
        assistantPosition: 1,
        assistantSwipe: getMessageSwipeId(host.chat[1]),
        assistantFingerprint: computeContentFingerprint(stripMachineTrailer(assistantText)),
      },
    });
  } else if (ownedSourceMode === 'receipt') {
    const userFingerprint = computeContentFingerprint(userText);
    const assistantFingerprint = computeContentFingerprint(stripMachineTrailer(assistantText));
    alice.development.reviewReceipts.push({
      targetId: 'alice',
      sourceScope: ownedScope,
      status: 'reviewed_no_proposals',
      committedAt: '2026-09-10T12:05:00.000Z',
    });
    createCheckpoint(state, {
      writer: WRITERS.DEVELOPMENT,
      mode: 'development',
      timestamp: '2026-09-10T12:05:00.000Z',
      sourceDependencies: [
        {
          sourceRef: ownedScope[0],
          writer: WRITERS.DEVELOPMENT,
          segmentKind: 'narrative',
          capturedProvenance: {
            chatId: host.chatId,
            position: 0,
            role: 'user',
            contentFingerprint: userFingerprint,
            swipe: getMessageSwipeId(host.chat[0]),
            precedingLineage: [],
          },
        },
        {
          sourceRef: ownedScope[1],
          writer: WRITERS.DEVELOPMENT,
          segmentKind: 'narrative',
          capturedProvenance: {
            chatId: host.chatId,
            position: 1,
            role: 'assistant',
            contentFingerprint: assistantFingerprint,
            swipe: getMessageSwipeId(host.chat[1]),
            precedingLineage: [userFingerprint],
          },
        },
      ],
    });
  }

  host.metadataByChatId.get(host.chatId)[ALPHA_NAMESPACE] = structuredClone(state);
  const storage = new SillyTavernStorageAdapter({ getContext: () => host.getContext() });
  const coordinator = new CommitCoordinator({ storage });
  const queue = new DevelopmentReviewQueue({
    storage,
    coordinator,
    provider,
    getContext: () => host.getContext(),
    settings: { enabled: true, developmentEnabled: true, developmentCadence: 1, developmentConnectionProfile: 'test-profile' },
  });
  return { host, storage, coordinator, queue, provider };
}

test('Development Controls: Review Pending reuses the existing S4 queue', async () => {
  const { queue, provider, storage } = createHarness();
  const result = await queue.reviewPending();
  assert.equal(result.status, 'committed');
  assert.equal(provider.calls.length, 1);
  assert.equal((await storage.load()).state.pendingReview.entries.length, 0);
});

test('Development Controls: Retry Failed resets blocked pending metadata then uses the same queue', async () => {
  const { storage, coordinator, queue, provider } = createHarness({ ownedSourceMode: 'none' });
  const userText = 'Alice, tell me about your work.';
  const assistantText = 'Alice closes the ledger and says she still works in the archive.';
  const entry = {
    id: 'pending_failed_alice',
    targetId: 'alice',
    sourceScope: ['chat:chat_s5:0', 'chat:chat_s5:1'],
    exchangeId: 'chat_s5:1',
    reason: 'fast_proposal',
    createdAt: '2026-09-10T12:00:00.000Z',
    metadata: {
      userPosition: 0,
      userSwipe: 0,
      userFingerprint: computeContentFingerprint(userText),
      assistantPosition: 1,
      assistantSwipe: 0,
      assistantFingerprint: computeContentFingerprint(assistantText),
      lastReviewStatus: 'failed',
      lastFailureCode: 'temporary_provider_failure',
    },
  };
  const add = await coordinator.commit({ writer: WRITERS.RUNTIME, pendingReviewEntries: [entry] });
  assert.equal(add.success, true, add.error);

  const result = await queue.retryFailed();
  assert.equal(result.status, 'committed');
  assert.equal(provider.calls.length, 1);
  assert.equal((await storage.load()).state.pendingReview.entries.length, 0);
});

test('Development Controls: Recheck Missing uses only target-owned source scope and excludes locks/populated fields', async () => {
  const { queue, provider } = createHarness({ ownedSourceMode: 'receipt' });
  const result = await queue.recheckMissingDetails('alice');
  assert.equal(result.targetId, 'alice');
  assert.ok(result.missingFields.includes('background'));
  assert.ok(!result.missingFields.includes('role'));
  assert.ok(!result.missingFields.includes('speech'));
  assert.equal(provider.calls.length, 1);
  for (const outcome of result.fieldOutcomes) {
    const validation = validateFieldOutcome(outcome, AUDIT_OPERATIONS.RECHECK_MISSING);
    assert.equal(validation.valid, true, validation.error);
  }
});

test('Development Controls: Refresh Dossier uses restricted canonical C12 mask and exhaustive outcomes', async () => {
  let inspectedTarget = null;
  const provider = new ScriptedProvider(({ prompt }) => {
    inspectedTarget = parseTargets(prompt)[0];
    return noOpResponse(prompt);
  });
  const { queue } = createHarness({ provider, ownedSourceMode: 'receipt' });
  const result = await queue.refreshDossier('alice');
  assert.equal(result.targetId, 'alice');
  assert.equal(result.operation, AUDIT_OPERATIONS.REFRESH_DOSSIER);
  assert.deepEqual(new Set(inspectedTarget.fieldSubset), new Set(OPERATION_MASKS[AUDIT_OPERATIONS.REFRESH_DOSSIER]));
  assert.equal(result.fieldOutcomes.length, OPERATION_MASKS[AUDIT_OPERATIONS.REFRESH_DOSSIER].length);
  const speechOutcome = result.fieldOutcomes.find((outcome) => outcome.field === 'speech');
  assert.equal(speechOutcome.outcome, 'unchanged');
  assert.match(speechOutcome.reason, /locked/i);
});

test('Development Controls: Recheck and Refresh refuse to invent scope from the latest unrelated exchange', async () => {
  const { queue, provider } = createHarness({ ownedSourceMode: 'none' });
  const recheck = await queue.recheckMissingDetails('alice');
  const refresh = await queue.refreshDossier('alice');
  assert.equal(recheck.success, false);
  assert.equal(recheck.status, 'source_unavailable');
  assert.equal(refresh.success, false);
  assert.equal(refresh.status, 'source_unavailable');
  assert.equal(provider.calls.length, 0);
});

test('S5 Development Controls: tombstoned target is reported explicitly and never dispatched', async () => {
  const { queue, provider, coordinator } = createHarness({ ownedSourceMode: 'none' });
  const deleted = await coordinator.commit({
    writer: WRITERS.USER,
    tombstoneProposals: [{ targetId: 'alice', reason: 'User deleted Alice' }],
  });
  assert.equal(deleted.success, true, deleted.error);

  const recheck = await queue.recheckMissingDetails('alice');
  const refresh = await queue.refreshDossier('alice');
  assert.equal(recheck.success, false);
  assert.equal(recheck.status, 'target_tombstoned');
  assert.equal(refresh.success, false);
  assert.equal(refresh.status, 'target_tombstoned');
  assert.equal(provider.calls.length, 0);
});

test('Development Controls: prior review receipt cannot re-own an edited historical message', async () => {
  const { host, queue, provider } = createHarness({ ownedSourceMode: 'receipt' });
  host.chat[1].mes = 'Edited later: Alice says she is a dragon hunter instead.';

  const recheck = await queue.recheckMissingDetails('alice');
  const refresh = await queue.refreshDossier('alice');
  assert.equal(recheck.success, false);
  assert.equal(recheck.status, 'source_unavailable');
  assert.equal(refresh.success, false);
  assert.equal(refresh.status, 'source_unavailable');
  assert.equal(provider.calls.length, 0, 'Edited historical evidence must never be re-fingerprinted into ownership.');
});

test('Development Controls: manual operations fail visibly while another Development request is in flight', async () => {
  let releaseFirst;
  const provider = new ScriptedProvider(({ prompt }, callNumber) => {
    if (callNumber === 1) {
      return new Promise((resolve) => {
        releaseFirst = () => resolve(noOpResponse(prompt));
      });
    }
    return noOpResponse(prompt);
  });
  const { queue, storage } = createHarness({ provider, ownedSourceMode: 'pending' });

  const first = queue.reviewPending();
  while (provider.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));

  const busyReview = await queue.reviewPending();
  assert.equal(busyReview.success, false);
  assert.equal(busyReview.status, 'already_in_flight');
  assert.equal(busyReview.reason, 'development_already_in_flight');

  const busyRecheck = await queue.recheckMissingDetails('alice');
  assert.equal(busyRecheck.success, false);
  assert.equal(busyRecheck.status, 'already_in_flight');
  assert.equal(busyRecheck.reason, 'development_already_in_flight');
  assert.equal(provider.calls.length, 1, 'Manual actions must not create or silently queue a second provider request.');

  releaseFirst();
  await first;
  await queue.waitForIdle();
  assert.equal(provider.calls.length, 1);
  assert.equal((await storage.load()).state.pendingReview.entries.length, 0);
});
