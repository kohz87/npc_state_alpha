import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSourceReference,
  stripMachineTrailer,
  extractProvenanceRecord,
  extractSourcePayload,
  captureSourceDependency,
  revalidateSourceDependency,
} from '../src/runtime/source-resolver.js';
import {
  WRITERS,
} from '../src/contract/registry.js';
import {
  STRUCTURED_SEGMENT_KINDS,
  TRAILER_TAG_OPEN,
  TRAILER_TAG_CLOSE,
} from '../src/contract/wire-schemas.js';

test('Source Resolver: valid current:user and current:assistant sources resolve and verify excerpt', () => {
  const userText = 'Hello Elena, have you seen the guildmaster today?';
  const assistantNarrative = 'Elena nodded solemnly. "He departed at dawn towards the high pass."';
  const assistantFull = `${assistantNarrative}\n\n${TRAILER_TAG_OPEN}{"version":"1","npcs":[]}${TRAILER_TAG_CLOSE}`;

  const exchangeContext = {
    chatId: 'chat_001',
    currentUserMessage: {
      chatId: 'chat_001',
      position: 0,
      role: 'user',
      contentFingerprint: 'sha256:user0',
      precedingLineage: [],
      text: userText,
    },
    currentAssistantMessage: {
      chatId: 'chat_001',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:asst1',
      precedingLineage: ['sha256:user0'],
      text: assistantFull,
    },
  };

  // Resolve current:user
  const userRef = {
    sourceRef: 'current:user',
    excerpt: 'guildmaster',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };
  const userRes = resolveSourceReference(userRef, exchangeContext, { writer: WRITERS.ONE_PASS });
  assert.equal(userRes.valid, true, userRes.error);
  assert.equal(userRes.provenance.role, 'user');

  // Resolve current:assistant
  const asstRef = {
    sourceRef: 'current:assistant',
    excerpt: 'departed at dawn',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };
  const asstRes = resolveSourceReference(asstRef, exchangeContext, { writer: WRITERS.ONE_PASS });
  assert.equal(asstRes.valid, true, asstRes.error);
  assert.equal(asstRes.provenance.role, 'assistant');
});

test('Source Resolver: explicitly separated provenance metadata and source payload resolves cleanly', () => {
  const exchangeContext = {
    sources: [
      {
        id: 'msg_separated',
        sourceRef: 'msg_separated',
        // Pure provenance metadata strictly adhering to S1 allowlist
        provenance: {
          chatId: 'chat_sep_01',
          position: 1,
          role: 'assistant',
          contentFingerprint: 'sha256:sep1',
          precedingLineage: ['msg:0'],
        },
        // Source payload cleanly separated
        payload: {
          text: 'The archives remain locked until tomorrow morning.',
        },
      },
    ],
  };

  const ref = {
    sourceRef: 'msg_separated',
    excerpt: 'archives remain locked',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };

  const res = resolveSourceReference(ref, exchangeContext, { writer: WRITERS.DEVELOPMENT });
  assert.equal(res.valid, true, res.error);
  assert.equal(res.provenance.role, 'assistant');
  assert.equal(res.provenance.position, 1);
});

test('Source Resolver: wrong chat ID is mechanically detected and rejected', () => {
  const exchangeContext = {
    chatId: 'expected_chat_session_001',
    currentUserMessage: {
      chatId: 'foreign_chat_session_999', // Foreign chat
      position: 0,
      role: 'user',
      contentFingerprint: 'sha256:user0',
      precedingLineage: [],
      text: 'Hello from another chat!',
    },
  };

  const ref = {
    sourceRef: 'current:user',
    excerpt: 'Hello',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };

  const res = resolveSourceReference(ref, exchangeContext, { writer: WRITERS.ONE_PASS });
  assert.equal(res.valid, false);
  assert.equal(res.errorCode, 'wrong_chat');
  assert.match(res.error, /Wrong chat/);
});

