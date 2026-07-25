## Context

The current product has one replaceable temporary conversation in the AI panel. `及时召唤` starts immediately from a frozen selection and has no initial text input. `思维扩展` first enters a preparation state, optionally collects a direction, then starts the same kind of temporary conversation. After the first response succeeds, follow-ups are sent as structured requests containing the frozen selected text and the current visible conversation turns.

Issue 6 is a continuity bug in that structure. The first `思维扩展` request can include `thinking_direction`, but follow-up reconstruction only has the selected text plus assistant/user follow-up messages. The backend therefore cannot reconstruct the first user message exactly as it was first sent.

## Goals / Non-Goals

### Goals

- Preserve the exact initial user material needed for follow-up request assembly in the current temporary conversation.
- Make `思维扩展` follow-ups continue to include the original direction as part of the first user message context.
- Keep `及时召唤` semantics unchanged and direction-free.
- Cover the behavior with targeted regression tests.

### Non-Goals

- Persist temporary conversations across app restarts or project changes.
- Add multiple conversations, conversation history, summaries, or truncation.
- Add nearby context, full notebook text, project metadata, AI content library, or user-confirmed story information to model requests.
- Add any UI action that writes AI output into 草稿本 or 正文本.

## Decisions

### Store first user material as conversation request metadata

The frontend should treat the first user material as immutable metadata of the current temporary conversation. For `及时召唤`, that material represents the frozen selected text. For `思维扩展`, it represents the frozen selected text plus the non-empty direction in the same meaning used by the first request.

This keeps follow-up assembly tied to the actual conversation origin instead of asking each follow-up to infer first-turn context from UI state.

### Prefer structured preservation over prompt-string parsing

The preserved metadata should be structured enough that code does not need to parse a previously generated prompt string. A minimal acceptable shape is the frozen selected text plus an optional initial direction, or an equivalent first-user-message field that is produced by one shared formatter.

The implementation must avoid broad compatibility shims. This is an unreleased internal request shape, so the fix can update the current frontend/backend contract and tests together.

### Backend remains stateless

The backend should not store session state. Each follow-up request must still carry the complete temporary conversation material needed to assemble messages for that one model call. That preserves the current boundary: temporary conversation state lives in the current app runtime and is cleared when the project or app lifecycle clears it.

## Risks

- If the frontend stores only the direction and the backend has a separate formatter for first requests and follow-ups, the two paths can drift again. Prefer a shared construction path or shared request field.
- If tests assert only visible UI text, they may miss the bug because the lost direction is inside the model request. Tests must inspect the request payload or mocked generation call.
- If the fix appends direction as an extra later user turn, it changes conversation order. The direction belongs to the initial user material, not to a new follow-up turn.

## Verification

- Add a failing regression test where `思维扩展` starts with a non-empty direction, succeeds, then submits a follow-up; the mocked follow-up request must still contain the original direction as first-turn material.
- Add or keep coverage that `及时召唤` follow-ups do not invent a direction field.
- Run targeted frontend tests covering AI panel and request assembly.
- Run the project check command if the environment supports it; document unrelated pre-existing failures separately.
