/**
 * NPC State Alpha — Shared Runtime Source & Evidence Resolver
 *
 * Implements C03 source identity, reserved references, trailer exclusion,
 * exact excerpt verification, and structured segment permission enforcement.
 * Derived strictly from S1 source contracts and S1 centralized tables.
 */

import {
  WRITERS,
} from '../contract/registry.js';
import {
  TRAILER_TAG_OPEN,
  TRAILER_TAG_CLOSE,
  STRUCTURED_SEGMENT_KINDS,
} from '../contract/wire-schemas.js';
import {
  validateSourceReference,
  validateOwnedSourceRecord,
  validateSegmentFieldPermission,
} from '../contract/validator.js';

export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Deterministically strips machine trailer from assistant narrative.
 * Strictly excludes only an exactly recognized final trailer at the end of narrative (C03, C04).
 * Malformed, truncated, duplicate, or non-final tags are returned unaltered so narrative
 * is never modified to conceal malformed transport.
 *
 * @param {string} text
 * @returns {string} Text without machine trailer
 */
export function stripMachineTrailer(text) {
  if (typeof text !== 'string') return '';

  const openCount = (text.match(new RegExp(escapeRegex(TRAILER_TAG_OPEN), 'g')) || []).length;
  const closeCount = (text.match(new RegExp(escapeRegex(TRAILER_TAG_CLOSE), 'g')) || []).length;

  // Exactly one open tag and one close tag required
  if (openCount !== 1 || closeCount !== 1) {
    return text;
  }

  const firstOpen = text.indexOf(TRAILER_TAG_OPEN);
  const firstClose = text.indexOf(TRAILER_TAG_CLOSE);

  // Close tag must occur after open tag
  if (firstClose < firstOpen) {
    return text;
  }

  // Trailer must be at the very end of narrative (allowing only trailing whitespace)
  const afterClose = text.slice(firstClose + TRAILER_TAG_CLOSE.length);
  if (afterClose.trim().length > 0) {
    return text;
  }

  // Exactly recognized final trailer: strip trailer and return story narrative
  return text.slice(0, firstOpen).trimEnd();
}

/**
 * Normalizes text for exact excerpt verification (preserves characters, normalizes CRLF).
 * @param {string} str
 * @returns {string}
 */
export function normalizeSourceText(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\r\n/g, '\n');
}

/**
 * Extracts pure provenance metadata record from a source item or message object.
 * Does not weaken S1 key validation: strictly extracts only the allowed provenance fields
 * if present, or uses the dedicated .provenance or .source sub-object.
 *
 * @param {object} sourceItem
 * @returns {object|null}
 */
export function extractProvenanceRecord(sourceItem) {
  if (!sourceItem || typeof sourceItem !== 'object') {
    return null;
  }

  // If already separated as a provenance sub-object
  if (sourceItem.provenance && typeof sourceItem.provenance === 'object') {
    return sourceItem.provenance;
  }

  // If source property is an owned source record
  if (
    sourceItem.source &&
    typeof sourceItem.source === 'object' &&
    (sourceItem.source.chatId !== undefined ||
      sourceItem.source.sidecarId !== undefined ||
      sourceItem.source.position !== undefined)
  ) {
    return sourceItem.source;
  }

  // Explicitly extract the allowed provenance fields
  const p = {};
  const ALLOWED_PROVENANCE_KEYS = [
    'chatId',
    'sidecarId',
    'position',
    'role',
    'contentFingerprint',
    'precedingLineage',
    'swipe',
    'revision',
  ];

  for (const key of ALLOWED_PROVENANCE_KEYS) {
    if (sourceItem[key] !== undefined) {
      p[key] = sourceItem[key];
    }
  }

  // Propagate any unknown keys from a flat provenance object so that S1 validateOwnedSourceRecord
  // will strictly reject unknown keys
  const ALLOWED_MESSAGE_KEYS = [
    ...ALLOWED_PROVENANCE_KEYS,
    'text',
    'content',
    'payload',
    'segments',
    'worldStateText',
    'innerChatterText',
    'id',
    'sourceRef',
    'sourceId',
  ];

  for (const k of Object.keys(sourceItem)) {
    if (!ALLOWED_MESSAGE_KEYS.includes(k)) {
      p[k] = sourceItem[k];
    }
  }

  return p;
}

/**
 * Extracts text and structured segments payload from a source item.
 *
 * @param {object} sourceItem
 * @returns {{ text: string, segments: object }}
 */
export function extractSourcePayload(sourceItem) {
  if (!sourceItem || typeof sourceItem !== 'object') {
    return { text: '', segments: {} };
  }

  const payload = sourceItem.payload || sourceItem;
  const text = payload.text || payload.content || '';
  const segments = payload.segments || {
    world_state: payload.worldStateText,
    inner_chatter: payload.innerChatterText,
  };

  return { text, segments };
}

