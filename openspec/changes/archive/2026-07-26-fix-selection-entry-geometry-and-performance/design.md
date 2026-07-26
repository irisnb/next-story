## Context

The AI floating selection entry is part of the current `selection-ai-invocation` capability. It is implemented in `src/selection-entry.ts`, captures immutable snapshots through `src/selection-adapter.ts`, and measures textarea geometry through `src/caret-coordinates.ts`.

The current implementation has four coupled problems:

- It normalizes `selectionStart` / `selectionEnd` and then uses `snapshot.end` as the visual focus anchor, even though backward mouse or keyboard selections focus the smaller offset.
- It updates from textarea events and global `selectionchange`, but it does not explicitly invalidate the entry on blur, notebook tab switch, editor/page context changes, resize, or AI panel layout changes.
- It positions the trigger from a caret point only, so it cannot reason about selected-text overlap or menu footprint near editor/window edges.
- It calls the mirror-based caret measurement twice per update and the mirror copies the full textarea value suffix, which scales poorly for long writing sessions.

This change keeps the product boundary unchanged: AI output remains temporary, and no code path may write AI text into 草稿本 or 正文本.

## Goals / Non-Goals

**Goals:**

- Make the visible entry anchor follow the browser focus end for both forward and backward selections while keeping snapshot `start` / `end` normalized for identity and request state.
- Define and implement explicit invalidation rules so the entry only represents the current live textarea selection.
- Make trigger/menu placement boundary-aware and avoid covering selected text when reasonable placement space exists.
- Reduce high-frequency selection update cost for long texts by measuring once per scheduled update and by avoiding full-document mirror work where possible.
- Cover the behavior with deterministic frontend tests and, where DOM layout limits exist in Node tests, isolate geometry decisions into pure functions.

**Non-Goals:**

- No change to prompt content, AI request payload semantics, LLM configuration, or model selection.
- No introduction of multiple conversations, history, persistence, nearby context, summaries, or writing-back actions.
- No rewrite of the editor textareas into a custom rich editor.
- No pixel-perfect promise for every platform font renderer; the requirement is stable containment, focus-end correctness, and practical non-overlap behavior.

## Decisions

### Preserve normalized snapshots and add separate focus geometry state

`SelectionSnapshot.start` and `SelectionSnapshot.end` stay normalized because they are used for immutable identity and selection text extraction. The visual anchor should be computed separately from `HTMLTextAreaElement.selectionDirection`: `backward` uses the lower offset as focus; `forward` and `none` use the higher offset.

Alternative considered: store raw start/end directly in the snapshot. Rejected because it would mix request identity with transient browser focus semantics and could disturb existing AI freeze behavior.

### Centralize entry invalidation rather than adding one-off event patches

The controller should expose reset/invalidate hooks that editor and AI feature boundaries can call on tab switch, project unload, page changes, and layout-affecting AI panel changes. The controller should also hide on textarea blur or pointer/focus movement outside the active textarea/entry, unless the movement is the controlled entry/menu interaction that preserves selection.

Alternative considered: add only `blur` and `resize` listeners. Rejected because the stale-entry bug comes from context ownership, not from one missing browser event.

### Split geometry into pure placement decisions plus DOM measurement adapters

Placement should receive enough geometry to choose a stable location: editor viewport rect, trigger size, menu size when open, focus caret rect, and selected-line/selection rect information when available. The pure decision layer should choose right/left/below/above or a clamped fallback and explicitly test edge cases. DOM adapters should gather real measurements and feed them into the pure layer.

Alternative considered: keep the current caret-only placement and clamp harder. Rejected because clamping can push the trigger back over selected text and cannot reserve menu width.

### Coalesce updates and reuse measurement results

Selection entry updates should be scheduled with `requestAnimationFrame` or an equivalent testable scheduler so multiple same-frame events collapse into one calculation. A single update should compute focus geometry once and reuse it for visibility and placement. Mirror measurement should avoid copying the whole textarea suffix; it only needs the text prefix up to the focus offset plus a marker span. Computed style/mirror setup should be reusable or cached until textarea style or size invalidates.

Alternative considered: debounce with a fixed timeout. Rejected because it can make the entry feel laggy and introduces arbitrary timing into the writing surface.

## Risks / Trade-offs

- [Risk] Browser textarea geometry is difficult to test perfectly under Node's test runner. → Mitigation: move placement and lifecycle rules into pure functions, and keep browser-dependent tests focused on observable state transitions rather than exact pixels.
- [Risk] Menu footprint measurement is not available until the menu exists in the DOM. → Mitigation: keep the menu mounted but hidden/measurable or measure on open before final placement, without changing the trigger anchor after menu opens unless the context is invalidated.
- [Risk] Coalesced updates can briefly show stale coordinates for one frame. → Mitigation: hide immediately on hard invalidation events such as tab switch, project unload, textarea blur, and request start; only geometry refreshes are frame-scheduled.
- [Risk] Optimizing mirror measurement can subtly change caret coordinates. → Mitigation: keep existing caret-coordinate tests, add long-text and representative multiline cases, and verify placement behavior rather than relying only on implementation internals.

## Migration Plan

No data migration is required. This is a frontend behavior change only. If the implementation causes regressions, it can be rolled back by reverting the frontend modules and tests for this change; no project files or user configuration formats are affected.

## Open Questions

None currently. The implementation should not expand scope into AI request behavior or notebook text persistence.
