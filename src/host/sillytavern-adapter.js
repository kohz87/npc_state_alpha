/**
 * NPC State Alpha — SillyTavern 1.18.0 Extension Adapter
 *
 * Implements S3 One-Pass Immediate Continuity end-to-end:
 * - Extension initialization and capability detection
 * - Generation interceptor (generate_interceptor) for request capture & compact continuity injection
 * - Finalized message candidate handling (MESSAGE_RECEIVED)
 * - Strict terminal trailer parsing & schema validation
 * - Deterministic source resolution (current:user, current:assistant)
 * - Atomic commit via CommitCoordinator with writer WRITERS.ONE_PASS
 * - Persistence of runtime pending Development references for accepted NPCs (Requirement 10)
 * - Replay/dedup protection at host boundary and storage layer
 * - Lifecycle handling for chat switches, swipes, and generation stop
 * - Excludes trailers from narrative projection without destructive raw chat mutations
 * - Bounded runtime diagnostics
 */

import {
  WRITERS,
} from '../contract/registry.js';
import {
  extractAndParseOnePassTrailer,
} from '../contract/parser.js';
import {
  validateOnePassEnvelope,
} from '../contract/validator.js';
import {
  stripMachineTrailer,
  captureScopeDependency,
} from '../runtime/source-resolver.js';
import {
  ADMISSION_POLICIES,
} from '../runtime/identity.js';
import {
  CommitCoordinator,
} from '../runtime/commit-coordinator.js';
import {
  computeContentFingerprint,
} from './fingerprint.js';
import {
  DiagnosticsLedger,
  DIAGNOSTIC_EVENT_TYPES,
} from './diagnostics.js';
import {
  SillyTavernStorageAdapter,
} from './storage-adapter.js';
import {
  PromptInjector,
} from './prompt-injector.js';

/**
 * Builds deterministic preceding lineage array from preceding chat messages.
 * Only strips trailers from actual assistant messages if they are strictly valid Alpha trailers.
 * Preserves user messages, system messages, and malformed/duplicate trailers intact.
 *
 * @param {Array<object>} chat
 * @param {number} targetIndex
 * @returns {Array<string>}
 */
export function buildPrecedingLineage(chat, targetIndex) {
  if (!Array.isArray(chat) || targetIndex <= 0) return [];
  const lineage = [];
  for (let i = 0; i < targetIndex; i++) {
    const m = chat[i];
    if (m && typeof m.mes === 'string') {
      // Restrict trailer stripping strictly to actual assistant messages with a valid Alpha trailer
      const clean = (!m.is_user && !m.is_system) ? stripMachineTrailer(m.mes) : m.mes;
      const fp = computeContentFingerprint(clean);
      if (fp) {
        lineage.push(fp);
      }
    }
  }
  return lineage;
}

export function getMessageSwipeId(message) {
  if (!message || typeof message !== 'object') return 0;
  if (message.swipe_id !== undefined && message.swipe_id !== null) return message.swipe_id;
  if (message.swipe_info?.current !== undefined && message.swipe_info.current !== null) {
    return message.swipe_info.current;
  }
  return 0;
}

/**
 * Returns the latest committed assistant provenance at each message position.
 * Later checkpoints supersede earlier checkpoints at the same position (e.g. continuation).
 */
export function getLatestCommittedAssistantSources(state) {
  const byPosition = new Map();
  const checkpoints = state?.history?.checkpoints;
  if (!Array.isArray(checkpoints)) return byPosition;
  for (const checkpoint of checkpoints) {
    for (const dep of checkpoint?.sourceDependencies || []) {
      const provenance = dep?.capturedProvenance;
      if (provenance?.role === 'assistant' && Number.isInteger(provenance.position)) {
        byPosition.set(provenance.position, provenance);
      }
    }
  }
  return byPosition;
}

/**
 * Detects whether the current host chat has diverged from already committed Alpha
 * assistant sources. This is deliberately read-only: S3 never reconstructs history.
 */
export function detectCommittedBranchDivergence(state, chat, { ignorePosition = null } = {}) {
  if (!Array.isArray(chat)) return { reason: 'host_chat_unavailable' };
  const committed = getLatestCommittedAssistantSources(state);
  for (const [position, provenance] of committed.entries()) {
    if (position === ignorePosition) continue;
    const message = chat[position];
    if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') {
      return { reason: 'committed_source_missing_or_wrong_role', position };
    }
    const canonicalNarrative = stripMachineTrailer(message.mes);
    const fingerprint = computeContentFingerprint(canonicalNarrative);
    if (fingerprint !== provenance.contentFingerprint) {
      return { reason: 'committed_source_fingerprint_changed', position };
    }
    if (provenance.swipe !== undefined && provenance.swipe !== null) {
      const swipe = getMessageSwipeId(message);
      if (swipe !== provenance.swipe) {
        return { reason: 'committed_source_swipe_changed', position };
      }
    }
    // Exact preceding lineage check (C03):
    // An earlier user edit can leave assistant text unchanged but invalidate C03 source ownership
    const expectedLineage = Array.isArray(provenance.precedingLineage)
      ? provenance.precedingLineage
      : [];
    const currentLineage = buildPrecedingLineage(chat, position);
    if (
      currentLineage.length !== expectedLineage.length ||
      !expectedLineage.every((fp, idx) => currentLineage[idx] === fp)
    ) {
      return { reason: 'committed_source_preceding_lineage_changed', position };
    }
  }
  return null;
}

export const DEFAULT_INTERCEPTOR_KEY = 'npc_state_alpha_generate_interceptor';

export class SillyTavernAdapter {
  /**
   * @param {object} [options]
   * @param {Function} [options.getContext] SillyTavern getContext provider
   * @param {DiagnosticsLedger} [options.diagnostics] Diagnostics ledger
   * @param {SillyTavernStorageAdapter} [options.storage] Storage adapter
   * @param {CommitCoordinator} [options.coordinator] Commit coordinator
   * @param {string} [options.admissionPolicy] Admission policy ('named_preferred', 'balanced_role_label', 'manual_only')
   * @param {string} [options.interceptorKey] Global function name for generate_interceptor
   */
  constructor(options = {}) {
    this._getContextProvider = options.getContext || (() => globalThis.SillyTavern?.getContext?.());
    this.diagnostics = options.diagnostics || new DiagnosticsLedger();
    this.storage = options.storage || new SillyTavernStorageAdapter({
      getContext: this._getContextProvider,
      fetchImpl: options.fetchImpl,
    });
    this.coordinator =
      options.coordinator ||
      new CommitCoordinator({
        storage: this.storage,
        admissionPolicy: options.admissionPolicy || ADMISSION_POLICIES.NAMED_PREFERRED,
      });

    this.interceptorKey = options.interceptorKey || DEFAULT_INTERCEPTOR_KEY;
    this.developmentReview = options.developmentReview || null;

    // Runtime in-flight state tracking
    this.inFlightRequest = null;
    this.processedDedupKeys = new Set();
    this.initialized = false;
    this._registeredListeners = [];
    this._candidateProcessingQueue = Promise.resolve();
    // Temporary, non-authoritative display overrides staged only after durable commit
    // so SillyTavern's first render cannot paint the transport trailer. Raw `mes`
    // and swipes remain untouched; the temporary override is restored after render.
    this._stagedDisplayOverrides = new WeakMap();
  }

