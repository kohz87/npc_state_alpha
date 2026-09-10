import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAndParseOnePassTrailer,
  EXTRACTION_ERROR_CODES,
  parseDevelopmentResponse,
  DEVELOPMENT_PARSE_ERROR_CODES,
} from '../src/contract/parser.js';
import {
  validTrailerText,
  missingTrailerText,
  duplicateTrailerText,
  truncatedTrailerText,
  trailerNotAtEndText,
  malformedJsonTrailerText,
  trailerSelfCitationText,
} from './fixtures/trailer-fixtures.js';

test('Parser: successfully extracts narrative and trailer payload from valid response', () => {
  const result = extractAndParseOnePassTrailer(validTrailerText);
  assert.equal(result.success, true);
  assert.equal(result.errorCode, null);
  assert.equal(result.narrative, 'The tavern door creaked open, admitting a gust of chilly wind and rain.');
  assert.ok(result.payload);
  assert.equal(result.payload.version, '1');
  assert.equal(result.payload.proposals.length, 1);
  assert.equal(result.payload.proposals[0].id, 'npc_barkeep_01');
  assert.equal(result.payload.proposals[0].mood, 'annoyed');
});

test('Parser: fails when machine trailer is missing', () => {
  const result = extractAndParseOnePassTrailer(missingTrailerText);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, EXTRACTION_ERROR_CODES.MISSING_TRAILER);
  assert.equal(result.payload, null);
  // Authoritative narrative remains available even on failure
  assert.equal(result.narrative, missingTrailerText);
});

test('Parser: fails when machine trailer is duplicated', () => {
  const result = extractAndParseOnePassTrailer(duplicateTrailerText);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, EXTRACTION_ERROR_CODES.DUPLICATE_TRAILER);
  assert.equal(result.payload, null);
});

test('Parser: fails when machine trailer is truncated / unclosed', () => {
  const result = extractAndParseOnePassTrailer(truncatedTrailerText);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, EXTRACTION_ERROR_CODES.TRUNCATED_TRAILER);
  assert.equal(result.payload, null);
});

test('Parser: fails when machine trailer is not at the end of narrative', () => {
  const result = extractAndParseOnePassTrailer(trailerNotAtEndText);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, EXTRACTION_ERROR_CODES.TRAILER_NOT_AT_END);
  assert.equal(result.payload, null);
});

test('Parser: fails when JSON in trailer is malformed', () => {
  const result = extractAndParseOnePassTrailer(malformedJsonTrailerText);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, EXTRACTION_ERROR_CODES.MALFORMED_JSON);
  assert.equal(result.payload, null);
});

test('Parser: rejects trailer self-citation in source excerpts (C03 transport exclusion)', () => {
  const result = extractAndParseOnePassTrailer(trailerSelfCitationText);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, EXTRACTION_ERROR_CODES.TRAILER_SELF_CITATION);
});

test('Development Parser: successfully parses valid exact JSON object', () => {
  const validJson = JSON.stringify({ version: '1', proposals: [] }, null, 2);
  const result = parseDevelopmentResponse(validJson);
  assert.equal(result.success, true);
  assert.equal(result.errorCode, null);
  assert.deepEqual(result.payload, { version: '1', proposals: [] });
});

test('Development Parser: rejects malformed JSON', () => {
  const malformed = '{ version: "1", proposals: [ }';
  const result = parseDevelopmentResponse(malformed);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, DEVELOPMENT_PARSE_ERROR_CODES.MALFORMED_JSON);
  assert.equal(result.payload, null);
});

test('Development Parser: rejects multiple JSON objects', () => {
  const multiple = '{"version": "1", "proposals": []}\n{"version": "1", "proposals": []}';
  const result = parseDevelopmentResponse(multiple);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, DEVELOPMENT_PARSE_ERROR_CODES.MULTIPLE_OBJECTS);
  assert.equal(result.payload, null);
});

test('Development Parser: rejects leading commentary before JSON object', () => {
  const withCommentary = 'Here is the development review envelope:\n{"version": "1", "proposals": []}';
  const result = parseDevelopmentResponse(withCommentary);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, DEVELOPMENT_PARSE_ERROR_CODES.COMMENTARY_DETECTED);
  assert.equal(result.payload, null);
});

test('Development Parser: rejects markdown code fences', () => {
  const fenced = '```json\n{"version": "1", "proposals": []}\n```';
  const result = parseDevelopmentResponse(fenced);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, DEVELOPMENT_PARSE_ERROR_CODES.FENCED_JSON);
  assert.equal(result.payload, null);
});

test('Development Parser: rejects trailing garbage or commentary after JSON object', () => {
  const trailing = '{"version": "1", "proposals": []}\nI hope this looks good!';
  const result = parseDevelopmentResponse(trailing);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, DEVELOPMENT_PARSE_ERROR_CODES.TRAILING_GARBAGE);
  assert.equal(result.payload, null);
});

test('Development Parser: rejects empty string, whitespace, and non-string inputs', () => {
  assert.equal(parseDevelopmentResponse('').errorCode, DEVELOPMENT_PARSE_ERROR_CODES.EMPTY_INPUT);
  assert.equal(parseDevelopmentResponse('   \n\t  ').errorCode, DEVELOPMENT_PARSE_ERROR_CODES.EMPTY_INPUT);
  assert.equal(parseDevelopmentResponse(null).errorCode, DEVELOPMENT_PARSE_ERROR_CODES.EMPTY_INPUT);
  assert.equal(parseDevelopmentResponse(undefined).errorCode, DEVELOPMENT_PARSE_ERROR_CODES.EMPTY_INPUT);
  assert.equal(parseDevelopmentResponse(123).errorCode, DEVELOPMENT_PARSE_ERROR_CODES.EMPTY_INPUT);
});

test('Development Parser: rejects array root', () => {
  const arrayRoot = '[{"version": "1"}]';
  const result = parseDevelopmentResponse(arrayRoot);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, DEVELOPMENT_PARSE_ERROR_CODES.INVALID_ROOT_TYPE);
  assert.equal(result.payload, null);
});

test('Development Parser: rejects primitive JSON root values', () => {
  assert.equal(parseDevelopmentResponse('"just a string"').errorCode, DEVELOPMENT_PARSE_ERROR_CODES.INVALID_ROOT_TYPE);
  assert.equal(parseDevelopmentResponse('42').errorCode, DEVELOPMENT_PARSE_ERROR_CODES.INVALID_ROOT_TYPE);
  assert.equal(parseDevelopmentResponse('true').errorCode, DEVELOPMENT_PARSE_ERROR_CODES.INVALID_ROOT_TYPE);
  assert.equal(parseDevelopmentResponse('null').errorCode, DEVELOPMENT_PARSE_ERROR_CODES.INVALID_ROOT_TYPE);
});

test('Development Parser: permits literal markdown code fences inside JSON string values', () => {
  const payloadWithFencedString = {
    version: '1',
    proposals: [
      {
        targetId: 'npc_barkeep_01',
        mannerisms: {
          operation: 'enrich',
          value: 'Quotes code like:\n```js\nconsole.log("hello");\n```\nwhen nervous.',
          source: {
            sourceRef: 'msg:2',
            excerpt: 'Elena noted: ```js\nconsole.log("hello");\n``` as an example.',
          },
        },
      },
    ],
  };
  const rawText = JSON.stringify(payloadWithFencedString, null, 2);
  const result = parseDevelopmentResponse(rawText);
  assert.equal(result.success, true);
  assert.equal(result.errorCode, null);
  assert.deepEqual(result.payload, payloadWithFencedString);
});
