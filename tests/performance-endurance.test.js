import test from 'node:test';
import assert from 'node:assert/strict';

import { stripMachineTrailer } from '../src/runtime/source-resolver.js';
import { computeContentFingerprint } from '../src/host/content-hash.js';
import {
  SillyTavernAdapter,
  buildChatFingerprintIndex,
  buildPrecedingLineage,
  detectCommittedBranchDivergence,
  lineageMatchesFingerprintIndex,
  getMessageSwipeId,
} from '../src/host/sillytavern-adapter.js';
import {
  analyzeStoryHistory,
  captureStoryHistoryBoundary,
} from '../src/host/history-recovery.js';
import {
  IMPORT_BASELINE_MODE,
  MAX_STORY_CHECKPOINTS,
  createCheckpoint,
  resetCheckpointCounterForTesting,
} from '../src/state/checkpoints.js';
import { createDefaultNpcRecord, createInitialState, validateState } from '../src/state/schema.js';
import { MemoryStorageAdapter } from '../src/state/storage.js';
import { CommitCoordinator } from '../src/runtime/commit-coordinator.js';
import { WRITERS } from '../src/contract/registry.js';
import { DiagnosticsLedger } from '../src/host/diagnostics.js';
import { DevelopmentReviewQueue } from '../src/host/development-queue.js';
import { MockSillyTavernHost } from './fixtures/host-harness.js';

const OPEN = '<npc_state_alpha_v1>';
const CLOSE = '</npc_state_alpha_v1>';

function trailer(narrative, proposals = []) {
  return `${narrative}\n\n${OPEN}\n${JSON.stringify({ version: '1', proposals })}\n${CLOSE}`;
}

function referenceLineage(chat, targetIndex) {
  const lineage = [];
  for (let index = 0; index < targetIndex; index++) {
    const message = chat[index];
    if (!message || typeof message.mes !== 'string') continue;
    const canonical = (!message.is_user && !message.is_system)
      ? stripMachineTrailer(message.mes)
      : message.mes;
    const fingerprint = computeContentFingerprint(canonical);
    if (fingerprint) lineage.push(fingerprint);
  }
  return lineage;
}

function makeHistoryChat(exchangeCount) {
  const chat = [];
  for (let index = 0; index < exchangeCount; index++) {
    chat.push({ is_user: true, is_system: false, mes: `User ${index}`, swipe_id: 0 });
    chat.push({ is_user: false, is_system: false, mes: trailer(`Assistant ${index}`), swipe_id: 0, swipes: [] });
  }
  return chat;
}

const historyHelpers = {
  buildPrecedingLineage,
  buildChatFingerprintIndex,
  lineageMatchesFingerprintIndex,
  getMessageSwipeId,
};

test('S9 lineage index preserves exact canonical lineage semantics across valid, malformed, and system messages', () => {
  const chat = [
    { is_user: true, is_system: false, mes: 'User opening.' },
    { is_user: false, is_system: false, mes: trailer('Valid assistant narrative.') },
    { is_user: false, is_system: true, mes: '<npc_state_alpha_v1>{not transport}</npc_state_alpha_v1>' },
    { is_user: false, is_system: false, mes: 'Malformed assistant transport\n<npc_state_alpha_v1>{broken' },
    { is_user: true, is_system: false, mes: 'Current user.' },
  ];
  const index = buildChatFingerprintIndex(chat);
  for (let target = 0; target <= chat.length; target++) {
    const expected = referenceLineage(chat, target);
    assert.deepEqual(buildPrecedingLineage(chat, target), expected);
    assert.deepEqual(buildPrecedingLineage(chat, target, index), expected);
    assert.equal(lineageMatchesFingerprintIndex(index, target, expected), true);
    if (expected.length > 0) {
      const altered = [...expected];
      altered[altered.length - 1] = 'sha256:deadbeef';
      assert.equal(lineageMatchesFingerprintIndex(index, target, altered), false);
    }
  }
});

