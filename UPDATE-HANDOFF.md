# Sol 5.6 Extra High — apply the development-record amendment

This is a bounded documentation/contract work order, not another architecture specification. The authoritative behavior remains in `docs/core-contract.md`; the existing S0–S10 sequence remains in `docs/SOL-WORKPLAN.md`.

## Scope

Apply the accompanying amended `AGENTS.md`, `docs/core-contract.md` and `docs/SOL-WORKPLAN.md` to the actual `kohz87/npc_state_alpha` working baseline. These are revised planning artifacts, not a checkout of current repository HEAD. Inspect existing files and preserve newer unrelated changes; merge the amendment rather than blindly replacing files. Work in the designated isolated worktree. Do not change canonical main, push, merge, publish, touch Beta or access real NPC databases as part of this handoff.

Read current repository instructions and `DEVELOPMENT.md` first. Follow the user's current stage authorization: if the active task is S1-only, amend executable S1 schemas/registry/examples and relevant contract fixtures only. Do not begin S2 runtime implementation. If no implementation stage is authorized, complete the documentation amendment and report the precise S1 follow-up without treating this handoff as authority to build the whole extension.

## Intended changes

- C03: optional verified structured-source adapters, unchanged source firewall, no double-counting copied event representations.
- C08–C09: persistent per-NPC development records inside existing shared state; observations, dispositions, support links and scoped review progress; safe retention and consolidation.
- C10–C11: immediate availability of accepted background results at the next dispatch; development-record rollback within the existing atomic history model.
- C13: selective observation/comparison context while keeping unexpected durable facts discoverable.
- C16: multi-turn token/cost measurement with matched coverage and backlog.
- Workplan: corresponding S1–S9 deliverables and behavioral fixtures; keep completed stages and S0–S10 numbering.

## Deliberate non-changes

C02 automatic ownership remains unchanged. Relationship Dynamic, role/species/ages/birthday and profile observations remain development-owned. The immediate trailer does not gain durable classification or a second writer. No added model classifier, collector, promotion pass, background summarizer, memory service or always-on server is authorized. The development record is independent of visible Memories, not independent of source ownership or rollback.

## Verification and handoff

Check the amended documents for conflicting authority, receipt/completeness semantics and unsupported adapter claims. When S1 code changes are in scope, validate emitted examples through actual schemas/parsers and run relevant existing checks. Retain or deliberately version published contracts; do not claim compatibility without inspecting current implementation. Add no runtime compatibility facade to hide a schema mismatch.

Report actual baseline, files changed, stage scope, field ownership confirmation, executed checks and remaining later-stage implementation. Do not claim measured cost savings or live background concurrency from documentation/schema tests. Complete authorized local work without waiting for permission to perform read-only inspection or reversible document edits.