/**
 * Resolves and validates a model source reference against supplied owned source context.
 * Mechanically compares resolved source against request/context expectations for:
 * - Wrong chat / sidecar
 * - Wrong role
 * - Wrong content fingerprint
 * - Stale preceding lineage
 *
 * @param {object} sourceRefObj Source reference object from proposal ({ sourceRef, excerpt, segmentKind, ... })
 * @param {object} exchangeContext Context containing owned messages and segments
 * @param {object} [options]
 * @param {string} [options.writer] The calling writer (one_pass, development)
 * @param {string} [options.targetField] Field being modified, for segment permission checking
 * @param {string} [options.expectedRole] Expected role if explicitly specified
 * @param {string} [options.expectedFingerprint] Expected content fingerprint
 * @param {Array<string>} [options.expectedLineage] Expected preceding lineage array
 * @returns {{ valid: boolean, resolvedSource?: object, provenance?: object, isCopy?: boolean, error?: string, errorCode?: string }}
 */
export function resolveSourceReference(sourceRefObj, exchangeContext, options = {}) {
  if (!sourceRefObj || typeof sourceRefObj !== 'object') {
    return { valid: false, error: 'Source reference must be an object.' };
  }

  // 1. Syntactic / schema validation of source reference object using S1 validator
  const refVal = validateSourceReference(sourceRefObj, { writer: options.writer });
  if (!refVal.valid) {
    return { valid: false, error: refVal.errorMessage, errorCode: refVal.errorCode };
  }

  const { sourceRef, excerpt } = sourceRefObj;
  const segmentKind = sourceRefObj.segmentKind || STRUCTURED_SEGMENT_KINDS.NARRATIVE;

  // 2. Transport exclusion check
  if (excerpt.includes(TRAILER_TAG_OPEN) || excerpt.includes(TRAILER_TAG_CLOSE)) {
    return {
      valid: false,
      error: 'Source excerpt cannot cite the machine trailer (C03 transport exclusion violation).',
      errorCode: 'trailer_self_citation',
    };
  }

  // 3. Resolve the underlying owned source record
  let sourceRecord = null;
  if (sourceRef === 'current:user') {
    sourceRecord = exchangeContext?.currentUserMessage || null;
    if (!sourceRecord) {
      return { valid: false, error: "Reserved source 'current:user' not found in exchange context." };
    }
  } else if (sourceRef === 'current:assistant') {
    sourceRecord = exchangeContext?.currentAssistantMessage || null;
    if (!sourceRecord) {
      return { valid: false, error: "Reserved source 'current:assistant' not found in exchange context." };
    }
  } else {
    // Development compact ref or explicit lookup
    if (exchangeContext?.sources instanceof Map) {
      sourceRecord = exchangeContext.sources.get(sourceRef) || null;
    } else if (Array.isArray(exchangeContext?.sources)) {
      // Item A: collect ALL label matches rather than Array.find
      const allMatches = exchangeContext.sources.filter(
        (s) => s.sourceRef === sourceRef || s.id === sourceRef || s.sourceId === sourceRef
      );
      if (allMatches.length === 1) {
        sourceRecord = allMatches[0];
      } else if (allMatches.length > 1) {
        // Concrete ref includes excerpt/segmentKind - mechanically disambiguate
        if (excerpt) {
          const normExcerptForMatch = normalizeSourceText(excerpt);
          const exactPayloadMatches = allMatches.filter((candidate) => {
            const candidatePayload = extractSourcePayload(candidate);
            const candidateProv = extractProvenanceRecord(candidate);
            let candidateSegText = '';
            if (segmentKind === STRUCTURED_SEGMENT_KINDS.NARRATIVE) {
              let rawNarr = candidatePayload.text;
              if (candidateProv?.role === 'assistant') {
                rawNarr = stripMachineTrailer(rawNarr);
              }
              candidateSegText = rawNarr;
            } else if (segmentKind === STRUCTURED_SEGMENT_KINDS.WORLD_STATE) {
              candidateSegText = candidatePayload.segments?.world_state || candidate.worldStateText || '';
            } else if (segmentKind === STRUCTURED_SEGMENT_KINDS.INNER_CHATTER) {
              candidateSegText = candidatePayload.segments?.inner_chatter || candidate.innerChatterText || '';
            }
            return normalizeSourceText(candidateSegText).includes(normExcerptForMatch);
          });
          if (exactPayloadMatches.length === 1) {
            sourceRecord = exactPayloadMatches[0];
          } else if (exactPayloadMatches.length === 0) {
            return {
              valid: false,
              error: `Source reference '${sourceRef}' has ${allMatches.length} candidates but none contain the specified excerpt in ${segmentKind} segment.`,
              errorCode: 'excerpt_mismatch',
            };
          } else {
            // >1 identical owned matches with same excerpt => ambiguous
            return {
              valid: false,
              error: `Ambiguous source reference '${sourceRef}': ${exactPayloadMatches.length} candidates match the excerpt in ${segmentKind} segment. Cannot resolve by array order.`,
              errorCode: 'ambiguous_source_ref',
            };
          }
        } else {
          // No excerpt for disambiguation: >1 is ambiguous
          return {
            valid: false,
            error: `Ambiguous source reference '${sourceRef}': ${allMatches.length} matching records found. Cannot resolve by array order.`,
            errorCode: 'ambiguous_source_ref',
          };
        }
      }
    } else if (exchangeContext?.sources && typeof exchangeContext.sources === 'object') {
      sourceRecord = exchangeContext.sources[sourceRef] || null;
    }

    if (!sourceRecord) {
      return { valid: false, error: `Source reference '${sourceRef}' not found in exchange sources.` };
    }
  }

  // 4. Extract pure provenance metadata record and validate with S1 validateOwnedSourceRecord
  const provenanceRecord = extractProvenanceRecord(sourceRecord);
  if (!provenanceRecord) {
    return { valid: false, error: 'Could not extract provenance record from resolved source.' };
  }

  const provVal = validateOwnedSourceRecord(provenanceRecord);
  if (!provVal.valid) {
    return { valid: false, error: `Invalid owned source record provenance: ${provVal.error}` };
  }

  // 5. Mechanical comparison against request / context expectations (C03)

  // 5a. Chat identity check
  if (exchangeContext?.chatId !== undefined && provenanceRecord.chatId !== undefined) {
    if (provenanceRecord.chatId !== exchangeContext.chatId) {
      return {
        valid: false,
        error: `Wrong chat: source chatId '${provenanceRecord.chatId}' does not match context chatId '${exchangeContext.chatId}'.`,
        errorCode: 'wrong_chat',
      };
    }
  }

  // 5b. Sidecar identity check
  if (exchangeContext?.sidecarId !== undefined && provenanceRecord.sidecarId !== undefined) {
    if (provenanceRecord.sidecarId !== exchangeContext.sidecarId) {
      return {
        valid: false,
        error: `Wrong sidecar: source sidecarId '${provenanceRecord.sidecarId}' does not match context sidecarId '${exchangeContext.sidecarId}'.`,
        errorCode: 'wrong_sidecar',
      };
    }
  }

  // 5c. Role expectation check
  if (sourceRef === 'current:user' && provenanceRecord.role !== 'user') {
    return {
      valid: false,
      error: `Wrong role: source for 'current:user' has role '${provenanceRecord.role}', expected 'user'.`,
      errorCode: 'wrong_role',
    };
  }
  if (sourceRef === 'current:assistant' && provenanceRecord.role !== 'assistant') {
    return {
      valid: false,
      error: `Wrong role: source for 'current:assistant' has role '${provenanceRecord.role}', expected 'assistant'.`,
      errorCode: 'wrong_role',
    };
  }
  if (options.expectedRole && provenanceRecord.role !== options.expectedRole) {
    return {
      valid: false,
      error: `Wrong role: source role '${provenanceRecord.role}' does not match expected role '${options.expectedRole}'.`,
      errorCode: 'wrong_role',
    };
  }

  // 5d. Content fingerprint check
  const expectedFingerprint =
    options.expectedFingerprint ||
    (sourceRef === 'current:user' ? exchangeContext?.expectedUserFingerprint : null) ||
    (sourceRef === 'current:assistant' ? exchangeContext?.expectedAssistantFingerprint : null);

  if (expectedFingerprint && provenanceRecord.contentFingerprint !== expectedFingerprint) {
    return {
      valid: false,
      error: `Wrong fingerprint: source contentFingerprint '${provenanceRecord.contentFingerprint}' does not match expected '${expectedFingerprint}'.`,
      errorCode: 'wrong_fingerprint',
    };
  }

  // 5e. Preceding lineage / stale lineage check (C03)
  // For captured current assistant source, request lineage revalidation must compare against
  // the exact expected preceding lineage for that owned source, not accept arbitrary extra lineage
  // merely because expected lineage is a prefix. Development refs can receive their own explicit expected lineage.
  let expectedLineage = null;

  if (sourceRef === 'current:assistant') {
    expectedLineage =
      options.expectedLineage ||
      exchangeContext?.expectedAssistantLineage ||
      exchangeContext?.requestLineage ||
      exchangeContext?.expectedLineage;
  } else if (sourceRef === 'current:user') {
    expectedLineage =
      options.expectedLineage ||
      exchangeContext?.expectedUserLineage;
  } else {
    // Development compact refs receive their own explicit expected lineage
    expectedLineage =
      options.expectedLineage ||
      options.expectedLineages?.[sourceRef] ||
      exchangeContext?.expectedLineages?.[sourceRef] ||
      exchangeContext?.expectedLineageBySource?.[sourceRef] ||
      null;
  }

  if (expectedLineage && Array.isArray(expectedLineage)) {
    const srcLineage = provenanceRecord.precedingLineage || [];
    // Mechanical exact match: reject extra lineage as well as missing or diverged lineage
    const matches =
      srcLineage.length === expectedLineage.length &&
      expectedLineage.every((val, idx) => srcLineage[idx] === val);

    if (!matches) {
      return {
        valid: false,
        error: `Stale lineage: source precedingLineage does not match expected lineage for '${sourceRef}'.`,
        errorCode: 'stale_lineage',
      };
    }
  }

  // 6. Centralized segment field permission check (C03)
  if (options.targetField) {
    const permVal = validateSegmentFieldPermission(sourceRefObj, options.targetField);
    if (!permVal.valid) {
      return { valid: false, error: `Segment permission violation: ${permVal.error}` };
    }
  }

  // 7. Extract payload text and verify excerpt
  const payload = extractSourcePayload(sourceRecord);
  let segmentText = '';

  if (segmentKind === STRUCTURED_SEGMENT_KINDS.NARRATIVE) {
    let rawNarrative = payload.text;
    if (provenanceRecord.role === 'assistant') {
      // Exclude machine trailer deterministically
      rawNarrative = stripMachineTrailer(rawNarrative);
    }
    segmentText = rawNarrative;
  } else if (segmentKind === STRUCTURED_SEGMENT_KINDS.WORLD_STATE) {
    segmentText =
      payload.segments?.world_state ||
      exchangeContext?.segments?.[sourceRef]?.world_state ||
      sourceRecord.worldStateText ||
      '';
  } else if (segmentKind === STRUCTURED_SEGMENT_KINDS.INNER_CHATTER) {
    segmentText =
      payload.segments?.inner_chatter ||
      exchangeContext?.segments?.[sourceRef]?.inner_chatter ||
      sourceRecord.innerChatterText ||
      '';
  }

  const normSegmentText = normalizeSourceText(segmentText);
  const normExcerpt = normalizeSourceText(excerpt);

  if (!normSegmentText.includes(normExcerpt)) {
    return {
      valid: false,
      error: `Excerpt mismatch: excerpt '${excerpt}' not found in resolved ${segmentKind} source text.`,
      errorCode: 'excerpt_mismatch',
    };
  }

  // 8. Check copy / replay metadata
  const isCopy = Boolean(
    sourceRefObj.copiedFrom || sourceRefObj.sameEventRef || sourceRefObj.derivedFrom
  );

  return {
    valid: true,
    resolvedSource: sourceRecord,
    provenance: provenanceRecord,
    segmentKind,
    isCopy,
  };
}

