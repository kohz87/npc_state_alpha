import test from 'node:test';
import assert from 'node:assert/strict';

import { WRITERS } from '../src/contract/registry.js';
import {
  IMPORT_BASELINE_MODE,
  MAX_STORY_CHECKPOINTS,
  createCheckpoint,
  validateCheckpoint,
} from '../src/state/checkpoints.js';
import {
  cloneState,
  createDefaultNpcRecord,
  createInitialState,
  validateState,
} from '../src/state/schema.js';
import { MemoryStorageAdapter } from '../src/state/storage.js';
import { CommitCoordinator } from '../src/runtime/commit-coordinator.js';
import {
  deleteNpc,
  setFieldLock,
  setImportance,
  setPortrait,
  updateNpcField,
} from '../src/runtime/user-commands.js';
import {
  SillyTavernAdapter,
  buildPrecedingLineage,
  getMessageSwipeId,
} from '../src/host/sillytavern-adapter.js';
import {
  StoryHistoryRecovery,
  analyzeStoryHistory,
  captureStoryHistoryBoundary,
} from '../src/host/history-recovery.js';
import { MockSillyTavernHost } from './fixtures/host-harness.js';

const OPEN = '<npc_state_alpha_v1>';
const CLOSE = '</npc_state_alpha_v1>';

function trailer(narrative, proposals) {
  return `${narrative}\n\n${OPEN}\n${JSON.stringify({ version: '1', proposals }, null, 2)}\n${CLOSE}`;
}

function evidence(excerpt) {
  return { sourceRef: 'current:assistant', excerpt };
}

function newcomer(name, excerpt, extra = {}) {
  return {
    id: null,
    localRef: `new:${name.toLowerCase()}`,
    name,
    identityKind: 'named',
    evidence: evidence(excerpt),
    present: true,
    activeInExchange: false,
    ...extra,
  };
}

function update(id, excerpt, fields = {}) {
  return {
    id,
    source: evidence(excerpt),
    presenceSource: evidence(excerpt),
    present: true,
    activeInExchange: false,
    ...fields,
  };
}

function relationshipUpdate(id, excerpt, changedAxes) {
  const axes = { trust: 0, affection: 0, desire: 0, tension: 0, ...changedAxes };
  const axisSupport = {};
  for (const [axis, delta] of Object.entries(axes)) {
    if (delta === 0) continue;
    axisSupport[axis] = {
      reason: `${axis} changed in this exchange`,
      source: evidence(excerpt),
    };
  }
  return update(id, excerpt, {
    activeInExchange: true,
    relationshipEvaluation: {
      shifted: true,
      axes,
      impact: 'moderate',
      axisSupport,
    },
  });
}

async function harness(chatId) {
  const host = new MockSillyTavernHost({ chatId });
  host.interceptorKey = `s6_${chatId}`;
  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey: host.interceptorKey,
  });
  assert.equal(adapter.initialize(), true);
  return { host, adapter };
}

async function turn(host, userText, assistantText, options = {}) {
  host.sendUserMessage(userText);
  await host.triggerGenerateInterceptor(options.type || 'normal');
  return host.receiveAssistantMessage(assistantText, options);
}

function findByName(state, name) {
  return Object.values(state.npcs).find((npc) => npc.name === name);
}

const historyHelpers = { buildPrecedingLineage, getMessageSwipeId };

test('S6 checkpoints persist exact story boundary, identity assignment, and reload coherently', async () => {
  const { host, adapter } = await harness('history_checkpoint');
  await turn(
    host,
    'Who approaches?',
    trailer('Alice approached the gate.', [
      newcomer('Alice', 'Alice approached', { mood: 'calm', location: 'North Gate' }),
    ]),
  );

  const first = await adapter.storage.load();
  assert.equal(first.revision, 1);
  assert.equal(first.state.history.checkpoints.length, 1);
  const checkpoint = first.state.history.checkpoints[0];
  assert.equal(checkpoint.commitRevision, 1);
  assert.equal(checkpoint.historyBoundary.chatId, 'history_checkpoint');
  assert.equal(checkpoint.historyBoundary.position, 1);
  assert.equal(checkpoint.historyBoundary.role, 'assistant');
  assert.equal(checkpoint.historyBoundary.swipe, 0);
  assert.equal(checkpoint.identityAssignments.length, 1);
  assert.equal(checkpoint.identityAssignments[0].localRef, 'new:alice');
  assert.equal(typeof checkpoint.identityAssignments[0].identityKey, 'string');
  assert.equal(validateCheckpoint(checkpoint).valid, true);
  assert.equal(validateState(first.state).valid, true);

  const aliceId = findByName(first.state, 'Alice').id;
  adapter.destroy();

  const reloaded = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey: host.interceptorKey,
  });
  assert.equal(reloaded.initialize(), true);
  const second = await reloaded.storage.load();
  assert.equal(findByName(second.state, 'Alice').id, aliceId);
  assert.equal(second.state.history.checkpoints[0].historyBoundary.contentFingerprint, checkpoint.historyBoundary.contentFingerprint);
  reloaded.destroy();
});

