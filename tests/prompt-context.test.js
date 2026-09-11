import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PromptInjector } from '../src/host/prompt-injector.js';
import { buildDevelopmentPrompt } from '../src/host/development-context.js';
import { normalizeAlphaSettings } from '../src/contract/settings.js';
import { validateDevelopmentEnvelope, validateOnePassEnvelope } from '../src/contract/validator.js';
import { SillyTavernDevelopmentProvider } from '../src/host/development-provider.js';
import {
  makeImmediateMeasurementCases,
  makeDevelopmentMeasurementCases,
} from './fixtures/s7-prompt-fixtures.js';
import { S7_BASELINE_PROMPT_METRICS } from './fixtures/s7-prompt-baseline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function occurrences(text, fragment) {
  return text.split(fragment).length - 1;
}

function promptForImmediate(id) {
  const item = makeImmediateMeasurementCases().find((entry) => entry.id === id);
  return PromptInjector.buildExtensionPrompt(item.state, item.options);
}

function promptForDevelopment(id) {
  const item = makeDevelopmentMeasurementCases().find((entry) => entry.id === id);
  return buildDevelopmentPrompt(item.args);
}

test('S7 Immediate context: stable ordering is independent of NPC object insertion order', () => {
  const item = makeImmediateMeasurementCases().find((entry) => entry.id === 'immediate_multi_npc');
  const reversed = structuredClone(item.state);
  reversed.npcs = Object.fromEntries(Object.entries(reversed.npcs).reverse());
  assert.equal(
    PromptInjector.buildContinuityProjection(item.state, item.options),
    PromptInjector.buildContinuityProjection(reversed, item.options),
  );
});

test('S7 Immediate context: soft detail budget keeps active/present and exact-mentioned NPCs detailed while retaining all identities', () => {
  const item = makeImmediateMeasurementCases().find((entry) => entry.id === 'immediate_long_exchange');
  const projection = PromptInjector.buildContinuityProjection(item.state, item.options);
  for (let i = 1; i <= 8; i++) assert.match(projection, new RegExp(`Resident ${i}.*npc_rich_${i}`));
  for (const detailed of [1, 2, 3, 8]) {
    assert.match(projection, new RegExp(`Resident ${detailed}.*location:`));
  }
  for (const compact of [4, 5, 6, 7]) {
    const line = projection.split('\n').find((value) => value.includes(`Resident ${compact}`));
    assert.ok(line);
    assert.equal(line.includes('location:'), false);
    assert.equal(line.includes('mood:'), false);
    assert.equal(line.includes('presentation:'), false);
  }
});

test('S7 Immediate context: detail budget is soft rather than a correctness cap', () => {
  const item = makeImmediateMeasurementCases().find((entry) => entry.id === 'immediate_multi_npc');
  const projection = PromptInjector.buildContinuityProjection(item.state, {
    ...item.options,
    routineDossierDetailBudget: 1,
    currentUserText: 'Alice asks Mira while Captain Kaelen watches.',
  });
  for (const name of ['Alice', 'Mira', 'Kaelen']) {
    const line = projection.split('\n').find((value) => value.includes(`[${name}]`));
    assert.ok(line?.includes('location:'), `${name} must remain detailed despite budget=1`);
  }
});

test('S7 Immediate context: known forms remain available only where semantically relevant detail is selected', () => {
  const item = makeImmediateMeasurementCases().find((entry) => entry.id === 'immediate_multi_npc');
  const projection = PromptInjector.buildContinuityProjection(item.state, {
    ...item.options,
    routineDossierDetailBudget: 1,
    currentUserText: 'Mira shows her other form.',
  });
  const mira = projection.split('\n').find((value) => value.includes('[Mira]'));
  assert.match(mira, /knownForms\(read-only\): \[human=Human, wolf=Wolf\]/);
});

test('S7 Immediate contract: compact contract retains writer, omission, source, form, relationship and lifecycle boundaries', () => {
  const contract = PromptInjector.buildImmediateOutputContract({ admissionPolicy: 'named_preferred' });
  for (const fragment of [
    'current:user',
    'current:assistant',
    'Omit unsupported',
    'activeInExchange:true',
    'knownForms(read-only)',
    'automatic resurrection',
    'relationshipEvaluation',
    'axisSupport',
    'lifecycle',
    'Development-owned',
    '<npc_state_alpha_v1>',
    '</npc_state_alpha_v1>',
  ]) assert.ok(contract.includes(fragment), `missing Immediate guardrail ${fragment}`);
  assert.match(contract, /no markdown|No markdown/i);
  assert.match(contract, /nothing after|no text after/i);
});

