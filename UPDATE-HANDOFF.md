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


---

# S6 history/recovery paused handoff — 2026-09-11

This is a deliberate safe stopping point requested by the user. Resume S6 in place; do not recreate, reset, clean, stash, rebase, or discard this worktree.

## Exact workspace state

- Workspace ID: `1c19afeb-s6-history-recovery`
- Path: `C:\AI-Agent\worktrees\1c19afeb-s6-history-recovery`
- Branch: `work/1c19afeb-s6-history-recovery`
- HEAD / accepted S5 parent: `ac979004fb5756d24946ef6ca04d93c5ade25edb`
- Current state token before this handoff edit: `d911fd04018f3dce2c3d2e97bfefe778f17091eb911c23465da60270dc248a54`
- Worktree is intentionally dirty. There is no S6 commit.
- Untracked S6 files: `src/host/history-recovery.js`, `tests/history-recovery.test.js`.
- Canonical main has not been changed. No push, merge, rebase, or host sync was performed at this stopping point.

## Implemented S6 work

The current diff implements revision-aware history boundaries and bounded checkpoints, history replay identity assignments, atomic reconstruction through the existing CommitCoordinator, user tombstone/lock/manual-correction overlays, exact divergence detection, suffix replay through the production parser/validator/source resolver, edit/delete/swipe/reload hooks, Development queue invalidation/requeue, delayed-result source revalidation, relationship/lifecycle recovery, replay idempotence, and persistence-race retry behavior.

Recent fixes cover multi-NPC partial edits, per-assignment source provenance across repeated recovery, post-save host-history mutation detection, fractional relationship/milestone recovery, death edit/delete correction, Development evidence invalidation, and manual tombstone preservation.

## Last verified local evidence

- `npm test`: 479/479 PASS after the latest source changes.
- `npm run validate`: PASS with zero errors after the latest source changes; recapture the exact final count on resume.
- `git diff --check`: PASS after the latest source changes (one LF-to-CRLF warning for `src/state/schema.js` only).
- `npm run package`: passed earlier, but the generated `dist` predates the final race/provenance fixes and is stale. Rerun packaging before any host sync or acceptance.
- Dedicated host remains the isolated Alpha host at `C:\AI-Agent\hosts\sillytavern-alpha-test`, ST 1.18.0, host commit `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`, origin `http://127.0.0.1:8011`. It still has the prior artifact, not this latest S6 build.

## Completed bounded Gemini probe

Reviewer agent `agent-e4c2fb41` completed successfully using `gemini-3.8-flash-high`; conversation `9c43a23b-1d02-421b-8586-1a28eb2addaa`. It made no repository changes and quota was available. It produced four compliant candidate messages: NEW named admission, fractional relationship movement, a two-NPC survival swipe, and ambiguous atmosphere with `proposals: []`.

Treat its findings as unverified review leads until checked against production code/tests:

- Normalize missing/zero swipe IDs consistently to avoid spurious divergence.
- Check reconstruction cleanup of pending-review and accepted-support references for user-tombstoned NPCs.
- Add a two-NPC swipe regression where one NPC remains stable and the other changes death/survival.
- Add a positive empty-proposals ambiguous-narrative regression.
- Existing strict terminal-trailer and exact axisSupport behavior are contract constraints, not bugs to loosen.
- Preserve any useful candidate as a deterministic fixture only after it passes the exact production parser/resolver/recovery path.

## Historical acceptance blocker/risk — superseded by the architecture amendment below

At this safe stopping point, the then-current S6 workplan required an explicit importer for a documented selected Beta schema/version based on verified exported fixture copies. No Beta fixture/schema was available, so the worktree correctly stopped without guessing a schema or touching Beta data. The later user-approved C15/workplan amendment below moves legacy migration to S10 and supersedes this as an S6 acceptance blocker while preserving it as historical context.

## Resume order

