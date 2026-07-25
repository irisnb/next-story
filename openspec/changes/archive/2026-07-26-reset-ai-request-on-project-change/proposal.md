## Why

AI requests are already guarded so late results cannot update a different project, but the single-in-flight request lock can remain occupied after the original project is unloaded or replaced. That leaves the new project unable to start an AI request until an old, now-irrelevant network call finishes.

## What Changes

- Release the AI request coordinator's busy state when the active project token changes because the user returns to the welcome page or successfully opens another project.
- Ensure late success, structured failure, and promise rejection from the old project still cannot update the new project or reopen the AI panel.
- Keep the existing single-request rule within one active project: concurrent AI requests are still forbidden while a current-project request is in flight.
- Add regression coverage for both first requests and structured follow-up requests blocked by a stale in-flight request after project replacement.

## Capabilities

### New Capabilities


### Modified Capabilities
- `ai-thinking-panel`: Clarify that project unload or replacement invalidates the old request's in-flight lock as well as its late result.

## Impact

- Affected frontend modules: `src/ai-request.ts`, `src/ai-feature.ts`, and related AI feature wiring if the reset needs to be called from lifecycle composition.
- Affected tests: AI request coordinator and feature flow tests under `tests/`.
- No backend API, LLM request schema, notebook storage, or direct notebook write behavior changes.
