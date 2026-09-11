/**
 * NPC State Alpha — SillyTavern Extension Client Bootstrap
 *
 * S3 owns foreground One-Pass continuity. S4 attaches asynchronous Development
 * review to the same storage/coordinator without adding another state path.
 */

import { SillyTavernAdapter } from './src/host/sillytavern-adapter.js';
import { DevelopmentReviewQueue } from './src/host/development-queue.js';
import { UIController } from './src/ui/controller.js';

export * from './src/contract/index.js';
export * from './src/runtime/index.js';
export * from './src/host/index.js';
export * from './src/ui/index.js';

let activeAdapterInstance = null;
let activeDevelopmentReview = null;
let activeUIController = null;
let developmentHostReadyTriggered = false;

/**
 * Detects the one known competing automatic continuity owner using SillyTavern's
 * exported extension registry. This is capability-based only: no Beta files/data
 * are read and Alpha never toggles the competing extension.
 */
export async function detectKnownCompetingAutomaticOwner() {
  if (typeof document === 'undefined') return null;
  const hostExtensions = await import('/scripts/extensions.js');
  const beta = hostExtensions.findExtension?.('npc_state_beta');
  return beta?.enabled
    ? { name: beta.name, reason: 'known_competing_automatic_owner' }
    : null;
}

/**
 * Initializes the NPC State Alpha extension in SillyTavern.
 * @param {object} [options]
 * @returns {SillyTavernAdapter}
 */
export function initExtension(options = {}) {
  if (!activeAdapterInstance) {
    const adapterOptions = { ...options };
    if (!adapterOptions.ownershipConflictDetector && typeof document !== 'undefined') {
      adapterOptions.ownershipConflictDetector = detectKnownCompetingAutomaticOwner;
    }
    activeAdapterInstance = new SillyTavernAdapter(adapterOptions);
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
  // instance is still uninitialized. Mount S5 UI only after these host surfaces
  // are ready so its lifecycle listeners cannot be permanently missed.
  if (!activeAdapterInstance.initialized) {
    activeAdapterInstance.initialize();
  }

  if (activeAdapterInstance.initialized && options.ui !== false && !activeUIController) {
    activeUIController = options.uiController || new UIController({
      adapter: activeAdapterInstance,
      storage: activeAdapterInstance.storage,
      coordinator: activeAdapterInstance.coordinator,
      developmentQueue: activeDevelopmentReview,
      diagnostics: activeAdapterInstance.diagnostics,
    });
    if (typeof document !== 'undefined') activeUIController.mount();
  }

  if (activeAdapterInstance.initialized && activeDevelopmentReview && !developmentHostReadyTriggered) {
    developmentHostReadyTriggered = true;
    Promise.resolve(activeAdapterInstance.refreshOwnershipConflict?.())
      .catch(() => null)
      .finally(() => {
        activeDevelopmentReview.onHostReady();
        activeUIController?.render?.();
      });
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

/** Returns the S6 canonical story-history recovery coordinator. */
export function getActiveHistoryRecovery() {
  return activeAdapterInstance?.historyRecovery || null;
}

/** Returns the active UI controller instance. */
export function getActiveUIController() {
  return activeUIController;
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
  getActiveHistoryRecovery,
  getActiveUIController,
};
