## Context

`src/ai-panel-state.ts` is currently a 400-line state holder with several different responsibilities in one class:

- panel visibility (`open` / `closed`);
- request status (`idle`, `loading`, `success`, `error`, `configuration_required`);
- first invocation identity and stale-result protection;
- the single in-memory temporary conversation anchored to the frozen selection;
- follow-up turn creation, success, failure, retry, edit, and cancel rules;
- read-only view construction and subscriber notification.

That shape worked for the first follow-up implementation, but it now makes every future AI-panel change pay the cost of understanding all state transitions at once. The most sensitive invariants are product invariants, not just code preferences: AI output remains temporary, the frozen selection anchor must not drift, there is only one current linear temporary conversation, and no state transition may create a write-back path into the draft or main notebook.

This change is an internal refactor. It must preserve current runtime behavior and should keep the public surface of `AiPanelState` stable enough that UI and request orchestration code do not need to know the new internal module layout.

## Goals / Non-Goals

**Goals:**

- Split `AiPanelState` internals by responsibility while preserving the existing external behavior.
- Make the temporary conversation model explicit: immutable anchor, first response, successful follow-up turns, optional pending follow-up turn, and conversation identity.
- Keep first-invocation request state separate from follow-up turn state so failure/retry semantics stay easier to reason about.
- Keep subscriber notification and read-only view creation centralized at the outer state facade.
- Preserve all existing tests, then add focused unit coverage where new modules expose smaller pure state transitions.
- Keep `npm run check` passing.

**Non-Goals:**

- No user-visible feature changes.
- No new AI opening mode, no initial summon question input, no multiple conversations, no history, no persistence, no summaries, and no nearby/full-text context.
- No changes to `GenerateAiRequest` semantics, Rust validation, AI prompt construction, LLM configuration, or provider/model support.
- No write-back, apply-to-notebook, insert, replace, delete, organize, or save behavior for AI output.
- No broad UI redesign and no visual copy rewrite beyond unavoidable import/type adjustments.

## Decisions

### D1: Keep `AiPanelState` as the public facade

The refactor should keep `AiPanelState` as the object used by `src/ai-feature.ts`, `src/ai-panel.ts`, and `src/ai-panel-scroll.ts`. New modules sit behind it.

Rationale: this keeps the change low-risk. The current callers already express the product workflow clearly: feature orchestration accepts/retries requests, the panel renders a read-only view, and scroll logic reacts to request state. Making every caller talk to multiple new objects would create a wider diff without improving the user-facing contract.

Alternative considered: replace `AiPanelState` with several exported stores. Rejected for this change because it would spread state sequencing across callers and increase the chance of mismatched emit timing.

### D2: Extract conversation state before request/view plumbing

The highest-value extraction is the temporary conversation model. It should own:

- conversation id;
- frozen `SelectionSnapshot` anchor;
- first assistant response;
- successful follow-up turns;
- optional pending follow-up turn;
- methods for creating, succeeding, failing, retrying, editing, cancelling, and building follow-up message history.

Rationale: follow-up behavior is the densest part of the current file, and it contains the most important stale-result and retry invariants. Pulling it into a dedicated module makes those invariants testable without panel visibility or subscriber machinery.

Alternative considered: extract visibility first. Rejected as the first implementation step because visibility is trivial and would not reduce the risky part of the file.

### D3: Keep request status as a small discriminated state model

Request state should remain a discriminated union, but its construction should be centralized through helper functions or a small module. It should continue to represent first request loading/success/error/configuration-required states and the follow-up loading state that references a conversation id and turn id.

Rationale: `PanelRequestState` is already consumed by scroll and rendering tests. Keeping the union recognizable preserves compatibility while reducing ad hoc object construction inside the facade.

Alternative considered: fold all request status into conversation turns. Rejected because first-request failure happens before a successful temporary conversation is available for follow-up, and current retry semantics distinguish first retry from follow-up retry.

### D4: Keep view snapshots immutable at the boundary

`view()` should continue returning a read-only snapshot rather than exposing mutable internals. New internal modules may use mutable private state, but the facade must clone arrays/objects where needed so UI code cannot mutate conversation turns or pending state accidentally.

Rationale: existing UI code expects to render state, not own it. A read-only boundary also protects future work from accidentally treating AI panel output as project data.

Alternative considered: expose the internal conversation object and rely on TypeScript `Readonly` types. Rejected because runtime mutation through shared object references would still be possible if callers keep references.

### D5: Preserve emit timing exactly

Every public method that currently emits on a successful state transition should still emit once, and methods that currently return `false` / `null` without changing state should still avoid emitting.

Rationale: UI rendering, scroll reset, and routing tests depend on state-change timing. This refactor should not create extra renders, missing renders, or changed scroll behavior.

Alternative considered: introduce batched notifications. Rejected because batching is a behavior and performance change, not needed for this cleanup.

### D6: Prefer a flat module layout unless imports become noisy

Use a small number of files with direct names, for example:

- `src/ai-panel-state.ts` as facade and exported compatibility types;
- `src/ai-panel-conversation.ts` for temporary conversation state;
- `src/ai-panel-request-state.ts` for request-state helpers/types if extraction stays small;
- optional `src/ai-panel-state-view.ts` only if view construction becomes large enough to justify it.

Rationale: the project currently uses flat `src/*.ts` modules. A new directory is only worth it if the split grows beyond a few tightly related files.

Alternative considered: create `src/ai-panel-state/` directory immediately. Acceptable if implementation proves cleaner, but not required by this proposal.

## Risks / Trade-offs

- **[Behavior drift during refactor]** → Start from existing tests, move one responsibility at a time, and run targeted frontend tests before the full check.
- **[Stale result protection weakens]** → Keep conversation id and turn id checks explicit in tests for first success, follow-up success, follow-up error, new summon replacement, reset, and retry.
- **[Extra modules make imports harder to follow]** → Keep `AiPanelState` as the public facade and re-export compatibility types from the same place where current callers import them.
- **[Read-only view accidentally exposes mutable internals]** → Add tests that mutating returned view arrays/objects cannot mutate the underlying conversation state, or keep existing clone-based behavior if already covered.
- **[Refactor tempts feature cleanup]** → Tasks explicitly forbid changing prompt/request semantics, persistence, UI capabilities, or notebook write behavior.

## Migration Plan

1. Lock current behavior with the existing `ai-panel-state`, `ai-feature-routing`, `ai-panel-dom`, and `ai-panel-scroll` tests.
2. Extract temporary conversation state and move follow-up message construction into that module while keeping `AiPanelState` public methods unchanged.
3. Extract request-state construction helpers if it reduces repeated object literals without changing the exported union shape.
4. Keep `view()`, `subscribe()`, `open()`, `close()`, and `reset()` on the facade; delegate internal state changes to the new modules.
5. Run targeted frontend tests after each meaningful extraction, then run `npm run check` at the end.
6. If the refactor starts requiring caller behavior changes, stop and either narrow the split or update the proposal before implementation continues.

### Rollback Plan

No data migration is involved. If verification fails and the failure is not quickly attributable to a small extraction mistake, revert only the files touched by this change and keep the OpenSpec change unarchived for redesign. User project files and LLM configuration require no cleanup.

## Open Questions

None blocking. Exact file names can be chosen during implementation as long as the public `AiPanelState` behavior and product boundaries remain unchanged.
