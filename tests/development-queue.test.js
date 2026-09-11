import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALPHA_NAMESPACE,
  createDefaultNpcRecord,
  createInitialState,
} from '../src/state/schema.js';
import { WRITERS, DURABLE_DOSSIER_FIELDS } from '../src/contract/registry.js';
import {
  ALPHA_SETTINGS_DEFAULTS,
  normalizeAlphaSettings,
} from '../src/contract/settings.js';
import { CommitCoordinator } from '../src/runtime/commit-coordinator.js';
import { stripMachineTrailer } from '../src/runtime/source-resolver.js';
import { SillyTavernStorageAdapter } from '../src/host/storage-adapter.js';
import {
  buildDevelopmentDispatch,
  deriveDevelopmentReadDependencies,
  selectDevelopmentBatch,
} from '../src/host/development-context.js';
import {
  DevelopmentReviewQueue,
  validateDevelopmentResponseScope,
} from '../src/host/development-queue.js';
import {
  CONNECTION_MANAGER_SHARED_MODULE,
  SillyTavernDevelopmentProvider,
} from '../src/host/development-provider.js';
import { buildPrecedingLineage, getMessageSwipeId } from '../src/host/sillytavern-adapter.js';
import { computeContentFingerprint } from '../src/host/content-hash.js';
import { MockSillyTavernHost } from './fixtures/host-harness.js';

const NPC_ID = 'npc_elena';

function iso(n) {
  return `2026-09-10T09:${String(n).padStart(2, '0')}:00.000Z`;
}

function makeHostFixture({ exchanges = 3, reason = 'fast_proposal', targetId = NPC_ID } = {}) {
  const host = new MockSillyTavernHost({ chatId: 'chat_s4' });
  const state = createInitialState();
  state.npcs[targetId] = createDefaultNpcRecord(targetId, 'Elena');
  const entries = [];

  for (let i = 0; i < exchanges; i++) {
    const userText = `Tell me about your work, exchange ${i + 1}.`;
    const assistantText = `Elena says she serves as archivist number ${i + 1} and carefully closes the ledger.`;
    const userPosition = host.chat.length;
    host.chat.push({ is_user: true, is_system: false, mes: userText, swipe_id: 0, swipes: [userText] });
    const assistantPosition = host.chat.length;
    host.chat.push({ is_user: false, is_system: false, mes: assistantText, swipe_id: 0, swipes: [assistantText], extra: {} });
    const userFingerprint = computeContentFingerprint(userText);
    const assistantFingerprint = computeContentFingerprint(stripMachineTrailer(assistantText));
    entries.push({
      id: `pending_${i + 1}_${targetId}`,
      targetId,
      sourceScope: [`chat:${host.chatId}:${userPosition}`, `chat:${host.chatId}:${assistantPosition}`],
      exchangeId: `${host.chatId}:${assistantPosition}`,
      reason,
      createdAt: iso(i + 1),
      metadata: {
        userPosition,
        userSwipe: getMessageSwipeId(host.chat[userPosition]),
        assistantPosition,
        assistantSwipe: getMessageSwipeId(host.chat[assistantPosition]),
        userFingerprint,
        assistantFingerprint,
      },
    });
  }
  state.pendingReview.entries = entries;
  host.metadataByChatId.get(host.chatId)[ALPHA_NAMESPACE] = structuredClone(state);
  const storage = new SillyTavernStorageAdapter({ getContext: () => host.getContext() });
  const coordinator = new CommitCoordinator({ storage });
  return { host, state, storage, coordinator, entries, targetId };
}

function targetsFromPrompt(prompt) {
  const line = prompt.split('\n').find((value) => value.startsWith('TARGETS='));
  return JSON.parse(line.slice('TARGETS='.length));
}

function sourcesFromPrompt(prompt) {
  const line = prompt.split('\n').find((value) => value.startsWith('SOURCES='));
  return JSON.parse(line.slice('SOURCES='.length));
}

