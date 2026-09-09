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
* **Scaffolding:** Foundation documentation only. No S1 runtime implementation, wire schemas, manifests, settings implementation, or test suite has been established yet.

## License & Provenance Status

* The repository is licensed under the GNU General Public License v3.0 (`LICENSE`).
* No Alpha runtime/source code has been ported or copied from `npc_state_beta` or legacy reference repositories as of the completion of the foundation amendment.
* Any later source reuse must follow the provenance, dependency-tracing, adaptation, and licensing requirements defined by `AGENTS.md`, `docs/core-contract.md`, and `docs/SOL-WORKPLAN.md`.

## Commands, Namespace & Version Decisions

* **Package Version:** None implemented yet. No `package.json` exists. The core contract currently specifies an initial usable release target of `0.1.0`, subject to verification against the repository state when packaging/release work begins.
* **Runtime Namespace:** None implemented yet.
* **Build / Test Commands:** None established yet. No build tooling, package scripts, or test suite exists.
* **CI / Workflows:** None established yet.

## Implementation Status

* **S0 — Foundation Baseline:** Complete.
* **Foundation Development-Record Amendment:** Incorporated into the current foundation documentation.
* **S1 — Contracts and Executable Acceptance Fixtures:** Not started.
* **S2 and later implementation stages:** Not started.

S1 must begin from the accepted foundation lineage after the development-record amendment is reviewed and committed. It must not be treated as having started merely because the contract, workplan, or amendment documentation defines S1 requirements.
