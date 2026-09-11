/**
 * NPC State Alpha — S4 asynchronous Development review scheduler
 *
 * One request per active chat, oldest-first batches, foreground priority, and
 * late-result commit through the existing shared CommitCoordinator.
 */

import { WRITERS } from '../contract/registry.js';
import { revalidateSourceDependency, stripMachineTrailer } from '../runtime/source-resolver.js';
import { normalizeAlphaSettings } from '../contract/settings.js';
import { parseDevelopmentResponse } from '../contract/parser.js';
import { validateDevelopmentEnvelope } from '../contract/validator.js';
import {
  AUDIT_OPERATIONS,
  AUDIT_OUTCOMES,
  OPERATION_MASKS,
  validateFieldOutcome,
} from '../contract/audit-modes.js';
import {
  buildDevelopmentDispatch,
  buildDevelopmentExchangeContext,
  collectDevelopmentResponseFields,
  deriveDevelopmentReadDependencies,
  selectDevelopmentBatch,
} from './development-context.js';
import { SillyTavernDevelopmentProvider } from './development-provider.js';
import { DIAGNOSTIC_EVENT_TYPES } from './diagnostics.js';
import { computeContentFingerprint } from './fingerprint.js';
import { buildPrecedingLineage, getMessageSwipeId } from './sillytavern-adapter.js';
import { captureStoryHistoryBoundary } from './history-recovery.js';

const BLOCKING_REVIEW_STATUSES = new Set(['failed', 'unavailable', 'deferred']);

function isBlockedEntry(entry) {
  return BLOCKING_REVIEW_STATUSES.has(entry?.metadata?.lastReviewStatus);
}

function unique(values) {
  return [...new Set(values)];
}

function nowIso() {
  return new Date().toISOString();
}

function monotonicNowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function elapsedMs(startedAt) {
  return Math.round((monotonicNowMs() - startedAt) * 1000) / 1000;
}

function receiptList(envelope) {
  return Array.isArray(envelope?.reviewReceipts)
    ? envelope.reviewReceipts
    : (Array.isArray(envelope?.targetAcknowledgments) ? envelope.targetAcknowledgments : []);
}

function targetIdOf(item) {
  return item?.targetId || item?.id || null;
}

function collectSourceRefs(value, out = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectSourceRefs(item, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'sourceRef' && typeof item === 'string') out.add(item);
    if (key === 'sourceRefs' && Array.isArray(item)) {
      for (const ref of item) if (typeof ref === 'string') out.add(ref);
    }
    collectSourceRefs(item, out);
  }
  return out;
}

function findLatestCapturedDependency(state, sourceRef) {
  const checkpoints = state?.history?.checkpoints;
  if (!Array.isArray(checkpoints)) return null;
  for (let i = checkpoints.length - 1; i >= 0; i--) {
    const dependencies = checkpoints[i]?.sourceDependencies;
    if (!Array.isArray(dependencies)) continue;
    for (let j = dependencies.length - 1; j >= 0; j--) {
      const dependency = dependencies[j];
      if (dependency?.sourceRef === sourceRef && dependency.capturedProvenance) return dependency;
    }
  }
  return null;
}

function provenanceMatchesLiveMessage(provenance, message, chat, expectedChatId, expectedPosition) {
  if (!provenance || !message || typeof message.mes !== 'string') return false;
  if (provenance.chatId !== expectedChatId || provenance.position !== expectedPosition) return false;
  const expectedRole = message.is_user ? 'user' : (!message.is_system ? 'assistant' : 'system');
  if (provenance.role !== expectedRole) return false;
  if (provenance.swipe !== undefined && provenance.swipe !== null && getMessageSwipeId(message) !== provenance.swipe) return false;
  const text = expectedRole === 'assistant' ? stripMachineTrailer(message.mes) : message.mes;
  if (computeContentFingerprint(text) !== provenance.contentFingerprint) return false;
  const expectedLineage = Array.isArray(provenance.precedingLineage) ? provenance.precedingLineage : [];
  const actualLineage = buildPrecedingLineage(chat, expectedPosition);
  return actualLineage.length === expectedLineage.length && expectedLineage.every((fingerprint, index) => fingerprint === actualLineage[index]);
}

/**
 * Request/response scope guard layered above the generic S1 validator.
 * Prevents a provider response from acknowledging or citing targets/sources that
 * were not supplied in this exact S4 batch.
 */