function noOpResponse(prompt) {
  const targets = targetsFromPrompt(prompt);
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

function roleResponse(prompt, role = 'Senior Archivist', options = {}) {
  const targets = targetsFromPrompt(prompt);
  const sources = sourcesFromPrompt(prompt);
  const target = targets[0];
  const assistant = sources.find((source) => source.role === 'assistant');
  const excerpt = assistant.text.includes('serves as archivist') ? 'serves as archivist' : assistant.text.slice(0, 20);
  return JSON.stringify({
    version: '1',
    reviewReceipts: targets.map((item) => ({
      targetId: item.id,
      sourceScope: item.sourceScope,
      status: 'reviewed',
    })),
    proposals: [{
      targetId: target.id,
      facts: {
        role,
        source: { sourceRef: assistant.sourceRef, excerpt },
      },
    }],
    observations: options.observation ? [{
      localObservationRef: 'obs:role:1',
      targetId: target.id,
      field: 'role',
      observation: 'Repeatedly identifies herself through archival work.',
      source: { sourceRef: assistant.sourceRef, excerpt },
      disposition: { role: 'tentative' },
    }] : [],
    supportProposals: options.support ? [{
      targetId: target.id,
      field: 'role',
      sourceRefs: [assistant.sourceRef],
      notes: 'Directly supported by the reviewed exchange.',
    }] : [],
  });
}

function observationOnlyResponse(prompt) {
  const targets = targetsFromPrompt(prompt);
  const sources = sourcesFromPrompt(prompt);
  const target = targets[0];
  const assistant = sources.find((source) => source.role === 'assistant');
  const excerpt = assistant.text.includes('serves as archivist') ? 'serves as archivist' : assistant.text.slice(0, 20);
  return JSON.stringify({
    version: '1',
    reviewReceipts: targets.map((item) => ({
      targetId: item.id,
      sourceScope: item.sourceScope,
      status: 'reviewed',
    })),
    proposals: [],
    observations: [{
      localObservationRef: 'obs:role:only',
      targetId: target.id,
      field: 'role',
      observation: 'The reviewed exchange presents archival work as a possible durable role signal.',
      source: { sourceRef: assistant.sourceRef, excerpt },
      disposition: { role: 'tentative' },
    }],
    supportProposals: [{
      targetId: target.id,
      field: 'role',
      sourceRefs: [assistant.sourceRef],
      notes: 'Source support is provisional until the read dependency still matches.',
    }],
  });
}

function tentativeRoleObservationResponse(prompt) {
  const targets = targetsFromPrompt(prompt);
  const sources = sourcesFromPrompt(prompt);
  const target = targets[0];
  const assistant = sources.find((source) => source.role === 'assistant');
  const excerpt = assistant.text.includes('serves as archivist') ? 'serves as archivist' : assistant.text.slice(0, 20);
  return JSON.stringify({
    version: '1',
    reviewReceipts: targets.map((item) => ({
      targetId: item.id,
      sourceScope: item.sourceScope,
      status: 'reviewed',
      ...(Array.isArray(item.fieldSubset) ? { restricted: true, fieldSubset: item.fieldSubset } : {}),
    })),
    proposals: [],
    observations: [{
      localObservationRef: 'obs:role:tentative',
      targetId: target.id,
      field: 'role',
      observation: 'Her archival work may indicate a durable professional role.',
      source: { sourceRef: assistant.sourceRef, excerpt },
      disposition: { role: 'tentative' },
    }],
    supportProposals: [],
  });
}

function promoteRetainedRoleObservationResponse(prompt) {
  const targets = targetsFromPrompt(prompt);
  const sources = sourcesFromPrompt(prompt);
  const target = targets[0];
  const assistant = sources.find((source) => source.role === 'assistant');
  const retained = target.observations.find((observation) => observation.field === 'role');
  const excerpt = assistant.text.includes('serves as archivist') ? 'serves as archivist' : assistant.text.slice(0, 20);
  return JSON.stringify({
    version: '1',
    reviewReceipts: targets.map((item) => ({
      targetId: item.id,
      sourceScope: item.sourceScope,
      status: 'reviewed',
      ...(Array.isArray(item.fieldSubset) ? { restricted: true, fieldSubset: item.fieldSubset } : {}),
    })),
    proposals: [{
      targetId: target.id,
      facts: {
        role: 'Archivist',
        source: { sourceRef: assistant.sourceRef, excerpt },
      },
    }],
    observations: [],
    supportProposals: [{
      targetId: target.id,
      field: 'role',
      supportingObservationIds: [retained.id],
    }],
  });
}

class ScriptedProvider {
  constructor(fn, { requiresConfiguredProfile = false } = {}) {
    this.fn = fn;
    this.calls = [];
    this.requiresConfiguredProfile = requiresConfiguredProfile;
  }
  async sendReview(request) {
    this.calls.push(request);
    const value = await this.fn(request, this.calls.length);
    return typeof value === 'string' ? { text: value } : value;
  }
}

class DeferredProvider {
  constructor() {
    this.requiresConfiguredProfile = false;
    this.calls = [];
    this.pending = [];
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
        reject,
      });
    });
  }
}

function makeQueue(fixture, provider, settings = {}) {
  return new DevelopmentReviewQueue({
    storage: fixture.storage,
    coordinator: fixture.coordinator,
    getContext: () => fixture.host.getContext(),
    provider,
    settings: {
      developmentConnectionProfile: 'test-profile',
      ...settings,
    },
  });
}

test('S4 Settings: one registry defaults cadence=3 and normalizes cadence 1..10', () => {
  assert.equal(ALPHA_SETTINGS_DEFAULTS.developmentCadence, 3);
  assert.equal(normalizeAlphaSettings({}).developmentCadence, 3);
  assert.equal(normalizeAlphaSettings({ developmentCadence: -2 }).developmentCadence, 1);
  assert.equal(normalizeAlphaSettings({ developmentCadence: 40 }).developmentCadence, 10);
  assert.equal(normalizeAlphaSettings({ developmentCadence: 5 }).developmentCadence, 5);
});

test('S4 Scheduler: new NPC is immediately eligible, existing NPC waits for configured cadence', () => {
  const existing2 = makeHostFixture({ exchanges: 2 });
  assert.equal(selectDevelopmentBatch(existing2.state, { developmentCadence: 3 }).length, 0);
  const existing3 = makeHostFixture({ exchanges: 3 });
  assert.equal(selectDevelopmentBatch(existing3.state, { developmentCadence: 3 }).length, 3);
  const admitted = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  assert.equal(selectDevelopmentBatch(admitted.state, { developmentCadence: 3 }).length, 1);
});

test('S4 Scheduler: batch is oldest-first and capped at six distinct exchanges', () => {
  const fixture = makeHostFixture({ exchanges: 9 });
  const selected = selectDevelopmentBatch(fixture.state, { developmentCadence: 1 });
  assert.equal(selected.length, 6);
  assert.deepEqual(selected.map((entry) => entry.id), fixture.entries.slice(0, 6).map((entry) => entry.id));
});

