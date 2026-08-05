## 1. Baseline And Boundaries

- [x] 1.1 Review current AI orchestration tests around `src/ai-feature.ts`, request coordination, panel state, and follow-up flows to identify behavior that must remain unchanged
- [x] 1.2 Add or adjust focused baseline tests for thinking expansion request construction, first-request configuration preflight, and follow-up retry/edit acceptance before moving implementation code

## 2. Orchestration Decomposition

- [x] 2.1 Extract thinking expansion first-request payload construction into a pure front-end helper with tests for empty and non-empty direction handling
- [x] 2.2 Extract first-request orchestration for preview, configuration preflight, coordinator acceptance, blocked requests, and preflight errors while preserving current state transition order
- [x] 2.3 Extract follow-up submit, retry, and edit/resend acceptance orchestration while preserving conversation and turn identity handling
- [x] 2.4 Reduce `setupAiFeature(...)` to composition wiring for state, coordinator callbacks, selection entry callbacks, panel callbacks, and project lifecycle controller methods

## 3. Verification

- [x] 3.1 Run focused front-end tests covering AI feature routing, AI request coordination, AI panel conversation/state, and DOM integration
- [x] 3.2 Run the project check command to verify TypeScript, front-end tests, front-end build, and Rust tests still pass
- [x] 3.3 Manually inspect the resulting AI orchestration modules to confirm no notebook write callbacks, new context sources, persistence, model/provider options, or user-facing behavior changes were introduced
