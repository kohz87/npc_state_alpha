/**
 * NPC State Alpha — One-Pass Trailer Extractor & Parser
 *
 * Single behavior authority: docs/core-contract.md (C03, C04)
 *
 * Strict trailer rules:
 * - Exactly one <npc_state_alpha_v1>...</npc_state_alpha_v1> at the very end of narrative.
 * - Absent, duplicate, truncated or malformed envelopes are explicit extraction failures.
 * - Never extract arbitrary inner brace fragments or repair by guessing.
 * - Authoritative narrative strictly excludes the machine trailer.
 * - Machine trailer cannot cite itself in source excerpts.
 */

import { TRAILER_TAG_OPEN, TRAILER_TAG_CLOSE } from './wire-schemas.js';

export const EXTRACTION_ERROR_CODES = Object.freeze({
  MISSING_TRAILER: 'missing_trailer',
  DUPLICATE_TRAILER: 'duplicate_trailer',
  TRUNCATED_TRAILER: 'truncated_trailer',
  TRAILER_NOT_AT_END: 'trailer_not_at_end',
  MALFORMED_JSON: 'malformed_json',
  TRAILER_SELF_CITATION: 'trailer_self_citation',
});

/**
 * Result of extracting and parsing a one-pass response.
 * @typedef {object} ParseOnePassResult
 * @property {boolean} success - Whether extraction and JSON parsing succeeded
 * @property {string} narrative - Authoritative narrative with machine trailer excluded
 * @property {object|null} payload - Parsed JSON object from inside the trailer
 * @property {string|null} rawTrailer - Raw trailer text including tags
 * @property {string|null} errorCode - Extraction error code if failed
 * @property {string|null} errorMessage - Human-readable diagnostic if failed
 */

/**
 * Parses raw roleplay output, cleanly separating the story narrative from the machine trailer.
 * @param {string} rawText
 * @returns {ParseOnePassResult}
 */