1. Use only the registered `windows-coding-agent` MCP. Re-run ping, capabilities, model_status, test-host status, and worktree status; capture the new state token.
2. Read the governing documents and this handoff. Inspect the complete S6 diff, including the Gemini review leads above.
3. Resolve concrete review findings and add deterministic regressions where warranted.
4. Rerun `npm test`, `npm run validate`, `npm run package`, and `git diff --check`.
5. Sync only the freshly packaged S6 artifact into the dedicated Alpha host, then exercise actual supported edit/delete/swipe/reload lifecycle behavior, browser smoke evidence, persistence, duplicate-hook checks, browser console, and host stderr.
6. Historical pause instruction: resolve the then-required Beta importer only from a verified sanitized export. This instruction is superseded for S6 by the Alpha-native-first amendment below; the verified-fixture requirement remains binding for S10 compatibility work.
7. Update `DEVELOPMENT.md` and this handoff with exact final evidence. Commit once only if every current S6 acceptance item is genuinely satisfied.
8. Do not start S7. Do not consume Opus, start another Codex session, push, merge, rebase, or modify canonical main.

## S6 continuation result — 2026-09-11

This historical continuation completed the available history/recovery review and host verification and correctly left S6 uncommitted under the then-current C15 Beta-import requirement. That acceptance blocker is superseded by the later Alpha-native-first architecture amendment below.

- State token immediately before this evidence append: `97281d79936ea5ec572bff0d2a2d088bce828e4fdcf4d1209bc624b3cec7ba50`.
- HEAD remains the accepted S5 commit `ac979004fb5756d24946ef6ca04d93c5ade25edb` on `work/1c19afeb-s6-history-recovery`.
- Latest deterministic tests: **483/483 PASS**.
- Latest repository validation: **47/47 PASS** for the implemented S6 history/recovery primitives. This does not claim importer acceptance.
- Fresh `npm run package`: PASS.
- Fresh `git diff --check`: PASS; only normal LF-to-CRLF working-copy warnings.
- Fresh installed artifact: **38 files / 784,627 bytes**, synchronized only to the dedicated Alpha test host.
- Real installed SillyTavern 1.18.0 browser smoke/UI acceptance: PASS; loader/import/adapter/interceptor all healthy, zero Alpha console errors, zero uncaught page errors.
- Dedicated host stderr: empty; host discovery includes only `third-party/npc_state_alpha` as the user extension.

### Review findings resolved

1. **User-tombstone pending orphan — confirmed and fixed.** Reconstruction now removes `pendingReview` entries whose target is preserved as a user tombstone. The existing manual-tombstone recovery test now asserts the pending ledger is clean.
2. **Pre-import baseline rollback guard — independently found and fixed.** History analysis was changed to discover the imported-state boundary before divergence scanning, so divergence before that boundary is blocked as `pre_import_history_untrusted` instead of reconstructing into unproven pre-import history. The later architecture amendment below generalizes the marker to `import_baseline`.
3. **Missing-vs-zero swipe concern — disproved against production.** `getMessageSwipeId()` already normalizes absent swipe identity to `0`, while older provenance with no swipe token intentionally skips swipe equality. No code change was made.
4. **Two-NPC death/survival swipe — added and passing.** The stable sibling retains its ID/state while the affected NPC moves death → survival → death through production recovery.
5. **Gemini positive model fixtures — confirmed.** The ambiguous long-narrative `proposals: []` case passes the production parser/validator/host path without phantom admission. A Gemini-derived fractional Trust/Tension case passes the production S3 path and the scored relationship effects return to zero after an S6 history edit.
6. **Strict terminal trailer and exact per-axis `axisSupport` — unchanged.** These remain canonical wire constraints, not model-convenience bugs.

### Historical blocker — superseded for S6, retained for S10 compatibility work

Controller-accessible inspection found no sanitized Beta export, no selected Beta schema/version fixture in the Alpha worktree, and no Beta artifact in the isolated Alpha host. That remains a real blocker for future S10 Beta compatibility and still forbids schema inference, normal-profile/database inspection or fabricated migration fixtures. Under the later approved C15 amendment, it no longer blocks Alpha-native S6 acceptance.

No S7 work, Opus use, new Codex session, push, merge, rebase, canonical-main mutation, or Beta-data access occurred in this continuation.

---

## S6 Alpha-native-first architecture amendment — 2026-09-11

