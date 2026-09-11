/**
 * NPC State Alpha — deterministic extension release packaging.
 *
 * Produces:
 * - dist/ manifest-bearing extension directory for direct installation/testing
 * - release/npc_state_alpha-<version>.zip with deterministic sorted/store ZIP entries
 * - release/npc_state_alpha-<version>.zip.sha256
 *
 * Only browser runtime files are packaged. Tests, docs, benchmark scripts,
 * credentials, local data, node_modules, and repository metadata are excluded.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(REPO_ROOT, 'dist');
const RELEASE_DIR = path.resolve(REPO_ROOT, 'release');
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 33; // 1980-01-01, the minimum DOS ZIP date.
const UTF8_FLAG = 0x0800;

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(srcPath, destPath);
    else if (entry.isFile()) fs.copyFileSync(srcPath, destPath);
  }
}

function listFilesRecursive(root, relative = '') {
  const dir = path.join(root, relative);
  const rows = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) rows.push(...listFilesRecursive(root, child));
    else if (entry.isFile()) rows.push(child.replace(/\\/g, '/'));
  }
  return rows;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localZipHeader(nameBytes, data) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8); // store, no compression
  header.writeUInt16LE(FIXED_DOS_TIME, 10);
  header.writeUInt16LE(FIXED_DOS_DATE, 12);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralZipHeader(nameBytes, data, localOffset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(FIXED_DOS_TIME, 12);
  header.writeUInt16LE(FIXED_DOS_DATE, 14);
  header.writeUInt32LE(crc32(data), 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  return header;
}

function writeDeterministicZip(entries, archivePath) {
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const header = localZipHeader(nameBytes, entry.data);
    localChunks.push(header, nameBytes, entry.data);
    const central = centralZipHeader(nameBytes, entry.data, localOffset);
    centralChunks.push(central, nameBytes);
    localOffset += header.length + nameBytes.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  const archive = Buffer.concat([...localChunks, centralDirectory, end]);
  fs.writeFileSync(archivePath, archive);
  return archive;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readReleaseVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
  if (typeof pkg.version !== 'string' || !pkg.version.trim()) throw new Error('package.json requires a release version.');
  if (manifest.version !== pkg.version) {
    throw new Error(`Release version mismatch: package.json=${pkg.version}, manifest.json=${manifest.version}.`);
  }
  return pkg.version;
}

/**
 * Build the canonical extension directory and deterministic standalone ZIP.
 */
export function buildPackage(options = {}) {
  const version = readReleaseVersion();
  const distDir = options.distDir ? path.resolve(options.distDir) : DIST_DIR;
  const releaseDir = options.releaseDir ? path.resolve(options.releaseDir) : RELEASE_DIR;
  if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true });
  if (fs.existsSync(releaseDir)) fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(releaseDir, { recursive: true });

  const copiedFiles = [];
  for (const filename of ['manifest.json', 'index.js', 'LICENSE']) {
    const source = path.join(REPO_ROOT, filename);
    if (!fs.existsSync(source)) {
      if (filename === 'LICENSE') continue;
      throw new Error(`Required release file is missing: ${filename}`);
    }
    fs.copyFileSync(source, path.join(distDir, filename));
    copiedFiles.push(filename);
  }

  for (const dir of ['contract', 'runtime', 'state', 'host', 'ui']) {
    const source = path.join(REPO_ROOT, 'src', dir);
    const destination = path.join(distDir, 'src', dir);
    if (!fs.existsSync(source)) throw new Error(`Required runtime directory is missing: src/${dir}`);
    copyDirSync(source, destination);
    copiedFiles.push(`src/${dir}`);
  }

  const files = listFilesRecursive(distDir);
  const entries = files.map((relativePath) => ({
    name: `npc_state_alpha/${relativePath}`,
    data: fs.readFileSync(path.join(distDir, ...relativePath.split('/'))),
  }));
  const archiveName = `npc_state_alpha-${version}.zip`;
  const archivePath = path.join(releaseDir, archiveName);
  const archive = writeDeterministicZip(entries, archivePath);
  const archiveSha256 = sha256(archive);
  const checksumPath = `${archivePath}.sha256`;
  fs.writeFileSync(checksumPath, `${archiveSha256}  ${archiveName}\n`, 'utf8');

  return {
    success: true,
    version,
    distDir,
    releaseDir,
    copiedFiles,
    files,
    fileCount: files.length,
    distBytes: files.reduce((sum, relativePath) => sum + fs.statSync(path.join(distDir, ...relativePath.split('/'))).size, 0),
    archivePath,
    archiveBytes: archive.length,
    archiveSha256,
    checksumPath,
  };
}

if (process.argv[1] === __filename) {
  const result = buildPackage();
  console.log(`[NPC State Alpha] Packaging complete -> ${result.distDir}`);
  console.log(`Included: ${result.copiedFiles.join(', ')}`);
  console.log(`Runtime files: ${result.fileCount}; bytes: ${result.distBytes}`);
  console.log(`Release ZIP: ${result.archivePath}`);
  console.log(`ZIP SHA-256: ${result.archiveSha256}`);
}
