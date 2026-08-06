## 1. Lock Existing Behavior

- [x] 1.1 Add focused tests for the DOM layer consuming `decideSelectionEntryActions()` as its only button-combination source
- [x] 1.2 Add or adjust tests for selection freezing, in-flight blocking, menu anchor stability, context invalidation, and controller reset

## 2. Unify Button Decision Flow

- [x] 2.1 Change the selection-entry DOM update path to render and update summon actions from the pure decision result
- [x] 2.2 Remove duplicated button-combination branching from DOM creation and update code without changing visible action rules

## 3. Narrow Internal Controller Boundaries

- [x] 3.1 Separate DOM rendering from selection snapshot capture and action callback dispatch inside the selection-entry implementation
- [x] 3.2 Keep geometry measurement, frame scheduling, menu anchor stability, and lifecycle cleanup behind explicit internal boundaries
- [x] 3.3 Preserve `setupSelectionEntry(options)` and `SelectionEntryController` so `src/ai-feature.ts` requires no integration change

## 4. Verify Behavior

- [x] 4.1 Run `tests/selection-entry.test.ts` and related AI entry tests, confirming all existing and new assertions pass
- [x] 4.2 Run the complete frontend test suite and `npm run typecheck`, confirming no behavior or type regressions
- [x] 4.3 Review the final diff to confirm no prompt, AI request, editor text, UI visual, fake DOM helper, or unrelated module changes were included