test('S7 Development prompt: routing metadata is absent and model context uses one compact target scope vocabulary', () => {
  const prompt = promptForDevelopment('development_ordinary_cadence');
  assert.equal(prompt.includes('1600 tokens'), false);
  assert.equal(prompt.includes('developmentConnectionProfile'), false);
  assert.equal(prompt.includes('requiredSourceScope'), false);
  assert.equal(prompt.includes('restricted":false'), false);
  assert.ok(prompt.includes('sourceScope'));
});

test('S7 Development prompt: source text and accepted dossier values are serialized once', () => {
  const item = makeDevelopmentMeasurementCases().find((entry) => entry.id === 'development_ordinary_cadence');
  const prompt = buildDevelopmentPrompt(item.args);
  for (const source of item.args.sources) {
    assert.equal(occurrences(prompt, source.text), 1, `source ${source.sourceRef} duplicated`);
  }
  assert.equal(occurrences(prompt, 'Professional and cautiously cooperative'), 1);
});

test('S7 Development prompt: durable discrimination guidance distinguishes direct facts, transient behavior, reinforced patterns and contradictions', () => {
  const prompt = promptForDevelopment('development_new_npc_early');
  assert.match(prompt, /explicit.*fact|direct.*fact/i);
  assert.match(prompt, /one-off|transient/i);
  assert.match(prompt, /pattern|repeated|reinforced/i);
  assert.match(prompt, /contradict|qualif|refin/i);
  assert.match(prompt, /Omit unsupported|Omission preserves/i);
  assert.match(prompt, /never numeric|numeric relationship/i);
});

test('S7 Development prompt: irrelevant accepted support is omitted while supplied observations remain available', () => {
  const item = makeDevelopmentMeasurementCases().find((entry) => entry.id === 'development_rich_mature');
  const modified = structuredClone(item.args);
  modified.targets[0].acceptedSupport.push({
    field: 'role',
    fieldRevision: 99,
    sourceRefs: ['chat:old:999'],
  });
  const prompt = buildDevelopmentPrompt(modified);
  assert.equal(prompt.includes('chat:old:999'), false);
  assert.ok(prompt.includes('Concise retained observation 1'));
});

test('S7 Development prompt: retained review context is bounded and relationship mechanics history is not model context', () => {
  const item = makeDevelopmentMeasurementCases().find((entry) => entry.id === 'development_rich_mature');
  const args = structuredClone(item.args);
  args.targets[0].relationshipAxesReadOnly = {
    ...args.targets[0].relationshipAxesReadOnly,
    lastEvaluationExchange: 'exchange:old',
    milestones: ['trust:trusted'],
    scoringHistory: [{ exchangeId: 'exchange:old', reason: 'runtime-only history' }],
  };
  const prompt = buildDevelopmentPrompt(args);
  assert.equal(prompt.includes('Concise retained observation 1"'), false);
  assert.ok(prompt.includes('Concise retained observation 12'));
  assert.equal(prompt.includes('runtime-only history'), false);
  assert.equal(prompt.includes('lastEvaluationExchange'), false);
  assert.ok(prompt.includes('supportingObservationIds'));
});

test('S7 Development prompt: restricted targets expose only selected durable state and use fieldSubset without a parallel restricted flag', () => {
  const item = makeDevelopmentMeasurementCases().find((entry) => entry.id === 'development_rich_mature');
  const args = structuredClone(item.args);
  args.targetFieldSubset = { npc_elena: ['speech'] };
  args.targets[0].current = { speech: args.targets[0].current.speech };
  args.targets[0].locks = [];
  args.targets[0].observations = args.targets[0].observations.filter((obs) => obs.field === 'speech');
  args.targets[0].acceptedSupport = args.targets[0].acceptedSupport.filter((support) => support.field === 'speech');
  const prompt = buildDevelopmentPrompt(args);
  assert.ok(prompt.includes('"fieldSubset":["speech"]'));
  assert.equal(prompt.includes('"restricted":'), false);
  assert.equal(prompt.includes('Tall, dark-haired woman'), false);
});

test('S7 Gemini 3.7 failure fixture: baseline generic Development proposal/source/status shape remains rejected', () => {
  const baselineFailure = {
    version: '1',
    reviewReceipts: [{ targetId: 'npc_elena', sourceScope: ['m1'], status: 'reviewed_with_proposals' }],
    proposals: [{
      targetId: 'npc_elena',
      field: 'personality',
      value: 'Cautious',
      sources: [{ sourceId: 'm1', excerpt: 'I am cautious by nature' }],
    }],
    observations: [],
    supportProposals: [],
  };
  const validation = validateDevelopmentEnvelope(baselineFailure);
  assert.equal(validation.valid, false);
});

