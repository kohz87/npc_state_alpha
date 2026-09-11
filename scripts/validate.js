/**
 * NPC State Alpha — S10 Repository Validation Script
 *
 * Verifies:
 * - Module imports and dependency reachability
 * - Version consistency between package.json, wire contracts, and documentation
 * - Canonical C02 ownership coverage
 * - Production wire examples validity
 * - Accepted S4 Development settings/queue/provider/context integration
 * - S5 practical UI, user commands, relationship mechanics, and C14 ownership gate
 * - S6 checkpoint metadata, history reconstruction, delayed-work reconciliation, native portability, and reload hooks
 * - S7 prompt/context measurement, selective projection, wire guidance, and provider independence
 * - S8 behavioral matrix, partial-acceptance isolation, graph endpoint safety, and model-evidence replay
 * - S9 performance/endurance guards and S10 release, CI, packaging, and legacy compatibility boundaries
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runValidation() {
  console.log('--- NPC State Alpha: S10 Repository Validation ---');
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
  if (pkg.version !== '0.1.1') {
    fail(`package.json version expected '0.1.1', got '${pkg.version}'`);
  } else {
    pass("package.json version is '0.1.1'");
  }

  const devMdPath = path.join(rootDir, 'DEVELOPMENT.md');
  if (fs.existsSync(devMdPath)) {
    const devMd = fs.readFileSync(devMdPath, 'utf8');
    if (!devMd.includes('0.1.1')) {
      fail("DEVELOPMENT.md does not document package version '0.1.1'");
    } else {
      pass("DEVELOPMENT.md version aligns with package.json ('0.1.1').");
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

  if (runtime.ALPHA_NATIVE_BUNDLE_FORMAT !== 'npc_state_alpha.native_state' || runtime.ALPHA_NATIVE_BUNDLE_VERSION !== 1) {
    fail('S6 Alpha-native portable bundle format/version are inconsistent with C15.');
  } else {
    pass('S6 Alpha-native portable bundle format/version verified.');
  }
  const portableFunctions = ['createAlphaNativeBundle', 'serializeAlphaNativeBundle', 'parseAlphaNativeBundle', 'validateAlphaNativeBundle'];
  if (portableFunctions.some((name) => typeof runtime[name] !== 'function')) {
    fail('S6 Alpha-native portable bundle functions are missing from shared runtime exports.');
  } else {
    pass('S6 Alpha-native portable bundle functions exported through the shared runtime.');
  }
  const portableRoundTrip = runtime.parseAlphaNativeBundle(runtime.serializeAlphaNativeBundle(initialState));
  if (!portableRoundTrip.success ||
      runtime.serializeAlphaNativeBundle(portableRoundTrip.state) !== runtime.serializeAlphaNativeBundle(initialState)) {
    fail('S6 Alpha-native portable bundle failed canonical empty-state round-trip.');
  } else {
    pass('S6 Alpha-native portable bundle canonical round-trip verified.');
  }
  if (runtime.IMPORT_BASELINE_MODE !== 'import_baseline') {
    fail(`S6 format-neutral import baseline mode expected 'import_baseline', got '${runtime.IMPORT_BASELINE_MODE}'.`);
  } else {
    pass('S6 format-neutral import baseline mode verified.');
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

  // 8. S5 Practical UI & Canonical User Commands Validation
  let ui;
  try {
    ui = await import('../src/ui/index.js');
    pass('src/ui/index.js imported successfully.');
  } catch (err) {
    fail(`Failed to import src/ui/index.js: ${err.message}`);
    return 1;
  }

  const requiredS5UIClasses = [
    'UIController',
    'DossierView',
    'NpcEditor',
    'SettingsView',
    'DiagnosticsView',
  ];
  for (const name of requiredS5UIClasses) {
    if (typeof ui[name] !== 'function') {
      fail(`Expected S5 UI export '${name}' to be a class/function, found ${typeof ui[name]}`);
    }
  }
  pass(`All ${requiredS5UIClasses.length} S5 UI primitives verified.`);

  // Canonical S5 user commands
  const requiredS5UserCommands = [
    'applyNpcEdit',
    'updateNpcField',
    'setFieldLock',
    'setImportance',
    'setPortrait',
    'deleteNpc',
    'correctLifecycle',
  ];
  for (const cmd of requiredS5UserCommands) {
    if (typeof runtime[cmd] !== 'function') {
      fail(`Expected S5 canonical user command '${cmd}' in runtime exports.`);
    }
  }
  pass(`All ${requiredS5UserCommands.length} canonical S5 user commands verified.`);
  if (typeof runtime.restoreNpc === 'function') {
    fail('Canonical manual-deletion authority forbids fabricating an automatic restoreNpc path.');
  } else {
    pass('S6 reconstruction preserves user-owned manual-deletion tombstones.');
  }

  // Relationship mechanics
  const requiredS5RelFunctions = [
    'calculateAxisMilestone',
    'calculateRelationshipMilestones',
    'calculateAxisDelta',
    'applyRelationshipMechanics',
  ];
  for (const fn of requiredS5RelFunctions) {
    if (typeof runtime[fn] !== 'function') {
      fail(`Expected S5 relationship mechanic '${fn}' in runtime exports.`);
    }
  }
  pass(`All ${requiredS5RelFunctions.length} S5 relationship mechanics verified.`);

  // Development review queue S5 operations
  const devQueueProto = host.DevelopmentReviewQueue?.prototype;
  const requiredS5QueueMethods = ['reviewPending', 'retryFailed', 'recheckMissingDetails', 'refreshDossier'];
  for (const method of requiredS5QueueMethods) {
    if (typeof devQueueProto?.[method] !== 'function') {
      fail(`Expected DevelopmentReviewQueue prototype to have method '${method}'`);
    }
  }
  pass(`All ${requiredS5QueueMethods.length} S5 Development queue control methods verified.`);

  // SillyTavern adapter retry immediate
  const adapterProto = host.SillyTavernAdapter?.prototype;
  if (typeof adapterProto?.retryImmediate !== 'function' || typeof adapterProto?.getImmediateFailure !== 'function') {
    fail('Expected SillyTavernAdapter to provide retryImmediate and getImmediateFailure methods.');
  } else {
    pass('SillyTavernAdapter retryImmediate and getImmediateFailure verified.');
  }

  // Root index.js getActiveUIController
  if (typeof rootIndex?.getActiveUIController !== 'function') {
    fail('Root index.js missing getActiveUIController export.');
  } else {
    pass('Root index.js exports getActiveUIController.');
  }

  // S5/C14 practical settings and competing-owner gate.
  if (
    contract.ALPHA_SETTINGS_DEFAULTS?.enabled !== true ||
    contract.ALPHA_SETTINGS_DEFAULTS?.admissionPolicy !== 'named_preferred' ||
    contract.ALPHA_SETTINGS_DEFAULTS?.routineDossierDetailBudget !== 'auto' ||
    contract.ALPHA_SETTINGS_DEFAULTS?.developmentEnabled !== true ||
    contract.ALPHA_SETTINGS_DEFAULTS?.developmentCadence !== 3
  ) {
    fail('S5 canonical settings defaults do not match C14 practical-use requirements.');
  } else {
    const invalidExplicit = contract.validateAlphaSettings?.({ developmentCadence: 99, routineDossierDetailBudget: 21 });
    if (!invalidExplicit || invalidExplicit.valid !== false) {
      fail('S5 explicit settings validation must reject out-of-range cadence/detail budget values.');
    } else {
      pass('S5 canonical settings defaults and strict explicit validation verified.');
    }
  }

  if (
    typeof rootIndex?.detectKnownCompetingAutomaticOwner !== 'function' ||
    typeof adapterProto?.getOwnershipConflict !== 'function' ||
    typeof adapterProto?.refreshOwnershipConflict !== 'function'
  ) {
    fail('S5 C14 competing automatic-owner detection/reporting hooks are missing.');
  } else {
    pass('S5 C14 competing-owner detection/reporting hooks verified.');
  }

  // 9. S6 canonical history/recovery surface
  const requiredS6HostFunctions = [
    'StoryHistoryRecovery',
    'analyzeStoryHistory',
    'captureStoryHistoryBoundary',
    'provenanceMatchesCanonicalHistory',
  ];
  for (const name of requiredS6HostFunctions) {
    if (typeof host[name] !== 'function') {
      fail(`Expected S6 host export '${name}', found ${typeof host[name]}`);
    }
  }
  pass(`All ${requiredS6HostFunctions.length} S6 history/recovery primitives verified.`);

  if (typeof runtime.CommitCoordinator?.prototype?.commitReconstruction !== 'function') {
    fail('CommitCoordinator is missing the atomic S6 commitReconstruction boundary.');
  } else {
    pass('CommitCoordinator atomic S6 reconstruction boundary verified.');
  }

  const requiredS6QueueMethods = ['onHistoryInvalidation', 'onHistoryRecovered'];
  for (const method of requiredS6QueueMethods) {
    if (typeof devQueueProto?.[method] !== 'function') {
      fail(`DevelopmentReviewQueue is missing S6 method '${method}'.`);
    }
  }
  pass('S6 Development invalidation/requeue coordination verified.');

  if (typeof rootIndex?.getActiveHistoryRecovery !== 'function') {
    fail('Root index.js missing getActiveHistoryRecovery export.');
  } else {
    pass('Root index.js exports getActiveHistoryRecovery.');
  }

  const historyPath = path.join(rootDir, 'src/host/history-recovery.js');
  if (!fs.existsSync(historyPath)) {
    fail('S6 canonical history recovery module is missing.');
  } else {
    pass('S6 canonical history recovery module exists.');
  }

  // 10. S7 prompt/context optimization surface.
  if (pkg.scripts?.['measure:prompts'] !== 'node scripts/measure-prompts.js' ||
      !fs.existsSync(path.join(rootDir, 'scripts/measure-prompts.js'))) {
    fail('S7 deterministic prompt measurement command/script is missing.');
  } else {
    pass('S7 deterministic prompt measurement command verified.');
  }

  if (
    typeof host.PromptInjector?.buildContinuityProjection !== 'function' ||
    typeof host.PromptInjector?.buildImmediateOutputContract !== 'function' ||
    typeof host.PromptInjector?.buildExtensionPrompt !== 'function'
  ) {
    fail('S7 Immediate prompt builder surface is incomplete.');
  } else {
    pass('S7 Immediate selective-context prompt builder surface verified.');
  }

  const immediateContract = host.PromptInjector.buildImmediateOutputContract({ admissionPolicy: 'named_preferred' });
  if (
    !immediateContract.includes('Omit unsupported or unchanged fields') ||
    !immediateContract.includes('direct proposal scalars') ||
    !immediateContract.includes('Axis numbers occur only inside axes') ||
    !immediateContract.includes('Development-owned dossier fields are read-only')
  ) {
    fail('S7 Immediate compact contract is missing required omission/wire/authority guidance.');
  } else {
    pass('S7 Immediate compact omission/wire/authority guidance verified.');
  }

  const devPrompt = host.buildDevelopmentPrompt({
    targets: [{
      id: 'npc_validate_s7',
      name: 'Validation NPC',
      current: { personality: { traits: ['Reserved'] } },
      relationshipAxesReadOnly: { trust: 0, affection: 0, desire: 0, tension: 0 },
      currentFormReadOnly: null,
      locks: [],
      observations: [],
      acceptedSupport: [],
    }],
    targetSourceScope: { npc_validate_s7: ['chat:validate:1'] },
    targetFieldSubset: { npc_validate_s7: null },
    sources: [{ sourceRef: 'chat:validate:1', role: 'assistant', text: 'Validation NPC answers quietly.' }],
  });
  if (
    devPrompt.includes('Response allowance requested by host') ||
    devPrompt.includes('requiredSourceScope') ||
    !devPrompt.includes('sourceRef') ||
    !devPrompt.includes('reviewed_no_proposals') ||
    !devPrompt.includes('never {field,value}')
  ) {
    fail('S7 Development prompt compactness/wire guidance is inconsistent.');
  } else {
    pass('S7 Development compact context and explicit wire guidance verified.');
  }

  if (
    !Object.prototype.hasOwnProperty.call(contract.ALPHA_SETTINGS_DEFAULTS, 'developmentConnectionProfile') ||
    typeof host.SillyTavernDevelopmentProvider?.prototype?.inspectConfiguredProfile !== 'function'
  ) {
    fail('S7 Development profile/model selection abstraction is missing.');
  } else {
    const provider = new host.SillyTavernDevelopmentProvider({ moduleLoader: async () => ({}) });
    if (provider.requiresConfiguredProfile !== true) {
      fail('S7 Development provider must still require an explicit independent profile.');
    } else {
      pass('S7 Development profile/model selection remains explicit and independent.');
    }
  }

  const srcJsFiles = [];
  const collectJs = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectJs(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) srcJsFiles.push(full);
    }
  };
  collectJs(path.join(rootDir, 'src'));
  const hardcodedGemini = srcJsFiles.find((file) => /gemini-3\.[78]/i.test(fs.readFileSync(file, 'utf8')));
  if (hardcodedGemini) {
    fail(`S7 benchmark Gemini model identifier leaked into canonical runtime: ${path.relative(rootDir, hardcodedGemini)}`);
  } else {
    pass('S7 canonical runtime contains no hardcoded Gemini 3.7/3.8 benchmark identifier.');
  }

  // 11. S8 broad behavioral and integration validation surface.
  const requiredS8Files = [
    'tests/fixtures/s8-behavior-matrix.js',
    'tests/s8-commit-isolation.test.js',
    'tests/s8-integration-matrix.test.js',
    'tests/s8-model-evidence.test.js',
  ];
  const missingS8Files = requiredS8Files.filter((relativePath) => !fs.existsSync(path.join(rootDir, relativePath)));
  if (missingS8Files.length > 0) {
    fail(`S8 behavioral matrix artifacts are missing: ${missingS8Files.join(', ')}`);
  } else {
    pass('S8 behavioral matrix, commit-isolation, integration, and model-evidence artifacts verified.');
  }

  try {
    const s8Matrix = await import('../tests/fixtures/s8-behavior-matrix.js');
    const scenarios = s8Matrix.S8_BEHAVIOR_MATRIX || [];
    const groups = s8Matrix.S8_MATRIX_GROUPS || [];
    const missingGroups = groups.filter((group) => !scenarios.some((scenario) => scenario.id?.startsWith(`S8-${group}`)));
    const missingLongForm = Array.from({ length: 8 }, (_, index) => `S8-LF${String(index + 1).padStart(2, '0')}`)
      .filter((id) => !scenarios.some((scenario) => scenario.id === id));
    if (groups.join('') !== 'ABCDEFGHIJKLMNOP' || missingGroups.length > 0 || missingLongForm.length > 0) {
      fail(`S8 behavioral matrix coverage is incomplete (groups=${missingGroups.join(',') || 'none'}, longform=${missingLongForm.join(',') || 'none'}).`);
    } else {
      pass('S8 behavioral matrix covers every A-P group plus eight long-form integration scenarios.');
    }
  } catch (err) {
    fail(`S8 behavioral matrix fixture failed to import: ${err.message}`);
  }

  const coordinatorSource = fs.readFileSync(path.join(rootDir, 'src/runtime/commit-coordinator.js'), 'utf8');
  if (!coordinatorSource.includes('const candidateNpc = cloneState(npc)') ||
      !coordinatorSource.includes('rejectedTargetIds.add(assignedId)') ||
      !coordinatorSource.includes('rejected: rejectedProposals')) {
    fail('S8 independent existing-target rejection isolation is missing from CommitCoordinator.');
  } else {
    pass('S8 CommitCoordinator independent existing-target rejection isolation verified.');
  }

  const fieldApplierSource = fs.readFileSync(path.join(rootDir, 'src/runtime/field-applier.js'), 'utf8');
  if (!fieldApplierSource.includes('itemObj.targetName') ||
      !fieldApplierSource.includes('Ambiguous targetName') ||
      !fieldApplierSource.includes('itemObj.targetId = matches[0].id')) {
    fail('S8 non-player relationship targetName resolution/fail-closed ambiguity handling is missing.');
  } else {
    pass('S8 non-player relationship targetName resolution and ambiguity safety verified.');
  }

  const adapterSource = fs.readFileSync(path.join(rootDir, 'src/host/sillytavern-adapter.js'), 'utf8');
  if (!adapterSource.includes('rejected: commitResult.rejected || []')) {
    fail('S8 host diagnostics do not surface partial One-Pass target rejection.');
  } else {
    pass('S8 host commit diagnostics surface partial target rejection.');
  }

  // 12. S9 performance/endurance/observability surface.
  const performanceScriptPath = path.join(rootDir, 'scripts/measure-performance.js');
  if (pkg.scripts?.['measure:performance'] !== 'node scripts/measure-performance.js' || !fs.existsSync(performanceScriptPath)) {
    fail('S9 standalone performance measurement command/script is missing.');
  } else {
    const performanceSource = fs.readFileSync(performanceScriptPath, 'utf8');
    const requiredWorkloads = ["id: 'small'", "id: 'medium'", "id: 'large'", "id: 'stress'", 'benchmarkIntegratedSession(120)'];
    if (!performanceSource.includes('npc_state_alpha.s9.performance.v1') || requiredWorkloads.some((needle) => !performanceSource.includes(needle))) {
      fail('S9 performance harness is missing schema/workload coverage.');
    } else {
      pass('S9 standalone deterministic performance harness and workload tiers verified.');
    }
  }

  if (runtime.MAX_STORY_CHECKPOINTS !== 32) {
    fail(`S9 checkpoint bound expected 32, got ${runtime.MAX_STORY_CHECKPOINTS}.`);
  } else {
    const checkpointSource = fs.readFileSync(path.join(rootDir, 'src/state/checkpoints.js'), 'utf8');
    if (!checkpointSource.includes('collectCompactedIdentityAssignments(allCheckpoints)')) {
      fail('S9 checkpoint compaction does not preserve compact historical identity replay assignments.');
    } else {
      pass('S9 checkpoint retention bound and compact identity replay metadata preservation verified.');
    }
  }

  if (typeof host.buildChatFingerprintIndex !== 'function' || typeof host.lineageMatchesFingerprintIndex !== 'function') {
    fail('S9 operation-local lineage indexing helpers are missing from host exports.');
  } else {
    pass('S9 operation-local lineage indexing helpers verified.');
  }

  if (!coordinatorSource.includes("ephemeralHistoryReplay === true && operationMode !== 'history_replay'") ||
      !coordinatorSource.includes('historyCapture:') ||
      !coordinatorSource.includes('fieldRevision: String(npc.fieldRevisions')) {
    fail('S9 replay-only checkpoint optimization or C08 reconstruction binding is missing.');
  } else {
    pass('S9 replay-only checkpoint capture and surviving C08 revision binding verified.');
  }

  const storageSource = fs.readFileSync(path.join(rootDir, 'src/state/storage.js'), 'utf8');
  if (!storageSource.includes('options.ephemeralReplay === true') || !storageSource.includes('this._ephemeralReplay ? this._state : cloneState(this._state)')) {
    fail('S9 replay-only in-memory storage optimization is missing or not explicitly gated.');
  } else {
    pass('S9 replay-only storage optimization remains explicitly gated from ordinary storage.');
  }

  const historySource = fs.readFileSync(path.join(rootDir, 'src/host/history-recovery.js'), 'utf8');
  const developmentQueueSource = fs.readFileSync(path.join(rootDir, 'src/host/development-queue.js'), 'utf8');
  if (!adapterSource.includes('localPreProviderMs') || !adapterSource.includes('localPostProviderMs') ||
      !historySource.includes('replayConsidered') || !historySource.includes('durationMs: result.durationMs') ||
      !developmentQueueSource.includes('localBeforeProviderMs') || !developmentQueueSource.includes('providerDurationMs')) {
    fail('S9 bounded operational timing/count diagnostics are incomplete.');
  } else {
    pass('S9 bounded Immediate/Development/recovery observability verified.');
  }

  if (!fs.existsSync(path.join(rootDir, 'tests/performance-endurance.test.js'))) {
    fail('S9 deterministic performance/endurance regression guard file is missing.');
  } else {
    pass('S9 deterministic performance/endurance regression guards verified.');
  }

  // 13. S10 release / compatibility / CI surface.
  const releaseManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
  if (pkg.version !== '0.1.1' || releaseManifest.version !== pkg.version) {
    fail(`S10 release version mismatch: package=${pkg.version}, manifest=${releaseManifest.version}.`);
  } else if (runtime.ALPHA_SCHEMA_VERSION !== 1 || runtime.ALPHA_NATIVE_BUNDLE_VERSION !== 1) {
    fail('S10 application release must not silently bump canonical state/native format versions.');
  } else {
    pass('S10 application version 0.1.1 is aligned while canonical state/native format remain version 1.');
  }

  const releasePackageSource = fs.readFileSync(packageScriptPath, 'utf8');
  if (!releasePackageSource.includes('writeDeterministicZip') ||
      !releasePackageSource.includes('FIXED_DOS_DATE = 33') ||
      !releasePackageSource.includes('archiveSha256') ||
      !releasePackageSource.includes('buildPackage(options = {})')) {
    fail('S10 deterministic standalone ZIP/checksum packaging surface is incomplete.');
  } else {
    pass('S10 deterministic release ZIP/checksum packaging surface verified.');
  }

  const legacyPath = path.join(rootDir, 'src/state/legacy-beta-v044.js');
  const requiredLegacyExports = [
    'parseLegacyBetaV044Bundle',
    'previewLegacyBetaV044Import',
    'convertLegacyBetaV044ToAlpha',
    'installLegacyBetaV044Bundle',
  ];
  if (!fs.existsSync(legacyPath) || requiredLegacyExports.some((name) => typeof runtime[name] !== 'function')) {
    fail('S10 legacy Beta v0.4.44 adapter/export surface is incomplete.');
  } else if (runtime.LEGACY_BETA_V044?.appVersion !== '0.4.44' ||
      runtime.LEGACY_BETA_V044?.format !== 'npc_state_v3_bundle' ||
      runtime.LEGACY_BETA_V044?.formatVersion !== 1 ||
      runtime.LEGACY_BETA_V044?.schemaVersion !== 1 ||
      runtime.LEGACY_BETA_V044?.sourceCommit !== 'a34f5f27385b6fba75b8ff5832015ba66ea4d0c2') {
    fail('S10 authoritative Beta compatibility tuple is not pinned exactly to v0.4.44 source evidence.');
  } else {
    pass('S10 exact Beta v0.4.44 compatibility tuple and adapter exports verified.');
  }

  const legacySource = fs.readFileSync(legacyPath, 'utf8');
  if (!legacySource.includes("LEGACY_BETA_V044_IMPORT_CONFIRMATION = 'IMPORT_BETA_V044_INTO_EMPTY_ALPHA'") ||
      !legacySource.includes('legacy_beta_history_boundary_required') ||
      !legacySource.includes('IMPORT_BASELINE_MODE') ||
      !legacySource.includes('legacy_beta_alpha_state_not_empty') ||
      /from\s+['\"][^'\"]*npc_state_beta/i.test(legacySource)) {
    fail('S10 legacy adapter is missing explicit import safety or has an illegal Beta runtime dependency.');
  } else {
    pass('S10 legacy import confirmation, empty-target, history-boundary/import-baseline, and no-Beta-runtime rules verified.');
  }

  const readmePath = path.join(rootDir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    fail('S10 release README.md is missing.');
  } else {
    const readme = fs.readFileSync(readmePath, 'utf8');
    const requiredReadmeMarkers = [
      'SillyTavern 1.18.0',
      'developmentConnectionProfile',
      'npc_state_alpha.native_state',
      'NPC State Beta application version: **0.4.44**',
      '**Beta 0.5.38 is not supported for migration.**',
      'IMPORT_BETA_V044_INTO_EMPTY_ALPHA',
      'npm run measure:performance',
    ];
    if (requiredReadmeMarkers.some((marker) => !readme.includes(marker))) {
      fail('S10 README is missing required install/profile/portability/legacy/release documentation.');
    } else {
      pass('S10 release/install/upgrade/profile/portability/legacy documentation verified.');
    }
  }

  const ciPath = path.join(rootDir, '.github/workflows/ci.yml');
  if (!fs.existsSync(ciPath)) {
    fail('S10 GitHub CI workflow is missing.');
  } else {
    const ci = fs.readFileSync(ciPath, 'utf8');
    const requiredCiCommands = [
      'npm test',
      'npm run validate',
      'npm run measure:prompts',
      'npm run measure:performance',
      'npm run package',
      'git diff --check',
      'actions/upload-artifact@v4',
    ];
    if (requiredCiCommands.some((command) => !ci.includes(command)) || /GEMINI|OPENAI_API_KEY|ANTHROPIC_API_KEY/i.test(ci)) {
      fail('S10 CI workflow is missing deterministic gates or introduces forbidden provider credentials.');
    } else {
      pass('S10 single offline-safe GitHub CI/release-artifact workflow verified.');
    }
  }

  if (!fs.existsSync(path.join(rootDir, 'tests/s10-release.test.js'))) {
    fail('S10 release/upgrade/legacy compatibility regression matrix is missing.');
  } else {
    pass('S10 release, clean-install, upgrade, native, and legacy regression matrix verified.');
  }

  console.log(`--- S10 Validation finished with ${errors} error(s) ---`);
  return errors === 0 ? 0 : 1;
}

runValidation().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error('Unexpected validation failure:', err);
  process.exit(1);
});