export function extractAndParseOnePassTrailer(rawText) {
  if (typeof rawText !== 'string') {
    return {
      success: false,
      narrative: '',
      payload: null,
      rawTrailer: null,
      errorCode: EXTRACTION_ERROR_CODES.MISSING_TRAILER,
      errorMessage: 'Raw text must be a string.',
    };
  }

  const openCount = (rawText.match(new RegExp(escapeRegex(TRAILER_TAG_OPEN), 'g')) || []).length;
  const closeCount = (rawText.match(new RegExp(escapeRegex(TRAILER_TAG_CLOSE), 'g')) || []).length;

  if (openCount === 0) {
    return {
      success: false,
      narrative: rawText,
      payload: null,
      rawTrailer: null,
      errorCode: EXTRACTION_ERROR_CODES.MISSING_TRAILER,
      errorMessage: `Missing machine trailer '${TRAILER_TAG_OPEN}'.`,
    };
  }

  if (closeCount === 0) {
    return {
      success: false,
      narrative: rawText,
      payload: null,
      rawTrailer: null,
      errorCode: EXTRACTION_ERROR_CODES.TRUNCATED_TRAILER,
      errorMessage: `Truncated trailer: found '${TRAILER_TAG_OPEN}' without matching '${TRAILER_TAG_CLOSE}'.`,
    };
  }

  // If there are multiple close tags, or an open tag appears after a close tag, that's multiple trailers
  const firstOpen = rawText.indexOf(TRAILER_TAG_OPEN);
  const firstClose = rawText.indexOf(TRAILER_TAG_CLOSE);

  if (firstClose < firstOpen) {
    return {
      success: false,
      narrative: rawText,
      payload: null,
      rawTrailer: null,
      errorCode: EXTRACTION_ERROR_CODES.TRUNCATED_TRAILER,
      errorMessage: `Malformed trailer ordering: '${TRAILER_TAG_CLOSE}' occurs before '${TRAILER_TAG_OPEN}'.`,
    };
  }

  if (closeCount > 1 || rawText.slice(firstClose + TRAILER_TAG_CLOSE.length).includes(TRAILER_TAG_OPEN)) {
    return {
      success: false,
      narrative: rawText,
      payload: null,
      rawTrailer: null,
      errorCode: EXTRACTION_ERROR_CODES.DUPLICATE_TRAILER,
      errorMessage: `Found multiple/duplicate trailer tags (${openCount} open, ${closeCount} close). Exactly one trailer required.`,
    };
  }

  // Trailer must be at the very end of narrative (allowing only trailing whitespace)
  const afterClose = rawText.slice(firstClose + TRAILER_TAG_CLOSE.length);
  if (afterClose.trim().length > 0) {
    return {
      success: false,
      narrative: rawText,
      payload: null,
      rawTrailer: null,
      errorCode: EXTRACTION_ERROR_CODES.TRAILER_NOT_AT_END,
      errorMessage: `Trailer is not at the end of the text. Found trailing narrative after '${TRAILER_TAG_CLOSE}'.`,
    };
  }

  const narrative = rawText.slice(0, firstOpen).trimEnd();
  const rawTrailer = rawText.slice(firstOpen, firstClose + TRAILER_TAG_CLOSE.length);
  const jsonString = rawText.slice(firstOpen + TRAILER_TAG_OPEN.length, firstClose).trim();

  let payload;
  try {
    payload = JSON.parse(jsonString);
  } catch (err) {
    if (openCount > 1) {
      return {
        success: false,
        narrative: rawText,
        payload: null,
        rawTrailer: null,
        errorCode: EXTRACTION_ERROR_CODES.DUPLICATE_TRAILER,
        errorMessage: 'Found multiple trailer tags with invalid structure.',
      };
    }
    return {
      success: false,
      narrative,
      payload: null,
      rawTrailer,
      errorCode: EXTRACTION_ERROR_CODES.MALFORMED_JSON,
      errorMessage: `Trailer content is not valid JSON: ${err.message}`,
    };
  }

  // Check for trailer self-citation in source excerpts
  if (containsTrailerSelfCitation(payload)) {
    return {
      success: false,
      narrative,
      payload,
      rawTrailer,
      errorCode: EXTRACTION_ERROR_CODES.TRAILER_SELF_CITATION,
      errorMessage: 'Machine trailer cannot cite itself in source excerpts (C03 transport exclusion violation).',
    };
  }

  if (openCount > 1) {
    return {
      success: false,
      narrative: rawText,
      payload: null,
      rawTrailer: null,
      errorCode: EXTRACTION_ERROR_CODES.DUPLICATE_TRAILER,
      errorMessage: `Found multiple/duplicate trailer tags (${openCount} open). Exactly one trailer required.`,
    };
  }

  return {
    success: true,
    narrative,
    payload,
    rawTrailer,
    errorCode: null,
    errorMessage: null,
  };
}

/**
 * Checks recursively if any excerpt string contains machine trailer markers.
 * @param {any} obj
 * @returns {boolean}
 */
function containsTrailerSelfCitation(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      if (value.includes(TRAILER_TAG_OPEN) || value.includes(TRAILER_TAG_CLOSE)) {
        return true;
      }
    } else if (typeof value === 'object') {
      if (containsTrailerSelfCitation(value)) return true;
    }
  }
  return false;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const DEVELOPMENT_PARSE_ERROR_CODES = Object.freeze({
  EMPTY_INPUT: 'empty_input',
  FENCED_JSON: 'fenced_json',
  COMMENTARY_DETECTED: 'commentary_detected',
  TRAILING_GARBAGE: 'trailing_garbage',
  MULTIPLE_OBJECTS: 'multiple_objects',
  MALFORMED_JSON: 'malformed_json',
  INVALID_ROOT_TYPE: 'invalid_root_type',
});

/**
 * Strict production development-response parser (C08).
 * Input raw text emitted by model. Accepts exactly one valid JSON object development envelope.
 *
 * Rules:
 * - No guessed repair or recovery
 * - No multiple objects
 * - No leading/trailing commentary
 * - No fenced JSON (canonical wire does not use markdown fences)
 * - No trailing garbage
 * - No JSON extraction from surrounding text
 * - Rejects empty, arrays, primitives
 *
 * @param {string} rawText
 * @returns {{ success: boolean, payload: object|null, rawText: string, errorCode: string|null, errorMessage: string|null }}
 */
