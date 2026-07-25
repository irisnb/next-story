## Context

The AI panel already treats each request as belonging to the active project token and current temporary conversation. Late results are ignored when their token no longer matches. The missing piece is that an in-flight request can still occupy the coordinator's single-request lock after the user unloads the project or opens another project, so the new project can be unable to start its own AI request until an irrelevant old request settles.

The change must preserve the product boundary that AI output only appears as temporary material in the AI panel and never writes to the draft or main notebooks.

## Goals / Non-Goals

**Goals:**

- Reset the AI request coordinator's in-flight lock when the active project token is invalidated by returning to the welcome page or by successfully opening another project.
- Keep late old-project request results stale so they cannot update the new project, current temporary conversation, pending turn, or panel visibility.
- Preserve the existing single-in-flight rule while the same active project token remains current.
- Cover first-generation and structured follow-up request paths with regression tests.

**Non-Goals:**

- Cancel the underlying network request at the transport layer.
- Add streaming, stop generation, persistent AI history, multiple concurrent conversations, or background queueing.
- Change backend request schemas, LLM configuration behavior, or notebook save behavior.

## Decisions

1. Add an explicit coordinator reset operation for project-token invalidation.

   The request coordinator should expose a small operation that clears the current in-flight entry only when it belongs to a stale project token. This keeps the reset local to request coordination instead of spreading lock mutation across panel state or project lifecycle code.

   Alternative considered: allow each new request to overwrite the busy lock unconditionally. That would weaken the existing same-project single-request rule, so it is not acceptable.

2. Call the reset at the lifecycle point that invalidates the active project token.

   Returning to the welcome page and successfully replacing the current project already clear the current AI panel state. The same transition should also invalidate stale in-flight request ownership. This makes project switching behavior deterministic without changing request result handling.

   Alternative considered: rely only on the late result handler's stale check. That prevents state pollution but does not release the busy lock early, which is the bug being fixed.

3. Continue to ignore late old-project outcomes instead of surfacing cancellation errors.

   The old request is no longer relevant to the visible project. Showing its success or failure would confuse project ownership and could reopen stale UI.

   Alternative considered: display a cancelled status in the old panel state. The old project state is intentionally gone after unload/replacement, so there is no safe visible place for that status.

## Risks / Trade-offs

- Stale network calls can still consume provider-side work until they settle -> The change releases local UI coordination only; transport cancellation remains out of scope.
- An overly broad reset could permit two requests in the same project -> Reset must compare project tokens and tests must prove same-token concurrent requests remain blocked.
- Follow-up requests use structured request handling and pending turns -> Tests must cover structured follow-up, not only first-generation text requests.
