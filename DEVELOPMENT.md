# NPC State Alpha — Development

## Baseline & Repository State

* **Accepted S0 Parent Commit:** `643709982698ec44d20f6b5929c583125d57eaa3` ("docs: record Alpha S0 baseline")
* **Foundation Documents:**

  * `AGENTS.md` — repository agent instructions
  * `docs/core-contract.md` — canonical behavior specification
  * `docs/SOL-WORKPLAN.md` — implementation sequence, evidence, and completion criteria
  * `UPDATE-HANDOFF.md` — bounded development-record amendment work order
  * `LICENSE` — GNU General Public License v3.0
* **Foundation Amendment:** Development-record amendment incorporated on 9 September 2026.
* **Nested Instructions:** No nested `AGENTS.md` or additional repository instruction files currently apply.
* **Scaffolding:** S1 contract package and acceptance test suite established (`src/contract/`, `tests/`, `scripts/validate.js`). No S2+ runtime implementation, storage engine, settings implementation, or UI has been established yet.

## License & Provenance Status

* The repository is licensed under the GNU General Public License v3.0 (`LICENSE`).
* No Alpha runtime/source code has been ported or copied from `npc_state_beta` or legacy reference repositories as of the completion of the foundation amendment.
* Any later source reuse must follow the provenance, dependency-tracing, adaptation, and licensing requirements defined by `AGENTS.md`, `docs/core-contract.md`, and `docs/SOL-WORKPLAN.md`.

## Commands, Namespace & Version Decisions

* **Package Version:** `0.1.0` declared in `package.json` (ES Module, Node >= 22.0.0, zero external runtime dependencies).
* **Runtime Namespace:** `npc_state_alpha.v1`
* **Test / Validation Commands:**
  * `npm test` — Executes the deterministic test runner using Node built-in `node --test tests/**/*.test.js`.
  * `npm run validate` — Executes `node scripts/validate.js` verifying module imports, C02 coverage, wire versions, and production example parsing.
* **CI / Workflows:** None established yet.

## Implementation Status

* **S0 — Foundation Baseline:** Complete.
* **Foundation Development-Record Amendment:** Incorporated into foundation documentation (commit `9a92e82`).
* **S1 — Contracts and Executable Acceptance Fixtures:** Complete and accepted.
  * **Final independent acceptance review:** PASS — High: 0; Medium: 0; Low: 0; npm test: 185 passed, 0 failed; npm run validate: 19 checks passed, 0 errors; S2 had not started at acceptance.
  * Canonical field and authority registry derived from C02 covering all 38 canonical fields, including separated personality facets (`personality`, `behavioralProfile`, `speech`, `mannerisms`), strictly Runtime-owned bookkeeping (`acceptedSupport`, `reviewReceipts`), and Runtime manual corrections access (`manualCorrections`) (`src/contract/registry.js`).
  * Wire schemas, constants, and structured segment permission firewall (`src/contract/wire-schemas.js`), enforcing narrative-only relationship scoring, strict key allowlists, and persisted C08 record schemas.
  * Audit operation masks and field-level outcome definitions (`src/contract/audit-modes.js`), with operation-specific field eligibility validation rejecting unknown operations.
  * One-pass trailer extraction parser (with narrative transport exclusion) and strict raw development-response parser (`src/contract/parser.js`).
  * Production contract validator for one-pass and development envelopes (`src/contract/validator.js`), enforcing canonical immediate types, evidence grounding for all immediate and durable mutations, reserved source refs, copy linkage preservation, receipt subset restrictions, and C08 support/observation reference consistency.
  * Literal production wire examples verified through actual parser and validator (`src/contract/examples.js`).
  * Focused executable acceptance fixtures (`tests/fixtures/*.js`).
  * Full deterministic behavioral and contract test suite across 10 test files (`tests/*.test.js`).
* **S2 and later implementation stages:** Not started. No state storage, commit coordinator runtime, background queue, provider integration, host UI, or import engine has been created.
