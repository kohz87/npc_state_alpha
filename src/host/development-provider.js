/**
 * NPC State Alpha — S4 SillyTavern Development provider boundary
 *
 * Uses SillyTavern 1.18.0 ConnectionManagerRequestService directly. Alpha never
 * copies credentials, swaps the foreground profile, or falls back to an
 * undocumented provider route.
 */

export const CONNECTION_MANAGER_SHARED_MODULE = '/scripts/extensions/shared.js';

export class DevelopmentProviderError extends Error {
  constructor(message, code, options = {}) {
    super(message, options);
    this.name = 'DevelopmentProviderError';
    this.code = code;
  }
}

function normalizeResponse(result) {
  if (typeof result === 'string') {
    return { text: result, usage: null, reasoning: null, rawType: 'string' };
  }
  if (!result || typeof result !== 'object') {
    throw new DevelopmentProviderError('Development provider returned no usable response.', 'invalid_provider_response');
  }
  const text = typeof result.content === 'string'
    ? result.content
    : (typeof result.text === 'string' ? result.text : null);
  if (text === null) {
    throw new DevelopmentProviderError('Development provider response did not contain string content.', 'invalid_provider_response');
  }
  return {
    text,
    reasoning: typeof result.reasoning === 'string' ? result.reasoning : null,
    usage: result.usage && typeof result.usage === 'object' ? structuredClone(result.usage) : null,
    rawType: 'extracted_data',
  };
}

export class SillyTavernDevelopmentProvider {
  constructor(options = {}) {
    this.moduleLoader = options.moduleLoader || ((specifier) => import(specifier));
    this.requiresConfiguredProfile = true;
  }

  async _service() {
    let module;
    try {
      module = await this.moduleLoader(CONNECTION_MANAGER_SHARED_MODULE);
    } catch (error) {
      throw new DevelopmentProviderError('Could not load SillyTavern Connection Manager request service.', 'connection_manager_unavailable', { cause: error });
    }
    const service = module?.ConnectionManagerRequestService;
    if (!service || typeof service.sendRequest !== 'function' || typeof service.getProfile !== 'function') {
      throw new DevelopmentProviderError('SillyTavern Connection Manager request service is unavailable.', 'connection_manager_unavailable');
    }
    return service;
  }

  async inspectConfiguredProfile(profileId) {
    if (typeof profileId !== 'string' || profileId.trim() === '') {
      return { available: false, reason: 'development_profile_required' };
    }
    try {
      const service = await this._service();
      const profile = service.getProfile(profileId.trim());
      if (!profile) return { available: false, reason: 'development_profile_missing' };
      return {
        available: true,
        profileId: profileId.trim(),
        api: profile.api || null,
        model: profile.model || null,
      };
    } catch (error) {
      return {
        available: false,
        reason: error?.code || 'development_profile_missing',
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Sends one non-streaming bounded review request through the selected host
   * Connection Manager profile. The AbortSignal gives foreground generation a
   * deterministic way to yield/cancel this background request.
   */
  async sendReview({ profileId, prompt, maxTokens, signal }) {
    if (typeof profileId !== 'string' || profileId.trim() === '') {
      throw new DevelopmentProviderError('Development connection profile is not configured.', 'development_profile_required');
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new DevelopmentProviderError('Development review prompt must be non-empty.', 'invalid_development_prompt');
    }
    const service = await this._service();
    // SillyTavern 1.18.0 getProfile() throws when the ID is absent. Normalize both
    // throwing and null-returning host implementations to Alpha's stable code.
    let selectedProfile;
    try {
      selectedProfile = service.getProfile(profileId.trim());
    } catch (error) {
      const hostMessage = error?.message || 'Profile not found';
      throw new DevelopmentProviderError(
        `Selected Development connection profile no longer exists. ${hostMessage}`,
        'development_profile_missing',
        { cause: error },
      );
    }
    if (!selectedProfile) {
      throw new DevelopmentProviderError('Selected Development connection profile no longer exists.', 'development_profile_missing');
    }
    let result;
    try {
      result = await service.sendRequest(
        profileId.trim(),
        prompt,
        maxTokens,
        {
          stream: false,
          signal: signal || null,
          extractData: true,
          includePreset: true,
          includeInstruct: true,
          instructSettings: {},
        },
      );
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        throw new DevelopmentProviderError('Development review was aborted for foreground priority.', 'development_aborted', { cause: error });
      }
      throw new DevelopmentProviderError('SillyTavern Development provider request failed.', 'development_provider_failed', { cause: error });
    }
    return normalizeResponse(result);
  }
}
