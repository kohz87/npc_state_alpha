import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAndParseOnePassTrailer,
  parseDevelopmentResponse,
} from '../src/contract/parser.js';
import {
  validateOnePassEnvelope,
  validateDevelopmentEnvelope,
} from '../src/contract/validator.js';
import {
  ONE_PASS_MINIMAL_EMPTY_TEXT,
  ONE_PASS_POPULATED_TEXT,
  DEVELOPMENT_REVIEW_RAW_TEXT,
} from '../src/contract/examples.js';

test('Production Examples: Minimal empty one-pass envelope parses and validates cleanly', () => {
  const parseResult = extractAndParseOnePassTrailer(ONE_PASS_MINIMAL_EMPTY_TEXT);
  assert.equal(parseResult.success, true, `Parser error: ${parseResult.errorMessage}`);
  assert.ok(parseResult.payload);

  const valResult = validateOnePassEnvelope(parseResult.payload);
  assert.equal(valResult.valid, true, `Validator errors: ${JSON.stringify(valResult.errors)}`);
  assert.equal(valResult.errors.length, 0);
  assert.equal(parseResult.payload.proposals.length, 0);
});

test('Production Examples: Populated one-pass envelope parses and validates cleanly', () => {
  const parseResult = extractAndParseOnePassTrailer(ONE_PASS_POPULATED_TEXT);
  assert.equal(parseResult.success, true, `Parser error: ${parseResult.errorMessage}`);
  assert.ok(parseResult.payload);

  const valResult = validateOnePassEnvelope(parseResult.payload);
  assert.equal(valResult.valid, true, `Validator errors: ${JSON.stringify(valResult.errors)}`);
  assert.equal(valResult.errors.length, 0);

  // Verify key properties from the example
  assert.equal(parseResult.payload.proposals.length, 3);

  const barkeep = parseResult.payload.proposals[0];
  assert.equal(barkeep.localRef, 'new:barkeep');
  assert.equal(barkeep.identityKind, 'role_label');
  assert.equal(barkeep.activeInExchange, true);
  assert.equal(barkeep.relationshipEvaluation.shifted, true);
  assert.equal(barkeep.relationshipEvaluation.axes.tension, 1);

  const brom = parseResult.payload.proposals[1];
  assert.equal(brom.localRef, 'new:brom');
  assert.equal(brom.identityKind, 'named');
  assert.equal(brom.activeInExchange, false);

  const stranger = parseResult.payload.proposals[2];
  assert.equal(stranger.id, 'npc_hooded_stranger_01');
  assert.equal(stranger.currentForm, null); // Unresolved form selector
  assert.equal(stranger.relationshipEvaluation.shifted, false); // Explicit zero shift
});

test('Production Examples: Raw development review text parses and validates cleanly', () => {
  // Strict parser: raw text emitted by development pass -> payload
  const parseResult = parseDevelopmentResponse(DEVELOPMENT_REVIEW_RAW_TEXT);
  assert.equal(parseResult.success, true, `Parser error: ${parseResult.errorMessage}`);
  assert.ok(parseResult.payload);

  // Validator: payload passes strict envelope validation
  const valResult = validateDevelopmentEnvelope(parseResult.payload);
  assert.equal(valResult.valid, true, `Validator errors: ${JSON.stringify(valResult.errors)}`);
  assert.equal(valResult.errors.length, 0);

  // Verify review receipts
  assert.equal(parseResult.payload.reviewReceipts.length, 3);
  assert.equal(parseResult.payload.reviewReceipts[1].status, 'reviewed_no_proposals');
  assert.deepEqual(parseResult.payload.reviewReceipts[2].fieldSubset, ['personality', 'canonicalAppearance']);

  // Verify proposals, observations, and support proposals
  assert.equal(parseResult.payload.proposals.length, 2);
  assert.equal(parseResult.payload.observations.length, 2);
  assert.equal(parseResult.payload.supportProposals.length, 1);
});
