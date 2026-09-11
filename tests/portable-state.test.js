import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALPHA_NATIVE_BUNDLE_FORMAT,
  ALPHA_NATIVE_BUNDLE_VERSION,
  createAlphaNativeBundle,
  parseAlphaNativeBundle,
  serializeAlphaNativeBundle,
  validateAlphaNativeBundle,
} from '../src/state/portable-state.js';
import {
  cloneState,
  createDefaultNpcRecord,
  createInitialState,
} from '../src/state/schema.js';
import { createCheckpoint } from '../src/state/checkpoints.js';

function portableFixture() {
  const state = createInitialState();
  state.npcs.alice = createDefaultNpcRecord('alice', 'Alice', {
    mood: null,
    location: 'North Gate',
    personality: { traits: ['observant'] },
  });
  state.npcs.alice.locks.location = true;
  state.npcs.alice.manualCorrections.location = {
    correctedAt: '2026-09-11T00:00:00.000Z',
    writer: 'user',
    previousValue: 'Old Gate',
    value: 'North Gate',
  };
  state.revision = 1;
  createCheckpoint(state, {
    checkpointId: 'portable_checkpoint',
    timestamp: '2026-09-11T00:00:00.000Z',
    writer: 'runtime',
    mode: 'portable_fixture',
  });
  return state;
}

test('S6 Alpha native bundle round-trips canonical state without fabricating history or provenance', () => {
  const state = portableFixture();
  const bundle = createAlphaNativeBundle(state);
  assert.equal(bundle.format, ALPHA_NATIVE_BUNDLE_FORMAT);
  assert.equal(bundle.formatVersion, ALPHA_NATIVE_BUNDLE_VERSION);
  assert.equal(validateAlphaNativeBundle(bundle).valid, true);

  const parsed = parseAlphaNativeBundle(serializeAlphaNativeBundle(state));
  assert.equal(parsed.success, true, parsed.error);
  assert.deepEqual(parsed.state, state);
  assert.equal(parsed.state.npcs.alice.mood, null);
  assert.equal(parsed.state.npcs.alice.locks.location, true);
  assert.equal(parsed.state.history.checkpoints.length, 1);
  assert.deepEqual(parsed.state.history.checkpoints[0].sourceDependencies, []);
  assert.equal(parsed.state.history.checkpoints[0].historyBoundary, null);
});

test('S6 Alpha native serialization is deterministic across object insertion order', () => {
  const state = portableFixture();
  const reordered = {
    history: cloneState(state.history),
    pendingReview: cloneState(state.pendingReview),
    dedup: cloneState(state.dedup),
    tombstones: cloneState(state.tombstones),
    npcs: cloneState(state.npcs),
    revision: state.revision,
    schemaVersion: state.schemaVersion,
    namespace: state.namespace,
  };
  assert.equal(serializeAlphaNativeBundle(reordered), serializeAlphaNativeBundle(state));

  const protoState = portableFixture();
  protoState.pendingReview.entries.push({
    targetId: 'alice',
    exchangeId: 'portable:proto-key',
    metadata: JSON.parse('{"__proto__":{"preserved":true}}'),
  });
  const protoParsed = parseAlphaNativeBundle(serializeAlphaNativeBundle(protoState));
  assert.equal(protoParsed.success, true, protoParsed.error);
  const protoMetadata = protoParsed.state.pendingReview.entries.at(-1).metadata;
  assert.equal(Object.prototype.hasOwnProperty.call(protoMetadata, '__proto__'), true);
  assert.deepEqual(protoMetadata.__proto__, { preserved: true });
  assert.equal(({}).preserved, undefined);
});

test('S6 Alpha native parser rejects unsupported format and format version explicitly', () => {
  const bundle = createAlphaNativeBundle(portableFixture());

  const wrongFormat = parseAlphaNativeBundle({ ...bundle, format: 'legacy.beta.bundle' });
  assert.equal(wrongFormat.success, false);
  assert.equal(wrongFormat.errorCode, 'unsupported_native_bundle_format');

  const wrongVersion = parseAlphaNativeBundle({ ...bundle, formatVersion: 2 });
  assert.equal(wrongVersion.success, false);
  assert.equal(wrongVersion.errorCode, 'unsupported_native_bundle_version');
});

test('S6 Alpha native parser rejects malformed envelopes and invalid canonical state', () => {
  const malformed = parseAlphaNativeBundle('{not json');
  assert.equal(malformed.success, false);
  assert.equal(malformed.errorCode, 'native_bundle_parse_error');

  const extraKey = createAlphaNativeBundle(portableFixture());
  extraKey.legacyMetadata = { guessed: true };
  const rejectedExtra = parseAlphaNativeBundle(extraKey);
  assert.equal(rejectedExtra.success, false);
  assert.equal(rejectedExtra.errorCode, 'invalid_native_bundle');

  const invalidState = createAlphaNativeBundle(portableFixture());
  invalidState.state.schemaVersion = 999;
  const rejectedState = parseAlphaNativeBundle(invalidState);
  assert.equal(rejectedState.success, false);
  assert.equal(rejectedState.errorCode, 'invalid_native_bundle');
});

test('S6 Alpha native empty-state bundle remains empty and does not synthesize a restore baseline', () => {
  const state = createInitialState();
  const parsed = parseAlphaNativeBundle(serializeAlphaNativeBundle(state));
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.state.history.checkpoints, []);
  assert.deepEqual(parsed.state.pendingReview.entries, []);
  assert.deepEqual(parsed.state.dedup.processedSourceKeys, []);
  assert.deepEqual(parsed.state.npcs, {});
  assert.deepEqual(parsed.state.tombstones, {});
});

test('S6 Alpha native export rejects valid-state metadata that would not round-trip losslessly through JSON', () => {
  const dated = portableFixture();
  dated.pendingReview.entries.push({
    targetId: 'alice',
    exchangeId: 'portable:date',
    metadata: { capturedAt: new Date('2026-09-11T00:00:00.000Z') },
  });
  assert.throws(
    () => createAlphaNativeBundle(dated),
    /non-portable state: .*non-plain object type 'Date'/,
  );

  const undefinedValue = portableFixture();
  undefinedValue.pendingReview.entries.push({
    targetId: 'alice',
    exchangeId: 'portable:undefined',
    metadata: { marker: undefined },
  });
  assert.throws(
    () => serializeAlphaNativeBundle(undefinedValue),
    /non-portable state: .*unsupported JSON value type 'undefined'/,
  );
});