test('S7 Gemini 3.7 failure fixture: supportProposals.source shortcut remains rejected', () => {
  const candidateFailure = {
    version: '1',
    reviewReceipts: [{ targetId: 'npc_elena', sourceScope: ['m3', 'm4'], status: 'reviewed' }],
    proposals: [{
      targetId: 'npc_elena',
      mannerisms: {
        items: ['Taps one finger against the ledger before answering'],
        source: { sourceRef: 'm4', excerpt: 'Later, before another answer, Elena again taps one finger against the ledger.' },
      },
    }],
    observations: [],
    supportProposals: [{
      targetId: 'npc_elena',
      field: 'mannerisms',
      source: { sourceRef: 'm3', excerpt: 'Elena taps one finger against the ledger before answering.' },
    }],
  };
  const validation = validateDevelopmentEnvelope(candidateFailure);
  assert.equal(validation.valid, false);
});

test('S7 Gemini 3.7 cross-model failure fixture: Immediate scalar wrappers remain rejected', () => {
  const wrapperFailure = {
    version: '1',
    proposals: [{
      id: 'npc_soren',
      present: {
        value: true,
        source: { sourceRef: 'current:assistant', excerpt: 'Soren kills Mira\'s attacker.' },
      },
      source: { sourceRef: 'current:assistant', excerpt: 'Soren kills Mira\'s attacker.' },
    }],
  };
  assert.equal(validateOnePassEnvelope(wrapperFailure).valid, false);
});

test('S7 Gemini 3.7 final cross-Immediate fixture: clarified direct scalar placement produces a valid NEW proposal', () => {
  const finalShape = {
    version: '1',
    proposals: [{
      id: null,
      localRef: 'new:selene_voss',
      name: 'Selene Voss',
      identityKind: 'named',
      evidence: { sourceRef: 'current:assistant', excerpt: '"Selene Voss, intake clerk," she says, directly introducing herself.' },
      present: true,
      activeInExchange: true,
      relationshipEvaluation: {
        shifted: false,
        reason: 'A direct introductory greeting with no change in relationship dynamics.',
        source: { sourceRef: 'current:assistant', excerpt: '"Selene Voss, intake clerk," she says, directly introducing herself.' },
      },
      source: { sourceRef: 'current:assistant', excerpt: '"Selene Voss, intake clerk," she says, directly introducing herself.' },
    }],
  };
  assert.equal(validateOnePassEnvelope(finalShape).valid, true);
});

test('S7 Gemini 3.8 final cross-Development fixture: explicit durable personality remains schema-valid', () => {
  const finalShape = {
    version: '1',
    reviewReceipts: [{ targetId: 'npc_elena', sourceScope: ['m1'], status: 'reviewed' }],
    proposals: [{
      targetId: 'npc_elena',
      personality: {
        traits: ['cautious'],
        source: { sourceRef: 'm1', excerpt: 'I am cautious by nature' },
      },
    }],
    observations: [],
    supportProposals: [],
  };
  assert.equal(validateDevelopmentEnvelope(finalShape).valid, true);
});

test('S7 Gemini 3.7 final fixture: compact Development support/source shape is schema-valid', () => {
  const finalShape = {
    version: '1',
    reviewReceipts: [{ targetId: 'npc_elena', sourceScope: ['m3', 'm4'], status: 'reviewed' }],
    proposals: [{
      targetId: 'npc_elena',
      mannerisms: {
        items: ['Taps one finger against the ledger before answering'],
        source: { sourceRef: 'm4', excerpt: 'Later, before another answer, Elena again taps one finger against the ledger.' },
      },
    }],
    observations: [],
    supportProposals: [{ targetId: 'npc_elena', field: 'mannerisms', sourceRefs: ['m3'] }],
  };
  assert.equal(validateDevelopmentEnvelope(finalShape).valid, true);
});

test('S7 Gemini 3.7 final age/family fixture: new relation uses add + targetName and remains schema-valid', () => {
  const finalShape = {
    version: '1',
    reviewReceipts: [{ targetId: 'npc_elena', sourceScope: ['m7', 'm8'], status: 'reviewed' }],
    proposals: [
      {
        targetId: 'npc_elena',
        facts: {
          actualAge: '31',
          source: { sourceRef: 'm8', excerpt: '"I am thirty-one,"' },
        },
      },
      {
        targetId: 'npc_elena',
        nonPlayerRelationships: {
          operation: 'add',
          relationships: [{
            targetName: 'Mira',
            relationship: 'older sister',
            source: { sourceRef: 'm8', excerpt: '"Mira is my older sister."' },
          }],
        },
      },
    ],
    observations: [],
    supportProposals: [],
  };
  assert.equal(validateDevelopmentEnvelope(finalShape).valid, true);
});