test('S6 exact divergence analysis rejects changed content/swipe and accepts canonical history', async () => {
  const { host, adapter } = await harness('history_analysis');
  const position = await turn(
    host,
    'Who waits here?',
    trailer('Mira waited beside the bridge.', [newcomer('Mira', 'Mira waited')]),
    { swipeId: 0 },
  );
  const loaded = await adapter.storage.load();

  const canonical = analyzeStoryHistory(loaded.state, host.chat, host.chatId, historyHelpers);
  assert.equal(canonical.valid, true);
  assert.equal(canonical.divergent, false);

  host.chat[position].swipe_id = 1;
  const changedSwipe = analyzeStoryHistory(loaded.state, host.chat, host.chatId, historyHelpers);
  assert.equal(changedSwipe.divergent, true);
  assert.equal(changedSwipe.divergence.position, position);

  host.chat[position].swipe_id = 0;
  host.chat[position].mes = trailer('Mira left the bridge.', []);
  const changedRevision = analyzeStoryHistory(loaded.state, host.chat, host.chatId, historyHelpers);
  assert.equal(changedRevision.divergent, true);
  adapter.destroy();
});

test('S6 irrelevant earlier edit preserves canonical state/identity and duplicate notifications are idempotent', async () => {
  const { host, adapter } = await harness('history_irrelevant_edit');
  await turn(
    host,
    'Is Alice calm?',
    trailer('Alice nodded calmly.', [newcomer('Alice', 'Alice nodded', { mood: 'calm' })]),
  );
  const before = await adapter.storage.load();
  const aliceId = findByName(before.state, 'Alice').id;

  await host.editMessage(0, 'Is Alice still calm?');
  const recovered = await adapter.storage.load();
  assert.ok(recovered.revision > before.revision);
  assert.equal(findByName(recovered.state, 'Alice').id, aliceId);
  assert.equal(findByName(recovered.state, 'Alice').mood, 'calm');
  assert.ok(adapter.diagnostics.entries.some((entry) => entry.type === 'history_recovery_committed'));

  const stableRevision = recovered.revision;
  await host.eventSource.emit(host.eventTypes.MESSAGE_UPDATED, 0);
  const duplicate = await adapter.storage.load();
  assert.equal(duplicate.revision, stableRevision);
  assert.equal(adapter.historyRecovery.getStatus(host.chatId).status, 'no_change');
  adapter.destroy();
});

test('S6 edit reconstruction recomputes live/relationship state while preserving an unrelated NPC', async () => {
  const { host, adapter } = await harness('history_edit_multi');
  await turn(
    host,
    'Alice, report.',
    trailer('Alice reported for duty.', [newcomer('Alice', 'Alice reported', { mood: 'steady' })]),
  );
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;

  const aliceUpdatePosition = await turn(
    host,
    'Alice, I trust you.',
    trailer('Alice smiled at the vote of confidence.', [
      relationshipUpdate(aliceId, 'Alice smiled', { affection: 1 }),
    ]),
  );
  await turn(
    host,
    'Who else is here?',
    trailer('Bob entered the room.', [newcomer('Bob', 'Bob entered', { mood: 'alert' })]),
  );
  state = (await adapter.storage.load()).state;
  const bobId = findByName(state, 'Bob').id;
  assert.equal(state.npcs[aliceId].relationship.affection, 1);

  await host.editMessage(
    aliceUpdatePosition,
    trailer('Alice frowned at the accusation.', [
      update(aliceId, 'Alice frowned', { mood: 'angry' }),
    ]),
  );
  const rebuilt = (await adapter.storage.load()).state;
  assert.equal(rebuilt.npcs[aliceId].mood, 'angry');
  assert.equal(rebuilt.npcs[aliceId].relationship.affection, 0);
  assert.equal(findByName(rebuilt, 'Bob').id, bobId);
  assert.equal(findByName(rebuilt, 'Bob').mood, 'alert');
  assert.equal(Object.keys(rebuilt.npcs).length, 2);
  adapter.destroy();
});

test('S6 partial multi-NPC message edit preserves exact unchanged identities without proposal-order fallback', async () => {
  const { host, adapter } = await harness('history_partial_multi_identity');
  const position = await turn(
    host,
    'Who is in the courtyard?',
    trailer('Alice watched the gate while Bob studied the map.', [
      newcomer('Alice', 'Alice watched', { mood: 'calm', aliases: ['Captain Alice'] }),
      newcomer('Bob', 'Bob studied', { mood: 'focused' }),
    ]),
    { swipeId: 0 },
  );
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;
  const bobId = findByName(state, 'Bob').id;

  await host.editMessage(
    position,
    trailer('Alice paced by the gate while Bob studied the map.', [
      newcomer('Alice', 'Alice paced', { mood: 'worried', aliases: ['Captain Alice'] }),
      newcomer('Bob', 'Bob studied', { mood: 'focused' }),
    ]),
  );

  state = (await adapter.storage.load()).state;
  assert.equal(findByName(state, 'Alice').id, aliceId);
  assert.equal(findByName(state, 'Alice').mood, 'worried');
  assert.equal(findByName(state, 'Bob').id, bobId);
  assert.equal(findByName(state, 'Bob').mood, 'focused');
  assert.equal(Object.keys(state.npcs).length, 2);
  adapter.destroy();
});

test('S6 deleting one cumulative relationship event removes only that event and retains the later axis event', async () => {
  const { host, adapter } = await harness('history_delete_relationship');
  await turn(
    host,
    'Alice arrives.',
    trailer('Alice took a seat.', [newcomer('Alice', 'Alice took a seat')]),
  );
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;

  const affectionPosition = await turn(
    host,
    'I brought your favorite tea.',
    trailer('Alice accepted the tea with a warm smile.', [
      relationshipUpdate(aliceId, 'warm smile', { affection: 1 }),
    ]),
  );
  await turn(
    host,
    'The plan worked exactly as promised.',
    trailer('Alice acknowledged the reliable plan.', [
      relationshipUpdate(aliceId, 'reliable plan', { trust: 1 }),
    ]),
  );

  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[aliceId].relationship.affection, 1);
  assert.equal(state.npcs[aliceId].relationship.trust, 1);
  await host.deleteMessage(affectionPosition);

  const rebuilt = (await adapter.storage.load()).state;
  assert.equal(rebuilt.npcs[aliceId].relationship.affection, 0);
  assert.equal(rebuilt.npcs[aliceId].relationship.trust, 1);
  assert.equal(rebuilt.npcs[aliceId].relationship.scoringHistory.length, 1);
  assert.equal(rebuilt.dedup.processedSourceKeys.length, 2);
  adapter.destroy();
});