test('Source Resolver: wrong sidecar ID is mechanically detected and rejected', () => {
  const exchangeContext = {
    sidecarId: 'expected_sidecar_alpha',
    currentUserMessage: {
      sidecarId: 'foreign_sidecar_beta', // Foreign sidecar
      position: 0,
      role: 'user',
      contentFingerprint: 'sha256:user0',
      precedingLineage: [],
      text: 'Testing sidecar matching',
    },
  };

  const ref = {
    sourceRef: 'current:user',
    excerpt: 'Testing sidecar',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };

  const res = resolveSourceReference(ref, exchangeContext, { writer: WRITERS.ONE_PASS });
  assert.equal(res.valid, false);
  assert.equal(res.errorCode, 'wrong_sidecar');
  assert.match(res.error, /Wrong sidecar/);
});

test('Source Resolver: wrong role is mechanically detected and rejected', () => {
  const exchangeContext = {
    currentUserMessage: {
      chatId: 'chat_001',
      position: 0,
      role: 'assistant', // Mismatched role for current:user!
      contentFingerprint: 'sha256:msg0',
      precedingLineage: [],
      text: 'I am mistakenly labeled assistant',
    },
  };

  const ref = {
    sourceRef: 'current:user',
    excerpt: 'mistakenly labeled',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };

  const res = resolveSourceReference(ref, exchangeContext, { writer: WRITERS.ONE_PASS });
  assert.equal(res.valid, false);
  assert.equal(res.errorCode, 'wrong_role');
  assert.match(res.error, /Wrong role.*expected 'user'/);
});

test('Source Resolver: wrong content fingerprint is mechanically detected and rejected', () => {
  const exchangeContext = {
    expectedUserFingerprint: 'sha256:correct_fingerprint_abc',
    currentUserMessage: {
      chatId: 'chat_001',
      position: 0,
      role: 'user',
      contentFingerprint: 'sha256:stale_fingerprint_xyz', // Mismatch!
      precedingLineage: [],
      text: 'Fingerprint test message',
    },
  };

  const ref = {
    sourceRef: 'current:user',
    excerpt: 'Fingerprint test',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };

  const res = resolveSourceReference(ref, exchangeContext, { writer: WRITERS.ONE_PASS });
  assert.equal(res.valid, false);
  assert.equal(res.errorCode, 'wrong_fingerprint');
  assert.match(res.error, /Wrong fingerprint/);
});

test('Source Resolver: stale preceding lineage is mechanically detected and rejected', () => {
  const exchangeContext = {
    requestLineage: ['msg:0', 'msg:1', 'msg:2'],
    currentAssistantMessage: {
      chatId: 'chat_001',
      position: 3,
      role: 'assistant',
      contentFingerprint: 'sha256:asst3',
      precedingLineage: ['msg:0', 'msg:diverged_fork'], // Stale fork / changed lineage!
      text: 'Narrative from a diverged lineage.',
    },
  };

  const ref = {
    sourceRef: 'current:assistant',
    excerpt: 'diverged lineage',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };

  const res = resolveSourceReference(ref, exchangeContext, { writer: WRITERS.ONE_PASS });
  assert.equal(res.valid, false);
  assert.equal(res.errorCode, 'stale_lineage');
  assert.match(res.error, /Stale lineage/);
});

test('Source Resolver: root lineage must be empty array, non-root must be non-empty', () => {
  const exchangeContext = {
    currentUserMessage: {
      chatId: 'chat_001',
      position: 0,
      role: 'user',
      contentFingerprint: 'sha256:user0',
      precedingLineage: ['stale:parent'], // Position 0 must have empty precedingLineage
      text: 'Initial message',
    },
  };

  const ref = {
    sourceRef: 'current:user',
    excerpt: 'Initial message',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };

  const res = resolveSourceReference(ref, exchangeContext, { writer: WRITERS.ONE_PASS });
  assert.equal(res.valid, false);
  assert.match(res.error, /Root owned source record \(position 0\) must have explicit empty precedingLineage/);
});

test('Source Resolver: excerpt mismatch is detected and rejected', () => {
  const exchangeContext = {
    currentUserMessage: {
      chatId: 'chat_001',
      position: 0,
      role: 'user',
      contentFingerprint: 'sha256:user0',
      precedingLineage: [],
      text: 'The weather is cloudy and cold.',
    },
  };

  const ref = {
    sourceRef: 'current:user',
    excerpt: 'sunny and hot outside', // Not in text
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };

  const res = resolveSourceReference(ref, exchangeContext, { writer: WRITERS.ONE_PASS });
  assert.equal(res.valid, false);
  assert.equal(res.errorCode, 'excerpt_mismatch');
});

