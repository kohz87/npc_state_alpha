# Changelog

All notable user-facing changes to NPC State Alpha are documented here.

The project uses semantic versioning for application releases. Canonical Alpha state, native bundle, and model wire versions are versioned separately and are not implied by the application version.

## [Unreleased]

No unreleased changes yet.

## [0.1.3] - 2026-09-11

### Added

- Added a real SillyTavern Connection Manager profile selector for Development review. The selector lists supported profiles, shows useful profile/model labels, refreshes when focused, preserves the selected profile ID, and clearly marks a saved profile that no longer exists.
- Added a portrait-first dossier presentation inspired by NPC State Beta 0.5.x while keeping Alpha's existing side launcher and canonical runtime architecture.
- Added a bottom cast rail with NPC search, life-state filtering, presence filtering, portrait tiles, and status indicators.

### Changed

- Reworked the opened dossier interface around a large portrait hero, a scrollable canonical dossier document, clearer section hierarchy, theme-aware surfaces, and responsive layout.
- Recheck Missing and Refresh Dossier now dispatch only the intended scoped manual audit instead of widening into unrelated Development backlog work.
- Development profile discovery exposes only bounded UI metadata such as profile ID, name, API, and model. Credentials and unrelated profile fields are not copied.

### Fixed

- Fixed live SillyTavern generation capture when prompt-time `coreChat` content differs from canonical `ctx.chat` because of host transformations. Alpha now binds the projected current user message back to authoritative chat history using stable host metadata while remaining fail-closed on ambiguous mappings.
- Fixed `Duplicate pending review entry` failures when a newly admitted NPC already has a broad pending Development entry for the same exchange.
- Fixed scoped Recheck Missing and Refresh Dossier so they can reuse an owned broad pending exchange as provenance without consuming, duplicating, or poisoning that broader pending row.
- Fixed stale or deleted Development profile IDs being reported as a generic provider failure. They now surface as `development_profile_missing` with the useful host detail retained.
- Fixed stale-profile guidance so a missing saved profile is explained specifically even when the host currently reports zero supported profiles.

### Compatibility

- Application version is `0.1.3`.
- Canonical state remains `npc_state_alpha.v1`, schema version `1`.
- Native bundle format remains `npc_state_alpha.native_state`, format version `1`.
- Immediate and Development wire versions remain `1`.
- No persistence-schema or native-format migration is required from 0.1.2.

## [0.1.2] - 2026-09-11

### Changed

- Replaced the compressed global UI styling with scoped Alpha styles for substantially better readability.
- Added opaque panel surfaces, explicit control foreground/background colors, larger body/helper text, clearer spacing, focus outlines, button states, and responsive layout.
- Split branding/close controls from navigation and review actions.
- Added clearer dossier counts, status badges, empty states, and settings labels.

### Fixed

- Added a safe no-chat onboarding state. Dossier/review actions are disabled when no character or group chat is open, while Settings remain available.
- Prevented no-chat UI interactions from attempting storage or provider operations.

### Compatibility

- Application version is `0.1.2`.
- Canonical state/native/wire versions remain unchanged.

## [0.1.1] - 2026-09-11

### Fixed

- Renamed the local message-content hashing module from the browser-blocked `fingerprint.js` path to `content-hash.js` after `ERR_BLOCKED_BY_CLIENT` prevented the extension module graph from loading.
- Preserved the hashing implementation and exported function behavior so stored source fingerprints and history identity remain compatible.

### Compatibility

- Application version is `0.1.1`.
- Canonical state/native/wire versions remain unchanged.

## [0.1.0] - 2026-09-11

### Added

- Initial NPC State Alpha release.
- Foreground Immediate continuity capture from finalized SillyTavern assistant messages with strict trailer parsing, exact source ownership, omission semantics, replay protection, and fail-closed persistence.
- Asynchronous Development review through an independently selected SillyTavern Connection Manager profile.
- Canonical per-chat NPC dossiers with immediate state, durable Development fields, appearance/forms, lifecycle, observations/support/receipts, and user-owned corrections/locks.
- Deterministic Trust, Affection, Desire, and Tension relationship mechanics.
- History reconstruction for edits, deletions, swipes, branch changes, and delayed Development work.
- Alpha-native deterministic portability using `npc_state_alpha.native_state` format version `1`.
- Narrow, explicit legacy migration support for NPC State Beta 0.4.44 bundles only.
- Deterministic test, validation, prompt-measurement, performance/endurance, packaging, and CI release gates.

### Compatibility

- Tested host baseline: SillyTavern 1.18.0.
- Canonical state namespace: `npc_state_alpha.v1`, schema version `1`.
- Native bundle format: `npc_state_alpha.native_state`, format version `1`.
- NPC State Beta 0.5.38 migration is intentionally unsupported.
