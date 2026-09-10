import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALPHA_NAMESPACE,
  ALPHA_SCHEMA_VERSION,
  createInitialState,
  createDefaultNpcRecord,
  validateState,
  cloneState,
} from '../src/state/schema.js';
import {
  MemoryStorageAdapter,
  StoragePersistenceError,
} from '../src/state/storage.js';
import {
  WRITERS,
} from '../src/contract/registry.js';
import {
  createCheckpoint,
  validateCheckpoint,
} from '../src/state/checkpoints.js';

test('State/Storage: initial state structure and schema invariants', () => {
  const state = createInitialState();
  assert.equal(state.namespace, ALPHA_NAMESPACE);
  assert.equal(state.schemaVersion, ALPHA_SCHEMA_VERSION);
  assert.equal(state.revision, 0);
  assert.deepEqual(state.npcs, {});
  assert.deepEqual(state.tombstones, {});
  assert.deepEqual(state.dedup.processedSourceKeys, []);
  assert.deepEqual(state.pendingReview.entries, []);
  assert.deepEqual(state.history.checkpoints, []);

  const val = validateState(state);
  assert.equal(val.valid, true, val.errors.join('; '));
});

test('State/Storage: explicit namespace and schema version isolation', () => {
  const invalidNamespace = createInitialState();
  invalidNamespace.namespace = 'npc_state_beta.v0';
  const val1 = validateState(invalidNamespace);
  assert.equal(val1.valid, false);
  assert.match(val1.errors[0], /Invalid namespace/);

  const invalidVersion = createInitialState();
  invalidVersion.schemaVersion = 99;
  const val2 = validateState(invalidVersion);
  assert.equal(val2.valid, false);
  assert.match(val2.errors[0], /Invalid schemaVersion/);
});

test('State/Storage: round trip in MemoryStorageAdapter', async () => {
  const adapter = new MemoryStorageAdapter();
  const initial = await adapter.load();
  assert.equal(initial.revision, 0);
  assert.equal(initial.state.namespace, ALPHA_NAMESPACE);

  const modified = cloneState(initial.state);
  const npc = createDefaultNpcRecord('npc_001', 'Elena');
  modified.npcs.npc_001 = npc;

  const saveRes = await adapter.save(modified, 0);
  assert.equal(saveRes.success, true);
  assert.equal(saveRes.revision, 1);

  const reloaded = await adapter.load();
  assert.equal(reloaded.revision, 1);
  assert.equal(reloaded.state.npcs.npc_001.name, 'Elena');
  assert.equal(reloaded.state.npcs.npc_001.id, 'npc_001');
});

test('State/Storage: CAS success and conflict behavior', async () => {
  const adapter = new MemoryStorageAdapter();
  const { state, revision } = await adapter.load();
  assert.equal(revision, 0);

  const stateA = cloneState(state);
  stateA.npcs.npc_a = createDefaultNpcRecord('npc_a', 'Alice');

  const stateB = cloneState(state);
  stateB.npcs.npc_b = createDefaultNpcRecord('npc_b', 'Bob');

  // First writer succeeds with expectedRevision 0
  const saveA = await adapter.save(stateA, 0);
  assert.equal(saveA.success, true);
  assert.equal(saveA.revision, 1);

  // Second writer attempts save with stale expectedRevision 0 -> conflict
  const saveB = await adapter.save(stateB, 0);
  assert.equal(saveB.success, false);
  assert.equal(saveB.conflict, true);
  assert.equal(saveB.currentRevision, 1);

  // Verify storage retains stateA and did not overwrite with stateB
  const current = await adapter.load();
  assert.equal(current.revision, 1);
  assert.ok(current.state.npcs.npc_a);
  assert.equal(current.state.npcs.npc_b, undefined);
});

test('State/Storage: persistence failure produces no false success receipt or state update', async () => {
  const adapter = new MemoryStorageAdapter();
  const { state } = await adapter.load();

  const nextState = cloneState(state);
  nextState.npcs.npc_fail = createDefaultNpcRecord('npc_fail', 'Failing');

  adapter.setFailNextSave(true);
  const saveRes = await adapter.save(nextState, 0);
  assert.equal(saveRes.success, false);
  assert.match(saveRes.error, /persistence failure/i);

  // State in storage remains unchanged at revision 0
  const check = await adapter.load();
  assert.equal(check.revision, 0);
  assert.equal(check.state.npcs.npc_fail, undefined);
});

