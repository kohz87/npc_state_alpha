const base = Object.freeze({
  initialState: 'schema-valid canonical Alpha state',
  evidence: 'owned USER/ASSISTANT narrative unless stated otherwise',
  expectedTransition: 'only supported owned deltas apply',
  unchanged: 'unrelated NPCs/chats/fields remain unchanged',
  relationship: 'no numeric movement unless explicitly supported',
  lifecycle: 'no lifecycle change unless explicitly supported',
  development: 'pending/review state remains source-scoped and coherent',
  history: 'checkpoint/replay remains exact and idempotent',
  rejection: null,
  modelCall: false,
  deterministic: true,
  installedHost: false,
});

function s(id, subsystems, covers, overrides = {}) {
  return Object.freeze({ ...base, id, subsystems, covers, ...overrides });
}

/**
 * S8 behavioral evidence map. A single integration scenario may satisfy several
 * matrix requirements because S8 is explicitly about interacting valid features.
 */
export const S8_BEHAVIOR_MATRIX = Object.freeze([
  s('S8-A01', ['identity','history','multi-npc'], ['A06','A21','A25','H06','L05','O01'], {
    initialState: 'empty chat', evidence: 'two explicitly distinct same-name siblings admitted with separate localRefs',
    expectedTransition: 'two stable IDs remain distinct when proposal order later reverses',
  }),
  s('S8-A02', ['identity','aliases','history'], ['A03','A04','A17','A22','A23','H08','H16'], {
    initialState: 'two established NPCs', evidence: 'grounded alias edits including a shared alias, followed by ID-targeted updates',
    expectedTransition: 'aliases never merge stable IDs and replay preserves corrected identity ownership',
  }),
  s('S8-A03', ['identity','admission','wire'], ['A01','A02','A07','A08','A09','A10','A11','A12','A13','A14','A20','N07'], {
    evidence: 'pronoun/absence/action/observation/newcomer and atmosphere variants',
    expectedTransition: 'only explicit model-targeted stable IDs or policy-compliant NEW localRefs can mutate',
    modelCall: true,
  }),
  s('S8-A04', ['identity','presence','history'], ['A15','A16','A18','A19','A24','H14','H26'], {
    initialState: 'established NPC with pending evidence', evidence: 'leave/return plus edit/delete/swipe of admission source',
    expectedTransition: 'off-screen/return deltas apply without resurrecting deleted identity; removed admission removes dependent identity',
  }),
  s('S8-B01', ['presence','activity','live-state'], ['B01','B02','B03','B04','B05','B06','B07','B08','B09','B10','B11','B15','B16','B17','B18','B19'], {
    initialState: 'multi-NPC scene with mixed presence', evidence: 'speech/action/direct action/witness/scene transition and one materially changed NPC',
    expectedTransition: 'presence, activity, location, goal and status remain independent omission-preserving deltas',
    modelCall: true,
  }),
  s('S8-B02', ['live-state','development'], ['B12','B13','B14','F02','F26','F27'], {
    evidence: 'temporary fear/injury/recovery/sleep', expectedTransition: 'live mood/status may change while durable personality/behavior remains untouched',
    modelCall: true,
  }),
  s('S8-B03', ['structured-source','live-state'], ['B20','P01','P02','P03','P04'], {
    evidence: 'narrative plus verified World_State/Inner_Chatter segment fixtures',
    expectedTransition: 'only declared structured live corroboration is usable; source identity remains distinct',
  }),
  s('S8-C01', ['form','presentation','development'], ['C01','C02','C03','C04','C05','C06','C07','C08','C10','C11','C12','C13','C17'], {
    initialState: 'NPC with established forms', evidence: 'form transforms, disguise/clothing and appearance evidence',
    expectedTransition: 'Immediate selects established currentForm/presentation; Development alone evolves canonical appearance/forms',
    modelCall: true,
  }),
  s('S8-C02', ['form','history','authority'], ['C09','C14','C15'], {
    initialState: 'established form plus user appearance correction/lock', evidence: 'swipe removes transformation then automatic conflicting appearance arrives',
    expectedTransition: 'history restores selected form and explicit user lock remains authoritative',
  }),
  s('S8-C03', ['form','development','concurrency'], ['C16','G21','G22','G23'], {
    initialState: 'Development appearance review in flight', evidence: 'currentForm changes before provider result',
    expectedTransition: 'stale appearance proposal defers while unrelated newer live state survives',
  }),
  s('S8-D01', ['relationship','multi-npc'], ['D01','D02','D03','D04','D05','D06','D07','D08','D09','D10','D11','D12','D28','D29'], {
    evidence: 'positive/negative/fractional/multi-axis/no-shift and wrong-target interactions',
    expectedTransition: 'only target NPC supported axes move; NPC-to-NPC interaction does not score PLAYER',
    modelCall: true,
  }),
  s('S8-D02', ['relationship','history'], ['D13','D14','D15','D16','D19','D20','D21','D22','D23','D24','D25','D30','H04','H12','H21','H22'], {
    initialState: 'cumulative relationship history', evidence: 'equivalent replay plus positive/negative/neutral edit/delete/swipe A/B/A',
    expectedTransition: 'mechanics reconstruct exactly once with caps/inertia/progress/milestones and correct evidence',
  }),
  s('S8-D03', ['relationship','authority','development'], ['D17','D18','D26','D27','J03','J05'], {
    evidence: 'relationship lock/correction plus Development Relationship Dynamic',
    expectedTransition: 'numeric user authority remains separate from Development textual dynamic; malformed scoring is rejected',
  }),
  s('S8-E01', ['lifecycle','multi-npc'], ['E01','E02','E03','E04','E05','E06','E07','E08','E09','E10','E11','E12','E13','E14','E22','E24','E25'], {
    evidence: 'explicit/ambiguous/apparent/unconscious/metaphorical/rumored/possessive/mixed/multi-NPC death variants',
    expectedTransition: 'only grounded actual victim transitions to dead and incompatible live fields clear',
    modelCall: true,
  }),
  s('S8-E02', ['lifecycle','history','authority'], ['E15','E16','E17','E18','E19','E20','E23','H07','H15','H23','H24'], {
    initialState: 'confirmed-dead NPC with history', evidence: 'unsupported alive narration, user correction, edit/delete/swipe removing death',
    expectedTransition: 'forward auto-resurrection rejects; user/history authority can restore a legitimate pre-death state',
  }),
  s('S8-E03', ['lifecycle','development','concurrency'], ['E21','G24','G25','G26'], {
    initialState: 'Development request in flight around lifecycle change', evidence: 'death or death-removing swipe before completion',
    expectedTransition: 'dependent stale Development cannot commit and review work remains/requeues coherently',
  }),
  s('S8-F01', ['development','durability'], ['F01','F02','F03','F04','F05','F06','F07','F08','F09','F19','F20','F23','F24','F25','F26','F27','F30'], {
    evidence: 'explicit traits/speech/mannerism versus isolated/transient/repeated contextual behavior',
    expectedTransition: 'explicit durable facts have recall; transient behavior stays observation-only and count alone never promotes',
    modelCall: true,
  }),
  s('S8-F02', ['development','facts','graph'], ['F10','F11','F12','F13','F14','F15','F16','F17','F18','F21','F22'], {
    evidence: 'role/species/background/age/apparent age/birthday/family/social fact and correction variants',
    expectedTransition: 'string facts and directional social graph update only from supported source with stable collection operations',
    modelCall: true,
  }),
  s('S8-F03', ['development','appearance'], ['F28','F29','C05','C10','C11'], {
    evidence: 'temporary disguise plus supplied currentForm and durable appearance evidence',
    expectedTransition: 'disguise stays presentation; relevant currentForm informs but does not grant Development ownership of currentForm',
    modelCall: true,
  }),
  s('S8-G01', ['development','scheduler'], ['G01','G02','G03','G04','G05','G06','G07','G08','G09','G10','G11','G12','G13','G14'], {
    evidence: 'new/cadence/min/max/invalid/batch/multi-target/coalesced/manual control variants',
    expectedTransition: 'bounded oldest-first one-in-flight scheduler preserves pending scope',
  }),
  s('S8-G02', ['development','provider','failure'], ['G15','G16','G17','G18','G19','G20','G28','N11','N21','N24','N25'], {
    evidence: 'provider failure/malformed/missing profile/retry/source removal/cancel',
    expectedTransition: 'Development fails closed and remains pending while Immediate story path stays usable',
  }),
  s('S8-G03', ['development','concurrency','ui'], ['G21','G22','G23','G24','G25','G26','G27','G29','G30'], {
    initialState: 'in-flight Development plus active UI', evidence: 'new Immediate commit, dependency change, unrelated change, delete/death/swipe/chat switch',
    expectedTransition: 'provider waits hold no state lock; stale dependent work is cancelled/deferred and UI updates by events, not polling',
  }),
  s('S8-H01', ['history','edit-delete-swipe','multi-npc'], ['H01','H02','H03','H04','H05','H06','H07','H08','H09','H10','H11','H12','H13','H14','H15','H16','H17','H18','H19','H20','H21','H22','H23','H24','H25','H26','H27','H28','H29','H30'], {
    evidence: 'cross-feature edit/delete/swipe matrix on owned source positions',
    expectedTransition: 'latest verified prefix restores then surviving suffix replays without unrelated NPC mutation or double application',
  }),
  s('S8-I01', ['checkpoints','portability'], ['I01','I02','I03','I04','I05','I06','I07','I08','I09','I10'], {
    evidence: 'checkpoint reload/compaction/recovery around import_baseline',
    expectedTransition: 'chronology and protected import boundary survive compaction; pre-import automatic rollback blocks',
  }),
  s('S8-I02', ['portability','state-safety'], ['I11','I12','I13','I14','I15','I16','I17','I18','I19','I20','I21','I22','I23','I24','I25'], {
    evidence: 'native round-trip plus unsupported/non-lossless/exotic JSON values',
    expectedTransition: 'native parser is deterministic/fail-closed and never auto-installs or fabricates provenance/history',
  }),
  s('S8-J01', ['user-authority','history'], ['J01','J02','J03','J04','J05','J06','J07','J08','J09','J10','J11','J12','J13','J14','J18','J19','J20'], {
    evidence: 'live/durable/relationship correction, lock/unlock, later automation and reconstruction',
    expectedTransition: 'correction provenance survives but only explicit lock blocks future automatic evolution',
  }),
  s('S8-J02', ['tombstone','development','history'], ['J15','J16','J17','A24'], {
    initialState: 'user-deleted NPC with pending Development', evidence: 'history divergence and stale provider work',
    expectedTransition: 'tombstone survives reconstruction; pending/stale work cannot recreate or mutate the NPC',
  }),
  s('S8-K01', ['development-record','history'], ['K01','K02','K03','K04','K05','K06','K07','K08','K09','K10','K11','K12','K13','K14','K15','K16','K17','K18','K19','K20'], {
    evidence: 'observation/support/receipt lifecycle through review, failure, source invalidation and replay',
    expectedTransition: 'bookkeeping remains revision/source coherent, noncanonical observations never auto-promote, replay never duplicates',
  }),
  s('S8-L01', ['multi-npc','identity','relationship','lifecycle'], ['L01','L02','L03','L04','L05','L06','L07','L08','L09','L10','L11','L12','L13','L14','L15','L16','L18','L19','L20'], {
    initialState: 'three distinct NPCs', evidence: 'pronoun-heavy dialogue, sibling fact, different relationship axes, leave/transform/death/edit/swipe',
    expectedTransition: 'no cross-contamination of identity, live state, relationship, form, Development or history',
    modelCall: true,
  }),
  s('S8-L02', ['multi-npc','development','concurrency'], ['L12','L17','J16','K14'], {
    initialState: 'multiple pending targets', evidence: 'one target changes/deletes while another Development result is in flight',
    expectedTransition: 'only affected target defers/cancels; unaffected target is freshly reviewed and may commit',
  }),
  s('S8-M01', ['cross-chat','identity','state'], ['M01','M02','M03','M04','M05','M07','M08','M09','M10','M13','M14','M15'], {
    initialState: 'two chats with same name/alias/content positions', evidence: 'different relationships/lifecycle/form/pending/user edits then switch/reload/recovery',
    expectedTransition: 'chat namespace/provenance prevents any state leakage despite identical names/fingerprints/positions',
  }),
  s('S8-M02', ['cross-chat','provider','settings'], ['M06','M11','M12'], {
    initialState: 'Development work active in one chat', evidence: 'chat switch while provider waits with independently persisted profile selection',
    expectedTransition: 'old-chat result cannot commit into new chat and profile/runtime status remains correctly scoped',
  }),
  s('S8-N01', ['immediate-wire','failure'], ['N01','N02','N03','N04','N05','N06','N07','N08','N09','N10'], {
    evidence: 'missing/duplicate/malformed/unauthorized/wrong-source/relationship/NEW/nonterminal/truncated trailer variants',
    expectedTransition: 'visible story remains usable while invalid Immediate payload produces no canonical mutation',
  }),
  s('S8-N02', ['development-wire','failure'], ['N11','N12','N13','N14','N15','N16','N17','N18','N19','N20','N21','N22','N23','N24','N25'], {
    evidence: 'malformed/generic/sourceId/bad receipt/disposition/age/support/collection/target/scoring/stale/tombstone/operation/cancel/failure',
    expectedTransition: 'invalid or stale Development result fails closed without partial mutation or false receipt',
  }),
  s('S8-O01', ['replay','dedupe','idempotence'], ['O01','O02','O03','O04','O05','O06','O07','O08','O09','O10','O11','O12','O13','O14'], {
    evidence: 'duplicate callbacks/reloads/recovery/receipts/relationship/observations/swipe/init/manual triggers',
    expectedTransition: 'same accepted event produces the same canonical state exactly once',
  }),
  s('S8-P01', ['structured-source','authority'], ['P01','P02','P03','P04'], {
    evidence: 'verified World_State and Inner_Chatter fixtures plus narrative',
    expectedTransition: 'structured segments remain distinguishable and permitted corroboration may participate',
  }),
  s('S8-P02', ['structured-source','rejection'], ['P05','P06','P07','P08','P09','P10','P11','P12'], {
    evidence: 'structured-only admission/presence/action/speech/death/durable attempts and unverified/malformed dialects',
    expectedTransition: 'structured authority cannot broaden itself; malformed/unknown blocks quarantine',
    rejection: 'unauthorized structured proposal rejected before mutation',
  }),

  s('S8-LF01', ['longform','identity','relationship','development','history'], ['LF01'], {
    initialState: 'empty story', evidence: 'admission -> ordinary interaction -> relationship -> Development -> later edit -> reconstruction',
    expectedTransition: 'stable identity and only surviving relationship/durable evidence remain after reconstruction',
  }),
  s('S8-LF02', ['longform','multi-npc','form','lifecycle','history'], ['LF02'], {
    evidence: 'two NPCs -> transform/leave -> relationship -> death ambiguity -> clear death -> survival swipe',
    expectedTransition: 'only selected revision and affected NPC state survive',
  }),
  s('S8-LF03', ['longform','development','user-authority'], ['LF03'], {
    initialState: 'rich mature NPC', evidence: 'narrow contradiction -> Development refinement -> user correction+lock -> conflicting evidence',
    expectedTransition: 'rich unrelated canon remains; locked correction wins',
  }),
  s('S8-LF04', ['longform','multi-npc','graph','tombstone'], ['LF04'], {
    initialState: 'three NPCs', evidence: 'pronouns -> separate relationships -> sibling graph -> one tombstone -> pending cleanup',
    expectedTransition: 'unrelated survivors remain coherent and deleted target has no orphan work',
  }),
  s('S8-LF05', ['longform','development','concurrency','history'], ['LF05'], {
    evidence: 'Development launched -> newer exchange -> source edit -> late result',
    expectedTransition: 'dependency revalidation rejects stale work and requeues only required scope',
  }),
  s('S8-LF06', ['longform','relationship','history'], ['LF06'], {
    initialState: 'long cumulative relationship', evidence: 'fractional progress -> milestone -> older event swipe -> unrelated later event',
    expectedTransition: 'relationship recomputes exactly while unrelated later event survives',
  }),
  s('S8-LF07', ['longform','lifecycle','history'], ['LF07'], {
    evidence: 'death -> durable history -> unsupported alive narration -> swipe removes death',
    expectedTransition: 'automatic resurrection rejects but history authority restores legitimate living state',
  }),
  s('S8-LF08', ['longform','cross-chat','development'], ['LF08'], {
    initialState: 'same-name NPCs in two chats', evidence: 'distinct relationships/forms/pending -> switching -> reload',
    expectedTransition: 'no chat contamination before or after reload',
  }),
]);

export const S8_MATRIX_GROUPS = Object.freeze('ABCDEFGHIJKLMNOP'.split(''));
