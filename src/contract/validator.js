/**
 * NPC State Alpha — Production Contract Validator
 *
 * Single behavior authority: docs/core-contract.md
 *
 * Enforces:
 * - C02 Canonical ownership & strict writer authority (rejection of wrong writers in both directions)
 * - C03 Source identity, reserved references, transport exclusion, structured-source permissions
 * - C04 One-pass envelope structure, NEW localRef semantics (no array-order identity fallback),
 *       explicit zero-relationship evaluation, terminal lifecycle (no livingReturn)
 * - C05 Omission-preserves semantics (missing fields are valid no-ops)
 * - C08 Development review record shapes (observations, dispositions, accepted-support, scoped receipts)
 */

import {
  WRITERS,
  CANONICAL_FIELDS,
  validateWriterAuthority,
  isDurableDossierField,
} from './registry.js';
import {
  ALPHA_ONE_PASS_WIRE_VERSION,
  ALPHA_DEVELOPMENT_WIRE_VERSION,
  ONE_PASS_RESERVED_SOURCES,
  STRUCTURED_SEGMENT_KINDS,
  SEGMENT_PERMISSIONS,
  IDENTITY_KINDS,
  RELATIONSHIP_AXES,
  LIFECYCLE_STATES,
  EVIDENCE_DISPOSITIONS,
  RECEIPT_STATUSES,
  TRAILER_TAG_OPEN,
  TRAILER_TAG_CLOSE,
  ONE_PASS_TOP_LEVEL_KEYS,
  ONE_PASS_PROPOSAL_KEYS,
  DEVELOPMENT_TOP_LEVEL_KEYS,
  DEVELOPMENT_PROPOSAL_KEYS,
  SCALAR_OPERATIONS,
  COLLECTION_OPERATIONS,
  PERSONALITY_ALLOWED_KEYS,
  BEHAVIORAL_PROFILE_ALLOWED_KEYS,
  SPEECH_ALLOWED_KEYS,
  MANNERISMS_ALLOWED_KEYS,
  MANNERISM_ITEM_KEYS,
  CANONICAL_APPEARANCE_ALLOWED_KEYS,
  RELATIONSHIP_DYNAMIC_ALLOWED_KEYS,
  APPEARANCE_FORMS_CONTAINER_KEYS,
  APPEARANCE_FORM_ITEM_KEYS,
  IMPORTANT_MEMORIES_CONTAINER_KEYS,
  IMPORTANT_MEMORY_ITEM_KEYS,
  NON_PLAYER_RELATIONSHIPS_CONTAINER_KEYS,
  NON_PLAYER_RELATIONSHIP_ITEM_KEYS,
  DURABLE_FACT_KEYS,
  PERSISTED_OBSERVATION_KEYS,
  PERSISTED_ACCEPTED_SUPPORT_KEYS,
  DISPOSITION_ALLOWED_KEYS,
  PERSISTED_DISPOSITION_ALLOWED_KEYS,
  SOURCE_REFERENCE_ALLOWED_KEYS,
  RELATIONSHIP_EVALUATION_ALLOWED_KEYS,
  AXIS_SUPPORT_ENTRY_KEYS,
  LIFECYCLE_ALLOWED_KEYS,
  RECEIPT_ALLOWED_KEYS,
  OBSERVATION_ALLOWED_KEYS,
  SUPPORT_PROPOSAL_ALLOWED_KEYS,
  OWNED_SOURCE_RECORD_ALLOWED_KEYS,
  isSegmentKindPermittedForField,
  validateSegmentFieldPermission,
  validatePersistedObservationRecord,
  validatePersistedAcceptedSupportRecord,
  validateOwnedSourceRecord,
} from './wire-schemas.js';

export {
  isSegmentKindPermittedForField,
  validateSegmentFieldPermission,
  validatePersistedObservationRecord,
  validatePersistedAcceptedSupportRecord,
  validateOwnedSourceRecord,
  OWNED_SOURCE_RECORD_ALLOWED_KEYS,
};

export const VALIDATION_ERROR_CODES = Object.freeze({
  INVALID_ENVELOPE: 'invalid_envelope',
  VERSION_MISMATCH: 'version_mismatch',
  WRONG_WRITER: 'wrong_writer',
  UNAUTHORIZED_FIELD: 'unauthorized_field',
  UNKNOWN_KEY: 'unknown_key',
  INVALID_IDENTITY: 'invalid_identity',
  DUPLICATE_LOCAL_REF: 'duplicate_local_ref',
  MISSING_RELATIONSHIP_EVALUATION: 'missing_relationship_evaluation',
  INVALID_RELATIONSHIP_EVALUATION: 'invalid_relationship_evaluation',
  FORBIDDEN_LIFECYCLE_MUTATION: 'forbidden_lifecycle_mutation',
  CONTRADICTORY_LIFECYCLE: 'contradictory_lifecycle',
  INVALID_SOURCE_REFERENCE: 'invalid_source_reference',
  TRAILER_SELF_CITATION: 'trailer_self_citation',
  UNSUPPORTED_STRUCTURED_SEGMENT: 'unsupported_structured_segment',
  STRUCTURED_AUTHORITY_VIOLATION: 'structured_authority_violation',
  INVALID_OBSERVATION: 'invalid_observation',
  INVALID_RECEIPT: 'invalid_receipt',
  INVALID_ACCEPTED_SUPPORT: 'invalid_accepted_support',
  INVALID_OPERATION: 'invalid_operation',
});

/**
 * Validates a single SourceReference object.
 * @param {object} source
 * @param {object} options
 * @returns {{ valid: boolean, errorCode?: string, errorMessage?: string }}
 */