test('State/Storage: malformed and incompatible stored state fails safely', async () => {
  const adapter = new MemoryStorageAdapter();
  adapter._corruptStateForTesting({
    namespace: 'incompatible_namespace',
    schemaVersion: 1,
    revision: 0,
  });

  await assert.rejects(async () => {
    await adapter.load();
  }, /namespace isolation error/);

  adapter._corruptStateForTesting({
    namespace: ALPHA_NAMESPACE,
    schemaVersion: 999,
    revision: 0,
  });

  await assert.rejects(async () => {
    await adapter.load();
  }, /schemaVersion mismatch/);

  // Corrupted state matching namespace and version fails full schema validation on load()
  adapter._corruptStateForTesting({
    namespace: ALPHA_NAMESPACE,
    schemaVersion: ALPHA_SCHEMA_VERSION,
    revision: 0,
    npcs: 'corrupted_non_object',
    tombstones: {},
    dedup: { processedSourceKeys: [] },
    pendingReview: { entries: [] },
    history: { checkpoints: [] },
  });

  await assert.rejects(async () => {
    await adapter.load();
  }, /Storage state corruption detected/);
});

test('State/Storage (Item G Schema Hardening): validates fieldRevisions, locks, manualCorrections, relationship, tombstones, dedup', () => {
  const baseState = createInitialState();
  const npc = createDefaultNpcRecord('npc_test', 'Test NPC');
  baseState.npcs.npc_test = npc;

  // 1. Valid state passes
  assert.equal(validateState(baseState).valid, true);

  // 2. fieldRevisions non-positive or non-integer is rejected
  const badRevState = cloneState(baseState);
  badRevState.npcs.npc_test.fieldRevisions.mood = 0;
  assert.equal(validateState(badRevState).valid, false);
  assert.match(validateState(badRevState).errors[0], /fieldRevisions\['mood'\] must be a positive integer/);

  badRevState.npcs.npc_test.fieldRevisions.mood = -5;
  assert.equal(validateState(badRevState).valid, false);

  badRevState.npcs.npc_test.fieldRevisions.mood = 'not_a_number';
  assert.equal(validateState(badRevState).valid, false);

  // 3. locks must be booleans
  const badLockState = cloneState(baseState);
  badLockState.npcs.npc_test.locks = { mood: 'yes' };
  assert.equal(validateState(badLockState).valid, false);
  assert.match(validateState(badLockState).errors[0], /locks\['mood'\] must be a boolean/);

  // 4. manualCorrections must be structured objects with correctedAt and writer
  const badCorrState = cloneState(baseState);
  badCorrState.npcs.npc_test.manualCorrections = { mood: 'invalid' };
  assert.equal(validateState(badCorrState).valid, false);
  assert.match(validateState(badCorrState).errors[0], /manualCorrections\['mood'\] must be an object/);

  badCorrState.npcs.npc_test.manualCorrections = { mood: { correctedAt: '' } };
  assert.equal(validateState(badCorrState).valid, false);
  assert.match(validateState(badCorrState).errors[0], /requires non-empty string 'correctedAt'/);

  badCorrState.npcs.npc_test.manualCorrections = { mood: { correctedAt: '2026-09-10', writer: '' } };
  assert.equal(validateState(badCorrState).valid, false);
  assert.match(validateState(badCorrState).errors[0], /requires non-empty string 'writer'/);

  // 5. relationship axes must be finite numbers
  const badRelState = cloneState(baseState);
  badRelState.npcs.npc_test.relationship.trust = NaN;
  assert.equal(validateState(badRelState).valid, false);
  assert.match(validateState(badRelState).errors[0], /relationship\['trust'\] must be a finite number/);

  badRelState.npcs.npc_test.relationship.trust = Infinity;
  assert.equal(validateState(badRelState).valid, false);

  // 6. tombstones must have non-empty deletedAt and reason
  const badTombState = cloneState(baseState);
  badTombState.tombstones = { npc_old: { deletedAt: '', reason: 'perished' } };
  assert.equal(validateState(badTombState).valid, false);
  assert.match(validateState(badTombState).errors[0], /requires non-empty string 'deletedAt'/);

  badTombState.tombstones = { npc_old: { deletedAt: '2026-09-10', reason: '' } };
  assert.equal(validateState(badTombState).valid, false);
  assert.match(validateState(badTombState).errors[0], /requires non-empty string 'reason'/);

  // 7. dedup.processedSourceKeys must be array of non-empty strings
  const badDedupState = cloneState(baseState);
  badDedupState.dedup.processedSourceKeys = ['msg_1', ''];
  assert.equal(validateState(badDedupState).valid, false);
  assert.match(validateState(badDedupState).errors[0], /dedup\.processedSourceKeys\[1\] must be a non-empty string/);
});