/**
 * Captures a durable source dependency descriptor from a source reference object and exchange context.
 * Separates expectation metadata from owned source records (Item 4, Item 13).
 *
 * @param {object} sourceRefObj Source reference object ({ sourceRef, excerpt, segmentKind, ... })
 * @param {object} exchangeContext Exchange context containing messages and provenance
 * @param {object} [options]
 * @param {string} [options.writer] Calling writer
 * @param {string} [options.targetField] Field being modified
 * @returns {{ valid: boolean, capturedDependency?: object, error?: string, errorCode?: string }}
 */
export function captureSourceDependency(sourceRefObj, exchangeContext, options = {}) {
  if (!sourceRefObj || typeof sourceRefObj !== 'object') {
    return {
      valid: false,
      error: 'Source reference must be an object to capture dependency.',
      errorCode: 'invalid_source_ref',
    };
  }

  const resolveResult = resolveSourceReference(sourceRefObj, exchangeContext, options);
  if (!resolveResult.valid) {
    return {
      valid: false,
      error: resolveResult.error,
      errorCode: resolveResult.errorCode,
    };
  }

  const { provenance, segmentKind } = resolveResult;

  const capturedDependency = {
    sourceRef: sourceRefObj.sourceRef,
    targetField: options.targetField || null,
    writer: options.writer || null,
    excerpt: sourceRefObj.excerpt,
    segmentKind: segmentKind || STRUCTURED_SEGMENT_KINDS.NARRATIVE,
    capturedProvenance: {
      chatId: provenance.chatId,
      sidecarId: provenance.sidecarId,
      position: provenance.position,
      role: provenance.role,
      contentFingerprint: provenance.contentFingerprint,
      precedingLineage: Array.isArray(provenance.precedingLineage)
        ? [...provenance.precedingLineage]
        : [],
      swipe: provenance.swipe !== undefined ? provenance.swipe : null,
      revision: provenance.revision !== undefined ? provenance.revision : null,
    },
  };

  return {
    valid: true,
    capturedDependency,
  };
}

