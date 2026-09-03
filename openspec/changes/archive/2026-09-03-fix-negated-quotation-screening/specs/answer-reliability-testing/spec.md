## MODIFIED Requirements

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