test('S6 relationship recovery restores fractional progress and milestones while retaining a later independent axis', async () => {
  const { host, adapter } = await harness('history_relationship_fractional');
  await turn(
    host,
    'Alice arrives.',
    trailer('Alice joined the table.', [newcomer('Alice', 'Alice joined')]),
  );
  const aliceId = findByName((await adapter.storage.load()).state, 'Alice').id;
  await turn(
    host,
    'I remembered the smallest detail.',
    trailer('Alice gave a small appreciative smile.', [
      relationshipUpdate(aliceId, 'appreciative smile', { affection: 0.5 }),
    ]),
  );
  const milestonePosition = await turn(
    host,
    'I kept every promise.',
    trailer('Alice warmly embraced the trusted pact.', [
      relationshipUpdate(aliceId, 'warmly embraced', { affection: 30 }),
    ]),
  );
  await turn(
    host,
    'The sealed records are safe.',
    trailer('Alice entrusted the sealed records to me.', [
      relationshipUpdate(aliceId, 'entrusted the sealed records', { trust: 30 }),
    ]),
  );

  let relationship = (await adapter.storage.load()).state.npcs[aliceId].relationship;
  assert.ok(relationship.affection > 25);
  assert.ok(relationship.milestones.includes('affection:warm'));
  assert.equal(relationship.trust, 30);
  assert.equal(relationship.progress.affection > 0, true);

  await host.deleteMessage(milestonePosition);
  relationship = (await adapter.storage.load()).state.npcs[aliceId].relationship;
  assert.equal(relationship.affection, 0.5);
  assert.equal(relationship.progress.affection, 0.5);
  assert.ok(relationship.milestones.includes('affection:neutral'));
  assert.equal(relationship.trust, 30);
  assert.ok(relationship.milestones.includes('trust:receptive'));
  assert.equal(relationship.scoringHistory.length, 2);
  adapter.destroy();
});

test('S6 edit/delete death correction restores living state without enabling narrative resurrection', async () => {
  const { host, adapter } = await harness('history_death_edit_delete');
  await turn(
    host,
    'Guard, take your post.',
    trailer('The guard stood watch.', [newcomer('Guard', 'guard stood', { mood: 'alert' })]),
  );
  const guardId = findByName((await adapter.storage.load()).state, 'Guard').id;
  const deathPosition = await turn(
    host,
    'What happened?',
    trailer('The guard died beneath the collapsing arch.', [
      {
        ...update(guardId, 'guard died'),
        present: false,
        activeInExchange: false,
        lifecycle: { lifeState: 'dead', source: evidence('guard died') },
      },
    ]),
  );
  assert.equal((await adapter.storage.load()).state.npcs[guardId].lifeState, 'dead');

  await host.editMessage(
    deathPosition,
    trailer('The guard escaped the collapsing arch.', [
      update(guardId, 'guard escaped', { mood: 'shaken' }),
    ]),
  );
  let guard = (await adapter.storage.load()).state.npcs[guardId];
  assert.equal(guard.lifeState, 'alive');
  assert.equal(guard.mood, 'shaken');

  await host.editMessage(
    deathPosition,
    trailer('The guard died beneath the collapsing arch.', [
      {
        ...update(guardId, 'guard died'),
        present: false,
        activeInExchange: false,
        lifecycle: { lifeState: 'dead', source: evidence('guard died') },
      },
    ]),
  );
  assert.equal((await adapter.storage.load()).state.npcs[guardId].lifeState, 'dead');

  await host.deleteMessage(deathPosition);
  guard = (await adapter.storage.load()).state.npcs[guardId];
  assert.equal(guard.lifeState, 'alive');
  assert.equal(guard.present, true);
  adapter.destroy();
});

test('S6 swipe reconstruction removes death evidence, can select it again, and never permits forward resurrection', async () => {
  const { host, adapter } = await harness('history_death_swipe');
  await turn(
    host,
    'Guard, identify yourself.',
    trailer('The guard saluted.', [newcomer('Guard', 'guard saluted', { mood: 'alert' })]),
  );
  let state = (await adapter.storage.load()).state;
  const guardId = findByName(state, 'Guard').id;
  const deathText = trailer(
    'A blade struck the guard, who fell lifeless and died instantly.',
    [{
      id: guardId,
      present: false,
      activeInExchange: false,
      lifecycle: {
        lifeState: 'dead',
        cause: 'blade strike',
        source: evidence('fell lifeless and died instantly'),
      },
    }],
  );
  const deathPosition = await turn(host, 'Guard, behind you!', deathText, { swipeId: 0 });
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[guardId].lifeState, 'dead');
  assert.equal(state.npcs[guardId].present, false);

  const survivalText = trailer(
    'The guard ducked beneath the blade and remained alert.',
    [update(guardId, 'remained alert', { mood: 'vigilant', status: 'alive and guarding' })],
  );
  await host.swipeMessage(deathPosition, 1, survivalText);
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[guardId].lifeState, 'alive');
  assert.equal(state.npcs[guardId].mood, 'vigilant');

  await host.swipeMessage(deathPosition, 0, deathText);
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[guardId].lifeState, 'dead');

  await turn(
    host,
    'Guard, are you there?',
    trailer('The guard appeared alert despite the scene.', [
      update(guardId, 'appeared alert', { mood: 'alert', status: 'standing' }),
    ]),
  );
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[guardId].lifeState, 'dead');
  assert.equal(state.npcs[guardId].present, false);
  adapter.destroy();
});

