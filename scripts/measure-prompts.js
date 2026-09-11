import crypto from 'node:crypto';
import { PromptInjector } from '../src/host/prompt-injector.js';
import { buildDevelopmentPrompt } from '../src/host/development-context.js';
import {
  makeImmediateMeasurementCases,
  makeDevelopmentMeasurementCases,
} from '../tests/fixtures/s7-prompt-fixtures.js';

function measure(text) {
  const bytes = Buffer.byteLength(text, 'utf8');
  return {
    chars: text.length,
    utf8Bytes: bytes,
    estimatedTokens4Chars: Math.ceil(text.length / 4),
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

const immediate = Object.fromEntries(
  makeImmediateMeasurementCases().map(({ id, state, options }) => [
    id,
    measure(PromptInjector.buildExtensionPrompt(state, options)),
  ]),
);

const development = Object.fromEntries(
  makeDevelopmentMeasurementCases().map(({ id, args }) => [
    id,
    measure(buildDevelopmentPrompt(args)),
  ]),
);

const aggregate = (records) => {
  const values = Object.values(records);
  return {
    chars: values.reduce((sum, item) => sum + item.chars, 0),
    utf8Bytes: values.reduce((sum, item) => sum + item.utf8Bytes, 0),
    estimatedTokens4Chars: values.reduce((sum, item) => sum + item.estimatedTokens4Chars, 0),
  };
};

console.log(JSON.stringify({
  measurement: 'deterministic UTF-16 char count / UTF-8 bytes / ceil(chars/4) token proxy',
  immediate,
  development,
  aggregate: {
    immediate: aggregate(immediate),
    development: aggregate(development),
  },
}, null, 2));
