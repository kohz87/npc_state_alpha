import test from 'node:test';
import assert from 'node:assert/strict';

import { WRITERS } from '../src/contract/registry.js';
import { ALPHA_NAMESPACE, createDefaultNpcRecord, createInitialState, validateState } from '../src/state/schema.js';
import { CommitCoordinator } from '../src/runtime/commit-coordinator.js';
import { updateNpcField, setFieldLock, deleteNpc } from '../src/runtime/user-commands.js';
import { SillyTavernAdapter } from '../src/host/sillytavern-adapter.js';
import { SillyTavernStorageAdapter } from '../src/host/storage-adapter.js';
import { DevelopmentReviewQueue } from '../src/host/development-queue.js';
import { serializeAlphaNativeBundle, parseAlphaNativeBundle } from '../src/state/portable-state.js';
import { MockSillyTavernHost } from './fixtures/host-harness.js';
import { S8_BEHAVIOR_MATRIX, S8_MATRIX_GROUPS } from './fixtures/s8-behavior-matrix.js';

const OPEN = '<npc_state_alpha_v1>';
const CLOSE = '</npc_state_alpha_v1>';

function trailer(narrative, proposals) {
  return `${narrative}\n\n${OPEN}\n${JSON.stringify({ version: '1', proposals }, null, 2)}\n${CLOSE}`;
}

function evidence(excerpt) {
  return { sourceRef: 'current:assistant', excerpt };
}

function newcomer(name, localRef, excerpt, extra = {}) {
  return {
    id: null,
    localRef,
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
    present: true,
    activeInExchange: false,
    source: evidence(excerpt),
    presenceSource: evidence(excerpt),
    ...fields,
  };
}

function relationshipUpdate(id, excerpt, axes, impact = 'moderate') {
  const changed = Object.fromEntries(Object.entries(axes).filter(([, value]) => value !== 0));
  const axisSupport = {};
  for (const axis of Object.keys(changed)) {
    axisSupport[axis] = { reason: `${axis} changed`, source: evidence(excerpt) };
  }
  return update(id, excerpt, {
    activeInExchange: true,
    relationshipEvaluation: {
      shifted: true,
      impact,
      axes: { trust: 0, affection: 0, desire: 0, tension: 0, ...axes },
      axisSupport,
    },
  });
}

function noShift(id, excerpt) {
  return update(id, excerpt, {
    activeInExchange: true,
    relationshipEvaluation: { shifted: false, reason: 'No relationship change', source: evidence(excerpt) },
  });
}

async function harness(chatId) {
  const host = new MockSillyTavernHost({ chatId });
  host.interceptorKey = `s8_${chatId}`;
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

function findAllByName(state, name) {
  return Object.values(state.npcs).filter((npc) => npc.name === name);
}

function promptJson(prompt, prefix) {
  const line = prompt.split('\n').find((item) => item.startsWith(prefix));
  return JSON.parse(line.slice(prefix.length));
}

function noOpDevelopment(prompt) {
  const targets = promptJson(prompt, 'TARGETS=');
  return JSON.stringify({
    version: '1',
    reviewReceipts: targets.map((target) => ({
      targetId: target.id,
      sourceScope: target.sourceScope,
      status: 'reviewed_no_proposals',
      ...(Array.isArray(target.fieldSubset) ? { restricted: true, fieldSubset: target.fieldSubset } : {}),
    })),
    proposals: [], observations: [], supportProposals: [],
  });
}

function durableScalarDevelopment(prompt, field, value) {
  const targets = promptJson(prompt, 'TARGETS=');
  const sources = promptJson(prompt, 'SOURCES=');
  const target = targets[0];
  const assistant = sources.find((source) => source.role === 'assistant' && target.sourceScope.includes(source.sourceRef));
  const excerpt = assistant.text.split(/[.!?]/)[0].trim();
  return JSON.stringify({
    version: '1',
    reviewReceipts: targets.map((item) => ({
      targetId: item.id,
      sourceScope: item.sourceScope,
      status: item.id === target.id ? 'reviewed' : 'reviewed_no_proposals',
    })),
    proposals: [{ targetId: target.id, [field]: { value, source: { sourceRef: assistant.sourceRef, excerpt } } }],
    observations: [], supportProposals: [],
  });
}

class ScriptedProvider {
  constructor(fn, options = {}) {
    this.fn = fn;
    this.calls = [];
    this.requiresConfiguredProfile = options.requiresConfiguredProfile === true;
  }
  async sendReview(request) {
    this.calls.push(request);
    const value = await this.fn(request, this.calls.length);
    return typeof value === 'string' ? { text: value } : value;
  }
}

class DeferredProvider {
  constructor() {
    this.calls = [];
    this.pending = [];
    this.requiresConfiguredProfile = false;
  }
  sendReview(request) {
    this.calls.push(request);
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      request.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.push({
        request,
        resolve: (value) => {
          request.signal?.removeEventListener('abort', onAbort);
          resolve(typeof value === 'string' ? { text: value } : value);
        },
      });
    });
  }
}