test('Source Resolver: trailer exclusion strips trailer and rejects trailer self-citation', () => {
  const narrative = 'Elena took a deep breath.';
  const fullMessage = `${narrative}\n\n${TRAILER_TAG_OPEN}{"version":"1"}${TRAILER_TAG_CLOSE}`;

  const exchangeContext = {
    currentAssistantMessage: {
      chatId: 'chat_001',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:asst1',
      precedingLineage: ['sha256:user0'],
      text: fullMessage,
    },
  };

  // Valid narrative excerpt succeeds because trailer was stripped
  const validRef = {
    sourceRef: 'current:assistant',
    excerpt: 'deep breath',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };
  const validRes = resolveSourceReference(validRef, exchangeContext, { writer: WRITERS.ONE_PASS });
  assert.equal(validRes.valid, true);

  // Excerpt attempting to cite trailer text fails (cannot cite machine trailer)
  const trailerRef = {
    sourceRef: 'current:assistant',
    excerpt: TRAILER_TAG_OPEN,
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };
  const trailerRes = resolveSourceReference(trailerRef, exchangeContext, { writer: WRITERS.ONE_PASS });
  assert.equal(trailerRes.valid, false);
  assert.match(trailerRes.error, /transport exclusion violation/i);
});

test('Source Resolver: segment permissions permit/forbid target fields correctly', () => {
  const exchangeContext = {
    sources: [
      {
        id: 'src_1',
        sourceRef: 'src_1',
        chatId: 'chat_001',
        position: 2,
        role: 'system',
        contentFingerprint: 'sha256:sys1',
        precedingLineage: ['msg:0', 'msg:1'],
        worldStateText: 'Location: Ironforge Tavern. Status: Guard on duty.',
      },
    ],
  };

  // World_State permits location
  const locRef = {
    sourceRef: 'src_1',
    excerpt: 'Ironforge Tavern',
    segmentKind: STRUCTURED_SEGMENT_KINDS.WORLD_STATE,
  };
  const locRes = resolveSourceReference(locRef, exchangeContext, {
    writer: WRITERS.DEVELOPMENT,
    targetField: 'location',
  });
  assert.equal(locRes.valid, true);

  // World_State forbids mood (inner state only)
  const moodRes = resolveSourceReference(locRef, exchangeContext, {
    writer: WRITERS.DEVELOPMENT,
    targetField: 'mood',
  });
  assert.equal(moodRes.valid, false);
  assert.match(moodRes.error, /Segment permission violation/);
});

test('Source Resolver: copy metadata is preserved as provenance, not independent recurrence proof', () => {
  const exchangeContext = {
    sources: [
      {
        id: 'src_copy',
        sourceRef: 'src_copy',
        chatId: 'chat_001',
        position: 2,
        role: 'assistant',
        contentFingerprint: 'sha256:copy1',
        precedingLineage: ['msg:0', 'msg:1'],
        text: 'Elena repeated the ancient vow word for word.',
      },
    ],
  };

  const copyRef = {
    sourceRef: 'src_copy',
    excerpt: 'ancient vow',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
    copiedFrom: 'src_original_001',
    sameEventRef: 'evt_vow_001',
  };

  const res = resolveSourceReference(copyRef, exchangeContext, { writer: WRITERS.DEVELOPMENT });
  assert.equal(res.valid, true);
  assert.equal(res.isCopy, true);
});