The user explicitly approved a bounded C15/workplan amendment after the prior safe stop. This section supersedes the earlier S6 Beta-import blocker and resume step that required a compatible Beta fixture before S6 acceptance. It does not erase the historical reason for that stop and does not waive later legacy compatibility.

Architecture decision:

- Alpha's canonical runtime, history and persistence remain defined only by Alpha-owned contracts/state.
- C15 now defines native `npc_state_alpha.native_state` format version 1 around one validated `npc_state_alpha.v1` canonical state.
- Native serialization is deterministic and lossless-JSON only. Creation/parsing adds no provenance, chat history, timestamps, checkpoints, relationship reasons, observations/support or other missing evidence.
- Parsing a native bundle does not automatically write a live chat. A later explicit restore must verify authoritative host source history or establish the neutral `import_baseline` recovery boundary when older history cannot be proven.
- History recovery now keys that safety fence only on format-neutral `import_baseline`; no `beta_import` mode remains in production code/tests.
- Checkpoint compaction preserves both the first trustworthy base and the earliest import baseline while retaining checkpoints in chronological order under the existing 128-checkpoint cap.
- Legacy Beta/other format migration is moved to S10. It remains required for any release that claims that compatibility, and must be fixture-backed, version-detected, fail-closed, narrow, non-mutating to source data and unable to fabricate evidence.
- The reported Beta exporter error `NPC State: Bundle app version 0.5.38 is not compatible with the v3 dossier schema.` is recorded as incompatibility evidence only, never as a guessed schema definition.

Current deterministic evidence after the amendment and adversarial fixes:

- `npm test`: 490/490 PASS.
- `npm run validate`: 51/51 PASS before the final documentation/host gate.
- Native portability has dedicated round-trip, deterministic ordering, unsupported format/version, malformed state, empty/no-fabrication and non-lossless-JSON rejection regressions.
- Import-baseline regressions cover pre-baseline refusal and compaction retention/chronology.
- Existing S6 edit/delete/swipe/reload/relationship/lifecycle/identity/Development/CAS/race regressions remain green.

No legacy Beta adapter was implemented, no Beta database/profile was read, and no fabricated Beta fixture was added. S7 remains untouched. Final S6 acceptance still requires fresh final tests/validation/package/diff-check, fresh dedicated-host sync/browser/log evidence, documentation reconciliation and the single local S6 commit.

### Final S6 pre-commit acceptance — 2026-09-11

All current Alpha-native S6 acceptance requirements have now been exercised on the complete S5→S6 delta. No accepted High, Medium or Low review finding remains.

- Final deterministic repository tests: **490/490 PASS**.
- Final repository validation before this documentation-only evidence append: **51/51 PASS**.
- Final `npm run package`: PASS.
- Final `git diff --check`: PASS; only normal LF→CRLF working-copy notices for this handoff and `src/state/schema.js`.
- Final installed artifact from the exact S6 code candidate: **39 files / 792,604 bytes**, synchronized only to `C:\AI-Agent\hosts\sillytavern-alpha-test\data\default-user\extensions\npc_state_alpha`.
- Installed `src/host/history-recovery.js` and `src/state/portable-state.js`: HTTP 200 from the dedicated host.
- Real Microsoft Edge installed-host smoke/UI acceptance: PASS. SillyTavern loader executed, Alpha module imported, adapter initialized, generation interceptor registered, UI/state controls remained healthy, listener dedupe remained healthy, and there were **0 Alpha console errors / 0 uncaught page errors**.
- Dedicated host: SillyTavern **1.18.0**, commit `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`, host Git clean, current-controller ownership, HTTP 200, stderr empty.
- S6 edit/delete/swipe/regeneration/reload, relationship, lifecycle/death, identity/admission, Development invalidation/requeue, C08 observation/support/receipt, user authority, CAS/persistence/race, multi-NPC and cross-chat behavior remain covered by the deterministic SillyTavern host harness using the production modules. Browser evidence is not overstated as interactive S6 history editing.
- Native format is `npc_state_alpha.native_state` v1, deterministic and lossless-JSON only. Tests also cover inert `__proto__` metadata, unsupported format/version, invalid state, empty/no-fabrication behavior and rejection of values that JSON would silently alter.
- `import_baseline` is the only Alpha-core import/migration history fence. Checkpoint compaction retains its earliest occurrence and preserves chronological order.
- No additional Gemini call was needed after `model_status` confirmed `gemini-3.8-flash-high` available. Existing read-only S6 Gemini fixtures remain the fractional relationship rollback and ambiguous empty-proposals cases plus the earlier two-NPC/review leads already reconciled deterministically.
- No Opus, Codex, production Beta database/profile access, fabricated Beta fixture, push, merge, rebase or canonical-main mutation occurred. Legacy compatibility remains explicitly assigned to S10 and S7 has not started.