export function validateSourceReference(source, options = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {
      valid: false,
      errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
      errorMessage: 'Source reference must be an object.',
    };
  }

  // Reject unknown keys in source reference (MEDIUM 4)
  for (const key of Object.keys(source)) {
    if (!SOURCE_REFERENCE_ALLOWED_KEYS.includes(key)) {
      return {
        valid: false,
        errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
        errorMessage: `Unknown key '${key}' in source reference. Allowed: ${SOURCE_REFERENCE_ALLOWED_KEYS.join(', ')}.`,
      };
    }
  }

  const { sourceRef, excerpt, segmentKind = STRUCTURED_SEGMENT_KINDS.NARRATIVE } = source;

  if (typeof sourceRef !== 'string' || sourceRef.trim().length === 0) {
    return {
      valid: false,
      errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
      errorMessage: 'Source reference must contain a non-empty sourceRef string.',
    };
  }

  if (typeof excerpt !== 'string' || excerpt.trim().length === 0) {
    return {
      valid: false,
      errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
      errorMessage: 'Source reference must contain a non-empty excerpt string.',
    };
  }

  // C03: Machine trailer transport exclusion — trailer cannot cite itself
  if (excerpt.includes(TRAILER_TAG_OPEN) || excerpt.includes(TRAILER_TAG_CLOSE)) {
    return {
      valid: false,
      errorCode: VALIDATION_ERROR_CODES.TRAILER_SELF_CITATION,
      errorMessage: 'Source excerpt cannot cite the machine trailer (C03 transport exclusion violation).',
    };
  }

  // Segment kind validation
  if (!Object.values(STRUCTURED_SEGMENT_KINDS).includes(segmentKind)) {
    return {
      valid: false,
      errorCode: VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT,
      errorMessage: `Unsupported structured segment kind '${segmentKind}'. Known kinds: ${Object.values(STRUCTURED_SEGMENT_KINDS).join(', ')}.`,
    };
  }

  // One-pass reserved source enforcement (C03)
  if (options.writer === WRITERS.ONE_PASS) {
    if (!ONE_PASS_RESERVED_SOURCES.includes(sourceRef)) {
      return {
        valid: false,
        errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
        errorMessage: `One-pass sourceRef '${sourceRef}' must strictly use reserved one-pass references: ${ONE_PASS_RESERVED_SOURCES.join(', ')}.`,
      };
    }
  }

  // LOW 8: Validate sameEventRef, copiedFrom, derivedFrom independently whenever supplied
  for (const linkProp of ['sameEventRef', 'copiedFrom', 'derivedFrom']) {
    if (source[linkProp] !== undefined) {
      if (typeof source[linkProp] !== 'string' || source[linkProp].trim() === '') {
        return {
          valid: false,
          errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
          errorMessage: `Linkage reference '${linkProp}', if provided, must be a non-empty string.`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Validates a One-Pass immediate wire envelope.
 * @param {object} envelope
 * @returns {{ valid: boolean, errors: Array<{ errorCode: string, errorMessage: string }> }}
 */
export function validateOnePassEnvelope(envelope) {
  const errors = [];

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return {
      valid: false,
      errors: [
        {
          errorCode: VALIDATION_ERROR_CODES.INVALID_ENVELOPE,
          errorMessage: 'One-pass envelope must be a JSON object.',
        },
      ],
    };
  }

  if (envelope.version !== ALPHA_ONE_PASS_WIRE_VERSION) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.VERSION_MISMATCH,
      errorMessage: `One-pass wire version mismatch: expected '${ALPHA_ONE_PASS_WIRE_VERSION}', got '${envelope.version}'.`,
    });
  }

  if (!Array.isArray(envelope.proposals)) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.INVALID_ENVELOPE,
      errorMessage: "One-pass envelope must contain a 'proposals' array.",
    });
    return { valid: false, errors };
  }

  // Reject unknown top-level keys
  for (const key of Object.keys(envelope)) {
    if (!ONE_PASS_TOP_LEVEL_KEYS.includes(key)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
        errorMessage: `Unknown or unauthorized top-level key '${key}' found in one-pass envelope.`,
      });
    }
  }

  // Check top-level wrong-writer fields on envelope
  const forbiddenTopLevel = ['observations', 'acceptedSupport', 'supportProposals', 'reviewReceipts', 'targetAcknowledgments', 'relationshipDynamic', 'canonicalAppearance'];
  for (const field of forbiddenTopLevel) {
    if (envelope[field] !== undefined) {
      const isRuntime = field === 'acceptedSupport' || field === 'reviewReceipts';
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.WRONG_WRITER,
        errorMessage: isRuntime
          ? `Wrong-writer rejection: Runtime-owned field '${field}' found in one-pass envelope (C02, C08).`
          : `Wrong-writer rejection: Development-owned top-level field '${field}' found in one-pass envelope.`,
      });
    }
  }

  const seenLocalRefs = new Set();

  for (let i = 0; i < envelope.proposals.length; i++) {
    const p = envelope.proposals[i];
    const prefix = `Proposal[${i}]`;

    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_ENVELOPE,
        errorMessage: `${prefix} must be an object.`,
      });
      continue;
    }

    // Reject unknown proposal keys
    for (const key of Object.keys(p)) {
      if (!ONE_PASS_PROPOSAL_KEYS.includes(key)) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
          errorMessage: `${prefix}: Unknown or unauthorized proposal key '${key}'.`,
        });
      }
    }

    // Direct lifeState bypass rejected (Requirement 5)
    if (p.lifeState !== undefined) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION,
        errorMessage: `${prefix}: Direct 'lifeState' is forbidden on one-pass proposal wire. Lifecycle proposals must use the 'lifecycle' object.`,
      });
    }

    // Check wrong-writer fields inside proposal
    for (const [key] of Object.entries(p)) {
      const auth = validateWriterAuthority(key, WRITERS.ONE_PASS);
      if (!auth.valid) {
        // Special case: check if it's an envelope-level identity/evidence field
        if (!['localRef', 'identityKind', 'evidence', 'relationshipEvaluation', 'lifecycle', 'source', 'presenceSource'].includes(key)) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.WRONG_WRITER,
            errorMessage: `${prefix}: ${auth.error}`,
          });
        }
      }
    }

    // Identity and localRef validation (Requirement 5, Point 3, Point 4)
    if (p.id !== undefined && p.id !== null && (typeof p.id !== 'string' || p.id.trim() === '')) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_IDENTITY,
        errorMessage: `${prefix}: Existing NPC must provide valid stable string 'id'.`,
      });
    }

    const isNew = p.id === undefined || p.id === null;
    if (isNew) {
      if (p.localRef === undefined || typeof p.localRef !== 'string' || p.localRef.trim() === '') {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_IDENTITY,
          errorMessage: `${prefix}: NEW NPC candidate requires explicit 'localRef' (no array-order identity fallback).`,
        });
      } else {
        if (seenLocalRefs.has(p.localRef)) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.DUPLICATE_LOCAL_REF,
            errorMessage: `${prefix}: Duplicate localRef '${p.localRef}' within same envelope. Local refs must be unique.`,
          });
        }
        seenLocalRefs.add(p.localRef);
      }

      if (p.name === undefined || typeof p.name !== 'string' || p.name.trim() === '') {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_IDENTITY,
          errorMessage: `${prefix}: NEW NPC candidate requires a non-empty 'name'.`,
        });
      }

      if (p.identityKind === undefined || !IDENTITY_KINDS.includes(p.identityKind)) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_IDENTITY,
          errorMessage: `${prefix}: NEW NPC candidate requires identityKind in [${IDENTITY_KINDS.join(', ')}].`,
        });
      }

      if (p.evidence === undefined) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_IDENTITY,
          errorMessage: `${prefix}: NEW NPC admission requires supporting source evidence.`,
        });
      } else {
        const srcVal = validateSourceReference(p.evidence, { writer: WRITERS.ONE_PASS });
        if (!srcVal.valid) {
          errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.evidence: ${srcVal.errorMessage}` });
        } else {
          const permVal = validateSegmentFieldPermission(p.evidence, 'evidence');
          if (!permVal.valid) {
            errors.push({
              errorCode: permVal.unsupportedSegment
                ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
              errorMessage: `${prefix}.evidence: ${permVal.error}`,
            });
          }
        }
      }
    } else {
      // Existing NPC: must have valid stable id, and CANNOT have NEW-only localRef/identityKind/evidence
      if (typeof p.id !== 'string' || p.id.trim() === '') {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_IDENTITY,
          errorMessage: `${prefix}: Existing NPC must provide valid stable string 'id'.`,
        });
      }
      if (p.localRef !== undefined) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_IDENTITY,
          errorMessage: `${prefix}: Existing NPC with stable id '${p.id}' cannot specify NEW-only 'localRef'.`,
        });
      }
      if (p.identityKind !== undefined) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_IDENTITY,
          errorMessage: `${prefix}: Existing NPC with stable id '${p.id}' cannot specify NEW-only 'identityKind'.`,
        });
      }
      if (p.evidence !== undefined) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_IDENTITY,
          errorMessage: `${prefix}: Existing NPC with stable id '${p.id}' cannot specify NEW-only admission 'evidence'.`,
        });
      }

      // Point (3): Existing-NPC identity mutations such as name/aliases must be typed and grounded
      if (p.name !== undefined) {
        if (typeof p.name !== 'string' || p.name.trim() === '') {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
            errorMessage: `${prefix}.name must be a non-empty string.`,
          });
        } else if (!p.source) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
            errorMessage: `${prefix}.name: Existing NPC name mutation must carry valid source evidence (C03, C04).`,
          });
        } else {
          const permVal = validateSegmentFieldPermission(p.source, 'name');
          if (!permVal.valid) {
            errors.push({
              errorCode: permVal.unsupportedSegment
                ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
              errorMessage: `${prefix}.name: ${permVal.error}`,
            });
          }
        }
      }
    }

    // Strict canonical type & shape validation for immediate fields (HIGH 1, Point 1, Point 3, Point 4)
    if (p.present !== undefined && typeof p.present !== 'boolean') {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.present must be a boolean.`,
      });
    }

    if (p.activeInExchange !== undefined && typeof p.activeInExchange !== 'boolean') {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.activeInExchange must be a boolean.`,
      });
    }

    if (p.aliases !== undefined) {
      if (!Array.isArray(p.aliases) || p.aliases.length === 0 || !p.aliases.every((a) => typeof a === 'string' && a.trim() !== '')) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${prefix}.aliases must be an array of non-empty strings.`,
        });
      } else {
        const aliasSource = p.source || (isNew && p.evidence ? p.evidence : null);
        if (!aliasSource) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
            errorMessage: `${prefix}.aliases: Proposed aliases mutation must carry valid source evidence (C03, C04).`,
          });
        } else {
          const permVal = validateSegmentFieldPermission(aliasSource, 'aliases');
          if (!permVal.valid) {
            errors.push({
              errorCode: permVal.unsupportedSegment
                ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
              errorMessage: `${prefix}.aliases: ${permVal.error}`,
            });
          }
        }
      }
    }

    if (p.currentForm !== undefined) {
      if (p.currentForm !== null && (typeof p.currentForm !== 'string' || p.currentForm.trim() === '')) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${prefix}.currentForm must be a non-empty string or null.`,
        });
      }
    }

    const LIVE_SCALAR_FIELDS = ['mood', 'location', 'goal', 'status', 'offscreenActivity', 'currentPresentation'];
    for (const field of LIVE_SCALAR_FIELDS) {
      if (p[field] !== undefined) {
        if (typeof p[field] !== 'string') {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
            errorMessage: `${prefix}.${field} must be a non-empty string.`,
          });
        } else if (p[field].trim() === '') {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
            errorMessage: `${prefix}.${field} cannot be an empty string.`,
          });
        }
      }
    }

    // Proposal-level generic source check (C03)
    if (p.source !== undefined) {
      const srcVal = validateSourceReference(p.source, { writer: WRITERS.ONE_PASS });
      if (!srcVal.valid) {
        errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.source: ${srcVal.errorMessage}` });
      } else if (p.source && p.source.segmentKind && p.source.segmentKind !== STRUCTURED_SEGMENT_KINDS.NARRATIVE) {
        if (p.currentForm !== undefined) {
          const permVal = validateSegmentFieldPermission(p.source, 'currentForm');
          if (!permVal.valid) {
            errors.push({
              errorCode: permVal.unsupportedSegment
                ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
              errorMessage: `${prefix}.currentForm: ${permVal.error}`,
            });
          }
        }
        if (p.relationshipEvaluation !== undefined) {
          const permVal = validateSegmentFieldPermission(p.source, 'relationshipEvaluation');
          if (!permVal.valid) {
            errors.push({
              errorCode: permVal.unsupportedSegment
                ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
              errorMessage: `${prefix}.relationshipEvaluation: ${permVal.error}`,
            });
          }
        }
        if (p.lifecycle !== undefined) {
          const permVal = validateSegmentFieldPermission(p.source, 'lifecycle');
          if (!permVal.valid) {
            errors.push({
              errorCode: permVal.unsupportedSegment
                ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
              errorMessage: `${prefix}.lifecycle: ${permVal.error}`,
            });
          }
        }
      }
    }

    // Proposal-level presenceSource check (C03)
    if (p.presenceSource !== undefined) {
      const presenceVal = validateSourceReference(p.presenceSource, { writer: WRITERS.ONE_PASS });
      if (!presenceVal.valid) {
        errors.push({ errorCode: presenceVal.errorCode, errorMessage: `${prefix}.presenceSource: ${presenceVal.errorMessage}` });
      }
    }

    // Relationship evaluation rules (C04, C07, Point 2, Point 4)
    if (p.activeInExchange === true) {
      if (p.relationshipEvaluation === undefined) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.MISSING_RELATIONSHIP_EVALUATION,
          errorMessage: `${prefix}: Every claimed exchange-active NPC must receive an explicit relationship evaluation. Missing evaluation is not zero judgment.`,
        });
      }
    }

    if (p.relationshipEvaluation !== undefined) {
      const re = p.relationshipEvaluation;
      if (!re || typeof re !== 'object' || Array.isArray(re) || typeof re.shifted !== 'boolean') {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
          errorMessage: `${prefix}.relationshipEvaluation: must specify boolean 'shifted'.`,
        });
      } else {
        // Reject unknown relationshipEvaluation keys (MEDIUM 4)
        for (const key of Object.keys(re)) {
          if (!RELATIONSHIP_EVALUATION_ALLOWED_KEYS.includes(key)) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
              errorMessage: `${prefix}.relationshipEvaluation: Unknown key '${key}'. Allowed: ${RELATIONSHIP_EVALUATION_ALLOWED_KEYS.join(', ')}.`,
            });
          }
        }

        if (re.impact !== undefined && (typeof re.impact !== 'string' || re.impact.trim() === '')) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
            errorMessage: `${prefix}.relationshipEvaluation: 'impact', if provided, must be a non-empty string.`,
          });
        }

        if (re.shifted === false) {
          // Explicit zero evaluation representation: valid!
          // Point (2): shifted:false requires grounding via re.source or p.source
          const reSource = re.source || p.source;
          if (!reSource) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
              errorMessage: `${prefix}.relationshipEvaluation: explicit evaluation requires supporting source evidence (C03, C04).`,
            });
          } else {
            if (re.source !== undefined) {
              const srcVal = validateSourceReference(re.source, { writer: WRITERS.ONE_PASS });
              if (!srcVal.valid) {
                errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.relationshipEvaluation.source: ${srcVal.errorMessage}` });
              }
            }
            const permVal = validateSegmentFieldPermission(reSource, 'relationshipEvaluation');
            if (!permVal.valid) {
              errors.push({
                errorCode: permVal.unsupportedSegment
                  ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                  : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
                errorMessage: `${prefix}.relationshipEvaluation: ${permVal.error}`,
              });
            }
          }

          if (re.axes !== undefined) {
            if (typeof re.axes !== 'object' || Array.isArray(re.axes) || re.axes === null) {
              errors.push({
                errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
                errorMessage: `${prefix}.relationshipEvaluation.axes must be an object.`,
              });
            } else {
              for (const axisKey of Object.keys(re.axes)) {
                if (!RELATIONSHIP_AXES.includes(axisKey)) {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
                    errorMessage: `${prefix}.relationshipEvaluation.axes: Unknown relationship axis '${axisKey}'. Allowed axes: ${RELATIONSHIP_AXES.join(', ')}.`,
                  });
                } else if (re.axes[axisKey] !== 0) {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
                    errorMessage: `${prefix}.relationshipEvaluation: 'shifted' is false but axis '${axisKey}' is non-zero.`,
                  });
                }
              }
            }
          }

          if (re.reason !== undefined && (typeof re.reason !== 'string' || re.reason.trim() === '')) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
              errorMessage: `${prefix}.relationshipEvaluation: 'reason', if provided, must be a non-empty string.`,
            });
          }

          // Reject axisSupport when shifted is false (C07)
          if (re.axisSupport !== undefined) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
              errorMessage: `${prefix}.relationshipEvaluation: 'shifted:false' must not specify 'axisSupport'; per-axis support is only permitted for non-zero axis movement on shifted:true.`,
            });
          }
        } else {
          // Shifted === true: requires non-empty impact, non-empty axes with at least one non-zero numeric axis, and matching axisSupport (C07)
          if (re.impact === undefined || typeof re.impact !== 'string' || re.impact.trim() === '') {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
              errorMessage: `${prefix}.relationshipEvaluation: 'shifted:true' requires non-empty 'impact' string.`,
            });
          }

          const nonZeroAxes = new Set();
          if (!re.axes || typeof re.axes !== 'object' || Array.isArray(re.axes) || Object.keys(re.axes).length === 0) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
              errorMessage: `${prefix}.relationshipEvaluation: 'shifted:true' requires non-empty 'axes' object with at least one non-zero numeric axis.`,
            });
          } else {
            // Reject unknown axes keys (M-03)
            for (const axisKey of Object.keys(re.axes)) {
              if (!RELATIONSHIP_AXES.includes(axisKey)) {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
                  errorMessage: `${prefix}.relationshipEvaluation.axes: Unknown relationship axis '${axisKey}'. Allowed axes: ${RELATIONSHIP_AXES.join(', ')}.`,
                });
              }
            }

            for (const axis of RELATIONSHIP_AXES) {
              if (re.axes[axis] !== undefined) {
                if (typeof re.axes[axis] !== 'number') {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
                    errorMessage: `${prefix}.relationshipEvaluation.axes.${axis} must be a number.`,
                  });
                } else if (re.axes[axis] !== 0) {
                  nonZeroAxes.add(axis);
                }
              }
            }
            if (nonZeroAxes.size === 0) {
              errors.push({
                errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
                errorMessage: `${prefix}.relationshipEvaluation: 'shifted:true' must contain at least one non-zero numeric axis, not an empty or all-zero axes object.`,
              });
            }
          }

          // C07: strict axisSupport object map for shifted:true.
          // Each nonzero axis must have exactly one matching axisSupport entry.
          if (re.axisSupport === undefined || re.axisSupport === null) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
              errorMessage: `${prefix}.relationshipEvaluation: 'shifted:true' requires 'axisSupport' providing per-axis evidence for changed axes (C07).`,
            });
          } else if (typeof re.axisSupport !== 'object' || Array.isArray(re.axisSupport)) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
              errorMessage: `${prefix}.relationshipEvaluation: 'axisSupport' must be an object map of axis names to support entries (C07).`,
            });
          } else {
            const supportMap = new Map();
            let hasSupportFormatError = false;

            const keys = Object.keys(re.axisSupport);
            if (keys.length === 0) {
              errors.push({
                errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
                errorMessage: `${prefix}.relationshipEvaluation: 'axisSupport' object cannot be empty when shifted is true.`,
              });
              hasSupportFormatError = true;
            } else {
              for (const axisName of keys) {
                const sPrefix = `${prefix}.relationshipEvaluation.axisSupport.${axisName}`;
                if (!RELATIONSHIP_AXES.includes(axisName)) {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
                    errorMessage: `${sPrefix}: Unknown or invalid support axis '${axisName}'. Allowed axes: ${RELATIONSHIP_AXES.join(', ')}.`,
                  });
                  continue;
                }
                const item = re.axisSupport[axisName];
                if (!item || typeof item !== 'object' || Array.isArray(item)) {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
                    errorMessage: `${sPrefix} must be an object.`,
                  });
                  hasSupportFormatError = true;
                  continue;
                }
                for (const k of Object.keys(item)) {
                  if (!AXIS_SUPPORT_ENTRY_KEYS.includes(k)) {
                    errors.push({
                      errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
                      errorMessage: `${sPrefix}: Unknown key '${k}'. Allowed: ${AXIS_SUPPORT_ENTRY_KEYS.join(', ')}.`,
                    });
                  }
                }
                supportMap.set(axisName, { entry: item, prefix: sPrefix });
              }
            }

            if (!hasSupportFormatError) {
              // Each nonzero axis must have exactly one matching axisSupport entry
              for (const nonZeroAxis of nonZeroAxes) {
                if (!supportMap.has(nonZeroAxis)) {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
                    errorMessage: `${prefix}.relationshipEvaluation: Missing axisSupport for changed axis '${nonZeroAxis}'. Each nonzero axis must have exactly one matching axisSupport entry.`,
                  });
                }
              }

              // Prefer rejecting support for zero axes / support cannot substitute for another changed axis
              for (const [suppAxis, { entry, prefix: sPrefix }] of supportMap.entries()) {
                if (!nonZeroAxes.has(suppAxis)) {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
                    errorMessage: `${sPrefix}: Axis '${suppAxis}' is zero or unchanged; per-axis support cannot be provided for zero axes and cannot substitute for another changed axis.`,
                  });
                }

                // Each support entry contains valid permitted source and non-empty concise reason
                if (entry.reason === undefined || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
                    errorMessage: `${sPrefix}: Per-axis support requires a non-empty concise 'reason' string.`,
                  });
                }

                if (entry.source === undefined) {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
                    errorMessage: `${sPrefix}: Per-axis support requires supporting 'source' reference.`,
                  });
                } else {
                  const srcVal = validateSourceReference(entry.source, { writer: WRITERS.ONE_PASS });
                  if (!srcVal.valid) {
                    errors.push({ errorCode: srcVal.errorCode, errorMessage: `${sPrefix}.source: ${srcVal.errorMessage}` });
                  } else {
                    const permVal = validateSegmentFieldPermission(entry.source, 'relationshipEvaluation');
                    if (!permVal.valid) {
                      errors.push({
                        errorCode: permVal.unsupportedSegment
                          ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                          : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
                        errorMessage: `${sPrefix}.source: ${permVal.error}`,
                      });
                    }
                  }
                }
              }
            }
          }

          if (re.reason !== undefined && (typeof re.reason !== 'string' || re.reason.trim() === '')) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_RELATIONSHIP_EVALUATION,
              errorMessage: `${prefix}.relationshipEvaluation: 'reason', if provided, must be a non-empty string.`,
            });
          }

          if (re.source !== undefined) {
            const srcVal = validateSourceReference(re.source, { writer: WRITERS.ONE_PASS });
            if (!srcVal.valid) {
              errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.relationshipEvaluation.source: ${srcVal.errorMessage}` });
            } else {
              const permVal = validateSegmentFieldPermission(re.source, 'relationshipEvaluation');
              if (!permVal.valid) {
                errors.push({
                  errorCode: permVal.unsupportedSegment
                    ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                    : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
                  errorMessage: `${prefix}.relationshipEvaluation: ${permVal.error}`,
                });
              }
            }
          }
        }
      }
    }

    // Lifecycle rules (C06: Terminal death, no livingReturn, death contradiction)
    if (p.lifecycle !== undefined) {
      const lc = p.lifecycle;
      if (!lc || typeof lc !== 'object' || Array.isArray(lc)) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION,
          errorMessage: `${prefix}.lifecycle must be an object.`,
        });
      } else {
        // Reject unknown lifecycle keys (MEDIUM 4)
        for (const key of Object.keys(lc)) {
          if (!LIFECYCLE_ALLOWED_KEYS.includes(key)) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
              errorMessage: `${prefix}.lifecycle: Unknown key '${key}'. Allowed: ${LIFECYCLE_ALLOWED_KEYS.join(', ')}.`,
            });
          }
        }

        if (lc.livingReturn !== undefined) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION,
            errorMessage: `${prefix}.lifecycle: Automatic resurrection is forbidden. livingReturn is not a supported automatic channel (C06).`,
          });
        }

        if (lc.cause !== undefined && (typeof lc.cause !== 'string' || lc.cause.trim() === '')) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION,
            errorMessage: `${prefix}.lifecycle: 'cause', if provided, must be a non-empty string.`,
          });
        }

        if (lc.lifeState !== 'dead') {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION,
            errorMessage: `${prefix}.lifecycle: Invalid lifeState '${lc.lifeState}'. Automatic lifecycle proposals strictly require lifeState 'dead' (C06).`,
          });
        } else {
          if (!lc.source) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.FORBIDDEN_LIFECYCLE_MUTATION,
              errorMessage: `${prefix}.lifecycle: Death proposals require grounded source evidence.`,
            });
          } else {
            const srcVal = validateSourceReference(lc.source, { writer: WRITERS.ONE_PASS });
            if (!srcVal.valid) {
              errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.lifecycle.source: ${srcVal.errorMessage}` });
            } else {
              const permVal = validateSegmentFieldPermission(lc.source, 'lifecycle');
              if (!permVal.valid) {
                errors.push({
                  errorCode: permVal.unsupportedSegment
                    ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                    : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
                  errorMessage: `${prefix}.lifecycle: ${permVal.error}`,
                });
              }
            }
          }

          // Contradictory lifecycle check: dead cannot be present, active, or claim offscreenActivity (MEDIUM 7)
          if (p.activeInExchange === true) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.CONTRADICTORY_LIFECYCLE,
              errorMessage: `${prefix}: Contradictory lifecycle: cannot claim activeInExchange=true for a confirmed dead NPC proposal (C06).`,
            });
          }
          if (p.present === true) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.CONTRADICTORY_LIFECYCLE,
              errorMessage: `${prefix}: Contradictory lifecycle: cannot claim present=true for a confirmed dead NPC proposal (C06).`,
            });
          }
          if (p.offscreenActivity !== undefined) {
            let hasActivity = false;
            if (typeof p.offscreenActivity === 'string' && p.offscreenActivity.trim() !== '') hasActivity = true;
            if (typeof p.offscreenActivity === 'object' && p.offscreenActivity !== null && typeof p.offscreenActivity.value === 'string' && p.offscreenActivity.value.trim() !== '') hasActivity = true;
            if (hasActivity) {
              errors.push({
                errorCode: VALIDATION_ERROR_CODES.CONTRADICTORY_LIFECYCLE,
                errorMessage: `${prefix}: Contradictory lifecycle: cannot claim non-empty offscreenActivity for a confirmed dead NPC proposal (C06).`,
              });
            }
          }
        }
      }
    }

    // Every proposed immediate mutation must carry valid owned/permitted C03/C04 evidence (HIGH 1, Point 1)
    const IMMEDIATE_MUTATIONS = ['present', 'activeInExchange', 'offscreenActivity', 'mood', 'location', 'goal', 'status', 'currentPresentation'];
    for (const f of IMMEDIATE_MUTATIONS) {
      if (p[f] !== undefined) {
        let fieldSource = null;
        if (['present', 'activeInExchange', 'location', 'offscreenActivity'].includes(f) && p.presenceSource) {
          fieldSource = p.presenceSource;
        } else if (p.source) {
          fieldSource = p.source;
        } else if (isNew && p.evidence) {
          fieldSource = p.evidence;
        } else if (['present', 'activeInExchange'].includes(f) && p.relationshipEvaluation?.source) {
          fieldSource = p.relationshipEvaluation.source;
        } else if (['present', 'activeInExchange'].includes(f) && p.lifecycle?.source) {
          fieldSource = p.lifecycle.source;
        }

        if (!fieldSource) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
            errorMessage: `${prefix}.${f}: Proposed immediate mutation must carry valid source evidence (C03, C04).`,
          });
        } else {
          const permVal = validateSegmentFieldPermission(fieldSource, f === 'present' ? 'presence' : f);
          if (!permVal.valid) {
            errors.push({
              errorCode: permVal.unsupportedSegment
                ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
              errorMessage: `${prefix}.${f}: ${permVal.error}`,
            });
          }
        }
      }
    }

    // currentForm: whether string or null, requires source evidence; cannot be a no-source bypass (Point 2)
    if (p.currentForm !== undefined) {
      let formSource = null;
      if (p.source) formSource = p.source;
      else if (isNew && p.evidence) formSource = p.evidence;

      if (!formSource) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
          errorMessage: `${prefix}.currentForm: Proposed immediate mutation must carry valid source evidence (C03, C04).`,
        });
      } else {
        const permVal = validateSegmentFieldPermission(formSource, 'currentForm');
        if (!permVal.valid) {
          errors.push({
            errorCode: permVal.unsupportedSegment
              ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
              : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
            errorMessage: `${prefix}.currentForm: ${permVal.error}`,
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Helper to check if a field on a target NPC is supported by an explicit supportProposal (HIGH 2).
 */
function isFieldSupportedBySupportProposals(supportProposals, targetId, fieldName) {
  if (!Array.isArray(supportProposals)) return false;
  return supportProposals.some((sp) => {
    if (!sp || typeof sp !== 'object') return false;
    if (sp.targetId !== targetId) return false;
    const spBase = sp.field ? sp.field.split('.')[0] : '';
    const fieldBase = fieldName.split('.')[0];
    if (sp.field === fieldName || spBase === fieldBase) {
      const hasObsRefs = Array.isArray(sp.supportingObservationRefs) && sp.supportingObservationRefs.length > 0;
      const hasObsIds = Array.isArray(sp.supportingObservationIds) && sp.supportingObservationIds.length > 0;
      const hasSourceRefs = Array.isArray(sp.sourceRefs) && sp.sourceRefs.length > 0;
      return hasObsRefs || hasObsIds || hasSourceRefs;
    }
    return false;
  });
}

/**
 * Validates a scalar durable field object: { value, operation?, source }.
 */
function validateScalarDurableField(fieldObj, fieldName, allowedKeys, prefix, errors, isGrounded) {
  if (!fieldObj || typeof fieldObj !== 'object' || Array.isArray(fieldObj)) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${prefix}.${fieldName} must be an object.`,
    });
    return;
  }

  for (const key of Object.keys(fieldObj)) {
    if (!allowedKeys.includes(key)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
        errorMessage: `${prefix}.${fieldName}: Unknown or unauthorized key '${key}'. Allowed: ${allowedKeys.join(', ')}.`,
      });
    }
  }

  if (typeof fieldObj.value !== 'string' || fieldObj.value.trim() === '') {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${prefix}.${fieldName}: 'value' must be a non-empty string.`,
    });
  }

  if (fieldObj.operation !== undefined && !SCALAR_OPERATIONS.includes(fieldObj.operation)) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
      errorMessage: `${prefix}.${fieldName}: Invalid operation '${fieldObj.operation}'. Allowed: ${SCALAR_OPERATIONS.join(', ')}.`,
    });
  }

  if (fieldObj.source !== undefined) {
    const srcVal = validateSourceReference(fieldObj.source, { writer: WRITERS.DEVELOPMENT });
    if (!srcVal.valid) {
      errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.${fieldName}.source: ${srcVal.errorMessage}` });
    } else {
      const permVal = validateSegmentFieldPermission(fieldObj.source, fieldName);
      if (!permVal.valid) {
        errors.push({
          errorCode: permVal.unsupportedSegment
            ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
            : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
          errorMessage: `${prefix}.${fieldName}.source: ${permVal.error}`,
        });
      }
    }
  } else if (!isGrounded) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
      errorMessage: `${prefix}.${fieldName}: Proposed durable mutation must carry valid source evidence or explicit supportProposal (C03, C08).`,
    });
  }
}

