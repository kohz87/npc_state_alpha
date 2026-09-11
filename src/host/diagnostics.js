/**
 * NPC State Alpha — Host Diagnostics Ledger
 *
 * Implements C16 and S3 bounded diagnostics.
 * Records host event candidate/accept/reject, trailer parse results,
 * source/commit results, replay suppression, and chat identity changes.
 *
 * Strict bounds:
 * - Fixed ring-buffer capacity (default 100 entries).
 * - Never logs full prompts, raw story transcripts, or credentials.
 * - String fields are defensively bounded.
 */

export const DIAGNOSTIC_EVENT_TYPES = Object.freeze({
  HOST_EVENT_CANDIDATE: 'host_event_candidate',
  HOST_EVENT_ACCEPTED: 'host_event_accepted',
  HOST_EVENT_REJECTED: 'host_event_rejected',
  TRAILER_PARSE_SUCCESS: 'trailer_parse_success',
  TRAILER_PARSE_FAILURE: 'trailer_parse_failure',
  COMMIT_SUCCESS: 'commit_success',
  COMMIT_FAILURE: 'commit_failure',
  REPLAY_SUPPRESSED: 'replay_suppressed',
  CHAT_SWITCHED: 'chat_switched',
  GENERATION_INTERCEPTED: 'generation_intercepted',
  GENERATION_STOPPED: 'generation_stopped',
  DEVELOPMENT_DISPATCHED: 'development_dispatched',
  DEVELOPMENT_COMMITTED: 'development_committed',
  DEVELOPMENT_FAILED: 'development_failed',
  DEVELOPMENT_PAUSED: 'development_paused',
  DEVELOPMENT_COALESCED: 'development_coalesced',
  DEVELOPMENT_YIELDED: 'development_yielded',
  HISTORY_RECOVERY_COMMITTED: 'history_recovery_committed',
  HISTORY_RECOVERY_FAILED: 'history_recovery_failed',
});

const DEFAULT_CAPACITY = 100;
const MAX_FIELD_STRING_LENGTH = 200;

function sanitizeField(val) {
  if (typeof val === 'string') {
    if (val.length > MAX_FIELD_STRING_LENGTH) {
      return val.slice(0, MAX_FIELD_STRING_LENGTH) + '... [truncated]';
    }
    return val;
  }
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    const clean = {};
    for (const [k, v] of Object.entries(val)) {
      if (k === 'prompt' || k === 'rawText' || k === 'rawTranscript' || k === 'fullChat') {
        continue; // Never log full prompts or raw chats
      }
      clean[k] = sanitizeField(v);
    }
    return clean;
  }
  return val;
}

export class DiagnosticsLedger {
  /**
   * @param {object} [options]
   * @param {number} [options.capacity=100] Maximum entries in ring buffer
   */
  constructor(options = {}) {
    this.capacity = options.capacity || DEFAULT_CAPACITY;
    this.entries = [];
    this.counts = {
      candidatesReceived: 0,
      candidatesAccepted: 0,
      candidatesRejected: 0,
      trailersParsedSuccess: 0,
      trailersParsedFailed: 0,
      commitsSuccess: 0,
      commitsFailed: 0,
      replaysSuppressed: 0,
      chatSwitches: 0,
      generationsIntercepted: 0,
      developmentDispatched: 0,
      developmentCommitted: 0,
      developmentFailed: 0,
      developmentPaused: 0,
      developmentCoalesced: 0,
      developmentYielded: 0,
      historyRecoveryCommitted: 0,
      historyRecoveryFailed: 0,
    };
  }

  /**
   * Records a bounded diagnostic entry.
   * @param {object} eventData
   * @param {string} eventData.type Event type from DIAGNOSTIC_EVENT_TYPES
   */
  record(eventData) {
    if (!eventData || typeof eventData !== 'object') return;

    const entry = {
      timestamp: new Date().toISOString(),
      type: eventData.type || 'unknown',
    };

    // Copy sanitized details
    for (const [k, v] of Object.entries(eventData)) {
      if (k !== 'timestamp') {
        entry[k] = sanitizeField(v);
      }
    }

    // Update aggregate counters
    switch (entry.type) {
      case DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_CANDIDATE:
        this.counts.candidatesReceived++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_ACCEPTED:
        this.counts.candidatesAccepted++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED:
        this.counts.candidatesRejected++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.TRAILER_PARSE_SUCCESS:
        this.counts.trailersParsedSuccess++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.TRAILER_PARSE_FAILURE:
        this.counts.trailersParsedFailed++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.COMMIT_SUCCESS:
        this.counts.commitsSuccess++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.COMMIT_FAILURE:
        this.counts.commitsFailed++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.REPLAY_SUPPRESSED:
        this.counts.replaysSuppressed++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.CHAT_SWITCHED:
        this.counts.chatSwitches++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.GENERATION_INTERCEPTED:
        this.counts.generationsIntercepted++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_DISPATCHED:
        this.counts.developmentDispatched++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_COMMITTED:
        this.counts.developmentCommitted++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_FAILED:
        this.counts.developmentFailed++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_PAUSED:
        this.counts.developmentPaused++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_COALESCED:
        this.counts.developmentCoalesced++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.DEVELOPMENT_YIELDED:
        this.counts.developmentYielded++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.HISTORY_RECOVERY_COMMITTED:
        this.counts.historyRecoveryCommitted++;
        break;
      case DIAGNOSTIC_EVENT_TYPES.HISTORY_RECOVERY_FAILED:
        this.counts.historyRecoveryFailed++;
        break;
    }

    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.shift(); // Evict oldest
    }
  }

  /**
   * Returns copy of all current bounded diagnostic entries.
   * @returns {Array<object>}
   */
  getEntries() {
    return [...this.entries];
  }

  /**
   * Returns current summary counts.
   * @returns {object}
   */
  getSummary() {
    return { ...this.counts, totalRecorded: this.entries.length };
  }

  /**
   * Resets ledger entries and counters.
   */
  clear() {
    this.entries = [];
    for (const k of Object.keys(this.counts)) {
      this.counts[k] = 0;
    }
  }
}
