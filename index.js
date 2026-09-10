/**
 * NPC State Alpha — SillyTavern Extension Client Bootstrap
 *
 * Implements S3 One-Pass Immediate Continuity root entrypoint.
 * Suitable for SillyTavern extension loading via manifest.json.
 */

import { SillyTavernAdapter } from './src/host/sillytavern-adapter.js';

export * from './src/contract/index.js';
export * from './src/runtime/index.js';
export * from './src/host/index.js';

let activeAdapterInstance = null;

/**
 * Initializes the NPC State Alpha extension in SillyTavern.
 * @param {object} [options]
 * @returns {SillyTavernAdapter}
 */
export function initExtension(options = {}) {
  if (!activeAdapterInstance) {
    activeAdapterInstance = new SillyTavernAdapter(options);
  }
  // Capability readiness can be transient during host startup. Reusing the same
  // adapter is safe because initialize() is idempotent and retries only while the
  // instance is still uninitialized.
  if (!activeAdapterInstance.initialized) {
    activeAdapterInstance.initialize();
  }
  return activeAdapterInstance;
}

/**
 * Returns current active adapter instance if initialized.
 * @returns {SillyTavernAdapter|null}
 */
export function getActiveAdapter() {
  return activeAdapterInstance;
}

// Auto-bootstrap when loaded directly by SillyTavern host in browser
if (typeof globalThis !== 'undefined' && globalThis.SillyTavern?.getContext) {
  try {
    initExtension();
  } catch (err) {
    console.error('[NPC State Alpha] Auto-bootstrap error:', err);
  }
}

export default {
  init: initExtension,
  getActiveAdapter,
};
