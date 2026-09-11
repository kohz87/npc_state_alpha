# NPC State Alpha

NPC State Alpha is a SillyTavern continuity extension for roleplay. It keeps a structured per-chat NPC state behind the story, updates immediate scene continuity from finalized assistant messages, and performs durable dossier review asynchronously through a separately selected SillyTavern Connection Manager profile.

Release: **0.1.3**  
Tested host: **SillyTavern 1.18.0**  
Release history: [CHANGELOG.md](CHANGELOG.md)

## What's new in 0.1.3

- **Development profile selector:** Settings now use a real SillyTavern Connection Manager profile dropdown instead of a free-form profile ID field. Supported profiles are listed by Alpha, stale/deleted selections are surfaced explicitly, and the selected profile still owns its provider/model.
- **Portrait-first dossier UI:** The opened dossier now uses a portrait hero, scrollable canonical dossier document, clearer section hierarchy, and a bottom cast rail with search and life/presence filters. The existing Alpha side launcher is unchanged.
- **Scoped Development audit fix:** Recheck Missing and Refresh Dossier can reuse an already-owned broad pending exchange without creating a duplicate pending row, widening into unrelated backlog work, or consuming the broader pending review.
- **Live SillyTavern provenance fix:** Prompt-time transformed `coreChat` messages are mapped back to authoritative `ctx.chat` history using stable host metadata while ambiguous mappings still fail closed.
- **Profile failure clarity:** A saved Development profile that no longer exists reports `development_profile_missing` instead of collapsing into a generic provider failure.

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## Install

1. Build or obtain `npc_state_alpha-0.1.3.zip`.
2. Back up important SillyTavern chats before installing or migrating continuity data.
3. Install/extract the ZIP so the extension directory is `npc_state_alpha` and contains `manifest.json` at its root.
4. Reload SillyTavern.
5. Click the **NPC State α** button near the bottom-right, then open **Settings**. Settings are available before opening a chat; dossiers and review actions require a character or group chat.
6. Under Development Review, choose a **Development connection profile** from the SillyTavern Connection Manager profile selector and click **Save Settings**.

The release ZIP contains only the browser runtime. Tests, benchmark scripts, repository documentation, local logs, credentials, SillyTavern profiles, and chat data are not included.

To verify a locally built archive, compare it with `npc_state_alpha-0.1.3.zip.sha256` produced by `npm run package`.

## Upgrade from earlier Alpha versions

Alpha 0.1.3 keeps the accepted canonical namespace `npc_state_alpha.v1` and storage schema version `1`. It introduces no Alpha persistence-schema migration. Updating the extension code therefore leaves existing canonical per-chat Alpha state in place.

After upgrading, reload SillyTavern and confirm that dossiers, relationships, locks/corrections, pending Development state, and the selected Development connection profile are still present. Do not delete chat metadata as part of an extension upgrade.

If a previously saved Development profile has been deleted or renamed in SillyTavern, Alpha keeps the stale selection visible as unavailable until you choose a valid profile and save Settings.

## Immediate and Development lanes

**Immediate** is foreground continuity. It uses the user's normal active SillyTavern roleplay connection/model. The assistant may append one machine trailer to a finalized reply; Alpha validates it, verifies exact source ownership, and commits only Immediate-owned state such as presence, current activity/status, current presentation/form selection, lifecycle/death, and numeric player relationship evaluation.

**Development** is asynchronous durable dossier review. It uses `developmentConnectionProfile`, selected through Alpha's Settings from SillyTavern Connection Manager profiles. That profile owns its provider and model. Alpha does not hardcode Gemini, OpenAI, or any other Development model, and changing the Development profile does not change Immediate routing.

Provider failure does not block foreground roleplay. Failed Development work remains recoverable and does not automatically spin in an unbounded retry loop.

## Dossiers and relationships

The dossier exposes canonical identity/lifecycle, immediate live state, durable Development fields, established forms, Development observations/support/receipts, and pending status.

The 0.1.3 dossier presentation is portrait-first: the selected NPC has a large hero area, the canonical dossier remains a scrollable document, and the bottom cast rail provides search plus life-state and presence filtering. These are presentation changes only; Alpha's canonical state and field ownership rules are unchanged.

Player relationship mechanics have four independent numeric axes:

- Trust
- Affection
- Desire
- Tension

Relationship scoring is runtime-owned and deterministic. Development may describe `Relationship Dynamic`, but it cannot write numeric relationship axes.

## Corrections, locks, and controls

Manual corrections use Alpha's normal atomic commit path. A correction does not automatically lock a field. Locks are explicit and prevent later automatic writers from changing that field until unlocked.

Development controls include Review Pending, Retry Failed, Recheck Missing Details, and Refresh Dossier. These operate only on already-owned evidence and do not create a second scanner or bypass source validation.

In 0.1.3, Recheck Missing and Refresh Dossier remain one-shot scoped audits even when their evidence is also represented by a broader pending Development row. The broader pending work is preserved rather than duplicated or silently drained.

## History, edits, deletions, and swipes

Alpha stores bounded full-state checkpoints and exact source/identity replay metadata. Edits, deletions, and swipes reconstruct the selected canonical branch through the same parser, source resolver, identity rules, field application, relationship mechanics, and CommitCoordinator used by normal operation.

User-owned tombstones, locks, and corrections remain authoritative during reconstruction. Automatic narrative resurrection remains forbidden; correction or rollback to surviving pre-death history may restore a living state.

## Native Alpha portability

Native portable state uses:

- format: `npc_state_alpha.native_state`
- format version: `1`
- canonical state namespace: `npc_state_alpha.v1`
- state schema version: `1`

Native serialization is deterministic for the same state. Parsing validates the envelope and canonical state and rejects unsupported versions, malformed state, and values that would not round-trip losslessly through JSON.

