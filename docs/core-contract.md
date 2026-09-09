# NPC State Alpha — architecture core

**Contract status:** intended Alpha v1 behavior, established before implementation. This document specifies the target; it is not evidence that the features already exist. Initial release target is 0.1.0 unless the repository has advanced. Storage schema, settings schema and each model wire contract have independent explicit versions.

**C01. Purpose and scope**

Alpha is a standalone SillyTavern NPC continuity extension. It combines a small structured delta emitted with the roleplay response and a separate focused review for durable dossier development.

Immediate scene state should be available after a short local validate/save step. Durable review may take longer and must not block the next roleplay request. Neither path performs an exhaustive routine audit of untouched fields.

The existing Beta extension remains an independent reference/fallback. Alpha has no runtime/build dependency on it. Source reuse is permitted only after dependency tracing and adaptation. User data is isolated under an Alpha-specific namespace such as `npc_state_alpha.v1`, with distinct sidecar filenames and extension/API identity.

**C02. Canonical ownership**

All model proposals enter a shared source resolver, validator, field application layer and owned commit coordinator. Wire envelopes can differ by purpose; proposal semantics and field permissions must have one registry owner.

| Domain | Automatic writer | Rule |
| --- | --- | --- |
| NPC identity/admission, canonical name and aliases | One-pass | Grounded individual and policy-compliant admission; stable stored IDs assigned locally |
| Exchange activity, final in-scene presence, off-screen activity | One-pass | Separate semantic proposals; not inferred from dossier output or name mentions |
| mood, location, goal, activity/status | One-pass | Current supported state, changed fields only |
| currentPresentation | One-pass | Current observed visual presentation, including clothing/condition; does not rewrite durable anatomy/profile |
| currentForm | One-pass | Select an established form identifier; unknown form remains unresolved while observed presentation can still be captured |
| Numeric relationship proposals toward PLAYER | One-pass | Axis meaning and impact are model-owned; mechanical scoring is runtime-owned |
| Death/lifecycle | One-pass | Immediate source-grounded proposals; automatic death is terminal |
| Relationship Dynamic | Development scan | Source-grounded NPC-to-player interpretation; does not score the relationship |
| Canonical appearance and appearance-form definitions | Development scan | Supported durable synthesis and scoped form edits |
| Personality, behavioral profile, characteristic speech, mannerisms | Development scan | Establish, enrich or evolve with appropriate evidence |
| Role, species, background, actual/apparent age, birthday | Development scan | Supported durable facts; no invented history, age arithmetic or birthday |
| Important memories | Development scan | Durable event/fact selection and model-led same-event consolidation |
| Significant non-player relationships, social and family facts | Development scan | One coordinated directional graph/dossier transaction; no player scoring |
| Profile observations | Development scan | Tentative evidence, not automatic durable profile mutation |
| Pending review entries and receipts | Runtime | Owned source references and processing state, not narrative facts |
| Portrait attachments, importance, settings, manual corrections/locks | User/runtime | Never model-inferred |

A role label used to identify an unnamed individual is identity context; it does not create a second ordinary Role writer. New durable facts can be learned at the first development review; they need not wait for recurrence.

Known durable appearance plus current presentation form the displayed appearance. Presentation does not mechanically erase canonical traits. If a new form is observed before its definition is reviewed, preserve the directly observed current presentation and leave the form selector unresolved; never invent a form ID or force the old anatomy into the current scene.

Explicit manual operations have narrower declared scopes rather than bypass flags. No hidden automatic cross-domain writer is permitted.

**C03. Source identity and authority**

A numeric message position is an address, not sufficient identity. Own every operation and accepted source using chat/sidecar identity, source position, role, canonical content fingerprint, swipe/revision information where available, and preceding lineage.

Capture the user source and request lineage before roleplay dispatch. Bind the assistant source only when its final completed revision is available. If request lineage changed during generation, discard the stale proposal. Host completion events do not independently authorize duplicate application.