test('S4 Scheduler: failed/deferred/unavailable work does not tight-loop until fresh evidence or manual review', () => {
  const fixture = makeHostFixture({ exchanges: 1 });
  fixture.entries[0].metadata.lastReviewStatus = 'failed';
  fixture.entries[0].metadata.lastFailureAt = '2026-09-10T09:10:00.000Z';
  assert.equal(selectDevelopmentBatch(fixture.state, { developmentCadence: 1 }).length, 0);
  assert.equal(selectDevelopmentBatch(fixture.state, { developmentCadence: 1 }, { manual: true }).length, 1);
  const newer = structuredClone(fixture.entries[0]);
  newer.id = 'pending_fresh';
  newer.exchangeId = 'chat_s4:fresh';
  newer.createdAt = '2026-09-10T09:11:00.000Z';
  newer.metadata = { ...newer.metadata, lastReviewStatus: undefined, lastFailureAt: undefined };
  fixture.state.pendingReview.entries.push(newer);
  assert.equal(selectDevelopmentBatch(fixture.state, { developmentCadence: 1 }).length, 2);
});

test('S4 Scheduler: blocked entry is not accidentally retried because an older sibling target is otherwise eligible', () => {
  const fixture = makeHostFixture({ exchanges: 2 });
  fixture.entries[0].metadata.lastReviewStatus = 'failed';
  fixture.entries[0].metadata.lastFailureAt = '2026-09-10T09:10:00.000Z';
  const selected = selectDevelopmentBatch(fixture.state, { developmentCadence: 1 });
  assert.deepEqual(selected.map((entry) => entry.id), [fixture.entries[1].id]);
});

test('S4 Context: dispatch captures exact owned sources, revisions, full durable menu, and strips machine transport from prompt', () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const assistantPos = fixture.entries[0].metadata.assistantPosition;
  const narrative = fixture.host.chat[assistantPos].mes;
  fixture.host.chat[assistantPos].mes = `${narrative}\n<npc_state_alpha_v1>\n{"version":"1","proposals":[]}\n</npc_state_alpha_v1>`;
  fixture.entries[0].metadata.assistantFingerprint = computeContentFingerprint(narrative);
  fixture.state.pendingReview.entries = fixture.entries;
  const dispatch = buildDevelopmentDispatch({
    state: fixture.state,
    chat: fixture.host.chat,
    chatId: fixture.host.chatId,
    entries: fixture.entries,
    settings: { developmentCadence: 1 },
  });
  assert.equal(dispatch.valid, true);
  assert.equal(dispatch.capturedDependencies.length, 2);
  assert.equal(dispatch.prompt.includes('<npc_state_alpha_v1>'), false);
  for (const field of DURABLE_DOSSIER_FIELDS) assert.match(dispatch.prompt, new RegExp(field));
  assert.ok(dispatch.revisionSnapshot[NPC_ID].role > 0);
});

test('S4 Scope guard rejects unsupplied target/source and missing target receipt', () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const dispatch = buildDevelopmentDispatch({ state: fixture.state, chat: fixture.host.chat, chatId: fixture.host.chatId, entries: fixture.entries });
  const bad = {
    version: '1',
    reviewReceipts: [{ targetId: 'npc_other', sourceScope: ['msg:fake'], status: 'reviewed' }],
    proposals: [], observations: [], supportProposals: [],
  };
  const result = validateDevelopmentResponseScope(bad, dispatch);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('not supplied')));
  assert.ok(result.errors.some((error) => error.includes('Missing review receipt')));
});

test('S4 Provider adapter uses ConnectionManagerRequestService selected profile, non-streaming signal, and preserves exposed usage', async () => {
  const calls = [];
  const fakeService = {
    getProfile(id) { if (id !== 'profile-1') throw new Error('missing'); return { id, api: 'openai', model: 'test' }; },
    async sendRequest(profileId, prompt, maxTokens, custom) {
      calls.push({ profileId, prompt, maxTokens, custom });
      return { content: '{"version":"1"}', reasoning: 'r', usage: { total_tokens: 42 } };
    },
  };
  const provider = new SillyTavernDevelopmentProvider({
    moduleLoader: async (specifier) => {
      assert.equal(specifier, CONNECTION_MANAGER_SHARED_MODULE);
      return { ConnectionManagerRequestService: fakeService };
    },
  });
  const controller = new AbortController();
  const result = await provider.sendReview({ profileId: 'profile-1', prompt: 'review', maxTokens: 500, signal: controller.signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].custom.stream, false);
  assert.equal(calls[0].custom.signal, controller.signal);
  assert.equal(calls[0].custom.extractData, true);
  assert.deepEqual(result.usage, { total_tokens: 42 });
});

test('S4 Provider adapter fails closed when selected profile is missing', async () => {
  const provider = new SillyTavernDevelopmentProvider({
    moduleLoader: async () => ({
      ConnectionManagerRequestService: {
        getProfile() { throw new Error('Profile not found'); },
        async sendRequest() { throw new Error('must not call'); },
      },
    }),
  });
  await assert.rejects(() => provider.sendReview({ profileId: 'gone', prompt: 'x', maxTokens: 100 }), /Profile not found/);
});

test('S4 Provider adapter rejects null profile lookup before request dispatch', async () => {
  let sendCalls = 0;
  const provider = new SillyTavernDevelopmentProvider({
    moduleLoader: async () => ({
      ConnectionManagerRequestService: {
        getProfile() { return null; },
        async sendRequest() { sendCalls++; return { content: '{}'}; },
      },
    }),
  });
  await assert.rejects(
    () => provider.sendReview({ profileId: 'deleted-profile', prompt: 'x', maxTokens: 100 }),
    (error) => error?.code === 'development_profile_missing',
  );
  assert.equal(sendCalls, 0);
});

test('S4 Queue: missing selected profile pauses without provider request or pending loss', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const provider = new ScriptedProvider(async () => noOpResponse(''), { requiresConfiguredProfile: true });
  const queue = makeQueue(fixture, provider, { developmentConnectionProfile: null });
  const result = await queue.trigger('test');
  assert.equal(result.status, 'paused');
  assert.equal(provider.calls.length, 0);
  const loaded = await fixture.storage.load();
  assert.equal(loaded.state.pendingReview.entries.length, 1);
});