test('S9 indexed and compatibility branch-divergence paths return identical exact results', () => {
  const chatId = 's9_divergence_equivalence';
  const chat = makeHistoryChat(24);
  const state = createInitialState();
  state.npcs.alice = createDefaultNpcRecord('alice', 'Alice');
  resetCheckpointCounterForTesting();
  for (let exchange = 0; exchange < 24; exchange++) {
    const position = exchange * 2 + 1;
    state.revision = exchange + 1;
    const boundary = captureStoryHistoryBoundary(chat, chatId, position, historyHelpers);
    createCheckpoint(state, {
      checkpointId: `equiv_${exchange}`,
      writer: 'one_pass',
      historyBoundary: boundary,
      sourceDependencies: [{
        sourceRef: `chat:${chatId}:${position}`,
        writer: 'one_pass',
        segmentKind: 'narrative',
        capturedProvenance: boundary,
      }],
    });
  }
  const index = buildChatFingerprintIndex(chat);
  assert.equal(detectCommittedBranchDivergence(state, chat), null);
  assert.equal(detectCommittedBranchDivergence(state, chat, { fingerprintIndex: index }), null);

  chat[20].mes = 'Edited user 10';
  const ordinary = detectCommittedBranchDivergence(state, chat);
  const indexed = detectCommittedBranchDivergence(state, chat, { fingerprintIndex: buildChatFingerprintIndex(chat) });
  assert.deepEqual(indexed, ordinary);
  assert.equal(ordinary?.reason, 'committed_source_preceding_lineage_changed');
});

test('S9 checkpoint compaction keeps 32 full snapshots with protected base/import, historical anchors, and dense recent suffix', () => {
  assert.equal(MAX_STORY_CHECKPOINTS, 32);
  const state = createInitialState();
  state.npcs.alice = createDefaultNpcRecord('alice', 'Alice');
  resetCheckpointCounterForTesting();
  for (let index = 0; index < 96; index++) {
    state.revision = index + 1;
    createCheckpoint(state, {
      checkpointId: `perf_${index}`,
      writer: 'runtime',
      mode: index === 0 ? 'explicit_baseline' : (index === 20 ? IMPORT_BASELINE_MODE : 'test_commit'),
      timestamp: new Date(Date.UTC(2026, 8, 1, 0, index % 60, 0)).toISOString(),
    });
  }
  assert.equal(state.history.checkpoints.length, MAX_STORY_CHECKPOINTS);
  const ids = state.history.checkpoints.map((checkpoint) => Number(checkpoint.id.split('_').at(-1)));
  assert.equal(ids[0], 0);
  assert.ok(ids.includes(20), 'earliest import baseline must remain protected');
  assert.equal(ids.at(-1), 95);
  assert.deepEqual(ids.slice(-16), Array.from({ length: 16 }, (_, offset) => 80 + offset));
  const olderAnchors = ids.filter((index) => index > 0 && index < 80 && index !== 20);
  assert.ok(olderAnchors.length >= 10, 'older full-snapshot recovery anchors must remain available');
  assert.equal(ids.every((value, index) => index === 0 || value > ids[index - 1]), true);
  assert.equal(validateState(state).valid, true);
});

test('S9 compacted checkpoint history still selects a non-root safe anchor for an older history edit', () => {
  const chatId = 's9_anchor_recovery';
  const exchangeCount = 80;
  const chat = makeHistoryChat(exchangeCount);
  const state = createInitialState();
  state.npcs.alice = createDefaultNpcRecord('alice', 'Alice');
  resetCheckpointCounterForTesting();
  for (let exchange = 0; exchange < exchangeCount; exchange++) {
    const position = exchange * 2 + 1;
    state.revision = exchange + 1;
    const boundary = captureStoryHistoryBoundary(chat, chatId, position, historyHelpers);
    createCheckpoint(state, {
      checkpointId: `anchor_${exchange}`,
      writer: 'one_pass',
      historyBoundary: boundary,
      sourceDependencies: [{
        sourceRef: `chat:${chatId}:${position}`,
        writer: 'one_pass',
        segmentKind: 'narrative',
        capturedProvenance: boundary,
      }],
    });
  }
  assert.equal(state.history.checkpoints.length, MAX_STORY_CHECKPOINTS);
  chat[70].mes = 'Edited user exchange 35';
  const analysis = analyzeStoryHistory(state, chat, chatId, historyHelpers);
  assert.equal(analysis.valid, true);
  assert.equal(analysis.divergent, true);
  assert.ok(analysis.safeCheckpointIndex > 0, 'an older edit should retain a useful safe anchor instead of falling to root');
  assert.ok(analysis.safeBoundaryPosition >= 1);
  assert.ok(analysis.safeBoundaryPosition < 70);
});