test('S6 admission deletion removes the invalid identity, preserves an exact shifted survivor, and rejects stale dependents', async () => {
  const { host, adapter } = await harness('history_admission_delete');
  const alicePosition = await turn(
    host,
    'Who is first?',
    trailer('Alice entered first.', [newcomer('Alice', 'Alice entered')]),
  );
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;

  const bobPosition = await turn(
    host,
    'Who is second?',
    trailer('Bob entered second.', [newcomer('Bob', 'Bob entered')]),
  );
  state = (await adapter.storage.load()).state;
  const bobId = findByName(state, 'Bob').id;

  await turn(
    host,
    'Alice, how are you?',
    trailer('Alice answered quietly.', [update(aliceId, 'Alice answered', { mood: 'quiet' })]),
  );
  await host.deleteMessage(alicePosition);

  const rebuilt = (await adapter.storage.load()).state;
  assert.equal(rebuilt.npcs[aliceId], undefined);
  assert.equal(findByName(rebuilt, 'Bob').id, bobId);
  assert.equal(Object.keys(rebuilt.npcs).length, 1);
  assert.equal(rebuilt.pendingReview.entries.every((entry) => entry.targetId === bobId), true);
  const recovery = adapter.historyRecovery.getStatus(host.chatId);
  assert.equal(recovery.replayResults.some((item) => item.status === 'rejected'), true);

  // The first atomic recovery checkpoint contains metadata from multiple replay
  // positions. A later partial edit must still find Bob's own source-scoped ID.
  await host.editMessage(
    bobPosition - 1,
    trailer('Bob entered second and studied the map.', [
      newcomer('Bob', 'Bob entered second', { mood: 'focused' }),
    ]),
  );
  const recoveredAgain = (await adapter.storage.load()).state;
  assert.equal(findByName(recoveredAgain, 'Bob').id, bobId);
  assert.equal(findByName(recoveredAgain, 'Bob').mood, 'focused');
  assert.equal(recoveredAgain.npcs[aliceId], undefined);
  adapter.destroy();
});

test('S6 rollback removes committed Development conclusions, observations, support, receipts, and obsolete pending scope', async () => {
  const { host, adapter } = await harness('history_development_rollback');
  await turn(
    host,
    'Alice, join us.',
    trailer('Alice joined the group.', [newcomer('Alice', 'Alice joined')]),
  );
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;

  const evidencePosition = await turn(
    host,
    'Tell us of your old work.',
    trailer('Alice described her years as royal archivist.', [
      update(aliceId, 'royal archivist', { mood: 'reflective' }),
    ]),
  );
  const boundary = captureStoryHistoryBoundary(
    host.chat,
    host.chatId,
    evidencePosition,
    historyHelpers,
  );
  const beforeDevelopment = await adapter.storage.load();
  const dev = await adapter.coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    expectedRevision: beforeDevelopment.revision,
    identityProposals: [{ id: aliceId }],
    fieldProposals: { [aliceId]: { background: 'Former royal archivist' } },
    observations: [{
      targetId: aliceId,
      field: 'background',
      observation: 'Alice served as a royal archivist.',
      source: { sourceRef: 'msg:royal', excerpt: 'royal archivist', segmentKind: 'narrative' },
      disposition: { role: 'tentative' },
    }],
    supportProposals: [{
      targetId: aliceId,
      field: 'background',
      sourceRefs: ['msg:royal'],
      notes: 'Explicit occupational history',
    }],
    reviewReceipts: [{
      targetId: aliceId,
      sourceScope: ['msg:royal'],
      status: 'reviewed',
    }],
    historyBoundary: boundary,
    operationMode: 'development_review',
  });
  assert.equal(dev.success, true, dev.error);
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[aliceId].background, 'Former royal archivist');
  assert.equal(state.npcs[aliceId].development.observations.length, 1);
  assert.equal(state.npcs[aliceId].development.acceptedSupport.length, 1);
  assert.equal(state.npcs[aliceId].development.reviewReceipts.length, 1);
  const staleRevision = state.revision;

  await host.deleteMessage(evidencePosition);
  const rebuiltLoad = await adapter.storage.load();
  const alice = rebuiltLoad.state.npcs[aliceId];
  assert.equal(alice.background, null);
  assert.equal(alice.development.observations.length, 0);
  assert.equal(alice.development.acceptedSupport.length, 0);
  assert.equal(alice.development.reviewReceipts.length, 0);
  assert.equal(rebuiltLoad.state.pendingReview.entries.length, 1);

  const late = await adapter.coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    expectedRevision: staleRevision,
    identityProposals: [{ id: aliceId }],
    fieldProposals: { [aliceId]: { background: 'Stale resurrected conclusion' } },
  });
  assert.equal(late.success, false);
  assert.equal(late.conflict, true);
  assert.equal((await adapter.storage.load()).state.npcs[aliceId].background, null);
  adapter.destroy();
});

