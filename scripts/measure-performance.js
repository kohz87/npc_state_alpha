import os from 'node:os';
import { performance } from 'node:perf_hooks';

import { PromptInjector } from '../src/host/prompt-injector.js';
import {
  buildDevelopmentDispatch,
  buildDevelopmentPrompt,
  selectDevelopmentBatch,
} from '../src/host/development-context.js';
import {
  SillyTavernAdapter,
  buildChatFingerprintIndex,
  buildPrecedingLineage,
  detectCommittedBranchDivergence,
  getMessageSwipeId,
  lineageMatchesFingerprintIndex,
} from '../src/host/sillytavern-adapter.js';
import {
  StoryHistoryRecovery,
  analyzeStoryHistory,
  captureStoryHistoryBoundary,
} from '../src/host/history-recovery.js';
import { computeContentFingerprint } from '../src/host/fingerprint.js';
import {
  createDefaultNpcRecord,
  createInitialState,
  validateState,
} from '../src/state/schema.js';
import {
  createCheckpoint,
  IMPORT_BASELINE_MODE,
  MAX_STORY_CHECKPOINTS,
  resetCheckpointCounterForTesting,
} from '../src/state/checkpoints.js';
import {
  parseAlphaNativeBundle,
  serializeAlphaNativeBundle,
} from '../src/state/portable-state.js';
import { applyRelationshipMechanics } from '../src/runtime/relationship-mechanics.js';
import { CommitCoordinator } from '../src/runtime/commit-coordinator.js';
import { DevelopmentReviewQueue } from '../src/host/development-queue.js';
import { setFieldLock, updateNpcField } from '../src/runtime/user-commands.js';
import { MemoryStorageAdapter } from '../src/state/storage.js';
import { MockSillyTavernHost } from '../tests/fixtures/host-harness.js';

const OPEN = '<npc_state_alpha_v1>';
const CLOSE = '</npc_state_alpha_v1>';
const DEFAULT_REPETITIONS = 7;
const TIER_CONFIGS = Object.freeze([
  { id: 'small', exchanges: 12, npcs: 2, observationsPerNpc: 2, supportsPerNpc: 1, relationshipEvents: 6, pendingEntries: 6, checkpoints: 12 },
  { id: 'medium', exchanges: 48, npcs: 6, observationsPerNpc: 8, supportsPerNpc: 4, relationshipEvents: 20, pendingEntries: 24, checkpoints: 48 },
  { id: 'large', exchanges: 120, npcs: 12, observationsPerNpc: 24, supportsPerNpc: 12, relationshipEvents: 40, pendingEntries: 72, checkpoints: 120 },
  { id: 'stress', exchanges: 220, npcs: 25, observationsPerNpc: 48, supportsPerNpc: 24, relationshipEvents: 60, pendingEntries: 150, checkpoints: 150 },
]);

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    repetitions: samples.length,
    minMs: round(sorted[0] || 0),
    medianMs: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted.at(-1) || 0),
  };
}

async function measure(fn, repetitions = DEFAULT_REPETITIONS) {
  const samples = [];
  for (let i = 0; i < repetitions; i++) {
    const started = performance.now();
    await fn();
    samples.push(performance.now() - started);
  }
  return summarize(samples);
}

function syntheticRelationshipHistory(count, npcIndex) {
  const history = [];
  for (let i = 0; i < count; i++) {
    const trust = round(((i % 9) - 4) * 0.25);
    const affection = round(((i % 7) - 3) * 0.2);
    const desire = round(((i % 5) - 2) * 0.1);
    const tension = round(((i % 11) - 5) * 0.15);
    history.push({
      exchangeId: `rel_${npcIndex}_${i}`,
      timestamp: new Date(Date.UTC(2026, 8, 1, 0, i % 60, 0)).toISOString(),
      shifted: true,
      reason: `Synthetic relationship event ${i}`,
      impact: i % 5 === 0 ? 'moderate' : 'minor',
      source: { sourceRef: `synthetic:rel:${npcIndex}:${i}`, excerpt: `relationship event ${i}` },
      rawDeltas: { trust, affection, desire, tension },
      appliedDeltas: { trust, affection, desire, tension },
      resultingScores: { trust, affection, desire, tension },
      milestones: ['trust:neutral', 'affection:neutral', 'desire:indifferent', 'tension:relaxed'],
      axisSupport: null,
    });
  }
  return history;
}

function makeObservation(npcId, npcIndex, index) {
  return {
    id: `obs_${npcIndex}_${index}`,
    targetId: npcId,
    field: index % 2 === 0 ? 'personality' : 'speech',
    observation: `Synthetic durable-development observation ${index} for ${npcId}.`,
    source: {
      sourceRef: `synthetic:dev:${npcIndex}:${index}`,
      excerpt: `observation ${index}`,
      segmentKind: 'narrative',
    },
    disposition: { role: 'tentative' },
  };
}

function makeSupport(npcId, npcIndex, index) {
  return {
    targetId: npcId,
    field: index % 2 === 0 ? 'role' : 'background',
    fieldRevision: String(index + 2),
    sourceRefs: [`synthetic:support:${npcIndex}:${index}`],
    notes: `Synthetic accepted support ${index}`,
  };
}

