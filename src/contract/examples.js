/**
 * NPC State Alpha — Canonical Emitted Wire Examples
 *
 * Single behavior authority: docs/core-contract.md
 *
 * These exact emitted examples are parsed and verified through
 * the actual production parser and validator in S1.
 */

import {
  TRAILER_TAG_OPEN,
  TRAILER_TAG_CLOSE,
  ALPHA_ONE_PASS_WIRE_VERSION,
  ALPHA_DEVELOPMENT_WIRE_VERSION,
} from './wire-schemas.js';

/**
 * Literal minimal empty one-pass envelope as emitted by roleplay model.
 */
export const ONE_PASS_MINIMAL_EMPTY_TEXT = `The campfire crackled quietly under the starlit sky. Neither traveller spoke, content in the peaceful silence of the forest clearing.

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  "proposals": []
}
${TRAILER_TAG_CLOSE}`;

/**
 * Literal populated one-pass envelope demonstrating:
 * - Admission of NEW named and role-label people
 * - Unique localRef assignments (no array-order identity fallback)
 * - Exchange-active NPC with numeric relationship proposal
 * - Exchange-active NPC with explicit zero-relationship evaluation
 * - Live state deltas (omission preserves untouched fields)
 * - Transient currentPresentation with unresolved currentForm
 */
export const ONE_PASS_POPULATED_TEXT = `"Welcome to the Crossed Swords," the gruff barkeep grunted, slamming a wooden mug onto the counter. "Mind the dwarf in the corner—Brom don't take kindly to strangers staring."

A hooded figure near the hearth chuckled softly, adjusting a dark velvet cloak.

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  "proposals": [
    {
      "id": null,
      "localRef": "new:barkeep",
      "name": "Barkeep",
      "identityKind": "role_label",
      "evidence": {
        "sourceRef": "current:assistant",
        "excerpt": "Welcome to the Crossed Swords, the gruff barkeep grunted"
      },
      "present": true,
      "activeInExchange": true,
      "mood": "grumpy",
      "location": "Behind the bar",
      "currentPresentation": "Stained apron over wool tunic, wiping mugs with a coarse rag",
      "relationshipEvaluation": {
        "shifted": true,
        "axes": {
          "trust": 0,
          "affection": 0,
          "desire": 0,
          "tension": 1
        },
        "impact": "minor",
        "axisSupport": {
          "tension": {
            "reason": "Gruff initial greeting with mild guarded tension toward a new patron",
            "source": {
              "sourceRef": "current:assistant",
              "excerpt": "the gruff barkeep grunted, slamming a wooden mug onto the counter"
            }
          }
        }
      }
    },
    {
      "id": null,
      "localRef": "new:brom",
      "name": "Brom",
      "identityKind": "named",
      "evidence": {
        "sourceRef": "current:assistant",
        "excerpt": "Mind the dwarf in the corner—Brom don't take kindly to strangers staring"
      },
      "present": true,
      "activeInExchange": false,
      "location": "Corner table",
      "status": "Drinking alone, watching warily"
    },
    {
      "id": "npc_hooded_stranger_01",
      "name": "Hooded Figure",
      "present": true,
      "activeInExchange": true,
      "currentPresentation": "Dark velvet travel cloak, silver clasp glinting in firelight",
      "currentForm": null,
      "relationshipEvaluation": {
        "shifted": false,
        "reason": "Amused chuckle without any relational alignment shift toward player",
        "source": {
          "sourceRef": "current:assistant",
          "excerpt": "A hooded figure near the hearth chuckled softly"
        }
      },
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "A hooded figure near the hearth chuckled softly, adjusting a dark velvet cloak."
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

/**
 * Literal raw development review response text as emitted by model, demonstrating:
 * - Scoped review receipts including target/no-op receipts (reviewed_no_proposals)
 * - Explicitly restricted fieldSubset receipt ('restricted: true')
 * - Direct durable facts establishment on first contact
 * - C08 observations with localObservationRef and dispositions (tentative, supporting)
 * - Support proposals binding durable fields to local observation refs and sources
 */
export const DEVELOPMENT_REVIEW_RAW_TEXT = `{
  "version": "${ALPHA_DEVELOPMENT_WIRE_VERSION}",
  "reviewReceipts": [
    {
      "targetId": "npc_barkeep_01",
      "sourceScope": [
        "msg:1",
        "msg:2"
      ],
      "status": "reviewed"
    },
    {
      "targetId": "npc_brom_01",
      "sourceScope": [
        "msg:1",
        "msg:2"
      ],
      "status": "reviewed_no_proposals"
    },
    {
      "targetId": "npc_hooded_stranger_01",
      "sourceScope": [
        "msg:1",
        "msg:2"
      ],
      "status": "reviewed",
      "restricted": true,
      "fieldSubset": [
        "personality",
        "canonicalAppearance"
      ]
    }
  ],
  "proposals": [
    {
      "targetId": "npc_barkeep_01",
      "relationshipDynamic": {
        "value": "Guarded tavernkeeper maintaining professional wariness toward armed patrons",
        "source": {
          "sourceRef": "msg:2",
          "excerpt": "Welcome to the Crossed Swords, the gruff barkeep grunted"
        }
      },
      "facts": {
        "role": "Tavernkeeper and proprietor of the Crossed Swords",
        "species": "Human",
        "source": {
          "sourceRef": "msg:2",
          "excerpt": "the gruff barkeep grunted, slamming a wooden mug onto the counter"
        }
      },
      "personality": {
        "traits": [
          "Pragmatic",
          "No-nonsense",
          "Observant"
        ],
        "source": {
          "sourceRef": "msg:2",
          "excerpt": "wiping mugs with a coarse rag"
        },
        "operation": "establish"
      },
      "mannerisms": {
        "value": [
          "Wipes counter continuously with coarse rag when assessing patrons"
        ],
        "source": {
          "sourceRef": "msg:2",
          "excerpt": "wiping mugs with a coarse rag"
        },
        "operation": "establish"
      }
    },
    {
      "targetId": "npc_hooded_stranger_01",
      "canonicalAppearance": {
        "value": "Slender humanoid figure enveloped in high-collared velvet attire",
        "source": {
          "sourceRef": "msg:2",
          "excerpt": "A hooded figure near the hearth chuckled softly, adjusting a dark velvet cloak."
        },
        "operation": "establish"
      }
    }
  ],
  "observations": [
    {
      "localObservationRef": "obs:barkeep:warning",
      "targetId": "npc_barkeep_01",
      "field": "mannerisms",
      "observation": "Warns new customers about volatile regulars immediately upon entry",
      "source": {
        "sourceRef": "msg:2",
        "excerpt": "Mind the dwarf in the corner—Brom don't take kindly to strangers staring"
      },
      "disposition": {
        "role": "supporting",
        "linkedFieldRevision": "rev_barkeep_mannerisms_01"
      }
    },
    {
      "localObservationRef": "obs:stranger:amusement",
      "targetId": "npc_hooded_stranger_01",
      "field": "personality",
      "observation": "Finds tavern tension mildly amusing; does not intervene",
      "source": {
        "sourceRef": "msg:2",
        "excerpt": "A hooded figure near the hearth chuckled softly"
      },
      "disposition": {
        "role": "tentative"
      }
    }
  ],
  "supportProposals": [
    {
      "targetId": "npc_barkeep_01",
      "field": "mannerisms",
      "supportingObservationRefs": [
        "obs:barkeep:warning"
      ],
      "sourceRefs": [
        "msg:2"
      ],
      "notes": "Initial establishment of barkeep traits supported by opening dialogue and actions"
    }
  ]
}`;
