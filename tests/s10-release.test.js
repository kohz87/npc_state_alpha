import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  LEGACY_BETA_V044,
  LEGACY_BETA_V044_IMPORT_CONFIRMATION,
  parseLegacyBetaV044Bundle,
  previewLegacyBetaV044Import,
  convertLegacyBetaV044ToAlpha,
  installLegacyBetaV044Bundle,
} from '../src/state/legacy-beta-v044.js';
import {
  ALPHA_NAMESPACE,
  ALPHA_SCHEMA_VERSION,
  createInitialState,
  createDefaultNpcRecord,
  validateState,
} from '../src/state/schema.js';
import { MemoryStorageAdapter } from '../src/state/storage.js';
import {
  ALPHA_NATIVE_BUNDLE_FORMAT,
  ALPHA_NATIVE_BUNDLE_VERSION,
  serializeAlphaNativeBundle,
  parseAlphaNativeBundle,
} from '../src/state/portable-state.js';
import { createCheckpoint, IMPORT_BASELINE_MODE } from '../src/state/checkpoints.js';
import {
  analyzeStoryHistory,
  captureStoryHistoryBoundary,
} from '../src/host/history-recovery.js';
import {
  SillyTavernAdapter,
  buildChatFingerprintIndex,
  buildPrecedingLineage,
  getMessageSwipeId,
  lineageMatchesFingerprintIndex,
} from '../src/host/sillytavern-adapter.js';
import { buildPackage } from '../scripts/package.js';
import { normalizeAlphaSettings } from '../src/contract/settings.js';
import { MockSillyTavernHost } from './fixtures/host-harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const FIXED_IMPORT_TIME = '2026-09-11T00:00:00.000Z';