function makePendingEntry(targetId, index, exchangeCount) {
  const exchange = index % exchangeCount;
  const userPosition = exchange * 2;
  const assistantPosition = userPosition + 1;
  return {
    id: `pending_${targetId}_${index}`,
    targetId,
    sourceScope: [`chat:synthetic:${userPosition}`, `chat:synthetic:${assistantPosition}`],
    exchangeId: `synthetic:${exchange}`,
    reason: index === 0 ? 'new_admission' : 'fast_proposal',
    createdAt: new Date(Date.UTC(2026, 8, 1, 0, index % 60, 0)).toISOString(),
    metadata: {
      userPosition,
      userSwipe: 0,
      assistantPosition,
      assistantSwipe: 0,
    },
  };
}

function makeState(config, { withPending = true } = {}) {
  const state = createInitialState();
  for (let i = 0; i < config.npcs; i++) {
    const id = `npc_${String(i + 1).padStart(2, '0')}`;
    const relationshipHistory = syntheticRelationshipHistory(config.relationshipEvents, i);
    const npc = createDefaultNpcRecord(id, `NPC ${String(i + 1).padStart(2, '0')}`, {
      aliases: [`Alias${i + 1}`],
      present: i < Math.min(2, config.npcs),
      activeInExchange: i === 0,
      mood: `mood-${i % 4}`,
      location: `location-${i % 5}`,
      goal: `Maintain objective ${i}`,
      status: `Operational state ${i}`,
      currentPresentation: `Travel clothing set ${i}`,
      relationship: {
        trust: (i % 5) * 1.25,
        affection: (i % 4) * 0.75,
        desire: (i % 3) * 0.25,
        tension: (i % 6) * 0.5,
        lastEvaluationExchange: relationshipHistory.at(-1)?.exchangeId || null,
        progress: { trust: 0.25, affection: 0.5, desire: 0, tension: 0.75 },
        milestones: ['trust:neutral', 'affection:neutral', 'desire:indifferent', 'tension:relaxed'],
        scoringHistory: relationshipHistory,
      },
      relationshipDynamic: `Professional relationship dynamic ${i} with evolving trust.`,
      canonicalAppearance: `Mature canonical appearance description ${i} with stable identifying details.`,
      appearanceForms: [
        { formId: `base_${i}`, name: 'Base', description: `Base form ${i}` },
        { formId: `field_${i}`, name: 'Field', description: `Field form ${i}` },
      ],
      currentForm: `base_${i}`,
      personality: { traits: ['Reserved', 'Methodical', `Trait-${i % 4}`] },
      behavioralProfile: `Methodical recurring behavioral profile ${i}.`,
      speech: `Characteristic concise speech pattern ${i}.`,
      mannerisms: [`Gesture ${i}`, `Habit ${i}`],
      role: `Role ${i}`,
      species: 'Human',
      background: `Synthetic durable background ${i} with several established facts.`,
      actualAge: String(24 + (i % 20)),
      apparentAge: String(24 + (i % 20)),
      birthday: `Day ${i + 1}`,
      importantMemories: Array.from({ length: Math.min(12, Math.max(2, Math.floor(config.exchanges / 20))) }, (_, m) => ({
        memoryId: `mem_${i}_${m}`,
        summary: `Consequential synthetic memory ${m} for NPC ${i}.`,
      })),
      development: {
        observations: Array.from({ length: config.observationsPerNpc }, (_, o) => makeObservation(id, i, o)),
        acceptedSupport: Array.from({ length: config.supportsPerNpc }, (_, s) => makeSupport(id, i, s)),
        reviewReceipts: [],
      },
      importance: i < 4 ? 1 : 0,
    });
    state.npcs[id] = npc;
  }
  if (withPending) {
    for (let i = 0; i < config.pendingEntries; i++) {
      const targetId = `npc_${String((i % config.npcs) + 1).padStart(2, '0')}`;
      state.pendingReview.entries.push(makePendingEntry(targetId, i, config.exchanges));
    }
  }
  state.dedup.processedSourceKeys = Array.from({ length: config.exchanges }, (_, i) => `synthetic:${i}:0:sha256:${String(i).padStart(64, '0')}`);
  return state;
}

function makeTrailer(narrative, proposals = []) {
  return `${narrative}\n\n${OPEN}\n${JSON.stringify({ version: '1', proposals })}\n${CLOSE}`;
}

function makeChat(exchangeCount, { includeTrailers = true } = {}) {
  const chat = [];
  for (let i = 0; i < exchangeCount; i++) {
    chat.push({
      is_user: true,
      is_system: false,
      mes: `Synthetic user exchange ${i}: continue the ongoing scene with grounded details.`,
      swipe_id: 0,
    });
    const narrative = `Synthetic assistant exchange ${i}: NPC ${(i % 8) + 1} responds with a bounded scene update.`;
    chat.push({
      is_user: false,
      is_system: false,
      mes: includeTrailers ? makeTrailer(narrative, []) : narrative,
      swipe_id: 0,
      swipes: [],
      extra: {},
    });
  }
  return chat;
}

function sourceRecordFor(chat, chatId, position) {
  const message = chat[position];
  const clean = message.is_user ? message.mes : message.mes.split(`\n\n${OPEN}`)[0];
  return {
    chatId,
    position,
    role: message.is_user ? 'user' : 'assistant',
    contentFingerprint: computeContentFingerprint(clean),
    precedingLineage: buildPrecedingLineage(chat, position),
    swipe: getMessageSwipeId(message),
  };
}

