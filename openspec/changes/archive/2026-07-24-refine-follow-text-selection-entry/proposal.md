## Why

The current selection AI entry became harder to use after the original single dot entry grew into a trigger with a secondary menu. We want to keep the lighter "near the selected text" relationship, while making the larger prototype button and menu stable enough for real writing cases such as full lines, editor edges, scrolling, and click focus changes.

## What Changes

- Keep the AI entry anchored near the active selection text instead of moving it to a permanently fixed editor-side position.
- Change the visible trigger from a very small low-contrast dot into a larger "outer circle with inner dot" trigger that is easier to click while still visually quiet.
- Define edge-avoidance behavior so the trigger does not cover selected text, run outside the editor, or collide with the editor edge when the selected line is full.
- Keep the existing secondary menu expansion behavior, while fixing the bug where the trigger moves together with the opened menu.
- Preserve the current action boundary: the menu still only offers `及时召唤` and `思维扩展`; neither action writes AI output into the draft notebook or main notebook.
- Preserve the current request boundary: `及时召唤` still sends no initial user question, and `思维扩展` still enters the right AI panel prestate before any model request.
- Use the confirmed full-line fallback: when the trigger cannot fit to the right of the selected text, place it below the selected line near the right side.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `selection-ai-invocation`: refine the floating selection entry's visual size, selected-text anchoring, edge avoidance, and secondary menu stability.

## Impact

- Affected frontend code: selection floating entry positioning, menu display, and CSS styling.
- Affected tests: selection entry behavior tests and any DOM tests that assert trigger/menu placement or class behavior.
- Affected specification: `selection-ai-invocation` requirements for the visible entry, active selection lifecycle, and menu opening behavior.
- No backend API, model request, LLM configuration, storage, project file, draft notebook, or main notebook changes are expected.

## Confirmed Product Decisions

- Full-line fallback: when the trigger cannot fit to the right of the selected text, place it below the selected line near the right side.
- Menu behavior: keep the existing menu expansion logic; the specific fix is that opening the menu MUST NOT move the trigger away from its selected-text anchor.
- Frozen selection indication: no new custom in-text highlight is included in this change; existing AI panel selection context remains the confirmation outside the notebooks.