function queueFor(adapter, host, provider, settings = {}) {
  return new DevelopmentReviewQueue({
    storage: adapter.storage,
    coordinator: adapter.coordinator,
    getContext: () => host.getContext(),
    provider,
    settings: { developmentConnectionProfile: 's8-profile', developmentCadence: 1, ...settings },
  });
}

test('S8 matrix metadata is labeled, complete, and covers every A-P group plus eight long-form scenarios', () => {
  const ids = new Set();
  for (const scenario of S8_BEHAVIOR_MATRIX) {
    assert.match(scenario.id, /^S8-(?:[A-P]\d{2}|LF\d{2})$/);
    assert.equal(ids.has(scenario.id), false, `duplicate scenario ${scenario.id}`);
    ids.add(scenario.id);
    for (const key of ['subsystems','initialState','evidence','expectedTransition','unchanged','relationship','lifecycle','development','history','modelCall','deterministic','installedHost']) {
      assert.notEqual(scenario[key], undefined, `${scenario.id} missing ${key}`);
    }
    assert.ok(Array.isArray(scenario.covers) && scenario.covers.length > 0);
  }
  for (const group of S8_MATRIX_GROUPS) {
    assert.ok(S8_BEHAVIOR_MATRIX.some((scenario) => scenario.id.startsWith(`S8-${group}`)), `missing matrix group ${group}`);
  }
  for (let i = 1; i <= 8; i++) assert.ok(ids.has(`S8-LF${String(i).padStart(2, '0')}`));
});

test('S8 A/L/H: explicitly distinct same-name siblings retain separate stable IDs when replay reverses proposal order', async () => {
  const { host, adapter } = await harness('s8_same_name_siblings');
  const position = await turn(host, 'Who are the twins?', trailer(
    'Two different twins both named Ren stepped forward; the elder wore red and the younger wore blue.',
    [
      newcomer('Ren', 'new:ren-elder', 'elder wore red', { mood: 'calm' }),
      newcomer('Ren', 'new:ren-younger', 'younger wore blue', { mood: 'curious' }),
    ],
  ));
  let state = (await adapter.storage.load()).state;
  const [elder, younger] = findAllByName(state, 'Ren');
  assert.equal(findAllByName(state, 'Ren').length, 2);
  assert.notEqual(elder.id, younger.id);
  const idsByMood = { calm: elder.mood === 'calm' ? elder.id : younger.id, curious: elder.mood === 'curious' ? elder.id : younger.id };

  await host.editMessage(position, trailer(
    'The younger Ren in blue became excited while the elder Ren in red stayed calm.',
    [
      newcomer('Ren', 'new:ren-younger', 'younger Ren in blue', { mood: 'excited' }),
      newcomer('Ren', 'new:ren-elder', 'elder Ren in red', { mood: 'calm' }),
    ],
  ));
  state = (await adapter.storage.load()).state;
  assert.equal(findAllByName(state, 'Ren').length, 2);
  assert.equal(state.npcs[idsByMood.calm].mood, 'calm');
  assert.equal(state.npcs[idsByMood.curious].mood, 'excited');
  adapter.destroy();
});

test('S8 A/L: a shared alias on two stable NPCs does not merge them or redirect ID-targeted live updates', async () => {
  const { host, adapter } = await harness('s8_alias_collision');
  await turn(host, 'Who is here?', trailer('Mira and Kira entered together.', [
    newcomer('Mira', 'new:mira', 'Mira and Kira entered', { mood: 'calm' }),
    newcomer('Kira', 'new:kira', 'Mira and Kira entered', { mood: 'alert' }),
  ]));
  let state = (await adapter.storage.load()).state;
  const miraId = findByName(state, 'Mira').id;
  const kiraId = findByName(state, 'Kira').id;
  await turn(host, 'Both use the callsign Red.', trailer('Mira and Kira both confirmed the callsign Red.', [
    { id: miraId, aliases: ['Red'], source: evidence('Mira and Kira both confirmed') },
    { id: kiraId, aliases: ['Red'], source: evidence('Mira and Kira both confirmed') },
  ]));
  await turn(host, 'Mira, report.', trailer('Mira alone reported that she was ready.', [update(miraId, 'Mira alone reported', { mood: 'ready' })]));
  state = (await adapter.storage.load()).state;
  assert.deepEqual(state.npcs[miraId].aliases, ['Red']);
  assert.deepEqual(state.npcs[kiraId].aliases, ['Red']);
  assert.equal(state.npcs[miraId].mood, 'ready');
  assert.equal(state.npcs[kiraId].mood, 'alert');
  assert.notEqual(miraId, kiraId);
  adapter.destroy();
});

