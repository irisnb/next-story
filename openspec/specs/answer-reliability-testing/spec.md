# answer-reliability-testing Specification

## Purpose
定义回答可靠性测试器的案例格式、真实 DSH driver 执行、证据保存、密钥保护、保守自动初筛和人工复核边界。
## Requirements
### Requirement: Structured reliability cases
The tester SHALL load repeatable reliability cases from version-controlled JSON or JSONL files, and each case MUST identify its material version and hash, conversation steps, question, expected factual boundary, allowed uncertainty, explicitly wrong conclusions, evidence locations, and risk tags.

#### Scenario: Load a valid case
- **WHEN** the runner loads a case containing the required fields
- **THEN** it SHALL validate the case and make it available for execution without changing the case file

#### Scenario: Reject an incomplete case
- **WHEN** a case is missing its identifier, material identity, or question
- **THEN** the runner SHALL report a case validation error and SHALL NOT send that case to the DSH driver

### Requirement: Real driver execution
The tester SHALL execute selected cases through the existing JSONL DSH driver protocol and SHALL support single-turn, multi-turn, and version-specific case inputs without changing the production driver contract.

#### Scenario: Execute a single-turn case
- **WHEN** a valid single-turn case is selected and the driver completes its message
- **THEN** the runner SHALL record the complete assistant response and the message terminal state

#### Scenario: Execute a multi-turn case
- **WHEN** a case contains multiple ordered conversation steps
- **THEN** the runner SHALL send them in order within the same test session and SHALL associate each response with its case step

### Requirement: Evidence preservation
The tester SHALL write an independent evidence record for each case run containing the case identity, material identity, model and non-sensitive configuration summary, timing, protocol outcome, assistant responses, relevant event summary, automatic result, and result explanation.

#### Scenario: Successful evidence record
- **WHEN** a case finishes with a model response
- **THEN** the evidence record SHALL be readable without rerunning the model and SHALL contain the complete response text

#### Scenario: Runtime failure evidence
- **WHEN** the driver times out, exits early, emits a protocol error, or returns a failed message
- **THEN** the evidence record SHALL preserve the failure category and diagnostic message and SHALL distinguish it from a model-answer failure

### Requirement: Secret protection
The tester SHALL require the API key through the existing environment-based configuration and SHALL NOT write the key into cases, reports, evidence, stdout summaries, or stderr diagnostics.

#### Scenario: Key does not enter evidence
- **WHEN** a case is executed with an API key configured
- **THEN** no evidence field or serialized diagnostic SHALL contain the key value

### Requirement: Conservative automatic screening
The tester SHALL produce one of `PASS_LIKELY`, `FAIL_LIKELY`, `NEEDS_REVIEW`, or `RUNTIME_ERROR`, and SHALL use `NEEDS_REVIEW` whenever the available deterministic evidence cannot safely distinguish a correct answer from a negation, quotation, uncertainty, or fact-versus-inference ambiguity. Before applying screening rules, the tester SHALL normalize the answer text by stripping markdown formatting markers (such as `**`, `*`, `>`, `#`, and backticks) so that a phrase broken by formatting is still recognized as contiguous. When evaluating a target phrase, the screening rules SHALL consider all occurrences of that phrase in the normalized answer: a quoted occurrence that is explicitly negated SHALL satisfy a required negation boundary only when no unquoted, affirmative occurrence contradicts it; a quoted or negated wrong conclusion SHALL NOT by itself produce `FAIL_LIKELY`. For a `mustContain` phrase, a quoted occurrence SHALL count as a satisfied occurrence unless it is negated; for `wrongConclusions` and `mustNegate`, a quoted occurrence SHALL NOT by itself count as an assertion. Negation detection SHALL recognize both direct negation markers and verbs that express leaving or stopping a prior state (such as 辞去、辞职、离职、离开、放弃、停止、不再、退出、卸任、终止、中断), so that an answer like 「辞去了盐镇中学的工作」 is treated as negating the superseded fact 「在盐镇中学教书」 rather than asserting it. Uncertainty detection SHALL recognize explicit unknown markers including 未知、未提及、无法得知、无法确定、没有提供、没有出现、文中没有、未提供 and their equivalents. Inferential wording (可能、推断、似乎) SHALL NOT by itself force `NEEDS_REVIEW` when the factual boundary is otherwise clearly met and no wrong conclusion is asserted.

