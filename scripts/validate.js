/**
 * NPC State Alpha — S4 Repository Validation Script
 *
 * Verifies:
 * - Module imports and dependency reachability
 * - Version consistency between package.json, wire contracts, and documentation
 * - Canonical C02 ownership coverage
 * - Production wire examples validity
 * - S4 Development settings/queue/provider/context integration
 * - Absence of accidental S5+ runtime scaffolding or external runtime dependencies
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runValidation() {
  console.log('--- NPC State Alpha: S4 Repository Validation ---');
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

  // S4 single settings registry invariants (C09/C14)
  if (contract.ALPHA_SETTINGS_SCHEMA_VERSION !== 1) {
    fail(`ALPHA_SETTINGS_SCHEMA_VERSION expected 1, got ${contract.ALPHA_SETTINGS_SCHEMA_VERSION}`);
  } else {
    pass('Alpha settings schema version is 1.');
  }
  if (contract.ALPHA_SETTINGS_DEFAULTS?.developmentCadence !== 3 ||
      contract.DEVELOPMENT_MIN_CADENCE !== 1 ||
      contract.DEVELOPMENT_MAX_CADENCE !== 10 ||
      contract.DEVELOPMENT_MAX_BATCH_EXCHANGES !== 6) {
    fail('S4 Development scheduling defaults/bounds are inconsistent with C09.');
  } else {
    const normalized = contract.normalizeAlphaSettings({ developmentCadence: 99 });
    if (normalized.developmentCadence !== 10) {
      fail('S4 settings normalization did not enforce cadence upper bound 10.');
    } else {
      pass('S4 Development settings registry verified: cadence default 3, range 1..10, max batch 6.');
    }
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

  // 6. Check S2 runtime imports, state schema, storage CAS, and commit coordinator
  let runtime;
  try {
    runtime = await import('../src/runtime/index.js');
    pass('src/runtime/index.js imported successfully.');
  } catch (err) {
    fail(`Failed to import src/runtime/index.js: ${err.message}`);
    return 1;
  }

  // Verify S2 state schema invariants
  if (runtime.ALPHA_NAMESPACE !== 'npc_state_alpha.v1') {
    fail(`ALPHA_NAMESPACE expected 'npc_state_alpha.v1', got '${runtime.ALPHA_NAMESPACE}'`);
  } else {
    pass("ALPHA_NAMESPACE verified as 'npc_state_alpha.v1'");
  }

  if (runtime.ALPHA_SCHEMA_VERSION !== 1) {
    fail(`ALPHA_SCHEMA_VERSION expected 1, got ${runtime.ALPHA_SCHEMA_VERSION}`);
  } else {
    pass('ALPHA_SCHEMA_VERSION verified as 1');
  }

  const initialState = runtime.createInitialState();
  const stateVal = runtime.validateState(initialState);
  if (!stateVal.valid) {
    fail(`createInitialState() failed validateState(): ${stateVal.errors.join('; ')}`);
  } else {
    pass('createInitialState() passes validateState()');
  }

  // Verify S2 storage adapter and CAS mechanics
  const storage = new runtime.MemoryStorageAdapter();
  const initLoad = await storage.load();
  if (initLoad.revision !== 0 || initLoad.state.namespace !== 'npc_state_alpha.v1') {
    fail('MemoryStorageAdapter failed initial load check.');
  } else {
    pass('MemoryStorageAdapter CAS initial load verified.');
  }

  // Verify S2 core primitives exist and are functions
  const requiredS2Functions = [
    'createDefaultNpcRecord',
    'validateState',
    'cloneState',
    'createCheckpoint',
    'validateCheckpoint',
    'resolveSourceReference',
    'stripMachineTrailer',
    'resolveIdentityBatch',
    'applyFieldProposal',
    'applyNpcProposals',
    'CommitCoordinator',
  ];

  for (const fnName of requiredS2Functions) {
    if (typeof runtime[fnName] !== 'function') {
      fail(`Expected S2 runtime export '${fnName}' to be a function, found ${typeof runtime[fnName]}`);
    }
  }
  pass(`All ${requiredS2Functions.length} S2 runtime primitives verified.`);

  // 7. S3 Host Integration Positive Checks
  let host;
  try {
    host = await import('../src/host/index.js');
    pass('src/host/index.js imported successfully.');
  } catch (err) {
    fail(`Failed to import src/host/index.js: ${err.message}`);
    return 1;
  }

  const requiredS3Classes = [
    'SillyTavernAdapter',
    'SillyTavernStorageAdapter',
    'PromptInjector',
    'DiagnosticsLedger',
    'computeContentFingerprint',
    'buildPrecedingLineage',
  ];

  for (const name of requiredS3Classes) {
    if (typeof host[name] !== 'function') {
      fail(`Expected S3 host export '${name}' to be a function/class, found ${typeof host[name]}`);
    }
  }
  pass(`All ${requiredS3Classes.length} S3 host primitives verified.`);

  const requiredS4HostExports = [
    'DevelopmentReviewQueue',
    'SillyTavernDevelopmentProvider',
    'buildDevelopmentDispatch',
    'buildDevelopmentExchangeContext',
    'selectDevelopmentBatch',
    'deriveDevelopmentReadDependencies',
    'validateDevelopmentResponseScope',
  ];
  for (const name of requiredS4HostExports) {
    if (typeof host[name] !== 'function') {
      fail(`Expected S4 host export '${name}' to be a function/class, found ${typeof host[name]}`);
    }
  }
  pass(`All ${requiredS4HostExports.length} S4 Development host primitives verified.`);

  // Verify root entrypoint index.js
  let rootIndex;
  try {
    rootIndex = await import('../index.js');
    if (
      typeof rootIndex.initExtension !== 'function' ||
      typeof rootIndex.getActiveAdapter !== 'function' ||
      typeof rootIndex.getActiveDevelopmentReview !== 'function'
    ) {
      fail('Root index.js missing initExtension, getActiveAdapter, or getActiveDevelopmentReview export.');
    } else {
      pass('Root index.js exports S3 adapter and S4 Development scheduler accessors.');
    }
  } catch (err) {
    fail(`Failed to import root index.js: ${err.message}`);
  }

  // Verify manifest.json integrity & neutral attribution
  const manifestPath = path.join(rootDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fail('manifest.json is missing.');
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.js !== 'index.js') {
        fail(`manifest.json 'js' expected 'index.js', got '${manifest.js}'`);
      }
      if (manifest.generate_interceptor !== 'npc_state_alpha_generate_interceptor') {
        fail(`manifest.json 'generate_interceptor' expected 'npc_state_alpha_generate_interceptor', got '${manifest.generate_interceptor}'`);
      }
      if (typeof manifest.author === 'string' && manifest.author.toLowerCase().includes('deepmind')) {
        fail("manifest.json author must not claim Google DeepMind (neutral attribution required).");
      } else {
        pass('manifest.json verified with valid entrypoint, interceptor key, and neutral attribution.');
      }
    } catch (e) {
      fail(`Failed to parse manifest.json: ${e.message}`);
    }
  }

  // Verify packaging script exists
  const packageScriptPath = path.join(rootDir, 'scripts/package.js');
  if (!fs.existsSync(packageScriptPath)) {
    fail('scripts/package.js packaging script is missing.');
  } else {
    pass('scripts/package.js exists.');
  }

  // 8. Explicit S5+ absence checks. S4 Development orchestration is now expected.
  const forbiddenS5Paths = [
    'src/ui',
    'src/importer',
    'src/history-rebuild',
    'src/packaging',
  ];

  for (const p of forbiddenS5Paths) {
    if (fs.existsSync(path.join(rootDir, p))) {
      fail(`Accidental S5+ path created prematurely: ${p}`);
    }
  }
  pass('Confirmed no accidental S5+ UI/history/import runtime modules exist.');

  console.log(`--- S4 Validation finished with ${errors} error(s) ---`);
  return errors === 0 ? 0 : 1;
}

runValidation().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error('Unexpected validation failure:', err);
  process.exit(1);
});