/**
 * Validates personality facet object: { traits/value, operation?, source }.
 */
function validatePersonalityField(pers, prefix, errors, isGrounded) {
  if (!pers || typeof pers !== 'object' || Array.isArray(pers)) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${prefix}.personality must be an object.`,
    });
    return;
  }

  for (const key of Object.keys(pers)) {
    if (!PERSONALITY_ALLOWED_KEYS.includes(key)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
        errorMessage: `${prefix}.personality: Unknown or unauthorized key '${key}'. Allowed: ${PERSONALITY_ALLOWED_KEYS.join(', ')}.`,
      });
    }
  }

  if (pers.traits !== undefined) {
    if (!Array.isArray(pers.traits) || pers.traits.length === 0 || !pers.traits.every((t) => typeof t === 'string' && t.trim() !== '')) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.personality.traits must be an array of non-empty strings.`,
      });
    }
  }

  if (pers.value !== undefined) {
    if (typeof pers.value !== 'string' || pers.value.trim() === '') {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.personality.value must be a non-empty string.`,
      });
    }
  }

  const hasTraits = Array.isArray(pers.traits) && pers.traits.length > 0;
  const hasValue = typeof pers.value === 'string' && pers.value.trim() !== '';
  if (!hasTraits && !hasValue) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${prefix}.personality requires non-empty 'traits' array or 'value' string.`,
    });
  }

  if (pers.operation !== undefined && !SCALAR_OPERATIONS.includes(pers.operation)) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
      errorMessage: `${prefix}.personality: Invalid operation '${pers.operation}'. Allowed: ${SCALAR_OPERATIONS.join(', ')}.`,
    });
  }

  if (pers.source !== undefined) {
    const srcVal = validateSourceReference(pers.source, { writer: WRITERS.DEVELOPMENT });
    if (!srcVal.valid) {
      errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.personality.source: ${srcVal.errorMessage}` });
    } else {
      const permVal = validateSegmentFieldPermission(pers.source, 'personality');
      if (!permVal.valid) {
        errors.push({
          errorCode: permVal.unsupportedSegment
            ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
            : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
          errorMessage: `${prefix}.personality.source: ${permVal.error}`,
        });
      }
    }
  } else if (!isGrounded) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
      errorMessage: `${prefix}.personality: Proposed durable mutation must carry valid source evidence or explicit supportProposal (C03, C08).`,
    });
  }
}

/**
 * Validates a single mannerism item (string or object: { value, operation?, source? }).
 */
function validateMannerismItem(item, itemPrefix, errors, containerGrounded) {
  if (typeof item === 'string') {
    if (item.trim() === '') {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${itemPrefix} string must be non-empty.`,
      });
    } else if (!containerGrounded) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
        errorMessage: `${itemPrefix}: String mannerism item must be grounded via container source or explicit supportProposal (C03, C08).`,
      });
    }
    return;
  }

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${itemPrefix} must be a string or item object.`,
    });
    return;
  }

  for (const key of Object.keys(item)) {
    if (!MANNERISM_ITEM_KEYS.includes(key)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
        errorMessage: `${itemPrefix}: Unknown key '${key}'. Allowed: ${MANNERISM_ITEM_KEYS.join(', ')}.`,
      });
    }
  }

  if (typeof item.value !== 'string' || item.value.trim() === '') {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${itemPrefix} requires non-empty string 'value'.`,
    });
  }

  if (item.operation !== undefined && !COLLECTION_OPERATIONS.includes(item.operation)) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
      errorMessage: `${itemPrefix}: Invalid operation '${item.operation}'. Allowed: ${COLLECTION_OPERATIONS.join(', ')}.`,
    });
  }

  if (item.source !== undefined) {
    const srcVal = validateSourceReference(item.source, { writer: WRITERS.DEVELOPMENT });
    if (!srcVal.valid) {
      errors.push({ errorCode: srcVal.errorCode, errorMessage: `${itemPrefix}.source: ${srcVal.errorMessage}` });
    } else {
      const permVal = validateSegmentFieldPermission(item.source, 'mannerisms');
      if (!permVal.valid) {
        errors.push({
          errorCode: permVal.unsupportedSegment
            ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
            : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
          errorMessage: `${itemPrefix}.source: ${permVal.error}`,
        });
      }
    }
  } else if (!containerGrounded) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
      errorMessage: `${itemPrefix}: Mannerism item must carry source or be grounded via container source or explicit supportProposal (C03, C08).`,
    });
  }
}