Model sources use request-supplied references and exact excerpts. One-pass may use reserved references `current:user` and `current:assistant`; runtime resolves them to the owned request user and completed assistant narrative. Development requests assign compact references to each included owned message. Do not ask the model to calculate fingerprints or future message IDs.

Runtime resolves supplied references and verifies excerpts against permitted source segments; it never invents citations or searches for semantically similar replacement evidence. Define a conservative normalization policy once and test it. Preserve original source identity across formatting normalization.

The authoritative assistant narrative excludes Alpha's machine trailer. The trailer cannot cite itself or become story evidence, and future roleplay prompts must not replay it as narrative. Transport exclusion must be deterministic, narrowly scoped and identical across parsing, fingerprinting and prompt assembly.

Visible USER/ASSISTANT narrative supports ordinary meaning. Optional structured sources have declared authority: World_State may corroborate live location/status/placement; Inner_Chatter may support private mood/goal and appropriate relationship interpretation. Neither independently admits an NPC, proves physical presence, establishes visible gestures/speech or rewrites durable canon. Other control/import/dossier blocks are excluded from automatic narrative extraction. Keep structured-only death out of automatic authority in the initial Alpha contract; death needs owned narrative evidence.

Source membership proves provenance, not entailment. Identity, negation, actual victim, durable pattern and relationship meaning remain model judgments. Do not claim an exact quote prevents every semantic error.

**C04. One-pass wire and capture**

The roleplay model receives compact continuity and a concise immediate-delta contract. It produces ordinary narrative followed by exactly one `<npc_state_alpha_v1>...</npc_state_alpha_v1>` JSON trailer at the end.

One contract module defines version, minimal envelope, allowed fields and literal examples. Keep identity, presence, live semantic updates, numeric relationship proposals and lifecycle as distinct channels within this compact envelope. No exhaustive fieldEvaluations, evaluatedGroups, profile dossier rewrite, or candidate audit is requested here.

Existing records use supplied stable IDs. NEW rows use an empty stored ID, canonical human-facing name, identity kind and grounded identity evidence; runtime assigns IDs and resolves references atomically. Use an explicit per-envelope local identity reference if needed to distinguish multiple NEW people. Never resolve ambiguous duplicate names by array order.

Sources accompany proposed changes. Identity/activity evidence must bind the appropriate individual and domain. Every claimed exchange-active NPC receives an explicit relationship evaluation; an explicit no-shift form expands to mechanical zero axes. Missing evaluation is not fabricated zero judgment.

Only finalized host output can mutate state. Implement final/streamed/continued/swiped response handling against actual host APIs, with a capability check. Strip or hide only the recognized trailer in rendering/injection while preserving recoverable extraction bytes until durable commit. Do not remove narrative, alter lineage accidentally, or rewrite raw chat destructively to conceal a malformed trailer.

Absent, duplicate, truncated or malformed envelopes are explicit extraction failures. Never extract an arbitrary inner brace fragment or repair it by guessing. The visible story remains available. No default dedicated fallback or roleplay regeneration is issued automatically.

For structurally valid output, independent accepted proposals may commit atomically with rejection diagnostics; coupled identity/domain dependencies fail together. A failed admission cannot leave orphan scores, presence or observations. Manual Retry immediate update uses the exact owned exchange and the same fast-domain validator; it does not regenerate the story, score twice or update the durable dossier.

After successful fast commit, state and pending development records become durable together. A missing fast envelope cannot be silently marked processed. A later owned exchange can proceed using the last committed continuity when branch safety permits, with visible extraction failure status; persistence/ownership conflicts must never be presented as synchronized success.

**C05. Delta and field application**

Omission preserves. Empty proposal lists are valid no-ops. Missing fields do not mean cleared, unknown, unchanged, unavailable or evaluated.