test('Source Resolver Hardening: stripMachineTrailer strictly excludes only exactly recognized final trailers', () => {
  const narrative = 'The evening shadows lengthened across the cobblestones.';
  const validTrailer = `<npc_state_alpha_v1>{"version":"1","proposals":[]}</npc_state_alpha_v1>`;

  // 1. Exactly recognized final trailer is cleanly stripped
  const cleanInput = `${narrative}\n\n${validTrailer}`;
  assert.equal(stripMachineTrailer(cleanInput), narrative);

  // 2. Truncated trailer (open tag with missing close tag) must NOT be stripped or altered
  const truncatedInput = `${narrative}\n\n<npc_state_alpha_v1>{"version":"1","proposals":[]`;
  assert.equal(stripMachineTrailer(truncatedInput), truncatedInput);

  // 3. Non-final trailer (trailing narrative following closing tag) must NOT be stripped
  const nonFinalInput = `${narrative} <npc_state_alpha_v1>{"version":"1"}</npc_state_alpha_v1> Elena paused before speaking.`;
  assert.equal(stripMachineTrailer(nonFinalInput), nonFinalInput);

  // 4. Duplicate trailers must NOT be stripped
  const duplicateInput = `${narrative} ${validTrailer} ${validTrailer}`;
  assert.equal(stripMachineTrailer(duplicateInput), duplicateInput);

  // 5. Inverted tags (close before open) must NOT be stripped
  const invertedInput = `${narrative} </npc_state_alpha_v1> <npc_state_alpha_v1>`;
  assert.equal(stripMachineTrailer(invertedInput), invertedInput);

  // 6. Text without any trailer is returned unmodified
  assert.equal(stripMachineTrailer(narrative), narrative);

  // 7. Non-string inputs fail safely
  assert.equal(stripMachineTrailer(null), '');
  assert.equal(stripMachineTrailer(undefined), '');
});

test('Source Resolver Hardening: current assistant rejects arbitrary extra lineage beyond exact expected lineage', () => {
  const expectedLineage = ['msg:0', 'msg:1'];

  // Current assistant message has extra arbitrary lineage appended beyond expected lineage
  const extraLineageContext = {
    requestLineage: expectedLineage,
    currentAssistantMessage: {
      chatId: 'chat_001',
      position: 3,
      role: 'assistant',
      contentFingerprint: 'sha256:asst_extra',
      precedingLineage: ['msg:0', 'msg:1', 'msg:extra_orphan_2'], // Extra lineage beyond expected!
      text: 'Elena recounted the tale.',
    },
  };

  const ref = {
    sourceRef: 'current:assistant',
    excerpt: 'recounted the tale',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };

  // Must reject mechanically; prefix match is forbidden
  const resExtra = resolveSourceReference(ref, extraLineageContext, { writer: WRITERS.ONE_PASS });
  assert.equal(resExtra.valid, false);
  assert.equal(resExtra.errorCode, 'stale_lineage');
  assert.match(resExtra.error, /Stale lineage: source precedingLineage does not match expected lineage for 'current:assistant'/);

  // Exact match succeeds
  const exactLineageContext = {
    requestLineage: expectedLineage,
    currentAssistantMessage: {
      chatId: 'chat_001',
      position: 2,
      role: 'assistant',
      contentFingerprint: 'sha256:asst_exact',
      precedingLineage: ['msg:0', 'msg:1'], // Exact match
      text: 'Elena recounted the tale.',
    },
  };
  const resExact = resolveSourceReference(ref, exactLineageContext, { writer: WRITERS.ONE_PASS });
  assert.equal(resExact.valid, true);
});

test('Source Resolver Hardening: development refs receive and enforce their own explicit expected lineage', () => {
  const devContext = {
    requestLineage: ['msg:0', 'msg:1', 'msg:2', 'msg:3'], // Current chat turn is at msg:3
    expectedLineages: {
      'msg:1': ['msg:0'], // Explicit expected lineage for historical msg:1
    },
    sources: [
      {
        id: 'msg:1',
        sourceRef: 'msg:1',
        chatId: 'chat_001',
        position: 1,
        role: 'user',
        contentFingerprint: 'sha256:user1',
        precedingLineage: ['msg:0'], // Matches its explicit expected lineage
        text: 'Can you tell me about the archive?',
      },
    ],
  };

  const ref = {
    sourceRef: 'msg:1',
    excerpt: 'about the archive',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };

  // Historical ref is NOT rejected merely because requestLineage has advanced to msg:3
  const resDev = resolveSourceReference(ref, devContext, { writer: WRITERS.DEVELOPMENT });
  assert.equal(resDev.valid, true);

  // If explicit expected lineage for msg:1 does not match, it is mechanically rejected
  const devMismatchContext = {
    ...devContext,
    expectedLineages: {
      'msg:1': ['msg:diverged_fork'],
    },
  };
  const resMismatch = resolveSourceReference(ref, devMismatchContext, { writer: WRITERS.DEVELOPMENT });
  assert.equal(resMismatch.valid, false);
  assert.equal(resMismatch.errorCode, 'stale_lineage');
});