test('S8 M/L: same display name in two chats keeps identity, relationship and lifecycle state isolated across switches', async () => {
  const { host, adapter } = await harness('s8_chat_A');
  await turn(host, 'Ari?', trailer('Ari in the first chat greeted me warmly.', [newcomer('Ari', 'new:ari-a', 'Ari in the first chat')]));
  let stateA = (await adapter.storage.load()).state;
  const ariA = findByName(stateA, 'Ari').id;
  await turn(host, 'Thank you, Ari.', trailer('Ari trusted the promise.', [relationshipUpdate(ariA, 'trusted the promise', { trust: 2 })]));

  await host.switchChat('s8_chat_B');
  await turn(host, 'Ari?', trailer('Ari in the second chat appeared separately.', [newcomer('Ari', 'new:ari-b', 'Ari in the second chat')]));
  let stateB = (await adapter.storage.load()).state;
  const ariB = findByName(stateB, 'Ari').id;
  assert.notEqual(ariA, ariB);
  await turn(host, 'What happened?', trailer('Ari in the second chat died beneath the fallen beam.', [{
    id: ariB, present: false, activeInExchange: false,
    lifecycle: { lifeState: 'dead', cause: 'fallen beam', source: evidence('died beneath the fallen beam') },
  }]));
  stateB = (await adapter.storage.load()).state;
  assert.equal(stateB.npcs[ariB].lifeState, 'dead');
  assert.equal(stateB.npcs[ariB].relationship.trust, 0);

  await host.switchChat('s8_chat_A');
  stateA = (await adapter.storage.load()).state;
  assert.equal(stateA.npcs[ariA].lifeState, 'alive');
  assert.equal(stateA.npcs[ariA].relationship.trust, 2);
  assert.equal(stateA.npcs[ariB], undefined);
  adapter.destroy();
});

test('S8 D/H/O: relationship positive -> negative -> neutral -> positive A/B/A swipes reconstruct exactly once', async () => {
  const { host, adapter } = await harness('s8_relationship_aba');
  await turn(host, 'Alice?', trailer('Alice joined the table.', [newcomer('Alice', 'new:alice', 'Alice joined')]));
  const aliceId = findByName((await adapter.storage.load()).state, 'Alice').id;
  const positive = trailer('Alice smiled at the kept promise.', [relationshipUpdate(aliceId, 'kept promise', { trust: 2, affection: 1 })]);
  const pos = await turn(host, 'I kept my promise.', positive, { swipeId: 0 });
  let rel = (await adapter.storage.load()).state.npcs[aliceId].relationship;
  assert.equal(rel.trust, 2);
  assert.equal(rel.affection, 1);
  assert.equal(rel.scoringHistory.length, 1);

  const negative = trailer('Alice recoiled from the deliberate betrayal.', [relationshipUpdate(aliceId, 'deliberate betrayal', { trust: -3, tension: 2 })]);
  await host.swipeMessage(pos, 1, negative);
  rel = (await adapter.storage.load()).state.npcs[aliceId].relationship;
  assert.equal(rel.trust, -3);
  assert.equal(rel.affection, 0);
  assert.equal(rel.tension, 2);
  assert.equal(rel.scoringHistory.length, 1);

  const neutral = trailer('Alice acknowledged the weather report without changing her view of me.', [noShift(aliceId, 'acknowledged the weather report')]);
  await host.swipeMessage(pos, 2, neutral);
  rel = (await adapter.storage.load()).state.npcs[aliceId].relationship;
  assert.equal(rel.trust, 0);
  assert.equal(rel.tension, 0);
  assert.equal((rel.scoringHistory || []).length, 0);

  await host.swipeMessage(pos, 0, positive);
  rel = (await adapter.storage.load()).state.npcs[aliceId].relationship;
  assert.equal(rel.trust, 2);
  assert.equal(rel.affection, 1);
  assert.equal(rel.scoringHistory.length, 1);
  adapter.destroy();
});

test('S8 G/N: provider failure leaves Development pending while a later Immediate live update still commits', async () => {
  const { host, adapter } = await harness('s8_provider_failure_immediate');
  await turn(host, 'Elena?', trailer('Elena arrived at the archive.', [newcomer('Elena', 'new:elena', 'Elena arrived')]));
  const elenaId = findByName((await adapter.storage.load()).state, 'Elena').id;
  const provider = new ScriptedProvider(async () => { throw Object.assign(new Error('temporary outage'), { code: 'temporary_outage' }); });
  const queue = queueFor(adapter, host, provider);
  const failed = await queue.trigger('s8_failure');
  assert.equal(failed.status, 'provider_failed');
  let loaded = await adapter.storage.load();
  assert.equal(loaded.state.pendingReview.entries.length > 0, true);

  await turn(host, 'Elena, the alarm is sounding.', trailer('Elena became alert at the alarm.', [update(elenaId, 'became alert', { mood: 'alert', status: 'responding to alarm' })]));
  loaded = await adapter.storage.load();
  assert.equal(loaded.state.npcs[elenaId].mood, 'alert');
  assert.equal(loaded.state.npcs[elenaId].status, 'responding to alarm');
  assert.ok(loaded.state.pendingReview.entries.length >= 1);
  queue.destroy();
  adapter.destroy();
});

