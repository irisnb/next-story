## Why

AI request confirmation at the writing moment interrupts the selected-text invocation flow and can make a simple summon feel like the app has stopped. The privacy boundary should be visible before use on the LLM/API configuration page, not repeated as a blocking dialog in the writing surface.

## What Changes

- Remove the pre-request creative-content confirmation dialog shown before AI generation sends selected text or follow-up conversation to the configured model service.
- Keep AI generation bound to the existing selected-text and temporary-dialogue payload rules; this change does not add broader context, persistence, or write-back behavior.
- Add one user-visible explanatory line on the LLM/API configuration page stating that AI requests send the selected text and follow-up content to the configured model service, and that AI replies remain temporary panel material outside the draft and main notebooks.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `llm-configuration`: Replace blocking per-origin send confirmation with configuration-page disclosure for AI request data boundaries.
- `selection-ai-invocation`: Remove the request-before-confirmation path from immediate selected-text summon behavior while preserving visible request states.
- `ai-thinking-panel`: Remove the panel state that only exists for a canceled send confirmation while preserving blocked-request visibility.
- `summon-ai-follow-up`: Make follow-up requests use the existing temporary-dialogue payload without showing a send confirmation dialog.

## Impact

- Affected frontend code: AI request preflight flow, LLM/API configuration page copy, and related tests.
- Affected Tauri permissions may shrink if the dialog capability is no longer used elsewhere.
- No backend API contract changes, no new dependency, no project metadata change, and no AI write access to draft or main notebook text.