test('Source Resolver (Items 4 & 13): captureSourceDependency captures exact ownership identity and separates expectations', () => {
  const narrative = 'Elena nodded solemnly and placed the grimoire upon the table.';
  const assistantFull = `${narrative}\n\n${TRAILER_TAG_OPEN}{"version":"1","npcs":[]}${TRAILER_TAG_CLOSE}`;

  const exchangeContext = {
    chatId: 'chat_test_001',
    sidecarId: 'sidecar_test_001',
    currentAssistantMessage: {
      chatId: 'chat_test_001',
      sidecarId: 'sidecar_test_001',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:asst_test_1',
      precedingLineage: ['sha256:user0'],
      swipe: 'swipe_0',
      revision: 'rev_1',
      text: assistantFull,
    },
  };

  const sourceRefObj = {
    sourceRef: 'current:assistant',
    excerpt: 'grimoire upon the table',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
  };

  const captureRes = captureSourceDependency(sourceRefObj, exchangeContext, {
    writer: WRITERS.ONE_PASS,
    targetField: 'location',
  });

  assert.equal(captureRes.valid, true, captureRes.error);
  const dep = captureRes.capturedDependency;
  assert.equal(dep.sourceRef, 'current:assistant');
  assert.equal(dep.targetField, 'location');
  assert.equal(dep.writer, WRITERS.ONE_PASS);
  assert.equal(dep.excerpt, 'grimoire upon the table');
  assert.equal(dep.segmentKind, STRUCTURED_SEGMENT_KINDS.NARRATIVE);

  // Expectations separation: owned source record was not modified with ad-hoc expected* keys (Item 13)
  assert.equal(exchangeContext.currentAssistantMessage.expectedFingerprint, undefined);
  assert.equal(exchangeContext.currentAssistantMessage.expectedLineage, undefined);

  // Captured provenance descriptor contains exact ownership identity (Item 4)
  assert.deepEqual(dep.capturedProvenance, {
    chatId: 'chat_test_001',
    sidecarId: 'sidecar_test_001',
    position: 1,
    role: 'assistant',
    contentFingerprint: 'sha256:asst_test_1',
    precedingLineage: ['sha256:user0'],
    swipe: 'swipe_0',
    revision: 'rev_1',
  });
});