function makeCheckpointedState(config) {
  resetCheckpointCounterForTesting();
  const state = makeState({ ...config, observationsPerNpc: Math.min(config.observationsPerNpc, 8), supportsPerNpc: 0 }, { withPending: false });
  state.dedup.processedSourceKeys = [];
  const chatId = 'synthetic';
  const chat = makeChat(config.exchanges);
  const checkpointCount = Math.min(config.checkpoints, config.exchanges);
  for (let i = 0; i < checkpointCount; i++) {
    const assistantPosition = i * 2 + 1;
    const boundary = sourceRecordFor(chat, chatId, assistantPosition);
    state.revision = i;
    state.dedup.processedSourceKeys.push(`synthetic:${assistantPosition}:0:${boundary.contentFingerprint}`);
    createCheckpoint(state, {
      checkpointId: `bench_chk_${i}`,
      timestamp: new Date(Date.UTC(2026, 8, 1, 0, i % 60, 0)).toISOString(),
      writer: 'one_pass',
      mode: i === Math.floor(checkpointCount / 3) && config.id === 'stress' ? IMPORT_BASELINE_MODE : 'commit',
      historyBoundary: boundary,
      sourceDependencies: [{
        sourceRef: `chat:${chatId}:${assistantPosition}`,
        targetField: null,
        writer: 'one_pass',
        segmentKind: 'narrative',
        capturedProvenance: boundary,
      }],
    });
  }
  return { state, chat, chatId };
}

