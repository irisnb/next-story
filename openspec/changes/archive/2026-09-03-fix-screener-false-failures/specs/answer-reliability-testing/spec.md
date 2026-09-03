## MODIFIED Requirements

### Requirement: Conservative automatic screening
The tester SHALL produce one of `PASS_LIKELY`, `FAIL_LIKELY`, `NEEDS_REVIEW`, or `RUNTIME_ERROR`, and SHALL use `NEEDS_REVIEW` whenever the available deterministic evidence cannot safely distinguish a correct answer from a negation, quotation, uncertainty, or fact-versus-inference ambiguity. When evaluating a target phrase, the screening rules SHALL consider all occurrences of that phrase in the answer: a quoted occurrence that is explicitly negated SHALL satisfy a required negation boundary only when no unquoted, affirmative occurrence contradicts it; a quoted or negated wrong conclusion SHALL NOT by itself produce `FAIL_LIKELY`. Negation detection SHALL recognize both direct negation markers and verbs that express leaving or stopping a prior state (such as 辞去、辞职、离职、离开、放弃、停止、不再、退出、卸任、终止、中断), so that an answer like 「辞去了盐镇中学的工作」 is treated as negating the superseded fact 「在盐镇中学教书」 rather than asserting it.

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

## ADDED Requirements

### Requirement: Proposition-level boundary phrases
Each `mustNegate` and `wrongConclusions` entry SHALL be a complete proposition phrase that includes an action or relation word identifying the fact being negated or concluded, and SHALL NOT be a bare entity name used alone — a person name, place name, object name, or institution name. A bare entity name is one the model's correct answer legitimately mentions while explaining, contrasting, or tracing a relationship (for example 「林蔓住在盐城」 mentions 「盐城」, or 「外婆留给母亲」 mentions 「母亲」), so using it alone causes a false `FAIL_LIKELY`. A `mustNegate` phrase SHALL omit tense/aspect auxiliaries (such as 还在 or 仍然) so it can match the usual negation wording (for example `在盐镇中学教书` rather than `还在盐镇中学教书`).

#### Scenario: Bare entity name is rejected
- **WHEN** a case's `mustNegate` or `wrongConclusions` contains a bare person, place, object, or institution name with no action or relation word
- **THEN** the fixture validation SHALL flag it as an invalid boundary phrase rather than silently scoring it

#### Scenario: Proposition phrase matches negation wording
- **WHEN** a `mustNegate` phrase is a complete proposition without tense auxiliaries and the answer negates it with a direct marker or a leaving-a-state verb
- **THEN** the screening SHALL treat the negation boundary as satisfied