test('S8 G/N/provider: missing Development profile pauses only Development and does not hijack Immediate routing', async () => {
  const { host, adapter } = await harness('s8_missing_profile');
  await turn(host, 'Mira?', trailer('Mira arrived quietly.', [newcomer('Mira', 'new:mira', 'Mira arrived')]));
  const miraId = findByName((await adapter.storage.load()).state, 'Mira').id;
  let sendCalls = 0;
  const provider = new ScriptedProvider(async () => { sendCalls++; return '{}'; }, { requiresConfiguredProfile: true });
  const queue = queueFor(adapter, host, provider, { developmentConnectionProfile: null });
  const paused = await queue.trigger('missing_profile');
  assert.equal(paused.status, 'paused');
  assert.equal(sendCalls, 0);
  await turn(host, 'Mira, move to the gate.', trailer('Mira moved to the gate.', [update(miraId, 'moved to the gate', { location: 'Gate' })]));
  assert.equal((await adapter.storage.load()).state.npcs[miraId].location, 'Gate');
  queue.destroy();
  adapter.destroy();
});

test('S8 N/E/L: one incompatible dead-NPC live proposal does not poison an independent valid sibling proposal', async () => {
  const { host, adapter } = await harness('s8_partial_dead_sibling');
  await turn(host, 'Who is here?', trailer('Alice and Bob joined the watch.', [
    newcomer('Alice', 'new:alice', 'Alice and Bob joined', { mood: 'calm' }),
    newcomer('Bob', 'new:bob', 'Alice and Bob joined', { mood: 'calm' }),
  ]));
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;
  const bobId = findByName(state, 'Bob').id;

  await turn(host, 'What happened to Alice?', trailer('Alice died when the parapet collapsed.', [{
    id: aliceId,
    present: false,
    activeInExchange: false,
    lifecycle: { lifeState: 'dead', cause: 'parapet collapse', source: evidence('Alice died') },
  }]));
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[aliceId].lifeState, 'dead');
  const alicePendingBefore = state.pendingReview.entries.filter((entry) => entry.targetId === aliceId).length;
  const bobPendingBefore = state.pendingReview.entries.filter((entry) => entry.targetId === bobId).length;

  await turn(host, 'Bob, report.', trailer('Bob frowned at the rain. Alice was standing beside him.', [
    update(aliceId, 'Alice was standing beside him', { mood: 'alert' }),
    update(bobId, 'Bob frowned at the rain', { mood: 'irritated' }),
  ]));

  const loaded = await adapter.storage.load();
  assert.equal(loaded.state.npcs[aliceId].lifeState, 'dead');
  assert.equal(loaded.state.npcs[aliceId].present, false);
  assert.equal(loaded.state.npcs[bobId].mood, 'irritated', `Independent valid sibling proposal must survive another target rejection: ${JSON.stringify(adapter.getImmediateFailure(host.chatId))}`);
  assert.equal(loaded.state.pendingReview.entries.filter((entry) => entry.targetId === aliceId).length, alicePendingBefore);
  assert.equal(loaded.state.pendingReview.entries.filter((entry) => entry.targetId === bobId).length, bobPendingBefore + 1);
  const commitDiagnostic = adapter.diagnostics.getEntries().filter((entry) => entry.type === 'commit_success').at(-1);
  assert.deepEqual(commitDiagnostic?.rejected?.map((item) => item.targetId), [aliceId]);
  adapter.destroy();
});

test('S8 N/K: malformed Development envelope cannot partially mutate a durable field or clear pending scope', async () => {
  const { host, adapter } = await harness('s8_bad_development');
  await turn(host, 'Selene?', trailer('Selene arrived for intake.', [newcomer('Selene', 'new:selene', 'Selene arrived')]));
  const seleneId = findByName((await adapter.storage.load()).state, 'Selene').id;
  const provider = new ScriptedProvider(async () => JSON.stringify({
    version: '1',
    reviewReceipts: [],
    proposals: [{ targetId: seleneId, field: 'role', value: 'Registrar' }],
    observations: [], supportProposals: [],
  }));
  const queue = queueFor(adapter, host, provider);
  const result = await queue.trigger('malformed');
  assert.equal(result.status, 'invalid_response');
  const loaded = await adapter.storage.load();
  assert.equal(loaded.state.npcs[seleneId].role, null);
  assert.ok(loaded.state.pendingReview.entries.length > 0);
  assert.equal(loaded.state.pendingReview.entries[0].metadata.lastReviewStatus, 'failed');
  queue.destroy();
  adapter.destroy();
});