For a `mustContain` phrase whose contiguous matching fails, the screening SHALL attempt bounded-gap subsequence matching before falling back to `NEEDS_REVIEW`: the phrase's characters SHALL be located in order in the normalized answer, and the occurrence satisfies the boundary only when every gap between consecutive matched segments (1) contains no clause boundary punctuation (，。；！？、：… and newline), (2) is at most 8 characters long, and (3) contains no negation or past-state marker (such as 不、没、非、无、未、不曾、不再是、曾、原来、以前、前、已经、已). Gap matching SHALL apply to `mustContain` satisfaction only; `wrongConclusions` and `mustNegate` SHALL keep contiguous matching.

For a `mustNegate` entry whose oracle declares `negationEquivalents`, the negation boundary SHALL be satisfied when the original phrase is negated under the rules above, OR when any declared equivalent phrase occurs in the answer with a direct negation marker or a leaving/stopping verb in its preceding window, provided the original phrase itself has no unquoted, affirmative occurrence in the answer.

#### Scenario: Deterministic runtime result
- **WHEN** the driver fails to start, times out, exits unexpectedly, or returns an invalid terminal state
- **THEN** the automatic result SHALL be `RUNTIME_ERROR`

#### Scenario: Ambiguous natural-language answer
- **WHEN** an answer contains a potentially quoted, negated, uncertain, or inferential claim that the rules cannot safely resolve
- **THEN** the automatic result SHALL be `NEEDS_REVIEW` and SHALL include an explanation of the unresolved condition

#### Scenario: Clear factual boundary match
- **WHEN** the answer clearly matches the case's expected factual boundary and does not assert an explicitly wrong conclusion
- **THEN** the automatic result MAY be `PASS_LIKELY` with a reason pointing to the matched evidence

#### Scenario: Explicit negation inside a quotation
- **WHEN** an answer quotes text that explicitly negates a target phrase required by `mustNegate`, and the answer contains no unquoted affirmative assertion of that target phrase
- **THEN** the screening SHALL treat the negation boundary as satisfied and SHALL NOT add a missing-negation reason solely because the target phrase was quoted

#### Scenario: Quoted negation followed by an affirmative contradiction
- **WHEN** an answer quotes a negation of a target phrase but later makes an unquoted affirmative assertion of that same target phrase
- **THEN** the screening SHALL NOT return `PASS_LIKELY` based only on the quoted negation and SHALL return `FAIL_LIKELY` or `NEEDS_REVIEW` according to the remaining deterministic evidence

#### Scenario: Wrong conclusion only quoted or negated
- **WHEN** an explicitly wrong conclusion appears only inside a quotation or a negated statement
- **THEN** the screening SHALL NOT classify the answer as `FAIL_LIKELY` solely because that phrase appears

#### Scenario: Leaving-a-state verb negates a superseded fact
- **WHEN** an answer expresses leaving or stopping a prior state with a verb such as 辞去、离开、放弃、停止、退出 or 不再 immediately before the superseded fact's phrase
- **THEN** the screening SHALL treat that occurrence as negated and SHALL NOT classify the superseded fact as asserted

#### Scenario: Markdown formatting does not break phrase matching
- **WHEN** the answer contains markdown markers such as `**不在**` that split a target phrase
- **THEN** the screening SHALL strip those markers and recognize the underlying contiguous phrase when classifying negation or presence

#### Scenario: Quoted correct fact satisfies a required boundary
- **WHEN** a `mustContain` phrase appears only inside a quotation the model uses to state the correct fact, and the phrase is not negated
- **THEN** the screening SHALL treat the required boundary as satisfied rather than reporting it as missing

#### Scenario: Uncertainty expressed with equivalent wording
- **WHEN** an unknown-information case answer expresses uncertainty with wording such as 无法得知、没有提供 or 文中没有 instead of the literal 未知 or 未提及
- **THEN** the screening SHALL recognize the uncertainty and SHALL NOT report it as an unsupported definite assertion

#### Scenario: Inferential wording around a definite conclusion
- **WHEN** an answer reaches a definite conclusion that matches the factual boundary but frames it with inferential wording such as 可推断
- **THEN** the screening SHALL NOT force `NEEDS_REVIEW` solely because of the inferential wording when the boundary is clearly met and no wrong conclusion is asserted

