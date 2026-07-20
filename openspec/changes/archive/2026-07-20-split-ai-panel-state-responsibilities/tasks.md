## 1. Baseline and Boundaries

- [x] 1.1 Run the focused AI panel frontend tests before refactoring: `tests/ai-panel-state.test.ts`, `tests/ai-feature-routing.test.ts`, `tests/ai-panel-dom.test.ts`, and `tests/ai-panel-scroll.test.ts`
- [x] 1.2 Inspect `src/ai-panel-state.ts` exports and callers in `src/ai-feature.ts`, `src/ai-panel.ts`, and `src/ai-panel-scroll.ts`; record which public methods and types must remain compatible
- [x] 1.3 Confirm implementation scope excludes prompt changes, request payload semantic changes, persistence, multiple conversations, UI redesign, and any draft/main notebook write path

## 2. Conversation State Extraction

- [x] 2.1 Add a dedicated temporary conversation module for conversation id, frozen anchor snapshot, first response, successful follow-up turns, and optional pending follow-up turn
- [x] 2.2 Move follow-up turn operations into the conversation module: create pending question, accept success, accept error, retry, edit failed question, cancel pending turn, and reject invalid transitions
- [x] 2.3 Move follow-up request message construction into the conversation module while preserving the exact existing request semantics: original selected text plus first response and successful turns
- [x] 2.4 Add or update focused tests proving the conversation module preserves anchor immutability, one pending follow-up limit, retry/edit/cancel behavior, and stale conversation/turn rejection

## 3. Request State and Facade Cleanup

- [x] 3.1 Keep `AiPanelState` as the public facade used by current callers, re-exporting compatibility types where needed
- [x] 3.2 Extract request-state construction helpers for idle, loading, success, error, configuration-required, and follow-up loading states without changing the exported `PanelRequestState` shape
- [x] 3.3 Keep panel visibility, `view()`, `subscribe()`, notification emission, `open()`, `close()`, and `reset()` on the facade, delegating only internal state transitions to extracted modules
- [x] 3.4 Preserve existing emit timing: successful state transitions emit once; invalid no-op transitions do not emit
- [x] 3.5 Preserve read-only view behavior so returned conversation arrays or pending-turn objects cannot mutate internal state accidentally

## 4. Caller and Test Alignment

- [x] 4.1 Update imports in `src/ai-feature.ts`, `src/ai-panel.ts`, `src/ai-panel-scroll.ts`, and affected tests only as required by the module split
- [x] 4.2 Keep current user-visible AI panel behavior unchanged: summon without initial input, first success enables one linear follow-up flow, new summon replaces current conversation, close preserves state, reset clears state
- [x] 4.3 Keep existing failed first-request and failed follow-up semantics: first retry uses the original snapshot; follow-up retry/edit uses the failed pending turn and prior successful turns
- [x] 4.4 Search the diff manually for forbidden expansions: no history, persistence, nearby/full-text context, summaries, model/provider changes, prompt changes, or notebook write/apply entry points

## 5. Verification

- [x] 5.1 Run TypeScript diagnostics or `npm run typecheck` after the extraction to catch import/type drift
- [x] 5.2 Run focused frontend tests for AI panel state, feature routing, DOM rendering, and scroll reset behavior
- [x] 5.3 Run `npm run check` and confirm typecheck, frontend tests, frontend build, and Rust tests pass
- [x] 5.4 Review the final diff and confirm the change is an internal state split only, with no application behavior expansion and no changes to user project data or LLM configuration storage
- [x] 5.5 Report implementation files changed and verification results before asking whether to archive the OpenSpec change