A native bundle preserves only information already present in canonical Alpha state. It does not fabricate message provenance, history, relationship reasons, checkpoints, observations, or support. Parsing a native bundle does **not** automatically install it into a live chat. A live restore must verify authoritative host history or establish the format-neutral `import_baseline` boundary.

Alpha 0.1.3 exposes the native portability functions through its runtime API; it does not add an automatic restore/file-picker workflow.

## Legacy NPC State Beta compatibility

Alpha 0.1.3 supports one deliberately narrow legacy input:

- NPC State Beta application version: **0.4.44**
- Beta source commit: `a34f5f27385b6fba75b8ff5832015ba66ea4d0c2`
- bundle format: `npc_state_v3_bundle`
- bundle format version: `1`
- Beta dossier schema version: `1`
- authoritative Beta owners: `v03/bundle.js` and `v03/schema.js`

Compatibility is implemented as an Alpha-owned clean-room adapter. Alpha has no runtime dependency on Beta and never scans Beta storage automatically.

### What is imported

Where represented safely, the v0.4.44 adapter preserves stable NPC IDs, canonical names/aliases, alive/dead lifecycle, current presence, current mood/location/goal/status, role/species, age fields/birthday, canonical appearance, named appearance forms/current form, personality, behavior profile, speech, mannerisms, background, current numeric player relationship values, `relationshipSummary` as Alpha `Relationship Dynamic`, memories, importance, and stable-ID social/family relationships.

### What is deliberately not invented

Beta relationship history/evidence/milestones, profile-evolution evidence, source message references, relationship reasons, manual-profile markers, legacy portrait objects, suppressed-name data, and deleted-ID history are not promoted into Alpha provenance/history/locks/corrections/observations/support when Alpha cannot represent their authority safely. The migration preview reports omitted material.

`worldActive` is not treated as Alpha `activeInExchange`. Beta lifecycle `unknown` is rejected rather than guessed as alive or dead. Unresolved family/member names are not cross-NPC matched by name alone.

### Import safety

Legacy import is explicit and user initiated. The adapter exports preview, conversion, and installation functions through Alpha's runtime API. It does not auto-enable itself at startup and does not modify the source Beta bundle/database/profile.

Installation requires:

1. an empty Alpha target state,
2. explicit confirmation `IMPORT_BETA_V044_INTO_EMPTY_ALPHA`, and
3. either the current verified canonical host history boundary or an explicit assertion that the target chat history is genuinely empty.

Successful installation establishes the normal `import_baseline`. Automatic reconstruction cannot cross into untrusted pre-import history. Existing Alpha state is never silently name-merged or overwritten.

### Unsupported Beta 0.5.38

**Beta 0.5.38 is not supported for migration.** At Beta commit `044cd42effa5c80a2e5f0facc6deeffa106ade01`, the canonical bundle creator emits `appVersion: 0.5.38`, while the corresponding canonical bundle parser accepts only 0.3.x or 0.4.x for that v3-compatible bundle schema. Alpha therefore rejects 0.5.38 instead of guessing or repairing its schema.

Back up Beta data before any migration. Alpha does not mutate source Beta data.

## Settings and troubleshooting

Version 0.1.3 adds a real Development Connection Manager profile selector. If the selector is empty, verify that SillyTavern has at least one supported Connection Manager profile. Refocus the selector after creating one. If a saved profile was deleted, Alpha shows it as unavailable rather than silently switching providers.

Version 0.1.2 improved panel readability with an opaque dark background, explicit control colors, 15px body text, larger spacing, responsive layout, and visible keyboard focus. Version 0.1.3 retains those readability constraints while replacing the opened dossier composition with the portrait-first layout.

Version 0.1.1 renamed the local message-content hashing module to `content-hash.js` after a browser filter blocked its former filename. If upgrading after `ERR_BLOCKED_BY_CLIENT`, update the extension and hard-reload SillyTavern with Ctrl+Shift+R. Hash values, chat state, and settings are preserved.

If Alpha reports a competing automatic owner, disable either Alpha or NPC State Beta's automatic ownership and reload. Alpha deliberately avoids two automatic continuity writers operating at once.

If Development is paused, verify that Development is enabled and that `developmentConnectionProfile` refers to an existing SillyTavern Connection Manager profile. A missing/deleted profile reports `development_profile_missing`; Alpha does not silently fall back to the foreground model.

If a model response has a missing or malformed Alpha trailer, the story text remains intact and state is not partially mutated. Retry Immediate reparses only the exact current failed message and does not substitute new story text.

For history errors around imported data, do not bypass `import_baseline`. Older chat history that cannot be proven must not be reconstructed automatically.

## Privacy and data handling

Alpha stores canonical continuity in the SillyTavern chat metadata boundary used by the extension. It does not introduce an always-on server, external database, background telemetry service, or credential store. Development requests use the selected SillyTavern connection profile. Profile discovery exposes only bounded profile metadata needed by the selector; Alpha does not copy Connection Manager credentials into its settings. Bounded diagnostics avoid recording full narration/prompts or provider credentials by default.

## Development and release verification

Requires Node.js 22 or newer. The repository has no external runtime dependencies.

```text
npm test
npm run validate
npm run measure:prompts
npm run measure:performance
npm run package
git diff --check
```

`npm run package` produces the installable `dist/` tree plus a deterministic `release/npc_state_alpha-0.1.3.zip` and SHA-256 sidecar. GitHub CI runs the deterministic repository gates without provider credentials, production SillyTavern data, or Beta user data.

See [CHANGELOG.md](CHANGELOG.md) for release history, `docs/core-contract.md` for canonical behavior authority, and `DEVELOPMENT.md` for staged engineering evidence.