export function validateDevelopmentResponseScope(envelope, dispatch) {
  const errors = [];
  const allowedTargets = new Set(dispatch.targetIds || []);
  const allowedSources = new Set(dispatch.entries.flatMap((entry) => entry.sourceScope || []));
  const receipts = receiptList(envelope);
  const receiptsByTarget = new Map();

  for (const receipt of receipts) {
    const targetId = targetIdOf(receipt);
    if (!allowedTargets.has(targetId)) {
      errors.push(`Receipt target '${targetId}' was not supplied in this batch.`);
      continue;
    }
    if (receiptsByTarget.has(targetId)) errors.push(`Duplicate review receipt for target '${targetId}'.`);
    receiptsByTarget.set(targetId, receipt);
    const targetSources = new Set(dispatch.targetSourceScope?.[targetId] || []);
    for (const sourceRef of receipt.sourceScope || []) {
      if (!targetSources.has(sourceRef)) {
        errors.push(`Receipt source '${sourceRef}' is outside target '${targetId}' supplied scope.`);
      }
    }
  }

  for (const targetId of allowedTargets) {
    const receipt = receiptsByTarget.get(targetId);
    if (!receipt) {
      errors.push(`Missing review receipt for supplied target '${targetId}'.`);
      continue;
    }
    const scope = Array.isArray(receipt.sourceScope) ? receipt.sourceScope : [];
    for (const requiredRef of dispatch.targetSourceScope?.[targetId] || []) {
      if (!scope.includes(requiredRef)) errors.push(`Receipt for '${targetId}' does not acknowledge supplied source '${requiredRef}'.`);
    }

    const requiredFields = Array.isArray(dispatch.targetFieldSubset?.[targetId])
      ? dispatch.targetFieldSubset[targetId]
      : null;
    if (requiredFields && requiredFields.length > 0) {
      if (receipt.restricted !== true) {
        errors.push(`Receipt for restricted target '${targetId}' must set restricted=true.`);
      }
      const receiptFields = Array.isArray(receipt.fieldSubset) ? receipt.fieldSubset : [];
      for (const field of requiredFields) {
        if (!receiptFields.includes(field)) {
          errors.push(`Receipt for restricted target '${targetId}' does not acknowledge required field '${field}'.`);
        }
      }
    } else if (receipt.restricted === true) {
      errors.push(`Receipt for unrestricted target '${targetId}' cannot narrow the supplied review scope.`);
    }
  }

  for (const group of [envelope?.proposals, envelope?.observations, envelope?.supportProposals]) {
    for (const item of group || []) {
      const targetId = targetIdOf(item);
      if (targetId && !allowedTargets.has(targetId)) {
        errors.push(`Response item target '${targetId}' was not supplied in this batch.`);
        continue;
      }
      if (targetId) {
        const targetSources = new Set(dispatch.targetSourceScope?.[targetId] || []);
        for (const sourceRef of collectSourceRefs(item)) {
          if (!targetSources.has(sourceRef)) {
            errors.push(`Response item for '${targetId}' cites source '${sourceRef}' outside that target's supplied scope.`);
          }
        }
      }
    }
  }
  const proposalFields = collectDevelopmentResponseFields({
    proposals: envelope?.proposals || [],
    observations: [],
    supportProposals: [],
  });

  // Persisted observation IDs are not independent evidence. They may be used only
  // when the request supplied that retained observation together with its exact
  // original owned source in this target's current scope. S4 also rejects support
  // for a still-unknown dossier field unless this same response establishes it.
  for (const support of envelope?.supportProposals || []) {
    const targetId = targetIdOf(support);
    const baseField = String(support?.field || '').split('.')[0];
    const acceptedFields = new Set(dispatch.targetAcceptedFields?.[targetId] || []);
    const proposedFields = proposalFields.get(targetId) || new Set();
    if (baseField && !acceptedFields.has(baseField) && !proposedFields.has(baseField)) {
      errors.push(`Support proposal for '${targetId}.${baseField}' has no accepted value and no same-response durable proposal.`);
    }
    const allowedObservationIds = new Set(dispatch.targetObservationIds?.[targetId] || []);
    for (const observationId of support.supportingObservationIds || []) {
      if (!allowedObservationIds.has(observationId)) {
        errors.push(`Support proposal for '${targetId}' references retained observation '${observationId}' without its owned source in this request.`);
      }
    }
  }
  for (const observation of envelope?.observations || []) {
    const targetId = targetIdOf(observation);
    const allowedObservationIds = new Set(dispatch.targetObservationIds?.[targetId] || []);
    const linked = observation?.disposition?.linkedObservationIds;
    const linkedIds = typeof linked === 'string' ? [linked] : (Array.isArray(linked) ? linked : []);
    for (const observationId of linkedIds) {
      if (!allowedObservationIds.has(observationId)) {
        errors.push(`Observation for '${targetId}' links retained observation '${observationId}' without its owned source in this request.`);
      }
    }
  }

  const responseFields = collectDevelopmentResponseFields(envelope);
  for (const [targetId, fields] of responseFields.entries()) {
    const requiredFields = Array.isArray(dispatch.targetFieldSubset?.[targetId])
      ? new Set(dispatch.targetFieldSubset[targetId])
      : null;
    if (!requiredFields || requiredFields.size === 0) continue;
    for (const field of fields) {
      if (!requiredFields.has(field)) {
        errors.push(`Restricted target '${targetId}' returned out-of-scope durable field '${field}'.`);
      }
    }
  }

  for (const sourceRef of collectSourceRefs(envelope)) {
    if (!allowedSources.has(sourceRef)) errors.push(`Response cites unsupplied source '${sourceRef}'.`);
  }
  return { valid: errors.length === 0, errors };
}

export class DevelopmentReviewQueue {
  constructor(options = {}) {
    if (!options.storage) throw new Error('DevelopmentReviewQueue requires shared storage.');
    if (!options.coordinator) throw new Error('DevelopmentReviewQueue requires shared CommitCoordinator.');
    this.storage = options.storage;
    this.coordinator = options.coordinator;
    this.getContext = options.getContext || (() => globalThis.SillyTavern?.getContext?.());
    this.provider = options.provider || new SillyTavernDevelopmentProvider(options.providerOptions || {});
    this.diagnostics = options.diagnostics || null;
    this.settingsSource = options.settings || null;
    this.inFlightByChat = new Map();
    this.coalescedByChat = new Map();
    this.lastResultByChat = new Map();
    this.lastProviderUsageByChat = new Map();
    this.statusListeners = new Set();
  }