Updates use establish/refine/replace/remove semantics where appropriate. Collections use explicit add/replace/remove operations with stable entry refs or exact expected values; whole-collection clear requires explicit supported authority. A limit never evicts unrelated entries merely to make room.

New scalar values are supported resulting values, not arbitrary fragments. A refined canonical appearance retains prior uncontradicted traits. Model-led memory/profile consolidation preserves distinct facts and qualifications.

Maintain explicit per-field/domain revisions or equivalent conflict tokens derived from actual changes. Locks and manual correction ownership are separate: corrections survive rollback, while an automatic-update lock controls future writes. Do not freeze corrected fields implicitly.

Stable-ID match alone is not proof of narrative identity for a new proposal. Admission policies should preserve named-preferred, balanced unique role-label, and manual-only modes where implemented, with one policy owner.

**C06. Terminal death**

Alpha's initial narrative premise has no resurrection. Automatic alive/unknown -> dead proposals require grounded current narrative, a model-owned target and sufficient certainty. Direct does not mean regex-derived.

Accepted death immediately archives the dossier from living presence/activity while retaining history and identity. Clear active/live-action state only according to the documented death projection; historical last-known location and durable facts remain available. Reject incompatible final worldActive/inChat claims for confirmed-dead NPCs.

Automatic dead -> alive is forbidden. Do not retain livingReturn as a supported automatic channel. Reject contradictory lifecycle structure rather than choosing a winning property. A return-looking scene involving a dead identity is reported as a conflict, not admitted as a duplicate person.

User correction and rollback to a surviving pre-death history may restore alive. They are correction/history authorities, not narrative resurrection. A new complete rebuild must not quietly derive fresh death from arbitrary legacy Status text; legacy inconsistent records are handled in the explicit importer/reconciliation report.

**C07. Relationship authority**

Fast proposals describe changes in this NPC toward PLAYER, with independent Trust/Affection/Desire/Tension axes, semantic impact, per-axis supporting sources and concise explanations. Preserve symmetric positive/negative judgment and separate axis meanings.

Runtime applies supported caps, axis priority, inertia, fractional progress, milestones, manual ownership and replay protection from tested mechanics. Import only coherent mechanical dependencies; do not import Beta's exhaustive scanner obligations or weak evidence shortcuts.

Development Relationship Dynamic uses exact permitted sources and NPC-to-player binding. It can establish neutral professional/adversarial/etc. context at zero numeric movement. Existing unchanged text is omitted. New/changed text cannot bypass grounding because the operation is Refresh or review. Numeric scores/context alone do not justify invented intimacy.

Development reads accepted relationship context as context, never a fresh scoring event. Its result cannot modify numeric scores, progress, milestones or scoring history.

**C08. Development review**

Review a bounded set of pending, owned exchanges for supplied accepted NPC identities. Ask what durable facts are established, which supported patterns become clearer, and which observations remain tentative. Routine review remains delta-oriented; it does not classify every untouched field.

A target row with no proposals is a valid explicit review receipt. Require a bounded acknowledgment for each supplied target, not a per-field negative list. Runtime records that the supplied source scope was reviewed; it must not describe this as proof that every possible fact was extracted.

Capture direct durable facts on their first review. Gradual does not mean artificial delay. Unknown values stay unknown. Personality/behavior can be established narrowly from explicit characterization or coherent supporting actions. One isolated expressive gesture normally remains an observation; mannerism add/replace requires explicit or reinforced establishment.

Saved observations plus new evidence may support synthesis. A repeated request, repeated quote, or continued narration of one action does not become independent recurrence. One exchange may contain distinct observations without becoming multiple longitudinal events. Compatible enrichment does not require a personality transformation. Contradictory lasting development needs appropriate sustained or explicit evidence.

Memories retain consequential promises, rescues, betrayals, discoveries, obligations, lasting registrations/credentials and other relevant durable events. Model proposals own same-event refinement; runtime deduplicates owned replays and exact normalized duplicates without token-overlap semantic inference.