test('S6 editing durable Development evidence removes the old conclusion and regenerates current pending scope', async () => {
  const { host, adapter } = await harness('history_development_edit');
  await turn(
    host,
    'Alice, join us.',
    trailer('Alice joined the group.', [newcomer('Alice', 'Alice joined')]),
  );
  const aliceId = findByName((await adapter.storage.load()).state, 'Alice').id;
  const evidencePosition = await turn(
    host,
    'What work did you do?',
    trailer('Alice described her work as a royal archivist.', [
      update(aliceId, 'royal archivist', { mood: 'reflective' }),
    ]),
  );
  const beforeDevelopment = await adapter.storage.load();
  const dev = await adapter.coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    expectedRevision: beforeDevelopment.revision,
    identityProposals: [{ id: aliceId }],
    fieldProposals: { [aliceId]: { background: 'Former royal archivist' } },
    historyBoundary: captureStoryHistoryBoundary(host.chat, host.chatId, evidencePosition, historyHelpers),
    operationMode: 'development_review',
  });
  assert.equal(dev.success, true, dev.error);

  await host.editMessage(
    evidencePosition,
    trailer('Alice described her recent work as a dock merchant.', [
      update(aliceId, 'dock merchant', { mood: 'practical' }),
    ]),
  );
  const loaded = await adapter.storage.load();
  assert.equal(loaded.state.npcs[aliceId].background, null);
  assert.equal(loaded.state.npcs[aliceId].mood, 'practical');
  assert.ok(loaded.state.pendingReview.entries.some(
    (entry) => entry.targetId === aliceId && entry.metadata.assistantPosition === evidencePosition,
  ));
  adapter.destroy();
});

test('S6 manual deletion tombstone survives history reconstruction and blocks stale identity recreation', async () => {
  const { host, adapter } = await harness('history_user_tombstone');
  const position = await turn(
    host,
    'Who arrived?',
    trailer('Alice arrived quietly.', [newcomer('Alice', 'Alice arrived')]),
  );
  const aliceId = findByName((await adapter.storage.load()).state, 'Alice').id;
  const deleted = await deleteNpc(adapter.coordinator, {
    npcId: aliceId,
    reason: 'Player removed mistaken identity',
  });
  assert.equal(deleted.success, true, deleted.error);
  let loaded = await adapter.storage.load();
  assert.equal(loaded.state.npcs[aliceId], undefined);
  assert.ok(loaded.state.tombstones[aliceId]);
  assert.ok(loaded.state.history.checkpoints.at(-1).historyBoundary);

  await host.editMessage(
    position,
    trailer('Alice arrived carrying a lantern.', [
      newcomer('Alice', 'Alice arrived', { mood: 'watchful' }),
    ]),
  );
  loaded = await adapter.storage.load();
  assert.equal(loaded.state.npcs[aliceId], undefined);
  assert.ok(loaded.state.tombstones[aliceId]);
  assert.equal(Object.values(loaded.state.npcs).some((npc) => npc.name === 'Alice'), false);
  assert.equal(
    loaded.state.pendingReview.entries.some((entry) => entry.targetId === aliceId),
    false,
    'Story replay must not leave Development pending scope for a user-tombstoned NPC.',
  );
  adapter.destroy();
});

test('S6 reconstruction preserves current locks/corrections/portrait/importance without making an old correction permanent', async () => {
  const { host, adapter } = await harness('history_user_authority');
  await turn(
    host,
    'Alice arrives.',
    trailer('Alice arrived looking calm.', [newcomer('Alice', 'Alice arrived', { mood: 'calm' })]),
  );
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;

  const storyUpdate = await turn(
    host,
    'How do you feel?',
    trailer('Alice looked worried.', [update(aliceId, 'looked worried', { mood: 'worried' })]),
  );
  await updateNpcField(adapter.coordinator, {
    npcId: aliceId,
    fieldName: 'mood',
    value: 'player-corrected',
    reason: 'Player correction',
  });
  await setFieldLock(adapter.coordinator, { npcId: aliceId, fieldName: 'mood', locked: true });
  await setPortrait(adapter.coordinator, { npcId: aliceId, portrait: '/user/alice.png' });
  await setImportance(adapter.coordinator, { npcId: aliceId, importance: 8 });

  await host.editMessage(
    storyUpdate,
    trailer('Alice became furious.', [update(aliceId, 'became furious', { mood: 'furious' })]),
  );
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[aliceId].mood, 'player-corrected');
  assert.equal(state.npcs[aliceId].locks.mood, true);
  assert.equal(state.npcs[aliceId].manualCorrections.mood.reason, 'Player correction');
  assert.equal(state.npcs[aliceId].portrait, '/user/alice.png');
  assert.equal(state.npcs[aliceId].importance, 8);

  await setFieldLock(adapter.coordinator, { npcId: aliceId, fieldName: 'mood', locked: false });
  await turn(
    host,
    'The danger passes.',
    trailer('Alice relaxed with visible relief.', [update(aliceId, 'visible relief', { mood: 'relieved' })]),
  );
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[aliceId].mood, 'relieved', JSON.stringify(adapter.getImmediateFailure?.()));

  await host.editMessage(
    storyUpdate,
    trailer('Alice remained uneasy.', [update(aliceId, 'remained uneasy', { mood: 'uneasy' })]),
  );
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[aliceId].mood, 'relieved');
  assert.equal(state.npcs[aliceId].locks.mood, false);
  assert.ok(state.npcs[aliceId].manualCorrections.mood);
  adapter.destroy();
});