test('S9 checkpoint compaction preserves stable identity when reconstruction starts before an old admission', async () => {
  const host = new MockSillyTavernHost({ chatId: 's9_compacted_identity_replay' });
  host.interceptorKey = 's9_compacted_identity_replay_interceptor';
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey: host.interceptorKey });
  assert.equal(adapter.initialize(), true);

  let aliceId = null;
  let admissionCheckpointId = null;
  for (let exchange = 0; exchange < 60; exchange++) {
    host.sendUserMessage(`Identity endurance user ${exchange}.`);
    await host.triggerGenerateInterceptor('normal');
    if (exchange === 10) {
      await host.receiveAssistantMessage(trailer('Alice enters the archive.', [{
        id: null,
        localRef: 'new:alice',
        name: 'Alice',
        identityKind: 'named',
        evidence: { sourceRef: 'current:assistant', excerpt: 'Alice enters' },
        present: true,
        activeInExchange: false,
        source: { sourceRef: 'current:assistant', excerpt: 'Alice enters' },
      }]));
      const admitted = await adapter.storage.load();
      aliceId = Object.values(admitted.state.npcs).find((npc) => npc.name === 'Alice')?.id || null;
      admissionCheckpointId = admitted.state.history.checkpoints.at(-1)?.id || null;
      assert.ok(aliceId);
      assert.ok(admissionCheckpointId);
    } else if (exchange > 10) {
      await host.receiveAssistantMessage(trailer(`Alice reports routine archive duty ${exchange}.`, [{
        id: aliceId,
        present: true,
        activeInExchange: false,
        status: `archive duty ${exchange}`,
        source: { sourceRef: 'current:assistant', excerpt: 'Alice reports' },
      }]));
    } else {
      await host.receiveAssistantMessage(trailer(`The archive remains quiet at exchange ${exchange}.`, []));
    }
  }

  const before = await adapter.storage.load();
  assert.equal(before.state.history.checkpoints.length, MAX_STORY_CHECKPOINTS);
  assert.equal(
    before.state.history.checkpoints.some((checkpoint) => checkpoint.id === admissionCheckpointId),
    false,
    'the original full admission checkpoint should have been compacted away for this regression to be meaningful',
  );
  const carriedAliceAssignments = before.state.history.checkpoints
    .flatMap((checkpoint) => checkpoint.identityAssignments || [])
    .filter((assignment) => assignment.assignedId === aliceId);
  assert.equal(carriedAliceAssignments.length, 1, 'compaction must retain exactly one source-bound identity replay assignment');

  await host.editMessage(8, 'Identity endurance user 4, edited before Alice was admitted.');
  const after = await adapter.storage.load();
  const alices = Object.values(after.state.npcs).filter((npc) => npc.name === 'Alice');
  assert.equal(alices.length, 1);
  assert.equal(alices[0].id, aliceId, 'recovery must preserve the stable ID even when the admission checkpoint itself was compacted');
  assert.equal(validateState(after.state).valid, true);
  adapter.destroy();
});

test('S9 adapter listener lifecycle remains bounded across repeated initialization and disposal', async () => {
  const host = new MockSillyTavernHost({ chatId: 's9_listener_endurance' });
  const eventNames = Object.values(host.eventTypes);
  for (let iteration = 0; iteration < 50; iteration++) {
    host.interceptorKey = `s9_listener_${iteration}`;
    const adapter = new SillyTavernAdapter({
      getContext: () => host.getContext(),
      interceptorKey: host.interceptorKey,
    });
    assert.equal(adapter.initialize(), true);
    const attached = eventNames.reduce((sum, eventName) => sum + (host.eventSource._listeners.get(eventName)?.length || 0), 0);
    assert.ok(attached > 0);
    adapter.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    const remaining = eventNames.reduce((sum, eventName) => sum + (host.eventSource._listeners.get(eventName)?.length || 0), 0);
    assert.equal(remaining, 0, `listener leak after lifecycle ${iteration}`);
    assert.equal(globalThis[host.interceptorKey], undefined);
  }
});

test('S9 diagnostics ledger remains bounded under sustained failure-style event recording', () => {
  const diagnostics = new DiagnosticsLedger({ capacity: 100 });
  for (let index = 0; index < 1000; index++) {
    diagnostics.record({ type: 's9_failure_probe', reason: `bounded-${index}` });
  }
  const entries = diagnostics.getEntries();
  assert.equal(entries.length, 100);
  assert.equal(entries[0].reason, 'bounded-900');
  assert.equal(entries.at(-1).reason, 'bounded-999');
});