Historical note: the single S6 commit was subsequently created as `b8b23ac93af681e87bded7adf226dac1a0b0abdc`. The later user instruction explicitly authorized S7 in a fresh worktree.

---

## S7 prompt/context optimization handoff — 2026-09-11

S7 is implemented in the isolated workspace `dbc4d0e7-s7-prompt-context`, branch `work/dbc4d0e7-s7-prompt-context`, directly from accepted S6 `b8b23ac93af681e87bded7adf226dac1a0b0abdc`. S8 has not begun.

The S7 candidate keeps Alpha semantics/runtime ownership unchanged while consolidating the two model-facing paths. Immediate continuity now uses a deterministic soft-detail projection that keeps every identity visible and gives detailed context to present/active/exact-mentioned NPCs plus bounded importance/ID fill. Development sends source-visible durable comparison context once, limits retained observation/support prompt records to eight without pruning canonical state, projects only the four current relationship axes, and omits runtime mechanics/routing/empty metadata. Both prompt grammars remain model-independent and preserve the accepted C02/C03/C04/C08 authorities.

Deterministic measurement baseline is the accepted S6 prompt builders frozen in `tests/fixtures/s7-prompt-baseline.js`. Final measured aggregate sizes are Immediate **23,181 → 16,073 chars (-7,108 / -30.66%)** and Development **18,767 → 19,053 chars (+286 / +1.52%)**. The Development increase is a bounded reliability tradeoff for explicit exact-wire guidance discovered by live model testing; the retained-context-heavy mature dossier still shrinks **6,931 → 6,447 chars (-484 / -6.98%)**. `npm run measure:prompts` records chars, UTF-8 bytes, SHA-256 and a stated ceil(chars/4) proxy.

Authorized read-only Antigravity evaluation used exact models `gemini-3.8-flash-high` for the 8-case primary Immediate corpus and `gemini-3.7-flash-high` for the 8-case primary Development corpus, with 3 unique cross-model cases in each opposite direction. Focused repeats were limited to observed wire ambiguity. Across the interrupted/resumed S7 work there were 15 completed provider turns, 13 usable for evaluation; one first turn yielded no useful output after a denied tool attempt and one late 3.8 probe is excluded because the benchmark task itself omitted the required root schema line. Gemini never had write authority.

Live failures were converted to deterministic regressions. The S6 Development guidance encouraged semantically plausible but wire-invalid `field/value`, `sourceId`, receipt-status and support-shape output from 3.7; the final compact grammar fixed those classes and the age/family case now uses string age plus `operation:"add"`/`targetName`. Cross-Immediate 3.7 initially emitted `{value,source}` wrappers and then invented `<field>Source` keys; shared model-independent clarification now yields direct scalars, one literal `source`, omitted empty aliases and canonical no-shift relationship evaluation. Gemini 3.8 final Immediate and cross-Development representative outputs are also pinned through production validators.

Provider routing remains configurable: Immediate follows the user's SillyTavern roleplay connection; Development uses independent `developmentConnectionProfile`, and the chosen Connection Manager profile supplies its own provider/model. No Gemini 3.7/3.8 identifier is present in canonical runtime routing and no duplicate Alpha Development-model setting was added.