export function parseDevelopmentResponse(rawText) {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return {
      success: false,
      payload: null,
      rawText: typeof rawText === 'string' ? rawText : '',
      errorCode: DEVELOPMENT_PARSE_ERROR_CODES.EMPTY_INPUT,
      errorMessage: 'Development response must be a non-empty string.',
    };
  }

  const trimmed = rawText.trim();

  // Reject response-level markdown code fences
  if (trimmed.startsWith('```')) {
    return {
      success: false,
      payload: null,
      rawText,
      errorCode: DEVELOPMENT_PARSE_ERROR_CODES.FENCED_JSON,
      errorMessage: 'Canonical development wire does not use markdown code fences.',
    };
  }

  // Check root shape: must be a JSON object
  if (trimmed.startsWith('[')) {
    return {
      success: false,
      payload: null,
      rawText,
      errorCode: DEVELOPMENT_PARSE_ERROR_CODES.INVALID_ROOT_TYPE,
      errorMessage: 'Development response root must be a JSON object, not an array.',
    };
  }

  if (!trimmed.startsWith('{')) {
    // Check if it's a primitive JSON value
    try {
      const parsedPrimitive = JSON.parse(trimmed);
      if (typeof parsedPrimitive !== 'object' || parsedPrimitive === null) {
        return {
          success: false,
          payload: null,
          rawText,
          errorCode: DEVELOPMENT_PARSE_ERROR_CODES.INVALID_ROOT_TYPE,
          errorMessage: `Development response root must be a JSON object, got primitive '${typeof parsedPrimitive}'.`,
        };
      }
    } catch {
      // Not a valid primitive; it's commentary or surrounding text before '{'
    }

    return {
      success: false,
      payload: null,
      rawText,
      errorCode: DEVELOPMENT_PARSE_ERROR_CODES.COMMENTARY_DETECTED,
      errorMessage: 'Leading commentary or surrounding text detected before JSON object.',
    };
  }

  // Find where the first top-level JSON object closes
  const firstEnd = findFirstTopLevelObjectEnd(trimmed);
  if (firstEnd === -1) {
    return {
      success: false,
      payload: null,
      rawText,
      errorCode: DEVELOPMENT_PARSE_ERROR_CODES.MALFORMED_JSON,
      errorMessage: 'Malformed JSON: unclosed JSON object.',
    };
  }

  if (firstEnd < trimmed.length - 1) {
    const remainder = trimmed.slice(firstEnd + 1).trim();
    if (remainder.startsWith('{')) {
      return {
        success: false,
        payload: null,
        rawText,
        errorCode: DEVELOPMENT_PARSE_ERROR_CODES.MULTIPLE_OBJECTS,
        errorMessage: 'Multiple JSON objects detected in development response; exactly one JSON object expected.',
      };
    }
    if (remainder.startsWith('```')) {
      return {
        success: false,
        payload: null,
        rawText,
        errorCode: DEVELOPMENT_PARSE_ERROR_CODES.FENCED_JSON,
        errorMessage: 'Canonical development wire does not use markdown code fences.',
      };
    }
    return {
      success: false,
      payload: null,
      rawText,
      errorCode: DEVELOPMENT_PARSE_ERROR_CODES.TRAILING_GARBAGE,
      errorMessage: 'Trailing garbage or commentary detected after JSON object.',
    };
  }

  // Parse strictly
  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch (err) {
    return {
      success: false,
      payload: null,
      rawText,
      errorCode: DEVELOPMENT_PARSE_ERROR_CODES.MALFORMED_JSON,
      errorMessage: `Malformed JSON: ${err.message}`,
    };
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      success: false,
      payload: null,
      rawText,
      errorCode: DEVELOPMENT_PARSE_ERROR_CODES.INVALID_ROOT_TYPE,
      errorMessage: `Development response root must be a JSON object, got ${Array.isArray(payload) ? 'array' : typeof payload}.`,
    };
  }

  return {
    success: true,
    payload,
    rawText,
    errorCode: null,
    errorMessage: null,
  };
}

/**
 * Finds the index of the closing bracket matching the opening bracket at index 0.
 * Respects string quotes and backslash escape sequences.
 * @param {string} str
 * @returns {number}
 */
function findFirstTopLevelObjectEnd(str) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\' && inString) {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }
  }
  return -1;
}
