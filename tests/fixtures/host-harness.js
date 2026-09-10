/**
 * NPC State Alpha — Deterministic SillyTavern 1.18.0 Host Harness
 *
 * Models exact verified SillyTavern 1.18.0 extension API & event lifecycle
 * (installed commit 8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8).
 *
 * EVIDENCE LABEL: DETERMINISTIC HOST FIXTURE / TEST HARNESS
 * (Simulates host APIs in automated tests where live host / LLM is unavailable).
 */

import { DEFAULT_INTERCEPTOR_KEY } from '../../src/host/sillytavern-adapter.js';

export class MockEventSource {
  constructor() {
    this._listeners = new Map();
  }

  on(eventName, handler) {
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, []);
    }
    this._listeners.get(eventName).push(handler);
  }

  off(eventName, handler) {
    if (!this._listeners.has(eventName)) return;
    const list = this._listeners.get(eventName);
    const idx = list.indexOf(handler);
    if (idx >= 0) {
      list.splice(idx, 1);
    }
  }

  async emit(eventName, ...args) {
    if (!this._listeners.has(eventName)) return;
    const list = [...this._listeners.get(eventName)];
    for (const handler of list) {
      await handler(...args);
    }
  }
}

export class MockSillyTavernHost {
  /**
   * @param {object} [options]
   * @param {string} [options.chatId='chat_001']
   */
  constructor(options = {}) {
    this.isFixtureHarness = true;
    this.fixtureEnvironment = 'SillyTavern 1.18.0 Mock Host (commit 8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8)';

    this.chatId = options.chatId || 'chat_001';
    this.characterId = options.characterId !== undefined ? options.characterId : 0;
    this.characters = options.characters || [
      {
        name: options.characterName || 'TestCharacter',
        chat: this.chatId,
        avatar: options.characterAvatar || 'test_character.png',
      },
    ];
    this.groupId = options.groupId !== undefined ? options.groupId : null;
    this.groups = options.groups || [];
    this.selected_group = options.selected_group !== undefined ? options.selected_group : (this.groupId || null);

    this.chat = [];
    this.chatsByChatId = new Map();
    this.metadataByChatId = new Map();

    this.chatsByChatId.set(this.chatId, this.chat);
    this.metadataByChatId.set(this.chatId, {});

    this.eventSource = new MockEventSource();
    this.eventTypes = Object.freeze({
      MESSAGE_RECEIVED: 'message_received',
      CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
      MESSAGE_SWIPED: 'message_swiped',
      MESSAGE_SENT: 'message_sent',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_DELETED: 'message_deleted',
      MESSAGE_UPDATED: 'message_updated',
      MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
      CHAT_CHANGED: 'chat_id_changed',
      CHAT_LOADED: 'chatLoaded',
      GENERATION_STARTED: 'generation_started',
      GENERATION_STOPPED: 'generation_stopped',
      GENERATION_ENDED: 'generation_ended',
      STREAM_TOKEN_RECEIVED: 'stream_token_received',
    });

    this.extensionPrompts = new Map();
    this.lastInterceptorChat = null;
    this.saveChatCalls = 0;
    this.checkedSaveCalls = [];
    this.updateMessageBlockCalls = [];
    this.fetchNetworkFailure = false;
    this.fetchStatus = 200;
    this.streamingProcessor = options.streamingProcessor || null;
    this.fetchHook = options.fetchHook || null;
    this.interceptorKey = options.interceptorKey || DEFAULT_INTERCEPTOR_KEY;
  }

  setStreamingProcessor(processor) {
    this.streamingProcessor = processor;
  }

  setFetchHook(fn) {
    this.fetchHook = fn;
  }

  setFetchNetworkFailure(shouldFail = true) {
    this.fetchNetworkFailure = shouldFail;
  }

  setFetchStatus(status) {
    this.fetchStatus = status;
  }

  setFetchResponseBody(body) {
    this.fetchResponseBody = body;
  }

