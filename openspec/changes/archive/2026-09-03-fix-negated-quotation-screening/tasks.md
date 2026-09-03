## 1. Screening logic

- [x] 1.1 Add internal multi-occurrence phrase classification without changing the public result vocabulary.
- [x] 1.2 Update `mustNegate` evaluation so a clearly negated quoted occurrence satisfies the boundary unless an affirmative unquoted occurrence contradicts it.
- [x] 1.3 Keep quoted-only and negated-only `wrongConclusions` from producing a direct `FAIL_LIKELY`.
- [x] 1.4 Preserve conservative `NEEDS_REVIEW` behavior for unresolved mixed or inferential language.
- [x] 1.5 Recognize clear Chinese denial wording (`否认`/`否定`) as negating the following target phrase, so an unquoted `否认偷书` is not misread as an affirmative assertion.
- [x] 1.6 Keep negation scope from crossing clause-boundary punctuation, so a later affirmative clause (`…但其实偷了`) is still detected as asserted.

## 2. Regression tests

- [x] 2.1 Add unit coverage for direct negation and explicit negation inside quotation.
- [x] 2.2 Add unit coverage for quoted negation followed by an affirmative contradiction.
- [x] 2.3 Add unit coverage for wrong conclusions appearing only in quotation or negation.
- [x] 2.4 Run `npm run test:reliability` and confirm all tests pass.
- [x] 2.5 Add exact regression test using the real `quotation-negation` response text (quoted `我没有偷…` + unquoted `否认偷书`) expecting `PASS_LIKELY`.
- [x] 2.6 Add regression test that `否认偷书，但其实偷了` still yields `FAIL_LIKELY`.

## 3. Baseline verification

- [x] 3.1 Re-run the `quotation-negation` case through the real runner with the configured official model. Evidence: `sidecar/reliability/evidence/run-2026-09-03T14-02-50-957Z/`.
- [x] 3.2 Inspect its evidence record and confirm the result is not caused by the previous missing-negation reason. The run returned `PASS_LIKELY`; no runtime error or stale-fact failure was recorded.
- [x] 3.3 Record any remaining ambiguity as a human-review limitation rather than silently treating it as a model error. The automatic result remains `PASS_LIKELY`/`NEEDS_REVIEW` by design for unresolved language; this case had no remaining ambiguity requiring review.