test('S8 C/G: late Development appearance proposal defers after currentForm changes while provider waits', async () => {
  const { host, adapter } = await harness('s8_form_development_race');
  await turn(host, 'Rin?', trailer('Rin arrived in human form.', [newcomer('Rin', 'new:rin', 'Rin arrived')]));
  const rinId = findByName((await adapter.storage.load()).state, 'Rin').id;
  const formsCommit = await adapter.coordinator.commit({
    writer: WRITERS.USER,
    fieldProposals: { [rinId]: { appearanceForms: [
      { formId: 'human', name: 'Human', description: 'ordinary human form' },
      { formId: 'wolf', name: 'Wolf', description: 'silver wolf form' },
    ] } },
  });
  assert.equal(formsCommit.success, true, formsCommit.error);
  await turn(host, 'Transform.', trailer('Rin shifted into the established wolf form.', [update(rinId, 'shifted into the established wolf form', { currentForm: 'wolf' })]));

  const provider = new DeferredProvider();
  const queue = queueFor(adapter, host, provider);
  const running = queue.trigger('appearance_review');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.calls.length, 1);
  await turn(host, 'Return to normal.', trailer('Rin returned to the established human form.', [update(rinId, 'returned to the established human form', { currentForm: 'human' })]));
  provider.pending[0].resolve(durableScalarDevelopment(provider.calls[0].prompt, 'canonicalAppearance', 'A silver wolf with a white throat.'));
  const result = await running;
  assert.equal(result.status, 'committed');
  assert.ok(result.commitResult.deferred.some((item) => item.field === 'canonicalAppearance'));
  const loaded = await adapter.storage.load();
  assert.equal(loaded.state.npcs[rinId].currentForm, 'human');
  assert.equal(loaded.state.npcs[rinId].canonicalAppearance, null);
  assert.ok(loaded.state.pendingReview.entries.length > 0);
  queue.destroy();
  adapter.destroy();
});