test('S9 ephemeral history replay capture skips only temporary checkpoints and cannot be used by normal commits', async () => {
  const initial = createInitialState();
  initial.npcs.alice = createDefaultNpcRecord('alice', 'Alice', { mood: 'calm' });
  const storage = new MemoryStorageAdapter(initial);
  const coordinator = new CommitCoordinator({ storage });

  const forbidden = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: 'alice' }],
    fieldProposals: { alice: { mood: 'alert' } },
    ephemeralHistoryReplay: true,
    operationMode: 'one_pass',
  });
  assert.equal(forbidden.success, false);
  assert.equal(forbidden.errorCode, 'ephemeral_history_replay_wrong_mode');
  assert.equal((await storage.load()).state.npcs.alice.mood, 'calm');

  const replay = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: 'alice' }],
    fieldProposals: { alice: { mood: 'alert' } },
    ephemeralHistoryReplay: true,
    operationMode: 'history_replay',
  });
  assert.equal(replay.success, true, replay.error);
  assert.equal(replay.checkpointId, null);
  assert.deepEqual(replay.historyCapture, { sourceDependencies: [], identityAssignments: [] });
  const loaded = await storage.load();
  assert.equal(loaded.state.npcs.alice.mood, 'alert');
  assert.equal(loaded.state.history.checkpoints.length, 0);
  assert.equal(validateState(loaded.state).valid, true);
});

test('S9 replay storage optimization preserves ordinary copy isolation and persistence-failure atomicity', async () => {
  const initial = createInitialState();
  initial.npcs.alice = createDefaultNpcRecord('alice', 'Alice', { mood: 'calm' });

  const ordinary = new MemoryStorageAdapter(initial);
  const ordinaryLoaded = await ordinary.load();
  ordinaryLoaded.state.npcs.alice.mood = 'mutated-outside-storage';
  assert.equal((await ordinary.load()).state.npcs.alice.mood, 'calm');

  const replayStorage = new MemoryStorageAdapter(initial, { ephemeralReplay: true });
  const coordinator = new CommitCoordinator({ storage: replayStorage });
  replayStorage.setFailNextSave();
  const failed = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: 'alice' }],
    fieldProposals: { alice: { mood: 'alert' } },
    operationMode: 'history_replay',
    ephemeralHistoryReplay: true,
  });
  assert.equal(failed.success, false);
  assert.equal((await replayStorage.load()).state.npcs.alice.mood, 'calm');
  assert.equal((await replayStorage.load()).state.history.checkpoints.length, 0);

  const retry = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    identityProposals: [{ id: 'alice' }],
    fieldProposals: { alice: { mood: 'alert' } },
    operationMode: 'history_replay',
    ephemeralHistoryReplay: true,
  });
  assert.equal(retry.success, true, retry.error);
  const recovered = await replayStorage.load();
  assert.equal(recovered.state.npcs.alice.mood, 'alert');
  assert.equal(recovered.state.history.checkpoints.length, 0);
  assert.equal(validateState(recovered.state).valid, true);
});

test('S9 reconstruction keeps surviving C08 support bound to a string field-revision token', async () => {
  const initial = createInitialState();
  const alice = createDefaultNpcRecord('alice', 'Alice', { background: 'Veteran courier', mood: 'calm' });
  alice.fieldRevisions.background = 5;
  alice.development.acceptedSupport = [{
    targetId: 'alice',
    field: 'background',
    fieldRevision: '5',
    sourceRefs: ['synthetic:support:alice'],
    notes: 'Durable background support survives an unrelated later branch recovery.',
  }];
  initial.npcs.alice = alice;
  assert.equal(validateState(initial).valid, true);

  const storage = new MemoryStorageAdapter(initial);
  const coordinator = new CommitCoordinator({ storage });
  const reconstructed = structuredClone(initial);
  reconstructed.npcs.alice.mood = 'alert';
  reconstructed.npcs.alice.fieldRevisions.mood = 2;

  const result = await coordinator.commitReconstruction({
    reconstructedState: reconstructed,
    expectedRevision: 0,
    reason: 'S9 surviving support reconstruction regression',
  });
  assert.equal(result.success, true, result.error);
  const loaded = await storage.load();
  const support = loaded.state.npcs.alice.development.acceptedSupport[0];
  assert.equal(typeof support.fieldRevision, 'string');
  assert.equal(support.fieldRevision, String(loaded.state.npcs.alice.fieldRevisions.background));
  assert.equal(validateState(loaded.state).valid, true);
});

