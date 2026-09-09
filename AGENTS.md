# NPC State Alpha — repository agent instructions

Read `docs/core-contract.md` before architecture, implementation, tests, or maintenance work. It is the canonical behavior specification. Read `DEVELOPMENT.md` when present for executable commands and release procedure. `docs/SOL-WORKPLAN.md` is an implementation sequence, not a competing behavior contract.

**Before work**

- Follow the current user's scope and authorization. This file does not independently authorize publishing, messages, database changes, or destructive actions.
- Inspect current remote HEAD, branch, working-tree changes and applicable nested instructions. Preserve unrelated work.
- Revalidate reported bugs and historical reference findings against current code.
- Inspect execution tools and ordinary CI early. Missing execution does not prevent authorized implementation, tests, documentation or reviewable commits.
- If an intentional behavior change is authorized, update the core contract and affected tests together. Do not silently reinterpret the contract or append a competing rule elsewhere.

**Architecture discipline**

- Maintain two extraction paths: immediate one-pass scene updates and asynchronous focused development review. Both use one validator/application/commit boundary.
- Use the ownership matrix and source rules in the core contract. No field has two automatic writers. Explicit repair/reconciliation operations use declared authority.
- The model interprets narrative semantics; runtime owns sources, structure, permissions, scoring mechanics, deduplication, scheduling, persistence and history safety.
- Routine operations are delta-oriented. Missing fields preserve values and do not prove unchanged, insufficient, absent, or fully evaluated.
- Background review never owns immediate presence, live state, numeric relationship scoring, or lifecycle transitions.
- Keep terminal automatic death, with explicit user correction and owned-history rollback distinct from narrative resurrection.
- New NPC review, queued evidence ownership, concurrent commits and checkpoint behavior must follow the core contract. Do not hold storage locks while waiting for a provider.
- Keep per-NPC development records within the shared state/history system. Follow C08–C13 for evidence retention, selective review and accepted-state injection; do not create another memory service or promote observations by counts.
- Optional structured-source adapters follow C03 field permissions. They cannot broaden automatic authority or turn repeated summaries into independent evidence.
- Reuse verified runtime subsystems selectively. Trace transitive dependencies and adapt them to Alpha's contract before porting.
- No runtime import, fetch or build dependency on Beta or the legacy repository. Keep required licenses and attribution from reused source.
- Do not copy the whole Beta engine or legacy prompt system and wrap it in a new facade.

**Lean code and contracts**

- Maintain one field/authority registry, one wire-contract owner, one settings registry, one source resolver and one commit coordinator.
- Derive validation, operation permissions, examples and diagnostics from these owners where practical.
- Separate focused modules by real responsibility. Do not create empty framework layers or split trivial functions solely to match a suggested directory tree.
- Remove superseded implementations and verified unused hooks with their callers/tests. Do not keep legacy folders or compatibility shims for hypothetical consumers.
- Preserve functional manual-deletion tombstones, replay protection, correction ownership and rollback metadata. These protect current behavior.
- Support only documented Alpha formats and deliberately selected import formats. Compatibility belongs at an explicit boundary, not throughout the runtime.
- Never replace semantic interpretation with NPC-specific exceptions, keyword death rules, stopword/synonym grounding, lexical role assignment or encounter-count habit rules.
- Exact identifier/quote matching, structural parsing and retrieval prioritization are mechanical tools, not semantic proof.

**Tests and execution**

- Use the existing host/storage simulation approach where useful, adapted to Alpha. Tests must not touch a real user's sidecar.
- Test application, event ordering, request counts, persistence and rollback, including delayed promises and concurrent state changes.
- Test prompt examples through the production parser and relevant validators. Prompt text assertions alone do not prove behavior.
- Mocked responses prove deterministic handling, not live model extraction, provider latency or real host integration.
- Run applicable checks and release gates when execution exists. Otherwise inspect CI for the exact final commit and label executed, CI-verified and unrun checks accurately.
- Do not create temporary workflows, empty commits or bypasses solely to obtain execution. Use ordinary CI.
- Re-test to resolve concrete risks, not to repeat an unchanged test suite without purpose.

**Release and completion**

- Keep Alpha's namespace, settings, storage and installation identity separate from Beta.
- Never automatically import, reset, rebuild, overwrite or delete a user's existing NPC database.
- Do not enable competing Alpha and Beta automatic writers silently.
- Before a release, verify the exact candidate tree, package contents, dependency reachability and current remote state. Follow repository protections; never force-push over unrelated work.
- Lack of required release verification leaves publication pending; finish other authorized work and identify the blocker.
- Report actual changes, version/commit, checks, performance evidence and material limits. Do not call a scaffold a working extension or estimated prompt savings a measured reasoning improvement.