test('S4 Queue: new NPC early review drains pending with no-op receipt and preserves provider usage metadata', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const provider = new ScriptedProvider(async ({ prompt }) => ({ text: noOpResponse(prompt), usage: { total_tokens: 77 } }));
  const queue = makeQueue(fixture, provider);
  const result = await queue.trigger('new_npc');
  assert.equal(result.status, 'committed');
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(queue.getStatus().lastProviderUsage, { total_tokens: 77 });
  const loaded = await fixture.storage.load();
  assert.equal(loaded.state.pendingReview.entries.length, 0);
  assert.equal(loaded.state.npcs[NPC_ID].development.reviewReceipts.at(-1).status, 'reviewed_no_proposals');
});

test('S5 Queue notifications: late Development completion publishes bounded start/settled events and unsubscribe is stable', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const provider = new DeferredProvider();
  const queue = makeQueue(fixture, provider);
  const events = [];
  const unsubscribe = queue.subscribe((event) => events.push(event));

  const running = queue.trigger('ui_late_review');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(events[0].phase, 'started');
  assert.equal(events[0].chatId, fixture.host.chatId);

  provider.pending[0].resolve(noOpResponse(provider.calls[0].prompt));
  const result = await running;
  assert.equal(result.status, 'committed');
  assert.equal(events.at(-1).phase, 'settled');
  assert.equal(events.at(-1).result.status, 'committed');

  const countBeforeUnsubscribe = events.length;
  unsubscribe();
  unsubscribe();
  await queue.trigger('after_unsubscribe');
  assert.equal(events.length, countBeforeUnsubscribe);
});

test('S4 Observation follow-up: tentative evidence narrows the original pending scope, does not auto-loop, and manual review reuses owned evidence', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  let phase = 0;
  const provider = new ScriptedProvider(async ({ prompt }) => {
    phase++;
    if (phase === 1) return tentativeRoleObservationResponse(prompt);

    const targets = targetsFromPrompt(prompt);
    const sources = sourcesFromPrompt(prompt);
    assert.equal(targets.length, 1);
    assert.deepEqual(targets[0].fieldSubset, ['role']);
    assert.deepEqual(Object.keys(targets[0].current), []);
    assert.equal(targets[0].observations.length, 1);
    assert.equal(targets[0].observations[0].field, 'role');
    assert.equal(sources.length, 2);
    assert.ok(sources.some((source) => source.role === 'user'));
    assert.ok(sources.some((source) => source.role === 'assistant' && source.text.includes('serves as archivist')));
    return promoteRetainedRoleObservationResponse(prompt);
  });
  const queue = makeQueue(fixture, provider);

  const first = await queue.trigger('first_review');
  assert.equal(first.status, 'committed');
  assert.equal(provider.calls.length, 1);
  let loaded = await fixture.storage.load();
  const pending = loaded.state.pendingReview.entries[0];
  assert.equal(loaded.state.pendingReview.entries.length, 1);
  assert.equal(pending.id, fixture.entries[0].id);
  assert.equal(pending.reason, 'observation_followup');
  assert.deepEqual(pending.fieldSubset, ['role']);
  assert.equal(pending.metadata.lastReviewStatus, 'deferred');
  assert.equal(loaded.state.npcs[NPC_ID].development.observations.length, 1);
  assert.equal(loaded.state.npcs[NPC_ID].role, null);

  const automatic = await queue.trigger('automatic_repeat');
  assert.equal(automatic.status, 'idle');
  assert.equal(provider.calls.length, 1);

  const manual = await queue.trigger('manual_observation_followup', { manual: true });
  assert.equal(manual.status, 'committed');
  assert.equal(provider.calls.length, 2);
  loaded = await fixture.storage.load();
  assert.equal(loaded.state.pendingReview.entries.length, 0);
  assert.equal(loaded.state.npcs[NPC_ID].role, 'Archivist');
  assert.equal(loaded.state.npcs[NPC_ID].development.acceptedSupport.length, 1);
  assert.deepEqual(
    loaded.state.npcs[NPC_ID].development.acceptedSupport[0].supportingObservationIds,
    [loaded.state.npcs[NPC_ID].development.observations[0].id],
  );
});

test('S4 Queue: existing NPC cadence waits at two and dispatches once the third pending exchange exists', async () => {
  const fixture = makeHostFixture({ exchanges: 2 });
  const provider = new ScriptedProvider(async ({ prompt }) => noOpResponse(prompt));
  const queue = makeQueue(fixture, provider, { developmentCadence: 3 });
  assert.equal((await queue.trigger('two')).status, 'idle');
  assert.equal(provider.calls.length, 0);

  const thirdFixture = makeHostFixture({ exchanges: 3 });
  const provider2 = new ScriptedProvider(async ({ prompt }) => noOpResponse(prompt));
  const queue2 = makeQueue(thirdFixture, provider2, { developmentCadence: 3 });
  assert.equal((await queue2.trigger('three')).status, 'committed');
  assert.equal(provider2.calls.length, 1);
  assert.equal((await thirdFixture.storage.load()).state.pendingReview.entries.length, 0);
});

test('S4 Queue: each request stays at six exchanges while successful backlog drains through bounded follow-ups', async () => {
  const fixture = makeHostFixture({ exchanges: 8 });
  const provider = new ScriptedProvider(async ({ prompt }) => noOpResponse(prompt));
  const queue = makeQueue(fixture, provider, { developmentCadence: 1 });
  const result = await queue.trigger('batch');
  assert.equal(result.status, 'committed');
  assert.equal(provider.calls.length, 2);
  assert.equal(targetsFromPrompt(provider.calls[0].prompt)[0].sourceScope.length, 12);
  assert.equal(targetsFromPrompt(provider.calls[1].prompt)[0].sourceScope.length, 4);
  const loaded = await fixture.storage.load();
  assert.equal(loaded.state.pendingReview.entries.length, 0);
});