  /**
   * Returns SillyTavern context object if available.
   * @returns {object|null}
   */
  getContext() {
    try {
      return typeof this._getContextProvider === 'function' ? this._getContextProvider() : null;
    } catch {
      return null;
    }
  }

  /** Attach the S4 Development scheduler without creating another state path. */
  setDevelopmentReview(review) {
    this.developmentReview = review || null;
    return this.developmentReview;
  }

  /**
   * Capability detects available SillyTavern 1.18.0 surfaces.
   * Fails closed if required real surfaces or specific event types are missing.
   * No hardcoded fallback event names masquerading as capability (Requirement 5).
   * @returns {object} Capability detection report
   */
  detectCapabilities() {
    const ctx = this.getContext();
    const hasContext = Boolean(ctx && typeof ctx === 'object');
    const hasEventSource = Boolean(ctx?.eventSource && typeof ctx.eventSource.on === 'function');
    const hasEventTypes = Boolean(ctx?.eventTypes && typeof ctx.eventTypes === 'object');

    const et = ctx?.eventTypes;
    const requiredEvents = [
      'MESSAGE_RECEIVED',
      'CHARACTER_MESSAGE_RENDERED',
      'MESSAGE_SWIPED',
      'MESSAGE_EDITED',
      'MESSAGE_DELETED',
      'MESSAGE_UPDATED',
      'MESSAGE_SWIPE_DELETED',
      'GENERATION_STOPPED',
    ];
    const hasChatChangedEvent = Boolean(et && (et.CHAT_CHANGED || et.CHAT_LOADED));
    const hasRequiredEventEntries = Boolean(
      hasEventTypes &&
      requiredEvents.every((e) => typeof et[e] === 'string' && et[e].trim() !== '') &&
      hasChatChangedEvent
    );

    const hasSetExtensionPrompt = typeof ctx?.setExtensionPrompt === 'function';
    const hasUpdateMessageBlock = typeof ctx?.updateMessageBlock === 'function';
    const persistenceCaps = typeof this.storage?.detectPersistenceCapabilities === 'function'
      ? this.storage.detectPersistenceCapabilities()
      : { checkedSave: false, checkedSaveSurface: false };
    const hasCheckedPersistence = persistenceCaps.checkedSave === true;
    const hasCheckedPersistenceSurface = persistenceCaps.checkedSaveSurface === true;
    const hasChat = Array.isArray(ctx?.chat);
    const hasChatId = Boolean(
      (ctx?.chatId !== undefined && ctx?.chatId !== null && String(ctx?.chatId).trim() !== '') ||
      (typeof ctx?.getCurrentChatId === 'function' && Boolean(ctx.getCurrentChatId()))
    );
    const hasGlobalInterceptorRegistration = typeof globalThis !== 'undefined';

    // Extension loading may happen on SillyTavern's welcome screen before a chat
    // target exists. Initialization therefore checks the stable host surfaces here;
    // load/save still require and revalidate an exact current chat target.
    const supported = Boolean(
      hasContext &&
      hasEventSource &&
      hasRequiredEventEntries &&
      hasSetExtensionPrompt &&
      hasUpdateMessageBlock &&
      hasCheckedPersistenceSurface &&
      hasChat &&
      hasGlobalInterceptorRegistration
    );

    return {
      hasContext,
      hasEventSource,
      hasEventTypes,
      hasRequiredEventEntries,
      hasSetExtensionPrompt,
      hasUpdateMessageBlock,
      hasCheckedPersistence,
      hasCheckedPersistenceSurface,
      persistenceCaps,
      hasChat,
      hasChatId,
      hasGlobalInterceptorRegistration,
      supported,
    };
  }

