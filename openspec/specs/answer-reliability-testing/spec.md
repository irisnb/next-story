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
The tester SHALL produce one of `PASS_LIKELY`, `FAIL_LIKELY`, `NEEDS_REVIEW`, or `RUNTIME_ERROR`, and SHALL use `NEEDS_REVIEW` whenever the available deterministic evidence cannot safely distinguish a correct answer from a negation, quotation, uncertainty, or fact-versus-inference ambiguity. When evaluating a target phrase, the screening rules SHALL consider all occurrences of that phrase in the answer: a quoted occurrence that is explicitly negated SHALL satisfy a required negation boundary only when no unquoted, affirmative occurrence contradicts it; a quoted or negated wrong conclusion SHALL NOT by itself produce `FAIL_LIKELY`.

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