function buildSyntheticDevelopmentArgs(state, config) {
  const targetIds = Object.keys(state.npcs).slice(0, Math.min(4, config.npcs));
  const sourceCount = Math.min(12, Math.max(2, config.exchanges));
  const sources = Array.from({ length: sourceCount }, (_, i) => ({
    sourceRef: `synthetic:prompt:${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: `Synthetic Development source ${i} with durable profile evidence and scene context.`,
  }));
  const targetSourceScope = {};
  const targets = targetIds.map((id, index) => {
    const npc = state.npcs[id];
    const scope = sources.slice(index, Math.min(sources.length, index + 6)).map((source) => source.sourceRef);
    targetSourceScope[id] = scope;
    return {
      id: npc.id,
      name: npc.name,
      lifeState: npc.lifeState,
      current: {
        relationshipDynamic: npc.relationshipDynamic,
        canonicalAppearance: npc.canonicalAppearance,
        personality: npc.personality,
        behavioralProfile: npc.behavioralProfile,
        speech: npc.speech,
        mannerisms: npc.mannerisms,
        role: npc.role,
        species: npc.species,
        background: npc.background,
        actualAge: npc.actualAge,
        apparentAge: npc.apparentAge,
        birthday: npc.birthday,
        importantMemories: npc.importantMemories,
      },
      relationshipAxesReadOnly: npc.relationship,
      currentFormReadOnly: npc.currentForm,
      locks: [],
      observations: npc.development.observations.slice(-8),
      acceptedSupport: npc.development.acceptedSupport.slice(-8),
    };
  });
  return { targets, targetSourceScope, targetFieldSubset: {}, sources };
}

function buildDispatchInputs(state, config) {
  const chat = makeChat(config.exchanges, { includeTrailers: false });
  const chatId = 'synthetic';
  const entries = [];
  const count = Math.min(config.pendingEntries, 24);
  for (let i = 0; i < count; i++) {
    const exchange = i % config.exchanges;
    const userPosition = exchange * 2;
    const assistantPosition = userPosition + 1;
    const targetId = `npc_${String((i % config.npcs) + 1).padStart(2, '0')}`;
    const user = chat[userPosition];
    const assistant = chat[assistantPosition];
    entries.push({
      id: `dispatch_${i}`,
      targetId,
      sourceScope: [`chat:${chatId}:${userPosition}`, `chat:${chatId}:${assistantPosition}`],
      exchangeId: `${chatId}:${exchange}`,
      reason: i === 0 ? 'new_admission' : 'fast_proposal',
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, i % 60, 0)).toISOString(),
      metadata: {
        userPosition,
        userSwipe: 0,
        assistantPosition,
        assistantSwipe: 0,
        userFingerprint: computeContentFingerprint(user.mes),
        assistantFingerprint: computeContentFingerprint(assistant.mes),
      },
    });
  }
  return { state, chat, chatId, entries, settings: { developmentCadence: 3, developmentEnabled: true } };
}

function countPromptProjection(projection) {
  const lines = projection.split('\n');
  return {
    identityLines: lines.filter((line) => line.startsWith('[NPC ')).length,
    identityOnlyLines: lines.filter((line) => line.includes('identity-only')).length,
    detailedNpcLines: lines.filter((line) => line.startsWith('[NPC ') && !line.includes('identity-only')).length,
  };
}

function heapSnapshot() {
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
  };
}

async function benchmarkTier(config) {
  const state = makeState(config);
  const validity = validateState(state);
  if (!validity.valid) throw new Error(`Synthetic ${config.id} state invalid: ${validity.errors.slice(0, 3).join('; ')}`);
  const userText = 'NPC 01, give me your report.';
  const immediateOptions = { routineDossierDetailBudget: 'auto', currentUserText: userText, admissionPolicy: 'named_preferred' };
  const projection = PromptInjector.buildContinuityProjection(state, immediateOptions);
  const prompt = PromptInjector.buildExtensionPrompt(state, immediateOptions);
  const developmentArgs = buildSyntheticDevelopmentArgs(state, config);
  const developmentPrompt = buildDevelopmentPrompt(developmentArgs);
  const dispatchInputs = buildDispatchInputs(state, config);
  const selected = selectDevelopmentBatch(state, { developmentEnabled: true, developmentCadence: 3 }, {});
  const checkpointed = makeCheckpointedState(config);
  const helpers = {
    buildPrecedingLineage,
    buildChatFingerprintIndex,
    lineageMatchesFingerprintIndex,
    getMessageSwipeId,
  };
  const lastPosition = checkpointed.chat.length - 1;
  const portable = serializeAlphaNativeBundle(state);

  const repetitions = config.id === 'stress' ? 3 : (config.id === 'large' ? 5 : DEFAULT_REPETITIONS);
  return {
    workload: { ...config },
    immediate: {
      promptChars: prompt.length,
      promptEstimatedTokens4Chars: Math.ceil(prompt.length / 4),
      ...countPromptProjection(projection),
      promptBuild: await measure(() => PromptInjector.buildExtensionPrompt(state, immediateOptions), repetitions),
      lineageBuild: await measure(() => buildPrecedingLineage(checkpointed.chat, lastPosition), repetitions),
      branchDivergenceCheck: await measure(() => detectCommittedBranchDivergence(checkpointed.state, checkpointed.chat), repetitions),
    },
    development: {
      selectedEntries: selected.length,
      selectedExchanges: new Set(selected.map((entry) => entry.exchangeId || entry.id)).size,
      promptChars: developmentPrompt.length,
      promptEstimatedTokens4Chars: Math.ceil(developmentPrompt.length / 4),
      contextObservationCount: developmentArgs.targets.reduce((sum, target) => sum + (target.observations?.length || 0), 0),
      contextSupportCount: developmentArgs.targets.reduce((sum, target) => sum + (target.acceptedSupport?.length || 0), 0),
      batchSelection: await measure(() => selectDevelopmentBatch(state, { developmentEnabled: true, developmentCadence: 3 }, {}), repetitions),
      promptBuild: await measure(() => buildDevelopmentPrompt(developmentArgs), repetitions),
      dispatchBuild: await measure(() => {
        const result = buildDevelopmentDispatch(dispatchInputs);
        if (!result.valid) throw new Error(result.error);
      }, repetitions),
    },
    state: {
      canonicalJsonBytes: Buffer.byteLength(JSON.stringify(state), 'utf8'),
      npcCount: Object.keys(state.npcs).length,
      observations: Object.values(state.npcs).reduce((sum, npc) => sum + npc.development.observations.length, 0),
      acceptedSupport: Object.values(state.npcs).reduce((sum, npc) => sum + npc.development.acceptedSupport.length, 0),
      relationshipHistoryEntries: Object.values(state.npcs).reduce((sum, npc) => sum + (npc.relationship.scoringHistory?.length || 0), 0),
      pendingEntries: state.pendingReview.entries.length,
      dedupKeys: state.dedup.processedSourceKeys.length,
      checkpointedJsonBytes: Buffer.byteLength(JSON.stringify(checkpointed.state), 'utf8'),
      checkpointCount: checkpointed.state.history.checkpoints.length,
      checkpointBound: MAX_STORY_CHECKPOINTS,
    },
    recovery: {
      cleanAnalysis: await measure(() => analyzeStoryHistory(checkpointed.state, checkpointed.chat, checkpointed.chatId, helpers), repetitions),
      safeCheckpointIndex: analyzeStoryHistory(checkpointed.state, checkpointed.chat, checkpointed.chatId, helpers).safeCheckpointIndex,
      lastBoundaryPosition: checkpointed.state.history.checkpoints.at(-1)?.historyBoundary?.position ?? null,
    },
    portable: {
      serializedBytes: Buffer.byteLength(portable, 'utf8'),
      export: await measure(() => serializeAlphaNativeBundle(state), repetitions),
      parse: await measure(() => {
        const parsed = parseAlphaNativeBundle(portable);
        if (!parsed.success) throw new Error(parsed.error);
      }, repetitions),
    },
  };
}

async function benchmarkRelationship(config) {
  const npc = createDefaultNpcRecord('npc_rel', 'Relationship NPC');
  const iterations = config.id === 'stress' ? 500 : Math.max(50, config.exchanges * 2);
  const started = performance.now();
  for (let i = 0; i < iterations; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    applyRelationshipMechanics(npc, {
      shifted: true,
      impact: 'minor',
      axes: { trust: 0.5 * sign, affection: 0.25 * sign, tension: 0.2 * -sign },
      source: { sourceRef: `synthetic:rel:${i}`, excerpt: `event ${i}` },
    }, {
      exchangeId: `relationship:${i}`,
      historyLimit: 100,
      timestamp: new Date(Date.UTC(2026, 8, 1, 0, i % 60, 0)).toISOString(),
    });
  }
  return {
    iterations,
    durationMs: round(performance.now() - started),
    retainedHistory: npc.relationship.scoringHistory.length,
    finalScores: {
      trust: round(npc.relationship.trust),
      affection: round(npc.relationship.affection),
      desire: round(npc.relationship.desire),
      tension: round(npc.relationship.tension),
    },
  };
}

async function runRecoveryScenario(config, editExchange) {
  const prepared = makeCheckpointedState(config);
  const chat = structuredClone(prepared.chat);
  const editPosition = Math.max(0, Math.min(chat.length - 2, editExchange * 2));
  chat[editPosition].mes = `${chat[editPosition].mes} [edited]`;
  const storage = new MemoryStorageAdapter(prepared.state);
  const coordinator = new CommitCoordinator({
    storage,
    admissionPolicy: 'named_preferred',
  });
  const recovery = new StoryHistoryRecovery({
    storage,
    coordinator,
    getContext: () => ({ chatId: prepared.chatId, chat }),
    buildPrecedingLineage,
    buildChatFingerprintIndex,
    lineageMatchesFingerprintIndex,
    getMessageSwipeId,
  });
  const started = performance.now();
  const result = await recovery.recover({ eventName: 'S9_BENCH_EDIT', messageId: editPosition });
  const durationMs = performance.now() - started;
  const loaded = await storage.load();
  return {
    durationMs,
    success: result.success === true,
    status: result.status,
    reason: result.reason || null,
    error: result.error || null,
    safeCheckpointId: result.safeCheckpointId || null,
    safeBoundaryPosition: result.safeBoundaryPosition ?? null,
    replayed: (result.replayResults || []).filter((item) => item.status === 'replayed').length,
    rejected: (result.replayResults || []).filter((item) => item.status === 'rejected').length,
    finalCheckpointCount: loaded.state.history.checkpoints.length,
    finalStateValid: validateState(loaded.state).valid,
  };
}

async function benchmarkRecovery(config) {
  const repetitions = config.id === 'stress' ? 1 : (config.id === 'large' ? 2 : 3);
  const scenarios = {
    recentEdit: Math.max(1, config.exchanges - 4),
    oldEdit: Math.max(1, Math.floor(config.exchanges * 0.2)),
  };
  const output = {};
  for (const [name, editExchange] of Object.entries(scenarios)) {
    const samples = [];
    let representative = null;
    for (let index = 0; index < repetitions; index++) {
      const result = await runRecoveryScenario(config, editExchange);
      if (!result.success) throw new Error(`${config.id} ${name} recovery failed: ${result.status} ${result.reason || ''} ${result.error || ''}`);
      samples.push(result.durationMs);
      representative = result;
    }
    output[name] = {
      editExchange,
      timing: summarize(samples),
      replayed: representative.replayed,
      rejected: representative.rejected,
      safeCheckpointId: representative.safeCheckpointId,
      safeBoundaryPosition: representative.safeBoundaryPosition,
      finalCheckpointCount: representative.finalCheckpointCount,
      finalStateValid: representative.finalStateValid,
    };
  }
  return output;
}

async function benchmarkLongSession(exchangeCount = 128) {
  const host = new MockSillyTavernHost({ chatId: 's9_long_session' });
  host.interceptorKey = 's9_long_session_interceptor';
  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey: host.interceptorKey,
  });
  if (!adapter.initialize()) throw new Error('Long-session adapter failed to initialize.');
  const preProvider = [];
  const postProvider = [];
  let targetId = null;
  const checkpoints = [];
  const stateSizes = [];
  const promptSizes = [];

  for (let i = 0; i < exchangeCount; i++) {
    host.sendUserMessage(`Long synthetic exchange ${i}.`);
    let started = performance.now();
    await host.triggerGenerateInterceptor('normal');
    preProvider.push(performance.now() - started);
    const proposal = targetId
      ? { id: targetId, present: true, activeInExchange: false, mood: `mood-${i % 5}`, source: { sourceRef: 'current:assistant', excerpt: `Long assistant exchange ${i}` } }
      : { id: null, localRef: 'new:Long Runner', name: 'Long Runner', identityKind: 'named', evidence: { sourceRef: 'current:assistant', excerpt: 'Long Runner' }, present: true, activeInExchange: false, source: { sourceRef: 'current:assistant', excerpt: 'Long Runner' } };
    const narrative = targetId ? `Long assistant exchange ${i} continues.` : 'Long Runner enters the scene.';
    started = performance.now();
    await host.receiveAssistantMessage(makeTrailer(narrative, [proposal]));
    postProvider.push(performance.now() - started);
    const loaded = await adapter.storage.load();
    if (!targetId) targetId = Object.keys(loaded.state.npcs)[0];
    if ((i + 1) % 16 === 0 || i === exchangeCount - 1) {
      checkpoints.push({ exchange: i + 1, count: loaded.state.history.checkpoints.length });
      stateSizes.push({ exchange: i + 1, bytes: Buffer.byteLength(JSON.stringify(loaded.state), 'utf8') });
      promptSizes.push({ exchange: i + 1, chars: host.extensionPrompts.get('npc_state_alpha')?.prompt?.length || 0 });
    }
  }
  const finalLoaded = await adapter.storage.load();
  const result = {
    exchanges: exchangeCount,
    npcCount: Object.keys(finalLoaded.state.npcs).length,
    checkpointCount: finalLoaded.state.history.checkpoints.length,
    pendingEntries: finalLoaded.state.pendingReview.entries.length,
    dedupKeys: finalLoaded.state.dedup.processedSourceKeys.length,
    saveCalls: host.checkedSaveCalls.length,
    preProvider: summarize(preProvider),
    postProvider: summarize(postProvider),
    checkpoints,
    stateSizes,
    promptSizes,
    finalStateValid: validateState(finalLoaded.state).valid,
    diagnosticsEntries: adapter.diagnostics.getEntries().length,
    diagnosticsCapacity: adapter.diagnostics.capacity,
  };
  adapter.destroy();
  return result;
}

function parsePromptPayload(prompt, prefix) {
  const line = String(prompt || '').split('\n').find((item) => item.startsWith(prefix));
  return line ? JSON.parse(line.slice(prefix.length)) : [];
}

function makeIntegratedDevelopmentProvider(stats) {
  return {
    requiresConfiguredProfile: false,
    async sendReview({ prompt, signal }) {
      if (signal?.aborted) {
        const error = new Error('Synthetic Development request aborted.');
        error.name = 'AbortError';
        throw error;
      }
      stats.calls++;
      stats.inputChars += prompt.length;
      const targets = parsePromptPayload(prompt, 'TARGETS=');
      const sources = parsePromptPayload(prompt, 'SOURCES=');
      const evidenceSource = sources.find((source) => String(source.text || '').includes('veteran courier')) || null;
      const evidenceTarget = evidenceSource
        ? targets.find((target) => (target.sourceScope || []).includes(evidenceSource.sourceRef))
        : null;
      const proposals = evidenceTarget ? [{
        targetId: evidenceTarget.id,
        facts: {
          background: 'Veteran courier',
          source: { sourceRef: evidenceSource.sourceRef, excerpt: 'veteran courier' },
        },
      }] : [];
      const observations = evidenceTarget ? [{
        localObservationRef: `obs:s9:${stats.calls}`,
        targetId: evidenceTarget.id,
        field: 'background',
        observation: 'Explicitly identifies as a veteran courier.',
        source: { sourceRef: evidenceSource.sourceRef, excerpt: 'veteran courier' },
        disposition: { role: 'tentative' },
      }] : [];
      const supportProposals = evidenceTarget ? [{
        targetId: evidenceTarget.id,
        field: 'background',
        sourceRefs: [evidenceSource.sourceRef],
        notes: 'Direct durable occupational evidence in the reviewed exchange.',
      }] : [];
      const payload = {
        version: '1',
        reviewReceipts: targets.map((target) => ({
          targetId: target.id,
          sourceScope: target.sourceScope || [],
          status: evidenceTarget?.id === target.id ? 'reviewed' : 'reviewed_no_proposals',
        })),
        proposals,
        observations,
        supportProposals,
      };
      const text = JSON.stringify(payload);
      stats.outputChars += text.length;
      return {
        text,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil(text.length / 4),
        },
      };
    },
  };
}

function integratedExistingProposal(id, name, exchange, narrative, relationshipShift = false) {
  const excerpt = `${name} reports`;
  const proposal = {
    id,
    present: true,
    activeInExchange: relationshipShift,
    mood: `integrated-mood-${exchange % 5}`,
    status: `integrated-status-${exchange % 7}`,
    source: { sourceRef: 'current:assistant', excerpt },
  };
  if (relationshipShift) {
    proposal.relationshipEvaluation = {
      shifted: true,
      axes: { trust: 0.5, affection: 0, desire: 0, tension: 0 },
      impact: 'minor',
      axisSupport: {
        trust: {
          reason: 'A small cooperative exchange incrementally supports trust.',
          source: { sourceRef: 'current:assistant', excerpt },
        },
      },
    };
  }
  if (!narrative.includes(excerpt)) throw new Error(`Integrated narrative must contain excerpt '${excerpt}'.`);
  return proposal;
}

async function benchmarkIntegratedSession(exchangeCount = 120) {
  const sessionStartedAt = performance.now();
  const host = new MockSillyTavernHost({ chatId: 's9_integrated_A' });
  host.interceptorKey = 's9_integrated_interceptor';
  const settings = {
    enabled: true,
    developmentEnabled: true,
    developmentCadence: 3,
    developmentConnectionProfile: 's9-synthetic-profile',
    developmentResponseLimit: 1600,
  };
  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey: host.interceptorKey,
    settings,
  });
  if (!adapter.initialize()) throw new Error('Integrated-session adapter failed to initialize.');
  const providerStats = { calls: 0, inputChars: 0, outputChars: 0 };
  const developmentQueue = new DevelopmentReviewQueue({
    storage: adapter.storage,
    coordinator: adapter.coordinator,
    getContext: () => host.getContext(),
    provider: makeIntegratedDevelopmentProvider(providerStats),
    diagnostics: adapter.diagnostics,
    settings,
  });
  adapter.setDevelopmentReview(developmentQueue);

  const npcIds = [];
  const assistantPositions = [];
  const userPositions = [];
  const stateSizes = [];
  const promptSizes = [];
  const historyEvents = [];
  let deathPosition = null;
  let deathSurvivalText = null;

  for (let exchange = 0; exchange < exchangeCount; exchange++) {
    userPositions.push(host.sendUserMessage(`Integrated user exchange ${exchange}.`));
    await host.triggerGenerateInterceptor('normal');
    let narrative;
    let proposal;
    if (exchange < 6) {
      const name = `Endurance NPC ${exchange + 1}`;
      narrative = `${name} reports for duty in the endurance hall.`;
      proposal = {
        id: null,
        localRef: `new:endurance-${exchange + 1}`,
        name,
        identityKind: 'named',
        evidence: { sourceRef: 'current:assistant', excerpt: name },
        present: true,
        activeInExchange: false,
        source: { sourceRef: 'current:assistant', excerpt: name },
      };
    } else {
      const targetIndex = (exchange - 6) % npcIds.length;
      const id = npcIds[targetIndex];
      const name = `Endurance NPC ${targetIndex + 1}`;
      if (exchange === 23) {
        narrative = `${name} reports, "I am a veteran courier," then checks the route ledger.`;
      } else {
        narrative = `${name} reports a routine operational update for exchange ${exchange}.`;
      }
      proposal = integratedExistingProposal(id, name, exchange, narrative, exchange % 7 === 0);
      if (exchange === 84) {
        const deathExcerpt = `${name} falls lifeless`;
        narrative = `${name} falls lifeless when the training gantry collapses.`;
        proposal = {
          id,
          present: false,
          activeInExchange: false,
          source: { sourceRef: 'current:assistant', excerpt: deathExcerpt },
          lifecycle: {
            lifeState: 'dead',
            cause: 'training gantry collapse',
            source: { sourceRef: 'current:assistant', excerpt: deathExcerpt },
          },
        };
        deathSurvivalText = makeTrailer(`${name} reports that he ducked clear of the collapsing training gantry.`, [{
          id,
          present: true,
          activeInExchange: false,
          mood: 'shaken',
          status: 'alive after evasion',
          source: { sourceRef: 'current:assistant', excerpt: `${name} reports` },
        }]);
      }
    }
    const assistantText = makeTrailer(narrative, [proposal]);
    const assistantPosition = await host.receiveAssistantMessage(assistantText);
    assistantPositions.push(assistantPosition);
    if (exchange < 6) {
      const state = (await adapter.storage.load()).state;
      const name = `Endurance NPC ${exchange + 1}`;
      const id = Object.values(state.npcs).find((npc) => npc.name === name)?.id;
      if (!id) throw new Error(`Integrated admission failed for ${name}.`);
      npcIds.push(id);
    }
    if (exchange === 84) deathPosition = assistantPosition;

    if ((exchange + 1) % 6 === 0) await developmentQueue.waitForIdle();

    if (exchange === 39) {
      const corrected = await updateNpcField(adapter.coordinator, {
        npcId: npcIds[1],
        fieldName: 'mood',
        value: 'user-corrected-steady',
        reason: 'S9 deterministic correction endurance.',
      });
      const locked = await setFieldLock(adapter.coordinator, {
        npcId: npcIds[1],
        fieldName: 'mood',
        locked: true,
      });
      if (!corrected.success || !locked.success) throw new Error('Integrated correction/lock failed.');
    }
    if (exchange === 59) {
      const unlocked = await setFieldLock(adapter.coordinator, {
        npcId: npcIds[1],
        fieldName: 'mood',
        locked: false,
      });
      if (!unlocked.success) throw new Error('Integrated unlock failed.');
    }
    if (exchange === 64) {
      const forms = await updateNpcField(adapter.coordinator, {
        npcId: npcIds[2],
        fieldName: 'appearanceForms',
        value: [
          { formId: 'human', name: 'Human', description: 'Ordinary human presentation.' },
          { formId: 'field', name: 'Field', description: 'Field-operation presentation.' },
        ],
        reason: 'S9 deterministic form setup.',
      });
      const form = await updateNpcField(adapter.coordinator, {
        npcId: npcIds[2],
        fieldName: 'currentForm',
        value: 'field',
        reason: 'S9 deterministic form change.',
      });
      if (!forms.success || !form.success) throw new Error('Integrated form change failed.');
    }
    if (exchange === 84 && deathPosition !== null && deathSurvivalText) {
      const started = performance.now();
      await host.swipeMessage(deathPosition, 1, deathSurvivalText);
      historyEvents.push({ type: 'death_to_survival_swipe', durationMs: round(performance.now() - started) });
      const alive = (await adapter.storage.load()).state.npcs[npcIds[(exchange - 6) % npcIds.length]]?.lifeState;
      if (alive !== 'alive') {
        const recoveryStatus = adapter.historyRecovery.getStatus(host.chatId);
        throw new Error(`Integrated death/survival reconstruction did not restore living state: lifeState=${String(alive)} status=${JSON.stringify(recoveryStatus)}`);
      }
    }
    if (exchange === 99) {
      const editPosition = userPositions[96];
      const started = performance.now();
      await host.editMessage(editPosition, `${host.chat[editPosition].mes} Corrected wording.`);
      historyEvents.push({ type: 'recent_user_edit', durationMs: round(performance.now() - started) });
    }

    if ((exchange + 1) % 20 === 0 || exchange === exchangeCount - 1) {
      const loaded = await adapter.storage.load();
      stateSizes.push({ exchange: exchange + 1, bytes: Buffer.byteLength(JSON.stringify(loaded.state), 'utf8') });
      promptSizes.push({ exchange: exchange + 1, chars: host.extensionPrompts.get('npc_state_alpha')?.prompt?.length || 0 });
    }
  }

  await developmentQueue.waitForIdle();
  const deletePosition = assistantPositions[110];
  if (Number.isInteger(deletePosition) && host.chat[deletePosition]) {
    const started = performance.now();
    await host.deleteMessage(deletePosition);
    historyEvents.push({ type: 'recent_assistant_delete', durationMs: round(performance.now() - started) });
  }
  await developmentQueue.waitForIdle();

  const beforeReload = await adapter.storage.load();
  const stateBeforeReload = JSON.stringify(beforeReload.state);
  const primarySaveCalls = host.checkedSaveCalls.length;
  adapter.destroy();

  const reloaded = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey: host.interceptorKey,
    settings,
  });
  if (!reloaded.initialize()) throw new Error('Integrated reload adapter failed to initialize.');
  await host.eventSource.emit(host.eventTypes.CHAT_LOADED, host.chatId);
  const afterReload = await reloaded.storage.load();
  const reloadEqual = JSON.stringify(afterReload.state) === stateBeforeReload;

  const switchToBStarted = performance.now();
  await host.switchChat('s9_integrated_B');
  const switchToBMs = performance.now() - switchToBStarted;
  host.sendUserMessage('A same-name NPC enters the second chat.');
  await host.triggerGenerateInterceptor('normal');
  await host.receiveAssistantMessage(makeTrailer('Endurance NPC 1 reports for duty in Chat B.', [{
    id: null,
    localRef: 'new:endurance-chat-b',
    name: 'Endurance NPC 1',
    identityKind: 'named',
    evidence: { sourceRef: 'current:assistant', excerpt: 'Endurance NPC 1' },
    present: true,
    activeInExchange: false,
    source: { sourceRef: 'current:assistant', excerpt: 'Endurance NPC 1' },
  }]));
  const chatB = await reloaded.storage.load();

  const switchBackStarted = performance.now();
  await host.switchChat('s9_integrated_A');
  const switchBackMs = performance.now() - switchBackStarted;
  const finalLoad = await reloaded.storage.load();
  const finalNpcValues = Object.values(finalLoad.state.npcs);
  const developmentObservationCount = finalNpcValues.reduce((sum, npc) => sum + (npc.development?.observations?.length || 0), 0);
  const developmentSupportCount = finalNpcValues.reduce((sum, npc) => sum + (npc.development?.acceptedSupport?.length || 0), 0);
  const relationshipHistoryEntries = finalNpcValues.reduce((sum, npc) => sum + (npc.relationship?.scoringHistory?.length || 0), 0);
  const crossChatIsolation = Object.keys(chatB.state.npcs).length === 1 &&
    Object.values(chatB.state.npcs)[0]?.name === 'Endurance NPC 1' &&
    Object.keys(finalLoad.state.npcs).length === npcIds.length;

  const result = {
    primaryExchanges: exchangeCount,
    totalChats: 2,
    primaryNpcCount: Object.keys(finalLoad.state.npcs).length,
    secondaryNpcCount: Object.keys(chatB.state.npcs).length,
    developmentRequests: providerStats.calls,
    developmentInputChars: providerStats.inputChars,
    developmentOutputChars: providerStats.outputChars,
    developmentEstimatedInputTokens: Math.ceil(providerStats.inputChars / 4),
    developmentEstimatedOutputTokens: Math.ceil(providerStats.outputChars / 4),
    developmentObservationCount,
    developmentSupportCount,
    relationshipHistoryEntries,
    checkpointCount: finalLoad.state.history.checkpoints.length,
    pendingEntries: finalLoad.state.pendingReview.entries.length,
    primarySaveCalls,
    historyEvents,
    stateSizes,
    promptSizes,
    reloadStateEqual: reloadEqual,
    crossChatIsolation,
    chatSwitch: summarize([switchToBMs, switchBackMs]),
    finalStateValid: validateState(finalLoad.state).valid,
    secondaryStateValid: validateState(chatB.state).valid,
    totalDurationMs: round(performance.now() - sessionStartedAt),
  };
  reloaded.destroy();
  return result;
}

function cadenceModel(cadence, exchanges = 100) {
  const establishedRequests = Math.floor(exchanges / cadence);
  return {
    cadence,
    exchanges,
    establishedNpcEligibilityWindows: establishedRequests,
    note: 'Eligibility windows only; actual request count can be lower because up to six exchanges batch and triggers coalesce.',
  };
}

const memoryBefore = heapSnapshot();
const tiers = {};
const relationship = {};
for (const config of TIER_CONFIGS) {
  tiers[config.id] = await benchmarkTier(config);
  relationship[config.id] = await benchmarkRelationship(config);
}
const recoveryScaling = {};
for (const config of TIER_CONFIGS.filter((item) => item.id !== 'stress')) {
  recoveryScaling[config.id] = await benchmarkRecovery(config);
}
const longSession = await benchmarkLongSession(128);
const integratedSession = await benchmarkIntegratedSession(120);
const memoryAfter = heapSnapshot();

const output = {
  schema: 'npc_state_alpha.s9.performance.v1',
  generatedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpu: os.cpus()?.[0]?.model || 'unknown',
    logicalCpuCount: os.cpus()?.length || 0,
    totalMemoryBytes: os.totalmem(),
    timing: 'performance.now(); ordinary tiers 7 repetitions, large 5, stress 3; long-session samples every exchange',
    caveat: 'Timing is machine-dependent engineering characterization, not a hard unit-test threshold.',
  },
  tiers,
  relationship,
  recoveryScaling,
  cadenceModel: [1, 3, 5, 10].map((cadence) => cadenceModel(cadence, 100)),
  longSession,
  integratedSession,
  memory: {
    before: memoryBefore,
    after: memoryAfter,
    delta: {
      rssBytes: memoryAfter.rssBytes - memoryBefore.rssBytes,
      heapUsedBytes: memoryAfter.heapUsedBytes - memoryBefore.heapUsedBytes,
      heapTotalBytes: memoryAfter.heapTotalBytes - memoryBefore.heapTotalBytes,
    },
    caveat: 'A single process before/after delta is not evidence of a memory leak.',
  },
};

console.log(JSON.stringify(output, null, 2));