test('S8 E/G/H: death-to-survival swipe cancels an in-flight Development job and reconstructs living state', async () => {
  const { host, adapter } = await harness('s8_death_dev_swipe');
  await turn(host, 'Guard?', trailer('The Guard took position.', [newcomer('Guard', 'new:guard', 'Guard took position')]));
  const guardId = findByName((await adapter.storage.load()).state, 'Guard').id;
  const deathText = trailer('The Guard died when the tower collapsed.', [{
    id: guardId, present: false, activeInExchange: false,
    lifecycle: { lifeState: 'dead', cause: 'tower collapse', source: evidence('Guard died') },
  }]);
  const deathPosition = await turn(host, 'What happened?', deathText, { swipeId: 0 });
  assert.equal((await adapter.storage.load()).state.npcs[guardId].lifeState, 'dead');

  const provider = new DeferredProvider();
  const queue = queueFor(adapter, host, provider);
  adapter.setDevelopmentReview(queue);
  const running = queue.trigger('death_review', { manual: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.calls.length, 1);
  const survival = trailer('The Guard escaped the collapse and remained alive.', [update(guardId, 'remained alive', { mood: 'shaken', status: 'recovering' })]);
  await host.swipeMessage(deathPosition, 1, survival);
  const result = await running;
  assert.equal(result.status, 'aborted');
  const loaded = await adapter.storage.load();
  assert.equal(loaded.state.npcs[guardId].lifeState, 'alive');
  assert.equal(loaded.state.npcs[guardId].status, 'recovering');
  assert.ok(loaded.state.pendingReview.entries.some((entry) => entry.targetId === guardId));
  queue.destroy();
  adapter.destroy();
});

test('S8 J/H: durable user correction and lock survive story reconstruction; unlock permits later Development evolution', async () => {
  const { host, adapter } = await harness('s8_user_role_history');
  const admission = await turn(host, 'Who joined?', trailer('Alice joined the expedition.', [newcomer('Alice', 'new:alice', 'Alice joined')]));
  const aliceId = findByName((await adapter.storage.load()).state, 'Alice').id;
  await updateNpcField(adapter.coordinator, { npcId: aliceId, fieldName: 'role', value: 'Captain', reason: 'Player correction' });
  await setFieldLock(adapter.coordinator, { npcId: aliceId, fieldName: 'role', locked: true });
  await host.editMessage(admission, trailer('Alice joined the expedition carrying a lantern.', [newcomer('Alice', 'new:alice', 'Alice joined', { mood: 'watchful' })]));
  let loaded = await adapter.storage.load();
  assert.equal(loaded.state.npcs[aliceId].role, 'Captain');
  assert.equal(loaded.state.npcs[aliceId].locks.role, true);
  assert.equal(loaded.state.npcs[aliceId].manualCorrections.role.reason, 'Player correction');

  await setFieldLock(adapter.coordinator, { npcId: aliceId, fieldName: 'role', locked: false });
  await turn(host, 'What is your post now?', trailer('Alice stated that she now serves as expedition commander.', [update(aliceId, 'serves as expedition commander', { mood: 'steady' })]));
  const provider = new ScriptedProvider(async ({ prompt }) => {
    const targets = promptJson(prompt, 'TARGETS=');
    const sources = promptJson(prompt, 'SOURCES=');
    const target = targets.find((item) => item.id === aliceId);
    const source = sources.find((item) => target.sourceScope.includes(item.sourceRef) && item.text.includes('expedition commander'));
    return JSON.stringify({
      version: '1',
      reviewReceipts: targets.map((item) => ({ targetId: item.id, sourceScope: item.sourceScope, status: item.id === aliceId ? 'reviewed' : 'reviewed_no_proposals' })),
      proposals: [{ targetId: aliceId, facts: { role: 'Expedition Commander', source: { sourceRef: source.sourceRef, excerpt: 'serves as expedition commander' } } }],
      observations: [], supportProposals: [],
    });
  });
  const queue = queueFor(adapter, host, provider);
  const review = await queue.trigger('role_evolution', { manual: true });
  assert.equal(review.status, 'committed');
  loaded = await adapter.storage.load();
  assert.equal(loaded.state.npcs[aliceId].role, 'Expedition Commander');
  assert.equal(loaded.state.npcs[aliceId].locks.role, false);
  assert.ok(loaded.state.npcs[aliceId].manualCorrections.role);
  queue.destroy();
  adapter.destroy();
});

test('S8 J/K/H: tombstoning one of three NPCs removes its pending work while survivor state remains intact through reconstruction', async () => {
  const { host, adapter } = await harness('s8_three_npc_tombstone');
  const position = await turn(host, 'Who came?', trailer('Alice, Bob, and Cara arrived together.', [
    newcomer('Alice', 'new:alice', 'Alice, Bob, and Cara arrived', { mood: 'calm' }),
    newcomer('Bob', 'new:bob', 'Alice, Bob, and Cara arrived', { mood: 'alert' }),
    newcomer('Cara', 'new:cara', 'Alice, Bob, and Cara arrived', { mood: 'curious' }),
  ]));
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;
  const bobId = findByName(state, 'Bob').id;
  const caraId = findByName(state, 'Cara').id;
  const deletion = await deleteNpc(adapter.coordinator, { npcId: bobId, reason: 'Player removed duplicate Bob' });
  assert.equal(deletion.success, true);
  await host.editMessage(position, trailer('Alice, Bob, and Cara arrived with maps.', [
    newcomer('Cara', 'new:cara', 'Cara arrived', { mood: 'curious' }),
    newcomer('Bob', 'new:bob', 'Bob', { mood: 'alert' }),
    newcomer('Alice', 'new:alice', 'Alice', { mood: 'calm' }),
  ]));
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[bobId], undefined);
  assert.ok(state.tombstones[bobId]);
  assert.equal(state.npcs[aliceId].mood, 'calm');
  assert.equal(state.npcs[caraId].mood, 'curious');
  assert.equal(state.pendingReview.entries.some((entry) => entry.targetId === bobId), false);
  adapter.destroy();
});

test('S8 O/H: repeated history notifications after reconstruction are idempotent for state, relationship, and pending ledger', async () => {
  const { host, adapter } = await harness('s8_recovery_idempotence');
  const position = await turn(host, 'Alice?', trailer('Alice arrived.', [newcomer('Alice', 'new:alice', 'Alice arrived')]));
  const aliceId = findByName((await adapter.storage.load()).state, 'Alice').id;
  await turn(host, 'I kept the bargain.', trailer('Alice trusted the fulfilled bargain.', [relationshipUpdate(aliceId, 'fulfilled bargain', { trust: 1 })]));
  await host.editMessage(position, trailer('Alice arrived carrying a sealed letter.', [newcomer('Alice', 'new:alice', 'Alice arrived', { mood: 'focused' })]));
  let loaded = await adapter.storage.load();
  const snapshot = JSON.stringify(loaded.state);
  const revision = loaded.revision;
  const pendingIds = loaded.state.pendingReview.entries.map((entry) => entry.id);
  for (let i = 0; i < 3; i++) await host.eventSource.emit(host.eventTypes.MESSAGE_UPDATED, position);
  loaded = await adapter.storage.load();
  assert.equal(loaded.revision, revision);
  assert.equal(JSON.stringify(loaded.state), snapshot);
  assert.deepEqual(loaded.state.pendingReview.entries.map((entry) => entry.id), pendingIds);
  assert.equal(loaded.state.npcs[aliceId].relationship.trust, 1);
  adapter.destroy();
});