export const CAPTURED_DEPENDENCY_ALLOWED_KEYS = Object.freeze([
  'sourceRef',
  'targetField',
  'writer',
  'segmentKind',
  'excerpt',
  'capturedProvenance',
]);

/**
 * Validates a captured source dependency descriptor shape.
 * Enforces ONE canonical shape using capturedProvenance only (Task 1).
 * Rejects unknown keys and requires valid capturedProvenance via validateOwnedSourceRecord.
 *
 * @param {object} capturedDependency
 * @returns {{ valid: boolean, error?: string, errorCode?: string }}
 */
export function validateCapturedSourceDependency(capturedDependency) {
  if (!capturedDependency || typeof capturedDependency !== 'object' || Array.isArray(capturedDependency)) {
    return {
      valid: false,
      error: 'Captured source dependency must be an object.',
      errorCode: 'invalid_captured_dependency',
    };
  }

  for (const k of Object.keys(capturedDependency)) {
    if (!CAPTURED_DEPENDENCY_ALLOWED_KEYS.includes(k)) {
      return {
        valid: false,
        error: `Unknown key '${k}' in captured source dependency descriptor. Allowed: ${CAPTURED_DEPENDENCY_ALLOWED_KEYS.join(', ')}.`,
        errorCode: 'invalid_captured_dependency',
      };
    }
  }

  if (typeof capturedDependency.sourceRef !== 'string' || capturedDependency.sourceRef.trim() === '') {
    return {
      valid: false,
      error: "Captured source dependency requires non-empty string 'sourceRef'.",
      errorCode: 'invalid_captured_dependency',
    };
  }

  // Item D: Harden targetField type - must be string or null, no other types accepted
  if (capturedDependency.targetField !== undefined && capturedDependency.targetField !== null) {
    if (typeof capturedDependency.targetField !== 'string') {
      return {
        valid: false,
        error: `Captured source dependency 'targetField' must be a string or null, got ${typeof capturedDependency.targetField}.`,
        errorCode: 'invalid_captured_dependency',
      };
    }
  }

  // Item D: Harden writer type - must be string or null, no other types accepted
  if (capturedDependency.writer !== undefined && capturedDependency.writer !== null) {
    if (typeof capturedDependency.writer !== 'string') {
      return {
        valid: false,
        error: `Captured source dependency 'writer' must be a string or null, got ${typeof capturedDependency.writer}.`,
        errorCode: 'invalid_captured_dependency',
      };
    }
  }

  if (
    !capturedDependency.capturedProvenance ||
    typeof capturedDependency.capturedProvenance !== 'object' ||
    Array.isArray(capturedDependency.capturedProvenance)
  ) {
    return {
      valid: false,
      error: "Captured source dependency requires 'capturedProvenance' object.",
      errorCode: 'invalid_captured_dependency',
    };
  }

  const prov = { ...capturedDependency.capturedProvenance };
  if (prov.swipe === null) delete prov.swipe;
  if (prov.revision === null) delete prov.revision;
  const pVal = validateOwnedSourceRecord(prov);
  if (!pVal.valid) {
    return {
      valid: false,
      error: `Invalid captured provenance in source dependency: ${pVal.error}`,
      errorCode: 'invalid_captured_dependency',
    };
  }

  if (capturedDependency.segmentKind !== undefined) {
    const validKinds = Object.values(STRUCTURED_SEGMENT_KINDS);
    if (!validKinds.includes(capturedDependency.segmentKind)) {
      return {
        valid: false,
        error: `Invalid segmentKind '${capturedDependency.segmentKind}' in captured source dependency. Allowed: ${validKinds.join(', ')}.`,
        errorCode: 'invalid_captured_dependency',
      };
    }
  }

  if (capturedDependency.excerpt !== undefined && typeof capturedDependency.excerpt !== 'string') {
    return {
      valid: false,
      error: "Captured source dependency 'excerpt' must be a string when present.",
      errorCode: 'invalid_captured_dependency',
    };
  }

  return { valid: true };
}