test('Source Resolver (Item 4): revalidateSourceDependency passes when source matches and fails closed on all ownership differences', () => {
  const narrative = 'Elena nodded solemnly and placed the grimoire upon the table.';
  const assistantFull = `${narrative}\n\n${TRAILER_TAG_OPEN}{"version":"1","npcs":[]}${TRAILER_TAG_CLOSE}`;

  const baseExchangeContext = {
    chatId: 'chat_test_001',
    sidecarId: 'sidecar_test_001',
    currentAssistantMessage: {
      chatId: 'chat_test_001',
      sidecarId: 'sidecar_test_001',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:asst_test_1',
      precedingLineage: ['sha256:user0'],
      swipe: 'swipe_0',
      revision: 'rev_1',
      text: assistantFull,
    },
  };

  const capturedDep = {
    sourceRef: 'current:assistant',
    targetField: 'location',
    excerpt: 'grimoire upon the table',
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
    capturedProvenance: {
      chatId: 'chat_test_001',
      sidecarId: 'sidecar_test_001',
      position: 1,
      role: 'assistant',
      contentFingerprint: 'sha256:asst_test_1',
      precedingLineage: ['sha256:user0'],
      swipe: 'swipe_0',
      revision: 'rev_1',
    },
  };

  // 1. Exact match succeeds
  const matchRes = revalidateSourceDependency(capturedDep, baseExchangeContext);
  assert.equal(matchRes.valid, true, matchRes.error);

  // 2. Raw string or invalid descriptor rejected (fail closed)
  assert.equal(revalidateSourceDependency('raw:string', baseExchangeContext).valid, false);
  assert.equal(revalidateSourceDependency(null, baseExchangeContext).valid, false);
  assert.equal(revalidateSourceDependency({}, baseExchangeContext).valid, false);

  // 3. ChatId mismatch
  const wrongChatCtx = {
    ...baseExchangeContext,
    currentAssistantMessage: { ...baseExchangeContext.currentAssistantMessage, chatId: 'chat_other' },
  };
  const wrongChatRes = revalidateSourceDependency(capturedDep, wrongChatCtx);
  assert.equal(wrongChatRes.valid, false);
  assert.equal(wrongChatRes.errorCode, 'wrong_chat');

  // 4. SidecarId mismatch
  const wrongSidecarCtx = {
    ...baseExchangeContext,
    currentAssistantMessage: { ...baseExchangeContext.currentAssistantMessage, sidecarId: 'sidecar_other' },
  };
  const wrongSidecarRes = revalidateSourceDependency(capturedDep, wrongSidecarCtx);
  assert.equal(wrongSidecarRes.valid, false);
  assert.equal(wrongSidecarRes.errorCode, 'wrong_sidecar');

  // 5. Position mismatch
  const wrongPosCtx = {
    ...baseExchangeContext,
    currentAssistantMessage: { ...baseExchangeContext.currentAssistantMessage, position: 2 },
  };
  const wrongPosRes = revalidateSourceDependency(capturedDep, wrongPosCtx);
  assert.equal(wrongPosRes.valid, false);
  assert.equal(wrongPosRes.errorCode, 'wrong_position');

  // 6. Role mismatch
  const wrongRoleCtx = {
    ...baseExchangeContext,
    currentAssistantMessage: { ...baseExchangeContext.currentAssistantMessage, role: 'user' },
  };
  const wrongRoleRes = revalidateSourceDependency(capturedDep, wrongRoleCtx);
  assert.equal(wrongRoleRes.valid, false);
  assert.equal(wrongRoleRes.errorCode, 'wrong_role');

  // 7. Fingerprint mismatch
  const wrongFpCtx = {
    ...baseExchangeContext,
    currentAssistantMessage: { ...baseExchangeContext.currentAssistantMessage, contentFingerprint: 'sha256:different' },
  };
  const wrongFpRes = revalidateSourceDependency(capturedDep, wrongFpCtx);
  assert.equal(wrongFpRes.valid, false);
  assert.equal(wrongFpRes.errorCode, 'wrong_fingerprint');

  // 8. Stale lineage mismatch
  const wrongLineageCtx = {
    ...baseExchangeContext,
    currentAssistantMessage: { ...baseExchangeContext.currentAssistantMessage, precedingLineage: ['sha256:diverged'] },
  };
  const wrongLineageRes = revalidateSourceDependency(capturedDep, wrongLineageCtx);
  assert.equal(wrongLineageRes.valid, false);
  assert.equal(wrongLineageRes.errorCode, 'stale_lineage');

  // 9. Swipe mismatch
  const wrongSwipeCtx = {
    ...baseExchangeContext,
    currentAssistantMessage: { ...baseExchangeContext.currentAssistantMessage, swipe: 'swipe_1' },
  };
  const wrongSwipeRes = revalidateSourceDependency(capturedDep, wrongSwipeCtx);
  assert.equal(wrongSwipeRes.valid, false);
  assert.equal(wrongSwipeRes.errorCode, 'wrong_swipe');

  // 10. Revision mismatch
  const wrongRevCtx = {
    ...baseExchangeContext,
    currentAssistantMessage: { ...baseExchangeContext.currentAssistantMessage, revision: 'rev_2' },
  };
  const wrongRevRes = revalidateSourceDependency(capturedDep, wrongRevCtx);
  assert.equal(wrongRevRes.valid, false);
  assert.equal(wrongRevRes.errorCode, 'wrong_revision');

  // 11. Excerpt mismatch (text changed so excerpt no longer found)
  const wrongTextCtx = {
    ...baseExchangeContext,
    currentAssistantMessage: {
      ...baseExchangeContext.currentAssistantMessage,
      text: `Elena walked out into the rain.\n\n${TRAILER_TAG_OPEN}{"version":"1","npcs":[]}${TRAILER_TAG_CLOSE}`,
    },
  };
  const wrongExcerptRes = revalidateSourceDependency(capturedDep, wrongTextCtx);
  assert.equal(wrongExcerptRes.valid, false);
  assert.equal(wrongExcerptRes.errorCode, 'excerpt_mismatch');
});