test('S6 reconstruction commit is CAS-atomic, reports persistence failure, and leaves the recoverable state untouched', async () => {
  const initial = createInitialState();
  initial.npcs.alice = createDefaultNpcRecord('alice', 'Alice', { mood: 'calm' });
  const storage = new MemoryStorageAdapter(initial);
  const coordinator = new CommitCoordinator({ storage });
  const reconstructed = cloneState(initial);
  reconstructed.npcs.alice.mood = 'angry';

  const conflict = await coordinator.commitReconstruction({
    reconstructedState: reconstructed,
    expectedRevision: 9,
  });
  assert.equal(conflict.success, false);
  assert.equal(conflict.conflict, true);
  assert.equal((await storage.load()).state.npcs.alice.mood, 'calm');

  storage.setFailNextSave();
  const failed = await coordinator.commitReconstruction({
    reconstructedState: reconstructed,
    expectedRevision: 0,
  });
  assert.equal(failed.success, false);
  assert.equal(failed.errorCode, 'reconstruction_persistence_failed');
  let loaded = await storage.load();
  assert.equal(loaded.revision, 0);
  assert.equal(loaded.state.npcs.alice.mood, 'calm');
  assert.equal(loaded.state.history.checkpoints.length, 0);

  const retry = await coordinator.commitReconstruction({
    reconstructedState: reconstructed,
    expectedRevision: 0,
  });
  assert.equal(retry.success, true, retry.error);
  loaded = await storage.load();
  assert.equal(loaded.state.npcs.alice.mood, 'angry');
  assert.equal(loaded.state.history.checkpoints.at(-1).operation.mode, 'history_recovery');
});

test('S6 host persistence failure advertises no recovery success and a later retry converges once', async () => {
  const { host, adapter } = await harness('history_persistence_failure');
  const admissionPosition = await turn(
    host,
    'Who arrives?',
    trailer('Alice arrived.', [newcomer('Alice', 'Alice arrived')]),
  );
  const before = await adapter.storage.load();
  host.setFetchStatus(500);
  await host.editMessage(admissionPosition, trailer('No one arrived.', []));

  let after = await adapter.storage.load();
  assert.equal(after.revision, before.revision);
  assert.ok(findByName(after.state, 'Alice'));
  assert.equal(adapter.historyRecovery.getStatus(host.chatId).status, 'failed');

  host.setFetchStatus(200);
  await host.eventSource.emit(host.eventTypes.MESSAGE_UPDATED, admissionPosition);
  after = await adapter.storage.load();
  assert.equal(findByName(after.state, 'Alice'), undefined);
  const committedRevision = after.revision;
  assert.equal(adapter.historyRecovery.getStatus(host.chatId).status, 'recovered');

  await host.eventSource.emit(host.eventTypes.MESSAGE_UPDATED, admissionPosition);
  assert.equal((await adapter.storage.load()).revision, committedRevision);
  adapter.destroy();
});

test('S6 history mutation during persistence is never false success and retries to the newest canonical bytes', async () => {
  const { host, adapter } = await harness('history_changes_during_save');
  const position = await turn(
    host,
    'How does Alice look?',
    trailer('Alice looked calm.', [newcomer('Alice', 'Alice looked', { mood: 'calm' })]),
  );
  const aliceId = findByName((await adapter.storage.load()).state, 'Alice').id;
  const originalSave = adapter.storage.save.bind(adapter.storage);
  let injectedMutation = false;
  adapter.storage.save = async (state, expectedRevision) => {
    if (
      !injectedMutation &&
      state.history?.checkpoints?.at(-1)?.operation?.mode === 'history_recovery'
    ) {
      injectedMutation = true;
      host.chat[position].mes = trailer('Alice looked determined.', [
        newcomer('Alice', 'looked determined', { mood: 'determined' }),
      ]);
    }
    return originalSave(state, expectedRevision);
  };

  await host.editMessage(
    position,
    trailer('Alice looked worried.', [
      newcomer('Alice', 'looked worried', { mood: 'worried' }),
    ]),
  );

  const loaded = await adapter.storage.load();
  assert.equal(injectedMutation, true);
  assert.equal(loaded.state.npcs[aliceId].mood, 'determined');
  assert.ok(['recovered', 'no_change'].includes(adapter.historyRecovery.getStatus(host.chatId).status));
  assert.equal(
    adapter.diagnostics.entries.filter((entry) => entry.type === 'history_recovery_committed').length,
    1,
  );
  adapter.destroy();
});

test('S6 missing trustworthy checkpoint baseline blocks instead of fabricating history', async () => {
  const host = new MockSillyTavernHost({ chatId: 'history_missing_baseline' });
  host.sendUserMessage('Existing story');
  const initial = createInitialState();
  initial.revision = 1;
  initial.npcs.alice = createDefaultNpcRecord('alice', 'Alice');
  const storage = new MemoryStorageAdapter(initial);
  const coordinator = new CommitCoordinator({ storage });
  const recovery = new StoryHistoryRecovery({
    storage,
    coordinator,
    getContext: () => host.getContext(),
    buildPrecedingLineage,
    getMessageSwipeId,
  });
  const result = await recovery.recover({ eventName: 'message_edited', messageId: 0 });
  assert.equal(result.success, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'trustworthy_baseline_missing');
  assert.equal((await storage.load()).revision, 1);
});

test('S6 recovery is isolated to the active chat and does not mutate another chat namespace', async () => {
  const { host, adapter } = await harness('history_chat_A');
  const alicePosition = await turn(
    host,
    'Alice?',
    trailer('Alice appeared in Chat A.', [newcomer('Alice', 'Alice appeared')]),
  );
  await host.switchChat('history_chat_B');
  await turn(
    host,
    'Bob?',
    trailer('Bob appeared in Chat B.', [newcomer('Bob', 'Bob appeared')]),
  );
  const beforeB = await adapter.storage.load();
  const bobId = findByName(beforeB.state, 'Bob').id;

  await host.switchChat('history_chat_A');
  await host.editMessage(alicePosition, trailer('Chat A remained empty.', []));
  const afterA = await adapter.storage.load();
  assert.equal(Object.keys(afterA.state.npcs).length, 0);

  await host.switchChat('history_chat_B');
  const afterB = await adapter.storage.load();
  assert.equal(afterB.revision, beforeB.revision);
  assert.equal(findByName(afterB.state, 'Bob').id, bobId);
  adapter.destroy();
});


