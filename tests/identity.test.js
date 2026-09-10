import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveIdentityBatch,
  ADMISSION_POLICIES,
  generateStableNpcId,
  resetNpcIdCounterForTesting,
} from '../src/runtime/identity.js';
import {
  createInitialState,
  createDefaultNpcRecord,
} from '../src/state/schema.js';

test('Identity: existing ID lookup succeeds and retrieves NPC', () => {
  const state = createInitialState();
  state.npcs.npc_existing_01 = createDefaultNpcRecord('npc_existing_01', 'Garrick');

  const proposals = [{ id: 'npc_existing_01' }];
  const res = resolveIdentityBatch(proposals, state);
  assert.equal(res.valid, true);
  const resolved = res.resolvedMap.get('npc_existing_01');
  assert.equal(resolved.isNew, false);
  assert.equal(resolved.assignedId, 'npc_existing_01');
  assert.equal(resolved.name, 'Garrick');
});

test('Identity: one and multiple NEW localRef candidates resolved with stable IDs', () => {
  resetNpcIdCounterForTesting();
  const state = createInitialState();

  const proposals = [
    { localRef: 'new_npc_1', name: 'Kael', identityKind: 'named' },
    { localRef: 'new_npc_2', name: 'Lyra', identityKind: 'named' },
  ];

  const res = resolveIdentityBatch(proposals, state);
  assert.equal(res.valid, true, res.errors?.join('; '));
  assert.equal(res.assignedNpcs.length, 2);

  const kael = res.resolvedMap.get('new_npc_1');
  assert.equal(kael.isNew, true);
  assert.equal(kael.name, 'Kael');
  assert.match(kael.assignedId, /^npc_\d+_\d+$/);

  const lyra = res.resolvedMap.get('new_npc_2');
  assert.equal(lyra.isNew, true);
  assert.equal(lyra.name, 'Lyra');
  assert.notEqual(kael.assignedId, lyra.assignedId);
});

test('Identity: failed admission causes atomic dependent failure (no partial resolution)', () => {
  const state = createInitialState();
  state.npcs.npc_valid = createDefaultNpcRecord('npc_valid', 'Valid NPC');

  const proposals = [
    { id: 'npc_valid' },
    { id: 'npc_non_existent' }, // Should fail
    { localRef: 'new_candidate', name: 'Candidate' },
  ];

  const res = resolveIdentityBatch(proposals, state);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /Target NPC ID 'npc_non_existent' not found/);
  // Entire batch failed
  assert.equal(res.assignedNpcs, undefined);
});

test('Identity: duplicate localRef in same transaction fails without array-order fallback', () => {
  const state = createInitialState();
  const proposals = [
    { localRef: 'duplicate_ref', name: 'First Candidate' },
    { localRef: 'duplicate_ref', name: 'Second Candidate' },
  ];

  const res = resolveIdentityBatch(proposals, state);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /Duplicate localRef 'duplicate_ref'/);
});

test('Identity: tombstoned existing ID cannot be recreated or mutated', () => {
  const state = createInitialState();
  state.tombstones.npc_tombstoned = {
    deletedAt: '2026-09-10T00:00:00Z',
    reason: 'Manual deletion',
  };

  // Attempting to modify tombstoned ID
  const modifyProposal = [{ id: 'npc_tombstoned' }];
  const res = resolveIdentityBatch(modifyProposal, state);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /has been tombstoned \(manually deleted\) and cannot be modified or recreated/);
});

test('Identity: manual_only admission policy rejects automatic NEW admission', () => {
  const state = createInitialState();
  const proposals = [{ localRef: 'new_ref', name: 'Newbie', identityKind: 'named' }];
  const res = resolveIdentityBatch(proposals, state, ADMISSION_POLICIES.MANUAL_ONLY);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /admission policy is 'manual_only'/);
});

