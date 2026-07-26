## Why

The current AI selection entry can represent the wrong end of a reversed selection, remain visible after its editor context is no longer valid, overflow or cover selected text near boundaries, and perform expensive full-document mirror layout work on high-frequency selection events. These problems directly affect the first-version AI entry point: users may see the entry in the wrong place, act on stale selection state, or experience writing lag in long texts.

## What Changes

- Track the active selection focus offset from the browser selection direction instead of assuming `selectionEnd` is always the focus end.
- Hide or invalidate the floating entry when the active notebook, textarea focus, editor layout, project context, or page context no longer matches the live selection it represents.
- Rework trigger and menu placement so the entry remains inside the editor viewport, avoids selected text, and accounts for the menu footprint near edges.
- Reduce selection geometry work for long texts by coalescing high-frequency updates, avoiding duplicate caret measurement per update, and avoiding full-document mirror work where practical.
- Add focused tests for reversed selections, lifecycle invalidation, edge placement, and long-text selection update performance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `selection-ai-invocation`: Tighten the floating AI entry contract for reversed selections, active-selection lifecycle invalidation, boundary-aware trigger/menu placement, and long-text update performance.

## Impact

- Affected frontend modules: `src/selection-entry.ts`, `src/selection-adapter.ts`, `src/caret-coordinates.ts`, `src/editor.ts`, and likely adjacent tests under `tests/`.
- Affected UI behavior: only the floating AI selection entry and its menu placement/lifecycle.
- No change to the AI model request contract, saved project files, LLM configuration storage, or the permanent rule that AI never writes to 草稿本 or 正文本.