test('S4 Queue: coalesced triggers never duplicate an in-flight provider request', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const provider = new DeferredProvider();
  const queue = makeQueue(fixture, provider);
  const first = queue.trigger('first');
  const second = queue.trigger('second');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.calls.length, 1);
  provider.pending[0].resolve(noOpResponse(provider.calls[0].prompt));
  await Promise.all([first, second]);
  await queue.waitForIdle();
  assert.equal(provider.calls.length, 1);
});

test('S4 Queue: foreground priority aborts background provider wait and leaves pending state untouched', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const provider = new DeferredProvider();
  const queue = makeQueue(fixture, provider);
  const running = queue.trigger('background');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.calls.length, 1);
  assert.equal(queue.onForegroundStart(fixture.host.chatId), true);
  const result = await running;
  assert.equal(result.status, 'aborted');
  assert.equal((await fixture.storage.load()).state.pendingReview.entries.length, 1);
});

test('S5 Settings: disabling Development aborts an in-flight background review and preserves pending work', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const provider = new DeferredProvider();
  const queue = makeQueue(fixture, provider);
  const running = queue.trigger('background_before_disable');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.calls.length, 1);

  queue.onSettingsChanged({ ...ALPHA_SETTINGS_DEFAULTS, developmentEnabled: false });
  const result = await running;
  assert.equal(result.status, 'aborted');
  assert.equal((await fixture.storage.load()).state.pendingReview.entries.length, 1);
});

test('S4 Concurrency: provider wait holds no state lock; an unrelated foreground/user commit succeeds while review is waiting', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const provider = new DeferredProvider();
  const queue = makeQueue(fixture, provider);
  const running = queue.trigger('background');
  await new Promise((resolve) => setImmediate(resolve));
  const foreground = await fixture.coordinator.commit({
    writer: WRITERS.USER,
    identityProposals: [{ id: NPC_ID }],
    fieldProposals: { [NPC_ID]: { mood: 'Alert after a bell rings' } },
  });
  assert.equal(foreground.success, true, JSON.stringify(foreground));
  provider.pending[0].resolve(roleResponse(provider.calls[0].prompt));
  const result = await running;
  assert.equal(result.status, 'committed');
  const loaded = await fixture.storage.load();
  assert.equal(loaded.state.npcs[NPC_ID].mood, 'Alert after a bell rings');
  assert.equal(loaded.state.npcs[NPC_ID].role, 'Senior Archivist');
});

test('S4 Concurrency: late Development result cannot overwrite a newer durable field and keeps affected pending work', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const provider = new DeferredProvider();
  const queue = makeQueue(fixture, provider);
  const running = queue.trigger('background');
  await new Promise((resolve) => setImmediate(resolve));
  const newer = await fixture.coordinator.commit({
    writer: WRITERS.USER,
    identityProposals: [{ id: NPC_ID }],
    fieldProposals: { [NPC_ID]: { role: 'Chief Royal Archivist' } },
  });
  assert.equal(newer.success, true, JSON.stringify(newer));
  provider.pending[0].resolve(roleResponse(provider.calls[0].prompt, 'Senior Archivist'));
  const result = await running;
  assert.equal(result.status, 'committed');
  assert.ok(result.commitResult.deferred.some((item) => item.field === 'role'));
  const loaded = await fixture.storage.load();
  assert.equal(loaded.state.npcs[NPC_ID].role, 'Chief Royal Archivist');
  assert.equal(loaded.state.pendingReview.entries.length, 1);
  assert.equal(loaded.state.pendingReview.entries[0].metadata.lastReviewStatus, 'deferred');
});

test('S5 Concurrency: user lock added while Development is waiting blocks the late field proposal without globally blocking state', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const provider = new DeferredProvider();
  const queue = makeQueue(fixture, provider);
  const running = queue.trigger('background_before_lock');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.calls.length, 1);

  const lockCommit = await fixture.coordinator.commit({
    writer: WRITERS.USER,
    fieldProposals: { [NPC_ID]: { locks: { role: true } } },
  });
  assert.equal(lockCommit.success, true, JSON.stringify(lockCommit));

  provider.pending[0].resolve(roleResponse(provider.calls[0].prompt, 'Senior Archivist'));
  const result = await running;
  assert.equal(result.status, 'committed');
  assert.ok(result.commitResult.deferred.some((item) => item.field === 'role' && item.reason === 'locked'));

  const loaded = await fixture.storage.load();
  assert.equal(loaded.state.npcs[NPC_ID].role, null, 'Late Development result cannot bypass the newly added lock.');
  assert.equal(loaded.state.npcs[NPC_ID].locks.role, true);
  assert.equal(loaded.state.pendingReview.entries.length, 1, 'Blocked source remains pending for later user-directed reconsideration.');
  assert.equal(loaded.state.pendingReview.entries[0].metadata.lastReviewStatus, 'deferred');
});