/**
 * Validates mannerisms facet object: { value/items, operation?, source } or array.
 */
function validateMannerismsField(man, prefix, errors, isGrounded) {
  if (Array.isArray(man)) {
    if (man.length === 0) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.mannerisms array cannot be empty.`,
      });
      return;
    }
    for (let i = 0; i < man.length; i++) {
      validateMannerismItem(man[i], `${prefix}.mannerisms[${i}]`, errors, isGrounded);
    }
    return;
  }

  if (!man || typeof man !== 'object') {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${prefix}.mannerisms must be an object or array.`,
    });
    return;
  }

  for (const key of Object.keys(man)) {
    if (!MANNERISMS_ALLOWED_KEYS.includes(key)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
        errorMessage: `${prefix}.mannerisms: Unknown or unauthorized key '${key}'. Allowed: ${MANNERISMS_ALLOWED_KEYS.join(', ')}.`,
      });
    }
  }

  let hasContainerSource = false;
  if (man.source !== undefined) {
    const srcVal = validateSourceReference(man.source, { writer: WRITERS.DEVELOPMENT });
    if (!srcVal.valid) {
      errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.mannerisms.source: ${srcVal.errorMessage}` });
    } else {
      const permVal = validateSegmentFieldPermission(man.source, 'mannerisms');
      if (!permVal.valid) {
        errors.push({
          errorCode: permVal.unsupportedSegment
            ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
            : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
          errorMessage: `${prefix}.mannerisms.source: ${permVal.error}`,
        });
      } else {
        hasContainerSource = true;
      }
    }
  }

  const containerGrounded = isGrounded || hasContainerSource;

  if (man.value !== undefined) {
    if (Array.isArray(man.value)) {
      if (man.value.length === 0 || !man.value.every((v) => typeof v === 'string' && v.trim() !== '')) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${prefix}.mannerisms.value array must contain non-empty strings.`,
        });
      }
    } else if (typeof man.value !== 'string' || man.value.trim() === '') {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.mannerisms.value must be a non-empty string or array of non-empty strings.`,
      });
    }
    if (man.source === undefined && !isGrounded) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
        errorMessage: `${prefix}.mannerisms: Proposed mannerisms value must carry valid source evidence or explicit supportProposal (C03, C08).`,
      });
    }
  }

  if (man.items !== undefined) {
    if (!Array.isArray(man.items) || man.items.length === 0) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.mannerisms.items must be a non-empty array.`,
      });
    } else {
      for (let i = 0; i < man.items.length; i++) {
        validateMannerismItem(man.items[i], `${prefix}.mannerisms.items[${i}]`, errors, containerGrounded);
      }
    }
  }

  if (man.value === undefined && man.items === undefined) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${prefix}.mannerisms requires 'value' or 'items'.`,
    });
  }

  if (man.operation !== undefined && !COLLECTION_OPERATIONS.includes(man.operation)) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
      errorMessage: `${prefix}.mannerisms: Invalid operation '${man.operation}'. Allowed: ${COLLECTION_OPERATIONS.join(', ')}.`,
    });
  }
}

/**
 * Validates appearanceForms collection.
 */
function validateAppearanceFormsField(af, prefix, errors, isGrounded) {
  let formsList = [];
  let hasContainerSource = false;
  if (Array.isArray(af)) {
    if (af.length === 0) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.appearanceForms array cannot be empty.`,
      });
      return;
    }
    formsList = af;
  } else if (af && typeof af === 'object') {
    for (const key of Object.keys(af)) {
      if (!APPEARANCE_FORMS_CONTAINER_KEYS.includes(key)) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
          errorMessage: `${prefix}.appearanceForms: Unknown or unauthorized container key '${key}'. Allowed: ${APPEARANCE_FORMS_CONTAINER_KEYS.join(', ')}.`,
        });
      }
    }
    if (af.forms !== undefined && af.items !== undefined) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.appearanceForms: Cannot supply both 'forms' and 'items'. Use one collection alias.`,
      });
    }
    const rawList = af.forms !== undefined ? af.forms : af.items;
    if (rawList !== undefined) {
      if (!Array.isArray(rawList) || rawList.length === 0) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${prefix}.appearanceForms: 'forms' / 'items' must be a non-empty array.`,
        });
      } else {
        formsList = rawList;
      }
    } else {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.appearanceForms requires non-empty 'forms' or 'items' array.`,
      });
    }
    if (af.operation !== undefined && !COLLECTION_OPERATIONS.includes(af.operation)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
        errorMessage: `${prefix}.appearanceForms: Invalid operation '${af.operation}'. Allowed: ${COLLECTION_OPERATIONS.join(', ')}.`,
      });
    }
    if (af.source !== undefined) {
      const srcVal = validateSourceReference(af.source, { writer: WRITERS.DEVELOPMENT });
      if (!srcVal.valid) {
        errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.appearanceForms.source: ${srcVal.errorMessage}` });
      } else {
        const permVal = validateSegmentFieldPermission(af.source, 'appearanceForms');
        if (!permVal.valid) {
          errors.push({
            errorCode: permVal.unsupportedSegment
              ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
              : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
            errorMessage: `${prefix}.appearanceForms.source: ${permVal.error}`,
          });
        } else {
          hasContainerSource = true;
        }
      }
    }
  } else {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${prefix}.appearanceForms must be an array or container object.`,
    });
    return;
  }

  const containerGrounded = isGrounded || hasContainerSource;

  for (let i = 0; i < formsList.length; i++) {
    const item = formsList[i];
    const itemPrefix = `${prefix}.appearanceForms[${i}]`;
    if (!item || typeof item !== 'object') {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${itemPrefix} must be an object.`,
      });
      continue;
    }

    for (const key of Object.keys(item)) {
      if (!APPEARANCE_FORM_ITEM_KEYS.includes(key)) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
          errorMessage: `${itemPrefix}: Unknown key '${key}'. Allowed: ${APPEARANCE_FORM_ITEM_KEYS.join(', ')}.`,
        });
      }
    }

    if (item.operation !== undefined && !COLLECTION_OPERATIONS.includes(item.operation)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
        errorMessage: `${itemPrefix}: Invalid operation '${item.operation}'. Allowed: ${COLLECTION_OPERATIONS.join(', ')}.`,
      });
    }

    const effectiveOp = item.operation || (af && af.operation) || 'add';
    const isDestructive = effectiveOp === 'remove' || effectiveOp === 'replace';

    for (const strField of ['name', 'label', 'description', 'formId', 'localFormRef']) {
      if (item[strField] !== undefined && (typeof item[strField] !== 'string' || item[strField].trim() === '')) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${itemPrefix}: '${strField}' must be a non-empty string.`,
        });
      }
    }

    if (isDestructive) {
      // Prohibit localFormRef entirely on destructive items (C05)
      if (item.localFormRef !== undefined) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
          errorMessage: `${itemPrefix}: Destructive operation '${effectiveOp}' on appearanceForms cannot use request-local ref 'localFormRef' (C05).`,
        });
      }

      const hasStableFormId = typeof item.formId === 'string' && item.formId.trim() !== '';
      if (!hasStableFormId) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
          errorMessage: `${itemPrefix}: Destructive operation '${effectiveOp}' on appearanceForms requires non-empty stable persisted 'formId' (C05).`,
        });
      }

      if (effectiveOp === 'replace') {
        const hasProposedValue = (typeof item.label === 'string' && item.label.trim() !== '') ||
          (typeof item.name === 'string' && item.name.trim() !== '') ||
          (typeof item.description === 'string' && item.description.trim() !== '');
        if (!hasProposedValue) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
            errorMessage: `${itemPrefix}: Replace operation on appearanceForms requires proposed new form value ('label', 'name', or 'description').`,
          });
        }
      }
    } else {
      // Non-destructive: add / establish / update / enrich / consolidate
      const formId = item.formId || item.localFormRef;
      if (!formId || typeof formId !== 'string' || formId.trim() === '') {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${itemPrefix} requires non-empty 'formId' or 'localFormRef'.`,
        });
      }
    }

    if (item.source !== undefined) {
      const srcVal = validateSourceReference(item.source, { writer: WRITERS.DEVELOPMENT });
      if (!srcVal.valid) {
        errors.push({ errorCode: srcVal.errorCode, errorMessage: `${itemPrefix}.source: ${srcVal.errorMessage}` });
      } else {
        const permVal = validateSegmentFieldPermission(item.source, 'appearanceForms');
        if (!permVal.valid) {
          errors.push({
            errorCode: permVal.unsupportedSegment
              ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
              : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
            errorMessage: `${itemPrefix}.source: ${permVal.error}`,
          });
        }
      }
    } else if (!containerGrounded) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
        errorMessage: `${itemPrefix}: Appearance form item must carry source or be grounded via container source or explicit supportProposal (C03, C08).`,
      });
    }
  }
}