test('S8 F/L: Development targetName relationship endpoint resolves to the unique existing stable NPC ID before persistence', async () => {
  const { host, adapter } = await harness('s8_relationship_target_name');
  await turn(host, 'Who is here?', trailer('Alice and Mira joined the table.', [
    newcomer('Alice', 'new:alice', 'Alice and Mira joined'),
    newcomer('Mira', 'new:mira', 'Alice and Mira joined'),
  ]));
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;
  const miraId = findByName(state, 'Mira').id;
  await turn(host, 'Alice, who is Mira?', trailer('Alice called Mira her older sister.', [update(aliceId, 'Alice called Mira her older sister', { mood: 'fond' })]));

  const provider = new ScriptedProvider(async ({ prompt }) => {
    const targets = promptJson(prompt, 'TARGETS=');
    const sources = promptJson(prompt, 'SOURCES=');
    const alice = targets.find((item) => item.id === aliceId);
    const source = sources.find((item) => alice.sourceScope.includes(item.sourceRef) && item.text.includes('older sister'));
    return JSON.stringify({
      version: '1',
      reviewReceipts: targets.map((item) => ({ targetId: item.id, sourceScope: item.sourceScope, status: item.id === aliceId ? 'reviewed' : 'reviewed_no_proposals' })),
      proposals: [{
        targetId: aliceId,
        nonPlayerRelationships: {
          operation: 'add',
          relationships: [{
            targetName: 'Mira',
            relationship: 'older sister',
            source: { sourceRef: source.sourceRef, excerpt: 'Mira her older sister' },
          }],
        },
      }],
      observations: [], supportProposals: [],
    });
  });
  const queue = queueFor(adapter, host, provider);
  const result = await queue.trigger('family_relation', { manual: true });
  assert.equal(result.status, 'committed', JSON.stringify(result));
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[aliceId].nonPlayerRelationships.length, 1);
  assert.equal(state.npcs[aliceId].nonPlayerRelationships[0].targetId, miraId);
  assert.equal(state.npcs[aliceId].nonPlayerRelationships[0].targetName, undefined);
  assert.equal(state.npcs[miraId].nonPlayerRelationships.length, 0, 'directional relation must not fabricate reciprocity');
  queue.destroy();
  adapter.destroy();
});

test('S8 A/F/L: ambiguous Development targetName across same-name NPCs fails closed without partial graph mutation', async () => {
  const { host, adapter } = await harness('s8_relationship_target_name_ambiguous');
  await turn(host, 'Who is here?', trailer('Alice arrived with two distinct women who are both named Mira.', [
    newcomer('Alice', 'new:alice', 'Alice arrived'),
    newcomer('Mira', 'new:mira-one', 'both named Mira'),
    newcomer('Mira', 'new:mira-two', 'both named Mira'),
  ]));
  const state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;
  const miraIds = findAllByName(state, 'Mira').map((npc) => npc.id);
  assert.equal(miraIds.length, 2);
  await turn(host, 'Alice, identify your sister.', trailer('Alice said that Mira is her sister, without distinguishing which Mira.', [update(aliceId, 'Mira is her sister', { mood: 'concerned' })]));

  const provider = new ScriptedProvider(async ({ prompt }) => {
    const targets = promptJson(prompt, 'TARGETS=');
    const sources = promptJson(prompt, 'SOURCES=');
    const alice = targets.find((item) => item.id === aliceId);
    const source = sources.find((item) => alice.sourceScope.includes(item.sourceRef) && item.text.includes('without distinguishing'));
    return JSON.stringify({
      version: '1',
      reviewReceipts: targets.map((item) => ({ targetId: item.id, sourceScope: item.sourceScope, status: item.id === aliceId ? 'reviewed' : 'reviewed_no_proposals' })),
      proposals: [{ targetId: aliceId, nonPlayerRelationships: { operation: 'add', relationships: [{ targetName: 'Mira', relationship: 'sister', source: { sourceRef: source.sourceRef, excerpt: 'Mira is her sister' } }] } }],
      observations: [], supportProposals: [],
    });
  });
  const queue = queueFor(adapter, host, provider);
  const result = await queue.trigger('ambiguous_family_relation', { manual: true });
  assert.equal(result.status, 'commit_failed');
  assert.match(result.commitResult.error, /Ambiguous targetName/);
  const after = (await adapter.storage.load()).state;
  assert.equal(after.npcs[aliceId].nonPlayerRelationships.length, 0);
  assert.equal(after.pendingReview.entries.length > 0, true);
  queue.destroy();
  adapter.destroy();
});