Key relationships/social/family facts remain non-player, directional, source-grounded and lock-aware. No invented gender, biology, members, reciprocity or count-to-person expansion. Make connected graph/dossier updates atomic; a blocked counterpart must not leave a contradictory half-edge.

**C09. Pending evidence and scheduling**

Persist a compact pending-review ledger in the same Alpha sidecar. Entries refer to accepted identities and immutable owned exchanges; they do not duplicate full raw chat or create a second general memory store. Store bounded observations in the existing-style profile evidence store after review.

Represent pending per-target/source scope so partial batches cannot mark unseen NPCs or later exchanges reviewed. Failed/unresolved immediate extraction remains separately visible; do not silently manufacture admission in the development scanner.

Initial settings:
- Development review enabled: On.
- Existing-NPC cadence: every 3 successfully committed immediate exchanges; configurable integer 1–10.
- Newly admitted NPC: eligible for an early review immediately after fast commit, independent of cadence.
- Manual Review pending: drains existing bounded work when requested.
- Maximum one background development provider request in flight per active chat.
- Each request initially covers up to 6 pending exchanges, oldest first, with smaller groups when required by the supported context budget. These are batch sizes, not permission to discard pending evidence.

These defaults are starting engineering choices, not latency guarantees. Compile them through one settings registry. Coalesce triggers; do not restart or duplicate a running batch when another turn arrives. Do not add per-field model calls, keyword-based triggers, or an additional classifier.

The background queue never gates the next roleplay request. It never holds the state/commit lock while waiting for a provider. Actual host generation services must support nonblocking dispatch or safe yielding: when they serialize requests, foreground generation takes priority and background work stays pending. An in-flight review must yield or cancel safely when required to release foreground capacity. If a route cannot support that behavior, report the capability limitation and keep automatic review pending rather than silently blocking the story; idle-time detection alone does not guarantee foreground priority. Verify this in host integration; an async JavaScript function alone does not prove nonblocking service behavior.

A transient failure remains pending with bounded diagnostics. Do not automatically retry the same failed batch in a tight loop. Reattempt on a later normal trigger or explicit Retry, with coalescing/backoff. One malformed-response retry per logical review batch may be supported, counted and bounded; never cascade into per-NPC rescue calls.

Keep the ledger bounded by compact range/receipt representation and explicit backlog controls. Never silently evict unreviewed sources. If backlog exceeds supported limits, retain a durable pending-range marker and report backlog/paused status until reviewed or explicitly dismissed. If source text is no longer available, mark that scope unavailable; never replace it with an unrelated summary or fabricated evidence. Trim receipts/observations only under documented safe retention rules.

**C10. Concurrency and commit boundary**

Capture source dependencies, target identity, read-field/domain revisions and intended operation authority at review dispatch. Validate provider results outside the commit lock, then revalidate all dependencies at commit against the latest durable state.

A valid appended later exchange does not invalidate the earlier immutable source prefix by itself. Apply field-scoped proposals to the latest state; never replace it with the old whole-state snapshot used for inference. Fast live updates must survive a late durable commit.

If a development proposal's relevant read dependencies changed—for example its target profile, identity, lock, canonical form or Relationship Dynamic's accepted relationship context—discard/defer that affected work for a fresh review. No semantic merge, silent last-writer-wins, or whole-job retry merely because an unrelated live field changed.

Recheck source lineage, target existence/tombstones, terminal lifecycle applicability and locks. Do not apply a delayed pre-death present-tense dynamic as if the NPC were alive; dependent work needs current context or stays unresolved. Historical memories of the surviving source may still be valid.

Accepted proposals, observations, queue receipts, scoring replay keys and the resulting story checkpoint commit atomically. Mark reviewed only scopes successfully processed under their declared authority. A persistence/CAS failure creates no success receipt or checkpoint. If history changes during saving, retain the established saved-but-unowned reconciliation block rather than advertising the write as current.