/**
 * Validates importantMemories collection.
 */
function validateImportantMemoriesField(im, prefix, errors, isGrounded) {
  let memList = [];
  let hasContainerSource = false;
  if (Array.isArray(im)) {
    if (im.length === 0) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.importantMemories array cannot be empty.`,
      });
      return;
    }
    memList = im;
  } else if (im && typeof im === 'object') {
    for (const key of Object.keys(im)) {
      if (!IMPORTANT_MEMORIES_CONTAINER_KEYS.includes(key)) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
          errorMessage: `${prefix}.importantMemories: Unknown or unauthorized container key '${key}'. Allowed: ${IMPORTANT_MEMORIES_CONTAINER_KEYS.join(', ')}.`,
        });
      }
    }
    if (im.memories !== undefined && im.items !== undefined) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.importantMemories: Cannot supply both 'memories' and 'items'. Use one collection alias.`,
      });
    }
    const rawList = im.memories !== undefined ? im.memories : im.items;
    if (rawList !== undefined) {
      if (!Array.isArray(rawList) || rawList.length === 0) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${prefix}.importantMemories: 'memories' / 'items' must be a non-empty array.`,
        });
      } else {
        memList = rawList;
      }
    } else {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.importantMemories requires non-empty 'memories' or 'items' array.`,
      });
    }
    if (im.operation !== undefined && !COLLECTION_OPERATIONS.includes(im.operation)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
        errorMessage: `${prefix}.importantMemories: Invalid operation '${im.operation}'. Allowed: ${COLLECTION_OPERATIONS.join(', ')}.`,
      });
    }
    if (im.source !== undefined) {
      const srcVal = validateSourceReference(im.source, { writer: WRITERS.DEVELOPMENT });
      if (!srcVal.valid) {
        errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.importantMemories.source: ${srcVal.errorMessage}` });
      } else {
        const permVal = validateSegmentFieldPermission(im.source, 'importantMemories');
        if (!permVal.valid) {
          errors.push({
            errorCode: permVal.unsupportedSegment
              ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
              : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
            errorMessage: `${prefix}.importantMemories.source: ${permVal.error}`,
          });
        } else {
          hasContainerSource = true;
        }
      }
    }
  } else {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${prefix}.importantMemories must be an array or container object.`,
    });
    return;
  }

  const containerGrounded = isGrounded || hasContainerSource;

  for (let i = 0; i < memList.length; i++) {
    const item = memList[i];
    const itemPrefix = `${prefix}.importantMemories[${i}]`;
    if (!item || typeof item !== 'object') {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${itemPrefix} must be an object.`,
      });
      continue;
    }

    for (const key of Object.keys(item)) {
      if (!IMPORTANT_MEMORY_ITEM_KEYS.includes(key)) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
          errorMessage: `${itemPrefix}: Unknown key '${key}'. Allowed: ${IMPORTANT_MEMORY_ITEM_KEYS.join(', ')}.`,
        });
      }
    }

    const effectiveOp = item.operation || (im && im.operation) || 'add';
    const isDestructive = effectiveOp === 'remove' || effectiveOp === 'replace';

    if (item.operation !== undefined && !COLLECTION_OPERATIONS.includes(item.operation)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
        errorMessage: `${itemPrefix}: Invalid operation '${item.operation}'. Allowed: ${COLLECTION_OPERATIONS.join(', ')}.`,
      });
    }

    for (const strField of ['memoryId', 'localMemoryRef', 'text', 'summary']) {
      if (item[strField] !== undefined && (typeof item[strField] !== 'string' || item[strField].trim() === '')) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${itemPrefix}: '${strField}' must be a non-empty string.`,
        });
      }
    }

    if (isDestructive) {
      // Prohibit localMemoryRef entirely on destructive items (C05)
      if (item.localMemoryRef !== undefined) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
          errorMessage: `${itemPrefix}: Destructive operation '${effectiveOp}' on importantMemories cannot use request-local ref 'localMemoryRef' (C05).`,
        });
      }

      const hasStableMemoryId = typeof item.memoryId === 'string' && item.memoryId.trim() !== '';
      if (!hasStableMemoryId) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
          errorMessage: `${itemPrefix}: Destructive operation '${effectiveOp}' on importantMemories requires non-empty stable persisted 'memoryId' (C05).`,
        });
      }

      // text and summary are proposed/new values, NOT expected preconditions
      if (effectiveOp === 'replace') {
        const text = item.text || item.summary;
        if (!text || typeof text !== 'string' || text.trim() === '') {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
            errorMessage: `${itemPrefix}: Replace operation on importantMemories requires proposed new 'text' or 'summary'.`,
          });
        }
      }
    } else {
      // Non-destructive: add / establish / update / enrich / consolidate
      const text = item.text || item.summary;
      if (!text || typeof text !== 'string' || text.trim() === '') {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${itemPrefix} requires non-empty string 'text' or 'summary'.`,
        });
      }
    }

    if (item.source !== undefined) {
      const srcVal = validateSourceReference(item.source, { writer: WRITERS.DEVELOPMENT });
      if (!srcVal.valid) {
        errors.push({ errorCode: srcVal.errorCode, errorMessage: `${itemPrefix}.source: ${srcVal.errorMessage}` });
      } else {
        const permVal = validateSegmentFieldPermission(item.source, 'importantMemories');
        if (!permVal.valid) {
          errors.push({
            errorCode: permVal.unsupportedSegment
              ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
              : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
            errorMessage: `${itemPrefix}.source: ${permVal.error}`,
          });
        }
      }
    } else if (!containerGrounded) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
        errorMessage: `${itemPrefix}: Memory item must carry source or be grounded via container source or explicit supportProposal (C03, C08).`,
      });
    }

    if (item.sameEventLinks !== undefined) {
      if (typeof item.sameEventLinks === 'string') {
        if (item.sameEventLinks.trim() === '') {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
            errorMessage: `${itemPrefix}: 'sameEventLinks' string cannot be empty.`,
          });
        }
      } else if (Array.isArray(item.sameEventLinks)) {
        if (item.sameEventLinks.length === 0 || !item.sameEventLinks.every((l) => typeof l === 'string' && l.trim() !== '')) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
            errorMessage: `${itemPrefix}: 'sameEventLinks' array must contain non-empty strings.`,
          });
        }
      } else {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${itemPrefix}: 'sameEventLinks' must be an array or string.`,
        });
      }
    }
  }
}

/**
 * Validates nonPlayerRelationships collection.
 */
