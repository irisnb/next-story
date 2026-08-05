## Context

The current AI front-end behavior is already specified and implemented across selection invocation, thinking expansion, follow-up, panel state, and LLM configuration requirements. The main implementation pressure is not missing behavior; it is that `src/ai-feature.ts` currently owns too many responsibilities at once:

- selection-entry callbacks and editor integration
- first-request configuration preflight and request acceptance
- thinking expansion first-request payload construction
- follow-up submit, retry, and edit/resend acceptance
- request coordinator callback mapping into `AiPanelState`
- project-token lifecycle invalidation and panel reset wiring

This change is a refactor proposal. It must preserve the current user-visible AI loop and the product boundary that AI output is only temporary panel material and never writes to the draft notebook or main notebook.

## Goals / Non-Goals

**Goals:**

- Keep `setupAiFeature(...)` as the editor-facing integration point.
- Extract small, named orchestration modules so first requests, follow-ups, thinking expansion payloads, and project lifecycle wiring can be tested and reasoned about separately.
- Preserve current request identity and stale-result isolation semantics.
- Preserve configuration-missing handling before first/follow-up network requests.
- Keep tests focused on existing behavior rather than adding new product capability tests.

**Non-Goals:**

- No new AI product behavior, UI entry, context source, history, persistence, streaming, cancellation, or model/provider choice.
- No changes to Rust Tauri commands, LLM request schema, storage format, or permissions.
- No write-back path from AI output into the draft notebook or main notebook.
- No renaming of existing user-facing concepts such as `AI 及时召唤`, `思维扩展`, `草稿本`, or `正文本`.

## Decisions

### Keep `setupAiFeature(...)` as the composition root

`setupAiFeature(...)` remains the single public setup function called by the editor. It should create shared state, create the request coordinator, bind panel callbacks, bind selection-entry callbacks, and return the existing controller shape.

Alternative considered: replace `setupAiFeature(...)` with multiple setup calls from the editor. That would move AI coordination complexity into the editor layer and make the editor know more about AI internals, so this proposal keeps the existing public boundary.

### Extract request acceptance helpers by lifecycle responsibility

First-request preflight and follow-up acceptance have different invariants. First requests must preview state, load configuration, then accept or block a coordinator request. Follow-ups must add or recover a pending turn, build a structured payload from the current temporary conversation, and cancel only the attempted turn if the coordinator rejects it.

The implementation should separate these flows into modules or narrow helper factories so each path can be tested without reading the full feature setup file.

Alternative considered: move all request logic into `AiPanelState`. That would mix state mutation with side-effect orchestration and make it easier for state code to know about network/configuration concerns.

### Keep request construction near AI-specific intent, not DOM wiring

Thinking expansion's first request is a pure conversion from frozen selection plus optional direction into the existing `GenerateAiRequest` shape. It should be extracted as a pure helper and tested as such.

Alternative considered: leave it inline because it is short. The function is short, but its product constraint is important: empty direction must not create a direction, and non-empty direction is initial user material rather than a later follow-up. A named pure boundary makes that invariant easier to protect.

### Preserve dependency injection for tests

The existing optional dependencies for `generate`, `loadConfig`, and `setupEntry` should remain available. New modules should accept typed dependencies instead of importing hard-coded production functions when doing so would make current tests harder to express.

Alternative considered: simplify by removing injection and relying on integration tests only. That would reduce local seams but increase the cost of verifying preflight and request-acceptance edge cases.

## Risks / Trade-offs

- [Risk] Moving orchestration code could subtly change the order of panel state transitions around configuration preflight. -> Mitigation: keep focused tests for missing configuration, first retry, and successful first request behavior.
- [Risk] Follow-up retry/edit flows could lose the pending turn identity when split across helpers. -> Mitigation: preserve existing `conversationId` and `turnId` handoff tests, and add narrow tests if current coverage does not lock the extracted helper boundary.
- [Risk] The refactor may look like a chance to add future AI context features. -> Mitigation: tasks explicitly exclude new context sources, persistence, summaries, history, model choices, and notebook write-back.
- [Risk] Creating too many tiny modules could make the feature harder to trace. -> Mitigation: extract only responsibilities that have distinct invariants or tests; keep `setupAiFeature(...)` readable as the top-level map.

## Migration Plan

No data migration is required. Implement the refactor in front-end TypeScript, run focused tests first, then run the project check command. If the refactor fails verification, rollback is a normal source revert of the changed front-end files; no persisted project data or settings are changed.

## Open Questions

- None. The change is intentionally limited to internal front-end orchestration decomposition with no spec-level behavior change.
