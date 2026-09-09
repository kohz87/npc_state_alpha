# Sol 5.6 Extra High — NPC State Alpha implementation and deployment workplan

**Execute in:** [kohz87/npc_state_alpha](https://github.com/kohz87/npc_state_alpha).

Build a standalone Alpha extension from the architecture in [core-contract.md](core-contract.md). Read [AGENTS.md](../AGENTS.md) first. These foundation files must be installed at repository root `AGENTS.md` and `docs/core-contract.md` before implementation. This file belongs at `docs/SOL-WORKPLAN.md`.

The core contract is the single behavior owner. This workplan defines sequence, evidence and completion criteria; it must not accumulate competing runtime rules. A later explicit user instruction takes precedence, with the core and affected tests updated deliberately.

**Development-record amendment — 9 September 2026**

Keep S0–S10 and existing completed work. This revision makes C08–C13 development records, retention, selective review and next-request availability explicit; it also adds C03 adapter verification and C16 multi-turn cost acceptance. It does not move fields between automatic writers. If S1 already exists, implement its schema/fixture amendment as a bounded follow-up under the user's current stage authorization; do not restart S0, overwrite newer instructions, begin S2 implicitly or bump a released schema blindly. Reconcile actual code and document versions before applying these generated files.

**Execution scope**

Implement the complete first usable Alpha release, including both extraction paths, settings/UI, source validation, durable storage, branch/recovery behavior, narrowly scoped import support, tests, documentation and an installable package. Complete reviewable commits and the normal release/deployment workflow when authorized and verified. Do not stop at a scaffold or architecture proposal.

Do not modify Beta/reference repositories, install into a real user's SillyTavern, alter a real NPC database, activate competing extensions or execute imports without explicit authorization for those actions. Repository implementation and mock/fixture tests must not touch user data.

**S0. Establish the actual starting point**

At preparation on 9 September 2026:
- Alpha main: `ded203c44d11f7b2091a9fcc6f376a04ae0b7320`, initial commit containing LICENSE only.
- Beta main: v0.5.38, `044cd42effa5c80a2e5f0facc6deeffa106ade01`.
- Reference main: `a12b2937b5c1305e3e3017218a626478a5bedcdc`; inspect legacy/v0.2.x/. Its core wrapper reports 0.2.23 and delegates to core-v0218.js.

These are review baselines, not instructions to reset current branches. Fetch current HEAD, inspect working changes/nested AGENTS, preserve newer work, and record the actual baseline. Recheck the license/provenance of reused files and retain required notices.

The earlier Beta review ran 476 passing tests and a conservative prompt estimator. Those results do not establish Alpha correctness or live performance.

Commit the foundation documentation first if it is not already tracked. Create a concise DEVELOPMENT.md with the actual command/namespace/version decisions as they are implemented. Do not put duplicate architecture rules there.

**S1. Establish contracts and executable acceptance fixtures before porting**

Implement a single field/authority registry and versioned wire schemas for immediate and development requests. Encode the ownership matrix from C02 and source references from C03. Keep mechanical operations shared even where purpose-specific envelopes differ.

Before wiring providers:
- Define strict minimal empty and populated one-pass envelopes.
- Define NEW local reference resolution, stable-ID existing references and permitted sources.
- Define the compact explicit zero-relationship evaluation.
- Define the separate development target/no-op receipt shape.
- Define C08 observation/disposition/support-link records and target/source progress, with optional explicit subset scope. Use shared source references; do not mirror the dossier or require exhaustive observation classifications.
- Define supported structured-source segment metadata/permissions and rejection fixtures without assuming an unverified external format.
- Define audit mode masks and field-level outcomes.
- Define transient currentPresentation versus canonical appearance/forms and the known currentForm selector.
- Define terminal lifecycle structure without livingReturn.
- Parse exact emitted examples through production parsers and validate their intended evidence/authority behavior.

Keep one canonical source owner per operation and field. Do not import Beta's all-fields/group/candidate audit requirements into routine Alpha envelopes.

Produce focused fixtures early for:
- New named and role-label individual; multiple NEW people and ambiguous names.
- Existing live delta with no durable mutation.
- No-change and zero-score interaction.
- Wrong-writer attempts in both directions.
- New form observed before a durable form definition exists.
- Death, mistaken victim, contradictory lifecycle output and attempted resurrection.
- Development observation, direct durable establishment and later enrichment.
- Observation-to-accepted-field support references, contradiction/supersession structure and narrowly scoped review receipts.
- Malformed/missing/duplicate machine trailer.

This stage ends with a reviewable executable contract, not a large folder scaffold.

**S2. Build the shared runtime and choose ports deliberately**

Create a small source tree around real responsibilities. Suggested groups, to merge or split as actual dependencies justify:
- contract/model: fields, shapes, examples, settings definitions;
- evidence/identity: source segmentation, ownership, target/admission handling;
- application: domain handlers and one commit coordinator;
- immediate: prompt/capture and fast repair;
- development: prompt/context, durable review queue and audit operations;
- state/history: schema, storage/CAS, user ownership, checkpoints/recovery;
- host/UI: SillyTavern hooks, routing, rendering and settings;
- diagnostics/scripts/tests.

Store the development record within this shared model/evidence/history system. Reuse source identity and commit machinery; do not add a per-NPC filesystem service, vector database, independent memory process or a second profile authority for this amendment.

No dependency on external Beta/legacy runtime files. No wrappers around a copied monolithic Beta engine.

Inspect these Beta candidates rather than importing them wholesale:
- src/model/dossier-fields.js and pure normalizers in schema.js;
- identity/source ownership helpers and evidence adapters;
- relationship-rules.js plus tested mechanical portions of relationship application;
- storage.js, branches.js and user-correction algorithms;
- host-harness and behavioral fixtures;
- connection-routing mechanics.

For every substantial port, record original file/commit, required dependencies, retained behavior and deliberate Alpha changes in DEVELOPMENT.md or a compact port ledger. Do not assume “tests pass” means the old behavior belongs in Alpha.

Known reviewed Beta pitfalls to prevent:
- Refresh Current Dynamic reconciliation bypassing evidence validation.
- lifeStateReason prompt/runtime quotation mismatch.
- livingReturn overriding a contradictory dead state.
- Independent evaluatedGroups requirements despite full field outcomes.
- Repeated refs/locks/profile context.
- Source metadata dropped by connection adapters.
- Lexical source membership being represented as proof of semantic target correctness.

Use legacy 0.2.x for delta semantics, narrow detailed context, identity hints and exact stock compilation. Do not port lexical profile grounding, unguarded identity matching, automatic backfill/deep sweeps or focused relationship request loops.

**S3. Implement one-pass immediate continuity end to end**

Wire actual SillyTavern capabilities for continuity injection, generation lifecycle and finalized message capture. Verify supported host APIs from available source/official documentation; do not invent hook names. Test the installed artifact, not just imported pure modules.

Implement:
1. Compact continuity with the immediate contract only.
2. Finalized narrative plus the specified Alpha trailer.
3. Capture of the request lineage and final assistant source.
4. Strict parsing and source-bound identity/live/presence/relationship/death proposals.
5. Mechanical validation, scoring/replay protection and one short atomic state commit.
6. Durable pending development references for accepted relevant NPCs.
7. Rendering/injection that excludes machine transport from narrative.

Immediate pending capture does not add durable-field classification to the trailer. At dispatch, inject a coherent accepted-state snapshot per C10; pending observations stay private to development. A late successful review updates the UI and becomes available to the next request without another provider call.

Handle streaming completion, continued responses, swipe/regeneration, reused positions, duplicate host events and chat switches. Source fingerprints and trailer handling must agree. No speculative stream fragment changes state.

Do not regenerate the roleplay or issue a dedicated automatic scanner when the trailer is missing/malformed. Preserve the story, expose extraction failure and provide Retry immediate using the same exact owned exchange and fast authority. Protect already accepted siblings and scores from replay.

Demonstrate a working fast-only vertical path with zero extra provider calls on a successful completed story response. Defer full development UI until the shared path is proven.

**S4. Implement development review and pending-source ownership**

Use the existing shared sidecar and commit boundary, not an independent memory service.

Implement C08–C10:
- Pending scope by owned exchange and accepted target.
- Early eligibility for newly admitted NPCs.
- Default existing-NPC cadence of three accepted immediate exchanges, configurable 1–10.
- Bounded oldest-first batches; start with at most six exchanges per request.
- One in-flight development request per active chat; coalesced triggers.
- Targeted current comparison values, locks, refs and owned prior observations.
- Persistent observation/disposition/accepted-support links using the C08 schema; accepted values remain in the dossier.
- New narrative reviewed against the compact eligible-domain menu; detailed comparison/observation context selected per C13 without lexical exclusion of unexpected facts.
- Observation-only follow-up narrowed to linked fields/dependencies; unchanged unresolved material does not trigger repeated automatic reviews by itself.
- Small no-op target receipts instead of routine per-field negative lists.
- Restricted reviews acknowledge only their actual field/source scope; excluded or deferred work remains pending.
- Direct first-review establishment, tentative observations and supported later enrichment.
- Observation extraction and supported field promotion in the same request; no collection/promotion pipeline of extra model calls.
- Atomic receipt/observation/profile/graph commit; unresolved work stays visibly pending.
- Reload/pause/resume, backlog limits, source-unavailable status and bounded failure/retry behavior.
- No second full chat copy or generic raw-evidence database.

Implement C09 retention before permitting consolidation or pruning. Reuse exact owned evidence; preserve unresolved observations, accepted support, contradiction links and recoverable checkpoints. Consolidation may be proposed inside the scheduled review, never by an added automatic summarizer. Fail with explicit deferred/unavailable scope when necessary evidence cannot be supplied. Do not substitute the visible Memories field, chat-summary text or accepted dossier prose for original event evidence.

An early first-contact review is intentional and nonblocking. It is not a return to the old automatic full-dossier completeness-repair loop. Subsequent ordinary reviews ask only for durable deltas from the pending scope.

Use the configured host connection route. Preserve exposed usage metadata and fail closed on missing/changed selected profiles. The host may serialize requests; demonstrate foreground priority or safe background yielding. Do not claim nonblocking execution merely because the function is async.

Concurrency is a release requirement:
- Perform provider work outside the state lock.
- Capture and revalidate read dependencies.
- Apply to the latest state using field-scoped proposals.
- Keep newer immediate state and relationship scores.
- Defer affected stale durable proposals rather than overwriting newer data.
- Do not invalidate an entire review because an unrelated live field changed.
- Recheck deletion/lifecycle/identity/manual ownership and source lineage at commit.
- Newly arriving pending exchanges remain unreviewed by an older batch.

**S5. Complete focused mechanics, manual audit and UI**

Finish each domain through its declared owner:
- Fast: terminal death, presence, known form selection, independent relationship axes/mechanics.
- Development: canonical appearance/forms, role/species/ages/background, personality/behavior/speech/mannerisms, Relationship Dynamic, memories and directional graph/family facts.
- Manual: exact-scope Retry immediate, Review pending, Recheck missing details and Refresh dossier.
- User: editor corrections/locks, importance and supported portrait attachment/import.

Preserve semantic judgment. An exact quote match does not replace interpretation of subject, negation, habitual behavior or relationship target.

Build the minimal usable dossier list/editor/settings UI:
- Distinguish immediate presentation from durable appearance.
- Show pending/running/failed review status and last successful review scope/time.
- Give immediate failure a bounded retry action.
- Keep diagnostics inspectable without filling the ordinary interface with transport metadata.
- Explain unknown/unreviewed fields without pretending they were found unavailable.
- Surface accepted development after commit; show pending review status without presenting tentative observations as established personality.

Implement settings from one registry:
- Alpha enabled and admission policy;
- development enabled/cadence;
- soft Routine dossier detail budget: Auto or numeric 1–20;
- development connection profile and response allowance;
- tested relevant relationship/dossier limits.

Auto detail budget aims near four detailed records but expands for correctness. It is not a cap on updated/stored NPCs, and must not hide necessary third/fifth-character profile context. Do not add a separate profile-count control initially.

**S6. History safety, delayed checkpoints and explicit import**

Port checkpoint/recovery as a coherent subsystem, adapting it for delayed development commits.

Prove:
- Immediate and durable state plus observations/queue/replay state restore together.
- A late development result is checkpointed at its actual commit boundary, never inserted into a past snapshot.
- Rollback of that review restores pending work if its result is no longer present.
- Surviving suffix reconstruction uses owned history in order and no future evidence.
- User corrections/locks/portraits/manual deletion remain user-owned.
- Terminal death does not prevent correcting a mistake or undoing a removed death scene.
- Storage/CAS conflicts and history changes during saving never produce false success.
- Consolidation, dispositions and support links restore with their associated field revisions; rollback leaves neither orphan evidence links nor future-derived profile conclusions.
- Missing trustworthy baseline requires explicit recovery rather than fabricated history.

Implement an explicit importer for the documented selected Beta schema/version range using exported fixture copies. Preserve supported values and ownership; report unsupported/inconsistent fields. Establish a new labeled Alpha import baseline and replay boundary. Do not fabricate old checkpoints or provenance.

Never modify the Beta sidecar or silently activate Alpha. Document how the user switches automatic ownership between extensions and how to return to Beta without Alpha writing its data. Detect conflicting enabled writers where host capability permits.

**S7. Consolidate prompts and measure context cost**

Keep the roleplay prompt free of durable-review/audit rubrics. Keep routine development free of full fieldEvaluations. Keep complete source evidence and required comparison context within supported limits.

Serialize refs/values, locks and profile evidence once. Use bounded identity hints and detail preferences. Compile only exact recognized stock rubrics; preserve custom criteria intact or report supported-context limitations.

Implement optional structured adapters through C03's shared source boundary. First verify actual Megumin samples and preserve its field firewall. Inspect a real Freaky Frankenstein format or authoritative schema before implementing/enabling that adapter; if unavailable, document it as unsupported and complete the narration/Megumin path. Do not invent a parser from the product name. Record each claimed format/version and exact fixtures. Recognized malformed/control blocks must not fall through as visible evidence. Test current/stale/conflicting representations, same-event copies and absence of either suite. No additional source-discovery LLM call or hard dependency is permitted.

Demonstrate that a large retained development record does not automatically become a large prompt. Select necessary observations/supporting excerpts while preserving sufficient narrative context. New narrative must still permit facts in any eligible durable domain; insufficient comparison context causes a scoped deferral rather than an unsafe replacement or silent omission.

Do not apply semantic keyword gating to skip death, a new NPC, rare family facts or profile development. Do not create an LLM pre-classifier to make context selection appear cheaper.

Measure variant changes independently:
- minimal fast contract and continuity;
- focused development contract;
- consolidated context/stock defaults;
- soft dossier budget and batching.

Do not trade missed changes or additional retry work for a smaller first prompt.

**S8. Required behavioral and integration matrix**

| Area | Required outcomes |
| --- | --- |
| Immediate delta | Mood/location/goal/status/presentation update with omitted fields preserved; durable fields rejected on the fast path |
| Development delta | Supported durable changes/observations with live state, lifecycle, scores and presence untouched |
| Admission | Named/role-label policy, player exclusion, multiple NEW local refs, name promotion, ambiguous/structured-only identities |
| Capture | Missing/duplicate/malformed/truncated trailer, finalization, streaming/continuation, chat switch, edit/swipe and duplicate host events |
| Sources | Correct USER/ASSISTANT ownership, wrong/foreign/future source, stale lineage, trailer self-citation, structured-source firewall |
| Death | Grounded actual death, pronouns, possessive wrong-victim/negation fixtures, reversible form, no automatic resurrection or duplicate replacement, manual correction/rollback |
| Relationship | Explicit no-shift, independent positive/negative axes, exact owned evidence, caps/priority/inertia/progress/milestones, replay and manual ownership |
| Dynamic | Zero-score neutral establishment, wrong addressee, shared/quoted-you sources, historical review grounding and no Refresh bypass |
| Appearance | Current presentation preserved during late durable change, scoped forms, unknown form pending, no transient canonical rewrite |
| Evolution | Direct first-review facts, one-off observation, explicit/reinforced mannerisms, same-source replay, coherent single-scene support, later enrichment, sustained change and no arbitrary encounter threshold |
| Development record | Survives reload independently of visible Memories; tentative observation is not an accepted trait; explicit fact establishes without recurrence; support/contradiction links bind valid revisions; no extra collection/promotion call |
| Selective review | New fact outside existing field links remains discoverable; first-contact field menu retained; subset receipts do not clear excluded work; unresolved observation alone does not loop; deferred replacements preserve unseen existing values |
| Structured adapters | Verified format recognition, no-suite narration path, allowed field use, malformed-block quarantine, structured-only admission/death rejection, stale/conflicting context, no double recurrence from the same event copied into world state |
| Retention | Bounded selected context despite a larger record; consolidation preserves qualifications and contradictions; missing owned evidence defers; invalidated sources cannot survive through cached excerpts; pruning respects support/replay/checkpoint dependencies |
| Memories/graph | Distinct dated events, same-event refinement, durable registration/access, directional custom family/social ties, locked/unresolved endpoints, no invented members/reciprocity |
| Queue | New-NPC early trigger, cadence, coalescing, reload, partial target completion, zero-change receipt, backlog/unavailable source, bounded retries and no loss of pending evidence |
| Background concurrency | Later fast commit survives; same durable dependency change defers; unrelated live change permits valid commit; death/deletion/manual lock/source change rejects dependent stale work |
| Next-request availability | Completed review visible in next dispatch with zero retrieval scan calls; unfinished review does not block; post-dispatch commit leaves sent prompt unchanged; tentative observations never injected as established facts |
| Checkpoints | Late review actual boundary, tail deletion, middle divergence, surviving suffix, pending receipt rollback, no future knowledge and no false pre-import baseline |
| Persistence | Atomic source/updates/receipts, CAS conflicts, stale-before-save, changed-during-save, no false checkpoint or UI success |
| Settings/UI | Auto/numeric/invalid normalization, soft overflow, provider route failure, new-dossier pending display, conflicting extension ownership |
| Import | Documented fixture versions only, source sidecar unchanged, fresh namespace, preserved supported ownership, unsupported records reported, pre-baseline score replay blocked |
| Package/host | Reachable standalone files only, packaged module load, actual host lifecycle/capture and foreground-vs-background scheduling where executable |

Use existing-style controlled host/storage simulations and delayed promises. Port relevant Beta regression scenarios, updating expectations only where Alpha deliberately differs. Retain tests for wrong targets and malformed output even when mocked responses cannot prove semantic generation correctness.

Avoid brittle tests that mirror implementation. Prompt/example tests verify shape, while application/persistence tests verify behavior. Live model fixtures separately assess narrative extraction.

**S9. Performance and observability**

Implement one bounded diagnostics ledger per C16. Preserve provider usage if exposed; otherwise unavailable. Do not log full chat/prompts/credentials by default.

Create a fixture measurement command reporting exact assembled prompts, local estimates, context sizes and requested output limits. Create an opt-in live benchmark harness using configured host/provider access without hardcoded credentials or a runtime provider dependency.

Compare identical starting states, narratives, locks, settings and model parameters. Measure:
1. Roleplay first-visible latency, narrative completion, and total generated tokens.
2. Completion-to-immediate-commit duration and capture success.
3. Development reasoning/output/input tokens and request-to-commit latency.
4. Queue wait/backlog age and foreground interference.
5. Total requests/tokens across fast and development paths, including retries.
6. First-response fast accuracy and eventual durable accuracy.

Add multi-turn progression fixtures with equal source coverage and final backlog, including new admission, context-dependent speech, one-off mood versus lasting behavior, contradiction and accepted evolution. Report total input/output/reasoning tokens, requests and accepted coverage across the segment, including foreground overhead, retries and cancellations where usage is exposed. Include a repeated narration/world-state event and a large retained observation record. Compare selective context/batching against broader review using matched sources and evaluate deferred detail latency. Do not claim savings merely because one variant left more work pending.

Use simple continuation, one-field update, two-NPC interaction, new admission, profile evolution, terminal death, structured evidence and crowded scenes. Interleave variants; start with at least five repetitions per ordinary fixture when live access exists. Report model/provider configuration and sample size. Evaluate Gemini models separately.

The user's reported older sub-10-second and current 15–25-second timings motivate the work; they are not a gate or guaranteed result. Do not claim faster total generation merely because the separate routine scanner vanished. If provider access is absent, deliver executable fixtures and label live speed/accuracy unverified.

**S10. Repository workflow and release**

Use Node 22+ unless actual dependency constraints justify another supported baseline. Establish ordinary scripts:
- npm run validate — syntax, version/contract/docs consistency, dependency reachability;
- npm test — deterministic behavioral/host/persistence suite;
- npm run package — standalone installable ZIP;
- npm run measure:prompts — exact fast/development/audit fixture estimates.

Document actual script names in DEVELOPMENT.md and keep this workplan aligned if names differ. Add ordinary CI for validation/tests/package/measurements and package artifact upload. No temporary execution workflows or empty commits.

Suggested reviewable commits:
1. Foundation AGENTS/core/workplan documents.
2. Contract/registry/source/commit foundation with tests.
3. Working one-pass capture/application.
4. Development queue and safe late commits.
5. Domain completion, UI/settings, history/import.
6. Measurement, documentation, packaging and release fixes.

These are commit boundaries, not six mandatory published releases. The initial usable release target is 0.1.0; verify current Alpha version first and never reuse an occupied release label. Do not market an intermediate scaffold as complete.

For release:
- Run required checks on the exact candidate tree.
- Inspect the final diff once; fix concrete findings and rerun affected checks.
- Inspect the ZIP for reachable Alpha files, correct bootstrap/manifest identity and required licenses; exclude fixtures/dev docs and old repository trees.
- Document installation, host capability expectations, explicit Beta-to-Alpha switching, import, failure recovery and limitations.
- Re-read remote main before integration, preserve concurrent changes and protections, and verify ordinary CI for the exact final commit.
- Publish only through normal authorized release mechanisms after required gates pass.
- If execution is unavailable, complete authorized implementation/test/docs/commits, inspect exact-commit CI where possible, and leave unverifiable publication pending with a concrete blocker.

**Required final handoff**

Report actual baseline, resulting version/commit/PR, what is implemented, tests and host/provider checks executed versus unrun, request counts and measured performance, supported import scope, installation package, and publication state.

Explicitly demonstrate:
- Successful one-pass incurs no separate automatic fast scanner call.
- Focused review can take time without corrupting or blocking subsequent fast updates.
- Ordinary omission does not trigger exhaustive audits.
- Death is terminal automatically but correction/history rollback remains valid.
- No runtime dependency on Beta/legacy and no writes to their user data.
- Pending evidence cannot silently disappear or count twice.
- All accepted mutations pass one owned durable commit system.

Follow through to the usable implementation. Do not finish by proposing another redesign, recommending a model switch, or claiming a clean repository alone guarantees lower reasoning latency.