test('S6 checkpoint retention preserves the first trustworthy base and a bounded recent suffix', () => {
  const state = createInitialState();
  for (let index = 0; index < MAX_STORY_CHECKPOINTS + 12; index++) {
    state.revision = index + 1;
    createCheckpoint(state, {
      checkpointId: `bounded_${index}`,
      timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
      writer: 'runtime',
      mode: index === 0 ? 'explicit_baseline' : 'test_commit',
    });
  }
  assert.equal(state.history.checkpoints.length, MAX_STORY_CHECKPOINTS);
  assert.equal(state.history.checkpoints[0].id, 'bounded_0');
  assert.equal(state.history.checkpoints.at(-1).id, `bounded_${MAX_STORY_CHECKPOINTS + 11}`);
  assert.equal(validateState(state).valid, true);
});

test('S6 checkpoint compaction retains a late import baseline without reordering chronology', () => {
  const state = createInitialState();
  const importIndex = MAX_STORY_CHECKPOINTS - 5;
  for (let index = 0; index < MAX_STORY_CHECKPOINTS + 20; index++) {
    state.revision = index + 1;
    createCheckpoint(state, {
      checkpointId: `import_guard_${index}`,
      timestamp: `2026-02-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
      writer: 'runtime',
      mode: index === 0
        ? 'explicit_baseline'
        : (index === importIndex ? IMPORT_BASELINE_MODE : 'test_commit'),
    });
  }
  assert.equal(state.history.checkpoints.length, MAX_STORY_CHECKPOINTS);
  assert.equal(state.history.checkpoints[0].id, 'import_guard_0');
  const retainedImport = state.history.checkpoints.find((checkpoint) => checkpoint.operation.mode === IMPORT_BASELINE_MODE);
  assert.equal(retainedImport?.id, `import_guard_${importIndex}`);
  const retainedIndices = state.history.checkpoints.map((checkpoint) => Number(checkpoint.id.split('_').at(-1)));
  assert.equal(retainedIndices.every((value, index) => index === 0 || value > retainedIndices[index - 1]), true);
  assert.equal(state.history.checkpoints.at(-1).id, `import_guard_${MAX_STORY_CHECKPOINTS + 19}`);
  assert.equal(validateState(state).valid, true);
});

test('S6 reload/chat-load recovers history edited while the extension was unloaded', async () => {
  const { host, adapter } = await harness('history_reload_recovery');
  const admissionPosition = await turn(
    host,
    'Who arrived?',
    trailer('Alice arrived before reload.', [newcomer('Alice', 'Alice arrived')]),
  );
  const original = await adapter.storage.load();
  assert.ok(findByName(original.state, 'Alice'));
  adapter.destroy();

  host.chat[admissionPosition].mes = trailer('No one arrived before reload.', []);
  const reloaded = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey: host.interceptorKey,
  });
  assert.equal(reloaded.initialize(), true);
  await host.eventSource.emit(host.eventTypes.CHAT_LOADED, host.chatId);

  const recovered = await reloaded.storage.load();
  assert.equal(findByName(recovered.state, 'Alice'), undefined);
  assert.ok(recovered.revision > original.revision);
  assert.ok(reloaded.diagnostics.entries.some((entry) => entry.type === 'history_recovery_committed'));
  reloaded.destroy();
});

test('S6 no-change checks leave Development running; actual divergence cancels and requeues exactly once', async () => {
  const { host, adapter } = await harness('history_development_coordination');
  const position = await turn(
    host,
    'Who arrived?',
    trailer('Alice arrived for review.', [newcomer('Alice', 'Alice arrived')]),
  );
  const calls = { invalidated: 0, recovered: 0 };
  adapter.setDevelopmentReview({
    onForegroundStart() {},
    onChatChanged() {},
    async onHistoryInvalidation() {
      calls.invalidated++;
    },
    onHistoryRecovered() {
      calls.recovered++;
    },
  });

  await host.eventSource.emit(host.eventTypes.MESSAGE_UPDATED, position);
  assert.deepEqual(calls, { invalidated: 0, recovered: 0 });

  await host.editMessage(position, trailer('Alice arrived with new evidence.', [
    newcomer('Alice', 'Alice arrived with new evidence'),
  ]));
  assert.deepEqual(calls, { invalidated: 1, recovered: 1 });
  adapter.destroy();
});


test('S6 MESSAGE_RECEIVED regeneration recovers a replacement even when no swipe notification preceded it', async () => {
  const { host, adapter } = await harness('history_direct_regeneration');
  const position = await turn(
    host,
    'Who answers?',
    trailer('Alice answered first.', [newcomer('Alice', 'Alice answered')]),
    { swipeId: 0 },
  );
  const replacement = trailer('Bob answered instead.', [newcomer('Bob', 'Bob answered')]);
  host.chat[position].mes = replacement;
  host.chat[position].swipe_id = 1;
  host.chat[position].swipes[1] = replacement;

  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, position, 'regenerate');
  let loaded = await adapter.storage.load();
  assert.equal(findByName(loaded.state, 'Alice'), undefined);
  assert.ok(findByName(loaded.state, 'Bob'));
  const recoveredRevision = loaded.revision;

  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, position, 'regenerate');
  loaded = await adapter.storage.load();
  assert.equal(loaded.revision, recoveredRevision);
  assert.equal(Object.values(loaded.state.npcs).filter((npc) => npc.name === 'Bob').length, 1);
  adapter.destroy();
});


test('S6 two-NPC swipe keeps the stable sibling while death/survival changes only the affected NPC', async () => {
  const { host, adapter } = await harness('history_two_npc_swipe');
  await turn(
    host,
    'Alice and Guard, take the breach.',
    trailer('Alice and the Guard took position at the breach.', [
      newcomer('Alice', 'Alice and the Guard took position', { mood: 'focused' }),
      newcomer('Guard', 'the Guard took position', { mood: 'alert' }),
    ]),
  );
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;
  const guardId = findByName(state, 'Guard').id;

  const deathText = trailer(
    'A black-fletched bolt killed the Guard while Alice held the breach.',
    [
      {
        ...update(guardId, 'bolt killed the Guard'),
        present: false,
        activeInExchange: false,
        lifecycle: { lifeState: 'dead', source: evidence('bolt killed the Guard') },
      },
      update(aliceId, 'Alice held the breach', { mood: 'focused', status: 'guarding the breach' }),
    ],
  );
  const combatPosition = await turn(host, 'Hold the line!', deathText, { swipeId: 0 });
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[guardId].lifeState, 'dead');
  assert.equal(state.npcs[aliceId].id, aliceId);
  assert.equal(state.npcs[aliceId].status, 'guarding the breach');

  const survivalText = trailer(
    'The Guard ducked beneath the bolt while Alice held the breach.',
    [
      update(guardId, 'Guard ducked beneath the bolt', { mood: 'alert', status: 'holding the line' }),
      update(aliceId, 'Alice held the breach', { mood: 'focused', status: 'guarding the breach' }),
    ],
  );
  await host.swipeMessage(combatPosition, 1, survivalText);
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[guardId].id, guardId);
  assert.equal(state.npcs[guardId].lifeState, 'alive');
  assert.equal(state.npcs[guardId].status, 'holding the line');
  assert.equal(state.npcs[aliceId].id, aliceId);
  assert.equal(state.npcs[aliceId].mood, 'focused');
  assert.equal(state.npcs[aliceId].status, 'guarding the breach');

  await host.swipeMessage(combatPosition, 0, deathText);
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[guardId].lifeState, 'dead');
  assert.equal(state.npcs[aliceId].id, aliceId);
  assert.equal(state.npcs[aliceId].status, 'guarding the breach');
  adapter.destroy();
});

test('S6 divergence before a format-neutral import baseline blocks automatic pre-import reconstruction', () => {
  const host = new MockSillyTavernHost({ chatId: 'history_pre_import_guard' });
  host.sendUserMessage('Original history before import.');
  const state = createInitialState();
  const boundary = captureStoryHistoryBoundary(host.chat, host.chatId, 0, historyHelpers);

  state.revision = 1;
  createCheckpoint(state, {
    checkpointId: 'pre_import_story_checkpoint',
    historyBoundary: boundary,
    writer: WRITERS.RUNTIME,
    mode: 'pre_import_story',
  });
  state.revision = 2;
  createCheckpoint(state, {
    checkpointId: 'import_baseline_checkpoint',
    historyBoundary: boundary,
    writer: WRITERS.RUNTIME,
    mode: IMPORT_BASELINE_MODE,
  });

  host.chat[0].mes = 'Edited history before import.';
  const analysis = analyzeStoryHistory(state, host.chat, host.chatId, historyHelpers);
  assert.equal(analysis.valid, false);
  assert.equal(analysis.blocked, true);
  assert.equal(analysis.reason, 'pre_import_history_untrusted');
  assert.equal(analysis.divergence.checkpointId, 'pre_import_story_checkpoint');
});

test('S6 relationship lock preserves cumulative mechanics across replay and unlock restores canonical recomputation', async () => {
  const { host, adapter } = await harness('history_relationship_lock');
  await turn(
    host,
    'Alice arrives.',
    trailer('Alice joined the discussion.', [newcomer('Alice', 'Alice joined')]),
  );
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;
  const relationshipPosition = await turn(
    host,
    'I brought a thoughtful gift.',
    trailer('Alice smiled warmly at the gift.', [
      relationshipUpdate(aliceId, 'smiled warmly', { affection: 1 }),
    ]),
  );
  await setFieldLock(adapter.coordinator, {
    npcId: aliceId,
    fieldName: 'relationshipEvaluation',
    locked: true,
  });

  await host.editMessage(
    relationshipPosition,
    trailer('Alice acknowledged the reliable plan.', [
      relationshipUpdate(aliceId, 'reliable plan', { trust: 1 }),
    ]),
  );
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[aliceId].relationship.affection, 1);
  assert.equal(state.npcs[aliceId].relationship.trust, 0);
  assert.equal(state.npcs[aliceId].relationship.scoringHistory.length, 1);

  await setFieldLock(adapter.coordinator, {
    npcId: aliceId,
    fieldName: 'relationshipEvaluation',
    locked: false,
  });
  await host.editMessage(
    relationshipPosition,
    trailer('Alice trusted the proven plan completely.', [
      relationshipUpdate(aliceId, 'proven plan', { trust: 2 }),
    ]),
  );
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[aliceId].relationship.affection, 0);
  assert.equal(state.npcs[aliceId].relationship.trust, 2);
  assert.equal(state.npcs[aliceId].relationship.scoringHistory.length, 1);
  adapter.destroy();
});