test('Identity: named_preferred admits named, rejects role_label unless allowRoleLabels is enabled', () => {
  const state = createInitialState();

  // Role label rejected by default under named_preferred
  const roleProposal = [{ localRef: 'guard_ref', name: 'City Guard', identityKind: 'role_label' }];
  const resDefault = resolveIdentityBatch(roleProposal, state, ADMISSION_POLICIES.NAMED_PREFERRED);
  assert.equal(resDefault.valid, false);
  assert.match(resDefault.errors[0], /rejected under 'named_preferred' policy/);

  // Role label admitted when allowRoleLabels option is explicitly true
  const resAllowed = resolveIdentityBatch(roleProposal, state, ADMISSION_POLICIES.NAMED_PREFERRED, { allowRoleLabels: true });
  assert.equal(resAllowed.valid, true);
  assert.equal(resAllowed.assignedNpcs.length, 1);

  // Named NPC is always admitted under named_preferred (even with lexical names like Stranger)
  const namedProposal = [{ localRef: 'named_ref', name: 'Stranger', identityKind: 'named' }];
  const resNamed = resolveIdentityBatch(namedProposal, state, ADMISSION_POLICIES.NAMED_PREFERRED);
  assert.equal(resNamed.valid, true);
  assert.equal(resNamed.assignedNpcs[0].name, 'Stranger');
});

test('Identity: balanced_unique_role_label enforces mechanical uniqueness against batch and state', () => {
  const state = createInitialState();
  state.npcs.npc_baron = createDefaultNpcRecord('npc_baron', 'Baron');

  // Unique role label succeeds
  const uniqueProp = [{ localRef: 'blacksmith_ref', name: 'Blacksmith', identityKind: 'role_label' }];
  const resUnique = resolveIdentityBatch(uniqueProp, state, ADMISSION_POLICIES.BALANCED_UNIQUE_ROLE_LABEL);
  assert.equal(resUnique.valid, true);

  // Role label conflicting with existing NPC in state fails (case-insensitive)
  const conflictStateProp = [{ localRef: 'baron_ref', name: 'baron', identityKind: 'role_label' }];
  const resConflictState = resolveIdentityBatch(conflictStateProp, state, ADMISSION_POLICIES.BALANCED_UNIQUE_ROLE_LABEL);
  assert.equal(resConflictState.valid, false);
  assert.match(resConflictState.errors[0], /conflicts with existing NPC/);

  // Duplicate role labels in same transaction batch fail (case-insensitive)
  const dupBatchProp = [
    { localRef: 'guard_1', name: 'Gate Guard', identityKind: 'role_label' },
    { localRef: 'guard_2', name: 'gate guard', identityKind: 'role_label' },
  ];
  const resDupBatch = resolveIdentityBatch(dupBatchProp, state, ADMISSION_POLICIES.BALANCED_UNIQUE_ROLE_LABEL);
  assert.equal(resDupBatch.valid, false);
  assert.match(resDupBatch.errors[0], /Duplicate role label candidate/);
});

test('Identity (Item 8): generateStableNpcId and resolveIdentityBatch collision safety retries across npcs, tombstones, and batch allocations', () => {
  resetNpcIdCounterForTesting();
  const state = createInitialState();

  // Seed existing state with a predictable candidate ID
  const simulatedId1 = `npc_${Date.now()}_1`;
  const simulatedId2 = `npc_${Date.now()}_2`;
  state.npcs[simulatedId1] = createDefaultNpcRecord(simulatedId1, 'Pre-existing NPC');
  state.tombstones[simulatedId2] = { deletedAt: '2026-09-10', reason: 'Tombstoned' };

  // Call generateStableNpcId with state and an allocatedIds Set
  const allocated = new Set();
  const generatedId = generateStableNpcId(state, allocated);

  // Must not collide with simulatedId1 or simulatedId2
  assert.notEqual(generatedId, simulatedId1);
  assert.notEqual(generatedId, simulatedId2);
  assert.ok(allocated.has(generatedId));

  // Batch allocation with resolveIdentityBatch also avoids collisions
  const proposals = [
    { localRef: 'new_1', name: 'Fresh NPC A', identityKind: 'named' },
    { localRef: 'new_2', name: 'Fresh NPC B', identityKind: 'named' },
  ];
  const batchRes = resolveIdentityBatch(proposals, state);
  assert.equal(batchRes.valid, true);
  assert.equal(batchRes.assignedNpcs.length, 2);

  const assignedA = batchRes.resolvedMap.get('new_1').assignedId;
  const assignedB = batchRes.resolvedMap.get('new_2').assignedId;
  assert.notEqual(assignedA, simulatedId1);
  assert.notEqual(assignedA, simulatedId2);
  assert.notEqual(assignedB, simulatedId1);
  assert.notEqual(assignedB, simulatedId2);
  assert.notEqual(assignedA, assignedB);
});