/**
 * Mechanically captures and validates an owned source scope dependency from exchange context.
 * Used for reviewReceipts / targetAcknowledgments sourceScope references (Task 2).
 * Resolves compact ref -> owned source metadata (chat/sidecar/position/role/fingerprint/lineage/swipe/revision).
 * Does not perform semantic inference and does not fabricate an excerpt.
 *
 * @param {string} sourceRef The source reference string to resolve
 * @param {object} exchangeContext Exchange context containing messages and provenance
 * @param {object} [options]
 * @param {string} [options.writer] Calling writer
 * @returns {{ valid: boolean, capturedDependency?: object, error?: string, errorCode?: string }}
 */
export function captureScopeDependency(sourceRef, exchangeContext, options = {}) {
  if (typeof sourceRef !== 'string' || sourceRef.trim() === '') {
    return {
      valid: false,
      error: 'Source scope reference must be a non-empty string.',
      errorCode: 'invalid_source_ref',
    };
  }

  if (!exchangeContext || typeof exchangeContext !== 'object') {
    return {
      valid: false,
      error: `Cannot resolve source scope '${sourceRef}': exchangeContext is required.`,
      errorCode: 'provenance_context_required',
    };
  }

  // Resolve underlying owned source record
  let sourceRecord = null;
  if (sourceRef === 'current:user') {
    sourceRecord = exchangeContext.currentUserMessage || null;
  } else if (sourceRef === 'current:assistant') {
    sourceRecord = exchangeContext.currentAssistantMessage || null;
  } else {
    if (exchangeContext.sources instanceof Map) {
      sourceRecord = exchangeContext.sources.get(sourceRef) || null;
    } else if (Array.isArray(exchangeContext.sources)) {
      // Item A: collect ALL label matches; >1 is ambiguous for scope dependencies
      const allMatches = exchangeContext.sources.filter(
        (s) => s.sourceRef === sourceRef || s.id === sourceRef || s.sourceId === sourceRef
      );
      if (allMatches.length === 1) {
        sourceRecord = allMatches[0];
      } else if (allMatches.length > 1) {
        return {
          valid: false,
          error: `Ambiguous source scope reference '${sourceRef}': ${allMatches.length} matching records found. Cannot resolve by array order.`,
          errorCode: 'ambiguous_source_ref',
        };
      }
    } else if (exchangeContext.sources && typeof exchangeContext.sources === 'object') {
      sourceRecord = exchangeContext.sources[sourceRef] || null;
    }
  }

  if (!sourceRecord) {
    return {
      valid: false,
      error: `Source scope reference '${sourceRef}' not found in exchange sources.`,
      errorCode: 'source_not_found',
    };
  }

  // Extract and validate pure provenance metadata record
  const provenanceRecord = extractProvenanceRecord(sourceRecord);
  if (!provenanceRecord) {
    return {
      valid: false,
      error: `Could not extract provenance record for source scope '${sourceRef}'.`,
      errorCode: 'provenance_missing',
    };
  }

  const provVal = validateOwnedSourceRecord(provenanceRecord);
  if (!provVal.valid) {
    return {
      valid: false,
      error: `Invalid owned source record provenance for scope '${sourceRef}': ${provVal.error}`,
      errorCode: 'invalid_provenance',
    };
  }

  // Mechanical expectations check against exchangeContext (C03)
  if (exchangeContext.chatId !== undefined && provenanceRecord.chatId !== undefined) {
    if (provenanceRecord.chatId !== exchangeContext.chatId) {
      return {
        valid: false,
        error: `Wrong chat for source scope '${sourceRef}': source chatId '${provenanceRecord.chatId}' does not match context chatId '${exchangeContext.chatId}'.`,
        errorCode: 'wrong_chat',
      };
    }
  }

  if (exchangeContext.sidecarId !== undefined && provenanceRecord.sidecarId !== undefined) {
    if (provenanceRecord.sidecarId !== exchangeContext.sidecarId) {
      return {
        valid: false,
        error: `Wrong sidecar for source scope '${sourceRef}': source sidecarId '${provenanceRecord.sidecarId}' does not match context sidecarId '${exchangeContext.sidecarId}'.`,
        errorCode: 'wrong_sidecar',
      };
    }
  }

  if (sourceRef === 'current:user' && provenanceRecord.role !== 'user') {
    return {
      valid: false,
      error: `Wrong role: source for 'current:user' has role '${provenanceRecord.role}', expected 'user'.`,
      errorCode: 'wrong_role',
    };
  }
  if (sourceRef === 'current:assistant' && provenanceRecord.role !== 'assistant') {
    return {
      valid: false,
      error: `Wrong role: source for 'current:assistant' has role '${provenanceRecord.role}', expected 'assistant'.`,
      errorCode: 'wrong_role',
    };
  }
  if (options.expectedRole && provenanceRecord.role !== options.expectedRole) {
    return {
      valid: false,
      error: `Wrong role for source scope '${sourceRef}': source role '${provenanceRecord.role}' does not match expected role '${options.expectedRole}'.`,
      errorCode: 'wrong_role',
    };
  }

  const expectedFingerprint =
    options.expectedFingerprint ||
    (sourceRef === 'current:user' ? exchangeContext.expectedUserFingerprint : null) ||
    (sourceRef === 'current:assistant' ? exchangeContext.expectedAssistantFingerprint : null);

  if (expectedFingerprint && provenanceRecord.contentFingerprint !== expectedFingerprint) {
    return {
      valid: false,
      error: `Wrong fingerprint for source scope '${sourceRef}': contentFingerprint '${provenanceRecord.contentFingerprint}' does not match expected '${expectedFingerprint}'.`,
      errorCode: 'wrong_fingerprint',
    };
  }

  let expectedLineage = null;
  if (sourceRef === 'current:assistant') {
    expectedLineage =
      options.expectedLineage ||
      exchangeContext.expectedAssistantLineage ||
      exchangeContext.requestLineage ||
      exchangeContext.expectedLineage;
  } else if (sourceRef === 'current:user') {
    expectedLineage =
      options.expectedLineage ||
      exchangeContext.expectedUserLineage;
  } else {
    expectedLineage =
      options.expectedLineage ||
      options.expectedLineages?.[sourceRef] ||
      exchangeContext.expectedLineages?.[sourceRef] ||
      exchangeContext.expectedLineageBySource?.[sourceRef] ||
      null;
  }

  if (expectedLineage && Array.isArray(expectedLineage)) {
    const srcLineage = provenanceRecord.precedingLineage || [];
    const matches =
      srcLineage.length === expectedLineage.length &&
      expectedLineage.every((val, idx) => srcLineage[idx] === val);

    if (!matches) {
      return {
        valid: false,
        error: `Stale lineage for source scope '${sourceRef}': precedingLineage does not match expected lineage.`,
        errorCode: 'stale_lineage',
      };
    }
  }

  const capturedDependency = {
    sourceRef,
    targetField: null,
    writer: options.writer || null,
    segmentKind: STRUCTURED_SEGMENT_KINDS.NARRATIVE,
    capturedProvenance: {
      chatId: provenanceRecord.chatId,
      sidecarId: provenanceRecord.sidecarId,
      position: provenanceRecord.position,
      role: provenanceRecord.role,
      contentFingerprint: provenanceRecord.contentFingerprint,
      precedingLineage: Array.isArray(provenanceRecord.precedingLineage)
        ? [...provenanceRecord.precedingLineage]
        : [],
      swipe: provenanceRecord.swipe !== undefined ? provenanceRecord.swipe : null,
      revision: provenanceRecord.revision !== undefined ? provenanceRecord.revision : null,
    },
  };

  return {
    valid: true,
    capturedDependency,
  };
}

