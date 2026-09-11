/**
 * NPC State Alpha — S6 canonical story-history recovery.
 *
 * Recovery is orchestration, not a second state engine: surviving immediate
 * trailers are parsed by the production parser, resolved by the shared source
 * resolver, applied through CommitCoordinator in an isolated memory adapter,
 * and published by one final CAS reconstruction commit.
 */

import { WRITERS } from '../contract/registry.js';
import { extractAndParseOnePassTrailer } from '../contract/parser.js';
import { validateOnePassEnvelope } from '../contract/validator.js';
import { createInitialState, cloneState } from '../state/schema.js';
import { IMPORT_BASELINE_MODE } from '../state/checkpoints.js';
import { MemoryStorageAdapter } from '../state/storage.js';
import { CommitCoordinator } from '../runtime/commit-coordinator.js';
import { buildIdentityReplayKey } from '../runtime/identity.js';
import { stripMachineTrailer } from '../runtime/source-resolver.js';
import { computeContentFingerprint } from './content-hash.js';
import { DIAGNOSTIC_EVENT_TYPES } from './diagnostics.js';

function roleOf(message) {
  if (!message || message.is_system) return 'system';
  return message.is_user ? 'user' : 'assistant';
}

function sourceSignature(provenance) {
  if (!provenance || !Number.isInteger(provenance.position)) return null;
  return [
    provenance.chatId || provenance.sidecarId || '',
    provenance.position,
    provenance.role,
    provenance.swipe ?? '',
    provenance.revision ?? '',
    provenance.contentFingerprint || '',
  ].join('|');
}

function portableSourceSignature(provenance) {
  if (!provenance) return null;
  return [
    provenance.chatId || provenance.sidecarId || '',
    provenance.role,
    provenance.swipe ?? '',
    provenance.revision ?? '',
    provenance.contentFingerprint || '',
  ].join('|');
}

function proposalIdentitySignature(provenance, identityKey) {
  if (!provenance || !Number.isInteger(provenance.position) || !identityKey) return null;
  return [
    'proposal',
    provenance.chatId || provenance.sidecarId || '',
    provenance.position,
    provenance.role,
    provenance.swipe ?? '',
    provenance.revision ?? '',
    JSON.stringify(provenance.precedingLineage || []),
    identityKey,
  ].join('|');
}

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function monotonicNowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function elapsedMs(startedAt) {
  return Math.round((monotonicNowMs() - startedAt) * 1000) / 1000;
}

function compactDependencyKey(dep) {
  if (typeof dep === 'string') return `string:${dep}`;
  return JSON.stringify([
    dep?.sourceRef,
    dep?.targetField ?? null,
    dep?.writer ?? null,
    dep?.segmentKind || 'narrative',
    sourceSignature(dep?.capturedProvenance),
  ]);
}

