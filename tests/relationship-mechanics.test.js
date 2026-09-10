import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELATIONSHIP_AXES,
  calculateAxisMilestone,
  calculateRelationshipMilestones,
  calculateAxisDelta,
  applyRelationshipMechanics,
} from '../src/runtime/relationship-mechanics.js';
import { WRITERS } from '../src/contract/registry.js';
import { applyFieldProposal } from '../src/runtime/field-applier.js';
import { createDefaultNpcRecord, createInitialState } from '../src/state/schema.js';
import { MemoryStorageAdapter } from '../src/state/storage.js';
import { CommitCoordinator } from '../src/runtime/commit-coordinator.js';
import { setFieldLock } from '../src/runtime/user-commands.js';

test('Relationship Mechanics: 4 independent axes exist', () => {
  assert.deepEqual(RELATIONSHIP_AXES, ['trust', 'affection', 'desire', 'tension']);
});

test('Relationship Mechanics: calculateAxisMilestone categorizes scores correctly', () => {
  assert.equal(calculateAxisMilestone('trust', 85), 'trust:confidant');
  assert.equal(calculateAxisMilestone('trust', 55), 'trust:trusted');
  assert.equal(calculateAxisMilestone('trust', 30), 'trust:receptive');
  assert.equal(calculateAxisMilestone('trust', 0), 'trust:neutral');
  assert.equal(calculateAxisMilestone('trust', -30), 'trust:wary');
  assert.equal(calculateAxisMilestone('trust', -55), 'trust:distrusted');
  assert.equal(calculateAxisMilestone('trust', -85), 'trust:betrayed');

  assert.equal(calculateAxisMilestone('affection', 80), 'affection:devoted');
  assert.equal(calculateAxisMilestone('desire', 80), 'desire:infatuated');
  assert.equal(calculateAxisMilestone('tension', 80), 'tension:volatile');
});

test('Relationship Mechanics: calculateAxisDelta applies inertia and caps', () => {
  // Positive delta with inertia = 0.1, cap = 100, currentScore = 20:
  // distanceFromCenter = 20, damping = 1 / (1 + 0.1 * 0.2) = 1 / 1.02 ≈ 0.98039
  // appliedDelta = 10 * damping ≈ 9.8039
  const res = calculateAxisDelta(20, 10, { inertia: 0.1, cap: 100 });
  assert.ok(res.appliedDelta > 9 && res.appliedDelta < 10);
  assert.ok(res.newScore > 29 && res.newScore < 30);

  // Cap enforcement: score cannot exceed cap
  const cappedRes = calculateAxisDelta(95, 20, { inertia: 0, cap: 100 });
  assert.equal(cappedRes.newScore, 100);
  assert.equal(cappedRes.appliedDelta, 5);

  // Negative cap enforcement
  const negCapped = calculateAxisDelta(-95, -20, { inertia: 0, cap: 100 });
  assert.equal(negCapped.newScore, -100);
  assert.equal(negCapped.appliedDelta, -5);
});

test('Relationship Mechanics: applyRelationshipMechanics updates state, progress, milestones, and history', () => {
  const npc = createDefaultNpcRecord('alice', 'Alice');
  npc.relationship = {
    trust: 10,
    affection: 5,
    desire: 0,
    tension: 0,
    progress: {},
    milestones: {},
    scoringHistory: [],
  };

  const evalProposal = {
    shifted: true,
    axes: {
      trust: 15,
      affection: -10,
    },
    reason: 'Shared a secret and argued about plans',
  };

  const result = applyRelationshipMechanics(npc, evalProposal, {
    inertia: 0,
    cap: 100,
    historyLimit: 5,
    exchangeId: 'chat1:5',
  });

  assert.equal(result.applied, true);
  assert.equal(npc.relationship.trust, 25);
  assert.equal(npc.relationship.affection, -5);
  assert.equal(npc.relationship.desire, 0);
  assert.equal(npc.relationship.tension, 0);

  assert.ok(Array.isArray(npc.relationship.milestones));
  assert.equal(npc.relationship.scoringHistory.length, 1);

  const hist = npc.relationship.scoringHistory[0];
  assert.equal(hist.appliedDeltas.trust, 15);
  assert.equal(hist.appliedDeltas.affection, -10);
  assert.equal(hist.exchangeId, 'chat1:5');
});

test('Relationship Mechanics: scoring history respects configured limit', () => {
  const npc = createDefaultNpcRecord('alice', 'Alice');
  npc.relationship = {
    trust: 0,
    affection: 0,
    desire: 0,
    tension: 0,
    scoringHistory: [],
  };

  for (let i = 1; i <= 10; i++) {
    applyRelationshipMechanics(npc, {
      shifted: true,
      axes: { trust: 2 },
      impact: `Step ${i}`,
    }, {
      historyLimit: 3,
    });
  }

  assert.equal(npc.relationship.scoringHistory.length, 3);
  assert.equal(npc.relationship.scoringHistory[2].impact, 'Step 10');
});

