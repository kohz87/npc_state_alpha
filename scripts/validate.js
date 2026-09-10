/**
 * NPC State Alpha — S1 Repository Validation Script
 *
 * Verifies:
 * - Module imports and dependency reachability
 * - Version consistency between package.json, wire contracts, and documentation
 * - Canonical C02 ownership coverage
 * - Production wire examples validity
 * - Absence of accidental S2+ runtime scaffolding or external runtime dependencies
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runValidation() {
  console.log('--- NPC State Alpha: S1 Repository Validation (Substantially Complete - Final Acceptance Pending) ---');
  let errors = 0;

  function fail(msg) {
    console.error(`[FAIL] ${msg}`);
    errors++;
  }

  function pass(msg) {
    console.log(`[PASS] ${msg}`);
  }

  // 1. Check package.json
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fail('package.json is missing.');
    return 1;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pass(`package.json exists with version ${pkg.version}`);

  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    fail(`S1 should have zero external runtime dependencies, found: ${Object.keys(pkg.dependencies).join(', ')}`);
  } else {
    pass('Zero external runtime dependencies verified (Node built-ins used).');
  }

  // 2. Check imports from barrel index
  let contract;
  try {
    contract = await import('../src/contract/index.js');
    pass('src/contract/index.js imported successfully.');
  } catch (err) {
    fail(`Failed to import src/contract/index.js: ${err.message}`);
    return 1;
  }

  // 3. Verify C02 coverage & ownership invariants
  const requiredC02Fields = [
    'id', 'localRef', 'name', 'aliases', 'identityKind',
    'present', 'activeInExchange', 'offscreenActivity',
    'mood', 'location', 'goal', 'status',
    'currentPresentation', 'currentForm', 'relationshipEvaluation', 'lifeState',
    'relationshipDynamic', 'canonicalAppearance', 'appearanceForms',
    'personality', 'behavioralProfile', 'speech', 'mannerisms',
    'role', 'species', 'background', 'actualAge', 'apparentAge', 'birthday',
    'importantMemories', 'nonPlayerRelationships',
    'observations', 'acceptedSupport', 'reviewReceipts',
    'portrait', 'importance', 'locks', 'manualCorrections',
  ];

  for (const field of requiredC02Fields) {
    if (!contract.CANONICAL_FIELDS[field]) {
      fail(`C02 canonical field '${field}' missing from registry.`);
    }
  }
  const totalCanonicalFields = Object.keys(contract.CANONICAL_FIELDS).length;
  if (totalCanonicalFields !== requiredC02Fields.length) {
    fail(`Expected ${requiredC02Fields.length} canonical fields in registry, found ${totalCanonicalFields}.`);
  } else {
    pass(`All ${requiredC02Fields.length} C02 canonical fields verified in registry.`);
  }

  // Verify runtime ownership invariants (C02/C08)
  if (contract.CANONICAL_FIELDS.acceptedSupport.automaticWriter !== contract.WRITERS.RUNTIME) {
    fail(`acceptedSupport automaticWriter expected '${contract.WRITERS.RUNTIME}', got '${contract.CANONICAL_FIELDS.acceptedSupport.automaticWriter}'`);
  } else {
    pass('acceptedSupport is strictly owned by Runtime in canonical registry.');
  }

  if (contract.CANONICAL_FIELDS.reviewReceipts.automaticWriter !== contract.WRITERS.RUNTIME) {
    fail(`reviewReceipts automaticWriter expected '${contract.WRITERS.RUNTIME}', got '${contract.CANONICAL_FIELDS.reviewReceipts.automaticWriter}'`);
  } else {
    pass('reviewReceipts is strictly owned by Runtime in canonical registry.');
  }

  // Verify manualCorrections runtime ownership
  if (!contract.CANONICAL_FIELDS.manualCorrections?.allowedWriters?.includes(contract.WRITERS.RUNTIME)) {
    fail(`manualCorrections allowedWriters expected to include '${contract.WRITERS.RUNTIME}'`);
  } else {
    pass('manualCorrections includes Runtime in allowedWriters.');
  }

  // Verify separated personality facets
  const personalityFacets = ['personality', 'behavioralProfile', 'speech', 'mannerisms'];
  for (const facet of personalityFacets) {
    if (contract.CANONICAL_FIELDS[facet]?.automaticWriter !== contract.WRITERS.DEVELOPMENT) {
      fail(`${facet} automaticWriter expected '${contract.WRITERS.DEVELOPMENT}', got '${contract.CANONICAL_FIELDS[facet]?.automaticWriter}'`);
    }
  }
  pass('Separated personality facets (personality, behavioralProfile, speech, mannerisms) verified under Development writer.');

  // Verify segment permission validation
  if (typeof contract.validateSegmentFieldPermission !== 'function') {
    fail('validateSegmentFieldPermission function is missing from exports.');
  } else {
    const wsMoodPerm = contract.validateSegmentFieldPermission({ segmentKind: 'world_state' }, 'mood');
    const wsLocPerm = contract.validateSegmentFieldPermission({ segmentKind: 'world_state' }, 'location');
    if (wsMoodPerm.valid !== false || wsLocPerm.valid !== true) {
      fail('validateSegmentFieldPermission failed baseline sanity check (world_state mood vs location).');
    } else {
      pass('Centralized segment permission validation verified.');
    }
  }

  // Verify audit masks exclude runtime bookkeeping
  const devMask = contract.OPERATION_MASKS[contract.AUDIT_OPERATIONS.REVIEW_PENDING];
  const recMask = contract.OPERATION_MASKS[contract.AUDIT_OPERATIONS.RECOVERY_REBUILD];
  if (devMask.includes('acceptedSupport') || devMask.includes('reviewReceipts') ||
      recMask.includes('acceptedSupport') || recMask.includes('reviewReceipts')) {
    fail('Runtime bookkeeping fields found inside model audit masks.');
  } else {
    pass('Audit masks correctly exclude runtime bookkeeping fields.');
  }

  // Verify provenance validation helper
  if (typeof contract.validateOwnedSourceRecord !== 'function') {
    fail('validateOwnedSourceRecord function is missing from exports.');
  } else {
    pass('validateOwnedSourceRecord provenance function verified.');
  }

  // 4. Verify version consistency
  if (pkg.version !== '0.1.0') {
    fail(`package.json version expected '0.1.0', got '${pkg.version}'`);
  } else {
    pass("package.json version is '0.1.0'");
  }

  const devMdPath = path.join(rootDir, 'DEVELOPMENT.md');
  if (fs.existsSync(devMdPath)) {
    const devMd = fs.readFileSync(devMdPath, 'utf8');
    if (!devMd.includes('0.1.0')) {
      fail("DEVELOPMENT.md does not document package version '0.1.0'");
    } else {
      pass("DEVELOPMENT.md version aligns with package.json ('0.1.0').");
    }
  }

  if (contract.ALPHA_ONE_PASS_WIRE_VERSION !== '1') {
    fail(`ALPHA_ONE_PASS_WIRE_VERSION expected '1', got '${contract.ALPHA_ONE_PASS_WIRE_VERSION}'`);
  } else {
    pass("One-pass wire version is '1'");
  }

  if (contract.ALPHA_DEVELOPMENT_WIRE_VERSION !== '1') {
    fail(`ALPHA_DEVELOPMENT_WIRE_VERSION expected '1', got '${contract.ALPHA_DEVELOPMENT_WIRE_VERSION}'`);
  } else {
    pass("Development wire version is '1'");
  }

  // 5. Verify production examples parse and validate
  const minEmptyParse = contract.extractAndParseOnePassTrailer(contract.ONE_PASS_MINIMAL_EMPTY_TEXT);
  if (!minEmptyParse.success) {
    fail(`ONE_PASS_MINIMAL_EMPTY_TEXT failed parsing: ${minEmptyParse.errorMessage}`);
  } else {
    const minEmptyVal = contract.validateOnePassEnvelope(minEmptyParse.payload);
    if (!minEmptyVal.valid) {
      fail(`ONE_PASS_MINIMAL_EMPTY_TEXT failed validation: ${JSON.stringify(minEmptyVal.errors)}`);
    } else {
      pass('ONE_PASS_MINIMAL_EMPTY_TEXT parsed and validated successfully.');
    }
  }

  const popParse = contract.extractAndParseOnePassTrailer(contract.ONE_PASS_POPULATED_TEXT);
  if (!popParse.success) {
    fail(`ONE_PASS_POPULATED_TEXT failed parsing: ${popParse.errorMessage}`);
  } else {
    const popVal = contract.validateOnePassEnvelope(popParse.payload);
    if (!popVal.valid) {
      fail(`ONE_PASS_POPULATED_TEXT failed validation: ${JSON.stringify(popVal.errors)}`);
    } else {
      pass('ONE_PASS_POPULATED_TEXT parsed and validated successfully.');
    }
  }

  const devParse = contract.parseDevelopmentResponse(contract.DEVELOPMENT_REVIEW_RAW_TEXT);
  if (!devParse.success) {
    fail(`DEVELOPMENT_REVIEW_RAW_TEXT failed parsing: ${devParse.errorMessage}`);
  } else {
    const devVal = contract.validateDevelopmentEnvelope(devParse.payload);
    if (!devVal.valid) {
      fail(`DEVELOPMENT_REVIEW_RAW_TEXT failed validation: ${JSON.stringify(devVal.errors)}`);
    } else {
      pass('DEVELOPMENT_REVIEW_RAW_TEXT parsed and validated successfully.');
    }
  }

  // 6. Check that S2 runtime files have NOT been created prematurely
  const forbiddenS2Paths = [
    'src/state',
    'src/runtime',
    'src/storage',
    'src/queue',
    'src/ui',
    'src/host',
  ];

  for (const p of forbiddenS2Paths) {
    if (fs.existsSync(path.join(rootDir, p))) {
      fail(`Accidental S2+ directory created prematurely: ${p}`);
    }
  }
  pass('Confirmed no accidental S2+ runtime directories exist.');

  console.log(`--- S1 Validation finished with ${errors} error(s) (Contract Layer Verified - Final Acceptance Pending) ---`);
  return errors === 0 ? 0 : 1;
}

runValidation().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error('Unexpected validation failure:', err);
  process.exit(1);
});
