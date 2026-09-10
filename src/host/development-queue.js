/**
 * NPC State Alpha — S4 asynchronous Development review scheduler
 *
 * One request per active chat, oldest-first batches, foreground priority, and
 * late-result commit through the existing shared CommitCoordinator.
 */

import { WRITERS } from '../contract/registry.js';
import { revalidateSourceDependency } from '../runtime/source-resolver.js';
import { normalizeAlphaSettings } from '../contract/settings.js';
import { parseDevelopmentResponse } from '../contract/parser.js';
import { validateDevelopmentEnvelope } from '../contract/validator.js';
import {
  buildDevelopmentDispatch,
  buildDevelopmentExchangeContext,
  collectDevelopmentResponseFields,
  deriveDevelopmentReadDependencies,
  selectDevelopmentBatch,
} from './development-context.js';
import { SillyTavernDevelopmentProvider } from './development-provider.js';
import { DIAGNOSTIC_EVENT_TYPES } from './diagnostics.js';

function unique(values) {
  return [...new Set(values)];
}

function nowIso() {
  return new Date().toISOString();
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
      manual: job.manual,
    });

    let providerResult;
    try {
      providerResult = await this.provider.sendReview({
        profileId: settings.developmentConnectionProfile,
        prompt: dispatch.prompt,
        maxTokens: settings.developmentResponseLimit,
        signal: job.controller.signal,
      });
    } catch (error) {
      if (job.controller.signal.aborted || error?.code === 'development_aborted' || error?.name === 'AbortError') {
        return { status: 'aborted', reason: job.yieldedForForeground ? 'foreground_priority' : 'cancelled' };
      }
      await this._markPending(dispatch.entries, 'failed', { lastFailureCode: error?.code || 'development_provider_failed' }).catch(() => {});
      this._record(DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_FAILED, { chatId: job.chatId, reason: error?.code || 'development_provider_failed' });
      return { status: 'provider_failed', error: error?.message || String(error) };
    }

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

    const commitResult = await this.coordinator.commitValidatedEnvelope({
      writer: WRITERS.DEVELOPMENT,
      envelope: parsed.payload,
      exchangeContext: lateSourceContext.exchangeContext,
      capturedDependencies: dispatch.capturedDependencies,
      readFieldRevisions: dependencyMaps.readFieldRevisions,
      readFieldDependencies: dependencyMaps.readFieldDependencies,
      pendingReviewResolutions,
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
  }
}