test('S7 Gemini 3.8 final fixture: direct Immediate scalars and sibling source remain schema-valid', () => {
  const finalShape = {
    version: '1',
    proposals: [{
      id: 'npc_alice',
      activeInExchange: true,
      location: 'east stacks',
      mood: 'attentive',
      source: { sourceRef: 'current:assistant', excerpt: 'She is attentive and leaves for the east stacks.' },
      relationshipEvaluation: {
        shifted: false,
        reason: 'Routine inquiry and response regarding destination and pending work.',
        source: { sourceRef: 'current:assistant', excerpt: 'Alice closes the ledger and says, "To the east stacks. The seal inventory is overdue."' },
      },
    }],
  };
  assert.equal(validateOnePassEnvelope(finalShape).valid, true);
});

test('S7 prompt measurement corpus: Immediate shrinks and Development reliability guidance stays within a bounded context budget', () => {
  const immediateCases = makeImmediateMeasurementCases();
  const developmentCases = makeDevelopmentMeasurementCases();
  const immediateChars = immediateCases.reduce(
    (sum, item) => sum + PromptInjector.buildExtensionPrompt(item.state, item.options).length,
    0,
  );
  const developmentChars = developmentCases.reduce(
    (sum, item) => sum + buildDevelopmentPrompt(item.args).length,
    0,
  );
  const richDevelopment = developmentCases.find((item) => item.id === 'development_rich_mature');
  const richDevelopmentChars = buildDevelopmentPrompt(richDevelopment.args).length;
  assert.ok(immediateChars < S7_BASELINE_PROMPT_METRICS.aggregate.immediate.chars);
  assert.ok(developmentChars <= Math.ceil(S7_BASELINE_PROMPT_METRICS.aggregate.development.chars * 1.03));
  assert.ok(richDevelopmentChars < S7_BASELINE_PROMPT_METRICS.development.development_rich_mature.chars);
});

test('S7 provider configuration: Development profile selects its own profile model without entering prompt text', async () => {
  const calls = [];
  const service = {
    getProfile(id) {
      return id === 'dev-profile-37' ? { id, api: 'custom-provider', model: 'model-selected-by-profile' } : null;
    },
    async sendRequest(profileId, prompt) {
      calls.push({ profileId, prompt });
      return { content: '{"version":"1","reviewReceipts":[],"proposals":[],"observations":[],"supportProposals":[]}' };
    },
  };
  const provider = new SillyTavernDevelopmentProvider({ moduleLoader: async () => ({ ConnectionManagerRequestService: service }) });
  const inspected = await provider.inspectConfiguredProfile('dev-profile-37');
  assert.equal(inspected.model, 'model-selected-by-profile');
  await provider.sendReview({ profileId: 'dev-profile-37', prompt: 'development semantic prompt', maxTokens: 256 });
  assert.equal(calls[0].profileId, 'dev-profile-37');
  assert.equal(calls[0].prompt, 'development semantic prompt');
});

test('S7 provider configuration: changing Development profile does not enter or alter Immediate prompt construction', () => {
  const item = makeImmediateMeasurementCases()[0];
  const a = normalizeAlphaSettings({ developmentConnectionProfile: 'dev-a' });
  const b = normalizeAlphaSettings({ developmentConnectionProfile: 'dev-b' });
  const promptA = PromptInjector.buildExtensionPrompt(item.state, {
    admissionPolicy: a.admissionPolicy,
    routineDossierDetailBudget: a.routineDossierDetailBudget,
    currentUserText: item.options.currentUserText,
  });
  const promptB = PromptInjector.buildExtensionPrompt(item.state, {
    admissionPolicy: b.admissionPolicy,
    routineDossierDetailBudget: b.routineDossierDetailBudget,
    currentUserText: item.options.currentUserText,
  });
  assert.equal(promptA, promptB);
});

test('S7 provider configuration: canonical production src contains no Gemini benchmark model identifier', () => {
  const srcRoot = path.resolve(__dirname, '../src');
  const files = fs.readdirSync(srcRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(entry.parentPath, entry.name));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /gemini-3\.[78]/i, `benchmark model identifier leaked into ${file}`);
  }
});