#### Scenario: Modifier insertion inside one clause satisfies mustContain
- **WHEN** a `mustContain` phrase such as 「陈渡是邮差」 does not appear contiguously, but the answer states 「陈渡是北境的一名邮差」 with the phrase's characters in order, a single-clause gap shorter than the gap limit, and no negation or past-state marker inside the gap
- **THEN** the screening SHALL treat the required boundary as satisfied rather than reporting the fact as missing

#### Scenario: Clause boundary blocks gap matching
- **WHEN** an answer asserts a different subject in another clause, such as 「陈渡是渔民；邮差老王常来送信」, so that the gap between the would-be matched segments of the `mustContain` phrase crosses a clause boundary
- **THEN** the screening SHALL NOT treat the boundary as satisfied by gap matching and SHALL keep the deterministic conservative outcome

#### Scenario: Past-state marker inside a gap blocks satisfaction
- **WHEN** a `mustContain` phrase's bounded-gap match has a gap containing a past-state marker, such as 「陈渡是一位前邮差」 or 「陈渡曾是邮差」
- **THEN** the screening SHALL NOT treat that occurrence as satisfying the boundary

#### Scenario: Declared negation equivalent satisfies mustNegate
- **WHEN** a `mustNegate` entry declares an equivalent phrase such as 「辞去了盐镇中学的工作」 and the answer contains that equivalent with the leaving verb intact, while the original superseded-fact phrase never appears affirmatively
- **THEN** the screening SHALL treat the negation boundary as satisfied and SHALL NOT report the old fact as un-negated

#### Scenario: Affirmed original fact overrides equivalent negation
- **WHEN** an answer contains a declared negation equivalent but also makes an unquoted affirmative assertion of the original superseded fact
- **THEN** the screening SHALL NOT treat the negation boundary as satisfied

### Requirement: Separate human review outcome
The tester SHALL keep human review data separate from the automatic result and SHALL support the review outcomes `MODEL_OK`, `MODEL_ERROR`, `SCORER_ERROR`, and `UNRESOLVED`.

#### Scenario: Review an automatic failure
- **WHEN** a reviewer determines that an automatic failure was caused by the scorer misreading a quotation or negation
- **THEN** the record SHALL preserve the original automatic result and SHALL store `SCORER_ERROR` as the human outcome with reviewer reasoning

### Requirement: Core reliability coverage
The initial case set SHALL include version conflict, explicit negation, unknown or unmentioned information, quotation containing negation, fact-versus-inference distinction, multi-turn stale-fact conflict, post-compaction fact retention, and multi-scene or multi-hop relation cases.

#### Scenario: Version conflict case
- **WHEN** the same fact differs between v1 and v2 and the runner executes the v2 case
- **THEN** the evidence SHALL identify the selected version and the screening rule SHALL check whether the answer incorrectly asserts the superseded fact

#### Scenario: Unknown information case
- **WHEN** the material does not establish an answer to the question
- **THEN** the case SHALL allow an explicit uncertainty outcome and SHALL treat an unsupported definite assertion as a candidate reliability failure

### Requirement: Proposition-level boundary phrases
Each `mustNegate` and `wrongConclusions` entry SHALL be a complete proposition phrase that includes an action or relation word identifying the fact being negated or concluded, and SHALL NOT be a bare entity name used alone — a person name, place name, object name, or institution name. It SHALL also NOT be a bare kinship or occupation term (such as 侄子、儿子、医生、教师) or a predicate phrase lacking its subject (such as 住在盐城) when such a bare phrase can legitimately appear inside a correct answer while explaining, contrasting, or tracing a relationship. A bare entity name is one the model's correct answer legitimately mentions while explaining, contrasting, or tracing a relationship (for example 「林蔓住在盐城」 mentions 「盐城」, or 「外婆留给母亲」 mentions 「母亲」), so using it alone causes a false `FAIL_LIKELY`. A `mustNegate` phrase SHALL omit tense/aspect auxiliaries (such as 还在 or 仍然) so it can match the usual negation wording (for example `在盐镇中学教书` rather than `还在盐镇中学教书`). The long-context oracle validation SHALL enforce the same proposition-level rules as the core fixture validation, including the tense/aspect auxiliary omission rule, and SHALL reject a `mustNegate` or `wrongConclusions` entry that contains auxiliaries such as 还在、仍然、依旧 or 已经. When an oracle declares `negationEquivalents`, each key SHALL be an entry of the same query's `mustNegate`, and each declared equivalent phrase SHALL itself be a complete proposition phrase subject to the same prohibitions (no bare entity names, bare kinship or occupation terms, or subject-less predicates).

