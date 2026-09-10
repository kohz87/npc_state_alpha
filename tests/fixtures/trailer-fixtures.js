/**
 * Acceptance Fixtures for NPC State Alpha Trailer Parsing & Extraction
 *
 * Implements test fixtures required by S1 workplan:
 * - Clean narrative + exact single trailer at the end
 * - Missing machine trailer
 * - Duplicate machine trailer
 * - Truncated machine trailer
 * - Trailer not at end (trailing narrative text)
 * - Malformed JSON inside trailer
 * - Trailer self-citation in excerpt (transport exclusion violation)
 */

import {
  TRAILER_TAG_OPEN,
  TRAILER_TAG_CLOSE,
  ALPHA_ONE_PASS_WIRE_VERSION,
} from '../../src/contract/wire-schemas.js';

export const validTrailerText = `The tavern door creaked open, admitting a gust of chilly wind and rain.

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  "proposals": [
    {
      "id": "npc_barkeep_01",
      "mood": "annoyed"
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

export const missingTrailerText = `The tavern door creaked open, admitting a gust of chilly wind and rain. The fire sputtered in the grate as patrons huddled together.`;

export const duplicateTrailerText = `The storm raged outside.

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  "proposals": []
}
${TRAILER_TAG_CLOSE}

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  "proposals": []
}
${TRAILER_TAG_CLOSE}`;

export const truncatedTrailerText = `The storm raged outside.

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  "proposals": [
    {
      "id": "npc_101"`;

export const trailerNotAtEndText = `The storm raged outside.

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  "proposals": []
}
${TRAILER_TAG_CLOSE}

And then the cloaked traveller whispered a final warning before vanishing.`;

export const malformedJsonTrailerText = `The storm raged outside.

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  proposals: [ unquoted_bad_json }
}
${TRAILER_TAG_CLOSE}`;

export const trailerSelfCitationText = `The stranger spoke softly.

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  "proposals": [
    {
      "id": "npc_stranger_01",
      "relationshipEvaluation": {
        "shifted": false,
        "source": {
          "sourceRef": "current:assistant",
          "excerpt": "The story ended with <npc_state_alpha_v1> transport marker."
        }
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`;