function dedupeObjects(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Captures one exact host story boundary with no raw narrative bytes.
 */
export function captureStoryHistoryBoundary(
  chat,
  chatId,
  position,
  { buildPrecedingLineage, getMessageSwipeId } = {},
) {
  if (!Array.isArray(chat) || typeof chatId !== 'string' || chatId.trim() === '') return null;
  let targetPosition = position;
  if (!Number.isInteger(targetPosition)) {
    targetPosition = -1;
    for (let index = chat.length - 1; index >= 0; index--) {
      const message = chat[index];
      if (message && !message.is_system && typeof message.mes === 'string') {
        targetPosition = index;
        break;
      }
    }
  }
  if (targetPosition < 0) return null;
  const message = chat[targetPosition];
  if (!message || message.is_system || typeof message.mes !== 'string') return null;
  const role = roleOf(message);
  const canonicalText = role === 'assistant' ? stripMachineTrailer(message.mes) : message.mes;
  const boundary = {
    chatId,
    position: targetPosition,
    role,
    contentFingerprint: computeContentFingerprint(canonicalText),
    precedingLineage: typeof buildPrecedingLineage === 'function'
      ? buildPrecedingLineage(chat, targetPosition)
      : [],
  };
  if (typeof getMessageSwipeId === 'function') {
    boundary.swipe = getMessageSwipeId(message);
  }
  return boundary;
}

export function provenanceMatchesCanonicalHistory(
  provenance,
  chat,
  chatId,
  helpers = {},
) {
  if (!provenance || provenance.chatId !== chatId || !Number.isInteger(provenance.position)) return false;
  const message = chat?.[provenance.position];
  if (!message || message.is_system || typeof message.mes !== 'string') return false;
  if (roleOf(message) !== provenance.role) return false;
  const fingerprintIndex = Array.isArray(helpers.fingerprintIndex) ? helpers.fingerprintIndex : null;
  const canonicalText = provenance.role === 'assistant' ? stripMachineTrailer(message.mes) : message.mes;
  const currentFingerprint = fingerprintIndex?.[provenance.position] || computeContentFingerprint(canonicalText);
  if (currentFingerprint !== provenance.contentFingerprint) return false;
  if (
    provenance.swipe !== undefined &&
    provenance.swipe !== null &&
    typeof helpers.getMessageSwipeId === 'function' &&
    helpers.getMessageSwipeId(message) !== provenance.swipe
  ) {
    return false;
  }
  const expectedLineage = Array.isArray(provenance.precedingLineage) ? provenance.precedingLineage : [];
  if (fingerprintIndex && typeof helpers.lineageMatchesFingerprintIndex === 'function') {
    return helpers.lineageMatchesFingerprintIndex(fingerprintIndex, provenance.position, expectedLineage);
  }
  const currentLineage = typeof helpers.buildPrecedingLineage === 'function'
    ? helpers.buildPrecedingLineage(chat, provenance.position)
    : [];
  return currentLineage.length === expectedLineage.length &&
    expectedLineage.every((fingerprint, index) => fingerprint === currentLineage[index]);
}

function derivedCheckpointBoundary(checkpoint) {
  if (checkpoint?.historyBoundary) return checkpoint.historyBoundary;
  const dependencies = Array.isArray(checkpoint?.sourceDependencies)
    ? checkpoint.sourceDependencies
    : [];
  let latest = null;
  for (const dependency of dependencies) {
    const provenance = dependency?.capturedProvenance;
    if (!provenance || !Number.isInteger(provenance.position)) continue;
    if (!latest || provenance.position > latest.position) latest = provenance;
  }
  return latest;
}

/**
 * Finds the earliest checkpoint whose owned evidence or actual commit boundary
 * is no longer a member of the selected canonical history.
 */
export function analyzeStoryHistory(state, chat, chatId, helpers = {}) {
  if (!state || !Array.isArray(chat) || !chatId) {
    return { valid: false, blocked: true, reason: 'history_context_unavailable' };
  }
  const checkpoints = Array.isArray(state.history?.checkpoints)
    ? state.history.checkpoints
    : [];
  if (checkpoints.length === 0) {
    const hasUncheckpointedState = Object.keys(state.npcs || {}).length > 0 || state.revision > 0;
    return hasUncheckpointedState
      ? { valid: false, blocked: true, reason: 'trustworthy_baseline_missing' }
      : { valid: true, divergent: false, safeCheckpointIndex: -1, safeBoundaryPosition: -1 };
  }

  let safeCheckpointIndex = -1;
  let safeBoundaryPosition = -1;
  let divergence = null;
  const importBaselineIndex = checkpoints.findIndex(
    (checkpoint) => checkpoint?.operation?.mode === IMPORT_BASELINE_MODE,
  );
  const fingerprintIndex = Array.isArray(helpers.fingerprintIndex)
    ? helpers.fingerprintIndex
    : (typeof helpers.buildChatFingerprintIndex === 'function'
      ? helpers.buildChatFingerprintIndex(chat)
      : null);
  const operationHelpers = fingerprintIndex ? { ...helpers, fingerprintIndex } : helpers;
  for (let index = 0; index < checkpoints.length; index++) {
    const checkpoint = checkpoints[index];
    let invalidProvenance = null;
    for (const dependency of checkpoint?.sourceDependencies || []) {
      const provenance = dependency?.capturedProvenance;
      if (!provenance?.chatId) continue;
      if (!provenanceMatchesCanonicalHistory(provenance, chat, chatId, operationHelpers)) {
        invalidProvenance = provenance;
        break;
      }
    }
    const boundary = derivedCheckpointBoundary(checkpoint);
    if (
      !invalidProvenance &&
      boundary?.chatId &&
      !provenanceMatchesCanonicalHistory(boundary, chat, chatId, operationHelpers)
    ) {
      invalidProvenance = boundary;
    }
    if (invalidProvenance) {
      divergence = {
        checkpointIndex: index,
        checkpointId: checkpoint.id,
        position: invalidProvenance.position,
        provenance: invalidProvenance,
      };
      break;
    }
    safeCheckpointIndex = index;
    if (boundary?.chatId === chatId && Number.isInteger(boundary.position)) {
      safeBoundaryPosition = Math.max(safeBoundaryPosition, boundary.position);
    }
  }

  if (!divergence) {
    return {
      valid: true,
      divergent: false,
      safeCheckpointIndex,
      safeBoundaryPosition,
    };
  }
  if (importBaselineIndex >= 0 && safeCheckpointIndex < importBaselineIndex) {
    return {
      valid: false,
      blocked: true,
      reason: 'pre_import_history_untrusted',
      divergence,
      safeCheckpointIndex,
      safeBoundaryPosition,
    };
  }
  return {
    valid: true,
    divergent: true,
    divergence,
    safeCheckpointIndex,
    safeBoundaryPosition,
  };
}

function stateFromCheckpoint(checkpoint, safeHistory) {
  if (!checkpoint) return createInitialState();
  return {
    ...createInitialState(),
    revision: checkpoint.commitRevision,
    npcs: cloneState(checkpoint.npcs || {}),
    tombstones: cloneState(checkpoint.tombstones || {}),
    dedup: cloneState(checkpoint.dedup || { processedSourceKeys: [] }),
    pendingReview: cloneState(checkpoint.pendingReview || { entries: [] }),
    history: { checkpoints: cloneState(safeHistory) },
  };
}

function latestPrecedingUser(chat, assistantPosition) {
  for (let position = assistantPosition - 1; position >= 0; position--) {
    const message = chat[position];
    if (message && message.is_user && !message.is_system && typeof message.mes === 'string') {
      return { message, position };
    }
  }
  return null;
}

function buildReplayExchangeContext(chat, chatId, assistantPosition, helpers) {
  const assistantMessage = chat[assistantPosition];
  const precedingUser = latestPrecedingUser(chat, assistantPosition);
  if (!assistantMessage || !precedingUser) return null;
  const fingerprintIndex = Array.isArray(helpers.fingerprintIndex) ? helpers.fingerprintIndex : null;
  const assistantNarrative = stripMachineTrailer(assistantMessage.mes);
  const assistantLineage = helpers.buildPrecedingLineage(chat, assistantPosition, fingerprintIndex);
  const userLineage = helpers.buildPrecedingLineage(chat, precedingUser.position, fingerprintIndex);
  return {
    chatId,
    exchangeId: `${chatId}:${assistantPosition}`,
    currentUserMessage: {
      chatId,
      position: precedingUser.position,
      role: 'user',
      text: precedingUser.message.mes,
      contentFingerprint: fingerprintIndex?.[precedingUser.position] || computeContentFingerprint(precedingUser.message.mes),
      precedingLineage: userLineage,
      swipe: helpers.getMessageSwipeId(precedingUser.message),
    },
    currentAssistantMessage: {
      chatId,
      position: assistantPosition,
      role: 'assistant',
      text: assistantMessage.mes,
      contentFingerprint: fingerprintIndex?.[assistantPosition] || computeContentFingerprint(assistantNarrative),
      precedingLineage: assistantLineage,
      swipe: helpers.getMessageSwipeId(assistantMessage),
    },
    requestLineage: assistantLineage,
  };
}

function buildPortableAssistantOccurrenceCounts(chat, chatId, helpers) {
  const counts = new Map();
  const fingerprintIndex = Array.isArray(helpers.fingerprintIndex) ? helpers.fingerprintIndex : null;
  for (let position = 0; position < chat.length; position++) {
    const message = chat[position];
    if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') continue;
    const contentFingerprint = fingerprintIndex?.[position] || computeContentFingerprint(stripMachineTrailer(message.mes));
    const signature = portableSourceSignature({
      chatId,
      role: 'assistant',
      swipe: helpers.getMessageSwipeId(message),
      contentFingerprint,
    });
    counts.set(signature, (counts.get(signature) || 0) + 1);
  }
  return counts;
}

function recordHistoricalIdentityAssignment(byAssistant, provenance, assignment) {
  if (
    provenance?.role !== 'assistant' ||
    !assignment?.localRef ||
    !assignment?.assignedId
  ) {
    return;
  }
  const signature = sourceSignature(provenance);
  const portableSignature = `portable|${portableSourceSignature(provenance)}`;
  if (!signature) return;
  if (!byAssistant.has(signature)) byAssistant.set(signature, new Map());
  if (!byAssistant.has(portableSignature)) byAssistant.set(portableSignature, new Map());

  const assignments = byAssistant.get(signature);
  const priorAssignedId = assignments.get(assignment.localRef);
  if (priorAssignedId === undefined || priorAssignedId === assignment.assignedId) {
    assignments.set(assignment.localRef, assignment.assignedId);
  } else {
    assignments.set(assignment.localRef, null);
  }
  const portableAssignments = byAssistant.get(portableSignature);
  const priorPortableId = portableAssignments.get(assignment.localRef);
  if (priorPortableId === undefined || priorPortableId === assignment.assignedId) {
    portableAssignments.set(assignment.localRef, assignment.assignedId);
  } else {
    portableAssignments.set(assignment.localRef, null);
  }

  const proposalSignature = proposalIdentitySignature(provenance, assignment.identityKey);
  if (!proposalSignature) return;
  if (!byAssistant.has(proposalSignature)) byAssistant.set(proposalSignature, new Map());
  const proposalAssignments = byAssistant.get(proposalSignature);
  const priorProposalId = proposalAssignments.get(assignment.localRef);
  if (priorProposalId === undefined || priorProposalId === assignment.assignedId) {
    proposalAssignments.set(assignment.localRef, assignment.assignedId);
  } else {
    proposalAssignments.set(assignment.localRef, null);
  }
}

function collectHistoricalIdentityAssignments(state, chat, chatId, helpers) {
  const byAssistant = new Map();
  const checkpoints = state.history?.checkpoints || [];
  let priorNpcs = {};
  for (const checkpoint of checkpoints) {
    const assistantProvenance = (checkpoint.sourceDependencies || [])
      .map((dependency) => dependency?.capturedProvenance)
      .filter((provenance) => provenance?.role === 'assistant' && provenance.chatId === chatId)
      .sort((a, b) => b.position - a.position)[0];
    if (!assistantProvenance) {
      for (const assignment of checkpoint.identityAssignments || []) {
        recordHistoricalIdentityAssignment(
          byAssistant,
          assignment?.sourceProvenance,
          assignment,
        );
      }
      priorNpcs = checkpoint.npcs || priorNpcs;
      continue;
    }
    const signature = sourceSignature(assistantProvenance);
    const portableSignature = `portable|${portableSourceSignature(assistantProvenance)}`;
    if (!byAssistant.has(signature)) byAssistant.set(signature, new Map());
    if (!byAssistant.has(portableSignature)) byAssistant.set(portableSignature, new Map());
    const assignments = byAssistant.get(signature);
    const portableAssignments = byAssistant.get(portableSignature);
    for (const assignment of checkpoint.identityAssignments || []) {
      recordHistoricalIdentityAssignment(
        byAssistant,
        assignment?.sourceProvenance || assistantProvenance,
        assignment,
      );
    }

    // Backward-compatible S1-S5 inference is exact and name-unique only. It
    // deliberately refuses ambiguous same-name candidates rather than using order.
    if (assignments.size === 0 && checkpoint.operation?.writer === WRITERS.ONE_PASS) {
      const newIds = Object.keys(checkpoint.npcs || {}).filter((id) => !priorNpcs[id]);
      const message = chat[assistantProvenance.position];
      if (
        newIds.length > 0 &&
        provenanceMatchesCanonicalHistory(assistantProvenance, chat, chatId, helpers) &&
        message
      ) {
        const parsed = extractAndParseOnePassTrailer(message.mes);
        if (parsed.success) {
          for (const proposal of parsed.payload.proposals || []) {
            if (!proposal.localRef) continue;
            const candidates = newIds.filter((id) => {
              const npc = checkpoint.npcs[id];
              return npc?.name === proposal.name &&
                (proposal.identityKind === undefined || npc.identityKind === proposal.identityKind);
            });
            if (candidates.length === 1) {
              assignments.set(proposal.localRef, candidates[0]);
              const priorPortableId = portableAssignments.get(proposal.localRef);
              if (priorPortableId === undefined || priorPortableId === candidates[0]) {
                portableAssignments.set(proposal.localRef, candidates[0]);
              } else {
                portableAssignments.set(proposal.localRef, null);
              }
            }
          }
        }
      }
    }
    priorNpcs = checkpoint.npcs || priorNpcs;
  }
  return byAssistant;
}

function replayPendingEntries(payload, context, assistantPosition) {
  const entries = [];
  const targets = new Set();
  for (const proposal of payload.proposals || []) {
    const targetKey = proposal.localRef || proposal.id || proposal.targetId;
    if (!targetKey || targets.has(targetKey)) continue;
    targets.add(targetKey);
    entries.push({
      id: `pending_${context.chatId}_${assistantPosition}_${targetKey}`,
      targetId: targetKey,
      sourceScope: [
        `chat:${context.chatId}:${context.currentUserMessage.position}`,
        `chat:${context.chatId}:${assistantPosition}`,
      ],
      exchangeId: `${context.chatId}:${assistantPosition}`,
      reason: proposal.localRef ? 'new_admission' : 'fast_proposal',
      createdAt: new Date().toISOString(),
      metadata: {
        userPosition: context.currentUserMessage.position,
        userSwipe: context.currentUserMessage.swipe,
        assistantPosition,
        assistantSwipe: context.currentAssistantMessage.swipe,
        userFingerprint: context.currentUserMessage.contentFingerprint,
        assistantFingerprint: context.currentAssistantMessage.contentFingerprint,
        reconstructed: true,
      },
    });
  }
  return entries;
}

export class StoryHistoryRecovery {
  constructor(options = {}) {
    if (!options.storage || !options.coordinator) {
      throw new Error('StoryHistoryRecovery requires shared storage and CommitCoordinator.');
    }
    this.storage = options.storage;
    this.coordinator = options.coordinator;
    this.getContext = options.getContext || (() => globalThis.SillyTavern?.getContext?.());
    this.diagnostics = options.diagnostics || null;
    this.developmentReview = options.developmentReview || null;
    this.helpers = {
      buildPrecedingLineage: options.buildPrecedingLineage,
      buildChatFingerprintIndex: options.buildChatFingerprintIndex,
      lineageMatchesFingerprintIndex: options.lineageMatchesFingerprintIndex,
      getMessageSwipeId: options.getMessageSwipeId,
    };
    if (typeof this.helpers.buildPrecedingLineage !== 'function' ||
        typeof this.helpers.getMessageSwipeId !== 'function') {
      throw new Error('StoryHistoryRecovery requires canonical lineage/swipe helpers.');
    }
    this._queue = Promise.resolve();
    this.lastResultByChat = new Map();
  }

  setDevelopmentReview(review) {
    this.developmentReview = review || null;
  }

  getStatus(chatId = this.storage.getChatId?.() || null) {
    return chatId ? (this.lastResultByChat.get(chatId) || null) : null;
  }

  requestRecovery(eventName, messageId) {
    const run = () => this.recover({ eventName, messageId });
    this._queue = this._queue.then(run, run);
    return this._queue;
  }

  async recover({ eventName = 'manual_recovery', messageId = null } = {}) {
    const recoveryStartedAt = monotonicNowMs();
    const initialContext = this.getContext?.();
    const chatId = this.storage.getChatId?.(initialContext) ||
      initialContext?.chatId ||
      initialContext?.getCurrentChatId?.() ||
      null;
    const chat = initialContext?.chat;
    if (!chatId || !Array.isArray(chat)) {
      return { success: false, status: 'history_context_unavailable' };
    }

    let developmentInvalidated = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const loaded = await this.storage.load();
      const fingerprintIndex = typeof this.helpers.buildChatFingerprintIndex === 'function'
        ? this.helpers.buildChatFingerprintIndex(chat)
        : null;
      const operationHelpers = fingerprintIndex
        ? { ...this.helpers, fingerprintIndex }
        : this.helpers;
      const analysis = analyzeStoryHistory(loaded.state, chat, chatId, operationHelpers);
      if (analysis.blocked || !analysis.valid) {
        const result = {
          success: false,
          status: 'blocked',
          reason: analysis.reason,
          divergence: analysis.divergence || null,
        };
        this.lastResultByChat.set(chatId, result);
        this.diagnostics?.record?.({
          type: DIAGNOSTIC_EVENT_TYPES.HISTORY_RECOVERY_FAILED,
          chatId,
          eventName,
          reason: result.reason,
        });
        return result;
      }
      if (!analysis.divergent) {
        const result = { success: true, status: 'no_change', chatId };
        this.lastResultByChat.set(chatId, result);
        if (developmentInvalidated) this.developmentReview?.onHistoryRecovered?.(chatId);
        return result;
      }
      if (!developmentInvalidated) {
        await this.developmentReview?.onHistoryInvalidation?.(chatId);
        developmentInvalidated = true;
        // The in-flight Development job may have committed or failed while it
        // was being cancelled. Re-read and re-analyze before choosing a base.
        attempt--;
        continue;
      }

      const checkpoints = loaded.state.history?.checkpoints || [];
      const safeHistory = checkpoints.slice(0, analysis.safeCheckpointIndex + 1);
      const safeCheckpoint = analysis.safeCheckpointIndex >= 0
        ? checkpoints[analysis.safeCheckpointIndex]
        : null;
      // Temporary replay does not consult historical checkpoints. Preserve the
      // safe checkpoint set separately for the final atomic reconstruction, but
      // keep it out of every ephemeral coordinator clone.
      const baseState = stateFromCheckpoint(safeCheckpoint, []);
      // Locks are latest user authority, not historical story authority. Replay
      // first, then the durable reconstruction boundary restores the latest locks
      // and correction values atomically.
      for (const npc of Object.values(baseState.npcs || {})) npc.locks = {};

      const tempStorage = new MemoryStorageAdapter(baseState, { ephemeralReplay: true });
      const tempCoordinator = new CommitCoordinator({
        storage: tempStorage,
        admissionPolicy: this.coordinator.admissionPolicy,
        settings: this.coordinator.settings,
      });
      const identityHistory = collectHistoricalIdentityAssignments(
        loaded.state,
        chat,
        chatId,
        operationHelpers,
      );
      const portableOccurrenceCounts = buildPortableAssistantOccurrenceCounts(chat, chatId, operationHelpers);
      const replayResults = [];
      const replayedDependencies = [];
      const replayedAssignments = [];

      for (let position = Math.max(0, analysis.safeBoundaryPosition + 1); position < chat.length; position++) {
        const message = chat[position];
        if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') continue;
        const parsed = extractAndParseOnePassTrailer(message.mes);
        if (!parsed.success) {
          replayResults.push({ position, status: 'skipped', reason: parsed.errorCode || 'trailer_unavailable' });
          continue;
        }
        const validated = validateOnePassEnvelope(parsed.payload);
        if (!validated.valid) {
          replayResults.push({ position, status: 'rejected', reason: 'schema_validation_failed' });
          continue;
        }
        const exchangeContext = buildReplayExchangeContext(chat, chatId, position, operationHelpers);
        if (!exchangeContext) {
          replayResults.push({ position, status: 'rejected', reason: 'owned_user_source_unavailable' });
          continue;
        }
        const signature = sourceSignature(exchangeContext.currentAssistantMessage);
        const portableSignature = `portable|${portableSourceSignature(exchangeContext.currentAssistantMessage)}`;
        const portableOccurrences = portableOccurrenceCounts.get(
          portableSourceSignature(exchangeContext.currentAssistantMessage),
        ) || 0;
        let preferredIds = new Map(
          [...(identityHistory.get(signature) || [])].filter(([, assignedId]) => typeof assignedId === 'string'),
        );
        if (preferredIds.size === 0 && portableOccurrences === 1) {
          const portableIds = identityHistory.get(portableSignature);
          if (portableIds) {
            preferredIds = new Map([...portableIds].filter(([, assignedId]) => typeof assignedId === 'string'));
          }
        }
        // A partial edit can change the whole-message fingerprint while leaving
        // one or more exact NEW identity proposals intact. Preserve only those
        // proposal-scoped assignments at the same chat/position/swipe/revision
        // and preceding lineage; never use proposal order or fuzzy name matching.
        for (const proposal of parsed.payload.proposals || []) {
          if (!proposal?.localRef || preferredIds.has(proposal.localRef)) continue;
          const identityKey = buildIdentityReplayKey(proposal);
          const proposalIds = identityHistory.get(
            proposalIdentitySignature(exchangeContext.currentAssistantMessage, identityKey),
          );
          const assignedId = proposalIds?.get(proposal.localRef);
          if (typeof assignedId === 'string') preferredIds.set(proposal.localRef, assignedId);
        }
        const dedupKey = `${chatId}:${position}:${exchangeContext.currentAssistantMessage.swipe}:${exchangeContext.currentAssistantMessage.contentFingerprint}`;
        const pendingReviewEntries = replayPendingEntries(parsed.payload, exchangeContext, position);
        const commitResult = await tempCoordinator.commitValidatedEnvelope({
          writer: WRITERS.ONE_PASS,
          envelope: parsed.payload,
          exchangeContext,
          dedupKeys: [dedupKey],
          pendingReviewEntries,
          historyBoundary: captureStoryHistoryBoundary(chat, chatId, position, operationHelpers),
          identityOptions: preferredIds.size > 0 ? { preferredIds } : {},
          operationMode: 'history_replay',
          ephemeralHistoryReplay: true,
        });
        if (!commitResult.success) {
          replayResults.push({
            position,
            status: 'rejected',
            reason: commitResult.errorCode || 'canonical_replay_rejected',
          });
          continue;
        }
        if (commitResult.historyCapture) {
          replayedDependencies.push(...(commitResult.historyCapture.sourceDependencies || []));
          replayedAssignments.push(...(commitResult.historyCapture.identityAssignments || []));
        }
        replayResults.push({
          position,
          status: commitResult.replay || commitResult.noop ? 'deduped' : 'replayed',
          assignedNpcs: commitResult.assignedNpcs || [],
        });
      }

      const rebuiltLoad = await tempStorage.load();
      const reconstructedState = cloneState(rebuiltLoad.state);
      reconstructedState.history = { checkpoints: cloneState(safeHistory) };

      // Reacquire the host surface after all asynchronous replay work. A chat
      // switch or another history mutation makes this attempt stale.
      const finalContext = this.getContext?.();
      if (
        (this.storage.getChatId?.(finalContext) || finalContext?.chatId || finalContext?.getCurrentChatId?.()) !== chatId ||
        finalContext?.chat !== chat
      ) {
        return { success: false, status: 'chat_changed_during_recovery' };
      }
      const historyBoundary = captureStoryHistoryBoundary(chat, chatId, null, this.helpers);
      const commitResult = await this.coordinator.commitReconstruction({
        reconstructedState,
        expectedRevision: loaded.revision,
        historyBoundary,
        sourceDependencies: dedupeObjects(replayedDependencies, compactDependencyKey),
        identityAssignments: dedupeObjects(
          replayedAssignments,
          (assignment) => `${sourceSignature(assignment.sourceProvenance)}|${assignment.identityKey || ''}|${assignment.localRef}|${assignment.assignedId}`,
        ),
        reason: `Recovered canonical history after ${eventName} at ${messageId ?? 'unknown position'}`,
      });
      if (commitResult.conflict && attempt < 2) continue;
      if (!commitResult.success) {
        const result = {
          success: false,
          status: commitResult.conflict ? 'conflict' : 'failed',
          reason: commitResult.errorCode || 'reconstruction_commit_failed',
          error: commitResult.error,
          replayResults,
        };
        this.lastResultByChat.set(chatId, result);
        this.diagnostics?.record?.({
          type: DIAGNOSTIC_EVENT_TYPES.HISTORY_RECOVERY_FAILED,
          chatId,
          eventName,
          reason: result.reason,
        });
        return result;
      }

      // Storage persistence is asynchronous relative to host events. Revalidate
      // the complete canonical boundary after the CAS save so an edit occurring
      // during persistence cannot be reported as a successful recovery. The
      // just-written checkpoint remains self-invalidating and the bounded retry
      // reconstructs it against the newer canonical history.
      const postCommitContext = this.getContext?.();
      const postCommitChatId = this.storage.getChatId?.(postCommitContext) ||
        postCommitContext?.chatId ||
        postCommitContext?.getCurrentChatId?.() ||
        null;
      const postCommitBoundary = captureStoryHistoryBoundary(
        postCommitContext?.chat,
        postCommitChatId,
        null,
        this.helpers,
      );
      if (
        postCommitChatId !== chatId ||
        postCommitContext?.chat !== chat ||
        !valuesEqual(postCommitBoundary, historyBoundary)
      ) {
        if (attempt < 2) continue;
        const result = {
          success: false,
          status: 'history_changed_during_recovery',
          reason: 'canonical_history_changed_during_persistence',
        };
        this.lastResultByChat.set(chatId, result);
        this.diagnostics?.record?.({
          type: DIAGNOSTIC_EVENT_TYPES.HISTORY_RECOVERY_FAILED,
          chatId,
          eventName,
          reason: result.reason,
        });
        return result;
      }

      const finalState = (await this.storage.load()).state;
      const result = {
        success: true,
        status: 'recovered',
        chatId,
        eventName,
        messageId,
        divergence: analysis.divergence,
        safeCheckpointId: safeCheckpoint?.id || null,
        safeBoundaryPosition: analysis.safeBoundaryPosition,
        replayResults,
        commitRevision: commitResult.commitRevision,
        checkpointId: commitResult.checkpointId,
        processedSourceKeys: [...(finalState.dedup?.processedSourceKeys || [])],
        durationMs: elapsedMs(recoveryStartedAt),
        attemptCount: attempt + 1,
      };
      this.lastResultByChat.set(chatId, result);
      this.diagnostics?.record?.({
        type: DIAGNOSTIC_EVENT_TYPES.HISTORY_RECOVERY_COMMITTED,
        chatId,
        eventName,
        commitRevision: result.commitRevision,
        durationMs: result.durationMs,
        attemptCount: result.attemptCount,
        safeBoundaryPosition: result.safeBoundaryPosition,
        replayConsidered: replayResults.length,
        replayed: replayResults.filter((item) => item.status === 'replayed').length,
        rejected: replayResults.filter((item) => item.status === 'rejected').length,
      });
      this.developmentReview?.onHistoryRecovered?.(chatId);
      return result;
    }
    return { success: false, status: 'conflict', reason: 'reconstruction_retry_exhausted' };
  }
}