#### Scenario: Bare entity name is rejected
- **WHEN** a case's `mustNegate` or `wrongConclusions` contains a bare person, place, object, or institution name with no action or relation word
- **THEN** the fixture validation SHALL flag it as an invalid boundary phrase rather than silently scoring it

#### Scenario: Bare kinship or occupation term is rejected
- **WHEN** a case's `wrongConclusions` contains a bare kinship or occupation term such as 侄子 or 医生 that could appear inside a correct hedged answer
- **THEN** the fixture validation SHALL flag it as an invalid boundary phrase rather than silently scoring it

#### Scenario: Subject-less predicate is rejected
- **WHEN** a case's `wrongConclusions` or `mustNegate` contains a predicate phrase such as 住在盐城 without the subject that identifies whose residence is being negated
- **THEN** the fixture validation SHALL flag it as an invalid boundary phrase rather than silently scoring it

#### Scenario: Proposition phrase matches negation wording
- **WHEN** a `mustNegate` phrase is a complete proposition without tense auxiliaries and the answer negates it with a direct marker or a leaving-a-state verb
- **THEN** the screening SHALL treat the negation boundary as satisfied

#### Scenario: Tense auxiliary in long-context oracle is rejected
- **WHEN** a long-context oracle query's `mustNegate` or `wrongConclusions` entry contains a tense/aspect auxiliary such as 还在 or 仍然
- **THEN** the long-context validation SHALL flag it as an invalid boundary phrase rather than silently scoring it

#### Scenario: Negation equivalent must be a complete proposition bound to its entry
- **WHEN** an oracle declares a `negationEquivalents` key that is not a `mustNegate` entry of the same query, or an equivalent phrase that is a bare entity, bare kinship or occupation term, or subject-less predicate
- **THEN** the validation SHALL flag the declaration as invalid rather than silently scoring it

### Requirement: Evidence rescoring and adjudication completeness
The tester SHALL support offline rescoring of saved evidence with the current screening rules and current oracle expectations, without contacting any model or network. A write-back rescoring mode SHALL refresh each record's automatic result and reasons, preserve the prior automatic result in an append-only history field with a timestamp, and recompute the manifest counts with a recorded rescoring marker; it SHALL NOT alter response texts, protocol records, or original run information. Human adjudication SHALL be recorded in the dedicated human-review fields (`MODEL_OK`, `MODEL_ERROR`, `SCORER_ERROR`, `UNRESOLVED`) with reviewer notes, separate from and never overwriting the automatic result. Every saved evidence record whose automatic result is `NEEDS_REVIEW` SHALL eventually carry a human review outcome or an explicitly recorded conservative-residue reason in the change's verification record.

#### Scenario: Dry-run rescoring reports remaining drift
- **WHEN** rescoring runs without write-back over saved evidence
- **THEN** it SHALL report per-run and overall drift between saved automatic results and current-scorer results without modifying any file

#### Scenario: Write-back preserves automatic-result history
- **WHEN** write-back rescoring refreshes a record whose saved result differs from the current-scorer result
- **THEN** the record SHALL contain the refreshed automatic result and reasons, and the prior result SHALL remain readable in the history field with a timestamp

#### Scenario: Manifest counts recomputed after write-back
- **WHEN** write-back rescoring completes for a run
- **THEN** the run manifest's counts SHALL match the refreshed automatic results and SHALL record the rescoring marker

#### Scenario: Human review stored separately from automatic result
- **WHEN** a reviewer records an adjudication outcome for a record
- **THEN** the record SHALL preserve the automatic result unchanged and SHALL store the outcome and reviewer notes in the human-review fields

#### Scenario: Mislabel zeroing acceptance
- **WHEN** a record was adjudicated `MODEL_OK` while its automatic result was not `PASS_LIKELY`, and the fixed screening with the corrected oracle is applied to the same response text
- **THEN** the refreshed automatic result SHALL be `PASS_LIKELY`, or the residual non-passing reason SHALL belong to an explicitly recorded conservative category (quoted wrong conclusion, synonym or word-order paraphrase beyond the declared equivalents, contrast-structure answers that assert the replacement fact, or explicit-unknown markers scoped over the negated side) listed in the change's verification record