test('S4 Concurrency: stale observation/support-only result is deferred and cannot enter durable Development records', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const baseline = await fixture.coordinator.commit({
    writer: WRITERS.USER,
    identityProposals: [{ id: NPC_ID }],
    fieldProposals: { [NPC_ID]: { role: 'Archivist' } },
  });
  assert.equal(baseline.success, true, JSON.stringify(baseline));

  const provider = new DeferredProvider();
  const queue = makeQueue(fixture, provider);
  const running = queue.trigger('observation_only');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.calls.length, 1);

  const newer = await fixture.coordinator.commit({
    writer: WRITERS.USER,
    identityProposals: [{ id: NPC_ID }],
    fieldProposals: { [NPC_ID]: { role: 'Chief Royal Archivist' } },
  });
  assert.equal(newer.success, true, JSON.stringify(newer));

  provider.pending[0].resolve(observationOnlyResponse(provider.calls[0].prompt));
  const result = await running;
  assert.equal(result.status, 'committed');
  assert.ok(result.commitResult.deferred.some((item) => item.field === 'role'));
  const loaded = await fixture.storage.load();
  const npc = loaded.state.npcs[NPC_ID];
  assert.equal(npc.role, 'Chief Royal Archivist');
  assert.equal(npc.development.observations.length, 0);
  assert.equal(npc.development.acceptedSupport.length, 0);
  assert.equal(npc.development.reviewReceipts.at(-1).status, 'deferred');
  assert.equal(loaded.state.pendingReview.entries.length, 1);
  assert.equal(loaded.state.pendingReview.entries[0].metadata.lastReviewStatus, 'deferred');
});

test('S4 CommitCoordinator: only Development may resolve pending review scope', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const resolution = [{
    id: fixture.entries[0].id,
    targetId: NPC_ID,
    sourceScope: [...fixture.entries[0].sourceScope],
  }];

  for (const writer of [WRITERS.ONE_PASS, WRITERS.RUNTIME, WRITERS.USER]) {
    const result = await fixture.coordinator.commit({
      writer,
      pendingReviewResolutions: resolution,
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'pending_review_resolution_wrong_writer');
  }

  const loaded = await fixture.storage.load();
  assert.equal(loaded.state.pendingReview.entries.length, 1);
});

test('S4 CommitCoordinator: accepted support requires an established canonical value at the shared boundary', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const assistantRef = fixture.entries[0].sourceScope[1];

  const development = await fixture.coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    supportProposals: [{
      targetId: NPC_ID,
      field: 'role',
      sourceRefs: [assistantRef],
    }],
  });
  assert.equal(development.success, false);
  assert.equal(development.errorCode, 'support_without_accepted_value');

  const runtime = await fixture.coordinator.commit({
    writer: WRITERS.RUNTIME,
    acceptedSupport: [{
      targetId: NPC_ID,
      field: 'role',
      fieldRevision: '1',
      sourceRefs: [assistantRef],
    }],
  });
  assert.equal(runtime.success, false);
  assert.equal(runtime.errorCode, 'support_without_accepted_value');

  const established = await fixture.coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: NPC_ID }],
    fieldProposals: { [NPC_ID]: { role: 'Archivist' } },
    supportProposals: [{
      targetId: NPC_ID,
      field: 'role',
      sourceRefs: [assistantRef],
    }],
  });
  assert.equal(established.success, true, JSON.stringify(established));
  const loaded = await fixture.storage.load();
  assert.equal(loaded.state.npcs[NPC_ID].role, 'Archivist');
  assert.equal(loaded.state.npcs[NPC_ID].development.acceptedSupport.length, 1);
});

test('S4 CommitCoordinator: cross-field dependency defers only dependent field while independent sibling commits', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const loaded0 = await fixture.storage.load();
  const roleRev = loaded0.state.npcs[NPC_ID].fieldRevisions.role;
  const dynamicRev = loaded0.state.npcs[NPC_ID].fieldRevisions.relationshipDynamic;
  const relRev = loaded0.state.npcs[NPC_ID].fieldRevisions.relationshipEvaluation;
  const bumped = structuredClone(loaded0.state);
  bumped.npcs[NPC_ID].fieldRevisions.relationshipEvaluation++;
  const save = await fixture.storage.save(bumped, loaded0.revision);
  assert.equal(save.success, true);

  const result = await fixture.coordinator.commit({
    writer: WRITERS.DEVELOPMENT,
    identityProposals: [{ id: NPC_ID }],
    readFieldRevisions: { [NPC_ID]: { role: roleRev, relationshipDynamic: dynamicRev } },
    readFieldDependencies: { [NPC_ID]: { relationshipDynamic: { relationshipEvaluation: relRev } } },
    fieldProposals: { [NPC_ID]: { role: 'Archivist', relationshipDynamic: 'Guarded but respectful' } },
  });
  assert.equal(result.success, true);
  const loaded = await fixture.storage.load();
  assert.equal(loaded.state.npcs[NPC_ID].role, 'Archivist');
  assert.equal(loaded.state.npcs[NPC_ID].relationshipDynamic, null);
  assert.ok(result.deferred.some((item) => item.field === 'relationshipDynamic' && item.reason === 'dependent_read_changed'));
});

test('S4 Development records: observation, accepted support, receipt, field update, and pending resolution persist atomically', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const provider = new ScriptedProvider(async ({ prompt }) => roleResponse(prompt, 'Senior Archivist', { observation: true, support: true }));
  const queue = makeQueue(fixture, provider);
  const result = await queue.trigger('records');
  assert.equal(result.status, 'committed');
  const loaded = await fixture.storage.load();
  const npc = loaded.state.npcs[NPC_ID];
  assert.equal(npc.role, 'Senior Archivist');
  assert.equal(npc.development.observations.length, 1);
  assert.equal(npc.development.acceptedSupport.length, 1);
  assert.equal(npc.development.acceptedSupport[0].field, 'role');
  assert.equal(npc.development.reviewReceipts.at(-1).status, 'reviewed');
  assert.equal(loaded.state.pendingReview.entries.length, 0);
});