test('S8 G/L: delayed targetName relationship fails closed if the once-unique name becomes ambiguous before commit', async () => {
  const { host, adapter } = await harness('s8_target_name_race');
  await turn(host, 'Who is here?', trailer('Alice and Mira arrived.', [
    newcomer('Alice', 'new:alice', 'Alice and Mira arrived'),
    newcomer('Mira', 'new:mira-one', 'Alice and Mira arrived'),
  ]));
  let state = (await adapter.storage.load()).state;
  const aliceId = findByName(state, 'Alice').id;
  await turn(host, 'Alice, who is Mira?', trailer('Alice said Mira is her sister.', [update(aliceId, 'Mira is her sister', { mood: 'fond' })]));

  const provider = new DeferredProvider();
  const queue = queueFor(adapter, host, provider);
  const running = queue.trigger('target_name_race', { manual: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.calls.length, 1);
  const prompt = provider.calls[0].prompt;
  const targets = promptJson(prompt, 'TARGETS=');
  const sources = promptJson(prompt, 'SOURCES=');
  const alice = targets.find((item) => item.id === aliceId);
  const source = sources.find((item) => alice.sourceScope.includes(item.sourceRef) && item.text.includes('Mira is her sister'));

  await turn(host, 'Another traveler?', trailer('A different woman named Mira arrived later.', [
    newcomer('Mira', 'new:mira-two', 'different woman named Mira'),
  ]));
  provider.pending[0].resolve(JSON.stringify({
    version: '1',
    reviewReceipts: targets.map((item) => ({
      targetId: item.id,
      sourceScope: item.sourceScope,
      status: item.id === aliceId ? 'reviewed' : 'reviewed_no_proposals',
    })),
    proposals: [{
      targetId: aliceId,
      nonPlayerRelationships: {
        operation: 'add',
        relationships: [{
          targetName: 'Mira',
          relationship: 'sister',
          source: { sourceRef: source.sourceRef, excerpt: 'Mira is her sister' },
        }],
      },
    }],
    observations: [], supportProposals: [],
  }));
  const result = await running;
  assert.equal(result.status, 'commit_failed');
  assert.match(result.commitResult.error, /Ambiguous targetName/);
  state = (await adapter.storage.load()).state;
  assert.equal(state.npcs[aliceId].nonPlayerRelationships.length, 0);
  assert.equal(findAllByName(state, 'Mira').length, 2);
  queue.destroy();
  adapter.destroy();
});

test('S8 G/M: switching chats aborts old-chat Development and a late provider result cannot land in either chat', async () => {
  const { host, adapter } = await harness('s8_dev_chat_A');
  await turn(host, 'Alice?', trailer('Alice arrived in the archive.', [newcomer('Alice', 'new:alice', 'Alice arrived')]));
  let stateA = (await adapter.storage.load()).state;
  const aliceId = findByName(stateA, 'Alice').id;

  const provider = new DeferredProvider();
  const queue = queueFor(adapter, host, provider);
  adapter.setDevelopmentReview(queue);
  const running = queue.trigger('cross_chat_wait', { manual: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.calls.length, 1);
  const staleResponse = durableScalarDevelopment(provider.calls[0].prompt, 'role', 'Archivist');

  await host.switchChat('s8_dev_chat_B');
  const result = await running;
  assert.equal(result.status, 'aborted');
  provider.pending[0].resolve(staleResponse);
  await new Promise((resolve) => setImmediate(resolve));

  const stateB = (await adapter.storage.load()).state;
  assert.equal(Object.keys(stateB.npcs).length, 0);
  await host.switchChat('s8_dev_chat_A');
  stateA = (await adapter.storage.load()).state;
  assert.equal(stateA.npcs[aliceId].role, null);
  assert.ok(stateA.pendingReview.entries.some((entry) => entry.targetId === aliceId));
  queue.destroy();
  adapter.destroy();
});

test('S8 I/O/J: native portability round-trip preserves rich canonical authority state without mutating the source state', async () => {
  const state = createInitialState();
  const alice = createDefaultNpcRecord('alice', 'Alice', {
    role: 'Archivist', aliases: ['Red'], mood: 'calm', locks: { role: true },
    relationship: { trust: 2.5, affection: 1, desire: 0, tension: -0.5, lastEvaluationExchange: 'x' },
  });
  alice.manualCorrections.role = { correctedAt: '2026-09-11T00:00:00.000Z', writer: 'user', reason: 'Player correction', value: 'Archivist' };
  state.npcs.alice = alice;
  state.tombstones.removed = { deletedAt: '2026-09-11T00:01:00.000Z', reason: 'Player deletion' };
  assert.equal(validateState(state).valid, true);
  const before = JSON.stringify(state);
  const bytes1 = serializeAlphaNativeBundle(state);
  const bytes2 = serializeAlphaNativeBundle(state);
  assert.equal(bytes1, bytes2);
  const parsed = parseAlphaNativeBundle(bytes1);
  assert.equal(parsed.success, true, parsed.error);
  assert.deepEqual(parsed.state, state);
  parsed.state.npcs.alice.role = 'Mutated copy';
  assert.equal(state.npcs.alice.role, 'Archivist');
  assert.equal(JSON.stringify(state), before);
});
