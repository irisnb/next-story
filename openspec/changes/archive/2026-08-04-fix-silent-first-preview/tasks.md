## 1. Test Coverage

- [x] 1.1 Add a failing DOM regression test in `tests/ai-panel-dom.test.ts` that simulates `及时召唤` after a valid selection and verifies the panel does not remain in a silent preview-only state when creative-content confirmation is cancelled.
- [x] 1.2 Add a failing DOM regression test in `tests/ai-panel-dom.test.ts` that verifies a first request blocked by an existing in-flight AI request shows an explicit blocked state instead of doing nothing.
- [x] 1.3 Extend the relevant state-unit coverage for `src/ai-panel-state.ts` or `src/ai-panel-request-state.ts` so the first-request state machine has an explicit non-silent stopped/blocked state.

## 2. Panel State Flow

- [x] 2.1 Update `src/ai-feature.ts` so the first-request path maps confirmation cancellation, request rejection, and request-preflight exceptions into explicit panel states instead of returning silently after `previewFirstRequest(...)`.
- [x] 2.2 Update `src/ai-panel-request-state.ts` and `src/ai-panel-state.ts` so the new first-request stopped or blocked state is represented with a stable, testable kind and preserves the frozen selection snapshot.
- [x] 2.3 Update `src/ai-panel.ts` so the new state renders clear Chinese-readable feedback, does not show a loading spinner, and does not expose follow-up input.

## 3. Verification

- [x] 3.1 Run `npm run test:frontend -- tests/ai-panel-dom.test.ts` and confirm the new regressions fail before implementation and pass after implementation.
- [x] 3.2 Run `npm run typecheck` and `npm run build` after the code change to confirm the new state shape compiles cleanly.
- [x] 3.3 Manually verify the release app behavior by opening a valid selection, triggering `及时召唤`, cancelling the confirmation, and checking that the panel now shows an explicit stopped or blocked state instead of a silent preview.