Final pre-commit evidence: after the S7 documentation update, `npm test` **513/513 PASS**, `npm run validate` **57/57 PASS**, `npm run measure:prompts` PASS, `npm run package` PASS and `git diff --check` PASS with only normal LF→CRLF notices. Fresh S7 package installed only in the dedicated SillyTavern 1.18.0 host is **39 files / 796,979 bytes**. Real Edge installed-host smoke/UI acceptance passes with loader/import/adapter/interceptor/settings/UI healthy, zero Alpha console errors, zero uncaught page errors, and empty host stderr. Installed prompt injector, Development context and S6 history-recovery modules are served HTTP 200. Complete S6→S7 diff review found no accepted High/Medium/Low finding and no runtime authority migration.

Only the single normal local S7 commit remains, with parent `b8b23ac93af681e87bded7adf226dac1a0b0abdc`. Verify the clean committed worktree and canonical main afterward, then STOP. Do not begin S8. No Opus/Codex/push/merge/rebase is authorized.

Historical note: S7 was subsequently committed as `827ab4cac800a29633c2053427ee9a00797dfeea` (`prompts: optimize S7 context and model guidance`). The later user instruction explicitly authorized S8 in the isolated worktree below.

---

## S8 behavioral/integration matrix handoff — 2026-09-11

S8 is implemented only in workspace `38f86491-s8-behavior-matrix`, branch `work/38f86491-s8-behavior-matrix`, directly from accepted S7 `827ab4cac800a29633c2053427ee9a00797dfeea`. S9 has not begun.

The S8 matrix is recorded in `tests/fixtures/s8-behavior-matrix.js` as labeled A–P groups plus eight long-form interaction scenarios. New executable tests intentionally concentrate on cross-feature combinations while retaining the accepted S1–S7 suite as evidence for already-proven isolated behavior. Current S8 integration coverage includes identity/localRef replay, same-name/alias separation, cross-chat isolation, relationship A/B/A swipe reconstruction, Development failure and missing-profile isolation, stale Development/form/lifecycle/chat-switch races, manual correction/lock/tombstone recovery, three-NPC isolation, graph endpoint resolution, history idempotence, and native portability.

Two concrete S8 defects were found and fixed rather than papered over by tests. First, a structurally valid One-Pass envelope with one state-incompatible existing target could abort an independent valid sibling. `CommitCoordinator` now applies existing One-Pass targets against isolated candidate NPCs, reports rejected targets, excludes them from newly enqueued Development work, commits independent accepted siblings, keeps all-rejected transactions fail-closed, and preserves full transaction coupling for failed NEW admission. Host commit diagnostics expose the partial rejection. This is the behavior already required by C04, not a contract expansion.

Second, valid Development `nonPlayerRelationships` proposals may use `targetName` for a new non-destructive endpoint, but the application layer previously had no runtime resolution for that wire form. S8 resolves only a single exact canonical-name match to a stable `targetId`, strips transient `targetName` before persistence, and fails closed if the name is missing or ambiguous. Tests cover unique resolution, two same-name ambiguity, delayed ambiguity introduced while a provider is waiting, directional graph behavior, and no fabricated reciprocity.

S8 also retains bounded real-model evidence from the authorized Antigravity resource. Gemini 3.8 validator-clean fixtures cover routine exchange activity with explicit no-shift relationship evaluation, possessive attacker wording without false-victim death, atmosphere without phantom admission, and genuinely ambiguous pronouns without guessed binding. Gemini 3.7 supplied one semantically useful Markdown-fenced Development result retained as a strict-parser rejection regression and one corrected exact-wire age/role/family result that validates, uses string age and `targetName`, and invents no birthday. The optional broad repository reviewer `agent-0e5fc945` produced no result and was cancelled after stalling; it is not acceptance evidence.

Final repository gates on the fully reconciled S8 tree: `npm test` **542/542 PASS**; `npm run validate` **0 errors**; `npm run measure:prompts` PASS with every accepted-S7 prompt size/hash unchanged; `npm run package` PASS; and `git diff --check` PASS with only the normal `scripts/validate.js` LF→CRLF working-copy warning. S8 does not change prompt construction.

