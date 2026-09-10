/**
 * NPC State Alpha — SillyTavern Extension Client Bootstrap
 *
 * S3 owns foreground One-Pass continuity. S4 attaches asynchronous Development
 * review to the same storage/coordinator without adding another state path.
 */

import { SillyTavernAdapter } from './src/host/sillytavern-adapter.js';
import { DevelopmentReviewQueue } from './src/host/development-queue.js';

export * from './src/contract/index.js';
export * from './src/runtime/index.js';
export * from './src/host/index.js';

let activeAdapterInstance = null;
let activeDevelopmentReview = null;
let developmentHostReadyTriggered = false;

/**
 * Initializes the NPC State Alpha extension in SillyTavern.
 * @param {object} [options]
 * @returns {SillyTavernAdapter}
 */
export function initExtension(options = {}) {
  if (!activeAdapterInstance) {
    activeAdapterInstance = new SillyTavernAdapter(options);
    if (options.developmentReview !== false) {
      activeDevelopmentReview = options.developmentReview || new DevelopmentReviewQueue({
        storage: activeAdapterInstance.storage,
        coordinator: activeAdapterInstance.coordinator,
        diagnostics: activeAdapterInstance.diagnostics,
        getContext: () => activeAdapterInstance.getContext(),
        provider: options.developmentProvider,
        providerOptions: options.developmentProviderOptions,
        settings: options.settings,
      });
      activeAdapterInstance.setDevelopmentReview(activeDevelopmentReview);
    }
  }

  // Capability readiness can be transient during host startup. Reusing the same
  // adapter is safe because initialize() is idempotent and retries only while the
  // instance is still uninitialized.
  if (!activeAdapterInstance.initialized) {
    activeAdapterInstance.initialize();
  }
  if (activeAdapterInstance.initialized && activeDevelopmentReview && !developmentHostReadyTriggered) {
    developmentHostReadyTriggered = true;
    activeDevelopmentReview.onHostReady();
  }
  return activeAdapterInstance;
}

/** Returns current active adapter instance. */
export function getActiveAdapter() {
  return activeAdapterInstance;
}

/** Returns the S4 Development scheduler attached to the active adapter. */
export function getActiveDevelopmentReview() {
  return activeDevelopmentReview;
}

// Auto-bootstrap when loaded directly by SillyTavern host in browser.
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
  getActiveDevelopmentReview,
};
