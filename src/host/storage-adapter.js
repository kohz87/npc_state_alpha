/**
 * NPC State Alpha — SillyTavern 1.18.0 Storage Adapter
 *
 * Persists the single S2 Alpha state model inside the active chat metadata under
 * `npc_state_alpha.v1`. This is a host adapter only; it does not define a second
 * state schema or commit engine.
 *
 * SillyTavern 1.18.0's public `saveChat()`/`saveChatConditional()` helpers catch
 * network/server failures internally. Alpha therefore uses the host's official
 * same-origin chat save endpoints directly and requires an explicit successful
 * server response before reporting storage success to CommitCoordinator.
 */

import {
  ALPHA_NAMESPACE,
  ALPHA_SCHEMA_VERSION,
  createInitialState,
  validateState,
  cloneState,
} from '../state/schema.js';
import { StoragePersistenceError } from '../state/storage.js';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function cloneJsonValue(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

export class SillyTavernStorageAdapter {
  /**
   * @param {object} [options]
   * @param {Function} [options.getContext] Function returning SillyTavern getContext()
   * @param {Function} [options.fetchImpl] Same-origin fetch implementation (tests may inject one)
   */
  constructor(options = {}) {
    this._getContext = options.getContext || null;
    this._fetchImpl = options.fetchImpl || null;
    this._explicitChatId = null;
    this._chatStores = new Map();
    this._lastLoadContext = null;
    this._failNextSave = false;
    this._failNextLoad = false;
  }

  setChatId(chatId) {
    this._explicitChatId = chatId ? String(chatId) : null;
  }

  _context() {
    if (typeof this._getContext !== 'function') return null;
    try {
      return this._getContext() || null;
    } catch {
      return null;
    }
  }

  getChatId(context = undefined) {
    if (this._explicitChatId) return this._explicitChatId;
    const ctx = context === undefined ? this._context() : context;
    if (!ctx) return null;
    try {
      if (typeof ctx.getCurrentChatId === 'function') {
        const id = ctx.getCurrentChatId();
        if (id !== undefined && id !== null && String(id).trim() !== '') return String(id);
      }
    } catch {}
    if (ctx.chatId !== undefined && ctx.chatId !== null && String(ctx.chatId).trim() !== '') {
      return String(ctx.chatId);
    }
    return null;
  }

  _getHostMetadata(context = undefined) {
    const ctx = context === undefined ? this._context() : context;
    if (!ctx) return null;
    const metadata = ctx.chatMetadata || ctx.chat_metadata;
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null;
  }

  _getFetch(context) {
    if (typeof this._fetchImpl === 'function') return this._fetchImpl;
    if (typeof context?.fetch === 'function') return context.fetch.bind(context);
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
    return null;
  }

  /**
   * Reports whether this exact host context exposes enough information for a checked
   * same-origin persistence operation. It does not perform I/O.
   */
  detectPersistenceCapabilities() {
    const ctx = this._context();
    const chatId = this.getChatId(ctx);
    const hasChat = Array.isArray(ctx?.chat);
    const hasMetadata = Boolean(this._getHostMetadata(ctx));
    const hasHeaders = typeof ctx?.getRequestHeaders === 'function';
    const hasFetch = typeof this._getFetch(ctx) === 'function';
    const isGroup =
      (ctx?.groupId !== undefined && ctx?.groupId !== null && String(ctx.groupId).trim() !== '') ||
      (ctx?.selected_group !== undefined && ctx?.selected_group !== null && String(ctx.selected_group).trim() !== '');

    let hasTargetIdentity = false;
    let groupMatchesCurrentChat = false;
    if (isGroup) {
      const groupId = ctx?.groupId ?? ctx?.selected_group;
      const group = Array.isArray(ctx?.groups)
        ? ctx.groups.find((entry) => String(entry?.id) === String(groupId))
        : null;
      groupMatchesCurrentChat = Boolean(
        chatId &&
        group &&
        nonEmptyString(group.chat_id) &&
        String(group.chat_id) === String(chatId)
      );
      hasTargetIdentity = groupMatchesCurrentChat;
    } else {
      const character = Array.isArray(ctx?.characters) ? ctx.characters[ctx.characterId] : null;
      hasTargetIdentity = Boolean(
        chatId &&
        character &&
        nonEmptyString(character.name) &&
        nonEmptyString(character.chat) &&
        (nonEmptyString(character.avatar) || nonEmptyString(character.avatar_url)) &&
        String(character.chat) === String(chatId)
      );
    }

    return {
      checkedSave: Boolean(chatId && hasChat && hasMetadata && hasHeaders && hasFetch && hasTargetIdentity),
      // Static host transport capability. Initialization may occur on the welcome screen
      // before an active chat/character/group target exists; target identity is rechecked
      // again at load/save time and those operations still fail closed.
      checkedSaveSurface: Boolean(hasHeaders && hasFetch),
      isGroup,
      hasChat,
      hasMetadata,
      hasHeaders,
      hasFetch,
      hasTargetIdentity,
      groupMatchesCurrentChat,
    };
  }

  setFailNextSave(shouldFail = true) {
    this._failNextSave = shouldFail;
  }

  setFailNextLoad(shouldFail = true) {
    this._failNextLoad = shouldFail;
  }

  getRevision() {
    const ctx = this._context();
    const chatId = this.getChatId(ctx);
    if (!chatId) return 0;
    const hostMeta = this._getHostMetadata(ctx);
    const hostState = hostMeta?.[ALPHA_NAMESPACE];
    if (hostState && typeof hostState === 'object') return hostState.revision || 0;
    return this._chatStores.get(chatId)?.revision || 0;
  }

  _capturePersistenceContext(ctx, chatId, revision) {
    const metadata = this._getHostMetadata(ctx) || {};
    const isGroup =
      (ctx?.groupId !== undefined && ctx?.groupId !== null && String(ctx.groupId).trim() !== '') ||
      (ctx?.selected_group !== undefined && ctx?.selected_group !== null && String(ctx.selected_group).trim() !== '');
    const groupId = isGroup ? String(ctx.groupId || ctx.selected_group) : null;
    const character = !isGroup && Array.isArray(ctx?.characters) ? ctx.characters[ctx.characterId] : null;

    this._lastLoadContext = {
      chatId,
      revision,
      isGroup,
      groupId,
      character: character
        ? { name: character.name, chat: character.chat, avatar: character.avatar || character.avatar_url }
        : null,
      metadata: cloneJsonValue(metadata) || {},
      chat: Array.isArray(ctx?.chat) ? cloneJsonValue(ctx.chat) : null,
    };
  }

  async load() {
    if (this._failNextLoad) {
      this._failNextLoad = false;
      throw new StoragePersistenceError('Simulated storage load failure.');
    }

    const ctx = this._context();
    const chatId = this.getChatId(ctx);
    if (!chatId) {
      throw new StoragePersistenceError('Missing real chat identity: cannot load Alpha state (fail closed).');
    }

    const hostMeta = this._getHostMetadata(ctx);
    let stored = hostMeta?.[ALPHA_NAMESPACE] || null;
    if (!stored && this._chatStores.has(chatId)) stored = this._chatStores.get(chatId);

    if (!stored) {
      const fresh = createInitialState();
      this._capturePersistenceContext(ctx, chatId, fresh.revision);
      return { state: cloneState(fresh), revision: fresh.revision };
    }

    if (stored.namespace !== ALPHA_NAMESPACE) {
      throw new Error(`Storage namespace isolation error: expected '${ALPHA_NAMESPACE}', found '${stored.namespace}'.`);
    }
    if (stored.schemaVersion !== ALPHA_SCHEMA_VERSION) {
      throw new Error(`Storage schemaVersion mismatch: expected '${ALPHA_SCHEMA_VERSION}', found '${stored.schemaVersion}'.`);
    }

    const validation = validateState(stored);
    if (!validation.valid) {
      throw new Error(`Storage state corruption detected: ${validation.errors.join('; ')}`);
    }

    const cloned = cloneState(stored);
    this._chatStores.set(chatId, cloned);
    this._capturePersistenceContext(ctx, chatId, stored.revision);
    return { state: cloneState(cloned), revision: stored.revision };
  }

  _buildCheckedSaveRequest(target, newState) {
    const metadata = { ...(target.metadata || {}), [ALPHA_NAMESPACE]: cloneState(newState) };
    const header = {
      chat_metadata: metadata,
      user_name: 'unused',
      character_name: 'unused',
    };
    const chatPayload = [header, ...(Array.isArray(target.chat) ? target.chat : [])];

    if (target.isGroup) {
      // SillyTavern's group save endpoint names the chat file from request.body.id.
      // The official client sends the active group's chat_id here, not selected_group.
      return {
        path: '/api/chats/group/save',
        body: { id: target.chatId, chat: chatPayload, force: false },
        metadata,
      };
    }

    const character = target.character;
    if (
      !character ||
      !nonEmptyString(character.name) ||
      !nonEmptyString(character.chat) ||
      !nonEmptyString(character.avatar) ||
      String(character.chat) !== String(target.chatId)
    ) {
      return null;
    }

    return {
      path: '/api/chats/save',
      body: {
        ch_name: character.name,
        file_name: character.chat,
        chat: chatPayload,
        avatar_url: character.avatar,
        force: false,
      },
      metadata,
    };
  }

  async save(newState, expectedRevision) {
    if (this._failNextSave) {
      this._failNextSave = false;
      return { success: false, conflict: false, error: 'Simulated storage persistence failure.' };
    }

    const validation = validateState(newState);
    if (!validation.valid) {
      return { success: false, conflict: false, error: `State validation failed: ${validation.errors.join('; ')}` };
    }
    if (newState.namespace !== ALPHA_NAMESPACE || newState.schemaVersion !== ALPHA_SCHEMA_VERSION) {
      return { success: false, conflict: false, error: 'Alpha namespace/schema mismatch at host storage boundary.' };
    }

    const liveCtx = this._context();
    const liveChatId = this.getChatId(liveCtx);
    const target = this._lastLoadContext;
    if (!target || !target.chatId) {
      return { success: false, conflict: false, error: 'No captured host persistence context from storage load.' };
    }

    // If the same chat is still active, refresh non-Alpha metadata and chat content so
    // unrelated host changes are preserved. If the UI switched chats meanwhile, keep
    // the exact old-chat snapshot captured by load rather than writing into the new chat.
    if (liveChatId === target.chatId && liveCtx) {
      target.metadata = cloneJsonValue(this._getHostMetadata(liveCtx) || target.metadata) || {};
      target.chat = Array.isArray(liveCtx.chat) ? cloneJsonValue(liveCtx.chat) : target.chat;
      target.isGroup =
        (liveCtx.groupId !== undefined && liveCtx.groupId !== null && String(liveCtx.groupId).trim() !== '') ||
        (liveCtx.selected_group !== undefined && liveCtx.selected_group !== null && String(liveCtx.selected_group).trim() !== '');
      if (target.isGroup) {
        target.groupId = String(liveCtx.groupId || liveCtx.selected_group);
      } else if (Array.isArray(liveCtx.characters)) {
        const character = liveCtx.characters[liveCtx.characterId];
        target.character = character
          ? { name: character.name, chat: character.chat, avatar: character.avatar || character.avatar_url }
          : null;
      }
    }

    const currentStored = target.metadata?.[ALPHA_NAMESPACE] || this._chatStores.get(target.chatId) || null;
    const currentRevision = currentStored?.revision ?? target.revision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      return {
        success: false,
        conflict: true,
        currentRevision,
        expectedRevision,
        error: `CAS revision conflict: current revision is ${currentRevision}, but caller expected ${expectedRevision}.`,
      };
    }

    const nextRevision = currentRevision + 1;
    const cloned = cloneState(newState);
    cloned.revision = nextRevision;

    const request = this._buildCheckedSaveRequest(target, cloned);
    const fetchImpl = this._getFetch(liveCtx);
    const headersProvider = liveCtx?.getRequestHeaders;
    if (!request || typeof fetchImpl !== 'function' || typeof headersProvider !== 'function') {
      return {
        success: false,
        conflict: false,
        error: 'Required SillyTavern checked persistence capability is unavailable (fail closed).',
      };
    }

    let response;
    try {
      response = await fetchImpl(request.path, {
        method: 'POST',
        headers: headersProvider(),
        cache: 'no-cache',
        body: JSON.stringify(request.body),
      });
    } catch (error) {
      return {
        success: false,
        conflict: false,
        error: `Host checked persistence request failed: ${error?.message || String(error)}`,
      };
    }

    if (!response || response.ok !== true) {
      return {
        success: false,
        conflict: false,
        error: `Host checked persistence rejected Alpha save${response?.status ? ` (HTTP ${response.status})` : ''}.`,
      };
    }

    let acknowledgement = null;
    try {
      acknowledgement = typeof response.json === 'function' ? await response.json() : null;
    } catch {
      acknowledgement = null;
    }
    if (!acknowledgement || acknowledgement.ok !== true) {
      return {
        success: false,
        conflict: false,
        error: 'Host checked persistence response did not contain an explicit ok acknowledgement.',
      };
    }

    // Server persistence is authoritative. Only now expose the committed metadata to
    // the current client context (if it is still the same chat) and advance the cache.
    this._chatStores.set(target.chatId, cloneState(cloned));

    // Reacquire current context and current chat ID post-await (Review Finding 3).
    // If the active chat switched during the awaited save, do NOT leak target.chatId's
    // state into the newly active chat's client metadata.
    const postAwaitCtx = this._context();
    const postAwaitChatId = this.getChatId(postAwaitCtx);
    if (postAwaitChatId === target.chatId && postAwaitCtx) {
      if (!postAwaitCtx.chatMetadata && !postAwaitCtx.chat_metadata) {
        postAwaitCtx.chatMetadata = {};
      }
      const currentMeta = this._getHostMetadata(postAwaitCtx);
      if (currentMeta) currentMeta[ALPHA_NAMESPACE] = cloneState(cloned);
      if (typeof postAwaitCtx.updateChatMetadata === 'function') {
        postAwaitCtx.updateChatMetadata({ [ALPHA_NAMESPACE]: cloneState(cloned) });
      }
    }

    target.revision = nextRevision;
    target.metadata = request.metadata;
    return { success: true, revision: nextRevision, targetChatId: target.chatId };
  }
}