  /**
   * Subscribe to bounded queue-status/state-change notifications for thin UI refresh.
   * Returns an idempotent unsubscribe function. This is notification only; canonical
   * state remains in shared storage and all writes still flow through CommitCoordinator.
   */
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.statusListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.statusListeners.delete(listener);
    };
  }

  _notifyStatus(change = {}) {
    for (const listener of this.statusListeners) {
      try { listener(change); } catch {}
    }
  }

  setSettingsSource(source) {
    this.settingsSource = source || null;
    return this.getSettings();
  }

  onSettingsChanged(settings = this.getSettings()) {
    const normalized = normalizeAlphaSettings(settings || {});
    if (!normalized.enabled || !normalized.developmentEnabled) {
      for (const job of this.inFlightByChat.values()) {
        if (!job.controller.signal.aborted) job.controller.abort('settings_disabled');
      }
    }
    return normalized;
  }

  getSettings() {
    let supplied = this.settingsSource;
    if (typeof supplied === 'function') supplied = supplied();
    if (!supplied) {
      const ctx = this.getContext?.();
      supplied = ctx?.extensionSettings?.npc_state_alpha || {};
    }
    return normalizeAlphaSettings(supplied || {});
  }

  getStatus(chatId = this.storage.getChatId()) {
    const job = chatId ? this.inFlightByChat.get(chatId) : null;
    return {
      chatId: chatId || null,
      inFlight: Boolean(job),
      reason: job?.reason || null,
      coalesced: Boolean(chatId && this.coalescedByChat.has(chatId)),
      lastResult: chatId ? (this.lastResultByChat.get(chatId) || null) : null,
      lastProviderUsage: chatId ? (this.lastProviderUsageByChat.get(chatId) || null) : null,
    };
  }

  _record(type, details = {}) {
    this.diagnostics?.record?.({ type, ...details });
  }

  _requestFollowup(chatId, reason, manual = false) {
    if (!chatId) return;
    const prior = this.coalescedByChat.get(chatId) || { manual: false, reasons: [] };
    prior.manual = prior.manual || manual;
    prior.reasons.push(reason);
    this.coalescedByChat.set(chatId, prior);
  }

  onHostReady() {
    this.trigger('host_ready').catch(() => {});
  }

  onImmediateCommit() {
    this.trigger('immediate_commit').catch(() => {});
  }

  onForegroundStart(chatId = this.storage.getChatId()) {
    if (!chatId) return false;
    const job = this.inFlightByChat.get(chatId);
    if (!job) return false;
    job.yieldedForForeground = true;
    if (!job.controller.signal.aborted) job.controller.abort('foreground_priority');
    this._record(DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_YIELDED, { chatId, reason: 'foreground_priority' });
    return true;
  }

  async onHistoryInvalidation(chatId = this.storage.getChatId()) {
    if (!chatId) return false;
    const job = this.inFlightByChat.get(chatId);
    this.coalescedByChat.delete(chatId);
    if (!job) return false;
    if (!job.controller.signal.aborted) job.controller.abort('history_invalidated');
    await job.promise.catch(() => {});
    return true;
  }

  onHistoryRecovered(chatId = this.storage.getChatId()) {
    if (!chatId || chatId !== this.storage.getChatId()) return;
    this.trigger('history_recovered').catch(() => {});
  }

  onChatChanged(activeChatId = this.storage.getChatId()) {
    for (const [chatId, job] of this.inFlightByChat.entries()) {
      if (chatId !== activeChatId && !job.controller.signal.aborted) job.controller.abort('chat_changed');
    }
    if (activeChatId) this.trigger('chat_loaded').catch(() => {});
  }

  async waitForIdle(chatId = this.storage.getChatId()) {
    while (chatId) {
      const job = this.inFlightByChat.get(chatId);
      if (!job) return this.lastResultByChat.get(chatId) || { status: 'idle' };
      await job.promise.catch(() => {});
    }
    return { status: 'no_chat' };
  }

  _manualBusyResult(reason) {
    const chatId = this.storage.getChatId();
    if (!chatId || !this.inFlightByChat.has(chatId)) return null;
    this._record(DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_COALESCED, { chatId, reason, manual: true, rejected: true });
    return {
      success: false,
      status: 'already_in_flight',
      chatId,
      reason: 'development_already_in_flight',
      error: 'A Development review is already active for this chat. Retry this manual operation after it finishes.',
    };
  }

  /**
   * Triggers manual review of pending entries.
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async reviewPending(options = {}) {
    const busy = this._manualBusyResult('manual_review_pending');
    if (busy) return busy;
    return this.trigger('manual_review_pending', { manual: true, ...options });
  }

  /**
   * Resets blocked (failed/unavailable/deferred) pending entries and triggers manual review.
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async retryFailed(options = {}) {
    const busy = this._manualBusyResult('manual_retry_failed');
    if (busy) return busy;
    const loaded = await this.storage.load();
    const blockedEntries = (loaded.state?.pendingReview?.entries || []).filter(
      (entry) => isBlockedEntry(entry)
    );
    if (blockedEntries.length > 0) {
      const pendingReviewUpdates = blockedEntries.map((entry) => ({
        id: entry.id,
        metadataPatch: {
          lastReviewStatus: 'pending',
          lastFailureCode: null,
        },
      }));
      const prepared = await this.coordinator.commit({
        writer: WRITERS.RUNTIME,
        pendingReviewUpdates,
      });
      if (!prepared.success) {
        return { status: 'retry_prepare_failed', error: prepared.error, commitResult: prepared };
      }
    }
    return this.trigger('manual_retry_failed', { manual: true, ...options });
  }

  /**
   * Helper to locate or build source scope for audit operations from active chat or existing pending entries.
   * @private
   */
  _resolveAuditSourceScope(chat, chatId, targetId, state) {
    const candidates = [];
    for (const entry of state?.pendingReview?.entries || []) {
      if (entry.targetId === targetId && Array.isArray(entry.sourceScope) && entry.sourceScope.length > 0) {
        candidates.push({ kind: 'pending', sourceScope: entry.sourceScope, exchangeId: entry.exchangeId || null, metadata: entry.metadata || {} });
      }
    }
    const receipts = state?.npcs?.[targetId]?.development?.reviewReceipts || [];
    for (let i = receipts.length - 1; i >= 0; i--) {
      const receipt = receipts[i];
      if (Array.isArray(receipt.sourceScope) && receipt.sourceScope.length > 0) {
        candidates.push({ kind: 'receipt', sourceScope: receipt.sourceScope, exchangeId: null, metadata: {} });
      }
    }

    const prefix = `chat:${chatId}:`;
    for (const candidate of candidates) {
      const positions = [];
      let invalid = false;
      for (const sourceRef of candidate.sourceScope) {
        if (typeof sourceRef !== 'string' || !sourceRef.startsWith(prefix)) { invalid = true; break; }
        const suffix = sourceRef.slice(prefix.length);
        if (!/^\d+$/.test(suffix)) { invalid = true; break; }
        const position = Number(suffix);
        if (!chat[position] || typeof chat[position].mes !== 'string') { invalid = true; break; }
        positions.push(position);
      }
      if (invalid) continue;

      const userPosition = positions.find((position) => chat[position].is_user && !chat[position].is_system);
      const assistantPosition = positions.find((position) => !chat[position].is_user && !chat[position].is_system);
      if (!Number.isInteger(userPosition) || !Number.isInteger(assistantPosition)) continue;
      const userMsg = chat[userPosition];
      const assistantMsg = chat[assistantPosition];
      const userFingerprint = computeContentFingerprint(userMsg.mes);
      const assistantFingerprint = computeContentFingerprint(stripMachineTrailer(assistantMsg.mes));

      if (candidate.kind === 'pending') {
        const metadata = candidate.metadata || {};
        if (Number.isInteger(metadata.userPosition) && metadata.userPosition !== userPosition) continue;
        if (Number.isInteger(metadata.assistantPosition) && metadata.assistantPosition !== assistantPosition) continue;
        if (metadata.userFingerprint && metadata.userFingerprint !== userFingerprint) continue;
        if (metadata.assistantFingerprint && metadata.assistantFingerprint !== assistantFingerprint) continue;
        if (metadata.userSwipe !== undefined && metadata.userSwipe !== getMessageSwipeId(userMsg)) continue;
        if (metadata.assistantSwipe !== undefined && metadata.assistantSwipe !== getMessageSwipeId(assistantMsg)) continue;
      } else {
        const userDependency = findLatestCapturedDependency(state, candidate.sourceScope.find((ref) => ref === `chat:${chatId}:${userPosition}`));
        const assistantDependency = findLatestCapturedDependency(state, candidate.sourceScope.find((ref) => ref === `chat:${chatId}:${assistantPosition}`));
        if (!userDependency || !assistantDependency) continue;
        if (!provenanceMatchesLiveMessage(userDependency.capturedProvenance, userMsg, chat, chatId, userPosition)) continue;
        if (!provenanceMatchesLiveMessage(assistantDependency.capturedProvenance, assistantMsg, chat, chatId, assistantPosition)) continue;
      }

      return {
        sourceScope: [...candidate.sourceScope],
        exchangeId: candidate.exchangeId || `${chatId}:${assistantPosition}`,
        metadata: {
          ...candidate.metadata,
          userPosition,
          userSwipe: getMessageSwipeId(userMsg),
          userFingerprint,
          assistantPosition,
          assistantSwipe: getMessageSwipeId(assistantMsg),
          assistantFingerprint,
        },
      };
    }

    // Never guess relevance from the latest exchange. Manual audit operations may
    // reconsider only evidence already owned by this target.
    return { sourceScope: [], exchangeId: null, metadata: {} };
  }

  /**
   * Rechecks missing durable details for an NPC (C12 RECHECK_MISSING operation).
   * Identifies blank durable fields defined in OPERATION_MASKS[RECHECK_MISSING],
   * enqueues a restricted review entry, and records field-level audit outcomes.
   * @param {string} targetId Target NPC ID
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async recheckMissingDetails(targetId, options = {}) {
    if (!targetId || typeof targetId !== 'string') {
      return { success: false, status: 'invalid_target', error: 'Target ID must be a non-empty string.' };
    }

    const loaded = await this.storage.load();
    if (loaded.state?.tombstones?.[targetId]) {
      return { success: false, status: 'target_tombstoned', targetId, error: `Target NPC '${targetId}' is tombstoned.` };
    }
    const npc = loaded.state?.npcs?.[targetId];
    if (!npc) {
      return { success: false, status: 'target_not_found', targetId, error: `Target NPC '${targetId}' not found.` };
    }
    const busy = this._manualBusyResult('recheck_missing');
    if (busy) return { ...busy, targetId };

    const recheckMask = OPERATION_MASKS[AUDIT_OPERATIONS.RECHECK_MISSING];
    const requestedFields = Array.isArray(options.fields) && options.fields.length > 0
      ? options.fields.filter((f) => recheckMask.includes(String(f).split('.')[0]))
      : [...recheckMask];

    // Missing/blank criteria: undefined, null, empty string, or empty array.
    // Locked fields are excluded from automatic recheck because automatic writers cannot modify them.
    const missingFields = requestedFields.filter((field) => {
      if (npc.locks?.[field] === true) return false;
      const val = npc[field];
      if (val === undefined || val === null || val === '') return true;
      if (Array.isArray(val) && val.length === 0) return true;
      return false;
    });

    if (missingFields.length === 0) {
      return {
        success: true,
        status: 'no_missing_fields',
        targetId,
        missingFields: [],
        fieldOutcomes: requestedFields.map((field) => {
          const outcome = {
            field,
            outcome: AUDIT_OUTCOMES.UNCHANGED,
            reason: npc.locks?.[field] === true ? 'Field is locked' : 'Field is already populated',
          };
          validateFieldOutcome(outcome, AUDIT_OPERATIONS.RECHECK_MISSING);
          return outcome;
        }),
      };
    }

    const ctx = this.getContext?.();
    const chatId = this.storage.getChatId(ctx);
    if (!chatId || !ctx || !Array.isArray(ctx.chat)) {
      return { success: false, status: 'chat_unavailable', error: 'Active chat is unavailable.' };
    }

    const { sourceScope, exchangeId, metadata } = this._resolveAuditSourceScope(ctx.chat, chatId, targetId, loaded.state);
    if (!sourceScope.length) {
      return { success: false, status: 'source_unavailable', error: 'No usable chat source found for recheck.' };
    }

    const entryId = `recheck_${chatId}_${targetId}_${Date.now()}`;
    const pendingEntry = {
      id: entryId,
      targetId,
      sourceScope,
      exchangeId,
      reason: 'recheck_missing',
      fieldSubset: missingFields,
      createdAt: nowIso(),
      metadata: {
        operation: AUDIT_OPERATIONS.RECHECK_MISSING,
        ...metadata,
      },
    };

    const enqueueResult = await this.coordinator.commit({
      writer: WRITERS.RUNTIME,
      pendingReviewEntries: [pendingEntry],
    });
    if (!enqueueResult.success) {
      return { success: false, status: 'enqueue_failed', error: enqueueResult.error };
    }

    const reviewResult = await this.trigger('recheck_missing', { manual: true, ...options });

    const afterLoad = await this.storage.load();
    const updatedNpc = afterLoad.state?.npcs?.[targetId] || {};
    const fieldOutcomes = [];

    for (const field of missingFields) {
      const nextVal = updatedNpc[field];
      let outcome = AUDIT_OUTCOMES.INSUFFICIENT;
      let reason = 'No evidence found in review scope';

      if (nextVal !== undefined && nextVal !== null && nextVal !== '' && !(Array.isArray(nextVal) && nextVal.length === 0)) {
        outcome = AUDIT_OUTCOMES.APPLIED;
        reason = 'Populated during recheck';
      } else if (reviewResult.status === 'provider_failed' || reviewResult.status === 'scheduler_error') {
        outcome = AUDIT_OUTCOMES.UNAVAILABLE;
        reason = reviewResult.error || 'Provider failure';
      }

      const outcomeRecord = { field, outcome, reason };
      validateFieldOutcome(outcomeRecord, AUDIT_OPERATIONS.RECHECK_MISSING);
      fieldOutcomes.push(outcomeRecord);
    }

    return {
      success: reviewResult.status === 'committed',
      status: reviewResult.status,
      targetId,
      missingFields,
      fieldOutcomes,
      reviewResult,
    };
  }

  /**
   * Refreshes dossier for an NPC with exhaustive C12 field accounting (OPERATION_MASKS[REFRESH_DOSSIER]).
   * @param {string} targetId Target NPC ID
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async refreshDossier(targetId, options = {}) {
    if (!targetId || typeof targetId !== 'string') {
      return { success: false, status: 'invalid_target', error: 'Target ID must be a non-empty string.' };
    }

    const loaded = await this.storage.load();
    if (loaded.state?.tombstones?.[targetId]) {
      return { success: false, status: 'target_tombstoned', targetId, error: `Target NPC '${targetId}' is tombstoned.` };
    }
    const npc = loaded.state?.npcs?.[targetId];
    if (!npc) {
      return { success: false, status: 'target_not_found', targetId, error: `Target NPC '${targetId}' not found.` };
    }
    const busy = this._manualBusyResult('refresh_dossier');
    if (busy) return { ...busy, targetId, operation: AUDIT_OPERATIONS.REFRESH_DOSSIER };

    const refreshMask = OPERATION_MASKS[AUDIT_OPERATIONS.REFRESH_DOSSIER];

    const ctx = this.getContext?.();
    const chatId = this.storage.getChatId(ctx);
    if (!chatId || !ctx || !Array.isArray(ctx.chat)) {
      return { success: false, status: 'chat_unavailable', error: 'Active chat is unavailable.' };
    }

    const { sourceScope, exchangeId, metadata } = this._resolveAuditSourceScope(ctx.chat, chatId, targetId, loaded.state);
    if (!sourceScope.length) {
      return { success: false, status: 'source_unavailable', error: 'No usable chat source found for refresh.' };
    }

    const entryId = `refresh_${chatId}_${targetId}_${Date.now()}`;
    const pendingEntry = {
      id: entryId,
      targetId,
      sourceScope,
      exchangeId,
      reason: 'refresh_dossier',
      fieldSubset: [...refreshMask],
      createdAt: nowIso(),
      metadata: {
        operation: AUDIT_OPERATIONS.REFRESH_DOSSIER,
        ...metadata,
      },
    };

    const enqueueResult = await this.coordinator.commit({
      writer: WRITERS.RUNTIME,
      pendingReviewEntries: [pendingEntry],
    });
    if (!enqueueResult.success) {
      return { success: false, status: 'enqueue_failed', error: enqueueResult.error };
    }

    const reviewResult = await this.trigger('refresh_dossier', { manual: true, ...options });

    const afterLoad = await this.storage.load();
    const updatedNpc = afterLoad.state?.npcs?.[targetId] || {};
    const fieldOutcomes = [];

    for (const field of refreshMask) {
      let outcome = AUDIT_OUTCOMES.UNCHANGED;
      let reason = 'Unchanged';

      if (npc.locks?.[field] === true) {
        outcome = AUDIT_OUTCOMES.UNCHANGED;
        reason = 'Field is locked';
      } else if (reviewResult.status === 'provider_failed' || reviewResult.status === 'scheduler_error') {
        outcome = AUDIT_OUTCOMES.UNAVAILABLE;
        reason = reviewResult.error || 'Provider failure';
      } else if (reviewResult.status === 'committed') {
        const prevRev = npc.fieldRevisions?.[field] || 0;
        const nextRev = updatedNpc.fieldRevisions?.[field] || 0;
        if (nextRev > prevRev) {
          outcome = AUDIT_OUTCOMES.APPLIED;
          reason = 'Updated in dossier refresh';
        } else {
          const previousValue = npc[field];
          const stillBlank = previousValue === undefined || previousValue === null || previousValue === '' || (Array.isArray(previousValue) && previousValue.length === 0);
          outcome = stillBlank ? AUDIT_OUTCOMES.INSUFFICIENT : AUDIT_OUTCOMES.UNCHANGED;
          reason = stillBlank ? 'No sufficient evidence found for this dossier field' : 'Retained accepted value';
        }
      }

      const outcomeRecord = { field, outcome, reason };
      validateFieldOutcome(outcomeRecord, AUDIT_OPERATIONS.REFRESH_DOSSIER);
      fieldOutcomes.push(outcomeRecord);
    }

    return {
      success: reviewResult.status === 'committed',
      status: reviewResult.status,
      operation: AUDIT_OPERATIONS.REFRESH_DOSSIER,
      targetId,
      fieldOutcomes,
      reviewResult,
    };
  }

  trigger(reason = 'automatic', options = {}) {
    const chatId = this.storage.getChatId();
    if (!chatId) return Promise.resolve({ status: 'no_chat' });
    const manual = options.manual === true;
    const existing = this.inFlightByChat.get(chatId);
    if (existing) {
      this._requestFollowup(chatId, reason, manual);
      this._record(DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_COALESCED, { chatId, reason });
      return existing.promise;
    }

    const job = {
      chatId,
      reason,
      manual,
      controller: new AbortController(),
      yieldedForForeground: false,
      promise: null,
    };
    job.promise = this._runJob(job)
      .then((result) => {
        this.lastResultByChat.set(chatId, result);
        return result;
      })
      .catch((error) => {
        const result = { status: 'scheduler_error', error: error?.message || String(error) };
        this.lastResultByChat.set(chatId, result);
        this._record(DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_FAILED, { chatId, error: result.error });
        return result;
      })
      .finally(() => {
        if (this.inFlightByChat.get(chatId) === job) this.inFlightByChat.delete(chatId);
        this._notifyStatus({ chatId, phase: 'settled', result: this.lastResultByChat.get(chatId) || null });
        const coalesced = this.coalescedByChat.get(chatId);
        this.coalescedByChat.delete(chatId);
        if (coalesced && this.storage.getChatId() === chatId && !job.yieldedForForeground) {
          // Return the follow-up promise so callers/waitForIdle observe the full
          // bounded drain chain rather than a detached microtask race.
          return this.trigger('coalesced', { manual: coalesced.manual }).catch(() => {});
        }
        return undefined;
      });
    this.inFlightByChat.set(chatId, job);
    this._notifyStatus({ chatId, phase: 'started', reason, manual });
    return job.promise;
  }

  async _markPending(entries, status, details = {}) {
    if (!entries?.length) return { success: true };
    const at = nowIso();
    const timestampKey = status === 'unavailable' ? 'lastUnavailableAt' : 'lastFailureAt';
    const pendingReviewUpdates = entries.map((entry) => ({
      id: entry.id,
      metadataPatch: {
        lastReviewStatus: status,
        [timestampKey]: at,
        reviewAttemptCount: Number(entry.metadata?.reviewAttemptCount || 0) + 1,
        ...details,
      },
    }));
    return this.coordinator.commit({
      writer: WRITERS.RUNTIME,
      pendingReviewUpdates,
    });
  }

  async _runJob(job) {
    const localStartedAt = monotonicNowMs();
    const settings = this.getSettings();
    if (!settings.enabled || !settings.developmentEnabled) return { status: 'disabled' };
    if (this.storage.getChatId() !== job.chatId) return { status: 'chat_changed_before_dispatch' };

    const loaded = await this.storage.load();
    const batch = selectDevelopmentBatch(loaded.state, settings, { manual: job.manual });
    if (batch.length === 0) return { status: 'idle', pending: loaded.state.pendingReview.entries.length };

    if (this.provider.requiresConfiguredProfile !== false && !settings.developmentConnectionProfile) {
      this._record(DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_PAUSED, { chatId: job.chatId, reason: 'development_profile_required' });
      return { status: 'paused', reason: 'development_profile_required', pending: batch.length };
    }

    const ctx = this.getContext?.();
    if (!ctx || this.storage.getChatId(ctx) !== job.chatId || !Array.isArray(ctx.chat)) {
      return { status: 'chat_unavailable' };
    }

    let dispatch = buildDevelopmentDispatch({
      state: loaded.state,
      chat: ctx.chat,
      chatId: job.chatId,
      entries: batch,
      settings,
    });
    if (!dispatch.valid) {
      await this._markPending(batch, 'unavailable', { lastFailureCode: dispatch.errorCode || 'dispatch_context_invalid' }).catch(() => {});
      return { status: 'source_unavailable', error: dispatch.error };
    }

    const unavailable = dispatch.unavailableEntries.map((item) => item.entry);
    if (unavailable.length > 0) {
      await this._markPending(unavailable, 'unavailable', { lastFailureCode: 'owned_source_unavailable_or_changed' }).catch(() => {});
    }
    if (dispatch.entries.length === 0) {
      return { status: 'source_unavailable', unavailable: unavailable.length };
    }

    this._record(DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_DISPATCHED, {
      chatId: job.chatId,
      targets: dispatch.targetIds.length,
      pendingEntries: dispatch.entries.length,
      distinctExchanges: unique(dispatch.entries.map((entry) => entry.exchangeId || entry.id)).length,
      sourceCount: dispatch.exchangeContext?.sources?.size || 0,
      promptChars: dispatch.prompt.length,
      localBeforeProviderMs: elapsedMs(localStartedAt),
      manual: job.manual,
    });

    let providerResult;
    const providerStartedAt = monotonicNowMs();
    let providerDurationMs = null;
    try {
      providerResult = await this.provider.sendReview({
        profileId: settings.developmentConnectionProfile,
        prompt: dispatch.prompt,
        maxTokens: settings.developmentResponseLimit,
        signal: job.controller.signal,
      });
      providerDurationMs = elapsedMs(providerStartedAt);
    } catch (error) {
      providerDurationMs = elapsedMs(providerStartedAt);
      if (job.controller.signal.aborted || error?.code === 'development_aborted' || error?.name === 'AbortError') {
        return { status: 'aborted', reason: job.yieldedForForeground ? 'foreground_priority' : 'cancelled' };
      }
      await this._markPending(dispatch.entries, 'failed', { lastFailureCode: error?.code || 'development_provider_failed' }).catch(() => {});
      this._record(DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_FAILED, {
        chatId: job.chatId,
        reason: error?.code || 'development_provider_failed',
        providerDurationMs,
        localBeforeProviderMs: Math.round((providerStartedAt - localStartedAt) * 1000) / 1000,
      });
      return { status: 'provider_failed', error: error?.message || String(error) };
    }

    const providerCompletedAt = monotonicNowMs();
    if (providerResult?.usage) this.lastProviderUsageByChat.set(job.chatId, structuredClone(providerResult.usage));
    if (job.controller.signal.aborted) return { status: 'aborted', reason: 'cancelled_after_provider' };

    const parsed = parseDevelopmentResponse(providerResult?.text);
    if (!parsed.success) {
      await this._markPending(dispatch.entries, 'failed', { lastFailureCode: parsed.errorCode || 'development_parse_failed' }).catch(() => {});
      this._record(DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_FAILED, { chatId: job.chatId, reason: parsed.errorCode || 'development_parse_failed' });
      return { status: 'malformed_response', errorCode: parsed.errorCode };
    }
    const validated = validateDevelopmentEnvelope(parsed.payload);
    if (!validated.valid) {
      await this._markPending(dispatch.entries, 'failed', { lastFailureCode: 'development_schema_invalid' }).catch(() => {});
      return { status: 'invalid_response', errors: validated.errors };
    }
    const scoped = validateDevelopmentResponseScope(parsed.payload, dispatch);
    if (!scoped.valid) {
      await this._markPending(dispatch.entries, 'failed', { lastFailureCode: 'development_scope_invalid' }).catch(() => {});
      return { status: 'invalid_response_scope', errors: scoped.errors };
    }

    // Provider wait is over. Reacquire current host evidence only now and let the
    // shared coordinator compare it to pre-dispatch captured dependencies.
    const lateCtx = this.getContext?.();
    if (!lateCtx || this.storage.getChatId(lateCtx) !== job.chatId || !Array.isArray(lateCtx.chat)) {
      return { status: 'chat_changed_after_provider' };
    }
    const lateSourceContext = buildDevelopmentExchangeContext({
      chat: lateCtx.chat,
      chatId: job.chatId,
      entries: dispatch.entries,
      verifyPendingMetadata: false,
    });
    const changedSourceRefs = new Set();
    if (lateSourceContext.valid) {
      for (const captured of dispatch.capturedDependencies) {
        const revalidated = revalidateSourceDependency(captured, lateSourceContext.exchangeContext);
        if (!revalidated.valid && captured?.sourceRef) changedSourceRefs.add(captured.sourceRef);
      }
    }
    const lateUnavailableMap = new Map();
    if (lateSourceContext.valid) {
      for (const item of lateSourceContext.unavailableEntries) lateUnavailableMap.set(item.entry.id, item.entry);
      for (const entry of dispatch.entries) {
        if ((entry.sourceScope || []).some((sourceRef) => changedSourceRefs.has(sourceRef))) {
          lateUnavailableMap.set(entry.id, entry);
        }
      }
    }
    if (!lateSourceContext.valid || lateUnavailableMap.size > 0 || lateSourceContext.usableEntries.length !== dispatch.entries.length) {
      const lateUnavailable = [...lateUnavailableMap.values()];
      if (lateUnavailable.length > 0) {
        await this._markPending(lateUnavailable, 'unavailable', { lastFailureCode: 'late_source_unavailable' }).catch(() => {});
      }
      const unaffectedPending = dispatch.entries.length - lateUnavailable.length;
      if (unaffectedPending > 0) {
        // Do not reuse a response produced from a now-tainted mixed batch. Queue a
        // fresh request for unaffected work instead.
        this._requestFollowup(job.chatId, 'partial_target_retry', job.manual);
      }
      return {
        status: 'late_source_unavailable',
        unavailable: lateUnavailable.map((entry) => entry.id),
        unaffectedPending,
      };
    }

    const dependencyMaps = deriveDevelopmentReadDependencies(dispatch.revisionSnapshot, parsed.payload);
    const pendingReviewResolutions = dispatch.entries.map((entry) => ({
      id: entry.id,
      targetId: entry.targetId,
      sourceScope: [...entry.sourceScope],
    }));

    const commitStartedAt = monotonicNowMs();
    const commitResult = await this.coordinator.commitValidatedEnvelope({
      writer: WRITERS.DEVELOPMENT,
      envelope: parsed.payload,
      exchangeContext: lateSourceContext.exchangeContext,
      capturedDependencies: dispatch.capturedDependencies,
      readFieldRevisions: dependencyMaps.readFieldRevisions,
      readFieldDependencies: dependencyMaps.readFieldDependencies,
      pendingReviewResolutions,
      historyBoundary: captureStoryHistoryBoundary(lateCtx.chat, job.chatId, null, {
        buildPrecedingLineage,
        getMessageSwipeId,
      }),
    });

    if (!commitResult.success) {
      await this._markPending(dispatch.entries, 'failed', { lastFailureCode: commitResult.errorCode || 'development_commit_failed' }).catch(() => {});
      this._record(DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_FAILED, { chatId: job.chatId, reason: commitResult.errorCode || 'development_commit_failed' });
      return { status: 'commit_failed', commitResult };
    }

    this._record(DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_COMMITTED, {
      chatId: job.chatId,
      commitRevision: commitResult.commitRevision,
      resolvedPending: commitResult.resolvedPendingReviewIds?.length || 0,
      deferredPending: commitResult.deferredPendingReviewIds?.length || 0,
      providerDurationMs,
      localBeforeProviderMs: Math.round((providerStartedAt - localStartedAt) * 1000) / 1000,
      localAfterProviderMs: Math.round((monotonicNowMs() - providerCompletedAt) * 1000) / 1000,
      commitMs: elapsedMs(commitStartedAt),
      promptChars: dispatch.prompt.length,
      sourceCount: dispatch.exchangeContext?.sources?.size || 0,
    });

    // A successful batch may leave an eligible backlog because C09 caps each
    // provider request at six exchanges. Detect more eligible work from the
    // latest durable state and coalesce one bounded follow-up. Failed/deferred
    // work remains blocked by selectDevelopmentBatch and cannot tight-loop.
    if ((commitResult.resolvedPendingReviewIds?.length || 0) > 0 && this.storage.getChatId() === job.chatId && !job.controller.signal.aborted) {
      try {
        const latest = await this.storage.load();
        const nextBatch = selectDevelopmentBatch(latest.state, settings, { manual: job.manual });
        if (nextBatch.length > 0) this._requestFollowup(job.chatId, 'eligible_backlog', job.manual);
      } catch {
        // Persistence is already committed. A later host/immediate/manual trigger
        // can resume backlog if this non-authoritative follow-up check fails.
      }
    }
    return {
      status: 'committed',
      commitResult,
      providerUsage: providerResult?.usage || null,
      reviewedTargets: dispatch.targetIds,
    };
  }

  destroy() {
    for (const job of this.inFlightByChat.values()) {
      if (!job.controller.signal.aborted) job.controller.abort('destroy');
    }
    this.inFlightByChat.clear();
    this.coalescedByChat.clear();
    this.statusListeners.clear();
  }
}
