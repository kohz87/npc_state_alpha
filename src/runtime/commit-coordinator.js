/**
 * NPC State Alpha — Shared Commit Coordinator
 *
 * Exactly one shared commit boundary for already parsed/validated operations (C02, C04, C08, C10).
 *
 * Enforces:
 * - Two-phase validation against latest durable state
 * - Capture and check of read-field/domain dependencies
 * - Field-scoped application preserving unrelated newer live changes
 * - Recheck of target existence, tombstones, locks, lifecycle, and source lineage
 * - Runtime assignment of persistent observation IDs (resolving local observation refs)
 * - Atomic persistence via CAS (no false success receipt or checkpoint on save failure)
 * - No provider calls or provider waits under lock
 */

import {
  WRITERS,
  CANONICAL_FIELDS,
  isDurableDossierField,
  validateWriterAuthority,
} from '../contract/registry.js';
import {
  validatePersistedObservationRecord,
  validatePersistedAcceptedSupportRecord,
} from '../contract/wire-schemas.js';
import {
  validateOnePassEnvelope,
  validateDevelopmentEnvelope,
  validateSegmentFieldPermission,
} from '../contract/validator.js';
import {
  createDefaultNpcRecord,
  cloneState,
} from '../state/schema.js';
import {
  createCheckpoint,
} from '../state/checkpoints.js';
import {
  resolveIdentityBatch,
  ADMISSION_POLICIES,
} from './identity.js';
import {
  applyNpcProposals,
} from './field-applier.js';
import {
  resolveSourceReference,
  captureSourceDependency,
  captureScopeDependency,
  revalidateSourceDependency,
  validateCapturedSourceDependency,
} from './source-resolver.js';

let observationIdCounter = 0;

/**
 * Generates a runtime-assigned persistent observation ID.
 * @returns {string}
 */
export function generateObservationId() {
  observationIdCounter++;
  return `obs_${Date.now()}_${observationIdCounter}`;
}

/**
 * Resets observation ID counter for testing.
 */
export function resetObservationIdCounterForTesting() {
  observationIdCounter = 0;
}