test('State/Storage (Item 10 Schema Hardening): rejects unknown keys, unauthorized writers, active/tombstone collisions, invalid canonical field types, and malformed reviewReceipts', () => {
  const baseState = createInitialState();
  const npc = createDefaultNpcRecord('npc_elena', 'Elena');
  baseState.npcs.npc_elena = npc;

  // 1. Unknown key in fieldRevisions
  const badRevKey = cloneState(baseState);
  badRevKey.npcs.npc_elena.fieldRevisions.unknown_field = 1;
  const resBadRev = validateState(badRevKey);
  assert.equal(resBadRev.valid, false);
  assert.match(resBadRev.errors[0], /fieldRevisions contains unknown canonical field 'unknown_field'/);

  // 2. Unknown key in locks
  const badLockKey = cloneState(baseState);
  badLockKey.npcs.npc_elena.locks.unknown_lock = true;
  const resBadLock = validateState(badLockKey);
  assert.equal(resBadLock.valid, false);
  assert.match(resBadLock.errors[0], /locks contains unknown canonical field 'unknown_lock'/);

  // 3. Unknown key in manualCorrections
  const badCorrKey = cloneState(baseState);
  badCorrKey.npcs.npc_elena.manualCorrections.unknown_corr = {
    correctedAt: '2026-09-10T00:00:00Z',
    writer: WRITERS.USER,
  };
  const resBadCorr = validateState(badCorrKey);
  assert.equal(resBadCorr.valid, false);
  assert.match(resBadCorr.errors[0], /manualCorrections contains unknown canonical field 'unknown_corr'/);

  // 4. Unauthorized writer in manualCorrections (only USER or RUNTIME allowed)
  const badCorrWriter = cloneState(baseState);
  badCorrWriter.npcs.npc_elena.manualCorrections.mood = {
    correctedAt: '2026-09-10T00:00:00Z',
    writer: WRITERS.ONE_PASS, // Invalid!
  };
  const resBadCorrWriter = validateState(badCorrWriter);
  assert.equal(resBadCorrWriter.valid, false);
  assert.match(resBadCorrWriter.errors[0], /Allowed: user, runtime/);

  // 5. Active NPC + tombstone overlap collision rejected
  const badOverlapState = cloneState(baseState);
  badOverlapState.tombstones.npc_elena = {
    deletedAt: '2026-09-10T00:00:00Z',
    reason: 'perished',
  };
  const resBadOverlap = validateState(badOverlapState);
  assert.equal(resBadOverlap.valid, false);
  assert.match(resBadOverlap.errors[0], /cannot exist simultaneously in active state\.npcs and state\.tombstones/);

  // 6. Unknown relationship axis rejected
  const badRelAxis = cloneState(baseState);
  badRelAxis.npcs.npc_elena.relationship.unknownAxis = 5;
  const resBadAxis = validateState(badRelAxis);
  assert.equal(resBadAxis.valid, false);
  assert.match(resBadAxis.errors[0], /relationship contains unknown axis or key 'unknownAxis'/);

  // 7. Invalid lastEvaluationExchange rejected
  const badLastEval = cloneState(baseState);
  badLastEval.npcs.npc_elena.relationship.lastEvaluationExchange = true; // Must be null, string, or non-negative int
  const resBadLastEval = validateState(badLastEval);
  assert.equal(resBadLastEval.valid, false);
  assert.match(resBadLastEval.errors[0], /lastEvaluationExchange must be null, a string, or a non-negative integer/);

  // 8. Canonical stored field type validations:
  // name must be non-empty string
  const badName = cloneState(baseState);
  badName.npcs.npc_elena.name = '';
  assert.equal(validateState(badName).valid, false);

  // aliases must be array of strings
  const badAliases = cloneState(baseState);
  badAliases.npcs.npc_elena.aliases = ['Valid', 123];
  assert.equal(validateState(badAliases).valid, false);

  // present must be boolean
  const badPresent = cloneState(baseState);
  badPresent.npcs.npc_elena.present = 'yes';
  assert.equal(validateState(badPresent).valid, false);

  // activeInExchange must be boolean
  const badActive = cloneState(baseState);
  badActive.npcs.npc_elena.activeInExchange = 1;
  assert.equal(validateState(badActive).valid, false);

  // currentForm must be null or string
  const badCurrForm = cloneState(baseState);
  badCurrForm.npcs.npc_elena.currentForm = 42;
  assert.equal(validateState(badCurrForm).valid, false);

  // appearanceForms must be array
  const badAppForms = cloneState(baseState);
  badAppForms.npcs.npc_elena.appearanceForms = 'not_an_array';
  assert.equal(validateState(badAppForms).valid, false);

  // importantMemories must be array
  const badMemories = cloneState(baseState);
  badMemories.npcs.npc_elena.importantMemories = 'not_an_array';
  assert.equal(validateState(badMemories).valid, false);

  // nonPlayerRelationships must be array
  const badNpr = cloneState(baseState);
  badNpr.npcs.npc_elena.nonPlayerRelationships = 'not_an_array';
  assert.equal(validateState(badNpr).valid, false);

  // 9. Persisted reviewReceipts shape validation:
  const badReceiptKeys = cloneState(baseState);
  badReceiptKeys.npcs.npc_elena.development.reviewReceipts = [
    { targetId: 'npc_elena', status: 'reviewed', sourceScope: ['msg:1'], committedAt: '2026-09-10', forbiddenKey: true },
  ];
  assert.equal(validateState(badReceiptKeys).valid, false);
  assert.match(validateState(badReceiptKeys).errors[0], /reviewReceipts\[0\] contains unknown key 'forbiddenKey'/);

  const badReceiptStatus = cloneState(baseState);
  badReceiptStatus.npcs.npc_elena.development.reviewReceipts = [
    { targetId: 'npc_elena', status: 'invalid_status', sourceScope: ['msg:1'], committedAt: '2026-09-10' },
  ];
  assert.equal(validateState(badReceiptStatus).valid, false);
  assert.match(validateState(badReceiptStatus).errors[0], /invalid status/);
});