test('S4 Recovery: pending review survives scheduler/storage re-instantiation and drains after reload', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const pausedProvider = new ScriptedProvider(async ({ prompt }) => noOpResponse(prompt), { requiresConfiguredProfile: true });
  const queue1 = makeQueue(fixture, pausedProvider, { developmentConnectionProfile: null });
  assert.equal((await queue1.trigger('before_reload')).status, 'paused');
  queue1.destroy();

  const storage2 = new SillyTavernStorageAdapter({ getContext: () => fixture.host.getContext() });
  const coordinator2 = new CommitCoordinator({ storage: storage2 });
  const provider2 = new ScriptedProvider(async ({ prompt }) => noOpResponse(prompt));
  const queue2 = new DevelopmentReviewQueue({
    storage: storage2,
    coordinator: coordinator2,
    getContext: () => fixture.host.getContext(),
    provider: provider2,
    settings: { developmentConnectionProfile: 'test-profile' },
  });
  const result = await queue2.trigger('after_reload');
  assert.equal(result.status, 'committed');
  assert.equal(provider2.calls.length, 1);
  assert.equal((await storage2.load()).state.pendingReview.entries.length, 0);
});

test('S4 Failure recovery: provider failure is durable, no automatic tight retry, manual retry succeeds', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  let fail = true;
  const provider = new ScriptedProvider(async ({ prompt }) => {
    if (fail) throw Object.assign(new Error('temporary'), { code: 'temporary_provider_failure' });
    return noOpResponse(prompt);
  });
  const queue = makeQueue(fixture, provider);
  assert.equal((await queue.trigger('fail')).status, 'provider_failed');
  let loaded = await fixture.storage.load();
  assert.equal(loaded.state.pendingReview.entries[0].metadata.lastReviewStatus, 'failed');
  assert.equal((await queue.trigger('automatic_again')).status, 'idle');
  assert.equal(provider.calls.length, 1);
  fail = false;
  assert.equal((await queue.trigger('manual', { manual: true })).status, 'committed');
  loaded = await fixture.storage.load();
  assert.equal(loaded.state.pendingReview.entries.length, 0);
});

test('S4 Source recovery: edited pending evidence is marked unavailable without provider call', async () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  fixture.host.chat[fixture.entries[0].metadata.userPosition].mes = 'Tampered user text';
  const provider = new ScriptedProvider(async ({ prompt }) => noOpResponse(prompt));
  const queue = makeQueue(fixture, provider);
  const result = await queue.trigger('stale_source');
  assert.equal(result.status, 'source_unavailable');
  assert.equal(provider.calls.length, 0);
  const loaded = await fixture.storage.load();
  assert.equal(loaded.state.pendingReview.entries[0].metadata.lastReviewStatus, 'unavailable');
});

test('S4 Scope guard rejects a target citing another target\'s supplied exchange', () => {
  const dispatch = {
    targetIds: ['npc_a', 'npc_b'],
    targetSourceScope: {
      npc_a: ['chat:scope:1'],
      npc_b: ['chat:scope:3'],
    },
    entries: [
      { targetId: 'npc_a', sourceScope: ['chat:scope:1'] },
      { targetId: 'npc_b', sourceScope: ['chat:scope:3'] },
    ],
  };
  const envelope = {
    version: '1',
    reviewReceipts: [
      { targetId: 'npc_a', sourceScope: ['chat:scope:1'], status: 'reviewed' },
      { targetId: 'npc_b', sourceScope: ['chat:scope:3'], status: 'reviewed_no_proposals' },
    ],
    proposals: [{
      targetId: 'npc_a',
      facts: {
        role: 'Archivist',
        source: { sourceRef: 'chat:scope:3', excerpt: 'Archivist' },
      },
    }],
    observations: [],
    supportProposals: [],
  };
  const result = validateDevelopmentResponseScope(envelope, dispatch);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("outside that target's supplied scope")));
});

test('S4 Restricted follow-up scope rejects durable work outside the required field subset', () => {
  const dispatch = {
    targetIds: ['npc_a'],
    targetSourceScope: { npc_a: ['chat:scope:1'] },
    targetFieldSubset: { npc_a: ['role'] },
    entries: [{ targetId: 'npc_a', sourceScope: ['chat:scope:1'], fieldSubset: ['role'] }],
  };
  const envelope = {
    version: '1',
    reviewReceipts: [{
      targetId: 'npc_a',
      sourceScope: ['chat:scope:1'],
      status: 'reviewed',
      restricted: true,
      fieldSubset: ['role'],
    }],
    proposals: [{
      targetId: 'npc_a',
      facts: {
        species: 'Elf',
        source: { sourceRef: 'chat:scope:1', excerpt: 'Elf' },
      },
    }],
    observations: [],
    supportProposals: [],
  };
  const result = validateDevelopmentResponseScope(envelope, dispatch);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("out-of-scope durable field 'species'")));
});

test('S4 Receipt scope rejects another target\'s source even when that source exists in the same batch', () => {
  const dispatch = {
    targetIds: ['npc_a', 'npc_b'],
    targetSourceScope: {
      npc_a: ['chat:scope:1'],
      npc_b: ['chat:scope:3'],
    },
    targetFieldSubset: { npc_a: null, npc_b: null },
    entries: [
      { targetId: 'npc_a', sourceScope: ['chat:scope:1'] },
      { targetId: 'npc_b', sourceScope: ['chat:scope:3'] },
    ],
  };
  const envelope = {
    version: '1',
    reviewReceipts: [
      { targetId: 'npc_a', sourceScope: ['chat:scope:3'], status: 'reviewed_no_proposals' },
      { targetId: 'npc_b', sourceScope: ['chat:scope:3'], status: 'reviewed_no_proposals' },
    ],
    proposals: [],
    observations: [],
    supportProposals: [],
  };
  const result = validateDevelopmentResponseScope(envelope, dispatch);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("outside target 'npc_a' supplied scope")));
  assert.ok(result.errors.some((error) => error.includes("does not acknowledge supplied source 'chat:scope:1'")));
});

