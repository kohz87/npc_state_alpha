# NPC State Alpha — Development

## Baseline & Repository State

* **Accepted S0 Parent Commit:** `643709982698ec44d20f6b5929c583125d57eaa3` ("docs: record Alpha S0 baseline")
* **Accepted S1 Parent Commit:** `3faf2a4f9d92e43f2b9352b4ba2088d6ce201da4` ("contract: complete S1 acceptance package and tests")
* **Current Working Branch:** `work/57dc45b6-s2-runtime`
* **Foundation Documents:**

  * `AGENTS.md` — repository agent instructions
  * `docs/core-contract.md` — canonical behavior specification
  * `docs/SOL-WORKPLAN.md` — implementation sequence, evidence, and completion criteria
  * `UPDATE-HANDOFF.md` — bounded development-record amendment work order
  * `LICENSE` — GNU General Public License v3.0
* **Foundation Amendment:** Development-record amendment incorporated on 9 September 2026.
* **Nested Instructions:** No nested `AGENTS.md` or additional repository instruction files currently apply.
* **Scaffolding:** S1 contract package (`src/contract/`), S2 shared runtime engine (`src/state/`, `src/runtime/`), acceptance test suite (`tests/`), and validation script (`scripts/validate.js`). No S3+ host lifecycle hooks, background provider queues, UI, or import engine have been established yet.

## License & Provenance Status

* The repository is licensed under the GNU General Public License v3.0 (`LICENSE`).
* **Port Provenance for S2:** Zero lines of code or fixtures ported from `npc_state_beta` or legacy reference repositories. S2 shared runtime modules (`src/state/` and `src/runtime/`) were implemented 100% natively in Alpha against the core contract (C02–C11) and S1 contracts.
* Any future source reuse must follow the provenance, dependency-tracing, adaptation, and licensing requirements defined by `AGENTS.md`, `docs/core-contract.md`, and `docs/SOL-WORKPLAN.md`.

## Commands, Namespace & Version Decisions

* **Package Version:** `0.1.0` declared in `package.json` (ES Module, Node >= 22.0.0, zero external runtime dependencies).
* **Runtime Namespace:** `npc_state_alpha.v1`
* **Storage Schema Version:** `1` (integer)
* **One-Pass Wire Version:** `1` (string)
* **Development Wire Version:** `1` (string)
* **Test / Validation Commands:**
  * `npm test` — Executes the deterministic test runner using Node built-in `node --test tests/**/*.test.js` (300 passing tests: 185 S1 + 115 S2 across 16 test files).
  * `npm run validate` — Executes `node scripts/validate.js` verifying module imports, C02 coverage, wire versions, production example parsing, S2 runtime primitives, and S3+ absence (25 checks passed, 0 errors).
  * `git diff --check` — Final S2 candidate passes with no whitespace errors.
* **CI / Workflows:** None established yet.

## Implementation Status

* **S0 — Foundation Baseline:** Complete.
* **Foundation Development-Record Amendment:** Incorporated into foundation documentation (commit `9a92e82`).
* **S1 — Contracts and Executable Acceptance Fixtures:** Complete and accepted (commit `3faf2a4f9d92e43f2b9352b4ba2088d6ce201da4`).
  * Canonical field and authority registry derived from C02 covering all 38 canonical fields (`src/contract/registry.js`).
  * Wire schemas, constants, and structured segment permission firewall (`src/contract/wire-schemas.js`).
  * Audit operation masks and field-level outcome definitions (`src/contract/audit-modes.js`).
  * One-pass trailer extraction parser and strict development-response parser (`src/contract/parser.js`).
  * Production contract validator for one-pass and development envelopes (`src/contract/validator.js`).
  * Literal production wire examples verified through parser and validator (`src/contract/examples.js`).
  * Focused executable acceptance fixtures (`tests/fixtures/*.js`).
  * Contract and behavioral test suite (`tests/` 10 test files).