function validateNonPlayerRelationshipsField(npr, prefix, errors, isGrounded) {
  let relList = [];
  let hasContainerSource = false;
  if (Array.isArray(npr)) {
    if (npr.length === 0) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.nonPlayerRelationships array cannot be empty.`,
      });
      return;
    }
    relList = npr;
  } else if (npr && typeof npr === 'object') {
    for (const key of Object.keys(npr)) {
      if (!NON_PLAYER_RELATIONSHIPS_CONTAINER_KEYS.includes(key)) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
          errorMessage: `${prefix}.nonPlayerRelationships: Unknown or unauthorized container key '${key}'. Allowed: ${NON_PLAYER_RELATIONSHIPS_CONTAINER_KEYS.join(', ')}.`,
        });
      }
    }
    if (npr.relationships !== undefined && npr.items !== undefined) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.nonPlayerRelationships: Cannot supply both 'relationships' and 'items'. Use one collection alias.`,
      });
    }
    const rawList = npr.relationships !== undefined ? npr.relationships : npr.items;
    if (rawList !== undefined) {
      if (!Array.isArray(rawList) || rawList.length === 0) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${prefix}.nonPlayerRelationships: 'relationships' / 'items' must be a non-empty array.`,
        });
      } else {
        relList = rawList;
      }
    } else {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${prefix}.nonPlayerRelationships requires non-empty 'relationships' or 'items' array.`,
      });
    }
    if (npr.operation !== undefined && !COLLECTION_OPERATIONS.includes(npr.operation)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
        errorMessage: `${prefix}.nonPlayerRelationships: Invalid operation '${npr.operation}'. Allowed: ${COLLECTION_OPERATIONS.join(', ')}.`,
      });
    }
    if (npr.source !== undefined) {
      const srcVal = validateSourceReference(npr.source, { writer: WRITERS.DEVELOPMENT });
      if (!srcVal.valid) {
        errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.nonPlayerRelationships.source: ${srcVal.errorMessage}` });
      } else {
        const permVal = validateSegmentFieldPermission(npr.source, 'nonPlayerRelationships');
        if (!permVal.valid) {
          errors.push({
            errorCode: permVal.unsupportedSegment
              ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
              : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
            errorMessage: `${prefix}.nonPlayerRelationships.source: ${permVal.error}`,
          });
        } else {
          hasContainerSource = true;
        }
      }
    }
  } else {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${prefix}.nonPlayerRelationships must be an array or container object.`,
    });
    return;
  }

  const containerGrounded = isGrounded || hasContainerSource;

  for (let i = 0; i < relList.length; i++) {
    const item = relList[i];
    const itemPrefix = `${prefix}.nonPlayerRelationships[${i}]`;
    if (!item || typeof item !== 'object') {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
        errorMessage: `${itemPrefix} must be an object.`,
      });
      continue;
    }

    for (const key of Object.keys(item)) {
      if (!NON_PLAYER_RELATIONSHIP_ITEM_KEYS.includes(key)) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
          errorMessage: `${itemPrefix}: Unknown key '${key}'. Allowed: ${NON_PLAYER_RELATIONSHIP_ITEM_KEYS.join(', ')}.`,
        });
      }
    }

    const effectiveOp = item.operation || (npr && npr.operation) || 'establish';
    const isDestructive = effectiveOp === 'remove' || effectiveOp === 'replace';

    if (item.operation !== undefined && !COLLECTION_OPERATIONS.includes(item.operation)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
        errorMessage: `${itemPrefix}: Invalid operation '${item.operation}'. Allowed: ${COLLECTION_OPERATIONS.join(', ')}.`,
      });
    }

    for (const strField of ['targetId', 'targetRef', 'targetName', 'relationship', 'relationKind', 'description', 'relationId']) {
      if (item[strField] !== undefined && (typeof item[strField] !== 'string' || item[strField].trim() === '')) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${itemPrefix}: '${strField}' must be a non-empty string.`,
        });
      }
    }

    if (isDestructive) {
      // Prohibit targetRef and targetName as destructive target channels (C05)
      if (item.targetRef !== undefined) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
          errorMessage: `${itemPrefix}: Destructive operation '${effectiveOp}' on nonPlayerRelationships cannot use request-local ref 'targetRef' (C05).`,
        });
      }
      if (item.targetName !== undefined) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
          errorMessage: `${itemPrefix}: Destructive operation '${effectiveOp}' on nonPlayerRelationships cannot use ambiguous 'targetName' (C05).`,
        });
      }
      if (item.targetId !== undefined) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
          errorMessage: `${itemPrefix}: Destructive operation '${effectiveOp}' on nonPlayerRelationships cannot use 'targetId'; destructive operations require stable persisted 'relationId' (C05).`,
        });
      }

      const hasRelationId = typeof item.relationId === 'string' && item.relationId.trim() !== '';
      if (!hasRelationId) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
          errorMessage: `${itemPrefix}: Destructive operation '${effectiveOp}' on nonPlayerRelationships requires non-empty stable persisted 'relationId' (C05).`,
        });
      }

      // relationship/relationKind/description are proposed/new values, NOT expected preconditions
      if (effectiveOp === 'replace') {
        const relDesc = item.relationship || item.relationKind || item.description;
        if (!relDesc || typeof relDesc !== 'string' || relDesc.trim() === '') {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
            errorMessage: `${itemPrefix}: Replace operation on nonPlayerRelationships requires proposed new relationship description ('relationship', 'relationKind', or 'description').`,
          });
        }
      }
    } else {
      // Non-destructive: establish / add / update / enrich / consolidate
      const hasTarget = item.targetId || item.targetRef || item.targetName;
      if (!hasTarget || typeof hasTarget !== 'string' || hasTarget.trim() === '') {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${itemPrefix} requires non-empty target endpoint reference ('targetId', 'targetRef', or 'targetName').`,
        });
      }

      const relDesc = item.relationship || item.relationKind || item.description;
      if (!relDesc || typeof relDesc !== 'string' || relDesc.trim() === '') {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${itemPrefix} requires non-empty relation description ('relationship', 'relationKind', or 'description').`,
        });
      }
    }

    if (item.source !== undefined) {
      const srcVal = validateSourceReference(item.source, { writer: WRITERS.DEVELOPMENT });
      if (!srcVal.valid) {
        errors.push({ errorCode: srcVal.errorCode, errorMessage: `${itemPrefix}.source: ${srcVal.errorMessage}` });
      } else {
        const permVal = validateSegmentFieldPermission(item.source, 'nonPlayerRelationships');
        if (!permVal.valid) {
          errors.push({
            errorCode: permVal.unsupportedSegment
              ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
              : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
            errorMessage: `${itemPrefix}.source: ${permVal.error}`,
          });
        }
      }
    } else if (!containerGrounded) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
        errorMessage: `${itemPrefix}: Relationship item must carry source or be grounded via container source or explicit supportProposal (C03, C08).`,
      });
    }
  }
}

/**
 * Validates facts object: { role, species, background, actualAge, apparentAge, birthday, operation, source }.
 */
function validateFactsField(facts, prefix, errors, targetId, supportProposals) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${prefix}.facts must be an object.`,
    });
    return;
  }

  for (const key of Object.keys(facts)) {
    if (!DURABLE_FACT_KEYS.includes(key)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
        errorMessage: `${prefix}.facts: Unknown key '${key}'. Allowed: ${DURABLE_FACT_KEYS.join(', ')}.`,
      });
    }
  }

  if (facts.operation !== undefined && !SCALAR_OPERATIONS.includes(facts.operation)) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
      errorMessage: `${prefix}.facts: Invalid operation '${facts.operation}'. Allowed: ${SCALAR_OPERATIONS.join(', ')}.`,
    });
  }

  let hasContainerSource = false;
  if (facts.source !== undefined) {
    const srcVal = validateSourceReference(facts.source, { writer: WRITERS.DEVELOPMENT });
    if (!srcVal.valid) {
      errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.facts.source: ${srcVal.errorMessage}` });
    } else {
      const permVal = validateSegmentFieldPermission(facts.source, 'role');
      if (!permVal.valid) {
        errors.push({
          errorCode: permVal.unsupportedSegment
            ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
            : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
          errorMessage: `${prefix}.facts.source: ${permVal.error}`,
        });
      } else {
        hasContainerSource = true;
      }
    }
  }

  const FACT_SUBOBJECT_FIELDS = ['role', 'species', 'background', 'actualAge', 'apparentAge', 'birthday'];
  let canonicalSubfieldCount = 0;
  for (const factField of FACT_SUBOBJECT_FIELDS) {
    if (facts[factField] !== undefined) {
      canonicalSubfieldCount++;
      if (typeof facts[factField] !== 'string') {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${prefix}.facts.${factField} must be a non-empty string.`,
        });
      } else if (facts[factField].trim() === '') {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
          errorMessage: `${prefix}.facts.${factField} cannot be an empty string.`,
        });
      }
      const isFieldGrounded = hasContainerSource || isFieldSupportedBySupportProposals(supportProposals, targetId, factField) || isFieldSupportedBySupportProposals(supportProposals, targetId, 'facts');
      if (facts.source === undefined && !isFieldGrounded) {
        errors.push({
          errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
          errorMessage: `${prefix}.facts.${factField}: Proposed durable fact must carry valid source evidence or explicit supportProposal (C03, C08).`,
        });
      }
    }
  }

  if (canonicalSubfieldCount === 0) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
      errorMessage: `${prefix}.facts: When supplied, 'facts' must specify at least one canonical fact subfield (${FACT_SUBOBJECT_FIELDS.join(', ')}).`,
    });
  }
}

/**
 * Validates a Development review wire envelope.
 * @param {object} envelope
 * @returns {{ valid: boolean, errors: Array<{ errorCode: string, errorMessage: string }> }}
 */
