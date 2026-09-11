import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('public release docs stay aligned with the application version', () => {
  const pkg = readJson('package.json');
  const manifest = readJson('manifest.json');
  const readme = readText('README.md');
  const changelog = readText('CHANGELOG.md');

  assert.equal(manifest.version, pkg.version, 'manifest and package versions must match');
  assert.ok(
    readme.includes(`Release: **${pkg.version}**`),
    `README must advertise release ${pkg.version}`,
  );
  assert.ok(
    readme.includes(`npc_state_alpha-${pkg.version}.zip`),
    `README must name the current ${pkg.version} release archive`,
  );
  assert.ok(
    readme.includes('[CHANGELOG.md](CHANGELOG.md)'),
    'README must link the changelog',
  );
  assert.ok(
    changelog.includes(`## [${pkg.version}]`),
    `CHANGELOG must contain an entry for ${pkg.version}`,
  );
});