Operational leases, storage revisions, writer locks and in-flight jobs are not historical story state. Invalidations cancel/discard work; stale jobs cannot overwrite newer UI status.

**C11. History, checkpoints and correction**

Use one complete story snapshot/checkpoint system for admission, live/durable state, relationships, lifecycle, graphs, memories, observations, replay records and pending/reviewed work.

Each checkpoint records the actual current history boundary at which its state is committed plus source dependencies. A development result based on earlier exchanges must not be inserted retroactively into an old checkpoint or future evidence attributed to an earlier source. A later checkpoint may include that accepted result at its real commit boundary.

Tail deletion restores the latest verified surviving boundary. Middle edit/deletion or reused-position swipe invalidates affected lineage and restores a valid prefix before reconstructing the surviving suffix. If rollback removes a later review commit, restore its pending work from the checkpoint and recompute as needed; do not falsely keep reviewed receipts without the corresponding state.

User settings, portraits, manual corrections, explicit locks and manual deletion tombstones retain their defined user ownership across story rollback. Story resurrection is forbidden; undoing a removed death scene or correcting a mistake is allowed.

Reconstruction replays owned surviving sources in order using explicit repair/recovery operations and no future context. It must not regenerate roleplay, count a source twice or use today's dossier as an invented past baseline. When a trustworthy baseline is missing, block automatic reconciliation and expose explicit recovery choices.

**C12. Manual operations and completeness**

- Retry immediate update: current owned exchange, fast fields only, existing replay/source safeguards.
- Review pending: durable development only, bounded pending scope.
- Recheck missing details: requested eligible blank durable fields against explicitly supplied scope.
- Refresh dossier: selected durable dossier and bounded history, with exhaustive field-level accounting for eligible target fields.
- Recovery/rebuild: explicit owned surviving history reconstruction through both authorities in sequence.

These operations reuse the same registry, source resolver and commit boundary. Audit modes report applied/rejected/unchanged/insufficient/unavailable/unaccounted; routine fast and development deltas do not.

Manual Refresh cannot change numeric scores, presence or lifecycle through a broad reconciliation bypass. User editor corrections use a distinct explicit manual authority. No automatic full-dossier scan or historical backfill follows every roleplay turn.

**C13. Context and model-facing cost**

One compact continuity projection serves the roleplay model: relevant identities, current state and a small relevant durable context, followed by the fast contract. No full development extraction rubric belongs there.

Development gets the target comparison values, relevant owned observations, exact edit refs, locks and bounded pending narratives. Include each ref/value/lock/evidence record once. Current/source text is complete within supported request limits; unavailable context is marked rather than treated as blank.

A single Routine dossier detail budget setting defaults to Auto, with numeric preference 1–20. Auto aims near four detailed existing records in ordinary scenes. This is a soft context preference, not a maximum stored/updated NPC count. Relevant identity ambiguities, participants and required comparison details may exceed it. Supply lightweight identity context for additional relevant records, including deceased identities. Never drop a fifth NPC's supported change merely to enforce four.

Do not add a separate user-facing profile-count setting initially. Background batch/cadence controls and relevant detail selection serve different purposes; keep names clear.

Use exact recognized stock-default compilation and concise mode-specific examples. Preserve user-custom criteria intact within supported budgets; report a genuine limit instead of silently truncating policy. Do not use a model to summarize user instructions or semantic keyword gates to hide rare channels.

**C14. Settings, UI and installation**

Use a single settings registry for defaults, normalization and UI controls. Initial settings include enabled, admission policy, development enable/cadence, soft dossier budget, development connection, review response limit, and supported existing relationship/dossier limits. Keep secondary-provider routing fail-closed: a missing selected profile must not silently spend requests on the primary connection.

Immediate extraction uses the roleplay generation's connection. Development uses a selected host connection profile or Current connection subject to foreground priority. No stored API credentials or undocumented provider calls.