function hasAcceptedFieldValue(npc, fieldName) {
  const value = npc?.[fieldName];
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * Centralized extractor that extracts all concrete S1 SourceReference objects
 * from an already validated envelope with their target canonical field (Task 3).
 *
 * Traverses:
 * - envelope.source
 * - envelope.proposals[*].source
 * - envelope.proposals[*].evidence
 * - envelope.proposals[*].presenceSource
 * - envelope.proposals[*].lifecycle.source
 * - envelope.proposals[*].relationshipEvaluation.source
 * - envelope.proposals[*].relationshipEvaluation.axisSupport[*].source
 * - container sources: relationshipDynamic.source, canonicalAppearance.source,
 *   behavioralProfile.source, personality.source, speech.source, mannerisms.source,
 *   appearanceForms.source, importantMemories.source, nonPlayerRelationships.source, facts.source
 * - durable fact wrapper sources: role/species/background/actualAge/apparentAge/birthday (.source)
 * - collection item sources: appearanceForms.forms/items[*].source,
 *   importantMemories.memories/items[*].source, nonPlayerRelationships.relationships/items[*].source,
 *   mannerisms.mannerisms/items[*].source
 * - envelope.observations[*].source
 *
 * Deterministically deduplicates identical dependencies.
 *
 * @param {object} envelope
 * @returns {Array<{ ref: object, targetField: string|null }>}
 */
export function extractConcreteSourceReferences(envelope) {
  if (!envelope || typeof envelope !== 'object') return [];

  const rawRefs = [];

  function isConcreteSourceRef(obj) {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      !Array.isArray(obj) &&
      typeof obj.sourceRef === 'string' &&
      typeof obj.excerpt === 'string' &&
      obj.sourceRef.trim() !== '' &&
      obj.excerpt.trim() !== ''
    );
  }

  // 1. Envelope-level source
  if (isConcreteSourceRef(envelope.source)) {
    rawRefs.push({ ref: envelope.source, targetField: null });
  }

  // 2. Observations
  if (Array.isArray(envelope.observations)) {
    for (const obs of envelope.observations) {
      if (obs && isConcreteSourceRef(obs.source)) {
        rawRefs.push({ ref: obs.source, targetField: obs.field || null });
      }
    }
  }

  // 3. Proposals
  if (Array.isArray(envelope.proposals)) {
    for (const p of envelope.proposals) {
      if (!p || typeof p !== 'object') continue;

      if (isConcreteSourceRef(p.source)) {
        rawRefs.push({ ref: p.source, targetField: null });
      }
      if (isConcreteSourceRef(p.evidence)) {
        rawRefs.push({ ref: p.evidence, targetField: 'id' });
      }
      if (isConcreteSourceRef(p.presenceSource)) {
        rawRefs.push({ ref: p.presenceSource, targetField: 'present' });
      }
      if (p.lifecycle && isConcreteSourceRef(p.lifecycle.source)) {
        rawRefs.push({ ref: p.lifecycle.source, targetField: 'lifeState' });
      }
      if (p.relationshipEvaluation) {
        if (isConcreteSourceRef(p.relationshipEvaluation.source)) {
          rawRefs.push({ ref: p.relationshipEvaluation.source, targetField: 'relationshipEvaluation' });
        }
        if (p.relationshipEvaluation.axisSupport && typeof p.relationshipEvaluation.axisSupport === 'object') {
          for (const axSup of Object.values(p.relationshipEvaluation.axisSupport)) {
            if (isConcreteSourceRef(axSup?.source)) {
              rawRefs.push({ ref: axSup.source, targetField: 'relationshipEvaluation' });
            }
          }
        }
      }

      // Check all other proposal fields
      const skipKeys = ['id', 'targetId', 'localRef', 'source', 'evidence', 'presenceSource', 'lifecycle', 'relationshipEvaluation'];
      for (const [key, val] of Object.entries(p)) {
        if (skipKeys.includes(key)) continue;

        if (isConcreteSourceRef(val)) {
          rawRefs.push({ ref: val, targetField: key });
          continue;
        }

        if (!val || typeof val !== 'object') continue;

        // Container-level source
        if (isConcreteSourceRef(val.source)) {
          rawRefs.push({ ref: val.source, targetField: key });
        }

        // Collection items or sub-arrays
        const subLists = [
          val.forms,
          val.memories,
          val.relationships,
          val.mannerisms,
          val.items,
          val.value,
        ];

        for (const subList of subLists) {
          if (Array.isArray(subList)) {
            for (const item of subList) {
              if (item && typeof item === 'object') {
                if (isConcreteSourceRef(item.source)) {
                  rawRefs.push({ ref: item.source, targetField: key });
                } else if (isConcreteSourceRef(item)) {
                  rawRefs.push({ ref: item, targetField: key });
                }
              }
            }
          }
        }

        // Individual durable fact wrappers or nested objects
        for (const [subKey, subVal] of Object.entries(val)) {
          if (['forms', 'memories', 'relationships', 'mannerisms', 'items', 'source', 'operation', 'value', 'traits'].includes(subKey)) {
            continue;
          }
          if (subVal && typeof subVal === 'object') {
            if (isConcreteSourceRef(subVal.source)) {
              rawRefs.push({ ref: subVal.source, targetField: subKey });
            } else if (isConcreteSourceRef(subVal)) {
              rawRefs.push({ ref: subVal, targetField: subKey });
            }
          }
        }
      }
    }
  }

  // Deterministic deduplication
  const deduped = [];
  const seen = new Set();
  for (const item of rawRefs) {
    const sig = `${item.ref.sourceRef}|${item.ref.excerpt}|${item.ref.segmentKind || ''}|${item.targetField || ''}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      deduped.push(item);
    }
  }

  return deduped;
}

export class CommitCoordinator {
  /**
   * @param {object} options
   * @param {import('../state/storage.js').MemoryStorageAdapter} options.storage
   * @param {string} [options.admissionPolicy='named_preferred']
   */
  constructor({ storage, admissionPolicy = ADMISSION_POLICIES.NAMED_PREFERRED }) {
    if (!storage) {
      throw new Error('CommitCoordinator requires a storage adapter.');
    }
    this.storage = storage;
    this.admissionPolicy = admissionPolicy;
  }

  /**
   * Internal / already-normalized low-level commit boundary (C02, C04, C08, C10).
   * Note: Model/envelope callers must use the public bridge commitValidatedEnvelope()
   * to guarantee runtime provenance ownership. Low-level commit() is used for internal
   * runtime bookkeeping, testing, or already-verified normalized transactions.
   *
   * @param {object} params
   * @param {string} params.writer Writer authority ('one_pass', 'development', 'user', 'runtime')
   * @param {number} [params.expectedRevision] Expected storage revision for CAS concurrency safety
   * @param {object} [params.readFieldRevisions] Map of { [targetId]: { [field]: revisionNumber } } captured at dispatch
   * @param {object} [params.readFieldDependencies] Cross-field dependency map { [targetId]: { [proposedField]: { [dependencyField]: revisionNumber } } }
   * @param {Array<object>} [params.identityProposals] Identity proposals (for NEW admissions or existing targets)
   * @param {object} [params.fieldProposals] Map of { [targetRefOrId]: { [fieldName]: value } }
   * @param {Array<object>} [params.observations] Proposed C08 observations
   * @param {Array<object>} [params.supportProposals] Proposed C08 support proposals (Development wire format)
   * @param {Array<object>} [params.acceptedSupport] Raw C08 accepted-support links (strictly WRITERS.RUNTIME only)
   * @param {Array<object>} [params.reviewReceipts] Runtime-owned review receipts
   * @param {Array<string|object>} [params.sourceDependencies] Source references or captured dependency descriptors
   * @param {Array<string>} [params.dedupKeys] Logical deduplication keys
   * @param {Array<object>} [params.pendingReviewEntries] Runtime pending review entries
   * @param {Array<object>} [params.pendingReviewResolutions] Exact pending entries to clear after a matching non-deferred receipt
   * @param {Array<object>} [params.pendingReviewUpdates] Runtime-only metadata patches for pending entries
   * @param {object} [params.exchangeContext] Live exchange context for revalidation
   * @param {string} [params.operationMode] 'one_pass' | 'development' | 'manual'
   * @returns {Promise<object>} Commit outcome receipt
   */
  async commit({
    writer,
    expectedRevision,
    readFieldRevisions,
    readFieldDependencies,
    identityProposals = [],
    fieldProposals = {},
    observations = [],
    supportProposals = [],
    acceptedSupport = [],
    reviewReceipts = [],
    sourceDependencies = [],
    dedupKeys = [],
    pendingReviewEntries = [],
    pendingReviewResolutions = [],
    pendingReviewUpdates = [],
    exchangeContext,
    operationMode = 'commit',
  }) {
    if (!writer) {
      return { success: false, error: "CommitCoordinator requires declared 'writer' authority." };
    }

    const knownWriters = new Set(Object.values(WRITERS));
    if (!knownWriters.has(writer)) {
      return {
        success: false,
        error: `Unsupported writer '${writer}' at CommitCoordinator boundary.`,
        errorCode: 'invalid_writer',
      };
    }

    if (!fieldProposals || typeof fieldProposals !== 'object' || Array.isArray(fieldProposals)) {
      return {
        success: false,
        error: "CommitCoordinator 'fieldProposals' must be an object map.",
        errorCode: 'invalid_field_proposals',
      };
    }

    const reservedDirectFieldProposals = new Set([
      'observations',
      'acceptedSupport',
      'reviewReceipts',
      'development',
    ]);

    // C02 authority is validated before any read-dependency filtering. A stale
    // proposal cannot evade wrong-writer rejection by being deferred first.
    for (const [targetKey, fields] of Object.entries(fieldProposals)) {
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        return {
          success: false,
          error: `Field proposals for target '${targetKey}' must be an object map.`,
          errorCode: 'invalid_field_proposals',
        };
      }
      for (const fieldName of Object.keys(fields)) {
        if (reservedDirectFieldProposals.has(fieldName)) {
          return {
            success: false,
            error: `Direct field proposal for '${fieldName}' is forbidden; use dedicated runtime bookkeeping.`,
            errorCode: 'bookkeeping_field_reserved',
          };
        }
        const auth = validateWriterAuthority(fieldName, writer);
        if (!auth.valid) {
          return {
            success: false,
            error: auth.error,
            errorCode: 'wrong_writer',
          };
        }
      }
    }

    // Read dependency keys are canonical field names, and revision tokens must
    // be valid positive integers. Unknown fields fail closed rather than being
    // treated as synthetic missing dependencies.
    if (readFieldRevisions !== undefined) {
      if (!readFieldRevisions || typeof readFieldRevisions !== 'object' || Array.isArray(readFieldRevisions)) {
        return {
          success: false,
          error: "CommitCoordinator 'readFieldRevisions' must be an object map when supplied.",
          errorCode: 'invalid_read_field_revision',
        };
      }
      for (const [targetKey, fieldRevisions] of Object.entries(readFieldRevisions)) {
        if (!fieldRevisions || typeof fieldRevisions !== 'object' || Array.isArray(fieldRevisions)) {
          return {
            success: false,
            error: `Read field revisions for target '${targetKey}' must be an object map.`,
            errorCode: 'invalid_read_field_revision',
          };
        }
        for (const [fieldName, revision] of Object.entries(fieldRevisions)) {
          if (!CANONICAL_FIELDS[fieldName]) {
            return {
              success: false,
              error: `Read dependency field '${fieldName}' is not a canonical C02 field.`,
              errorCode: 'invalid_read_field_revision',
            };
          }
          if (typeof revision !== 'number' || !Number.isInteger(revision) || revision <= 0) {
            return {
              success: false,
              error: `Read dependency revision for '${targetKey}.${fieldName}' must be a positive integer.`,
              errorCode: 'invalid_read_field_revision',
            };
          }
        }
      }
    }

    if (readFieldDependencies !== undefined) {
      if (!readFieldDependencies || typeof readFieldDependencies !== 'object' || Array.isArray(readFieldDependencies)) {
        return {
          success: false,
          error: "CommitCoordinator 'readFieldDependencies' must be an object map when supplied.",
          errorCode: 'invalid_read_field_dependency',
        };
      }
      for (const [targetKey, proposedFields] of Object.entries(readFieldDependencies)) {
        if (!proposedFields || typeof proposedFields !== 'object' || Array.isArray(proposedFields)) {
          return { success: false, error: `Read field dependencies for target '${targetKey}' must be an object map.`, errorCode: 'invalid_read_field_dependency' };
        }
        for (const [proposedField, dependencies] of Object.entries(proposedFields)) {
          if (!CANONICAL_FIELDS[proposedField] || !dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
            return { success: false, error: `Invalid cross-field dependency declaration for '${targetKey}.${proposedField}'.`, errorCode: 'invalid_read_field_dependency' };
          }
          for (const [dependencyField, revision] of Object.entries(dependencies)) {
            if (!CANONICAL_FIELDS[dependencyField] || !Number.isInteger(revision) || revision <= 0) {
              return { success: false, error: `Invalid cross-field dependency revision for '${targetKey}.${proposedField}' -> '${dependencyField}'.`, errorCode: 'invalid_read_field_dependency' };
            }
          }
        }
      }
    }

    // Automatic candidate admission is One-Pass-owned. Development may review
    // only already accepted stable identities at this low-level boundary.
    if (writer === WRITERS.DEVELOPMENT && Array.isArray(identityProposals)) {
      const newIdentity = identityProposals.find(
        (proposal) => proposal && typeof proposal === 'object' && Boolean(proposal.localRef)
      );
      if (newIdentity) {
        return {
          success: false,
          error: `Development writer cannot admit NEW localRef '${newIdentity.localRef}'. Candidate admission is One-Pass-owned.`,
          errorCode: 'development_new_admission_forbidden',
        };
      }
    }

    // Direct acceptedSupport submission is reserved strictly for WRITERS.RUNTIME (Item C, Item 9)
    if (acceptedSupport && acceptedSupport.length > 0 && writer !== WRITERS.RUNTIME) {
      return {
        success: false,
        error: "Direct 'acceptedSupport' submission is reserved strictly for WRITERS.RUNTIME. Development wire proposals must use 'supportProposals'.",
      };
    }

    // Direct observations, supportProposals, and review receipts rejected from WRITERS.ONE_PASS (Item 9)
    if (writer === WRITERS.ONE_PASS) {
      if (observations && observations.length > 0) {
        return {
          success: false,
          error: "WRITERS.ONE_PASS cannot author direct 'observations'; reserved for Development writer.",
        };
      }
      if (supportProposals && supportProposals.length > 0) {
        return {
          success: false,
          error: "WRITERS.ONE_PASS cannot author direct 'supportProposals'; reserved for Development writer.",
        };
      }
      if (reviewReceipts && reviewReceipts.length > 0) {
        return {
          success: false,
          error: "WRITERS.ONE_PASS cannot author direct 'reviewReceipts'; reserved for Runtime/Development writer.",
        };
      }
    }

    // S4 pending-ledger ownership. One-Pass may enqueue accepted scope but never
    // drains or rewrites existing Development work. Metadata failure/unavailable
    // patches are Runtime-owned bookkeeping; Development may request exact
    // resolutions only through validated receipts in this same atomic commit.
    if (Array.isArray(pendingReviewResolutions) && pendingReviewResolutions.length > 0 && writer !== WRITERS.DEVELOPMENT) {
      return {
        success: false,
        error: "Pending Development review resolution is reserved for the Development transaction boundary.",
        errorCode: 'pending_review_resolution_wrong_writer',
      };
    }
    if (Array.isArray(pendingReviewUpdates) && pendingReviewUpdates.length > 0 && writer !== WRITERS.RUNTIME) {
      return { success: false, error: "Pending review metadata updates are reserved for WRITERS.RUNTIME." };
    }
    if (!Array.isArray(pendingReviewResolutions)) {
      return { success: false, error: "'pendingReviewResolutions' must be an array." };
    }
    if (!Array.isArray(pendingReviewUpdates)) {
      return { success: false, error: "'pendingReviewUpdates' must be an array." };
    }

    // Strict dedupKeys validation (Task 8)
    if (dedupKeys !== undefined) {
      if (!Array.isArray(dedupKeys)) {
        return { success: false, error: "CommitCoordinator 'dedupKeys' must be an array." };
      }
      for (let i = 0; i < dedupKeys.length; i++) {
        const k = dedupKeys[i];
        if (typeof k !== 'string' || k.trim() === '') {
          return { success: false, error: `Invalid dedupKey at index ${i}: must be a non-empty string.` };
        }
      }
    }

    // 1. Fetch latest durable state from storage
    const loadResult = await this.storage.load();
    if (!loadResult || !loadResult.state) {
      return { success: false, error: 'Failed to load current state from storage.' };
    }

    const latestState = loadResult.state;
    const currentRevision = loadResult.revision;

    // Exact replay check against already processed dedup keys (Task 8)
    const existingDedupKeys = latestState.dedup?.processedSourceKeys || [];
    if (Array.isArray(dedupKeys) && dedupKeys.length > 0) {
      const duplicateKey = dedupKeys.find((k) => existingDedupKeys.includes(k));
      if (duplicateKey) {
        // Narrowest policy: fail/no-op whole logical commit if any declared exact replay key is already processed
        return {
          success: true,
          replay: true,
          noop: true,
          reason: 'dedup_exact_replay',
          duplicateKey,
          commitRevision: currentRevision,
          applied: [],
          deferred: [],
          observationIds: [],
          assignedNpcs: [],
        };
      }
    }

    // CAS check on expected storage revision (C10 / Item 3)
    // A globally stale storage revision may merge only when EVERY proposed
    // canonical field has a present read token that still matches latest state.
    // One matching field cannot authorize an uncovered sibling mutation.
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      let proposedFieldCount = 0;
      let allProposedFieldsCoveredAndValid = true;

      for (const [targetKey, fields] of Object.entries(fieldProposals)) {
        const expectedTargetFields = readFieldRevisions?.[targetKey];
        const targetNpc = latestState.npcs?.[targetKey] ||
          (latestState.npcs && Object.values(latestState.npcs).find((npc) => npc.id === targetKey));

        for (const fieldName of Object.keys(fields)) {
          if (fieldName === 'id' || fieldName === 'localRef') continue;
          proposedFieldCount++;

          if (!expectedTargetFields || !targetNpc) {
            allProposedFieldsCoveredAndValid = false;
            break;
          }

          const expectedFieldRev = expectedTargetFields[fieldName];
          const currentFieldRev = targetNpc.fieldRevisions?.[fieldName];
          if (
            expectedFieldRev === undefined ||
            currentFieldRev === undefined ||
            currentFieldRev !== expectedFieldRev
          ) {
            allProposedFieldsCoveredAndValid = false;
            break;
          }
        }

        if (!allProposedFieldsCoveredAndValid) break;
      }

      const canMergeStaleRevision =
        proposedFieldCount > 0 && allProposedFieldsCoveredAndValid;

      if (!canMergeStaleRevision) {
        return {
          success: false,
          conflict: true,
          conflictType: 'storage_cas_conflict',
          currentRevision,
          expectedRevision,
          error: `CAS revision conflict: storage revision is ${currentRevision}, but caller expected ${expectedRevision}.`,
        };
      }
    }

    // 1b. Recheck source dependencies and lineage against exchangeContext if provided (C03, C10, Item 4)
    if (exchangeContext && Array.isArray(sourceDependencies)) {
      for (const dep of sourceDependencies) {
        if (typeof dep === 'string') {
          return {
            success: false,
            conflict: true,
            conflictType: 'source_lineage_conflict',
            error: `Raw string source dependency '${dep}' cannot be validated for lineage; captured dependency descriptor required.`,
            errorCode: 'raw_string_dependency_forbidden',
          };
        } else if (dep && typeof dep === 'object') {
          if (dep.capturedProvenance) {
            const reval = revalidateSourceDependency(dep, exchangeContext);
            if (!reval.valid) {
              return {
                success: false,
                conflict: true,
                conflictType: 'source_lineage_conflict',
                error: `Captured source lineage conflict: ${reval.error}`,
                errorCode: reval.errorCode || 'source_lineage_conflict',
              };
            }
          } else if (dep.sourceRef) {
            const res = resolveSourceReference(dep, exchangeContext, { writer });
            if (!res.valid) {
              return {
                success: false,
                conflict: true,
                conflictType: 'source_lineage_conflict',
                error: `Source lineage conflict: ${res.error}`,
                errorCode: res.errorCode || 'source_lineage_conflict',
              };
            }
          }
        }
      }
    }

    if (exchangeContext && Array.isArray(observations)) {
      for (const obs of observations) {
        if (obs.source && typeof obs.source === 'object') {
          const res = resolveSourceReference(obs.source, exchangeContext, { writer, targetField: obs.field });
          if (!res.valid) {
            return {
              success: false,
              conflict: true,
              conflictType: 'source_lineage_conflict',
              error: `Source lineage conflict in observation: ${res.error}`,
              errorCode: res.errorCode || 'source_lineage_conflict',
            };
          }
        }
      }
    }

    // 2. Working copy of state for atomic mutation
    const workingState = cloneState(latestState);

    // 3. Resolve identities atomically
    // Map of localRef/id -> resolved descriptor { isNew, assignedId, npc }
    const idResolution = resolveIdentityBatch(identityProposals, workingState, this.admissionPolicy);
    if (!idResolution.valid) {
      // Atomic dependent failure: failed admission leaves no orphan mutation (C04)
      return {
        success: false,
        error: `Identity resolution failed: ${idResolution.errors.join('; ')}`,
        errors: idResolution.errors,
      };
    }

    const resolvedIdentityMap = idResolution.resolvedMap;

    // Create newly admitted NPC records in working state
    for (const assigned of idResolution.assignedNpcs) {
      const newRecord = createDefaultNpcRecord(assigned.assignedId, assigned.name, {
        identityKind: assigned.identityKind,
        aliases: assigned.aliases,
      });
      workingState.npcs[assigned.assignedId] = newRecord;
    }

    // 3b. Validate pendingReviewEntries up-front before mutations (Task 9)
    const resolvedPendingEntries = [];
    if (pendingReviewEntries !== undefined) {
      if (!Array.isArray(pendingReviewEntries)) {
        return { success: false, error: "'pendingReviewEntries' must be an array." };
      }
      const existingPending = workingState.pendingReview?.entries || [];
      const seenPendingKeys = new Set();
      for (const ep of existingPending) {
        if (ep.id) seenPendingKeys.add(`id:${ep.id}`);
        const scopeKey = Array.isArray(ep.sourceScope) ? [...ep.sourceScope].sort().join(',') : '';
        const exKey = ep.exchangeId || '';
        if (ep.targetId && (scopeKey || exKey)) {
          seenPendingKeys.add(`target:${ep.targetId}|ex:${exKey}|scope:${scopeKey}`);
        }
      }

      const ALLOWED_PENDING_KEYS = [
        'id',
        'targetId',
        'sourceScope',
        'exchangeId',
        'reason',
        'createdAt',
        'priority',
        'fieldSubset',
        'metadata',
      ];

      for (let i = 0; i < pendingReviewEntries.length; i++) {
        const entry = pendingReviewEntries[i];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return { success: false, error: `Invalid pendingReviewEntry at index ${i}: must be an object.` };
        }
        for (const k of Object.keys(entry)) {
          if (!ALLOWED_PENDING_KEYS.includes(k)) {
            return { success: false, error: `Invalid pendingReviewEntry at index ${i}: unknown key '${k}'.` };
          }
        }
        if (typeof entry.targetId !== 'string' || entry.targetId.trim() === '') {
          return { success: false, error: `Invalid pendingReviewEntry at index ${i}: requires non-empty string 'targetId'.` };
        }

        // Resolve localRef or ID
        const resolvedTargetId = resolvedIdentityMap.get(entry.targetId)?.assignedId || entry.targetId;
        if (workingState.tombstones && workingState.tombstones[resolvedTargetId]) {
          return { success: false, error: `Pending review target '${resolvedTargetId}' is tombstoned.` };
        }
        if (!workingState.npcs[resolvedTargetId]) {
          return { success: false, error: `Pending review target '${entry.targetId}' does not exist in state.` };
        }

        const hasScope = Array.isArray(entry.sourceScope) && entry.sourceScope.length > 0 && entry.sourceScope.every((s) => typeof s === 'string' && s.trim() !== '');
        const hasExchangeId = typeof entry.exchangeId === 'string' && entry.exchangeId.trim() !== '';
        if (!hasScope && !hasExchangeId) {
          return { success: false, error: `Pending review entry for target '${resolvedTargetId}' requires non-empty 'sourceScope' or 'exchangeId'.` };
        }

        // Duplicate pending identity check
        if (entry.id) {
          const idKey = `id:${entry.id}`;
          if (seenPendingKeys.has(idKey)) {
            return { success: false, error: `Duplicate pending review entry id '${entry.id}'.` };
          }
          seenPendingKeys.add(idKey);
        }
        const scopeKey = Array.isArray(entry.sourceScope) ? [...entry.sourceScope].sort().join(',') : '';
        const exKey = entry.exchangeId || '';
        const targetPendingKey = `target:${resolvedTargetId}|ex:${exKey}|scope:${scopeKey}`;
        if (seenPendingKeys.has(targetPendingKey)) {
          return { success: false, error: `Duplicate pending review entry for target '${resolvedTargetId}' with scope/exchange.` };
        }
        seenPendingKeys.add(targetPendingKey);

        resolvedPendingEntries.push({
          ...entry,
          targetId: resolvedTargetId,
        });
      }
    }

    // 3c. Validate exact S4 pending-ledger resolution/update requests against the
    // latest durable pending set before any semantic field mutation is accepted.
    const currentPendingEntries = workingState.pendingReview?.entries || [];
    const pendingById = new Map();
    for (const entry of currentPendingEntries) {
      if (entry?.id) pendingById.set(entry.id, entry);
    }

    const normalizedPendingResolutions = [];
    const seenResolutionIds = new Set();
    for (let i = 0; i < pendingReviewResolutions.length; i++) {
      const resolution = pendingReviewResolutions[i];
      if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) {
        return { success: false, error: `Invalid pendingReviewResolution at index ${i}: must be an object.` };
      }
      const allowedKeys = ['id', 'targetId', 'sourceScope'];
      for (const key of Object.keys(resolution)) {
        if (!allowedKeys.includes(key)) {
          return { success: false, error: `Invalid pendingReviewResolution at index ${i}: unknown key '${key}'.` };
        }
      }
      if (typeof resolution.id !== 'string' || resolution.id.trim() === '') {
        return { success: false, error: `Invalid pendingReviewResolution at index ${i}: requires non-empty string 'id'.` };
      }
      if (seenResolutionIds.has(resolution.id)) {
        return { success: false, error: `Duplicate pending review resolution id '${resolution.id}'.` };
      }
      seenResolutionIds.add(resolution.id);
      const existing = pendingById.get(resolution.id);
      if (!existing) {
        return { success: false, error: `Pending review resolution '${resolution.id}' does not exist in latest state.` };
      }
      if (resolution.targetId !== undefined && resolution.targetId !== existing.targetId) {
        return { success: false, error: `Pending review resolution '${resolution.id}' target mismatch.` };
      }
      if (resolution.sourceScope !== undefined) {
        if (!Array.isArray(resolution.sourceScope) || !resolution.sourceScope.every((s) => typeof s === 'string' && s.trim() !== '')) {
          return { success: false, error: `Pending review resolution '${resolution.id}' sourceScope must be an array of non-empty strings.` };
        }
        const existingScope = Array.isArray(existing.sourceScope) ? existing.sourceScope : [];
        const exactScope = resolution.sourceScope.length === existingScope.length &&
          resolution.sourceScope.every((s, idx) => s === existingScope[idx]);
        if (!exactScope) {
          return { success: false, error: `Pending review resolution '${resolution.id}' sourceScope does not match latest pending scope.` };
        }
      }
      normalizedPendingResolutions.push({ id: resolution.id, entry: existing });
    }

    const normalizedPendingUpdates = [];
    const seenUpdateIds = new Set();
    for (let i = 0; i < pendingReviewUpdates.length; i++) {
      const update = pendingReviewUpdates[i];
      if (!update || typeof update !== 'object' || Array.isArray(update)) {
        return { success: false, error: `Invalid pendingReviewUpdate at index ${i}: must be an object.` };
      }
      const allowedKeys = ['id', 'metadataPatch'];
      for (const key of Object.keys(update)) {
        if (!allowedKeys.includes(key)) {
          return { success: false, error: `Invalid pendingReviewUpdate at index ${i}: unknown key '${key}'.` };
        }
      }
      if (typeof update.id !== 'string' || update.id.trim() === '' || seenUpdateIds.has(update.id)) {
        return { success: false, error: `Invalid or duplicate pendingReviewUpdate id at index ${i}.` };
      }
      seenUpdateIds.add(update.id);
      const existing = pendingById.get(update.id);
      if (!existing) {
        return { success: false, error: `Pending review update '${update.id}' does not exist in latest state.` };
      }
      if (!update.metadataPatch || typeof update.metadataPatch !== 'object' || Array.isArray(update.metadataPatch)) {
        return { success: false, error: `Pending review update '${update.id}' requires object metadataPatch.` };
      }
      normalizedPendingUpdates.push({ id: update.id, metadataPatch: structuredClone(update.metadataPatch) });
    }

    // 4. Revalidate read dependencies against latest state (C10)
    // Item C: Field-scoped stale read dependency handling.
    // A stale/missing read token for proposed field X defers X only;
    // unrelated field Y whose token matches applies.
    const deferredProposals = [];
    const targetsToApply = new Map(); // assignedId -> field proposals

    for (const [targetKey, fields] of Object.entries(fieldProposals)) {
      const identity = resolvedIdentityMap.get(targetKey);
      if (!identity) {
        return {
          success: false,
          error: `Unresolved target reference '${targetKey}' in field proposals.`,
        };
      }

      const assignedId = identity.assignedId;
      const targetNpc = workingState.npcs[assignedId];

      if (!targetNpc) {
        return {
          success: false,
          error: `Target NPC '${assignedId}' does not exist in state.`,
        };
      }

      // Tombstone check
      if (workingState.tombstones && workingState.tombstones[assignedId]) {
        return {
          success: false,
          error: `Target NPC '${assignedId}' is tombstoned and cannot accept mutations.`,
        };
      }

      // Check read-field dependencies if provided (e.g. from background review dispatch)
      // Item C: field-scoped - only defer specific fields whose read tokens are stale
      const fieldsToApply = {};
      if ((readFieldRevisions && readFieldRevisions[targetKey]) || (readFieldDependencies && readFieldDependencies[targetKey])) {
        const expectedFields = readFieldRevisions?.[targetKey] || {};
        for (const [fieldName, proposalValue] of Object.entries(fields)) {
          if (fieldName === 'id' || fieldName === 'localRef') {
            fieldsToApply[fieldName] = proposalValue;
            continue;
          }
          const expectedRev = expectedFields[fieldName];
          if (expectedRev !== undefined) {
            const currentFieldRev = targetNpc.fieldRevisions?.[fieldName];
            if (currentFieldRev === undefined || currentFieldRev !== expectedRev) {
              // This specific field's read dependency is stale - defer it only
              deferredProposals.push({
                targetId: assignedId,
                field: fieldName,
                expectedRev,
                currentFieldRev,
                reason: currentFieldRev === undefined ? 'read_dependency_missing' : 'read_dependency_changed',
              });
              continue; // Skip this field, apply others
            }
          }

          const crossDependencies = readFieldDependencies?.[targetKey]?.[fieldName];
          if (crossDependencies && typeof crossDependencies === 'object') {
            let dependencyConflict = null;
            for (const [dependencyField, expectedDependencyRevision] of Object.entries(crossDependencies)) {
              const currentDependencyRevision = targetNpc.fieldRevisions?.[dependencyField];
              if (currentDependencyRevision === undefined || currentDependencyRevision !== expectedDependencyRevision) {
                dependencyConflict = {
                  dependencyField,
                  expectedDependencyRevision,
                  currentDependencyRevision,
                };
                break;
              }
            }
            if (dependencyConflict) {
              deferredProposals.push({
                targetId: assignedId,
                field: fieldName,
                dependencyField: dependencyConflict.dependencyField,
                expectedRev: dependencyConflict.expectedDependencyRevision,
                currentFieldRev: dependencyConflict.currentDependencyRevision,
                reason: 'dependent_read_changed',
              });
              continue;
            }
          }

          // Field has matching direct and cross-field dependencies (or none declared).
          fieldsToApply[fieldName] = proposalValue;
        }
        // Also track stale deps on fields declared in readFieldRevisions but NOT in proposals
        for (const [fieldName, expectedRev] of Object.entries(expectedFields)) {
          if (fields[fieldName] !== undefined) continue; // Already handled above
          const currentFieldRev = targetNpc.fieldRevisions?.[fieldName];
          if (currentFieldRev === undefined || currentFieldRev !== expectedRev) {
            deferredProposals.push({
              targetId: assignedId,
              field: fieldName,
              expectedRev,
              currentFieldRev,
              reason: currentFieldRev === undefined ? 'read_dependency_missing' : 'read_dependency_changed',
            });
          }
        }
      } else {
        // No read field revisions for this target - all fields apply
        Object.assign(fieldsToApply, fields);
      }

      if (Object.keys(fieldsToApply).filter(k => k !== 'id' && k !== 'localRef').length > 0) {
        targetsToApply.set(assignedId, fieldsToApply);
      }
    }

    // Read dependencies may guard observation/support-only Development work even
    // when the response contains no scalar proposal for that field. Revalidate
    // those non-proposed fields too so stale evidence cannot enter C08 records.
    if (readFieldRevisions) {
      for (const [targetKey, expectedFields] of Object.entries(readFieldRevisions)) {
        // Targets already present in fieldProposals were fully checked above,
        // including declared read tokens for non-proposed sibling fields.
        if (Object.prototype.hasOwnProperty.call(fieldProposals, targetKey)) continue;
        const proposedFields = {};
        const assignedId = resolvedIdentityMap.get(targetKey)?.assignedId || targetKey;
        const targetNpc = workingState.npcs[assignedId];
        if (!targetNpc) {
          return { success: false, error: `Read dependency target '${assignedId}' does not exist in state.` };
        }
        for (const [fieldName, expectedRev] of Object.entries(expectedFields)) {
          if (Object.prototype.hasOwnProperty.call(proposedFields, fieldName)) continue;
          const currentFieldRev = targetNpc.fieldRevisions?.[fieldName];
          if (currentFieldRev === undefined || currentFieldRev !== expectedRev) {
            deferredProposals.push({
              targetId: assignedId,
              field: fieldName,
              expectedRev,
              currentFieldRev,
              reason: currentFieldRev === undefined ? 'read_dependency_missing' : 'read_dependency_changed',
            });
          }
        }
      }
    }
    if (readFieldDependencies) {
      for (const [targetKey, proposedDependencyMap] of Object.entries(readFieldDependencies)) {
        const proposedFields = fieldProposals[targetKey] || {};
        const assignedId = resolvedIdentityMap.get(targetKey)?.assignedId || targetKey;
        const targetNpc = workingState.npcs[assignedId];
        if (!targetNpc) {
          return { success: false, error: `Cross-field dependency target '${assignedId}' does not exist in state.` };
        }
        for (const [guardedField, dependencies] of Object.entries(proposedDependencyMap)) {
          if (Object.prototype.hasOwnProperty.call(proposedFields, guardedField)) continue;
          for (const [dependencyField, expectedDependencyRevision] of Object.entries(dependencies)) {
            const currentDependencyRevision = targetNpc.fieldRevisions?.[dependencyField];
            if (currentDependencyRevision === undefined || currentDependencyRevision !== expectedDependencyRevision) {
              deferredProposals.push({
                targetId: assignedId,
                field: guardedField,
                dependencyField,
                expectedRev: expectedDependencyRevision,
                currentFieldRev: currentDependencyRevision,
                reason: 'dependent_read_changed',
              });
              break;
            }
          }
        }
      }
    }

    // 5. Apply field-scoped proposals to the latest state (C10)
    // Note: unrelated newer live changes survive because we apply field-by-field to latestState
    const appliedSummary = [];
    const appliedFieldsByTarget = new Map(); // assignedId -> Set<fieldName>
    const lockedFieldsByTarget = new Map(); // assignedId -> Set<fieldName>
    for (const [assignedId, fields] of targetsToApply.entries()) {
      const npc = workingState.npcs[assignedId];
      const applyResult = applyNpcProposals(npc, fields, writer, { resolvedIdentityMap });
      if (!applyResult.applied && applyResult.errors.length > 0) {
        return {
          success: false,
          error: `Field application failed for NPC '${assignedId}': ${applyResult.errors.join('; ')}`,
          errors: applyResult.errors,
        };
      }
      appliedSummary.push({
        targetId: assignedId,
        appliedFields: applyResult.appliedFields,
        lockedFields: applyResult.lockedFields || [],
      });
      appliedFieldsByTarget.set(assignedId, new Set(applyResult.appliedFields));
      if (applyResult.lockedFields && applyResult.lockedFields.length > 0) {
        lockedFieldsByTarget.set(assignedId, new Set(applyResult.lockedFields));
        for (const lf of applyResult.lockedFields) {
          deferredProposals.push({
            targetId: assignedId,
            field: lf,
            reason: 'locked',
          });
        }
      }
    }

    // Consolidate field-scoped stale/locked outcomes before any C08 observation
    // or support record is persisted. Observation-only work must obey the same
    // dependency gate as scalar proposals.
    const deferredFieldsByTarget = new Map(); // targetId -> Map<fieldName, reason>
    for (const dp of deferredProposals) {
      if (!deferredFieldsByTarget.has(dp.targetId)) {
        deferredFieldsByTarget.set(dp.targetId, new Map());
      }
      deferredFieldsByTarget.get(dp.targetId).set(dp.field, dp.reason);
    }

    // 6. Process C08 Development Observations
    // Assign persistent runtime IDs and resolve request-local observation references (C08)
    const localRefToPersistentIdMap = new Map();
    const localRefToObsInfoMap = new Map();
    const persistedObservations = [];

    // First pass: assign persistent IDs to proposed observations
    for (let i = 0; i < observations.length; i++) {
      const obs = observations[i];
      const targetId = resolvedIdentityMap.get(obs.targetId)?.assignedId || obs.targetId;

      if (!workingState.npcs[targetId]) {
        return { success: false, error: `Observation target '${targetId}' not found in state.` };
      }

      // Validate the field before any stale-result skip so malformed low-level
      // input cannot hide behind a dependency conflict.
      if (!isDurableDossierField(obs.field)) {
        return {
          success: false,
          error: `Observation field '${obs.field}' must target an eligible Development durable field; observations ledger is not valid target.`,
        };
      }
      const obsBaseField = obs.field.split('.')[0];
      const targetDeferredFields = deferredFieldsByTarget.get(targetId);
      if (targetDeferredFields && (targetDeferredFields.has(obs.field) || targetDeferredFields.has(obsBaseField))) {
        continue;
      }

      const persistentId = generateObservationId();
      const localKey = obs.localObservationRef;
      if (localKey) {
        localRefToPersistentIdMap.set(localKey, persistentId);
        localRefToObsInfoMap.set(localKey, {
          persistentId,
          targetId,
          field: obs.field,
          baseField: obs.field ? obs.field.split('.')[0] : '',
        });
      }

      const { localObservationRef, localObsRef, localRef, ...restObs } = obs;
      persistedObservations.push({
        ...restObs,
        id: persistentId,
        targetId,
      });
    }

    // Second pass: resolve request-local references in dispositions and validate
    for (const pObs of persistedObservations) {
      if (pObs.disposition) {
        const disp = { ...pObs.disposition };

        // Resolve request-local observation refs to persistent IDs (C08, Item D)
        if (disp.linkedObservationRefs && Array.isArray(disp.linkedObservationRefs)) {
          const resolvedIds = [];
          for (const ref of disp.linkedObservationRefs) {
            const persistent = localRefToPersistentIdMap.get(ref);
            if (!persistent) {
              return {
                success: false,
                error: `Unresolvable local observation ref '${ref}' in observation disposition (C08).`,
              };
            }
            resolvedIds.push(persistent);
          }
          disp.linkedObservationIds = resolvedIds;
          delete disp.linkedObservationRefs;
        }

        pObs.disposition = disp;
      }

      // Validate persisted observation record shape using S1 validator
      const val = validatePersistedObservationRecord(pObs);
      if (!val.valid) {
        return {
          success: false,
          error: `Persisted observation validation error: ${val.error}`,
        };
      }

      // Append observation to the NPC's development record
      const npc = workingState.npcs[pObs.targetId];
      if (!npc.development) {
        npc.development = { observations: [], acceptedSupport: [], reviewReceipts: [] };
      }
      npc.development.observations.push(pObs);
    }

    // 7. Process C08 Support Proposals & Accepted Support (Item C & Item 6)
    // Development callers propose supportProposals; Runtime builds acceptedSupport records
    // with actual committed fieldRevision and resolved observation IDs.
    // Item B: Use field-scoped affected/deferred bookkeeping, not coarse target poisoning
    const runtimeAcceptedSupport = [];

    for (const prop of supportProposals) {
      const targetId = resolvedIdentityMap.get(prop.targetId)?.assignedId || prop.targetId;
      const npc = workingState.npcs[targetId];
      if (!npc) {
        return { success: false, error: `Support proposal target '${targetId}' not found in state.` };
      }

      const baseField = prop.field.split('.')[0];
      if (!isDurableDossierField(baseField)) {
        return {
          success: false,
          error: `Support proposal field '${prop.field}' must target an eligible Development durable field; observations ledger is not valid target.`,
        };
      }

      // Item B: If this specific field was deferred, skip creating acceptedSupport (field-scoped, not coarse target)
      const targetDeferredFields = deferredFieldsByTarget.get(targetId);
      if (targetDeferredFields && (targetDeferredFields.has(prop.field) || targetDeferredFields.has(baseField))) {
        continue;
      }

      // If target had field proposals submitted but this specific field was not applied, do not promote support (Task 5)
      if (appliedFieldsByTarget.has(targetId)) {
        const targetApplied = appliedFieldsByTarget.get(targetId);
        if (!targetApplied.has(prop.field) && !targetApplied.has(baseField)) {
          continue;
        }
      }

      // If field is locked or blocked by lock, do not promote support (Task 7)
      if (npc.locks && (npc.locks[prop.field] === true || npc.locks[baseField] === true)) {
        continue;
      }
      if (lockedFieldsByTarget.get(targetId)?.has(prop.field) || lockedFieldsByTarget.get(targetId)?.has(baseField)) {
        continue;
      }

      // Link to the committed field revision of the canonical base field (Item 6)
      const committedFieldRev = String(npc.fieldRevisions?.[baseField] || '1');
      const suppRecord = {
        targetId,
        field: prop.field,
        fieldRevision: committedFieldRev,
      };

      if (prop.supportingObservationIds && Array.isArray(prop.supportingObservationIds)) {
        // Verify supportingObservationIds exist in target's persisted observations and match target & baseField (Tasks 4 & 6)
        const allObs = [
          ...(npc.development?.observations || []),
          ...persistedObservations.filter((o) => o.targetId === targetId),
        ];
        for (const obsId of prop.supportingObservationIds) {
          const match = allObs.find((o) => o.id === obsId);
          if (!match) {
            return {
              success: false,
              error: `Supporting observation '${obsId}' does not exist in target '${targetId}' persisted observations (C08).`,
            };
          }
          if (match.targetId !== targetId) {
            return {
              success: false,
              error: `Supporting observation '${obsId}' target mismatch: observation belongs to '${match.targetId}', expected '${targetId}'.`,
            };
          }
          const obsBase = (match.field || '').split('.')[0];
          if (obsBase !== baseField) {
            return {
              success: false,
              error: `Supporting observation '${obsId}' field mismatch: observation base field '${obsBase}' does not match support proposal base field '${baseField}' (C08).`,
            };
          }
        }
        suppRecord.supportingObservationIds = [...prop.supportingObservationIds];
      }

      if (prop.supportingObservationRefs && Array.isArray(prop.supportingObservationRefs)) {
        const resolvedSupportingIds = [];
        for (const ref of prop.supportingObservationRefs) {
          const localObsInfo = localRefToObsInfoMap.get(ref);
          if (!localObsInfo) {
            return {
              success: false,
              error: `Unresolvable supporting observation ref '${ref}' in supportProposals (C08).`,
            };
          }
          if (localObsInfo.targetId !== targetId) {
            return {
              success: false,
              error: `Supporting observation ref '${ref}' target mismatch: observation targets '${localObsInfo.targetId}', expected '${targetId}' (C08).`,
            };
          }
          if (localObsInfo.baseField !== baseField) {
            return {
              success: false,
              error: `Supporting observation ref '${ref}' field mismatch: observation base field '${localObsInfo.baseField}' does not match support proposal base field '${baseField}' (C08).`,
            };
          }
          resolvedSupportingIds.push(localObsInfo.persistentId);
        }
        suppRecord.supportingObservationIds = [
          ...(suppRecord.supportingObservationIds || []),
          ...resolvedSupportingIds,
        ];
      }

      if (prop.sourceRefs && Array.isArray(prop.sourceRefs)) {
        for (let i = 0; i < prop.sourceRefs.length; i++) {
          const sRef = prop.sourceRefs[i];
          if (typeof sRef !== 'string' || sRef.trim() === '') {
            return {
              success: false,
              error: `Support proposal sourceRef at index ${i} must be a non-empty string (Task 2).`,
            };
          }
        }
        suppRecord.sourceRefs = [...prop.sourceRefs];
      }

      if (prop.notes) {
        suppRecord.notes = prop.notes;
      }

      // Accepted support qualifies an actual canonical value/revision. This runs
      // after reference validation so malformed links retain their more specific
      // failure, but before any support record can be persisted. Scalar proposals
      // have already applied to workingState, so same-transaction establishment is valid.
      if (!hasAcceptedFieldValue(npc, baseField)) {
        return {
          success: false,
          error: `Support proposal field '${baseField}' has no accepted durable value to support.`,
          errorCode: 'support_without_accepted_value',
        };
      }

      const suppVal = validatePersistedAcceptedSupportRecord(suppRecord);
      if (!suppVal.valid) {
        return {
          success: false,
          error: `Persisted accepted-support validation error: ${suppVal.error}`,
        };
      }

      runtimeAcceptedSupport.push(suppRecord);
    }

    if (writer === WRITERS.RUNTIME && acceptedSupport && acceptedSupport.length > 0) {
      for (const supp of acceptedSupport) {
        const targetId = resolvedIdentityMap.get(supp.targetId)?.assignedId || supp.targetId;
        const npc = workingState.npcs[targetId];
        if (!npc) {
          return { success: false, error: `Accepted support target '${targetId}' not found in state.` };
        }

        const baseField = supp.field.split('.')[0];
        if (!isDurableDossierField(baseField)) {
          return {
            success: false,
            error: `Accepted support field '${supp.field}' must target an eligible Development durable field.`,
          };
        }
        const committedFieldRev = String(npc.fieldRevisions?.[baseField] || '1');
        if (supp.fieldRevision !== undefined && String(supp.fieldRevision) !== committedFieldRev) {
          return {
            success: false,
            error: `Accepted support fieldRevision '${supp.fieldRevision}' does not match canonical base-field revision '${committedFieldRev}' for '${baseField}'.`,
          };
        }
        const persistedSupp = {
          ...supp,
          targetId,
          fieldRevision: committedFieldRev,
        };

        if (persistedSupp.supportingObservationIds && Array.isArray(persistedSupp.supportingObservationIds)) {
          const allObs = [
            ...(npc.development?.observations || []),
            ...persistedObservations.filter((o) => o.targetId === targetId),
          ];
          for (const obsId of persistedSupp.supportingObservationIds) {
            const match = allObs.find((o) => o.id === obsId);
            if (!match) {
              return {
                success: false,
                error: `Supporting observation '${obsId}' does not exist in target '${targetId}' persisted observations (C08).`,
              };
            }
            if (match.targetId !== targetId) {
              return {
                success: false,
                error: `Supporting observation '${obsId}' target mismatch: observation belongs to '${match.targetId}', expected '${targetId}'.`,
              };
            }
            const obsBase = (match.field || '').split('.')[0];
            if (obsBase !== baseField) {
              return {
                success: false,
                error: `Supporting observation '${obsId}' field mismatch: observation base field '${obsBase}' does not match acceptedSupport base field '${baseField}' (C08).`,
              };
            }
          }
        }

        if (persistedSupp.supportingObservationRefs && Array.isArray(persistedSupp.supportingObservationRefs)) {
          const resolvedSupportingIds = [];
          for (const ref of persistedSupp.supportingObservationRefs) {
            const localObsInfo = localRefToObsInfoMap.get(ref);
            if (!localObsInfo) {
              return {
                success: false,
                error: `Unresolvable supporting observation ref '${ref}' in acceptedSupport (C08).`,
              };
            }
            if (localObsInfo.targetId !== targetId) {
              return {
                success: false,
                error: `Supporting observation ref '${ref}' target mismatch: observation targets '${localObsInfo.targetId}', expected '${targetId}' (C08).`,
              };
            }
            if (localObsInfo.baseField !== baseField) {
              return {
                success: false,
                error: `Supporting observation ref '${ref}' field mismatch: observation base field '${localObsInfo.baseField}' does not match acceptedSupport base field '${baseField}' (C08).`,
              };
            }
            resolvedSupportingIds.push(localObsInfo.persistentId);
          }
          persistedSupp.supportingObservationIds = resolvedSupportingIds;
          delete persistedSupp.supportingObservationRefs;
        }
        delete persistedSupp.localObservationRef;
        delete persistedSupp.localObsRef;
        delete persistedSupp.localRef;

        // Runtime may own the persisted support record, but it cannot create a
        // support link for an unknown canonical value. Revision/reference errors
        // above remain more specific and therefore take precedence.
        if (!hasAcceptedFieldValue(npc, baseField)) {
          return {
            success: false,
            error: `Accepted support field '${baseField}' has no accepted durable value to support.`,
            errorCode: 'support_without_accepted_value',
          };
        }

        const suppVal = validatePersistedAcceptedSupportRecord(persistedSupp);
        if (!suppVal.valid) {
          return {
            success: false,
            error: `Persisted accepted-support validation error: ${suppVal.error}`,
          };
        }

        runtimeAcceptedSupport.push(persistedSupp);
      }
    }

    for (const suppRecord of runtimeAcceptedSupport) {
      const npc = workingState.npcs[suppRecord.targetId];
      if (!npc.development) {
        npc.development = { observations: [], acceptedSupport: [], reviewReceipts: [] };
      }
      npc.development.acceptedSupport.push(suppRecord);
    }

    // 8. Process Review Receipts (Runtime owned)
    const persistedReviewReceipts = [];
    for (const receipt of reviewReceipts) {
      const targetId = resolvedIdentityMap.get(receipt.targetId)?.assignedId || receipt.targetId;
      if (workingState.tombstones && workingState.tombstones[targetId]) {
        return {
          success: false,
          error: `Review receipt target '${targetId}' is tombstoned.`,
        };
      }
      const npc = workingState.npcs[targetId];
      if (!npc) {
        return {
          success: false,
          error: `Review receipt target '${targetId}' does not exist in state.`,
        };
      }

      if (!npc.development) {
        npc.development = { observations: [], acceptedSupport: [], reviewReceipts: [] };
      }

      // Item B: Field-scoped receipt deferral logic
      const targetDeferredFields = deferredFieldsByTarget.get(targetId);
      const targetLockedFields = lockedFieldsByTarget.get(targetId) || new Set();
      // Combine all affected/deferred fields (locked + stale read deps)
      const allAffectedFields = new Set([
        ...(targetDeferredFields ? targetDeferredFields.keys() : []),
        ...targetLockedFields,
      ]);

      let shouldDeferReceipt = false;

      if (receipt.restricted === true && Array.isArray(receipt.fieldSubset)) {
        // Restricted receipt: defer only if its fieldSubset intersects affected/deferred fields
        const intersectsAffected = receipt.fieldSubset.some(
          (f) => allAffectedFields.has(f) || (npc.locks && npc.locks[f] === true)
        );
        if (intersectsAffected) {
          shouldDeferReceipt = true;
        }
      } else if (!receipt.restricted) {
        // Unrestricted receipt: if any reviewed work/support for target was blocked/deferred
        // and runtime cannot claim complete scope, conservatively mark deferred
        if (allAffectedFields.size > 0) {
          shouldDeferReceipt = true;
        }
      }

      const persistedReceipt = shouldDeferReceipt
        ? {
            ...receipt,
            targetId,
            status: 'deferred',
            committedAt: new Date().toISOString(),
          }
        : {
            ...receipt,
            targetId,
            committedAt: new Date().toISOString(),
          };
      npc.development.reviewReceipts.push(persistedReceipt);
      persistedReviewReceipts.push(persistedReceipt);
    }

    // 8b. Apply Runtime-only pending metadata updates and Development resolution
    // requests inside this same transaction. A pending source can disappear only
    // when an exact latest entry is covered by a non-deferred validated receipt.
    for (const update of normalizedPendingUpdates) {
      const pendingEntry = workingState.pendingReview.entries.find((entry) => entry?.id === update.id);
      if (!pendingEntry) {
        return { success: false, error: `Pending review update '${update.id}' disappeared before atomic apply.` };
      }
      pendingEntry.metadata = {
        ...(pendingEntry.metadata && typeof pendingEntry.metadata === 'object' ? pendingEntry.metadata : {}),
        ...update.metadataPatch,
      };
    }

    const resolvedPendingReviewIds = [];
    const deferredPendingReviewIds = [];
    for (const resolution of normalizedPendingResolutions) {
      const pendingEntry = workingState.pendingReview.entries.find((entry) => entry?.id === resolution.id);
      if (!pendingEntry) {
        return { success: false, error: `Pending review resolution '${resolution.id}' disappeared before atomic apply.` };
      }
      const pendingScope = Array.isArray(pendingEntry.sourceScope) ? pendingEntry.sourceScope : [];
      const matchingReceipts = persistedReviewReceipts.filter((receipt) => {
        if (receipt.targetId !== pendingEntry.targetId) return false;
        const receiptScope = Array.isArray(receipt.sourceScope) ? receipt.sourceScope : [];
        if (!pendingScope.every((sourceRef) => receiptScope.includes(sourceRef))) return false;
        if (Array.isArray(pendingEntry.fieldSubset) && pendingEntry.fieldSubset.length > 0) {
          // An unrestricted receipt covers every durable field and therefore also
          // covers a previously restricted pending subset. A restricted receipt
          // must explicitly include the entire pending subset.
          if (receipt.restricted === true) {
            if (!Array.isArray(receipt.fieldSubset)) return false;
            if (!pendingEntry.fieldSubset.every((field) => receipt.fieldSubset.includes(field))) return false;
          }
        } else if (receipt.restricted === true) {
          // A restricted receipt cannot clear an unrestricted pending source scope.
          return false;
        }
        return true;
      });
      const successReceipt = matchingReceipts.find((receipt) =>
        receipt.status === 'reviewed' || receipt.status === 'reviewed_no_proposals'
      );
      if (successReceipt) {
        // A source can be successfully reviewed while still yielding tentative or
        // contradicting profile evidence. Keep that exact owned source pending,
        // narrowed to only the unresolved observation fields, instead of either
        // losing the provenance or automatically re-reviewing it in a loop.
        const npc = workingState.npcs[pendingEntry.targetId];
        const pendingSubset = new Set(
          Array.isArray(pendingEntry.fieldSubset)
            ? pendingEntry.fieldSubset.map((field) => String(field).split('.')[0])
            : [],
        );
        const appliedFields = appliedFieldsByTarget.get(pendingEntry.targetId) || new Set();
        const acceptedSupportRecords = npc?.development?.acceptedSupport || [];
        const supportedObservationIds = new Set(
          acceptedSupportRecords.flatMap((support) => support.supportingObservationIds || []),
        );
        const unresolvedObservationFields = new Set();

        for (const observation of npc?.development?.observations || []) {
          const sourceRef = observation?.source?.sourceRef;
          if (!sourceRef || !pendingScope.includes(sourceRef)) continue;
          const baseField = String(observation.field || '').split('.')[0];
          if (!baseField || (pendingSubset.size > 0 && !pendingSubset.has(baseField))) continue;
          if (appliedFields.has(observation.field) || appliedFields.has(baseField)) continue;
          if (supportedObservationIds.has(observation.id)) continue;
          const sourceNowSupportsField = acceptedSupportRecords.some((support) =>
            String(support.field || '').split('.')[0] === baseField &&
            Array.isArray(support.sourceRefs) &&
            support.sourceRefs.includes(sourceRef)
          );
          if (sourceNowSupportsField) continue;
          const dispositionRole = observation.disposition?.role;
          if (dispositionRole === 'supporting' || dispositionRole === 'superseded') continue;
          unresolvedObservationFields.add(baseField);
        }

        if (unresolvedObservationFields.size > 0) {
          const deferredFields = [...unresolvedObservationFields].sort();
          pendingEntry.reason = 'observation_followup';
          pendingEntry.fieldSubset = deferredFields;
          pendingEntry.metadata = {
            ...(pendingEntry.metadata && typeof pendingEntry.metadata === 'object' ? pendingEntry.metadata : {}),
            lastReviewStatus: 'deferred',
            lastReviewAt: successReceipt.committedAt,
            deferredFields,
            followupKind: 'observation',
          };
          delete pendingEntry.metadata.lastFailureCode;
          delete pendingEntry.metadata.lastFailureAt;
          delete pendingEntry.metadata.lastUnavailableAt;
          deferredPendingReviewIds.push(resolution.id);
          continue;
        }

        workingState.pendingReview.entries = workingState.pendingReview.entries.filter((entry) => entry?.id !== resolution.id);
        resolvedPendingReviewIds.push(resolution.id);
        continue;
      }

      const deferredReceipt = matchingReceipts.find((receipt) => receipt.status === 'deferred');
      if (deferredReceipt) {
        const affected = deferredFieldsByTarget.get(pendingEntry.targetId);
        pendingEntry.metadata = {
          ...(pendingEntry.metadata && typeof pendingEntry.metadata === 'object' ? pendingEntry.metadata : {}),
          lastReviewStatus: 'deferred',
          lastReviewAt: deferredReceipt.committedAt,
          deferredFields: affected ? [...affected.keys()] : [],
        };
        deferredPendingReviewIds.push(resolution.id);
      }
    }

    // Minimal Atomic Bookkeeping Hooks (Item 12, Task 9)
    if (!workingState.dedup) {
      workingState.dedup = { processedSourceKeys: [] };
    }
    if (Array.isArray(dedupKeys)) {
      for (const key of dedupKeys) {
        if (typeof key === 'string' && key.trim() !== '') {
          if (!workingState.dedup.processedSourceKeys.includes(key)) {
            workingState.dedup.processedSourceKeys.push(key);
          }
        }
      }
    }

    if (!workingState.pendingReview) {
      workingState.pendingReview = { entries: [] };
    }
    for (const entry of resolvedPendingEntries) {
      workingState.pendingReview.entries.push(entry);
    }

    // 9. Compute nextRevision and update workingState before checkpoint creation (C10, C11)
    const nextRevision = currentRevision + 1;
    workingState.revision = nextRevision;

    const checkpoint = createCheckpoint(workingState, {
      sourceDependencies,
      writer,
      mode: operationMode,
      description: `Committed ${appliedSummary.length} NPC update(s) via ${writer}`,
    });

    // 10. Atomic persistence to storage via CAS
    // If concurrent write occurred, save will return conflict and NOT mutate storage
    const saveResult = await this.storage.save(workingState, currentRevision);
    if (!saveResult.success) {
      // Persistence failure: no success receipt or checkpoint advertised (C10)
      return {
        success: false,
        conflict: Boolean(saveResult.conflict),
        error: saveResult.error || 'Storage CAS persistence failure.',
      };
    }

    return {
      success: true,
      commitRevision: saveResult.revision,
      checkpointId: checkpoint.id,
      applied: appliedSummary,
      deferred: deferredProposals,
      observationIds: persistedObservations.map((o) => o.id),
      assignedNpcs: idResolution.assignedNpcs,
      resolvedPendingReviewIds,
      deferredPendingReviewIds,
    };
  }

  /**
   * Commits a validated S1 wire envelope (one-pass or development) directly.
   * Seamlessly bridges S1 validated envelopes with the S2 commit coordinator.
   *
   * @param {object} params
   * @param {string} params.writer 'one_pass' | 'development'
   * @param {object} params.envelope Validated S1 envelope
   * @param {object} [params.exchangeContext]
   * @param {object} [params.readFieldRevisions]
   * @param {object} [params.readFieldDependencies]
   * @param {number} [params.expectedRevision]
   * @param {Array<object>} [params.reviewReceipts]
   * @param {Array<string>} [params.dedupKeys]
   * @param {Array<object>} [params.pendingReviewEntries]
   * @param {Array<object>} [params.pendingReviewResolutions]
   * @returns {Promise<object>}
   */
  async commitValidatedEnvelope({
    writer,
    envelope,
    exchangeContext,
    capturedDependencies,
    readFieldRevisions,
    readFieldDependencies,
    expectedRevision,
    reviewReceipts = [],
    dedupKeys = [],
    pendingReviewEntries = [],
    pendingReviewResolutions = [],
  }) {
    if (!envelope || typeof envelope !== 'object') {
      return { success: false, error: 'Envelope must be an object.' };
    }

    // 1. Authoritative S1 Validators at Bridge (Item 2)
    if (writer === WRITERS.ONE_PASS) {
      const val = validateOnePassEnvelope(envelope);
      if (!val.valid) {
        return {
          success: false,
          error: `One-Pass envelope validation failed: ${val.errors.map((e) => e.errorMessage || e).join('; ')}`,
          errors: val.errors,
        };
      }
    } else if (writer === WRITERS.DEVELOPMENT) {
      const val = validateDevelopmentEnvelope(envelope);
      if (!val.valid) {
        return {
          success: false,
          error: `Development envelope validation failed: ${val.errors.map((e) => e.errorMessage || e).join('; ')}`,
          errors: val.errors,
        };
      }
    } else {
      return {
        success: false,
        error: `Unsupported writer '${writer}' in commitValidatedEnvelope. Expected '${WRITERS.ONE_PASS}' or '${WRITERS.DEVELOPMENT}'.`,
      };
    }

    // 2. Normalize accepted receipt aliases and extract receipt scope references (Tasks 2 & 3)
    const receipts =
      reviewReceipts && reviewReceipts.length > 0
        ? reviewReceipts
        : (envelope.reviewReceipts || envelope.targetAcknowledgments || []);

    const receiptScopeRefs = new Set();
    for (const r of receipts) {
      if (Array.isArray(r.sourceScope)) {
        for (const s of r.sourceScope) {
          if (typeof s === 'string' && s.trim() !== '') {
            receiptScopeRefs.add(s);
          }
        }
      }
    }

    // 3. Extract concrete source references across entire envelope
    const concreteSources = extractConcreteSourceReferences(envelope);

    // 4. Provenance Context & Pre-captured Dependencies Requirement (Tasks 1 & 2)
    const hasEvidence = concreteSources.length > 0 || receiptScopeRefs.size > 0;
    if (hasEvidence) {
      if (!exchangeContext && (!capturedDependencies || capturedDependencies.length === 0)) {
        return {
          success: false,
          error: 'Evidence-bearing mutations or review receipts require exchangeContext or pre-captured source dependencies; provenance context required.',
          errorCode: 'provenance_context_required',
        };
      }
    }

    // Validate all caller-supplied pre-captured dependencies (Task 1)
    if (capturedDependencies && Array.isArray(capturedDependencies)) {
      for (let dIdx = 0; dIdx < capturedDependencies.length; dIdx++) {
        const dep = capturedDependencies[dIdx];
        const val = validateCapturedSourceDependency(dep);
        if (!val.valid) {
          return {
            success: false,
            error: `Invalid pre-captured dependency at index ${dIdx}: ${val.error}`,
            errorCode: 'invalid_captured_dependency',
          };
        }
      }
    }

    // Check pre-captured dependencies coverage if no exchangeContext provided (Tasks 1 & 2)
    if (!exchangeContext && capturedDependencies && capturedDependencies.length > 0) {
      for (const cs of concreteSources) {
        const csKind = cs.ref.segmentKind || 'narrative';
        const covered = capturedDependencies.some((d) => {
          if (d.sourceRef !== cs.ref.sourceRef) return false;
          const dKind = d.segmentKind || 'narrative';
          if (dKind !== csKind) return false;
          const csTarget = cs.targetField || null;
          const dTarget = d.targetField || null;
          // Generic captured dependencies (null/omitted targetField) cover a
          // concrete source with the same exact sourceRef/excerpt/segmentKind.
          // If caller captured a specific field, it remains field-bound.
          if (dTarget !== null && csTarget !== dTarget) return false;
          if (d.excerpt !== cs.ref.excerpt) return false;
          return true;
        });
        if (!covered) {
          return {
            success: false,
            error: `Concrete source reference '${cs.ref.sourceRef}' is not covered by pre-captured dependencies with matching excerpt, segmentKind, and targetField.`,
            errorCode: 'provenance_context_required',
          };
        }
      }

      for (const sRef of receiptScopeRefs) {
        const covered = capturedDependencies.some((d) => d.sourceRef === sRef && d.capturedProvenance);
        if (!covered) {
          return {
            success: false,
            error: `Receipt sourceScope reference '${sRef}' is not covered by pre-captured dependencies and exchangeContext was not provided.`,
            errorCode: 'provenance_context_required',
          };
        }
      }
    }

    // If both capturedDependencies and exchangeContext are provided, revalidate capturedDependencies (Task 1)
    if (exchangeContext && capturedDependencies && capturedDependencies.length > 0) {
      for (const dep of capturedDependencies) {
        const reval = revalidateSourceDependency(dep, exchangeContext);
        if (!reval.valid) {
          return {
            success: false,
            conflict: true,
            conflictType: 'source_lineage_conflict',
            error: `Pre-captured dependency revalidation failed: ${reval.error}`,
            errorCode: reval.errorCode || 'source_lineage_conflict',
          };
        }
      }
    }

    // 5. Capture / assemble source dependencies & index verified dependencies (Tasks 1, 2, 6)
    const sourceDependencies = [];
    const verifiedDepsByRef = new Map();

    function registerVerifiedDep(dep) {
      sourceDependencies.push(dep);
      if (!verifiedDepsByRef.has(dep.sourceRef)) {
        verifiedDepsByRef.set(dep.sourceRef, []);
      }
      verifiedDepsByRef.get(dep.sourceRef).push(dep);
    }

    if (exchangeContext) {
      for (const item of concreteSources) {
        const captureRes = captureSourceDependency(item.ref, exchangeContext, {
          writer,
          targetField: item.targetField,
        });
        if (!captureRes.valid) {
          return {
            success: false,
            conflict: true,
            conflictType: 'source_lineage_conflict',
            error: `Failed to capture/resolve source provenance: ${captureRes.error}`,
            errorCode: captureRes.errorCode || 'source_lineage_conflict',
          };
        }
        registerVerifiedDep(captureRes.capturedDependency);
      }

      for (const sRef of receiptScopeRefs) {
        const scopeRes = captureScopeDependency(sRef, exchangeContext, { writer });
        if (!scopeRes.valid) {
          return {
            success: false,
            conflict: true,
            conflictType: 'source_lineage_conflict',
            error: `Failed to capture/resolve receipt sourceScope '${sRef}': ${scopeRes.error}`,
            errorCode: scopeRes.errorCode || 'source_lineage_conflict',
          };
        }
        registerVerifiedDep(scopeRes.capturedDependency);
      }

      if (capturedDependencies && Array.isArray(capturedDependencies)) {
        for (const dep of capturedDependencies) {
          const already = sourceDependencies.some(
            (d) =>
              d.sourceRef === dep.sourceRef &&
              d.segmentKind === dep.segmentKind &&
              d.capturedProvenance?.contentFingerprint === dep.capturedProvenance?.contentFingerprint
          );
          if (!already) {
            registerVerifiedDep(dep);
          }
        }
      }
    } else if (capturedDependencies && Array.isArray(capturedDependencies)) {
      for (const dep of capturedDependencies) {
        registerVerifiedDep(dep);
      }
    }

    // 6. Verify supportProposals.sourceRefs against verified dependencies with mechanical permissions (Task 6)
    if (Array.isArray(envelope.supportProposals)) {
      for (const sp of envelope.supportProposals) {
        if (Array.isArray(sp.sourceRefs)) {
          for (const sr of sp.sourceRefs) {
            if (typeof sr !== 'string' || sr.trim() === '') {
              return {
                success: false,
                error: 'Support proposal sourceRef must be a non-empty string.',
                errorCode: 'invalid_source_ref',
              };
            }
            const matchingDeps = verifiedDepsByRef.get(sr);
            if (!matchingDeps || matchingDeps.length === 0) {
              return {
                success: false,
                error: `Support proposal sourceRef '${sr}' is unverified; must correspond to a concrete SourceReference in envelope or pre-captured dependencies.`,
                errorCode: 'orphan_source_reference',
              };
            }
            const anyPermitted = matchingDeps.some((d) => {
              const pVal = validateSegmentFieldPermission(
                { sourceRef: sr, segmentKind: d.segmentKind || 'narrative' },
                sp.field
              );
              return pVal.valid;
            });
            if (!anyPermitted) {
              return {
                success: false,
                error: `Support proposal sourceRef '${sr}' has segment kind not permitted for durable field '${sp.field}'.`,
                errorCode: 'segment_permission_violation',
              };
            }
          }
        }
      }
    }

    // 6. Identity and field proposals extraction
    const identityProposals = [];
    const fieldProposals = {};

    if (Array.isArray(envelope.proposals)) {
      for (const p of envelope.proposals) {
        const isNew = p.id == null && Boolean(p.localRef);
        const existingId = p.id || p.targetId;

        if (isNew) {
          identityProposals.push({
            localRef: p.localRef,
            name: p.name,
            identityKind: p.identityKind || 'named',
            aliases: p.aliases,
          });
        } else if (existingId) {
          identityProposals.push({ id: existingId });
        }

        const key = isNew ? p.localRef : existingId;
        if (key) {
          const fields = {};

          for (const [k, v] of Object.entries(p)) {
            if (k === 'id' || k === 'targetId' || k === 'localRef') {
              continue; // Handled by identity
            }
            if (k === 'evidence' || k === 'source' || k === 'presenceSource') {
              continue; // Provenance metadata
            }

            if (k === 'name' || k === 'aliases') {
              if (existingId) {
                fields[k] = v;
              }
              continue;
            }

            if (k === 'lifecycle') {
              if (v && typeof v === 'object' && v.lifeState) {
                fields.lifeState = v.lifeState;
              } else if (typeof v === 'string') {
                fields.lifeState = v;
              }
              continue;
            }

            if (k === 'facts') {
              if (v && typeof v === 'object') {
                const factsOp = v.operation || 'update';
                for (const [factKey, factVal] of Object.entries(v)) {
                  if (factKey === 'source' || factKey === 'operation' || factKey === 'evidence') continue;
                  // Item E: facts.operation applies to each supplied canonical fact subfield
                  if (factsOp === 'remove') {
                    // remove clears each supplied field
                    fields[factKey] = { value: null, operation: 'remove' };
                  } else if (typeof factVal === 'object' && factVal !== null && factVal.value !== undefined) {
                    // Already has value wrapper with operation
                    const factItemOp = factVal.operation || factsOp;
                    const clean = { value: factVal.value, operation: factItemOp };
                    fields[factKey] = clean;
                  } else {
                    fields[factKey] = factVal;
                  }
                }
              }
              continue;
            }

            if (k === 'personality') {
              if (v && typeof v === 'object' && !Array.isArray(v)) {
                const op = v.operation || 'update';
                // Item E: personality operation remove clears to null; other ops set normalized content
                if (op === 'remove') {
                  fields.personality = { value: null, operation: 'remove' };
                } else {
                  const clean = {};
                  if (v.traits !== undefined) {
                    clean.traits = Array.isArray(v.traits) ? [...v.traits] : v.traits;
                  }
                  if (v.value !== undefined) {
                    clean.value = v.value;
                  }
                  if (clean.traits === undefined && clean.value === undefined) {
                    for (const [pk, pv] of Object.entries(v)) {
                      if (pk !== 'source' && pk !== 'operation' && pk !== 'evidence') {
                        clean[pk] = pv;
                      }
                    }
                  }
                  fields.personality = clean;
                }
              } else {
                fields.personality = v;
              }
              continue;
            }

            // Item E: preserve operation transiently for scalar durable fields
            if (v && typeof v === 'object' && !Array.isArray(v) && !CANONICAL_FIELDS[k]?.isCollection) {
              const op = v.operation;
              if (op === 'remove') {
                // remove clears canonical field to null
                fields[k] = { value: null, operation: 'remove' };
              } else if (op && v.value !== undefined) {
                // establish/refine/replace/update/enrich with explicit value - set proposed value
                fields[k] = { value: v.value, operation: op };
              } else {
                // No explicit operation or no value wrapper - strip wire metadata only
                const clean = { ...v };
                delete clean.source;
                delete clean.evidence;
                if (!op) delete clean.operation;
                fields[k] = clean;
              }
            } else {
              fields[k] = v;
            }
          }

          fieldProposals[key] = fields;
        }
      }
    }

    const observations = envelope.observations || [];
    const supportProposals = envelope.supportProposals || [];
    const acceptedSupport = envelope.acceptedSupport || [];

    return this.commit({
      writer,
      expectedRevision,
      readFieldRevisions,
      readFieldDependencies,
      identityProposals,
      fieldProposals,
      observations,
      supportProposals,
      acceptedSupport,
      reviewReceipts: receipts,
      sourceDependencies,
      dedupKeys,
      pendingReviewEntries,
      pendingReviewResolutions,
      exchangeContext,
      operationMode: writer,
    });
  }
}
