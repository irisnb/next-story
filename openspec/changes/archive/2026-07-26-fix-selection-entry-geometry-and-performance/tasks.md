## 1. Selection Focus and Snapshot Boundaries

- [x] 1.1 Add tests proving forward selections anchor to the higher offset and backward mouse/keyboard selections anchor to the lower offset.
- [x] 1.2 Extend selection capture or entry state with focus-offset geometry while keeping `SelectionSnapshot.start` and `SelectionSnapshot.end` normalized.
- [x] 1.3 Update entry visibility and placement to use the focus offset instead of assuming `snapshot.end` is the focus end.

## 2. Lifecycle Invalidation

- [x] 2.1 Add tests for hiding the entry on textarea blur outside the entry/menu, notebook tab switch, page/project unload, and stale menu context.
- [x] 2.2 Add explicit selection-entry invalidation hooks and wire them from editor tab switching, project begin/end, and relevant page/layout transitions.
- [x] 2.3 Keep controlled entry/menu interactions from destroying the textarea selection while still hiding stale entries when focus moves elsewhere.

## 3. Geometry and Menu Placement

- [x] 3.1 Add pure placement tests for right edge, bottom edge, four-corner, narrow-window, selected-text overlap, and menu-footprint scenarios.
- [x] 3.2 Refactor trigger/menu placement to accept focus caret geometry, selected-line or selection rect geometry, trigger size, menu size, and editor/window bounds.
- [x] 3.3 Ensure menu opening keeps the trigger anchor stable while hiding the entry if its selection context becomes invalid.

## 4. Long-Text Performance

- [x] 4.1 Add tests or benchmarks around coalescing repeated update events and avoiding duplicate focus measurement during one update.
- [x] 4.2 Schedule high-frequency entry updates through a requestAnimationFrame-style coalescer while hard invalidations still hide immediately.
- [x] 4.3 Rework caret measurement so one update measures focus geometry once and avoids copying the whole textarea suffix for long texts.
- [x] 4.4 Ensure global selectionchange outside the active writing textarea does not trigger expensive geometry work on long notebook content.

## 5. Verification

- [x] 5.1 Run `npm run typecheck`.
- [x] 5.2 Run `npm run test:frontend`.
- [x] 5.3 Run `npm run build`.
- [x] 5.4 Manually verify the floating entry in the desktop/browser surface for forward selection, backward selection, tab switch, resize/panel layout change, and long-text selection responsiveness.