/**
 * Revalidates a captured source dependency descriptor against an exchange context.
 * Mechanically compares exact ownership identity:
 * - chatId / sidecarId
 * - position
 * - role
 * - contentFingerprint
 * - precedingLineage (exact array match)
 * - swipe
 * - revision
 * - segment permissions for targetField
 * - excerpt verification against latest text (if excerpt is present)
 *
 * Fails closed if descriptor is invalid or a raw string (C03, C10, Item 4).
 *
 * @param {object} capturedDependency Captured source dependency descriptor
 * @param {object} exchangeContext Current exchange context
 * @returns {{ valid: boolean, conflict?: boolean, conflictType?: string, error?: string, errorCode?: string }}
 */
export function revalidateSourceDependency(capturedDependency, exchangeContext) {
  const depVal = validateCapturedSourceDependency(capturedDependency);
  if (!depVal.valid) {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: depVal.error,
      errorCode: depVal.errorCode || 'invalid_captured_dependency',
    };
  }

  const expected = capturedDependency.capturedProvenance;

  const sourceRef = capturedDependency.sourceRef;
  if (!sourceRef || typeof sourceRef !== 'string' || sourceRef.trim() === '') {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: 'Invalid captured source dependency: sourceRef must be a non-empty string.',
      errorCode: 'invalid_captured_dependency',
    };
  }

  // Resolve source in current exchangeContext
  let currentSourceRecord = null;
  if (sourceRef === 'current:user') {
    currentSourceRecord = exchangeContext?.currentUserMessage || null;
  } else if (sourceRef === 'current:assistant') {
    currentSourceRecord = exchangeContext?.currentAssistantMessage || null;
  } else {
    if (exchangeContext?.sources instanceof Map) {
      currentSourceRecord = exchangeContext.sources.get(sourceRef) || null;
    } else if (Array.isArray(exchangeContext?.sources)) {
      // Item A: collect ALL label matches; use capturedProvenance to select unique candidate
      const allMatches = exchangeContext.sources.filter(
        (s) => s.sourceRef === sourceRef || s.id === sourceRef || s.sourceId === sourceRef
      );
      if (allMatches.length === 1) {
        currentSourceRecord = allMatches[0];
      } else if (allMatches.length > 1) {
        // Use captured provenance to find the exact match
        const provenanceMatches = allMatches.filter((candidate) => {
          const cp = extractProvenanceRecord(candidate);
          if (!cp) return false;
          if (expected.chatId !== undefined && cp.chatId !== expected.chatId) return false;
          if (expected.sidecarId !== undefined && cp.sidecarId !== expected.sidecarId) return false;
          if (expected.position !== undefined && cp.position !== expected.position) return false;
          if (expected.role !== undefined && cp.role !== expected.role) return false;
          if (expected.contentFingerprint !== undefined && cp.contentFingerprint !== expected.contentFingerprint) return false;
          if (expected.swipe !== undefined && expected.swipe !== null && cp.swipe !== expected.swipe) return false;
          if (expected.revision !== undefined && expected.revision !== null && cp.revision !== expected.revision) return false;
          if (expected.precedingLineage !== undefined) {
            const cpLineage = cp.precedingLineage || [];
            const expLineage = expected.precedingLineage || [];
            if (cpLineage.length !== expLineage.length) return false;
            for (let i = 0; i < expLineage.length; i++) {
              if (cpLineage[i] !== expLineage[i]) return false;
            }
          }
          return true;
        });
        if (provenanceMatches.length === 1) {
          currentSourceRecord = provenanceMatches[0];
        } else if (provenanceMatches.length === 0) {
          return {
            valid: false,
            conflict: true,
            conflictType: 'source_lineage_conflict',
            error: `Source reference '${sourceRef}' has ${allMatches.length} candidates but none match captured provenance during revalidation.`,
            errorCode: 'source_not_found',
          };
        } else {
          // >1 identical owned matches => ambiguous
          return {
            valid: false,
            conflict: true,
            conflictType: 'source_lineage_conflict',
            error: `Ambiguous source reference '${sourceRef}': ${provenanceMatches.length} candidates match captured provenance. Cannot resolve by array order.`,
            errorCode: 'ambiguous_source_ref',
          };
        }
      }
    } else if (exchangeContext?.sources && typeof exchangeContext.sources === 'object') {
      currentSourceRecord = exchangeContext.sources[sourceRef] || null;
    }
  }

  if (!currentSourceRecord) {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: `Source reference '${sourceRef}' not found in exchange context during revalidation.`,
      errorCode: 'source_not_found',
    };
  }

  const currentProv = extractProvenanceRecord(currentSourceRecord);
  if (!currentProv) {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: `Could not extract provenance for '${sourceRef}' during revalidation.`,
      errorCode: 'provenance_missing',
    };
  }

  const provVal = validateOwnedSourceRecord(currentProv);
  if (!provVal.valid) {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: `Current source provenance validation failed: ${provVal.error}`,
      errorCode: 'invalid_provenance',
    };
  }

  // Exact mechanical comparison of ownership identity
  if (expected.chatId !== undefined && currentProv.chatId !== expected.chatId) {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: `Source chatId changed: expected '${expected.chatId}', got '${currentProv.chatId}'.`,
      errorCode: 'wrong_chat',
    };
  }

  if (expected.sidecarId !== undefined && currentProv.sidecarId !== expected.sidecarId) {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: `Source sidecarId changed: expected '${expected.sidecarId}', got '${currentProv.sidecarId}'.`,
      errorCode: 'wrong_sidecar',
    };
  }

  if (expected.position !== undefined && currentProv.position !== expected.position) {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: `Source position changed: expected ${expected.position}, got ${currentProv.position}.`,
      errorCode: 'wrong_position',
    };
  }

  if (expected.role !== undefined && currentProv.role !== expected.role) {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: `Source role changed: expected '${expected.role}', got '${currentProv.role}'.`,
      errorCode: 'wrong_role',
    };
  }

  if (expected.contentFingerprint !== undefined && currentProv.contentFingerprint !== expected.contentFingerprint) {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: `Source contentFingerprint changed: expected '${expected.contentFingerprint}', got '${currentProv.contentFingerprint}'.`,
      errorCode: 'wrong_fingerprint',
    };
  }

  if (expected.precedingLineage !== undefined) {
    const currLineage = currentProv.precedingLineage || [];
    const expLineage = expected.precedingLineage || [];
    const matches =
      currLineage.length === expLineage.length &&
      expLineage.every((val, idx) => currLineage[idx] === val);
    if (!matches) {
      return {
        valid: false,
        conflict: true,
        conflictType: 'source_lineage_conflict',
        error: `Source precedingLineage changed: expected [${expLineage.join(',')}], got [${currLineage.join(',')}].`,
        errorCode: 'stale_lineage',
      };
    }
  }

  if (expected.swipe !== undefined && expected.swipe !== null && currentProv.swipe !== expected.swipe) {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: `Source swipe changed: expected '${expected.swipe}', got '${currentProv.swipe}'.`,
      errorCode: 'wrong_swipe',
    };
  }

  if (expected.revision !== undefined && expected.revision !== null && currentProv.revision !== expected.revision) {
    return {
      valid: false,
      conflict: true,
      conflictType: 'source_lineage_conflict',
      error: `Source revision changed: expected '${expected.revision}', got '${currentProv.revision}'.`,
      errorCode: 'wrong_revision',
    };
  }

  // Segment permissions if targetField is specified
  if (capturedDependency.targetField) {
    const permVal = validateSegmentFieldPermission(
      { sourceRef, segmentKind: capturedDependency.segmentKind || STRUCTURED_SEGMENT_KINDS.NARRATIVE },
      capturedDependency.targetField
    );
    if (!permVal.valid) {
      return {
        valid: false,
        conflict: true,
        conflictType: 'source_lineage_conflict',
        error: `Segment permission violation: ${permVal.error}`,
        errorCode: 'segment_permission_violation',
      };
    }
  }

  // Excerpt verification if excerpt is present
  if (capturedDependency.excerpt) {
    const payload = extractSourcePayload(currentSourceRecord);
    const segKind = capturedDependency.segmentKind || STRUCTURED_SEGMENT_KINDS.NARRATIVE;
    let segText = '';
    if (segKind === STRUCTURED_SEGMENT_KINDS.NARRATIVE) {
      segText = currentProv.role === 'assistant' ? stripMachineTrailer(payload.text) : payload.text;
    } else if (segKind === STRUCTURED_SEGMENT_KINDS.WORLD_STATE) {
      segText = payload.segments?.world_state || currentSourceRecord.worldStateText || '';
    } else if (segKind === STRUCTURED_SEGMENT_KINDS.INNER_CHATTER) {
      segText = payload.segments?.inner_chatter || currentSourceRecord.innerChatterText || '';
    }

    const normText = normalizeSourceText(segText);
    const normExcerpt = normalizeSourceText(capturedDependency.excerpt);
    if (!normText.includes(normExcerpt)) {
      return {
        valid: false,
        conflict: true,
        conflictType: 'source_lineage_conflict',
        error: `Excerpt mismatch during revalidation: '${capturedDependency.excerpt}' not found in source text.`,
        errorCode: 'excerpt_mismatch',
      };
    }
  }

  return { valid: true };
}