test('S4 Retained observation IDs are unusable when their original owned source is not supplied', () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  fixture.state.npcs[NPC_ID].development.observations.push({
    id: 'obs_old_unsupplied',
    targetId: NPC_ID,
    field: 'role',
    observation: 'An older exchange hinted at archival duties.',
    source: {
      sourceRef: `chat:${fixture.host.chatId}:42`,
      excerpt: 'archival duties',
      segmentKind: 'narrative',
    },
    disposition: { role: 'tentative' },
  });
  const dispatch = buildDevelopmentDispatch({
    state: fixture.state,
    chat: fixture.host.chat,
    chatId: fixture.host.chatId,
    entries: fixture.entries,
  });
  assert.equal(dispatch.valid, true);
  assert.deepEqual(dispatch.targetObservationIds[NPC_ID], []);
  assert.equal((targetsFromPrompt(dispatch.prompt)[0].observations || []).length, 0);

  const envelope = {
    version: '1',
    reviewReceipts: [{
      targetId: NPC_ID,
      sourceScope: fixture.entries[0].sourceScope,
      status: 'reviewed',
    }],
    proposals: [],
    observations: [],
    supportProposals: [{
      targetId: NPC_ID,
      field: 'role',
      supportingObservationIds: ['obs_old_unsupplied'],
    }],
  };
  const result = validateDevelopmentResponseScope(envelope, dispatch);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("without its owned source in this request")));
});

test('S4 Scope guard rejects support for an unknown durable field unless the same response establishes it', () => {
  const fixture = makeHostFixture({ exchanges: 1, reason: 'new_admission' });
  const dispatch = buildDevelopmentDispatch({
    state: fixture.state,
    chat: fixture.host.chat,
    chatId: fixture.host.chatId,
    entries: fixture.entries,
  });
  const assistantRef = fixture.entries[0].sourceScope[1];

  const unsupported = {
    version: '1',
    reviewReceipts: [{
      targetId: NPC_ID,
      sourceScope: fixture.entries[0].sourceScope,
      status: 'reviewed',
    }],
    proposals: [],
    observations: [],
    supportProposals: [{ targetId: NPC_ID, field: 'role', sourceRefs: [assistantRef] }],
  };
  const rejected = validateDevelopmentResponseScope(unsupported, dispatch);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some((error) => error.includes('has no accepted value and no same-response durable proposal')));

  const supported = structuredClone(unsupported);
  supported.proposals = [{
    targetId: NPC_ID,
    facts: {
      role: 'Archivist',
      source: { sourceRef: assistantRef, excerpt: 'serves as archivist' },
    },
  }];
  const accepted = validateDevelopmentResponseScope(supported, dispatch);
  assert.equal(accepted.valid, true, accepted.errors.join('; '));
});

test('S4 Late source invalidation marks only affected pending scope unavailable', async () => {
  const fixture = makeHostFixture({ exchanges: 2, reason: 'new_admission' });
  const otherId = 'npc_mira';
  fixture.state.npcs[otherId] = createDefaultNpcRecord(otherId, 'Mira');
  fixture.entries[1].targetId = otherId;
  fixture.state.pendingReview.entries = fixture.entries;
  fixture.host.metadataByChatId.get(fixture.host.chatId)[ALPHA_NAMESPACE] = structuredClone(fixture.state);

  const provider = new DeferredProvider();
  const queue = makeQueue(fixture, provider);
  const running = queue.trigger('late_source');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.calls.length, 1);

  const changedPosition = fixture.entries[1].metadata.assistantPosition;
  fixture.host.chat[changedPosition].mes = 'Mira now says something different from the captured source.';
  provider.pending[0].resolve(noOpResponse(provider.calls[0].prompt));
  for (let i = 0; i < 20 && provider.calls.length < 2; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(provider.calls.length, 2);
  provider.pending[1].resolve(noOpResponse(provider.calls[1].prompt));
  const result = await running;
  assert.equal(result.status, 'late_source_unavailable');
  assert.deepEqual(result.unavailable, [fixture.entries[1].id]);

  const loaded = await fixture.storage.load();
  const first = loaded.state.pendingReview.entries.find((entry) => entry.id === fixture.entries[0].id);
  const second = loaded.state.pendingReview.entries.find((entry) => entry.id === fixture.entries[1].id);
  assert.equal(first, undefined);
  assert.equal(second.metadata.lastReviewStatus, 'unavailable');
});

test('S4 Read dependency derivation keeps cross-field dependencies attached to their Development field', () => {
  const snapshot = {
    [NPC_ID]: { role: 2, relationshipDynamic: 3, relationshipEvaluation: 4, lifeState: 5, currentForm: 6, canonicalAppearance: 7 },
  };
  const envelope = {
    proposals: [{ targetId: NPC_ID, relationshipDynamic: { value: 'x', source: { sourceRef: 'msg:1', excerpt: 'x' } }, canonicalAppearance: { value: 'y', source: { sourceRef: 'msg:1', excerpt: 'y' } }, facts: { role: 'Archivist', source: { sourceRef: 'msg:1', excerpt: 'z' } } }],
    observations: [], supportProposals: [],
  };
  const result = deriveDevelopmentReadDependencies(snapshot, envelope);
  assert.deepEqual(result.readFieldRevisions[NPC_ID], { relationshipDynamic: 3, canonicalAppearance: 7, role: 2 });
  assert.deepEqual(result.readFieldDependencies[NPC_ID].relationshipDynamic, { relationshipEvaluation: 4, lifeState: 5 });
  assert.deepEqual(result.readFieldDependencies[NPC_ID].canonicalAppearance, { currentForm: 6, lifeState: 5 });
  assert.equal(result.readFieldDependencies[NPC_ID].role, undefined);
});