  /**
   * Initializes adapter, capability-detects hooks, and attaches host listeners.
   * Fails closed if capability detection fails.
   * @returns {boolean} Whether initialization succeeded
   */
  initialize() {
    if (this.initialized) return true;
    const caps = this.detectCapabilities();
    const ctx = this.getContext();

    if (!caps.supported) {
      this.diagnostics.record({
        type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
        reason: 'SillyTavern capability check failed: required host surfaces/events missing (fail closed).',
        capabilities: caps,
      });
      return false;
    }

    const eventTypes = ctx.eventTypes;

    const attachListener = (eventKey, handler) => {
      const eventName = eventTypes[eventKey];
      if (!eventName) return;
      try {
        ctx.eventSource.on(eventName, handler);
        this._registeredListeners.push({ eventName, handler });
      } catch (err) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: `Failed to attach listener for '${eventName}': ${err.message}`,
        });
      }
    };

    // MESSAGE_RECEIVED is the state-commit boundary. SillyTavern emits
    // CHARACTER_MESSAGE_RENDERED only after the core renderer has inserted/updated the DOM,
    // so transport concealment is reconciled there as a presentation-only action.
    attachListener('MESSAGE_RECEIVED', (messageId, type) => this.handleMessageReceived(messageId, type));
    attachListener('CHARACTER_MESSAGE_RENDERED', (messageId, type) => this.handleCharacterMessageRendered(messageId, type));
    attachListener('MESSAGE_SWIPED', (messageId) => this.handleBranchInvalidation('MESSAGE_SWIPED', messageId));
    attachListener('MESSAGE_EDITED', (messageId) => this.handleBranchInvalidation('MESSAGE_EDITED', messageId));
    attachListener('MESSAGE_UPDATED', (messageId) => this.handleBranchInvalidation('MESSAGE_UPDATED', messageId));
    attachListener('MESSAGE_DELETED', (messageId) => this.handleBranchInvalidation('MESSAGE_DELETED', messageId));
    attachListener('MESSAGE_SWIPE_DELETED', (payload) => {
      const messageId = payload && typeof payload === 'object' ? payload.messageId : payload;
      return this.handleBranchInvalidation('MESSAGE_SWIPE_DELETED', messageId);
    });
    if (eventTypes.CHAT_CHANGED) {
      attachListener('CHAT_CHANGED', (chatId) => this.handleChatChanged(chatId));
    }
    if (eventTypes.CHAT_LOADED) {
      attachListener('CHAT_LOADED', (chatId) => this.handleChatChanged(chatId));
    }
    attachListener('GENERATION_STOPPED', () => this.handleGenerationStopped());

    // Register generate_interceptor on globalThis (Requirement 5)
    globalThis[this.interceptorKey] = async (chat, contextSize, abort, type) => {
      return this.handleGenerateInterceptor(chat, contextSize, abort, type);
    };

    this.initialized = true;
    const initialChatId = this.storage.getChatId();
    if (initialChatId) {
      this.reconcileCommittedTransportDisplay({ expectedChatId: initialChatId }).catch(() => {});
    }
    return true;
  }

  /**
   * SillyTavern generate_interceptor handler.
   * Called after user message is inserted and coreChat is prepared, before prompt assembly.
   * Non-destructively sanitizes the coreChat snapshot for prompt assembly (Requirement 3).
   * Captures coherent user request, lineage, and injects compact continuity + C04 contract.
   *
   * @param {Array<object>} chat SillyTavern coreChat snapshot array
   * @param {number} [contextSize] Context size token limit
   * @param {AbortSignal|Function} [abort] Abort controller / signal
   * @param {string} [type='normal'] Generation type ('normal', 'swipe', 'continue', etc.)
   */
  async handleGenerateInterceptor(chat, contextSize, abort, type = 'normal') {
    try {
      const chatId = this.storage.getChatId();
      if (!chatId) {
        this.inFlightRequest = null;
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: 'No valid chat ID available during generation interceptor.',
        });
        return;
      }

      // S4 foreground priority: abort/yield only a background Development request
      // for this chat before the roleplay path performs any awaited work.
      this.developmentReview?.onForegroundStart?.(chatId);

      // 1. Sanitize the interceptor-provided coreChat snapshot (Requirement 3, Item 8)
      // Strip only strictly recognized valid Alpha trailers from prior assistant entries
      // before prompt assembly. NEVER destructively mutate raw ctx.chat or objects in ctx.chat.
      // Malformed, truncated, duplicate, or schema-invalid trailers remain untouched.
      if (Array.isArray(chat)) {
        for (let i = 0; i < chat.length; i++) {
          const m = chat[i];
          if (m && !m.is_user && !m.is_system && typeof m.mes === 'string') {
            const clean = stripMachineTrailer(m.mes);
            if (clean !== m.mes) {
              // Replace element in the coreChat array without mutating raw message object
              chat[i] = { ...m, mes: clean };
            }
          }
        }
      }

      // 2. Identify candidate user message from interceptor coreChat snapshot
      let coreUserIndex = -1;
      let coreUserMsg = null;

      if (Array.isArray(chat) && chat.length > 0) {
        for (let i = chat.length - 1; i >= 0; i--) {
          const m = chat[i];
          if (m && m.is_user && !m.is_system) {
            coreUserIndex = i;
            coreUserMsg = m;
            break;
          }
        }
      }

      if (coreUserIndex === -1 || !coreUserMsg) {
        this.inFlightRequest = null;
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: 'No user message found in chat to capture request lineage.',
        });
        return;
      }

      const coreUserText = typeof coreUserMsg.mes === 'string' ? coreUserMsg.mes : '';
      const coreUserSwipe =
        coreUserMsg.swipe_id !== undefined
          ? coreUserMsg.swipe_id
          : coreUserMsg.swipe_info?.current !== undefined
          ? coreUserMsg.swipe_info.current
          : undefined;

      // 3. Map captured current user request back to exact ctx.chat identity (Sol Host-Provenance Rule)
      // In real ST 1.18.0, generate_interceptor receives a derived/coreChat array (e.g. truncated/windowed),
      // not necessarily the authoritative raw ctx.chat array or identical positions.
      // Do not assign owned source position solely from interceptor-array index.
      // Map back to exact ctx.chat record using content/role/swipe/revision/lineage, and fail closed if ambiguous.
      const ctx = this.getContext();
      const rawChat = Array.isArray(ctx?.chat) ? ctx.chat : [];

      if (rawChat.length === 0) {
        this.inFlightRequest = null;
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: 'Failed to map coreChat user message to authoritative ctx.chat position: raw ctx.chat is empty.',
        });
        return;
      }

      const candidates = [];
      for (let i = 0; i < rawChat.length; i++) {
        const rm = rawChat[i];
        if (!rm || !rm.is_user || rm.is_system) continue;

        const rmText = typeof rm.mes === 'string' ? rm.mes : '';
        if (rmText !== coreUserText) continue;

        const rmSwipe =
          rm.swipe_id !== undefined
            ? rm.swipe_id
            : rm.swipe_info?.current !== undefined
            ? rm.swipe_info.current
            : undefined;
        if (coreUserSwipe !== undefined && rmSwipe !== undefined && coreUserSwipe !== rmSwipe) {
          continue;
        }

        // Check preceding lineage correspondence if coreChat has preceding messages
        let lineageMatch = true;
        if (coreUserIndex > 0) {
          for (let offset = 1; offset <= coreUserIndex; offset++) {
            const cIdx = coreUserIndex - offset;
            const rIdx = i - offset;
            if (rIdx < 0) {
              lineageMatch = false;
              break;
            }
            const cMsg = chat[cIdx];
            const rMsg = rawChat[rIdx];
            if (!cMsg || !rMsg) {
              lineageMatch = false;
              break;
            }
            if (Boolean(cMsg.is_user) !== Boolean(rMsg.is_user) || Boolean(cMsg.is_system) !== Boolean(rMsg.is_system)) {
              lineageMatch = false;
              break;
            }
            const cClean = (!cMsg.is_user && !cMsg.is_system && typeof cMsg.mes === 'string') ? stripMachineTrailer(cMsg.mes) : (cMsg.mes || '');
            const rClean = (!rMsg.is_user && !rMsg.is_system && typeof rMsg.mes === 'string') ? stripMachineTrailer(rMsg.mes) : (rMsg.mes || '');
            if (computeContentFingerprint(cClean) !== computeContentFingerprint(rClean)) {
              lineageMatch = false;
              break;
            }
          }
        }

        if (!lineageMatch) continue;

        candidates.push({
          index: i,
          msg: rm,
          isExactRef: rm === coreUserMsg,
        });
      }

      if (candidates.length === 0) {
        this.inFlightRequest = null;
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: 'Failed to map coreChat user message to authoritative ctx.chat position: no matching message record found.',
        });
        return;
      }

      let resolvedCandidate = null;
      if (candidates.length === 1) {
        resolvedCandidate = candidates[0];
      } else {
        // Disambiguate if exactly one has exact object reference identity
        const refMatches = candidates.filter((c) => c.isExactRef);
        if (refMatches.length === 1) {
          resolvedCandidate = refMatches[0];
        } else {
          this.inFlightRequest = null;
          this.diagnostics.record({
            type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
            reason: 'Ambiguous mapping: multiple candidate messages in ctx.chat match coreChat user message.',
          });
          return;
        }
      }

      const userPos = resolvedCandidate.index;
      const userMsg = resolvedCandidate.msg;
      const userText = typeof userMsg.mes === 'string' ? userMsg.mes : '';
      const userFingerprint = computeContentFingerprint(userText);
      const userSwipe =
        userMsg.swipe_id !== undefined
          ? userMsg.swipe_id
          : userMsg.swipe_info?.current !== undefined
          ? userMsg.swipe_info.current
          : undefined;

      // 4. Exact C03 lineage grounded in authoritative rawChat:
      // current:user precedingLineage fingerprints the owned narrative sequence BEFORE the user message in rawChat
      const userPrecedingLineage = buildPrecedingLineage(rawChat, userPos);

      // current:assistant precedingLineage represents the exact owned prefix through current:user
      const asstPrecedingLineage = [...userPrecedingLineage];
      if (userFingerprint) {
        asstPrecedingLineage.push(userFingerprint);
      }

      // 5. Store in-flight generation request
      this.inFlightRequest = {
        chatId,
        userSource: {
          position: userPos,
          role: 'user',
          contentFingerprint: userFingerprint,
          chatId,
          text: userText,
          precedingLineage: userPrecedingLineage,
          swipe: userSwipe,
        },
        precedingLineage: asstPrecedingLineage,
        generationType: type,
        timestamp: Date.now(),
      };

      this.diagnostics.record({
        type: DIAGNOSTIC_EVENT_TYPES.GENERATION_INTERCEPTED,
        chatId,
        userMsgIndex: userPos,
        coreUserIndex,
        generationType: type,
      });

      // 6. Load latest committed Alpha continuity for this chat. Branch replacement
      // events never mutate history here; S3 detects them and fails closed instead of
      // implementing S6 rollback/reconstruction through a second state path.
      let state = null;
      try {
        const loadRes = await this.storage.load();
        state = loadRes.state;
      } catch (err) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.COMMIT_FAILURE,
          error: `Failed to load continuity state during interceptor: ${err.message}`,
        });
      }

      const isSwipeOrRegen = type === 'swipe' || type === 'regenerate';
      const targetPos = isSwipeOrRegen
        ? (rawChat[userPos + 1] && !rawChat[userPos + 1].is_user ? userPos + 1 : (rawChat.length - 1 > userPos ? rawChat.length - 1 : null))
        : null;
      const branchDivergence = state ? detectCommittedBranchDivergence(state, rawChat, { ignorePosition: targetPos }) : null;
      if (branchDivergence) {
        this.inFlightRequest.branchUnsafe = branchDivergence;
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: `Committed Alpha history diverged from host chat at position ${branchDivergence.position ?? 'unknown'} (${branchDivergence.reason}); fast mutation is blocked until explicit history recovery.`,
        });
      }

      // SillyTavern continuation appends to the existing final assistant message. If
      // that message still contains an older Alpha trailer, remove it from the live
      // continuation base only when the exact prior trailer is valid AND its dedup key
      // is already durable. Uncommitted/malformed transport is never destroyed.
      if (type === 'continue' && state && !this.inFlightRequest.branchUnsafe) {
        const continuationPosition = rawChat.length - 1;
        const baseMessage = rawChat[continuationPosition];
        if (!baseMessage || baseMessage.is_user || baseMessage.is_system || typeof baseMessage.mes !== 'string') {
          this.inFlightRequest.branchUnsafe = { reason: 'continuation_base_missing', position: continuationPosition };
        } else {
          this.inFlightRequest.continuationPosition = continuationPosition;
          const priorParse = extractAndParseOnePassTrailer(baseMessage.mes);
          if (priorParse.success && validateOnePassEnvelope(priorParse.payload).valid) {
            const priorFingerprint = computeContentFingerprint(priorParse.narrative);
            const priorSwipe = getMessageSwipeId(baseMessage);
            const priorDedupKey = `${chatId}:${continuationPosition}:${priorSwipe}:${priorFingerprint}`;
            const priorCommitted = state.dedup?.processedSourceKeys?.includes(priorDedupKey) === true;
            if (!priorCommitted) {
              this.inFlightRequest.branchUnsafe = {
                reason: 'continuation_prior_transport_not_committed',
                position: continuationPosition,
              };
            } else {
              baseMessage.mes = priorParse.narrative;
              if (Array.isArray(baseMessage.swipes) && Number.isInteger(priorSwipe) && baseMessage.swipes[priorSwipe] !== undefined) {
                baseMessage.swipes[priorSwipe] = priorParse.narrative;
              }
              // Alpha never persists ownership metadata for extra.display_text, so do not
              // delete or overwrite it here. Another extension (for example translation)
              // may own that presentation override. The raw Alpha trailer itself is safe
              // to remove because this exact prior revision is already durably committed.
              this.inFlightRequest.priorContinuationDedupKey = priorDedupKey;
            }
          }
        }
      }

      // If branch ownership is unsafe, do not inject stale Alpha continuity. The roleplay
      // generation may still proceed and the immediate contract remains available, but
      // its result will be rejected from Alpha mutation until recovery.
      const promptText = PromptInjector.buildExtensionPrompt(
        this.inFlightRequest.branchUnsafe ? null : state,
        { admissionPolicy: this.coordinator.admissionPolicy }
      );

      // 7. Inject via setExtensionPrompt if available
      if (ctx && typeof ctx.setExtensionPrompt === 'function') {
        try {
          ctx.setExtensionPrompt('npc_state_alpha', promptText, 1, 0, false);
        } catch (err) {
          this.diagnostics.record({
            type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
            reason: `Failed setExtensionPrompt: ${err.message}`,
          });
        }
      }
    } catch (err) {
      this.inFlightRequest = null;
      this.diagnostics.record({
        type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
        reason: `Unexpected error in handleGenerateInterceptor: ${err.message}`,
      });
    }
  }

  /**
   * Finalized message candidate handler on host MESSAGE_RECEIVED event.
   * Serializes candidate processing so only one logical transaction runs at a time.
   * Keeps chat/branch invalidations responsive.
   *
   * @param {number|string} messageId Message position index in chat array
   * @param {string} [eventType] Message event type
   */
  async handleMessageReceived(messageId, eventType) {
    const run = () => this._processMessageReceived(messageId, eventType);
    const queued = this._candidateProcessingQueue.then(run, run);
    this._candidateProcessingQueue = queued.catch(() => {});
    return queued;
  }

  async _processMessageReceived(messageId, eventType) {
    try {
      const chatId = this.storage.getChatId();

      this.diagnostics.record({
        type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_CANDIDATE,
        messageId,
        eventType,
        chatId,
      });

      // Requirement 1 & Verified Host Fact: Fresh chat first-message path emits
      // MESSAGE_RECEIVED(chat_id, 'first_message'). This is not a generation result and must be rejected.
      if (eventType === 'first_message') {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: "Rejected 'first_message' event type (not a generation result).",
          messageId,
          eventType,
        });
        return;
      }

      const ctx = this.getContext();
      const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];

      // Finding 1: Finalized-only streaming guard.
      // SillyTavern 1.18.0 getContext exposes streamingProcessor.
      // Successful streaming sets streamingProcessor.isFinished=true before onFinishStreaming()->finalizeIntermediaryMessage()->MESSAGE_RECEIVED.
      // Error path onErrorStreaming sets isStopped=true, aborts its controller, then emits MESSAGE_RECEIVED for ordinary generation.
      // In finalized candidate handling, BEFORE the first await/durable dedup path, if ctx.streamingProcessor corresponds to the candidate message,
      // reject if isStopped===true, abortController.signal.aborted===true, or isFinished!==true. Non-streaming with no processor remains allowed.
      const streamingProcessor = ctx?.streamingProcessor;
      // Bind streaming state only when the processor identifies this exact message.
      // A missing processor messageId is not authority to classify an unrelated
      // non-streaming candidate as stopped/incomplete.
      const processorMatchesMessage = Boolean(
        streamingProcessor &&
        streamingProcessor.messageId !== undefined &&
        streamingProcessor.messageId !== null &&
        String(streamingProcessor.messageId) === String(messageId)
      );

      if (processorMatchesMessage) {
        const isStopped = streamingProcessor.isStopped === true;
        const isAborted = streamingProcessor.abortController?.signal?.aborted === true;
        const isFinished = streamingProcessor.isFinished === true;

        if (isStopped || isAborted || !isFinished) {
          this.diagnostics.record({
            type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
            reason: 'Streaming candidate rejected: processor was stopped, aborted, or not finished.',
            messageId,
            eventType,
            streaming: {
              isStopped,
              isAborted,
              isFinished,
            },
          });
          this.inFlightRequest = null;
          return;
        }
      }

      // Early Dedup Guard: If host re-emits MESSAGE_RECEIVED for an already-finalized message,
      // cleanly suppress duplicate replay without requiring an active in-flight request.
      if (typeof messageId === 'number' && chat[messageId] && typeof chat[messageId].mes === 'string') {
        const candidateMsg = chat[messageId];
        const cleanNarrative = stripMachineTrailer(candidateMsg.mes);
        const assistantFingerprint = computeContentFingerprint(cleanNarrative);
        const swipeId =
          candidateMsg.swipe_id !== undefined
            ? candidateMsg.swipe_id
            : candidateMsg.swipe_info?.current !== undefined
            ? candidateMsg.swipe_info.current
            : 0;
        const dedupKey = `${chatId}:${messageId}:${swipeId}:${assistantFingerprint}`;
        if (this.processedDedupKeys.has(dedupKey)) {
          this.diagnostics.record({
            type: DIAGNOSTIC_EVENT_TYPES.REPLAY_SUPPRESSED,
            dedupKey,
            reason: 'memory_set_replay',
          });
          return;
        }

        // Durable replay check across NEW adapter/reload (Item 4)
        try {
          const stored = await this.storage.load();
          if (stored?.state?.dedup?.processedSourceKeys?.includes(dedupKey)) {
            this.processedDedupKeys.add(dedupKey);
            this.diagnostics.record({
              type: DIAGNOSTIC_EVENT_TYPES.REPLAY_SUPPRESSED,
              dedupKey,
              reason: 'durable_dedup_exact_replay',
            });
            return;
          }
        } catch {}
      }

      // Requirement 1: Require a captured matching generation request before ANY fast commit.
      // No synthetic current:user from position-1. Old/replayed/foreign MESSAGE_RECEIVED must never become a fresh extraction.
      if (!this.inFlightRequest) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: 'No in-flight generation request captured. Unsolicited MESSAGE_RECEIVED rejected.',
          messageId,
        });
        return;
      }

      // Requirement 1: Chat Identity Guard: must match captured request's chat ID
      if (this.inFlightRequest.chatId !== chatId) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: `Chat ID mismatch: in-flight request '${this.inFlightRequest.chatId}' vs active '${chatId}'.`,
          messageId,
        });
        this.inFlightRequest = null;
        return;
      }

      // Finding 5: Snapshot accepted in-flight request object locally for candidate processing
      const capturedRequest = {
        ...this.inFlightRequest,
        userSource: { ...this.inFlightRequest.userSource },
        precedingLineage: [...this.inFlightRequest.precedingLineage],
      };

      // Requirement 1: No fallback to last message when messageId is invalid!
      if (typeof messageId !== 'number' || !chat[messageId]) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: `Invalid messageId '${messageId}': message record not found in chat array.`,
          messageId,
        });
        return;
      }

      const candidateMsg = chat[messageId];
      const numericPosition = messageId;

      if (capturedRequest.branchUnsafe) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: `Fast mutation blocked by previously detected branch divergence (${capturedRequest.branchUnsafe.reason}).`,
          messageId: numericPosition,
        });
        this.inFlightRequest = null;
        return;
      }

      if (!candidateMsg || typeof candidateMsg.mes !== 'string') {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: 'Message record missing or has non-string text payload.',
          messageId: numericPosition,
        });
        return;
      }

      // Role Guard: must be assistant message (never user or system)
      if (candidateMsg.is_user || candidateMsg.is_system) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: 'Candidate message is user or system message, not assistant.',
          messageId: numericPosition,
        });
        return;
      }

      // Lineage Guard: candidate's actual preceding lineage must match in-flight expected assistant lineage
      const actualPrecedingLineage = buildPrecedingLineage(chat, numericPosition);
      const expectedLineage = capturedRequest.precedingLineage;
      const lineageMatches =
        actualPrecedingLineage.length === expectedLineage.length &&
        expectedLineage.every((fp, idx) => actualPrecedingLineage[idx] === fp);

      if (!lineageMatches) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: 'Preceding lineage mismatch: chat history changed between generation start and completion.',
          messageId: numericPosition,
        });
        this.inFlightRequest = null;
        return;
      }

      this.diagnostics.record({
        type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_ACCEPTED,
        messageId: numericPosition,
        chatId,
      });

      // Strict Trailer Parsing (C03, C04)
      const rawText = candidateMsg.mes;
      const parseResult = extractAndParseOnePassTrailer(rawText);

      if (!parseResult.success) {
        // Extraction failure: narrative remains narrative, zero extra provider calls
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.TRAILER_PARSE_FAILURE,
          errorCode: parseResult.errorCode,
          errorMessage: parseResult.errorMessage,
          messageId: numericPosition,
        });
        this.inFlightRequest = null;
        return;
      }

      // Schema Validation (S1 Validator)
      const valResult = validateOnePassEnvelope(parseResult.payload);
      if (!valResult.valid) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.TRAILER_PARSE_FAILURE,
          errorCode: 'schema_validation_failed',
          errors: valResult.errors,
          messageId: numericPosition,
        });
        this.inFlightRequest = null;
        return;
      }

      this.diagnostics.record({
        type: DIAGNOSTIC_EVENT_TYPES.TRAILER_PARSE_SUCCESS,
        proposalCount: parseResult.payload.proposals?.length || 0,
        messageId: numericPosition,
      });

      // The strict parser owns canonical transport exclusion for this finalized output.
      const cleanNarrative = parseResult.narrative;
      const assistantFingerprint = computeContentFingerprint(cleanNarrative);
      const swipeId = getMessageSwipeId(candidateMsg);

      // Deduplication Key (chatId : position : swipeId : contentFingerprint)
      const dedupKey = `${chatId}:${numericPosition}:${swipeId}:${assistantFingerprint}`;
      if (this.processedDedupKeys.has(dedupKey)) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.REPLAY_SUPPRESSED,
          dedupKey,
          reason: 'memory_set_replay',
        });
        this.inFlightRequest = null;
        return;
      }

      // Build exchangeContext with exact captured source provenance
      const userSource = capturedRequest.userSource;

      const exchangeContext = {
        chatId,
        currentUserMessage: {
          position: userSource.position,
          role: 'user',
          contentFingerprint: userSource.contentFingerprint,
          chatId,
          text: userSource.text,
          precedingLineage: userSource.precedingLineage,
          swipe: userSource.swipe,
        },
        currentAssistantMessage: {
          position: numericPosition,
          role: 'assistant',
          contentFingerprint: assistantFingerprint,
          chatId,
          text: rawText, // raw narrative (stripMachineTrailer handles excerpt matching)
          precedingLineage: expectedLineage,
          swipe: swipeId,
        },
        requestLineage: expectedLineage,
      };

      // S3 branch safety is read-only. Any already committed source that no longer
      // matches the live chat blocks fast mutation; rollback/reconstruction belongs to S6.
      let storedStateObj = null;
      try {
        const loadRes = await this.storage.load();
        storedStateObj = loadRes.state;
      } catch (err) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.COMMIT_FAILURE,
          error: `Failed to load continuity state before commit: ${err.message}`,
        });
        return;
      }

      if (capturedRequest.branchUnsafe) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: `Fast mutation blocked by previously detected branch divergence (${capturedRequest.branchUnsafe.reason}).`,
          messageId: numericPosition,
        });
        return;
      }

      const isContinuation = eventType === 'continue' || capturedRequest.generationType === 'continue';
      if (isContinuation && capturedRequest.continuationPosition !== numericPosition) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: 'Continuation finalized at a different message position than the captured continuation base.',
          messageId: numericPosition,
        });
        return;
      }

      const isSwipeOrRegenerate =
        eventType === 'swipe' ||
        eventType === 'regenerate' ||
        capturedRequest.generationType === 'swipe' ||
        capturedRequest.generationType === 'regenerate';

      const divergence = detectCommittedBranchDivergence(storedStateObj, chat, {
        ignorePosition: (isContinuation || isSwipeOrRegenerate) ? numericPosition : null,
      });
      if (divergence) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: `Fast mutation blocked: committed source at position ${divergence.position ?? 'unknown'} diverged (${divergence.reason}); S6 recovery is required.`,
          messageId: numericPosition,
        });
        return;
      }

      const priorAtPosition = getLatestCommittedAssistantSources(storedStateObj).get(numericPosition);
      if (priorAtPosition && !isContinuation) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: `Replacement/regeneration at already committed position ${numericPosition} requires history recovery; S3 will not layer alternate state on the abandoned branch.`,
          messageId: numericPosition,
        });
        return;
      }

      // Capture the owned exchange scope through the shared S2 source resolver even
      // when the model proposes no fields. This gives every successful fast commit an
      // exact user+assistant history boundary for replay/branch validation.
      const capturedDependencies = [];
      for (const sourceRef of ['current:user', 'current:assistant']) {
        const captured = captureScopeDependency(sourceRef, exchangeContext, { writer: WRITERS.ONE_PASS });
        if (!captured.valid) {
          this.diagnostics.record({
            type: DIAGNOSTIC_EVENT_TYPES.COMMIT_FAILURE,
            error: `Failed to capture ${sourceRef} ownership: ${captured.error}`,
            errorCode: captured.errorCode,
          });
          return;
        }
        capturedDependencies.push(captured.capturedDependency);
      }

      // Requirement 9 / C09 / Item 6: Enqueue pending Development references with immutable owned exchange scope
      // sufficient for future S4 to reacquire exact user+assistant evidence.
      const pendingReviewEntries = [];
      const seenPendingTargets = new Set();
      if (Array.isArray(parseResult.payload.proposals)) {
        for (const p of parseResult.payload.proposals) {
          const targetKey = p.localRef || p.id || p.targetId;
          if (targetKey && !seenPendingTargets.has(targetKey)) {
            seenPendingTargets.add(targetKey);
            const continuationSuffix = isContinuation ? `:cont:${assistantFingerprint}` : '';
            pendingReviewEntries.push({
              id: `pending_${chatId}_${numericPosition}_${targetKey}${continuationSuffix}`,
              targetId: targetKey,
              sourceScope: [
                `chat:${chatId}:${userSource.position}`,
                `chat:${chatId}:${numericPosition}`,
              ],
              exchangeId: `${chatId}:${numericPosition}${continuationSuffix}`,
              reason: p.localRef ? 'new_admission' : 'fast_proposal',
              createdAt: new Date().toISOString(),
              metadata: {
                userPosition: userSource.position,
                userSwipe: userSource.swipe,
                assistantPosition: numericPosition,
                assistantSwipe: swipeId,
                userFingerprint: userSource.contentFingerprint,
                assistantFingerprint,
              },
            });
          }
        }
      }

      // Finding 5: Post-await chat safety check. Recheck active chat still matches
      // captured chat immediately before entering CommitCoordinator to prevent cross-chat mutation.
      const postLoadChatId = this.storage.getChatId();
      if (postLoadChatId !== capturedRequest.chatId) {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
          reason: `Post-await chat switch detected: active chat changed from '${capturedRequest.chatId}' to '${postLoadChatId}' before commit (fail closed).`,
          messageId: numericPosition,
        });
        return;
      }

      // Commit through CommitCoordinator with writer one_pass
      const commitResult = await this.coordinator.commitValidatedEnvelope({
        writer: WRITERS.ONE_PASS,
        envelope: parseResult.payload,
        exchangeContext,
        capturedDependencies,
        dedupKeys: [dedupKey],
        pendingReviewEntries,
      });

      if (commitResult.success) {
        this.processedDedupKeys.add(dedupKey);

        // MESSAGE_RECEIVED is awaited by ST before addOneMessage(). After durable
        // commit, arm a temporary display override so the first browser render never
        // paints the machine trailer. Raw `mes`/swipes remain unchanged.
        const preRenderCtx = this.getContext();
        if (
          this.storage.getChatId(preRenderCtx) === capturedRequest.chatId &&
          Array.isArray(preRenderCtx?.chat) &&
          preRenderCtx.chat[numericPosition] === candidateMsg
        ) {
          this.stageCommittedTransportDisplay(candidateMsg, cleanNarrative);
        }

        // State mutation is complete here, but display concealment is deliberately
        // deferred to CHARACTER_MESSAGE_RENDERED. In non-streaming SillyTavern 1.18.0,
        // MESSAGE_RECEIVED is emitted before addOneMessage(), so rerendering here can
        // race the host's own first render and briefly expose the raw trailer.

        // Requirement 7: Handle actual CommitCoordinator replay result shape correctly
        if (commitResult.replay || commitResult.noop) {
          this.diagnostics.record({
            type: DIAGNOSTIC_EVENT_TYPES.REPLAY_SUPPRESSED,
            dedupKey,
            reason: commitResult.reason || 'durable_dedup_exact_replay',
          });
        } else {
          this.diagnostics.record({
            type: DIAGNOSTIC_EVENT_TYPES.COMMIT_SUCCESS,
            commitRevision: commitResult.commitRevision,
            assignedNpcs: commitResult.assignedNpcs,
          });
        }
        // Never await background Development work on the foreground roleplay path.
        this.developmentReview?.onImmediateCommit?.({ chatId, commitResult });
      } else {
        this.diagnostics.record({
          type: DIAGNOSTIC_EVENT_TYPES.COMMIT_FAILURE,
          error: commitResult.error,
          conflict: commitResult.conflict,
          errorCode: commitResult.errorCode,
        });
      }
    } catch (err) {
      // Requirement 10: Catch/bound all exceptions into diagnostics so host listeners do not crash
      this.diagnostics.record({
        type: DIAGNOSTIC_EVENT_TYPES.COMMIT_FAILURE,
        error: `Unexpected error during handleMessageReceived: ${err.message}`,
      });
    } finally {
      this.inFlightRequest = null;
    }
  }

  /**
   * Presentation-only handler for SillyTavern's CHARACTER_MESSAGE_RENDERED event.
   * The preceding MESSAGE_RECEIVED handler owns state mutation; this event only
   * reconciles a durably committed Alpha trailer after the host DOM exists.
   *
   * @param {number|string} messageId
   * @param {string} [eventType]
   */
  async handleCharacterMessageRendered(messageId, eventType) {
    if (!Number.isInteger(messageId) || eventType === 'first_message') return;
    const ctx = this.getContext();
    const expectedChatId = this.storage.getChatId(ctx);
    if (!expectedChatId) return;
    const renderedMessage = Array.isArray(ctx?.chat) ? ctx.chat[messageId] : null;
    try {
      await this.reconcileCommittedTransportDisplay({ messageId, expectedChatId });
    } finally {
      // The first render has completed. Remove only Alpha's temporary pre-render
      // override so raw host metadata remains unchanged for later extensions/saves.
      this.restoreStagedTransportDisplay(renderedMessage);
    }
  }

  /**
   * Generic host branch invalidation handler (Requirement 6).
   * Clears in-flight request tied to an invalidated branch and records bounded diagnostics.
   * Never mutates, saves, or restores Alpha state (no second state mutation path; history reconstruction belongs to S6).
   *
   * @param {string} eventName
   * @param {number|string} [messageId]
   */
  handleBranchInvalidation(eventName, messageId) {
    this.inFlightRequest = null;
    this.diagnostics.record({
      type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
      reason: `Branch invalidation: event '${eventName}' cleared in-flight request.`,
      messageId,
      eventName,
    });
  }

  /**
   * Host MESSAGE_SWIPED event handler. Delegates to handleBranchInvalidation.
   * @param {number|string} [messageId]
   */
  handleMessageSwiped(messageId) {
    return this.handleBranchInvalidation('MESSAGE_SWIPED', messageId);
  }

  /**
   * Host CHAT_CHANGED / CHAT_LOADED event handler.
   * Resets in-flight generation and switches storage context.
   * @param {string} [chatId]
   */
  handleChatChanged(chatId) {
    const previousChatId = this.inFlightRequest?.chatId || null;
    this.inFlightRequest = null;
    const newChatId = this.storage.getChatId();

    this.diagnostics.record({
      type: DIAGNOSTIC_EVENT_TYPES.CHAT_SWITCHED,
      previousChatId,
      newChatId,
    });
    if (newChatId) {
      this.reconcileCommittedTransportDisplay({ expectedChatId: newChatId }).catch(() => {});
    }
    this.developmentReview?.onChatChanged?.(newChatId);
  }

  /**
   * Host GENERATION_STOPPED event handler.
   * Aborts/clears in-flight generation request safely.
   */
  handleGenerationStopped() {
    this.inFlightRequest = null;
    this.diagnostics.record({
      type: DIAGNOSTIC_EVENT_TYPES.GENERATION_STOPPED,
    });
  }

  /**
   * Stages a display-only override after durable commit and before SillyTavern's
   * first render. This never changes raw `mes` or swipe text. If another extension
   * already owns display_text, Alpha leaves that override alone unless it itself
   * ends in a structurally recognized Alpha trailer.
   *
   * @param {object} message
   * @param {string} canonicalNarrative
   */
  stageCommittedTransportDisplay(message, canonicalNarrative) {
    if (!message || typeof message !== 'object' || typeof canonicalNarrative !== 'string') return;
    if (!message.extra || typeof message.extra !== 'object' || Array.isArray(message.extra)) {
      message.extra = {};
    }
    if (this._stagedDisplayOverrides.has(message)) return;

    const hadDisplayText = Object.prototype.hasOwnProperty.call(message.extra, 'display_text');
    const previousDisplayText = message.extra.display_text;
    if (typeof previousDisplayText === 'string') {
      const stripped = stripMachineTrailer(previousDisplayText);
      // A foreign display override that contains no Alpha transport already prevents
      // the raw trailer from rendering, so do not replace or claim ownership of it.
      if (stripped === previousDisplayText) return;
      this._stagedDisplayOverrides.set(message, { hadDisplayText, previousDisplayText });
      message.extra.display_text = stripped;
      return;
    }

    this._stagedDisplayOverrides.set(message, { hadDisplayText, previousDisplayText });
    message.extra.display_text = canonicalNarrative;
  }

  /**
   * Restores any temporary pre-render override after the host has completed its
   * CHARACTER_MESSAGE_RENDERED boundary.
   *
   * @param {object} message
   */
  restoreStagedTransportDisplay(message) {
    if (!message || typeof message !== 'object') return;
    const previous = this._stagedDisplayOverrides.get(message);
    if (!previous) return;
    if (!message.extra || typeof message.extra !== 'object' || Array.isArray(message.extra)) {
      message.extra = {};
    }
    if (previous.hadDisplayText) {
      message.extra.display_text = previous.previousDisplayText;
    } else {
      delete message.extra.display_text;
    }
    this._stagedDisplayOverrides.delete(message);
  }

  /**
   * Render-only transport hiding for an already-validated, already-committed
   * Alpha transport trailer. Does NOT mutate raw message.mes or message.swipes.
   * Passes a cloned message with clone.extra.display_text = canonicalNarrative
   * to ctx.updateMessageBlock (exact ST updateMessageBlock renders extra.display_text ?? message.mes).
   *
   * @param {number|string} messageId
   * @param {object} message
   * @param {string} canonicalNarrative
   */
  hideCommittedTransport(messageId, message, canonicalNarrative, expectedChatId = null) {
    if (!Number.isInteger(messageId) || !message || typeof canonicalNarrative !== 'string') return false;
    const ctx = this.getContext();
    const liveChatId = this.storage.getChatId(ctx);
    if (expectedChatId && liveChatId !== expectedChatId) return false;
    if (!Array.isArray(ctx?.chat) || ctx.chat[messageId] !== message) return false;
    if (typeof ctx?.updateMessageBlock !== 'function') return false;

    try {
      const extra = { ...(message.extra || {}) };
      if (typeof extra.display_text === 'string') {
        // Respect a foreign presentation override. If that override itself contains a
        // strictly valid Alpha trailer, strip only that recognized transport; otherwise
        // leave the foreign display text untouched.
        extra.display_text = stripMachineTrailer(extra.display_text);
      } else {
        extra.display_text = canonicalNarrative;
      }

      const clone = {
        ...message,
        extra,
      };
      ctx.updateMessageBlock(messageId, clone, { rerenderMessage: true });
      return true;
    } catch (err) {
      this.diagnostics.record({
        type: DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED,
        reason: `Committed transport could not be rerendered: ${err.message}`,
        messageId,
      });
      return false;
    }
  }

  /**
   * Idempotent transport display reconciliation.
   * Loads committed Alpha state, scans assistant messages with STRICTLY valid Alpha trailers,
   * computes exact dedup key chatId:position:swipe:fingerprint(parseResult.narrative),
   * and rerenders only if key is durably present in state.dedup.processedSourceKeys.
   * Never hides malformed or uncommitted trailers.
   */
  async reconcileCommittedTransportDisplay({ messageId = null, expectedChatId = null } = {}) {
    try {
      const initialCtx = this.getContext();
      const chat = Array.isArray(initialCtx?.chat) ? initialCtx.chat : [];
      const chatId = this.storage.getChatId(initialCtx);
      if (!chatId || (expectedChatId && chatId !== expectedChatId) || chat.length === 0) return;

      let state = null;
      try {
        const loadRes = await this.storage.load();
        state = loadRes?.state;
      } catch {
        return;
      }
      if (!state) return;

      // A storage load is asynchronous. Reacquire the host context before touching UI
      // so a chat switch cannot rerender an old-chat position inside the newly active chat.
      const postLoadCtx = this.getContext();
      const postLoadChatId = this.storage.getChatId(postLoadCtx);
      if (postLoadChatId !== chatId || postLoadCtx?.chat !== chat) return;

      const processedKeys = new Set(state.dedup?.processedSourceKeys || []);
      if (processedKeys.size === 0) return;

      const positions = Number.isInteger(messageId)
        ? [messageId]
        : Array.from({ length: chat.length }, (_, index) => index);

      for (const pos of positions) {
        const message = chat[pos];
        if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') {
          continue;
        }

        const parseResult = extractAndParseOnePassTrailer(message.mes);
        if (!parseResult.success) continue;

        const valResult = validateOnePassEnvelope(parseResult.payload);
        if (!valResult.valid) continue;

        const canonicalNarrative = parseResult.narrative;
        const fingerprint = computeContentFingerprint(canonicalNarrative);
        const swipe = getMessageSwipeId(message);
        const dedupKey = `${chatId}:${pos}:${swipe}:${fingerprint}`;

        if (processedKeys.has(dedupKey)) {
          this.hideCommittedTransport(pos, message, canonicalNarrative, chatId);
        }
      }
    } catch {
      // Best-effort invocation: do not throw into host lifecycle
    }
  }

  /**
   * Cleans up registered event listeners and global hooks.
   */
  destroy() {
    const ctx = this.getContext();
    if (ctx && ctx.eventSource && typeof ctx.eventSource.off === 'function') {
      for (const { eventName, handler } of this._registeredListeners) {
        try {
          ctx.eventSource.off(eventName, handler);
        } catch {}
      }
    }
    this._registeredListeners = [];

    if (typeof globalThis !== 'undefined' && globalThis[this.interceptorKey]) {
      delete globalThis[this.interceptorKey];
    }
    this.inFlightRequest = null;
    this.developmentReview?.destroy?.();
    this.initialized = false;
  }
}
