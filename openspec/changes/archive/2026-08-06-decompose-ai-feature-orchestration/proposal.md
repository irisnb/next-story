## Why

`src/ai-feature.ts` has become the single front-end coordinator for selection entry, AI panel callbacks, LLM configuration preflight, first request lifecycle, thinking expansion start, follow-up submission, retry/edit recovery, project-token isolation, and panel state writes. Keeping those responsibilities in one file makes the current AI loop harder to verify before the next AI capability is proposed.

This change splits the orchestration into named internal boundaries while preserving the current product behavior: AI still only uses the frozen selection, optional thinking direction, and current temporary conversation turns, and AI output still never writes into the draft notebook or main notebook.

## What Changes

- Decompose `src/ai-feature.ts` into smaller front-end modules for first-request orchestration, follow-up orchestration, thinking expansion request construction, and project/request lifecycle wiring.
- Keep `setupAiFeature(...)` as the public integration entry used by the editor, but reduce it to composition and dependency wiring.
- Preserve all existing request, state, and UI behavior for AI timely summon, thinking expansion, follow-up, retry/edit recovery, configuration-missing handling, and stale-result isolation.
- Move or expand tests only where needed to lock the existing behavior across the new module boundaries.
- Do not introduce new AI product abilities, new context sources, persistence, history, model/provider options, streaming, stop generation, or any write-back path into the draft notebook or main notebook.

## Capabilities

### New Capabilities
- `ai-feature-orchestration`: Internal front-end orchestration boundaries that preserve the existing AI timely summon, thinking expansion, follow-up, configuration, and stale-result isolation behavior while keeping AI unable to write into the draft notebook or main notebook.

### Modified Capabilities
- None. This is an internal decomposition change; existing requirements in `selection-ai-invocation`, `ai-thinking-panel`, `summon-ai-follow-up`, and `llm-configuration` remain unchanged.

## Impact

- Affected front-end code: `src/ai-feature.ts` and new or adjusted neighboring AI orchestration modules under `src/`.
- Affected tests: focused front-end tests around AI feature routing, generation bridge behavior, panel conversation state, panel state, request coordination, and DOM integration as needed.
- No Rust command, Tauri permission, storage format, OpenAI-compatible request contract, dependency, UI capability, or user-facing copy change is intended.
