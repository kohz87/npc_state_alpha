/**
 * NPC State Alpha — Storage Abstraction & Deterministic In-Memory Adapter
 *
 * Implements CAS (Compare-And-Swap) revision-safe persistence,
 * schema/version validation, and failure isolation (C10, C11).
 */

import {
  ALPHA_NAMESPACE,
  ALPHA_SCHEMA_VERSION,
  validateState,
  cloneState,
  createInitialState,
} from './schema.js';

export class StorageConflictError extends Error {
  constructor(message, currentRevision, expectedRevision) {
    super(message);
    this.name = 'StorageConflictError';
    this.currentRevision = currentRevision;
    this.expectedRevision = expectedRevision;
  }
}

export class StoragePersistenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoragePersistenceError';
  }
}

/**
 * Deterministic In-Memory Storage Adapter.
 * Provides transactional CAS save/load without external storage hooks or databases.
 */
export class MemoryStorageAdapter {
  /**
   * @param {object|null} initialState
   * @param {object} options
   */
  constructor(initialState = null, options = {}) {
    if (initialState) {
      const validation = validateState(initialState);
      if (!validation.valid) {
        throw new Error(`Cannot initialize storage with invalid state: ${validation.errors.join('; ')}`);
      }
      this._state = cloneState(initialState);
      this._revision = initialState.revision;
    } else {
      const fresh = createInitialState();
      this._state = fresh;
      this._revision = fresh.revision;
    }

    this._failNextSave = false;
    this._failNextLoad = false;
  }

  /**
   * For testing failure handling: causes next save to fail.
   * @param {boolean} shouldFail
   */
  setFailNextSave(shouldFail = true) {
    this._failNextSave = shouldFail;
  }

  /**
   * For testing failure handling: causes next load to fail.
   * @param {boolean} shouldFail
   */
  setFailNextLoad(shouldFail = true) {
    this._failNextLoad = shouldFail;
  }

  /**
   * Returns the current storage revision.
   * @returns {number}
   */
  getRevision() {
    return this._revision;
  }

  /**
   * Loads the current state from storage.
   * Validates schema and namespace isolation.
   *
   * @returns {Promise<{ state: object, revision: number }>}
   */
  async load() {
    if (this._failNextLoad) {
      this._failNextLoad = false;
      throw new StoragePersistenceError('Simulated storage load failure.');
    }

    if (!this._state) {
      return { state: null, revision: -1 };
    }

    // Incompatible / malformed check
    if (this._state.namespace !== ALPHA_NAMESPACE) {
      throw new Error(`Storage namespace isolation error: expected '${ALPHA_NAMESPACE}', found '${this._state.namespace}'.`);
    }
    if (this._state.schemaVersion !== ALPHA_SCHEMA_VERSION) {
      throw new Error(`Storage schemaVersion mismatch: expected '${ALPHA_SCHEMA_VERSION}', found '${this._state.schemaVersion}'.`);
    }

    const validation = validateState(this._state);
    if (!validation.valid) {
      throw new Error(`Storage state corruption detected: ${validation.errors.join('; ')}`);
    }

    return {
      state: cloneState(this._state),
      revision: this._revision,
    };
  }

  /**
   * Atomically saves a state using CAS (Compare-And-Swap).
   * If expectedRevision is provided and does not match currentRevision,
   * the save fails safely with a conflict and does NOT overwrite state.
   *
   * @param {object} newState
   * @param {number} [expectedRevision]
   * @returns {Promise<{ success: boolean, revision?: number, conflict?: boolean, error?: string }>}
   */
  async save(newState, expectedRevision) {
    if (this._failNextSave) {
      this._failNextSave = false;
      return {
        success: false,
        conflict: false,
        error: 'Simulated storage persistence failure.',
      };
    }

    // CAS Check
    if (expectedRevision !== undefined && expectedRevision !== this._revision) {
      return {
        success: false,
        conflict: true,
        currentRevision: this._revision,
        expectedRevision,
        error: `CAS revision conflict: current revision is ${this._revision}, but caller expected ${expectedRevision}.`,
      };
    }

    // Schema Validation before committing to storage
    const validation = validateState(newState);
    if (!validation.valid) {
      return {
        success: false,
        conflict: false,
        error: `State validation failed: ${validation.errors.join('; ')}`,
      };
    }

    // Atomic update
    const nextRevision = this._revision + 1;
    const cloned = cloneState(newState);
    cloned.revision = nextRevision;

    this._state = cloned;
    this._revision = nextRevision;

    return {
      success: true,
      revision: nextRevision,
    };
  }

  /**
   * Directly sets corrupted state in memory for testing recovery/safety checks.
   * @param {object} rawState
   */
  _corruptStateForTesting(rawState) {
    this._state = rawState;
  }
}