test('State/Storage (Task 6): persisted collection schemas reject wire metadata and enforce identity preconditions', () => {
  const baseState = createInitialState();
  baseState.npcs.npc_elena = createDefaultNpcRecord('npc_elena', 'Elena');

  // appearanceForms item without formId or with wire metadata
  const badAppForm1 = cloneState(baseState);
  badAppForm1.npcs.npc_elena.appearanceForms = [{ name: 'Wolf' }]; // Missing formId
  assert.equal(validateState(badAppForm1).valid, false);
  assert.match(validateState(badAppForm1).errors[0], /requires non-empty string 'formId'/);

  const badAppForm2 = cloneState(baseState);
  badAppForm2.npcs.npc_elena.appearanceForms = [{ formId: 'form_1', name: 'Wolf', localFormRef: 'f_ref' }]; // Wire metadata!
  assert.equal(validateState(badAppForm2).valid, false);
  assert.match(validateState(badAppForm2).errors[0], /'localFormRef'/);

  // mannerisms with wire metadata
  const badMannerism = cloneState(baseState);
  badMannerism.npcs.npc_elena.mannerisms = [{ value: 'Taps fingers', source: { sourceRef: 'msg:1' } }];
  assert.equal(validateState(badMannerism).valid, false);
  assert.match(validateState(badMannerism).errors[0], /forbidden wire metadata/);

  // personality as string (must be object with traits or value)
  const badPersString = cloneState(baseState);
  badPersString.npcs.npc_elena.personality = 'curious and stoic';
  assert.equal(validateState(badPersString).valid, false);
  assert.match(validateState(badPersString).errors[0], /must be an object or null/);

  // importantMemories item without memoryId or text/summary
  const badMem1 = cloneState(baseState);
  badMem1.npcs.npc_elena.importantMemories = [{ text: 'Saved the kingdom' }]; // Missing memoryId
  assert.equal(validateState(badMem1).valid, false);
  assert.match(validateState(badMem1).errors[0], /requires non-empty string 'memoryId'/);

  const badMem2 = cloneState(baseState);
  badMem2.npcs.npc_elena.importantMemories = [{ memoryId: 'mem_1' }]; // Missing text/summary
  assert.equal(validateState(badMem2).valid, false);
  assert.match(validateState(badMem2).errors[0], /requires non-empty string 'text' or 'summary'/);

  // nonPlayerRelationships item without relationId or targetId or description
  const badNpr1 = cloneState(baseState);
  badNpr1.npcs.npc_elena.nonPlayerRelationships = [{ targetId: 'npc_2', relationKind: 'friend' }]; // Missing relationId
  assert.equal(validateState(badNpr1).valid, false);
  assert.match(validateState(badNpr1).errors[0], /requires non-empty string 'relationId'/);

  const badNpr2 = cloneState(baseState);
  badNpr2.npcs.npc_elena.nonPlayerRelationships = [{ relationId: 'rel_1', relationKind: 'friend' }]; // Missing targetId
  assert.equal(validateState(badNpr2).valid, false);
  assert.match(validateState(badNpr2).errors[0], /requires non-empty string 'targetId'/);

  const badNpr3 = cloneState(baseState);
  badNpr3.npcs.npc_elena.nonPlayerRelationships = [{ relationId: 'rel_1', targetId: 'npc_2' }]; // Missing description
  assert.equal(validateState(badNpr3).valid, false);
  assert.match(validateState(badNpr3).errors[0], /requires non-empty 'relationship'/);
});

