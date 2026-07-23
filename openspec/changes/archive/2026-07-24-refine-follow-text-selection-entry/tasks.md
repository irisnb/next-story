## 1. Positioning Behavior

- [x] 1.1 Update selection-entry placement to keep the trigger anchored near the active selection focus end by default.
- [x] 1.2 Add right-side space detection so the trigger stays to the right of the final selected character only when it has enough room.
- [x] 1.3 Add below-line fallback so full-line or right-edge selections place the trigger below the selected line near the right side.
- [x] 1.4 Clamp trigger placement to the editor's visible bounds and hide it when the focus end is outside the visible editor viewport.

## 2. Trigger And Menu UI

- [x] 2.1 Restyle the trigger as a larger outer circle with a small inner dot while preserving a quiet low-contrast default state.
- [x] 2.2 Preserve an opened visual state for the trigger while the secondary menu is visible.
- [x] 2.3 Keep the trigger's anchor stable while the secondary menu opens, and only adjust the menu surface to fit available space.
- [x] 2.4 Keep the secondary menu limited to `及时召唤` and `思维扩展`, with no input field or writeback action.

## 3. Tests And Verification

- [x] 3.1 Add or update selection-entry tests for right-of-text default placement and below-line full-line fallback.
- [x] 3.2 Add or update menu tests proving the trigger does not jump when the menu opens.
- [x] 3.3 Run focused frontend tests covering selection entry behavior.
- [x] 3.4 Run project verification commands required by the implementation scope.
