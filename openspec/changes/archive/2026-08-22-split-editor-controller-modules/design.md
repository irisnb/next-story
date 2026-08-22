## Context

`src/editor.ts` is the compatibility facade for the writing editor, but it also owns several unrelated UI interaction systems. Existing modules already establish narrow boundaries for rich-text editing, formatting analysis, saving state, find matching, margins, controlled paste, and selection entry. The remaining extraction must preserve the public controller surface and existing behavior while reducing direct cross-responsibility coupling.

## Goals / Non-Goals

**Goals:**

- Keep lifecycle, document loading/switching, persistence, and the public `EditorController` facade in one stable orchestration boundary.
- Extract keyboard handling, toolbar/format drawer, find/replace, link popover, and context menu behind narrow interfaces.
- Make dependencies explicit and one-directional: extracted modules may receive focused services, but must not import the full controller.
- Freeze and extend behavior tests so the refactor is demonstrably behavior-preserving.

**Non-Goals:**

- No Rust/Tauri changes, storage-format changes, new editor features, UI redesign, or copy changes.
- No changes to AI request behavior, selection-entry semantics, or the rule that AI never writes user documents.
- No second extraction of modules already split out of `editor.ts`.

## Decisions

1. **Use focused service interfaces instead of a shared editor context.** A shared context would be convenient but would recreate the current broad dependency surface. Each module receives only the DOM nodes, editor capabilities, state accessors, and actions it needs.
2. **Keep `EditorController` as the facade.** `main.ts`, leave protection, document navigation, and AI integration continue using the existing controller methods. Extracted modules are implementation details wired during setup.
3. **Extract in dependency order.** First freeze current tests and introduce interfaces; then move the cleanest find/replace and overlay modules, followed by toolbar and keyboard handling; finally simplify lifecycle wiring and add missing behavior tests.
4. **Preserve event ownership and ordering.** Existing capture/bubble phases, focus guards, Escape handling, outside-click closing, and save-before-switch behavior remain the contract. Refactoring is complete only when current and new tests pass.

## Risks / Trade-offs

- [Risk] An extracted module may accidentally broaden its dependency through callbacks. → Keep interfaces local, type them explicitly, and add a contract test or compile-time shape check for each boundary.
- [Risk] Event listener registration or disposal order may change. → Centralize setup/dispose ownership in the controller and retain existing event-focused regression tests.
- [Risk] Large mechanical moves make review difficult. → Extract one responsibility group at a time and run focused tests after each group.
- [Risk] Existing uncommitted work can be overwritten. → Restrict edits to this change's scoped frontend files and reconcile against the current working tree before each edit.

## Migration Plan

1. Record the baseline frontend test result and verify the current controller contract.
2. Add focused interfaces and extract interaction modules without changing public exports.
3. Wire modules from `setupEditor`, preserve cleanup, and add missing interaction tests.
4. Run focused editor tests, full frontend checks, typecheck, lint, and build.
5. Validate the OpenSpec change, sync any new capability specification, and archive after user-confirmed implementation.

Rollback is a source-level revert of the extracted modules and wiring; no persisted data or runtime migration is introduced.

## Open Questions

- None for the proposed scope. The exact file names of extracted modules may be selected during implementation as long as the interfaces and behavior requirements remain unchanged.
