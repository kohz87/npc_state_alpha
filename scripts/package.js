/**
 * NPC State Alpha — Deterministic Extension Packaging Script
 *
 * Packages the standalone browser extension into a dedicated manifest-bearing
 * directory (`dist/`) containing only the required browser runtime files.
 * Excludes tests, documentation, scripts, and developer tools.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(REPO_ROOT, 'dist');

/**
 * Recursively copies a directory.
 * @param {string} src
 * @param {string} dest
 */
function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Builds the standalone extension package in `dist/`.
 * @returns {{ success: boolean, distDir: string, copiedFiles: string[] }}
 */
export function buildPackage() {
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const copiedFiles = [];

  // 1. Copy manifest.json
  const manifestSrc = path.join(REPO_ROOT, 'manifest.json');
  const manifestDest = path.join(DIST_DIR, 'manifest.json');
  fs.copyFileSync(manifestSrc, manifestDest);
  copiedFiles.push('manifest.json');

  // 2. Copy index.js (root entrypoint)
  const indexSrc = path.join(REPO_ROOT, 'index.js');
  const indexDest = path.join(DIST_DIR, 'index.js');
  fs.copyFileSync(indexSrc, indexDest);
  copiedFiles.push('index.js');

  // 3. Copy LICENSE
  const licenseSrc = path.join(REPO_ROOT, 'LICENSE');
  const licenseDest = path.join(DIST_DIR, 'LICENSE');
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, licenseDest);
    copiedFiles.push('LICENSE');
  }

  // 4. Copy runtime source directories only (src/contract, src/runtime, src/state, src/host, src/ui)
  const runtimeDirs = ['contract', 'runtime', 'state', 'host', 'ui'];
  for (const dir of runtimeDirs) {
    const srcDir = path.join(REPO_ROOT, 'src', dir);
    const destDir = path.join(DIST_DIR, 'src', dir);
    if (fs.existsSync(srcDir)) {
      copyDirSync(srcDir, destDir);
      copiedFiles.push(`src/${dir}`);
    }
  }

  return {
    success: true,
    distDir: DIST_DIR,
    copiedFiles,
  };
}

// Execute when invoked directly
if (process.argv[1] === __filename) {
  const res = buildPackage();
  console.log(`[NPC State Alpha] Packaging complete -> ${res.distDir}`);
  console.log(`Included: ${res.copiedFiles.join(', ')}`);
}