test('Relationship Mechanics: Development evaluation NEVER modifies numeric scores', () => {
  const npc = createDefaultNpcRecord('alice', 'Alice');
  npc.relationship = {
    trust: 50,
    affection: 30,
    desire: 10,
    tension: 5,
  };

  // 1. Development writer successfully updates narrative relationshipDynamic
  const dynamicRes = applyFieldProposal(npc, 'relationshipDynamic', 'Deepening partnership with mutual respect', WRITERS.DEVELOPMENT);
  assert.equal(dynamicRes.applied, true);
  assert.equal(npc.relationshipDynamic, 'Deepening partnership with mutual respect');

  // 2. Development writer is strictly rejected from mutating numeric relationshipEvaluation
  const evalRes = applyFieldProposal(npc, 'relationshipEvaluation', {
    shifted: true,
    axes: { trust: 99, affection: 99 },
  }, WRITERS.DEVELOPMENT);

  assert.equal(evalRes.applied, false);
  assert.match(evalRes.error, /wrong-writer/i);

  // Numeric relationship scores are strictly preserved!
  assert.equal(npc.relationship.trust, 50);
  assert.equal(npc.relationship.affection, 30);
  assert.equal(npc.relationship.desire, 10);
  assert.equal(npc.relationship.tension, 5);
});

test('Relationship Mechanics: shifted: false is a validated numeric no-op', () => {
  const npc = createDefaultNpcRecord('alice', 'Alice');
  npc.relationship = {
    trust: 20,
    affection: 10,
    desire: 5,
    tension: 0,
    lastEvaluationExchange: null,
    scoringHistory: [],
  };
  const before = structuredClone(npc.relationship);

  const result = applyRelationshipMechanics(npc, {
    shifted: false,
    reason: 'Casual small talk about the weather',
    source: { sourceRef: 'current:assistant', excerpt: 'Nice day today' },
  }, {
    exchangeId: 'chat1:exchange_42',
    historyLimit: 10,
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'explicit_zero_shift');
  assert.equal(result.bookkeepingOnly, true);
  assert.deepEqual(npc.relationship, before, 'Explicit zero does not manufacture a scoring-history mutation.');
});

test('Relationship Mechanics: shared coordinator settings enforce caps, retain reasons, persist, and suppress duplicate exchange scoring', async () => {
  const storage = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({
    storage,
    settings: {
      relationshipScoreCap: 10,
      relationshipInertia: 0,
      relationshipHistoryLimit: 5,
    },
  });
  const alice = createDefaultNpcRecord('alice', 'Alice');
  await storage.save({ ...createInitialState(), npcs: { alice } }, 0);

  const first = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    fieldProposals: {
      alice: {
        relationshipEvaluation: {
          shifted: true,
          axes: { trust: 15, affection: -2.5 },
          reason: 'Alice entrusts the player with a sealed ledger.',
          impact: 'meaningful',
          source: { sourceRef: 'current:assistant', excerpt: 'Take the ledger.' },
          axisSupport: {
            trust: { source: { sourceRef: 'current:assistant', excerpt: 'Take the ledger.' } },
          },
        },
      },
    },
    userOptions: { exchangeId: 'chat1:5' },
  });
  assert.equal(first.success, true, first.error);

  let loaded = await storage.load();
  assert.equal(loaded.state.npcs.alice.relationship.trust, 10, 'Configured cap is used by the shared application path.');
  assert.equal(loaded.state.npcs.alice.relationship.affection, -2.5);
  assert.equal(loaded.state.npcs.alice.relationship.scoringHistory.length, 1);
  assert.equal(loaded.state.npcs.alice.relationship.scoringHistory[0].reason, 'Alice entrusts the player with a sealed ledger.');
  assert.equal(loaded.state.npcs.alice.relationship.scoringHistory[0].exchangeId, 'chat1:5');

  const replay = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    fieldProposals: {
      alice: {
        relationshipEvaluation: {
          shifted: true,
          axes: { trust: -9 },
          reason: 'Duplicate mechanical evaluation for the same exchange.',
        },
      },
    },
    userOptions: { exchangeId: 'chat1:5' },
  });
  assert.equal(replay.success, true, replay.error);
  loaded = await storage.load();
  assert.equal(loaded.state.npcs.alice.relationship.trust, 10);
  assert.equal(loaded.state.npcs.alice.relationship.scoringHistory.length, 1, 'Same exchange cannot count twice.');
});

test('Relationship Mechanics: explicit relationshipEvaluation lock blocks later One-Pass numeric scoring and persists', async () => {
  const storage = new MemoryStorageAdapter();
  const coordinator = new CommitCoordinator({ storage });
  const alice = createDefaultNpcRecord('alice', 'Alice');
  await storage.save({ ...createInitialState(), npcs: { alice } }, 0);

  const locked = await setFieldLock(coordinator, {
    npcId: 'alice',
    fieldName: 'relationshipEvaluation',
    locked: true,
  });
  assert.equal(locked.success, true, locked.error);

  const automatic = await coordinator.commit({
    writer: WRITERS.ONE_PASS,
    fieldProposals: {
      alice: {
        relationshipEvaluation: {
          shifted: true,
          axes: { trust: 8 },
          reason: 'Should be blocked by the explicit user lock.',
        },
      },
    },
    userOptions: { exchangeId: 'chat1:6' },
  });
  assert.equal(automatic.success, true, automatic.error);

  const reloaded = await storage.load();
  assert.equal(reloaded.state.npcs.alice.locks.relationshipEvaluation, true);
  assert.equal(reloaded.state.npcs.alice.relationship.trust, 0);
  assert.equal(reloaded.state.npcs.alice.relationship.scoringHistory, undefined);
  assert.ok(automatic.deferred.some((item) => item.targetId === 'alice' && item.field === 'relationshipEvaluation' && item.reason === 'locked'));
});

