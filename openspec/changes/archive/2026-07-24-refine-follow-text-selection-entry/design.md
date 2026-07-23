## Context

The selection AI entry is already part of `selection-ai-invocation`: selecting non-blank text in the draft notebook or main notebook shows a floating entry near the active selection, and clicking it opens a two-action menu with `及时召唤` and `思维扩展`.

The earlier single-dot entry was visually light because it stayed close to the selected text. After the entry gained a secondary menu, the same positioning approach became more fragile: the clickable target is small, menu expansion can shift the visual weight, clicking the trigger can blur the textarea and hide the native selection highlight, and the selected line may not have enough room to the right of its final character.

## Goals / Non-Goals

**Goals:**

- Keep the entry visually tied to the selected text instead of making it a permanently fixed editor-side tool.
- Make the trigger large enough to click reliably while preserving a quiet dot-like affordance.
- Add deterministic edge avoidance for full lines and editor boundaries.
- Keep the trigger position stable while the secondary menu is open.
- Preserve all current AI boundaries: no direct notebook writes, no extra prompt input for `及时召唤`, and no model request before `思维扩展` starts from the right panel.

**Non-Goals:**

- Do not introduce a fixed right-side selection toolbar as the default behavior.
- Do not add new AI actions beyond `及时召唤` and `思维扩展`.
- Do not add an input field to the floating entry or menu.
- Do not change backend request structure, LLM configuration, storage, or project files.
- Do not create any path for AI output to insert, replace, append, rewrite, delete, move, split, merge, or organize draft notebook or main notebook text.

## Decisions

1. Keep selected-text anchoring as the primary placement model.

   The trigger remains anchored near the active selection's focus end, matching the existing mental model that the entry belongs to the selected text. A permanently fixed editor-side entry was considered because it is easier to stabilize, but it weakens the local relationship between the selected words and the AI action.

2. Use a larger outer-circle trigger with a smaller inner dot.

   The current tiny dot is too difficult to target. The updated trigger should read as the same quiet dot affordance, but with a larger click area. Styling belongs in CSS; behavior tests should assert functional classes and placement state rather than fragile pixel-perfect colors.

3. Prefer right-of-text placement, then fall back below the selected line near the right side when the line is full.

   The default placement stays to the right of the final selected character when there is enough room. If that would collide with the editor edge or cover text on a full line, the trigger falls back below the selected line and remains horizontally near the selection's right edge. This keeps the entry attached to the same selected text without turning it into a fixed side tool.

4. Keep existing menu expansion behavior, but lock trigger position while the secondary menu is open.

   Opening the menu must not cause the trigger to jump. This change does not redesign the menu's expansion model; it keeps the existing menu behavior and fixes the coupling that made the trigger move together with the opened menu.

5. Treat textarea highlight loss as a focus artifact, not as selection loss.

   Clicking the trigger may make the browser stop drawing the native textarea selection highlight. The product-level guarantee is the frozen selection snapshot used by `及时召唤` or `思维扩展`; UI copy that already communicates the frozen selection in the AI panel remains the main confirmation. This change does not add a custom in-text highlight unless a later product decision asks for it.

## Risks / Trade-offs

- Textarea coordinate estimation can still differ across fonts, zoom levels, scroll positions, and platform rendering. Mitigation: keep placement rules simple, clamp to editor bounds, and cover edge cases with focused DOM tests.
- Below-line fallback may compete with the next line when line spacing is tight. Mitigation: reserve enough visual offset for the trigger and hide/reposition if the focus end is outside the visible editor viewport.
- Menu expansion adds width near text. Mitigation: keep the existing menu expansion behavior, but compute it from a locked trigger anchor so the trigger does not move with the menu.
- Native selection highlight may disappear on trigger click. Mitigation: preserve the frozen snapshot behavior and continue showing selected-character context outside the notebooks, without writing or drawing into notebook content.
