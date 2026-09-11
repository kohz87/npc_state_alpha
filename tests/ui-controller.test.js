import test from 'node:test';
import assert from 'node:assert/strict';
import { UIController } from '../src/ui/controller.js';
import { DossierView } from '../src/ui/dossier-view.js';
import { NpcEditor } from '../src/ui/editor.js';
import { SettingsView } from '../src/ui/settings-view.js';
import { DiagnosticsView } from '../src/ui/diagnostics-view.js';
import { MemoryStorageAdapter } from '../src/state/storage.js';
import { CommitCoordinator } from '../src/runtime/commit-coordinator.js';
import { DiagnosticsLedger } from '../src/host/diagnostics.js';
import { createDefaultNpcRecord, createInitialState } from '../src/state/schema.js';
import { ALPHA_SETTINGS_DEFAULTS } from '../src/contract/settings.js';

class FakeEventSource {
  constructor() { this.handlers = new Map(); this.onCalls = 0; this.offCalls = 0; }
  on(event, handler) {
    this.onCalls++;
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
  }
  off(event, handler) {
    this.offCalls++;
    this.handlers.get(event)?.delete(handler);
  }
  count() { return [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0); }
}

async function createUiHarness() {
  const storage = new MemoryStorageAdapter();
  storage.getChatId = () => 'test_chat';
  const coordinator = new CommitCoordinator({ storage });
  const diagnostics = new DiagnosticsLedger();
  const eventSource = new FakeEventSource();
  const context = {
    chatId: 'test_chat',
    extensionSettings: { npc_state_alpha: { ...ALPHA_SETTINGS_DEFAULTS } },
    saveSettingsDebouncedCalls: 0,
    saveSettingsDebounced() { this.saveSettingsDebouncedCalls++; },
    eventSource,
    eventTypes: { CHAT_CHANGED: 'chat_changed', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
  };
  const queue = {
    listeners: new Set(),
    reviewPending: async () => ({ status: 'committed' }),
    retryFailed: async () => ({ status: 'committed' }),
    recheckMissingDetails: async () => ({ success: false, status: 'source_unavailable' }),
    refreshDossier: async () => ({ success: false, status: 'source_unavailable' }),
    getStatus: () => ({ inFlight: false }),
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
    emit(change) {
      for (const listener of this.listeners) listener(change);
    },
  };
  const adapter = {
    storage,
    coordinator,
    diagnostics,
    developmentReview: queue,
    getContext: () => context,
    getImmediateFailure: () => null,
    applyRuntimeSettings(settings) { this.lastAppliedSettings = settings; },
  };
  const controller = new UIController({ adapter, storage, coordinator, developmentQueue: queue, diagnostics });
  return { controller, storage, coordinator, diagnostics, queue, adapter, context, eventSource };
}

test('UI Controller: starts closed and opens only when explicitly requested', async () => {
  const { controller, storage } = await createUiHarness();
  const state = createInitialState();
  state.npcs.alice = createDefaultNpcRecord('alice', 'Alice');
  await storage.save(state, 0);

  assert.equal(controller.panelOpen, false);
  assert.equal(controller.cachedState, null);
  await controller.open();
  assert.equal(controller.panelOpen, true);
  assert.ok(controller.cachedState?.npcs?.alice);
  controller.close();
  assert.equal(controller.panelOpen, false);
  controller.destroy();
});

test('UI Controller: no-chat welcome avoids storage and review calls while settings remain usable', async () => {
  const { controller, storage, queue, adapter, context } = await createUiHarness();
  storage.getChatId = () => null;
  let loads = 0;
  let reviews = 0;
  storage.load = async () => { loads++; throw new Error('Missing real chat identity'); };
  queue.reviewPending = queue.retryFailed = async () => { reviews++; };
  adapter.retryImmediate = async () => { reviews++; };
  controller.rootElement = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  controller.cachedState = { npcs: { old: { id: 'old', name: 'Previous chat NPC' } } };

  await controller.open();
  assert.equal(loads, 0);
  assert.equal(controller.cachedState, null);
  assert.equal(controller.statusMessage, null);
  assert.match(controller.rootElement.innerHTML, /Open a chat to get started/);
  assert.match(controller.rootElement.innerHTML, /alpha-btn-review" disabled/);
  assert.doesNotMatch(controller.rootElement.innerHTML, /Previous chat NPC/);

  await controller.reviewPending();
  await controller.retryFailed();
  await controller.retryImmediate();
  assert.equal(reviews, 0);
  assert.equal(controller.statusMessage.type, 'info');

  controller.activeTab = 'settings';
  controller.render();
  assert.match(controller.rootElement.innerHTML, /NPC State Alpha Settings/);
  const saved = controller.settingsView.saveSettings({ developmentCadence: 5 });
  assert.equal(saved.success, true);
  assert.equal(context.extensionSettings.npc_state_alpha.developmentCadence, 5);
  assert.equal(loads, 0);
});

test('UI Controller: chat change clears transient selection and does not churn storage while panel is closed', async () => {
  const { controller, storage } = await createUiHarness();
  const state = createInitialState();
  state.npcs.alice = createDefaultNpcRecord('alice', 'Alice');
  await storage.save(state, 0);
  await controller.open();
  controller.close();
  controller.selectedNpcId = 'alice';
  controller.editingNpcId = 'alice';
  controller.statusMessage = { text: 'old chat', type: 'info' };

  await controller.onChatChanged();
  assert.equal(controller.selectedNpcId, null);
  assert.equal(controller.editingNpcId, null);
  assert.equal(controller.statusMessage, null);
  assert.equal(controller.cachedState, null);
  assert.equal(controller.dirtyWhileClosed, true);
});

test('UI Controller: rebinding host lifecycle does not accumulate duplicate listeners', async () => {
  const { controller, eventSource } = await createUiHarness();
  controller._bindHostEvents();
  assert.equal(eventSource.count(), 2);
  controller._bindHostEvents();
  assert.equal(eventSource.count(), 2, 'Second bind must first remove prior handlers.');
  controller.destroy();
  assert.equal(eventSource.count(), 0);
});

test('S5 UI Controller: Development notifications refresh only the active open chat and subscription cleanup is stable', async () => {
  const { controller, queue } = await createUiHarness();
  let reloads = 0;
  controller.reloadAndRender = async () => { reloads++; };
  controller.panelOpen = true;

  controller._bindDevelopmentEvents();
  assert.equal(queue.listeners.size, 1);
  queue.emit({ chatId: 'test_chat', phase: 'settled' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reloads, 1);

  queue.emit({ chatId: 'other_chat', phase: 'settled' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reloads, 1, 'Other-chat Development results must not refresh this UI.');

  controller._bindDevelopmentEvents();
  assert.equal(queue.listeners.size, 1, 'Rebinding must replace rather than accumulate queue subscriptions.');
  controller.destroy();
  assert.equal(queue.listeners.size, 0);
});

test('S5 C14 UI: competing automatic owner is surfaced and Development actions fail visibly without calling the queue', async () => {
  const { controller, queue, adapter } = await createUiHarness();
  let reviewCalls = 0;
  queue.reviewPending = async () => { reviewCalls += 1; return { status: 'committed' }; };
  adapter.getOwnershipConflict = () => ({ name: 'third-party/npc_state_beta', reason: 'known_competing_automatic_owner' });

  await controller.reviewPending();

  assert.equal(reviewCalls, 0);
  assert.equal(controller.statusMessage?.type, 'error');
  assert.match(controller.statusMessage?.text || '', /competing continuity owner/);
  assert.match(controller.statusMessage?.text || '', /npc_state_beta/);
  controller.destroy();
});

test('DossierView: renders canonical Alpha shapes and separates story-facing defaults from diagnostics', () => {
  const view = new DossierView();
  const alice = createDefaultNpcRecord('alice', 'Alice');
  alice.currentPresentation = 'Mud-splashed blue cloak';
  alice.canonicalAppearance = 'Tall elf with silver hair';
  alice.appearanceForms = [{ formId: 'human', label: 'Human form', description: 'No visible nonhuman anatomy' }];
  alice.currentForm = 'human';
  alice.personality = { traits: ['reserved', 'curious'] };
  alice.mannerisms = [{ value: 'Taps the ledger twice before closing it' }];
  alice.importantMemories = [{ memoryId: 'mem1', summary: 'Promised to protect the archive' }];
  alice.nonPlayerRelationships = [{ relationId: 'rel1', targetId: 'mira', relationKind: 'sister' }];
  alice.relationship = {
    trust: 25.5, affection: 10, desire: 0, tension: -5,
    lastEvaluationExchange: 'e1',
    progress: { trust: 0.5, affection: 0, desire: 0, tension: 0 },
    milestones: ['trust:receptive', 'affection:neutral', 'desire:indifferent', 'tension:relaxed'],
    scoringHistory: [{
      exchangeId: 'e1', timestamp: '2026-09-10T12:00:00.000Z', shifted: true,
      reason: 'Trusted the player with the archive key', impact: 'meaningful',
      rawDeltas: { trust: 5.5, affection: 0, desire: 0, tension: 0 },
      appliedDeltas: { trust: 5.5, affection: 0, desire: 0, tension: 0 },
      resultingScores: { trust: 25.5, affection: 10, desire: 0, tension: -5 },
      milestones: ['trust:receptive'], source: null, axisSupport: null,
    }],
  };
  alice.manualCorrections.role = { correctedAt: '2026-09-10T12:00:00.000Z', writer: 'user', reason: 'Correct title', value: 'Archivist' };
  alice.development.observations.push({
    id: 'obs1', targetId: 'alice', field: 'speech', observation: 'Uses clipped court diction',
    source: { sourceRef: 'chat:test_chat:1', excerpt: 'Understood, my lord.', segmentKind: 'narrative' },
    disposition: { role: 'tentative' },
  });
  const state = { npcs: { alice }, pendingReview: { entries: [] } };
  const html = view.render(state, 'alice');

  assert.match(html, /<h4 class="alpha-section-title">Current<\/h4>/);
  assert.match(html, /Mud-splashed blue cloak/);
  assert.match(html, /Canonical appearance/);
  assert.match(html, /Human form: No visible nonhuman anatomy/);
  assert.match(html, /reserved, curious/);
  assert.match(html, /Taps the ledger twice/);
  assert.match(html, /Promised to protect the archive/);
  assert.match(html, /mira: sister/);
  assert.match(html, /role="meter"/);
  assert.match(html, /25\.50/);
  assert.match(html, />receptive</);
  assert.match(html, /Show Diagnostics/);
  assert.doesNotMatch(html, /Trusted the player with the archive key/);
  assert.doesNotMatch(html, /Uses clipped court diction/);
  assert.doesNotMatch(html, /Manual corrections:<\/strong> 1/);
  assert.doesNotMatch(html, />Development Evidence</);

  const diagnosticHtml = view.render(state, 'alice', {}, { showDiagnostics: true });
  assert.match(diagnosticHtml, /Hide Diagnostics/);
  assert.match(diagnosticHtml, /Trusted the player with the archive key/);
  assert.match(diagnosticHtml, /Uses clipped court diction/);
  assert.match(diagnosticHtml, /Manual corrections:<\/strong> 1/);
  assert.match(diagnosticHtml, />Development Evidence</);
});

test('DossierView: canonical dead lifecycle is rendered and filterable', () => {
  const view = new DossierView();
  view.filterLifeState = 'dead';
  const dead = createDefaultNpcRecord('dead1', 'Late Captain');
  dead.lifeState = 'dead';
  dead.present = false;
  const alive = createDefaultNpcRecord('alive1', 'Living Scout');
  const html = view.render({ npcs: { dead1: dead, alive1: alive }, pendingReview: { entries: [] } }, 'dead1');
  assert.match(html, /Late Captain/);
  assert.doesNotMatch(html, /Living Scout/);
  assert.match(html, /status-deceased">Dead/);
});

test('NpcEditor: renders canonical alive/dead lifecycle and explicit relationship/domain locks', () => {
  const editor = new NpcEditor({});
  const bob = createDefaultNpcRecord('bob', 'Bob');
  bob.role = 'Blacksmith';
  bob.locks = { role: true, relationshipEvaluation: true };
  const html = editor.render(bob, 3);
  assert.match(html, /Edit NPC: Bob/);
  assert.match(html, /Rev 3/);
  assert.match(html, /value="dead"/);
  assert.doesNotMatch(html, /value="deceased"/);
  assert.match(html, /data-field="relationshipEvaluation"/);
  assert.match(html, /Numeric relationship scoring/);
});

test('S5 NpcEditor: unrelated save preserves untouched rich personality and object-form mannerisms', async () => {
  let commitInput = null;
  const editor = new NpcEditor({
    coordinator: {
      async commit(input) {
        commitInput = input;
        return { success: true, commitRevision: 8 };
      },
    },
  });
  const alice = createDefaultNpcRecord('alice', 'Alice');
  alice.personality = { traits: ['reserved', 'curious'] };
  alice.mannerisms = [{ value: 'Taps the ledger twice before closing it' }];
  editor.render(alice, 7);

  const inputs = [
    { value: 'Archivist', getAttribute: (name) => name === 'data-field' ? 'role' : null },
    { value: 'reserved, curious', getAttribute: (name) => name === 'data-field' ? 'personality' : null },
    { value: 'Taps the ledger twice before closing it', getAttribute: (name) => name === 'data-field' ? 'mannerisms' : null },
  ];
  const fakeEditor = {
    querySelectorAll(selector) {
      return selector === '.alpha-edit-input' ? inputs : [];
    },
    querySelector(selector) {
      if (selector.startsWith('.alpha-field-lock')) return { checked: false };
      if (selector === '.alpha-portrait-input') return { value: '' };
      if (selector === '.alpha-importance-input') return { value: '' };
      if (selector === '.alpha-lifecycle-select') return { value: 'alive' };
      if (selector === '.alpha-correction-reason') return { value: 'Change role only' };
      return null;
    },
  };

  await editor._handleSave(fakeEditor, 'alice', 7);
  assert.deepEqual(commitInput.fieldProposals.alice, { role: 'Archivist' });
  assert.equal(commitInput.fieldProposals.alice.personality, undefined);
  assert.equal(commitInput.fieldProposals.alice.mannerisms, undefined);
});

test('SettingsView: rejects explicit invalid values and persists valid canonical settings', async () => {
  const { context } = await createUiHarness();
  let saved = null;
  let error = null;
  const view = new SettingsView({
    getContext: () => context,
    onSaved: (value) => { saved = value; },
    onError: (value) => { error = value; },
  });

  const invalid = view.saveSettings({ developmentCadence: 999 });
  assert.equal(invalid.success, false);
  assert.match(error, /developmentCadence/);
  assert.equal(context.extensionSettings.npc_state_alpha.developmentCadence, 3);

  const valid = view.saveSettings({ developmentCadence: 5, routineDossierDetailBudget: 7, relationshipInertia: 0.2 });
  assert.equal(valid.success, true, valid.error);
  assert.equal(saved.developmentCadence, 5);
  assert.equal(saved.routineDossierDetailBudget, 7);
  assert.equal(saved.relationshipInertia, 0.2);
  assert.equal(context.saveSettingsDebouncedCalls, 1);
});

test('DiagnosticsView: renders bounded ledger records without requiring raw state dump', () => {
  const ledger = new DiagnosticsLedger();
  ledger.record({ type: 'test_event', chatId: 'c1', extra: 123 });
  const html = new DiagnosticsView({ diagnostics: ledger }).render();
  assert.match(html, /Diagnostics Ledger/);
  assert.match(html, /test_event/);
});