test('State/Storage (Task 10): rejects unknown root keys and unknown NPC record keys, requires complete fieldRevisions', () => {
  const baseState = createInitialState();
  baseState.npcs.npc_elena = createDefaultNpcRecord('npc_elena', 'Elena');

  // Unknown root key
  const badRoot = cloneState(baseState);
  badRoot.unknownRootKey = 123;
  assert.equal(validateState(badRoot).valid, false);
  assert.match(validateState(badRoot).errors[0], /unknown key 'unknownRootKey'/i);

  // Unknown NPC record key
  const badNpcKey = cloneState(baseState);
  badNpcKey.npcs.npc_elena.extraNpcField = 'disallowed';
  assert.equal(validateState(badNpcKey).valid, false);
  assert.match(validateState(badNpcKey).errors[0], /unknown top-level key 'extraNpcField'/);

  // Missing a canonical field revision
  const missingFieldRev = cloneState(baseState);
  delete missingFieldRev.npcs.npc_elena.fieldRevisions.mood;
  assert.equal(validateState(missingFieldRev).valid, false);
  assert.match(validateState(missingFieldRev).errors[0], /missing canonical field 'mood'/);

  // Extra field revision
  const extraFieldRev = cloneState(baseState);
  extraFieldRev.npcs.npc_elena.fieldRevisions.bogusField = 1;
  assert.equal(validateState(extraFieldRev).valid, false);
  assert.match(validateState(extraFieldRev).errors[0], /unknown canonical field 'bogusField'/);
});

test('State/Storage (Task 11): createCheckpoint projects compact dependencies omitting raw excerpt and validateCheckpoint enforces compactness', () => {
  const baseState = createInitialState();
  baseState.npcs.npc_elena = createDefaultNpcRecord('npc_elena', 'Elena');

  // Source dependency with raw excerpt
  const rawDep = {
    sourceRef: 'msg:1',
    excerpt: 'this is a long raw excerpt that should be omitted in compact checkpoint',
    capturedProvenance: {
      chatId: 'chat_01',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:fp1',
      precedingLineage: ['sha256:root'],
    },
  };

  const checkpoint = createCheckpoint(baseState, {
    sourceDependencies: [rawDep],
    writer: WRITERS.ONE_PASS,
  });

  // Verify checkpoint.sourceDependencies has NO excerpt
  assert.equal(checkpoint.sourceDependencies.length, 1);
  assert.equal(checkpoint.sourceDependencies[0].excerpt, undefined);
  assert.equal(checkpoint.sourceDependencies[0].sourceRef, 'msg:1');
  assert.ok(checkpoint.sourceDependencies[0].capturedProvenance);

  // validateCheckpoint passes for this compact checkpoint
  const chkVal = validateCheckpoint(checkpoint);
  assert.equal(chkVal.valid, true, chkVal.errors?.join('; '));

  // If a checkpoint dependency manually includes raw excerpt, validateCheckpoint rejects it
  checkpoint.sourceDependencies[0].excerpt = 'raw excerpt';
  const badChkVal = validateCheckpoint(checkpoint);
  assert.equal(badChkVal.valid, false);
  assert.match(badChkVal.errors[0], /raw excerpt/);
});