Minimal UI: dossier list with presence/life state, separate current presentation and durable profile display, review pending/running/failed status, Review pending/Retry immediate/Refresh, manual editor/locks, and diagnostics. Show historical/imported/unknown state honestly without dumping implementation metadata into narrative-facing text.

Alpha and Beta may coexist as installed files, but only one automatic continuity/extraction owner may be active for a chat. Detect known competing enabled ownership where host capability permits and show a clear conflict; do not silently disable Beta or overwrite its data. Document the user-controlled switch.

**C15. Compatibility and import boundary**

Initial Alpha supports its own v1 contracts. Do not advertise drop-in compatibility with Beta settings, APIs, embedded dialects or sidecar filenames.

Implement an explicit importer for the selected supported Beta schema/version range only after verifying real fixtures. It reads an exported copy into a fresh Alpha namespace, maps documented values/locks/user corrections/portraits where supported, and reports unsupported or inconsistent records. It does not mutate the source database or automatically activate Alpha.

Do not fabricate provenance, historical checkpoints or observed timestamps for imported fields. Establish a clearly labeled import baseline at the chosen current history boundary. Prevent pre-baseline accepted history from being automatically scored as new; rollback before a proven import baseline requires explicit recovery. Unsupported old timeline metadata is not silently declared trustworthy.

Retain only current functional tombstones and narrowly documented import adapters. No runtime legacy directory, wholesale Beta API facade or automatic migration at startup.

**C16. Diagnostics and performance**

Use one bounded runtime operation ledger. Record operation/mode, model route identity where exposed, request counts, queue/provider/apply/save durations, fast capture failures, reviewed scope, pending backlog, proposed/applied/rejected fields and conflicts.

Capture provider input/output/reasoning usage only when actually exposed by host services. Missing usage is unavailable. Avoid double-counting reasoning inside provider completion totals. Full prompts/chat/credentials are not logged by default.

Measure:
- Time to first visible roleplay output and completion.
- Time from roleplay completion to committed immediate state.
- Background review request/commit duration and backlog age.
- Total tokens/requests across both paths.
- First-response extraction correctness and eventual durable correctness.

Compare no-extension/continuity-only, Beta reference and Alpha variants under identical narratives, state/settings/models where feasible. A lower scanner latency does not prove lower total cost or faster visible generation. Sub-10-second thinking and 30–50% reasoning reduction are hypotheses for experiments, never claims without measurements.

**C17. Porting and maintainability**

Reference Beta v0.5.38 commit 044cd42effa5c80a2e5f0facc6deeffa106ade01 and legacy repository a12b2937b5c1305e3e3017218a626478a5bedcdc as reviewed baselines; verify current refs before selecting source.

Candidate reuse: pure field normalization, relationship mechanics, source identity, storage/CAS, correction ownership and checkpoint algorithms, plus relevant fixtures. Rebuild prompt/capture/orchestration and operation policies around Alpha.

Some legacy code passed tests for behavior Alpha intentionally rejects. Port invariants and regression scenarios, not all old expectations. Source membership is not semantic target proof; review/Refresh permission never bypasses grounding. Do not port a livingReturn bridge, full routine field audit, silent fallback, old auto-backfill loop or lexical profile evidence matcher.

Maintain source provenance/license notes in development documentation. Use bounded cohesive modules; module count is not a cleanliness metric.

**C18. Release acceptance**

A release is usable only after the full user path, host capture, both update authorities, settings, persistence, history recovery, import behavior claimed for that release, and package loading are verified.

Required gates: syntax/contract consistency, behavioral tests, dependency reachability/package load, exact prompt examples through production paths, request-count/concurrency regressions, and prompt-size measurement. Add real host/provider smoke results when access exists; otherwise report those as unrun and do not imply mocks validate live performance.

No real user data reset/rebuild is part of validation. An initial scaffold is not a deployment. Release documentation states actual implemented scope, limitations, installation/switch/rollback instructions and the exact verified commit.