test('S9 repeated Development failure stays blocked without automatic retry storm', async () => {
  const chatId = 's9_failure_endurance';
  const chat = [
    { is_user: true, is_system: false, mes: 'Tell me about your work.', swipe_id: 0 },
    { is_user: false, is_system: false, mes: 'Alice says she serves as a courier.', swipe_id: 0, swipes: ['Alice says she serves as a courier.'], extra: {} },
  ];
  const state = createInitialState();
  state.npcs.alice = createDefaultNpcRecord('alice', 'Alice');
  state.pendingReview.entries = [{
    id: 'pending_s9_failure',
    targetId: 'alice',
    sourceScope: [`chat:${chatId}:0`, `chat:${chatId}:1`],
    exchangeId: `${chatId}:1`,
    reason: 'new_admission',
    createdAt: '2026-09-11T00:00:00.000Z',
    metadata: {
      userPosition: 0,
      userSwipe: 0,
      assistantPosition: 1,
      assistantSwipe: 0,
      userFingerprint: computeContentFingerprint(chat[0].mes),
      assistantFingerprint: computeContentFingerprint(chat[1].mes),
    },
  }];
  class ChatMemoryStorage extends MemoryStorageAdapter {
    getChatId() { return chatId; }
  }
  const storage = new ChatMemoryStorage(state);
  const coordinator = new CommitCoordinator({ storage });
  let providerCalls = 0;
  const provider = {
    requiresConfiguredProfile: false,
    async sendReview() {
      providerCalls++;
      throw Object.assign(new Error('bounded synthetic provider failure'), { code: 's9_provider_failure' });
    },
  };
  const queue = new DevelopmentReviewQueue({
    storage,
    coordinator,
    getContext: () => ({ chatId, chat }),
    provider,
    settings: { enabled: true, developmentEnabled: true, developmentCadence: 1 },
  });

  const first = await queue.trigger('s9_failure');
  assert.equal(first.status, 'provider_failed');
  assert.equal(providerCalls, 1);
  const failedRevision = (await storage.load()).revision;
  for (let index = 0; index < 25; index++) {
    const retry = await queue.trigger(`automatic_${index}`);
    assert.equal(retry.status, 'idle');
  }
  assert.equal(providerCalls, 1, 'blocked failed work must not automatically redispatch');
  assert.equal((await storage.load()).revision, failedRevision, 'idle retries must not persist state');
  assert.equal(queue.inFlightByChat.size, 0);
  assert.equal(queue.coalescedByChat.size, 0);
  queue.destroy();
});

test('S9 Immediate malformed/duplicate endurance avoids persistence churn', async () => {
  const host = new MockSillyTavernHost({ chatId: 's9_persistence_endurance' });
  host.interceptorKey = 's9_persistence_endurance_interceptor';
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey: host.interceptorKey });
  assert.equal(adapter.initialize(), true);

  host.sendUserMessage('Alice and Bob arrive.');
  await host.triggerGenerateInterceptor('normal');
  const accepted = await host.receiveAssistantMessage(trailer('Alice arrives beside Bob.', [
    {
      id: null,
      localRef: 'new:alice',
      name: 'Alice',
      identityKind: 'named',
      evidence: { sourceRef: 'current:assistant', excerpt: 'Alice arrives' },
      present: true,
      activeInExchange: false,
      source: { sourceRef: 'current:assistant', excerpt: 'Alice arrives' },
    },
    {
      id: null,
      localRef: 'new:bob',
      name: 'Bob',
      identityKind: 'named',
      evidence: { sourceRef: 'current:assistant', excerpt: 'Bob' },
      present: true,
      activeInExchange: false,
      source: { sourceRef: 'current:assistant', excerpt: 'Bob' },
    },
  ]));
  const savesAfterCommit = host.checkedSaveCalls.length;
  assert.equal(savesAfterCommit, 1, 'one logical multi-NPC Immediate commit should persist once');

  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, accepted, 'normal');
  assert.equal(host.checkedSaveCalls.length, savesAfterCommit, 'duplicate finalized event must not persist');

  for (let index = 0; index < 20; index++) {
    host.sendUserMessage(`Malformed endurance turn ${index}.`);
    await host.triggerGenerateInterceptor('normal');
    await host.receiveAssistantMessage(`Malformed assistant ${index} with no Alpha trailer.`);
  }
  assert.equal(host.checkedSaveCalls.length, savesAfterCommit, 'malformed trailers must not cause persistence writes');
  assert.ok(adapter.diagnostics.getEntries().length <= adapter.diagnostics.capacity);
  adapter.destroy();
});
