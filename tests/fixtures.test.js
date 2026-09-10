import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAndParseOnePassTrailer,
  EXTRACTION_ERROR_CODES,
} from '../src/contract/parser.js';
import {
  validateOnePassEnvelope,
  validateDevelopmentEnvelope,
  VALIDATION_ERROR_CODES,
} from '../src/contract/validator.js';

import * as onePassFixtures from './fixtures/one-pass-fixtures.js';
import * as devFixtures from './fixtures/development-fixtures.js';
import * as trailerFixtures from './fixtures/trailer-fixtures.js';
import * as adapterFixtures from './fixtures/structured-adapter-fixtures.js';

test('Fixtures Suite: All One-Pass acceptance fixtures behave according to S1 workplan', () => {
  // Valid fixtures
  assert.equal(validateOnePassEnvelope(onePassFixtures.validNewNamedAndRoleLabel).valid, true);
  assert.equal(validateOnePassEnvelope(onePassFixtures.validMultipleNewAmbiguousNames).valid, true);
  assert.equal(validateOnePassEnvelope(onePassFixtures.validExistingLiveDelta).valid, true);
  assert.equal(validateOnePassEnvelope(onePassFixtures.validZeroScoreInteraction).valid, true);
  assert.equal(validateOnePassEnvelope(onePassFixtures.validNewFormBeforeDurableDefinition).valid, true);
  assert.equal(validateOnePassEnvelope(onePassFixtures.validTerminalDeath).valid, true);

  // Rejection fixtures
  const missingRef = validateOnePassEnvelope(onePassFixtures.invalidNewMissingLocalRef);
  assert.equal(missingRef.valid, false);
  assert.ok(missingRef.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_IDENTITY));

  const dupRef = validateOnePassEnvelope(onePassFixtures.invalidNewDuplicateLocalRef);
  assert.equal(dupRef.valid, false);
  assert.ok(dupRef.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.DUPLICATE_LOCAL_REF));

  const missingEval = validateOnePassEnvelope(onePassFixtures.invalidActiveMissingEvaluation);
  assert.equal(missingEval.valid, false);
  assert.ok(missingEval.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.MISSING_RELATIONSHIP_EVALUATION));

  const wrongWriter = validateOnePassEnvelope(onePassFixtures.invalidOnePassWritingDurable);
  assert.equal(wrongWriter.valid, false);
  assert.ok(wrongWriter.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.WRONG_WRITER));

  const livingReturn = validateOnePassEnvelope(onePassFixtures.invalidResurrectionLivingReturn);
  assert.equal(livingReturn.valid, false);
  assert.ok(livingReturn.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION));

  // New regression fixtures
  assert.equal(validateOnePassEnvelope(onePassFixtures.validMistakenVictimSemanticBoundary).valid, true);

  const directLife = validateOnePassEnvelope(onePassFixtures.invalidDirectLifeStateBypass);
  assert.equal(directLife.valid, false);
  assert.ok(directLife.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION));

  const arbSource = validateOnePassEnvelope(onePassFixtures.invalidArbitraryOnePassSourceRef);
  assert.equal(arbSource.valid, false);
  assert.ok(arbSource.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE));

  const existNew = validateOnePassEnvelope(onePassFixtures.invalidExistingWithNewIdentityMetadata);
  assert.equal(existNew.valid, false);
  assert.ok(existNew.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_IDENTITY));

  const zeroAxes = validateOnePassEnvelope(onePassFixtures.invalidShiftedTrueAllZeroAxes);
  assert.equal(zeroAxes.valid, false);
  assert.ok(zeroAxes.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION));

  const unknownTop = validateOnePassEnvelope(onePassFixtures.invalidOnePassUnknownTopLevelKey);
  assert.equal(unknownTop.valid, false);
  assert.ok(unknownTop.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));

  const unknownProp = validateOnePassEnvelope(onePassFixtures.invalidOnePassUnknownProposalKey);
  assert.equal(unknownProp.valid, false);
  assert.ok(unknownProp.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Fixtures Suite: All Development review acceptance fixtures behave according to S1 workplan', () => {
  // Valid fixtures
  assert.equal(validateDevelopmentEnvelope(devFixtures.validDevelopmentEstablishment).valid, true);
  assert.equal(validateDevelopmentEnvelope(devFixtures.validDevelopmentEnrichment).valid, true);
  assert.equal(validateDevelopmentEnvelope(devFixtures.validObservationsWithDispositions).valid, true);
  assert.equal(validateDevelopmentEnvelope(devFixtures.validNarrowReviewReceipt).valid, true);
  assert.equal(validateDevelopmentEnvelope(devFixtures.validNoOpReceipt).valid, true);

  // Rejection fixtures
  const wrongWriter = validateDevelopmentEnvelope(devFixtures.invalidDevelopmentWritingImmediate);
  assert.equal(wrongWriter.valid, false);
  assert.ok(wrongWriter.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.WRONG_WRITER));

  const structuredDurable = validateDevelopmentEnvelope(devFixtures.invalidDurableStructuredOnly);
  assert.equal(structuredDurable.valid, false);
  assert.ok(structuredDurable.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));

  const obsPersistentId = validateDevelopmentEnvelope(devFixtures.invalidObservationWithPersistentId);
  assert.equal(obsPersistentId.valid, false);
  assert.ok(obsPersistentId.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OBSERVATION));

  const dupObsRef = validateDevelopmentEnvelope(devFixtures.invalidObservationDuplicateLocalRef);
  assert.equal(dupObsRef.valid, false);
  assert.ok(dupObsRef.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.DUPLICATE_LOCAL_REF));

  const missingLink = validateDevelopmentEnvelope(devFixtures.invalidDispositionMissingLink);
  assert.equal(missingLink.valid, false);
  assert.ok(missingLink.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_OBSERVATION));

  const unrestSubset = validateDevelopmentEnvelope(devFixtures.invalidUnrestrictedReceiptWithFieldSubset);
  assert.equal(unrestSubset.valid, false);
  assert.ok(unrestSubset.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RECEIPT));

  const restBookkeeping = validateDevelopmentEnvelope(devFixtures.invalidRestrictedReceiptWithInternalBookkeeping);
  assert.equal(restBookkeeping.valid, false);
  assert.ok(restBookkeeping.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_RECEIPT));

  const suppMissingObs = validateDevelopmentEnvelope(devFixtures.invalidSupportProposalMissingObservation);
  assert.equal(suppMissingObs.valid, false);
  assert.ok(suppMissingObs.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT));

  const suppTargetMismatch = validateDevelopmentEnvelope(devFixtures.invalidSupportProposalTargetMismatch);
  assert.equal(suppTargetMismatch.valid, false);
  assert.ok(suppTargetMismatch.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT));

  const suppFieldMismatch = validateDevelopmentEnvelope(devFixtures.invalidSupportProposalFieldMismatch);
  assert.equal(suppFieldMismatch.valid, false);
  assert.ok(suppFieldMismatch.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT));

  const devUnknownTop = validateDevelopmentEnvelope(devFixtures.invalidDevelopmentUnknownTopLevelKey);
  assert.equal(devUnknownTop.valid, false);
  assert.ok(devUnknownTop.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));

  const devUnknownProp = validateDevelopmentEnvelope(devFixtures.invalidDevelopmentUnknownProposalKey);
  assert.equal(devUnknownProp.valid, false);
  assert.ok(devUnknownProp.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNKNOWN_KEY));
});