* **S2 — Shared Runtime Foundation:** Implemented and verified as the final local S2 candidate.
  * Versioned state schema under `npc_state_alpha.v1` (version 1) representing canonical NPC records with all C02 fields, field revisions, tombstones, dedup keys, pending review ledger, history checkpoints, and C08 development records (`src/state/schema.js`). Hardened validation for root and NPC record keys, all 38 field revisions (strictly positive integers), locks (booleans), manual corrections (structured objects), relationship axes (finite numbers), tombstones, and dedup processed source keys. Strict schema validation for persisted collection items (`appearanceForms`, `importantMemories`, `nonPlayerRelationships`, `mannerisms`, `personality`) rejecting wire metadata and enforcing non-empty string IDs and canonical shapes.
  * Small storage abstraction with deterministic in-memory adapter (`MemoryStorageAdapter`) providing schema validation, CAS revision-safe save/load, failure simulation, and concurrency isolation (`src/state/storage.js`).
  * Checkpoint foundation capturing actual commit-boundary metadata, source dependencies projected to compact descriptors (omitting raw excerpt strings, requiring explicit `capturedProvenance`), full NPC snapshots, and user-owned metadata separation (`src/state/checkpoints.js`).
  * Shared runtime source and evidence resolver enforcing C03 provenance, trailer exclusion from assistant narrative, excerpt verification, segment permissions, and copy/replay metadata handling (`src/runtime/source-resolver.js`). Enforces `validateCapturedSourceDependency` without `expectedOwnership` aliases, and provides `captureScopeDependency` for receipt-only scope resolving without semantic inference or excerpt fabrication. Centralized concrete source reference extraction (`extractConcreteSourceReferences`).
  * Identity and admission primitives supporting stable existing ID lookup, tombstone checks, NEW localRef resolution with locally assigned stable IDs, multi-candidate resolution, collision-safe collection ID generation (`generateCollectionId` retry loop), admission policies, and atomic dependent failure (`src/runtime/identity.js`).
  * Shared field and domain application layer enforcing C02 writer authority in both directions, omission preservation, locks, manual corrections distinction, field revision tracking, transient presentation vs durable appearance, currentForm selector checks (`formId` strictly required), terminal automatic death projection (conditional revision bumps only if values changed), fail-closed collection semantics (replace missing fails closed, add existing fails closed, remove missing returns unapplied, wire metadata stripped from canonical state, NPR replace preserving targetId), and relationship mechanics (preserves numeric/fractional deltas without artificial clamping, explicit zero delta returning `applied: false, reason: 'explicit_zero_shift'`) (`src/runtime/field-applier.js`, `src/runtime/relationship-mechanics.js`).
  * Exactly one shared commit coordinator (`CommitCoordinator`) executing two-phase revalidation against latest state, read-field dependency tracking, field-scoped preservation of unrelated newer live changes, C08 development record resolution (runtime observation IDs with strict localObservationRef resolution, target and base field matching for `supportingObservationIds` and `supportingObservationRefs`, supportProposals converted to Runtime-owned acceptedSupport linking actual committed canonical base-field revisions, verified compact string `sourceRefs` with mechanical segment permission validation and orphan rejection, lock/manual-authority race prevention blocking unapplied support promotion and deferring restricted receipts, normalized `targetAcknowledgments`/`reviewReceipts` bookkeeping, atomic receipt target existence and tombstone checks), fail-closed provenance context requirements (`provenance_context_required`), exact dedup replay detection without state mutation, atomic pre-validation of pending review entries (existence, tombstones, duplicate identity), and atomic CAS persistence with race protection without locks during provider work (`src/runtime/commit-coordinator.js`).
  * Barrel exports established (`src/runtime/index.js`).
  * 6 comprehensive S2 test suites added (`tests/state-storage.test.js`, `tests/source-resolver.test.js`, `tests/identity.test.js`, `tests/field-applier.test.js`, `tests/commit-coordinator.test.js`, `tests/development-record.test.js`).
* **S3 and later implementation stages:** Strictly not started. No host lifecycle hooks, prompt injection, message capture, background provider queue, UI, or import engine have been created.