export function validateDevelopmentEnvelope(envelope) {
  const errors = [];

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return {
      valid: false,
      errors: [
        {
          errorCode: VALIDATION_ERROR_CODES.INVALID_ENVELOPE,
          errorMessage: 'Development envelope must be a JSON object.',
        },
      ],
    };
  }

  if (envelope.version !== ALPHA_DEVELOPMENT_WIRE_VERSION) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.VERSION_MISMATCH,
      errorMessage: `Development wire version mismatch: expected '${ALPHA_DEVELOPMENT_WIRE_VERSION}', got '${envelope.version}'.`,
    });
  }

  // Check top-level wrong-writer fields on development envelope
  const onePassTopLevel = ['mood', 'location', 'goal', 'status', 'present', 'activeInExchange', 'offscreenActivity', 'currentPresentation', 'currentForm', 'relationshipEvaluation', 'lifecycle', 'lifeState'];
  for (const field of onePassTopLevel) {
    if (envelope[field] !== undefined) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.WRONG_WRITER,
        errorMessage: `Wrong-writer rejection: One-pass-owned field '${field}' found in development envelope.`,
      });
    }
  }

  // Reject dead acceptedSupport fallback (LOW L-03)
  if (envelope.acceptedSupport !== undefined) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.WRONG_WRITER,
      errorMessage: "Wrong-writer rejection: 'acceptedSupport' is strictly runtime-owned (C02, C08); development wire accepts 'supportProposals' only.",
    });
  }

  // Reject unknown top-level keys
  for (const key of Object.keys(envelope)) {
    if (onePassTopLevel.includes(key) || key === 'acceptedSupport') continue;
    if (!DEVELOPMENT_TOP_LEVEL_KEYS.includes(key)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
        errorMessage: `Unknown or unauthorized top-level key '${key}' found in development envelope.`,
      });
    }
  }

  // LOW 10: Reject envelopes containing both receipt aliases
  const hasTargetAck = envelope.targetAcknowledgments !== undefined;
  const hasReviewReceipts = envelope.reviewReceipts !== undefined;

  if (hasTargetAck && hasReviewReceipts) {
    errors.push({
      errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT,
      errorMessage: "Cannot specify both 'targetAcknowledgments' and 'reviewReceipts' in development envelope. Use one receipt alias.",
    });
  }

  // Target acknowledgments / review receipts validation (Requirement 4, MEDIUM 4)
  if (hasTargetAck || hasReviewReceipts) {
    const receiptFieldName = hasTargetAck ? 'targetAcknowledgments' : 'reviewReceipts';
    const receipts = envelope[receiptFieldName];
    if (!Array.isArray(receipts)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT,
        errorMessage: `'${receiptFieldName}' must be an array if provided.`,
      });
    } else {
      for (let i = 0; i < receipts.length; i++) {
        const r = receipts[i];
        const prefix = `Receipt[${i}]`;
        if (!r || typeof r !== 'object' || Array.isArray(r)) {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT, errorMessage: `${prefix} must be an object.` });
          continue;
        }

        // Reject unknown keys in receipt (MEDIUM 4)
        for (const key of Object.keys(r)) {
          if (!RECEIPT_ALLOWED_KEYS.includes(key)) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
              errorMessage: `${prefix}: Unknown key '${key}'. Allowed: ${RECEIPT_ALLOWED_KEYS.join(', ')}.`,
            });
          }
        }

        if (!r.targetId || typeof r.targetId !== 'string' || r.targetId.trim() === '') {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT, errorMessage: `${prefix} must specify non-empty 'targetId'.` });
        }

        if (r.sourceScope !== undefined) {
          if (!Array.isArray(r.sourceScope) || r.sourceScope.length === 0 || !r.sourceScope.every((s) => typeof s === 'string' && s.trim() !== '')) {
            errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT, errorMessage: `${prefix} must specify non-empty 'sourceScope' array of non-empty strings.` });
          }
        } else {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT, errorMessage: `${prefix} must specify non-empty 'sourceScope' array.` });
        }

        if (r.status === undefined || !RECEIPT_STATUSES.includes(r.status)) {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT, errorMessage: `${prefix}: Receipt requires valid 'status' in [${RECEIPT_STATUSES.join(', ')}].` });
        }

        if (r.restricted !== undefined && typeof r.restricted !== 'boolean') {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT,
            errorMessage: `${prefix}: 'restricted', if provided, must be a boolean.`,
          });
        }

        if (r.reason !== undefined && (typeof r.reason !== 'string' || r.reason.trim() === '')) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT,
            errorMessage: `${prefix}: 'reason', if provided, must be a non-empty string.`,
          });
        }

        // Scope and fieldSubset rules (Requirement 4)
        if (r.restricted === true) {
          if (!Array.isArray(r.fieldSubset) || r.fieldSubset.length === 0) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT,
              errorMessage: `${prefix}: Restricted receipt ('restricted: true') requires non-empty 'fieldSubset' array.`,
            });
          } else {
            for (const f of r.fieldSubset) {
              if (typeof f !== 'string' || !isDurableDossierField(f)) {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT,
                  errorMessage: `${prefix}: 'fieldSubset' field '${f}' is not an eligible Development durable/profile field.`,
                });
              }
            }
          }
        } else {
          if (r.fieldSubset !== undefined) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT,
              errorMessage: `${prefix}: Unrestricted review receipt cannot specify 'fieldSubset'. Restricted scope requires explicit 'restricted: true' marker.`,
            });
          }
        }

        if (r.status === 'deferred' || r.status === 'unavailable') {
          if (!r.reason || typeof r.reason !== 'string' || r.reason.trim() === '') {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_RECEIPT,
              errorMessage: `${prefix}: '${r.status}' receipt must provide non-empty 'reason' explaining unreviewed scope.`,
            });
          }
        }
      }
    }
  }

  // C08 Observations validation (Requirement 2, MEDIUM 4, LOW 9)
  const seenObsLocalRefs = new Set();
  const obsMap = new Map();

  if (envelope.observations !== undefined) {
    if (!Array.isArray(envelope.observations)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
        errorMessage: "'observations' must be an array if provided.",
      });
    } else {
      for (let i = 0; i < envelope.observations.length; i++) {
        const obs = envelope.observations[i];
        const prefix = `Observation[${i}]`;

        if (!obs || typeof obs !== 'object' || Array.isArray(obs)) {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION, errorMessage: `${prefix} must be an object.` });
          continue;
        }

        // Model response must NOT author persistent observation ID
        if (obs.id !== undefined) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
            errorMessage: `${prefix}: Development model response must not author persistent observation 'id'. Runtime assigns stable persistent IDs; use 'localObservationRef'.`,
          });
        }

        // Reject unknown observation keys (MEDIUM 4)
        for (const key of Object.keys(obs)) {
          if (key === 'id') continue;
          if (!OBSERVATION_ALLOWED_KEYS.includes(key)) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
              errorMessage: `${prefix}: Unknown key '${key}'. Allowed: ${OBSERVATION_ALLOWED_KEYS.join(', ')}.`,
            });
          }
        }

        if (obs.localObservationRef !== undefined && obs.localRef !== undefined) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
            errorMessage: `${prefix}: Cannot specify both 'localObservationRef' and 'localRef'. Use one local reference alias.`,
          });
        }

        const localRef = obs.localObservationRef || obs.localRef;
        if (!localRef || typeof localRef !== 'string' || localRef.trim() === '') {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
            errorMessage: `${prefix}: Observation requires request-local reference string 'localObservationRef'.`,
          });
        } else {
          if (seenObsLocalRefs.has(localRef)) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.DUPLICATE_LOCAL_REF,
              errorMessage: `${prefix}: Duplicate localObservationRef '${localRef}' in same envelope. Local observation refs must be unique.`,
            });
          }
          seenObsLocalRefs.add(localRef);
          obsMap.set(localRef, obs);
        }

        if (!obs.targetId || typeof obs.targetId !== 'string' || obs.targetId.trim() === '') {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION, errorMessage: `${prefix} must specify non-empty 'targetId'.` });
        }

        if (!obs.field || typeof obs.field !== 'string' || obs.field.trim() === '') {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION, errorMessage: `${prefix} must specify non-empty 'field'.` });
        } else if (!isDurableDossierField(obs.field)) {
          // LOW 9: Remove observations ledger target exception
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
            errorMessage: `${prefix}: Observation field '${obs.field}' must target an eligible Development durable field; observations ledger is not a valid target.`,
          });
        }

        if (!obs.observation || typeof obs.observation !== 'string' || obs.observation.trim() === '') {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION, errorMessage: `${prefix} must specify non-empty 'observation'.` });
        }

        if (obs.source === undefined) {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION, errorMessage: `${prefix} must specify 'source'.` });
        } else {
          const srcVal = validateSourceReference(obs.source, { writer: WRITERS.DEVELOPMENT });
          if (!srcVal.valid) {
            errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.source: ${srcVal.errorMessage}` });
          } else {
            const permVal = validateSegmentFieldPermission(obs.source, obs.field);
            if (!permVal.valid) {
              errors.push({
                errorCode: permVal.unsupportedSegment
                  ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                  : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
                errorMessage: `${prefix}.source: ${permVal.error}`,
              });
            }
          }
        }

        // Evidence disposition validation (Requirement 2, MEDIUM 4)
        if (obs.disposition !== undefined) {
          if (!obs.disposition || typeof obs.disposition !== 'object' || Array.isArray(obs.disposition)) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
              errorMessage: `${prefix}.disposition must be an object.`,
            });
          } else {
            for (const key of Object.keys(obs.disposition)) {
              if (!DISPOSITION_ALLOWED_KEYS.includes(key)) {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
                  errorMessage: `${prefix}.disposition: Unknown key '${key}'. Allowed: ${DISPOSITION_ALLOWED_KEYS.join(', ')}.`,
                });
              }
            }

            if (!EVIDENCE_DISPOSITIONS.includes(obs.disposition.role)) {
              errors.push({
                errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                errorMessage: `${prefix}.disposition.role must be one of [${EVIDENCE_DISPOSITIONS.join(', ')}].`,
              });
            }

            let hasValidFieldRev = false;
            if (obs.disposition.linkedFieldRevision !== undefined) {
              if (typeof obs.disposition.linkedFieldRevision !== 'string' || obs.disposition.linkedFieldRevision.trim() === '') {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                  errorMessage: `${prefix}.disposition: 'linkedFieldRevision', if provided, must be a non-empty string.`,
                });
              } else {
                hasValidFieldRev = true;
              }
            }

            let hasValidObsRefs = false;
            if (obs.disposition.linkedObservationRefs !== undefined) {
              const refs = obs.disposition.linkedObservationRefs;
              if (typeof refs === 'string') {
                if (refs.trim() === '') {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                    errorMessage: `${prefix}.disposition: 'linkedObservationRefs' string cannot be empty.`,
                  });
                } else {
                  hasValidObsRefs = true;
                }
              } else if (Array.isArray(refs)) {
                if (refs.length === 0 || !refs.every((r) => typeof r === 'string' && r.trim() !== '')) {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                    errorMessage: `${prefix}.disposition: 'linkedObservationRefs' array must contain non-empty strings.`,
                  });
                } else {
                  hasValidObsRefs = true;
                }
              } else {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                  errorMessage: `${prefix}.disposition: 'linkedObservationRefs' must be a string or array of strings.`,
                });
              }
            }

            let hasValidObsIds = false;
            if (obs.disposition.linkedObservationIds !== undefined) {
              const ids = obs.disposition.linkedObservationIds;
              if (typeof ids === 'string') {
                if (ids.trim() === '') {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                    errorMessage: `${prefix}.disposition: 'linkedObservationIds' string cannot be empty.`,
                  });
                } else {
                  hasValidObsIds = true;
                }
              } else if (Array.isArray(ids)) {
                if (ids.length === 0 || !ids.every((id) => typeof id === 'string' && id.trim() !== '')) {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                    errorMessage: `${prefix}.disposition: 'linkedObservationIds' array must contain non-empty strings.`,
                  });
                } else {
                  hasValidObsIds = true;
                }
              } else {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                  errorMessage: `${prefix}.disposition: 'linkedObservationIds' must be a string or array of strings.`,
                });
              }
            }

            if (obs.disposition.reason !== undefined && (typeof obs.disposition.reason !== 'string' || obs.disposition.reason.trim() === '')) {
              errors.push({
                errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                errorMessage: `${prefix}.disposition: 'reason', if provided, must be a non-empty string.`,
              });
            }

            if (obs.disposition.notes !== undefined && (typeof obs.disposition.notes !== 'string' || obs.disposition.notes.trim() === '')) {
              errors.push({
                errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                errorMessage: `${prefix}.disposition: 'notes', if provided, must be a non-empty string.`,
              });
            }

            const role = obs.disposition.role;
            if (role === 'supporting' || role === 'contradicting') {
              if (!hasValidFieldRev && !hasValidObsRefs && !hasValidObsIds) {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                  errorMessage: `${prefix}.disposition: '${role}' role requires linked reference ('linkedFieldRevision' or 'linkedObservationRefs').`,
                });
              }
            } else if (role === 'superseded') {
              if (!hasValidObsRefs && !hasValidObsIds && !hasValidFieldRev) {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                  errorMessage: `${prefix}.disposition: 'superseded' role requires linked reference ('linkedObservationRefs' or 'linkedFieldRevision').`,
                });
              }
            }
          }
        }

        if (obs.sameEventLinks !== undefined) {
          const links = obs.sameEventLinks;
          if (typeof links === 'string') {
            if (links.trim() === '') {
              errors.push({
                errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                errorMessage: `${prefix}.sameEventLinks string cannot be empty.`,
              });
            }
          } else if (Array.isArray(links)) {
            if (links.length === 0 || !links.every((link) => typeof link === 'string' && link.trim() !== '')) {
              errors.push({
                errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
                errorMessage: `${prefix}.sameEventLinks array must contain non-empty strings.`,
              });
            }
          } else {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
              errorMessage: `${prefix}.sameEventLinks must be an array or string.`,
            });
          }
        }

        if (obs.sameEventRef !== undefined) {
          if (typeof obs.sameEventRef !== 'string' || obs.sameEventRef.trim() === '') {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_OBSERVATION,
              errorMessage: `${prefix}.sameEventRef, if provided, must be a non-empty string.`,
            });
          }
        }
      }
    }
  }

  // C08 Support proposals validation (Requirement 1, 3, HIGH 3, MEDIUM 4)
  const supportProposals = envelope.supportProposals;
  if (supportProposals !== undefined) {
    if (!Array.isArray(supportProposals)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT,
        errorMessage: "'supportProposals' must be an array if provided.",
      });
    } else {
      for (let i = 0; i < supportProposals.length; i++) {
        const s = supportProposals[i];
        const prefix = `SupportProposal[${i}]`;

        if (!s || typeof s !== 'object' || Array.isArray(s)) {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT, errorMessage: `${prefix} must be an object.` });
          continue;
        }

        for (const key of Object.keys(s)) {
          if (!SUPPORT_PROPOSAL_ALLOWED_KEYS.includes(key)) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
              errorMessage: `${prefix}: Unknown key '${key}'. Allowed: ${SUPPORT_PROPOSAL_ALLOWED_KEYS.join(', ')}.`,
            });
          }
        }

        if (!s.targetId || typeof s.targetId !== 'string' || s.targetId.trim() === '') {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT, errorMessage: `${prefix} must specify non-empty 'targetId'.` });
        }

        if (!s.field || typeof s.field !== 'string' || s.field.trim() === '') {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT, errorMessage: `${prefix} must specify non-empty 'field'.` });
        } else if (!isDurableDossierField(s.field)) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT,
            errorMessage: `${prefix}: Field '${s.field}' is not an eligible Development durable field.`,
          });
        }

        let hasValidLinkage = false;

        // HIGH 3: supportingObservationRefs must always resolve against envelope observations, even if omitted/empty
        if (s.supportingObservationRefs !== undefined) {
          if (!Array.isArray(s.supportingObservationRefs) || s.supportingObservationRefs.length === 0 || !s.supportingObservationRefs.every((ref) => typeof ref === 'string' && ref.trim() !== '')) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT,
              errorMessage: `${prefix}: 'supportingObservationRefs' must be an array of non-empty strings.`,
            });
          } else {
            hasValidLinkage = true;
            for (const ref of s.supportingObservationRefs) {
              const linkedObs = obsMap.get(ref);
              if (!linkedObs) {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT,
                  errorMessage: `${prefix}: Support proposal references missing observation '${ref}'.`,
                });
              } else {
                if (s.targetId && linkedObs.targetId && s.targetId !== linkedObs.targetId) {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT,
                    errorMessage: `${prefix}: Target mismatch. Support proposal targetId '${s.targetId}' does not match referenced observation targetId '${linkedObs.targetId}'.`,
                  });
                }
                if (s.field && linkedObs.field) {
                  const sBase = s.field.split('.')[0];
                  const obsBase = linkedObs.field.split('.')[0];
                  if (sBase !== obsBase) {
                    errors.push({
                      errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT,
                      errorMessage: `${prefix}: Field mismatch. Support proposal field '${s.field}' does not match referenced observation field '${linkedObs.field}'.`,
                    });
                  }
                }
              }
            }
          }
        }

        // HIGH 3: supportingObservationIds is structural check only
        if (s.supportingObservationIds !== undefined) {
          if (!Array.isArray(s.supportingObservationIds) || s.supportingObservationIds.length === 0 || !s.supportingObservationIds.every((id) => typeof id === 'string' && id.trim() !== '')) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT,
              errorMessage: `${prefix}: 'supportingObservationIds' must be an array of non-empty strings.`,
            });
          } else {
            hasValidLinkage = true;
          }
        }

        if (s.sourceRefs !== undefined) {
          if (!Array.isArray(s.sourceRefs) || s.sourceRefs.length === 0 || !s.sourceRefs.every((ref) => typeof ref === 'string' && ref.trim() !== '')) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
              errorMessage: `${prefix}: 'sourceRefs' must be an array of non-empty strings.`,
            });
          } else {
            hasValidLinkage = true;
          }
        }

        if (!hasValidLinkage) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT,
            errorMessage: `${prefix} must specify non-empty 'supportingObservationRefs', 'supportingObservationIds', or 'sourceRefs' array.`,
          });
        }

        if (s.notes !== undefined && (typeof s.notes !== 'string' || s.notes.trim() === '')) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT,
            errorMessage: `${prefix}: 'notes', if provided, must be a non-empty string.`,
          });
        }

        if (s.reason !== undefined && (typeof s.reason !== 'string' || s.reason.trim() === '')) {
          errors.push({
            errorCode: VALIDATION_ERROR_CODES.INVALID_ACCEPTED_SUPPORT,
            errorMessage: `${prefix}: 'reason', if provided, must be a non-empty string.`,
          });
        }
      }
    }
  }

  // Proposals validation (HIGH 2: Ground every development durable mutation)
  if (envelope.proposals !== undefined) {
    if (!Array.isArray(envelope.proposals)) {
      errors.push({
        errorCode: VALIDATION_ERROR_CODES.INVALID_ENVELOPE,
        errorMessage: "'proposals' must be an array if provided.",
      });
    } else {
      for (let i = 0; i < envelope.proposals.length; i++) {
        const p = envelope.proposals[i];
        const prefix = `DevelopmentProposal[${i}]`;

        if (!p || typeof p !== 'object' || Array.isArray(p)) {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_ENVELOPE, errorMessage: `${prefix} must be an object.` });
          continue;
        }

        if (!p.targetId || typeof p.targetId !== 'string' || p.targetId.trim() === '') {
          errors.push({ errorCode: VALIDATION_ERROR_CODES.INVALID_IDENTITY, errorMessage: `${prefix} must specify valid accepted 'targetId'.` });
        }

        // Reject unknown proposal keys
        for (const key of Object.keys(p)) {
          if (!DEVELOPMENT_PROPOSAL_KEYS.includes(key)) {
            errors.push({
              errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
              errorMessage: `${prefix}: Unknown or unauthorized proposal key '${key}'.`,
            });
          }
        }

        // Check for unauthorized one-pass fields inside proposal
        for (const key of Object.keys(p)) {
          if (key === 'targetId') continue;
          const auth = validateWriterAuthority(key, WRITERS.DEVELOPMENT);
          if (!auth.valid) {
            if (key === 'facts' && typeof p[key] === 'object' && p[key] !== null) {
              for (const factKey of Object.keys(p.facts)) {
                if (factKey === 'source' || factKey === 'operation') continue;
                const factAuth = validateWriterAuthority(factKey, WRITERS.DEVELOPMENT);
                if (!factAuth.valid) {
                  errors.push({ errorCode: VALIDATION_ERROR_CODES.WRONG_WRITER, errorMessage: `${prefix}.facts: ${factAuth.error}` });
                }
              }
            } else {
              errors.push({ errorCode: VALIDATION_ERROR_CODES.WRONG_WRITER, errorMessage: `${prefix}: ${auth.error}` });
            }
          }
        }

        // Validate durable fields with HIGH 2 grounding checks
        if (p.relationshipDynamic !== undefined) {
          const isGrounded = isFieldSupportedBySupportProposals(envelope.supportProposals, p.targetId, 'relationshipDynamic');
          validateScalarDurableField(p.relationshipDynamic, 'relationshipDynamic', RELATIONSHIP_DYNAMIC_ALLOWED_KEYS, prefix, errors, isGrounded);
        }
        if (p.canonicalAppearance !== undefined) {
          const isGrounded = isFieldSupportedBySupportProposals(envelope.supportProposals, p.targetId, 'canonicalAppearance');
          validateScalarDurableField(p.canonicalAppearance, 'canonicalAppearance', CANONICAL_APPEARANCE_ALLOWED_KEYS, prefix, errors, isGrounded);
        }
        if (p.personality !== undefined) {
          const isGrounded = isFieldSupportedBySupportProposals(envelope.supportProposals, p.targetId, 'personality');
          validatePersonalityField(p.personality, prefix, errors, isGrounded);
        }
        if (p.behavioralProfile !== undefined) {
          const isGrounded = isFieldSupportedBySupportProposals(envelope.supportProposals, p.targetId, 'behavioralProfile');
          validateScalarDurableField(p.behavioralProfile, 'behavioralProfile', BEHAVIORAL_PROFILE_ALLOWED_KEYS, prefix, errors, isGrounded);
        }
        if (p.speech !== undefined) {
          const isGrounded = isFieldSupportedBySupportProposals(envelope.supportProposals, p.targetId, 'speech');
          validateScalarDurableField(p.speech, 'speech', SPEECH_ALLOWED_KEYS, prefix, errors, isGrounded);
        }
        if (p.mannerisms !== undefined) {
          const isGrounded = isFieldSupportedBySupportProposals(envelope.supportProposals, p.targetId, 'mannerisms');
          validateMannerismsField(p.mannerisms, prefix, errors, isGrounded);
        }
        if (p.appearanceForms !== undefined) {
          const isGrounded = isFieldSupportedBySupportProposals(envelope.supportProposals, p.targetId, 'appearanceForms');
          validateAppearanceFormsField(p.appearanceForms, prefix, errors, isGrounded);
        }
        if (p.importantMemories !== undefined) {
          const isGrounded = isFieldSupportedBySupportProposals(envelope.supportProposals, p.targetId, 'importantMemories');
          validateImportantMemoriesField(p.importantMemories, prefix, errors, isGrounded);
        }
        if (p.nonPlayerRelationships !== undefined) {
          const isGrounded = isFieldSupportedBySupportProposals(envelope.supportProposals, p.targetId, 'nonPlayerRelationships');
          validateNonPlayerRelationshipsField(p.nonPlayerRelationships, prefix, errors, isGrounded);
        }
        if (p.facts !== undefined) {
          validateFactsField(p.facts, prefix, errors, p.targetId, envelope.supportProposals);
        }

        const INDIVIDUAL_FACT_FIELDS = ['role', 'species', 'background', 'actualAge', 'apparentAge', 'birthday'];
        for (const factField of INDIVIDUAL_FACT_FIELDS) {
          if (p[factField] !== undefined) {
            const isGrounded = isFieldSupportedBySupportProposals(envelope.supportProposals, p.targetId, factField) ||
                               isFieldSupportedBySupportProposals(envelope.supportProposals, p.targetId, 'facts');
            if (typeof p[factField] === 'object' && p[factField] !== null) {
              for (const key of Object.keys(p[factField])) {
                if (!['value', 'operation', 'source'].includes(key)) {
                  errors.push({
                    errorCode: VALIDATION_ERROR_CODES.UNKNOWN_KEY,
                    errorMessage: `${prefix}.${factField}: Unknown key '${key}'. Allowed: value, operation, source.`,
                  });
                }
              }
              if (p[factField].operation !== undefined && !SCALAR_OPERATIONS.includes(p[factField].operation)) {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.INVALID_OPERATION,
                  errorMessage: `${prefix}.${factField}: Invalid operation '${p[factField].operation}'. Allowed: ${SCALAR_OPERATIONS.join(', ')}.`,
                });
              }
              if (p[factField].source !== undefined) {
                const srcVal = validateSourceReference(p[factField].source, { writer: WRITERS.DEVELOPMENT });
                if (!srcVal.valid) {
                  errors.push({ errorCode: srcVal.errorCode, errorMessage: `${prefix}.${factField}.source: ${srcVal.errorMessage}` });
                } else {
                  const permVal = validateSegmentFieldPermission(p[factField].source, factField);
                  if (!permVal.valid) {
                    errors.push({
                      errorCode: permVal.unsupportedSegment
                        ? VALIDATION_ERROR_CODES.UNSUPPORTED_STRUCTURED_SEGMENT
                        : VALIDATION_ERROR_CODES.STRUCTURED_AUTHORITY_VIOLATION,
                      errorMessage: `${prefix}.${factField}.source: ${permVal.error}`,
                    });
                  }
                }
              }

              if (typeof p[factField].value !== 'string' || p[factField].value.trim() === '') {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
                  errorMessage: `${prefix}.${factField}.value must be a non-empty string.`,
                });
              }

              if (p[factField].source === undefined && !isGrounded) {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
                  errorMessage: `${prefix}.${factField}: Proposed durable mutation must carry valid source evidence or explicit supportProposal (C03, C08).`,
                });
              }
            } else if (typeof p[factField] === 'string') {
              if (p[factField].trim() === '') {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
                  errorMessage: `${prefix}.${factField} string cannot be empty.`,
                });
              } else if (!isGrounded) {
                errors.push({
                  errorCode: VALIDATION_ERROR_CODES.INVALID_SOURCE_REFERENCE,
                  errorMessage: `${prefix}.${factField}: String durable fact must be grounded via explicit supportProposal (C03, C08).`,
                });
              }
            } else {
              errors.push({
                errorCode: VALIDATION_ERROR_CODES.UNAUTHORIZED_FIELD,
                errorMessage: `${prefix}.${factField} must be a string or object.`,
              });
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