function withTempPackage(callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-state-alpha-s10-package-'));
  try {
    const built = buildPackage({
      distDir: path.join(tempRoot, 'dist'),
      releaseDir: path.join(tempRoot, 'release'),
    });
    return callback(built, tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function betaNpc(id, name, overrides = {}) {
  return {
    id,
    name,
    aliases: [],
    role: '',
    species: '',
    age: '',
    apparentAge: '',
    birthday: '',
    birthdayProvenance: '',
    ageProgressionBaselineAge: '',
    appearance: '',
    appearanceForms: [],
    currentForm: '',
    personality: '',
    behaviorProfile: [],
    speech: '',
    mannerisms: [],
    profileEvolutionEvidence: [],
    background: '',
    keyRelationships: [],
    memories: [],
    relationship: { trust: 0, affection: 0, desire: 0, tension: 0 },
    relationshipProgress: { trust: 0, affection: 0, desire: 0, tension: 0 },
    relationshipEvidenceHistory: [],
    relationshipDiagnostics: [],
    lifeStateDiagnostics: [],
    relationshipMilestones: [],
    relationshipSummary: '',
    relationshipHistory: [],
    lastRelationshipChange: null,
    mood: '',
    location: '',
    goal: '',
    status: '',
    present: false,
    worldActive: false,
    lifeState: 'alive',
    lifeStateCertainty: '',
    lifeStateReason: '',
    archived: false,
    archiveReason: '',
    archivedAt: null,
    importance: 0,
    manualProfileFields: [],
    retentionProtected: false,
    minor: false,
    portrait: null,
    createdAt: 0,
    updatedAt: 0,
    firstSeenMessageId: null,
    lastSeenMessageId: null,
    lastInteractionMessageId: null,
    lastActivityTurn: null,
    lastActivityMessageId: null,
    lastActivityReason: '',
    seenCount: 0,
    manual: false,
    ...overrides,
  };
}

function betaBundle(overrides = {}) {
  return {
    format: 'npc_state_v3_bundle',
    formatVersion: 1,
    appVersion: '0.4.44',
    schemaVersion: 1,
    bundleType: 'full-chat',
    source: { chatKey: 'synthetic-release-fixture', narrativeTurn: 12, exportedAt: 1789084800000 },
    data: {
      npcs: [],
      socialGraph: [],
      familySlots: [],
      suppressedNames: [],
      deletedNpcIds: [],
    },
    ...overrides,
  };
}

function richBetaBundle() {
  const alice = betaNpc('beta-alice', 'Alice', {
    aliases: ['Captain Alice'],
    role: 'Courier captain',
    species: 'Human',
    age: '31',
    apparentAge: '~29',
    birthday: '3 Ember',
    appearance: 'Dark braided hair and a weathered blue coat.',
    appearanceForms: [
      { name: 'Human', appearance: 'Dark braided hair and a weathered blue coat.' },
      { name: 'Field', appearance: 'Blue field coat, travel boots, and route satchel.' },
    ],
    currentForm: 'Field',
    personality: 'Reserved but dependable.',
    behaviorProfile: ['Checks routes twice.', 'Keeps promises under pressure.'],
    speech: 'Short, practical sentences.',
    mannerisms: ['Taps the route case before departure.'],
    background: 'Veteran courier from the northern routes.',
    keyRelationships: ['Bob - younger brother'],
    memories: ['Survived the North Pass collapse.', 'Delivered medicine during the winter siege.'],
    relationship: { trust: 18, affection: 7, desire: 0, tension: -2 },
    relationshipProgress: { trust: 0.5, affection: 0, desire: 0, tension: 0 },
    relationshipSummary: 'Trusted professional ally.',
    relationshipHistory: [{ impact: 'meaningful', reason: 'Legacy reason', evidence: 'Legacy evidence' }],
    relationshipEvidenceHistory: [{ reason: 'Legacy evidence history', evidence: 'Legacy evidence' }],
    relationshipMilestones: [{ axis: 'trust', polarity: 1, threshold: 25, reason: 'Legacy milestone' }],
    profileEvolutionEvidence: [{ field: 'personality', mode: 'gradual', concept: 'dependable', evidence: 'Repeated scenes' }],
    mood: 'focused',
    location: 'North gate',
    goal: 'Deliver the sealed dispatch',
    status: 'checking the route ledger',
    present: true,
    worldActive: true,
    importance: 62,
    portrait: { path: 'legacy-portrait.png' },
    manualProfileFields: ['personality'],
  });
  const bob = betaNpc('beta-bob', 'Bob', {
    aliases: ['Bobby'],
    role: 'Stable hand',
    species: 'Human',
    lifeState: 'dead',
    present: false,
    archived: true,
    archiveReason: 'deceased',
    relationship: { trust: 2, affection: 4, desire: 0, tension: 1 },
  });
  return betaBundle({
    data: {
      npcs: [alice, bob],
      socialGraph: [{
        fromId: 'beta-alice',
        toId: 'beta-bob',
        relation: 'older sister',
        summary: 'Protective sibling bond.',
        updatedAt: 1789084800000,
        sourceMessageId: 42,
        provenance: 'explicit',
        confidence: 1,
        inferred: false,
      }],
      familySlots: [{
        id: 'family:beta-alice:sibling',
        ownerId: 'beta-alice',
        relation: 'sibling',
        count: 1,
        resolvedNpcIds: ['beta-bob'],
        memberNames: ['Bob'],
        descriptor: 'younger brother',
        evidence: 'Legacy family evidence',
        provenance: 'explicit',
        confidence: 1,
        sourceMessageId: 42,
        updatedAt: 1789084800000,
      }],
      suppressedNames: ['Background Guard'],
      deletedNpcIds: ['beta-deleted-id'],
    },
  });
}

const historyHelpers = {
  buildPrecedingLineage,
  buildChatFingerprintIndex,
  lineageMatchesFingerprintIndex,
  getMessageSwipeId,
};

test('S10 release version owners remain 0.1.4 while state/native schemas stay version 1', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
  assert.equal(pkg.version, '0.1.4');
  assert.equal(manifest.version, pkg.version);
  assert.equal(ALPHA_NAMESPACE, 'npc_state_alpha.v1');
  assert.equal(ALPHA_SCHEMA_VERSION, 1);
  assert.equal(ALPHA_NATIVE_BUNDLE_FORMAT, 'npc_state_alpha.native_state');
  assert.equal(ALPHA_NATIVE_BUNDLE_VERSION, 1);
});

test('S10 package is deterministic and excludes development/private content', () => {
  withTempPackage((first, tempRoot) => {
    const firstHash = first.archiveSha256;
    const firstFiles = [...first.files];
    const firstBytes = first.distBytes;
    const second = buildPackage({
      distDir: path.join(tempRoot, 'dist'),
      releaseDir: path.join(tempRoot, 'release'),
    });
    assert.equal(second.archiveSha256, firstHash);
    assert.deepEqual(second.files, firstFiles);
    assert.equal(second.distBytes, firstBytes);
    assert.equal(second.fileCount, firstFiles.length);
    assert.ok(second.files.includes('src/state/legacy-beta-v044.js'));
    for (const forbidden of ['tests/', 'docs/', 'scripts/', 'node_modules/', '.git/', '.env', 'DEVELOPMENT.md', 'UPDATE-HANDOFF.md']) {
      assert.equal(second.files.some((entry) => entry === forbidden || entry.startsWith(forbidden)), false, `release must exclude ${forbidden}`);
    }
    const checksum = fs.readFileSync(second.checksumPath, 'utf8').trim();
    assert.equal(checksum, `${second.archiveSha256}  npc_state_alpha-0.1.4.zip`);
  });
});

test('S10 clean packaged install initializes Alpha with empty canonical state and no listener residue', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-state-alpha-s10-clean-'));
  try {
    const built = buildPackage({
      distDir: path.join(tempRoot, 'dist'),
      releaseDir: path.join(tempRoot, 'release'),
    });
    const moduleUrl = pathToFileURL(path.join(built.distDir, 'src', 'host', 'sillytavern-adapter.js')).href;
    const { SillyTavernAdapter: PackagedAdapter } = await import(`${moduleUrl}?s10-clean=${Date.now()}`);
    const host = new MockSillyTavernHost({ chatId: 's10_clean_install' });
    host.interceptorKey = 's10_clean_install_interceptor';
    const adapter = new PackagedAdapter({ getContext: () => host.getContext(), interceptorKey: host.interceptorKey });
    assert.equal(adapter.initialize(), true);
    const loaded = await adapter.storage.load();
    assert.equal(loaded.revision, 0);
    assert.deepEqual(Object.keys(loaded.state.npcs), []);
    host.sendUserMessage('Clean install generation check.');
    await host.triggerGenerateInterceptor('normal');
    assert.equal(typeof globalThis[host.interceptorKey], 'function');
    assert.ok(host.extensionPrompts.get('npc_state_alpha')?.prompt?.includes('NPC State Continuity'));
    adapter.destroy();
    assert.equal(globalThis[host.interceptorKey], undefined);
    const listeners = [...host.eventSource._listeners.values()].reduce((sum, rows) => sum + rows.length, 0);
    assert.equal(listeners, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('S10 upgrade preserves representative accepted S9 state without schema migration', async () => {
  const state = createInitialState();
  const alice = createDefaultNpcRecord('alice-stable-id', 'Alice', {
    aliases: ['Captain Alice'],
    present: true,
    mood: 'steady',
    relationship: {
      trust: 12.5,
      affection: 4,
      desire: 0,
      tension: 1,
      lastEvaluationExchange: 's9:42',
      progress: { trust: 0.5, affection: 0, desire: 0, tension: 0 },
      milestones: ['trust:neutral'],
      scoringHistory: [],
    },
    relationshipDynamic: 'Trusted ally',
    personality: { traits: ['Reserved', 'Dependable'] },
    behavioralProfile: 'Checks routes before departure.',
    speech: 'Concise.',
    mannerisms: ['Taps route case.'],
    role: 'Courier',
    species: 'Human',
    background: 'Veteran courier.',
    actualAge: '31',
    apparentAge: '~29',
    birthday: '3 Ember',
    importantMemories: [{ memoryId: 'mem1', summary: 'Crossed the North Pass.' }],
    locks: { mood: true },
    manualCorrections: {
      mood: {
        correctedAt: FIXED_IMPORT_TIME,
        writer: 'user',
        reason: 'Upgrade preservation fixture',
        value: 'steady',
      },
    },
    development: {
      observations: [],
      acceptedSupport: [],
      reviewReceipts: [],
    },
  });
  state.npcs[alice.id] = alice;
  state.pendingReview.entries.push({
    id: 'pending-upgrade',
    targetId: alice.id,
    sourceScope: ['chat:s9-upgrade:0'],
    exchangeId: 's9-upgrade:0',
    reason: 'fast_proposal',
    createdAt: FIXED_IMPORT_TIME,
  });
  createCheckpoint(state, {
    checkpointId: 's9-upgrade-checkpoint',
    timestamp: FIXED_IMPORT_TIME,
    writer: 'one_pass',
    mode: 'commit',
    sourceDependencies: [],
  });
  assert.equal(validateState(state).valid, true);
  const before = JSON.stringify(state);
  const storage = new MemoryStorageAdapter(state);
  const loaded = await storage.load();
  assert.equal(JSON.stringify(loaded.state), before);
  assert.equal(loaded.state.npcs['alice-stable-id'].relationship.trust, 12.5);
  assert.equal(loaded.state.npcs['alice-stable-id'].locks.mood, true);
  assert.equal(loaded.state.npcs['alice-stable-id'].manualCorrections.mood.value, 'steady');
  assert.equal(loaded.state.pendingReview.entries.length, 1);
  assert.equal(loaded.state.history.checkpoints.length, 1);
  const upgradedSettings = normalizeAlphaSettings({
    developmentConnectionProfile: 'release-profile',
    developmentCadence: 5,
  });
  assert.equal(upgradedSettings.developmentConnectionProfile, 'release-profile');
  assert.equal(upgradedSettings.developmentCadence, 5);
});

test('S10 authoritative Beta compatibility tuple is pinned exactly to v0.4.44', () => {
  assert.deepEqual(LEGACY_BETA_V044, {
    appVersion: '0.4.44',
    format: 'npc_state_v3_bundle',
    formatVersion: 1,
    schemaVersion: 1,
    sourceRepository: 'kohz87/npc_state_beta',
    sourceCommit: 'a34f5f27385b6fba75b8ff5832015ba66ea4d0c2',
    schemaOwner: 'v03/schema.js',
    serializerOwner: 'v03/bundle.js',
  });
});

test('S10 Beta v0.4.44 rich bundle maps only supported current Alpha concepts', () => {
  const source = richBetaBundle();
  const original = structuredClone(source);
  const converted = convertLegacyBetaV044ToAlpha(source, { importedAt: FIXED_IMPORT_TIME, emptyHostHistory: true });
  assert.deepEqual(source, original, 'legacy source object must remain unchanged');
  assert.equal(converted.success, true);
  assert.equal(validateState(converted.state).valid, true);
  const alice = converted.state.npcs['beta-alice'];
  const bob = converted.state.npcs['beta-bob'];
  assert.equal(alice.name, 'Alice');
  assert.deepEqual(alice.aliases, ['Captain Alice']);
  assert.equal(alice.lifeState, 'alive');
  assert.equal(alice.present, true);
  assert.equal(alice.activeInExchange, false, 'Beta worldActive must not be mistaken for exchange activity');
  assert.equal(alice.role, 'Courier captain');
  assert.equal(alice.species, 'Human');
  assert.equal(alice.actualAge, '31');
  assert.equal(alice.apparentAge, '~29');
  assert.equal(alice.birthday, '3 Ember');
  assert.equal(alice.canonicalAppearance, 'Dark braided hair and a weathered blue coat.');
  assert.equal(alice.appearanceForms.length, 2);
  assert.equal(alice.currentForm, alice.appearanceForms[1].formId);
  assert.deepEqual(alice.personality, { value: 'Reserved but dependable.' });
  assert.equal(alice.behavioralProfile, 'Checks routes twice.\nKeeps promises under pressure.');
  assert.equal(alice.speech, 'Short, practical sentences.');
  assert.deepEqual(alice.mannerisms, ['Taps the route case before departure.']);
  assert.equal(alice.background, 'Veteran courier from the northern routes.');
  assert.equal(alice.relationship.trust, 18);
  assert.equal(alice.relationship.affection, 7);
  assert.equal(alice.relationship.desire, 0);
  assert.equal(alice.relationship.tension, -2);
  assert.equal(alice.relationship.scoringHistory, undefined, 'legacy relationship history must not become Alpha provenance');
  assert.equal(alice.relationshipDynamic, 'Trusted professional ally.');
  assert.equal(alice.importantMemories.length, 2);
  assert.equal(alice.development.observations.length, 0);
  assert.equal(alice.development.acceptedSupport.length, 0);
  assert.equal(alice.development.reviewReceipts.length, 0);
  assert.equal(alice.locks && Object.keys(alice.locks).length, 0);
  assert.equal(alice.manualCorrections && Object.keys(alice.manualCorrections).length, 0);
  assert.equal(bob.lifeState, 'dead');
  assert.equal(bob.present, false);
  assert.ok(alice.nonPlayerRelationships.some((rel) => rel.targetId === 'beta-bob' && rel.relationship === 'older sister'));
  assert.ok(alice.nonPlayerRelationships.some((rel) => rel.targetId === 'beta-bob' && rel.relationship === 'sibling'));
  assert.ok(converted.preview.omitted.some((item) => item.includes('relationshipHistory')));
  assert.ok(converted.preview.omitted.some((item) => item.includes('keyRelationships')));
  assert.ok(converted.preview.omitted.some((item) => item.startsWith('suppressedNames(')));
  assert.ok(converted.preview.omitted.some((item) => item.startsWith('deletedNpcIds(')));
  assert.equal(converted.state.history.checkpoints.length, 1);
  assert.equal(converted.state.history.checkpoints[0].operation.mode, IMPORT_BASELINE_MODE);
  assert.deepEqual(converted.state.history.checkpoints[0].sourceDependencies, []);
});

test('S10 Beta sparse dossier imports without synthesizing absent profile values', () => {
  const bundle = betaBundle({ data: { npcs: [betaNpc('sparse', 'Sparse')], socialGraph: [], familySlots: [], suppressedNames: [], deletedNpcIds: [] } });
  const converted = convertLegacyBetaV044ToAlpha(bundle, { importedAt: FIXED_IMPORT_TIME });
  const npc = converted.state.npcs.sparse;
  assert.equal(npc.role, null);
  assert.equal(npc.species, null);
  assert.equal(npc.canonicalAppearance, null);
  assert.equal(npc.personality, null);
  assert.equal(npc.background, null);
  assert.deepEqual(npc.importantMemories, []);
  assert.deepEqual(npc.nonPlayerRelationships, []);
});

test('S10 Beta parser rejects unsupported current 0.5.38 instead of guessing its schema', () => {
  const bundle = betaBundle({ appVersion: '0.5.38' });
  assert.throws(() => parseLegacyBetaV044Bundle(bundle), (error) => error.code === 'legacy_beta_unsupported_app_version');
});

test('S10 Beta parser fails closed on format/schema/type/malformed combinations', () => {
  assert.throws(() => parseLegacyBetaV044Bundle('{broken'), (error) => error.code === 'legacy_beta_invalid_json');
  assert.throws(() => parseLegacyBetaV044Bundle(betaBundle({ format: 'other' })), (error) => error.code === 'legacy_beta_unsupported_format');
  assert.throws(() => parseLegacyBetaV044Bundle(betaBundle({ formatVersion: 2 })), (error) => error.code === 'legacy_beta_unsupported_format_version');
  assert.throws(() => parseLegacyBetaV044Bundle(betaBundle({ schemaVersion: 2 })), (error) => error.code === 'legacy_beta_unsupported_schema_version');
  assert.throws(() => parseLegacyBetaV044Bundle(betaBundle({ bundleType: 'mystery' })), (error) => error.code === 'legacy_beta_unsupported_bundle_type');
  assert.throws(() => parseLegacyBetaV044Bundle(betaBundle({ data: { npcs: [], socialGraph: [], familySlots: [], suppressedNames: [] } })), (error) => error.code === 'legacy_beta_invalid_data');
});

test('S10 unsupported legacy root/data fields are reported rather than promoted', () => {
  const source = richBetaBundle();
  source.futureRootField = { unsupported: true };
  source.data.futureDataField = ['not-an-alpha-field'];
  const converted = convertLegacyBetaV044ToAlpha(source, { importedAt: FIXED_IMPORT_TIME });
  assert.ok(converted.preview.omitted.some((item) => item === 'unknownRootKeys(futureRootField)'));
  assert.ok(converted.preview.omitted.some((item) => item === 'unknownDataKeys(futureDataField)'));
  assert.equal(validateState(converted.state).valid, true);
});

test('S10 Beta parser rejects duplicate ids, duplicate canonical names, unsafe ids, and unknown lifecycle', () => {
  const duplicateId = betaBundle({ data: { npcs: [betaNpc('same', 'Alice'), betaNpc('same', 'Bob')], socialGraph: [], familySlots: [], suppressedNames: [], deletedNpcIds: [] } });
  assert.throws(() => parseLegacyBetaV044Bundle(duplicateId), (error) => error.code === 'legacy_beta_duplicate_id');
  const duplicateName = betaBundle({ data: { npcs: [betaNpc('a', 'Alice'), betaNpc('b', 'ALICE!')], socialGraph: [], familySlots: [], suppressedNames: [], deletedNpcIds: [] } });
  assert.throws(() => parseLegacyBetaV044Bundle(duplicateName), (error) => error.code === 'legacy_beta_duplicate_name');
  const unsafe = betaBundle({ data: { npcs: [betaNpc('__proto__', 'Unsafe')], socialGraph: [], familySlots: [], suppressedNames: [], deletedNpcIds: [] } });
  assert.throws(() => parseLegacyBetaV044Bundle(unsafe), (error) => error.code === 'legacy_beta_unsafe_id');
  const unknownLife = betaBundle({ data: { npcs: [betaNpc('u', 'Unknown Life', { lifeState: 'unknown' })], socialGraph: [], familySlots: [], suppressedNames: [], deletedNpcIds: [] } });
  assert.throws(() => parseLegacyBetaV044Bundle(unknownLife), (error) => error.code === 'legacy_beta_unknown_lifecycle');
});

test('S10 selected-NPC bundle requires exactly one dossier', () => {
  assert.throws(() => parseLegacyBetaV044Bundle(betaBundle({ bundleType: 'npc' })), (error) => error.code === 'legacy_beta_invalid_npc_bundle');
  const valid = betaBundle({ bundleType: 'npc', data: { npcs: [betaNpc('one', 'One')], socialGraph: [], familySlots: [], suppressedNames: [], deletedNpcIds: [] } });
  assert.equal(parseLegacyBetaV044Bundle(valid).bundleType, 'npc');
});

test('S10 legacy preview reports nonempty Alpha conflict without mutating either side', () => {
  const source = richBetaBundle();
  const sourceBefore = structuredClone(source);
  const alpha = createInitialState();
  alpha.npcs.existing = createDefaultNpcRecord('existing', 'Existing');
  const alphaBefore = structuredClone(alpha);
  const preview = previewLegacyBetaV044Import(source, { existingState: alpha });
  assert.equal(preview.success, false);
  assert.equal(preview.conflict, 'alpha_state_not_empty');
  assert.equal(preview.npcCount, 2);
  assert.deepEqual(source, sourceBefore);
  assert.deepEqual(alpha, alphaBefore);
});

test('S10 legacy installation requires explicit confirmation and a host-history boundary decision', async () => {
  const bundle = richBetaBundle();
  const storage = new MemoryStorageAdapter();
  const missingConfirmation = await installLegacyBetaV044Bundle({ storage, input: bundle, emptyHostHistory: true });
  assert.equal(missingConfirmation.errorCode, 'legacy_beta_confirmation_required');
  const missingBoundary = await installLegacyBetaV044Bundle({
    storage,
    input: bundle,
    confirmation: LEGACY_BETA_V044_IMPORT_CONFIRMATION,
  });
  assert.equal(missingBoundary.errorCode, 'legacy_beta_history_boundary_required');
  assert.equal((await storage.load()).revision, 0);
});

test('S10 legacy installation refuses nonempty Alpha state rather than name-merging or overwriting', async () => {
  const state = createInitialState();
  state.npcs.existing = createDefaultNpcRecord('existing', 'Alice');
  const storage = new MemoryStorageAdapter(state);
  const result = await installLegacyBetaV044Bundle({
    storage,
    input: richBetaBundle(),
    confirmation: LEGACY_BETA_V044_IMPORT_CONFIRMATION,
    emptyHostHistory: true,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'legacy_beta_alpha_state_not_empty');
  const loaded = await storage.load();
  assert.deepEqual(Object.keys(loaded.state.npcs), ['existing']);
});

test('S10 successful legacy install is atomic, reloadable, native-exportable, and source-immutable', async () => {
  const source = richBetaBundle();
  const before = structuredClone(source);
  const storage = new MemoryStorageAdapter();
  const installed = await installLegacyBetaV044Bundle({
    storage,
    input: source,
    confirmation: LEGACY_BETA_V044_IMPORT_CONFIRMATION,
    importedAt: FIXED_IMPORT_TIME,
    emptyHostHistory: true,
  });
  assert.equal(installed.success, true, installed.error);
  assert.equal(installed.importBaselineMode, IMPORT_BASELINE_MODE);
  assert.deepEqual(source, before);
  const loaded = await storage.load();
  assert.equal(loaded.revision, 1);
  assert.equal(validateState(loaded.state).valid, true);
  assert.deepEqual(Object.keys(loaded.state.npcs).sort(), ['beta-alice', 'beta-bob']);
  const reloaded = new MemoryStorageAdapter(loaded.state);
  assert.deepEqual((await reloaded.load()).state, loaded.state);
  const portable = serializeAlphaNativeBundle(loaded.state);
  const parsedNative = parseAlphaNativeBundle(portable);
  assert.equal(parsedNative.success, true);
  assert.deepEqual(parsedNative.state, loaded.state);
});

test('S10 legacy import baseline blocks automatic reconstruction across untrusted pre-import chat history', async () => {
  const chatId = 's10_import_boundary';
  const chat = [
    { is_user: true, is_system: false, mes: 'Old user history before import.', swipe_id: 0 },
    { is_user: false, is_system: false, mes: 'Old assistant history before import.', swipe_id: 0, swipes: [] },
  ];
  const historyBoundary = captureStoryHistoryBoundary(chat, chatId, 1, historyHelpers);
  const storage = new MemoryStorageAdapter();
  const installed = await installLegacyBetaV044Bundle({
    storage,
    input: richBetaBundle(),
    confirmation: LEGACY_BETA_V044_IMPORT_CONFIRMATION,
    importedAt: FIXED_IMPORT_TIME,
    historyBoundary,
  });
  assert.equal(installed.success, true, installed.error);
  const loaded = await storage.load();
  assert.equal(loaded.state.history.checkpoints[0].operation.mode, IMPORT_BASELINE_MODE);
  assert.deepEqual(loaded.state.history.checkpoints[0].historyBoundary, historyBoundary);
  chat[0].mes = 'Edited old user history before import.';
  const analysis = analyzeStoryHistory(loaded.state, chat, chatId, historyHelpers);
  assert.equal(analysis.valid, false);
  assert.equal(analysis.blocked, true);
  assert.equal(analysis.reason, 'pre_import_history_untrusted');
});

test('S10 legacy CAS/persistence failure does not partially install imported state', async () => {
  const storage = new MemoryStorageAdapter();
  storage.setFailNextSave();
  const result = await installLegacyBetaV044Bundle({
    storage,
    input: richBetaBundle(),
    confirmation: LEGACY_BETA_V044_IMPORT_CONFIRMATION,
    emptyHostHistory: true,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'legacy_beta_persistence_failed');
  const loaded = await storage.load();
  assert.equal(loaded.revision, 0);
  assert.deepEqual(Object.keys(loaded.state.npcs), []);
});

test('S10 packaged legacy adapter imports directly and remains independent of Beta runtime files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-state-alpha-s10-legacy-'));
  try {
    const built = buildPackage({
      distDir: path.join(tempRoot, 'dist'),
      releaseDir: path.join(tempRoot, 'release'),
    });
    const modulePath = path.join(built.distDir, 'src', 'state', 'legacy-beta-v044.js');
    assert.equal(fs.existsSync(modulePath), true);
    const module = await import(`${pathToFileURL(modulePath).href}?s10-legacy=${Date.now()}`);
    const converted = module.convertLegacyBetaV044ToAlpha(richBetaBundle(), { importedAt: FIXED_IMPORT_TIME });
    assert.equal(converted.success, true);
    assert.equal(validateState(converted.state).valid, true);
    const sourceText = fs.readFileSync(modulePath, 'utf8');
    assert.equal(sourceText.includes('npc_state_beta/'), false);
    assert.equal(sourceText.includes('from \'../../../'), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