Fresh S8 package synchronized only into the controller-owned dedicated host contains **39 files / 799,884 bytes**. Host is SillyTavern **1.18.0**, release commit `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`, Git clean, loopback `http://127.0.0.1:8011`, current-controller ownership. Installed changed modules `src/runtime/commit-coordinator.js`, `src/runtime/field-applier.js`, and `src/host/sillytavern-adapter.js` are served with HTTP 200. Host discovery contains only `third-party/npc_state_alpha` as the local user extension and stderr is empty. The current controller tool schema does not expose the earlier browser-acceptance action, so this handoff does not claim a fresh S8 browser run; accepted prior installed-browser evidence remains historical evidence only, while current S8 behavior is exercised through deterministic production-module host/storage simulations.

Canonical main remains clean at `6cfe27196d4da66cd3492efaaace237637dd051b`. No Beta database/profile access, legacy migration, S9 implementation, Opus, Codex, push, merge, rebase, reset, stash, or clean operation is part of S8. After fresh final tests/validation/measurement/package/diff-check and exact diff review, create at most one normal local S8 commit from parent `827ab4cac800a29633c2053427ee9a00797dfeea`, verify the committed worktree/main state, then STOP.

Historical note: S8 was subsequently committed as `1dbec8978fe1249a286554e93473f21beaaec32f` (`tests: complete S8 behavioral matrix`). The later user instruction explicitly authorized S9 in the isolated worktree below.

---

## S9 performance/endurance handoff — 2026-09-11

S9 is implemented only in workspace `e2081eeb-s9-performance-endurance`, branch `work/e2081eeb-s9-performance-endurance`, directly from accepted S8 `1dbec8978fe1249a286554e93473f21beaaec32f`. S10 has not begun.

The repository now has one coherent deterministic performance harness, `npm run measure:performance` (`scripts/measure-performance.js`), with SMALL/MEDIUM/LARGE/STRESS synthetic tiers, prompt/state/checkpoint/relationship/portable-state growth, Development batch/context timing, actual recent/old reconstruction timing, a 128-exchange Immediate critical-path spine, cadence characterization, memory snapshots, and a separate 120-exchange six-NPC/two-chat integrated endurance session. Timing uses `performance.now()` and is reporting data rather than brittle unit-test thresholds.

S9 found and fixed the measured performance pathologies without moving authority. Immediate/Development/history now reuse one operation-local canonical fingerprint index rather than rehashing the same lineage repeatedly. Full checkpoint retention is 32 instead of 128, preserving the first trustworthy base, earliest import baseline, a dense recent suffix, deterministic older anchors and chronology. Actual recovery replay uses attempt-local portable-source occurrence counts, excludes safe-history snapshots from the temporary replay state, returns compact replay history capture instead of disposable full checkpoints, and uses clone elision only inside the isolated replay-owned `MemoryStorageAdapter`; normal storage copy isolation, schema validation, CAS, final atomic reconstruction checkpointing and post-save history revalidation remain unchanged. Development source reacquisition uses the same operation-local fingerprint view and no prompt semantics changed.

Adversarial testing found two correctness issues and both are now fixed. First, surviving C08 accepted support was rebound to a numeric field revision during reconstruction even though the persisted schema requires a string token; `commitReconstruction` now preserves `String(currentRevision)`. Second, the initial 32-checkpoint policy could discard an old admission checkpoint and later recreate that NPC under a new stable ID if reconstruction started before admission. Checkpoint compaction now carries a deduplicated source-bound identity-assignment ledger on the protected first base while still discarding the expensive full snapshot. The regression proves the original admission checkpoint is gone, the compact assignment survives exactly once, and the replayed NPC retains the exact stable ID.

Final corrected measurement on Node v24.19.0 / i5-14600KF: the 128-exchange Alpha-local pre-provider path is **28.540 ms median / 74.987 ms p95**, down from roughly **149 / 519 ms** at S8 baseline; post-provider is **115.613 / 247.781 ms**, down from **335 / 1,165 ms**. Large branch divergence is **0.789 ms median**, large clean-history analysis **0.813 ms**, and stress Development dispatch **1.964 ms**. Checkpointed STRESS state is **32,765,675 B** versus the ~129.1 MB S8 baseline. Actual LARGE recovery is reported as two-run ranges: recent edit replaying four exchanges **739.8–761.9 ms**, old edit replaying 112 exchanges **876.0–896.3 ms**, down from an earlier ~9.21 s old-edit measurement before replay fixes. Remaining old-history cost is proportional to real validated replay, not repeated whole-history scanning.