  async handleFetch(url, fetchOptions = {}) {
    if (this.fetchNetworkFailure) {
      throw new Error('Simulated network failure');
    }
    if (typeof this.fetchHook === 'function') {
      await this.fetchHook(url, fetchOptions);
    }
    const body = fetchOptions.body ? JSON.parse(fetchOptions.body) : null;
    this.checkedSaveCalls.push({
      url,
      method: fetchOptions.method || 'GET',
      headers: fetchOptions.headers || {},
      body,
    });
    const status = this.fetchStatus !== undefined ? this.fetchStatus : 200;
    const ok = status >= 200 && status < 300;
    const payload = this.fetchResponseBody !== undefined ? this.fetchResponseBody : { ok: true };
    return {
      ok,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  }

  /**
   * Returns mock SillyTavern getContext() object.
   */
  getContext() {
    const self = this;
    return {
      get chat() {
        return self.chat;
      },
      get chatId() {
        return self.chatId;
      },
      getCurrentChatId: () => self.chatId,
      get characterId() {
        return self.characterId;
      },
      get characters() {
        return self.characters;
      },
      get groupId() {
        return self.groupId;
      },
      get selected_group() {
        return self.selected_group;
      },
      get groups() {
        return self.groups;
      },
      eventSource: self.eventSource,
      eventTypes: self.eventTypes,
      setExtensionPrompt: (key, prompt, position, depth, scan) => {
        self.extensionPrompts.set(key, { prompt, position, depth, scan });
      },
      saveChat: async () => {
        self.saveChatCalls++;
        return true;
      },
      saveChatDebounced: () => {
        self.saveChatCalls++;
      },
      updateChatMetadata: (newValues, reset) => {
        const current = self.metadataByChatId.get(self.chatId) || {};
        if (reset) {
          self.metadataByChatId.set(self.chatId, { ...newValues });
        } else {
          self.metadataByChatId.set(self.chatId, { ...current, ...newValues });
        }
      },
      updateMessageBlock: (messageId, message, options = {}) => {
        self.updateMessageBlockCalls.push({ messageId, message, options });
      },
      getRequestHeaders: () => ({
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'mock-csrf-token',
      }),
      fetch: async (url, fetchOptions = {}) => {
        return self.handleFetch(url, fetchOptions);
      },
      get chatMetadata() {
        return self.metadataByChatId.get(self.chatId) || {};
      },
      get streamingProcessor() {
        return self.streamingProcessor;
      },
    };
  }

  /**
   * Appends an ordinary user message to chat.
   * @param {string} text
   * @returns {number} message index
   */
  sendUserMessage(text) {
    const msg = {
      is_user: true,
      is_system: false,
      name: 'User',
      mes: text,
      send_date: Date.now(),
    };
    this.chat.push(msg);
    return this.chat.length - 1;
  }

  /**
   * Simulates SillyTavern calling generate_interceptor manifest hook.
   * @param {string} [type='normal']
   * @param {Array<object>} [customChat=null] Optional derived/coreChat array passed to interceptor
   */
  async triggerGenerateInterceptor(type = 'normal', customChat = null) {
    const chatToPass = customChat || this.chat.map((m) => ({ ...m }));
    this.lastInterceptorChat = chatToPass;
    if (typeof globalThis[this.interceptorKey] === 'function') {
      await globalThis[this.interceptorKey](chatToPass, 4096, null, type);
    }
  }

  /**
   * Simulates fresh chat first-message path (MESSAGE_RECEIVED with type 'first_message').
   */
  async emitFirstMessage() {
    await this.eventSource.emit(this.eventTypes.MESSAGE_RECEIVED, this.chatId, 'first_message');
    await this.eventSource.emit(this.eventTypes.CHARACTER_MESSAGE_RENDERED, this.chatId, 'first_message');
  }

  /**
   * Simulates streaming progress tokens (emits STREAM_TOKEN_RECEIVED with text argument per ST 1.18.0).
   * @param {number} messageIndex
   * @param {string} token
   */
  async emitStreamToken(messageIndex, token) {
    if (!this.chat[messageIndex]) {
      this.chat[messageIndex] = {
        is_user: false,
        is_system: false,
        name: 'Assistant',
        mes: '',
        send_date: Date.now(),
      };
    }
    this.chat[messageIndex].mes += token;
    await this.eventSource.emit(this.eventTypes.STREAM_TOKEN_RECEIVED, token);
  }

  /**
   * Simulates message edited/updated by user.
   * @param {number} messageIndex
   * @param {string} newText
   */
  async editMessage(messageIndex, newText) {
    if (this.chat[messageIndex]) {
      this.chat[messageIndex].mes = newText;
    }
    await this.eventSource.emit(this.eventTypes.MESSAGE_EDITED, messageIndex);
    await this.eventSource.emit(this.eventTypes.MESSAGE_UPDATED, messageIndex);
  }

  /**
   * Simulates message deletion.
   * @param {number} messageIndex
   */
  async deleteMessage(messageIndex) {
    if (this.chat[messageIndex]) {
      this.chat.splice(messageIndex, 1);
    }
    await this.eventSource.emit(this.eventTypes.MESSAGE_DELETED, messageIndex);
  }

  /**
   * Simulates swipe deletion (emits MESSAGE_SWIPE_DELETED with object payload).
   * @param {number} messageIndex
   * @param {number} [swipeId=0]
   * @param {number} [newSwipeId=0]
   */
  async deleteSwipe(messageIndex, swipeId = 0, newSwipeId = 0) {
    await this.eventSource.emit(this.eventTypes.MESSAGE_SWIPE_DELETED, {
      messageId: messageIndex,
      swipeId,
      newSwipeId,
    });
  }

  /**
   * Simulates finalizeIntermediaryMessage() completing streaming and emitting MESSAGE_RECEIVED.
   * @param {number} messageIndex
   */
  async finalizeStreamingMessage(messageIndex) {
    if (this.streamingProcessor === null) {
      this.streamingProcessor = {
        messageId: messageIndex,
        isFinished: true,
        isStopped: false,
        abortController: new AbortController(),
      };
    }
    await this.eventSource.emit(this.eventTypes.MESSAGE_RECEIVED, messageIndex, 'streaming');
    await this.eventSource.emit(this.eventTypes.CHARACTER_MESSAGE_RENDERED, messageIndex, 'streaming');
    this.streamingProcessor = null;
  }

  /**
   * Simulates non-streaming saveReply() completing and emitting MESSAGE_RECEIVED.
   * @param {string} text Narrative text (optionally with trailer)
   * @param {object} [options]
   * @param {number} [options.swipeId=0]
   * @param {Array<string>} [options.swipes]
   * @returns {number} message index
   */
  async receiveAssistantMessage(text, options = {}) {
    const swipeId = options.swipeId !== undefined ? options.swipeId : 0;
    const msg = {
      is_user: false,
      is_system: false,
      name: 'Assistant',
      mes: text,
      send_date: Date.now(),
      swipe_id: swipeId,
      swipes: options.swipes || [text],
      extra: options.extra ? structuredClone(options.extra) : {},
    };
    this.chat.push(msg);
    const msgIndex = this.chat.length - 1;
    // Exact non-streaming ST 1.18.0 order: MESSAGE_RECEIVED is awaited before
    // addOneMessage/render, then CHARACTER_MESSAGE_RENDERED is emitted.
    await this.eventSource.emit(this.eventTypes.MESSAGE_RECEIVED, msgIndex, 'normal');
    await this.eventSource.emit(this.eventTypes.CHARACTER_MESSAGE_RENDERED, msgIndex, 'normal');
    return msgIndex;
  }

  /**
   * Simulates SillyTavern continuation: appends continuation text to the last assistant
   * message and emits MESSAGE_RECEIVED(samePosition, 'continue').
   * @param {string} continuationText
   * @returns {Promise<number>} message index
   */
  async continueAssistantMessage(continuationText) {
    const lastIndex = this.chat.length - 1;
    if (lastIndex < 0 || this.chat[lastIndex].is_user || this.chat[lastIndex].is_system) {
      throw new Error('No assistant message at end of chat to continue.');
    }
    this.chat[lastIndex].mes += continuationText;
    const swipeId = this.chat[lastIndex].swipe_id || 0;
    if (Array.isArray(this.chat[lastIndex].swipes)) {
      if (this.chat[lastIndex].swipes[swipeId] !== undefined) {
        this.chat[lastIndex].swipes[swipeId] += continuationText;
      } else {
        this.chat[lastIndex].swipes[swipeId] = this.chat[lastIndex].mes;
      }
    }
    await this.eventSource.emit(this.eventTypes.MESSAGE_RECEIVED, lastIndex, 'continue');
    await this.eventSource.emit(this.eventTypes.CHARACTER_MESSAGE_RENDERED, lastIndex, 'continue');
    return lastIndex;
  }

  /**
   * Simulates MESSAGE_SWIPED on user swipe transition.
   * @param {number} messageIndex
   * @param {number} newSwipeId
   * @param {string} newText
   */
  async swipeMessage(messageIndex, newSwipeId, newText) {
    if (this.chat[messageIndex]) {
      this.chat[messageIndex].swipe_id = newSwipeId;
      this.chat[messageIndex].mes = newText;
      if (Array.isArray(this.chat[messageIndex].swipes)) {
        this.chat[messageIndex].swipes[newSwipeId] = newText;
      }
    }
    await this.eventSource.emit(this.eventTypes.MESSAGE_SWIPED, messageIndex);
  }

  /**
   * Simulates chat switch to a different chatId.
   * @param {string} newChatId
   */
  async switchChat(newChatId) {
    this.chatId = newChatId;
    if (this.characters && this.characters[this.characterId]) {
      this.characters[this.characterId].chat = newChatId;
    }
    if (!this.chatsByChatId.has(newChatId)) {
      this.chatsByChatId.set(newChatId, []);
      this.metadataByChatId.set(newChatId, {});
    }
    this.chat = this.chatsByChatId.get(newChatId);
    await this.eventSource.emit(this.eventTypes.CHAT_CHANGED, newChatId);
    await this.eventSource.emit(this.eventTypes.CHAT_LOADED, newChatId);
  }

  /**
   * Simulates generation stop / abort.
   */
  async abortGeneration() {
    await this.eventSource.emit(this.eventTypes.GENERATION_STOPPED);
  }

  /**
   * Simulates GENERATION_ENDED (emitted by hideStopButton, not a commit signal).
   */
  async simulateGenerationEnded() {
    await this.eventSource.emit(this.eventTypes.GENERATION_ENDED);
  }
}