test('Fixtures Suite: All Trailer extraction fixtures behave according to C04 specification', () => {
  assert.equal(extractAndParseOnePassTrailer(trailerFixtures.validTrailerText).success, true);

  assert.equal(extractAndParseOnePassTrailer(trailerFixtures.missingTrailerText).errorCode, EXTRACTION_ERROR_CODES.MISSING_TRAILER);
  assert.equal(extractAndParseOnePassTrailer(trailerFixtures.duplicateTrailerText).errorCode, EXTRACTION_ERROR_CODES.DUPLICATE_TRAILER);
  assert.equal(extractAndParseOnePassTrailer(trailerFixtures.truncatedTrailerText).errorCode, EXTRACTION_ERROR_CODES.TRUNCATED_TRAILER);
  assert.equal(extractAndParseOnePassTrailer(trailerFixtures.trailerNotAtEndText).errorCode, EXTRACTION_ERROR_CODES.TRAILER_NOT_AT_END);
  assert.equal(extractAndParseOnePassTrailer(trailerFixtures.malformedJsonTrailerText).errorCode, EXTRACTION_ERROR_CODES.MALFORMED_JSON);
  assert.equal(extractAndParseOnePassTrailer(trailerFixtures.trailerSelfCitationText).errorCode, EXTRACTION_ERROR_CODES.TRAILER_SELF_CITATION);
});

test('Fixtures Suite: All Structured Adapter boundary fixtures behave according to C03 specification', () => {
  assert.equal(validateOnePassEnvelope(adapterFixtures.validWorldStateCorroboration).valid, true);
  assert.equal(validateOnePassEnvelope(adapterFixtures.validInnerChatterSupport).valid, true);
  assert.equal(validateOnePassEnvelope(adapterFixtures.validSameEventCopyLinkageFixture).valid, true);

  const structAdmin = validateOnePassEnvelope(adapterFixtures.rejectedWorldStateAdmission);
  assert.equal(structAdmin.valid, false);
  assert.ok(structAdmin.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));

  const structDeath = validateOnePassEnvelope(adapterFixtures.rejectedWorldStateDeath);
  assert.equal(structDeath.valid, false);
  assert.ok(structDeath.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));

  const structPresence = validateOnePassEnvelope(adapterFixtures.rejectedInnerChatterPresence);
  assert.equal(structPresence.valid, false);
  assert.ok(structPresence.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));

  const structScore = validateOnePassEnvelope(adapterFixtures.rejectedWorldStateRelationshipScoring);
  assert.equal(structScore.valid, false);
  assert.ok(structScore.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));

  const structDurable = validateDevelopmentEnvelope(adapterFixtures.rejectedWorldStateDurableFacts);
  assert.equal(structDurable.valid, false);
  assert.ok(structDurable.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION));

  const unverified = validateOnePassEnvelope(adapterFixtures.rejectedUnverifiedAdapterSegment);
  assert.equal(unverified.valid, false);
  assert.ok(unverified.errors.some((e) => e.errorCode === VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT));
});