The integrated session completes **120 primary exchanges / six primary NPCs / two chats**, with 44 synthetic cadence-3 Development requests, one durable Development conclusion/observation/support, relationship evolution, correction/lock/unlock, form change, death→survival swipe, later edit/deletion, reload equality and same-name second-chat isolation. Both states validate, `reloadStateEqual=true`, `crossChatIsolation=true`; history event timings are **253.657 ms** death→survival swipe, **251.977 ms** recent user edit and **254.295 ms** recent assistant deletion. Failure/persistence endurance proves 25 automatic Development triggers after one provider failure cause no redispatch or additional persistence, one multi-NPC Immediate transaction saves once, a duplicate finalized event saves zero times, and 20 malformed Immediate outputs save zero times. Fifty adapter initialize/destroy cycles leave no listeners/global interceptor; diagnostics remain bounded at 100.

Accepted S7 prompt protection is exact: `npm run measure:prompts` remains **16,073 Immediate / 19,053 Development aggregate chars** with accepted hashes unchanged. Latest full `measure:performance` completes with all synthetic and integrated states valid. The final pre-commit deterministic suite is **554/554 PASS** before the documentation-only closeout; S9 validation is **0 errors**. Final package is **39 files / 810,126 bytes**.

Dedicated installed-host evidence is complete. Only the controller-owned `C:\AI-Agent\hosts\sillytavern-alpha-test` was used: SillyTavern **1.18.0**, release commit **`8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`**, host Git clean, loopback HTTP 200, current controller ownership, PID 38576. The S9 entrypoint and all changed runtime modules are served as JavaScript with HTTP 200. The controller-bundled real Microsoft Edge acceptance reports loader/import/adapter/interceptor, dossier/settings/Development status, corrections/locks, relationship controls, chat switch, listener rebinding and reopen persistence all green, with `noUiPollingRegistered=true`, no Alpha console errors and no uncaught page errors. Dedicated host stderr is empty. No standalone browser performance API is exposed, so no layout/reflow duration is claimed.

Bounded real-model characterization used only the authorized Antigravity resource after `model_status` showed exact `gemini-3.8-flash-high` and `gemini-3.7-flash-high` AVAILABLE. Gemini 3.7 completed four Development turns in **9.48 s, 77.27 s, 145.54 s and 221.99 s** as its reused agent conversation accumulated wrapper/context; early outputs repeated known 3.7 wire mistakes and later no-op outputs were exact-looking. Gemini 3.8 produced two useful Immediate turns in **30.29 s** and **252.83 s**; two other no-progress probes were cancelled. These are Antigravity agent-turn timings, not Alpha local runtime or SillyTavern provider-profile latency. Reported token counters include the agent wrapper/conversation and are not treated as Alpha prompt-token cost. No dollar prices are fabricated. An optional external 3.7 adversarial repository reviewer also stalled before producing a result and was cancelled; Sol's complete S8→S9 diff review found the stable-ID compaction defect above and no accepted finding remains after its fix.

Final memory snapshot rises from 66,215,936 B RSS / 7,316,840 B heapUsed to 1,148,051,456 B RSS / 523,163,504 B heapUsed during the allocation-heavy synthetic run. Node GC is not forced/exposed, so this single before/after sample is not leak evidence; no intrusive production heap tracer is added.

At final acceptance, Critical=0, High=0, Medium=0, Low=0. INFO observations are the fresh-worktree package-before-full-test ordering, bounded real semantic replay cost for very old edits, one-sample process-memory growth with no forced GC, intentionally retained canonical evidence/pending growth, and highly variable Antigravity agent-side latency. No Beta database/profile access, fabricated Beta fixture, legacy migration, Opus, Codex, push, merge, rebase, reset, stash, clean, or canonical-main mutation occurred. Only the final post-documentation repository gates, single local S9 commit from parent `1dbec8978fe1249a286554e93473f21beaaec32f`, clean-worktree verification and STOP remain. S10 is not started.
