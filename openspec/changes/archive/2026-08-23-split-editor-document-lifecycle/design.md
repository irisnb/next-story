## Context

The existing `setupEditor` closure already delegates toolbar, find, keyboard, link-popover, and context-menu behavior to focused modules. It still owns document loading and switching, current-document view rendering, save-state coordination, validation, and controller assembly. The refactor must preserve the current `EditorController` facade and the transaction-like replacement of editor instances when opening a project or document.

## Goals / Non-Goals

**Goals:**

- Extract three narrow internal modules: document session, document view, and persistence.
- Keep editor adapter dependencies capability-based rather than passing the complete controller into extracted modules.
- Preserve stale asynchronous load protection, save-before-switch, failed-save baseline behavior, deletion fallback, and existing public controller methods.
- Add focused tests for the extracted boundaries while retaining the existing editor regression tests.

**Non-Goals:**

- No change to user-visible behavior, document serialization, storage commands, AI semantics, selection-entry behavior, or rich-text editing.
- No change to the `EditorController` method names or its consumer-facing contract.
- No new persistence mechanism or state-management library.

## Decisions

1. **Use three modules with narrow callback contracts.**
   - `editor-document-session.ts` owns current project/document identity, load generation, document read/parse/create, switching, and deletion fallback decisions.
   - `editor-document-view.ts` owns only DOM rendering for the current document, empty state, and document list; it receives tree/current-id accessors and a document-switch callback.
   - `editor-persistence.ts` owns `EditorSaveState`, serialization/validation/size checks, save/reject-save operations, and save-status rendering; it receives the current editor/project/document accessors and persistence callbacks.
   - Alternative considered: one `editor-core.ts` module. Rejected because it would move the large closure without separating view and persistence responsibilities.

2. **Keep `src/editor.ts` as composition root and facade.**
   - The composition root creates modules, wires their callbacks, owns interaction-module lifecycle, and implements the existing `EditorController` object.
   - Alternative considered: expose the new modules to `main.ts`. Rejected because it would widen public API and make consumers coordinate internal lifecycle state.

3. **Represent editor access through narrow interfaces.**
   - Persistence receives only the document getter and save callback needed for persistence.
   - Session receives only editor construction, document read, current editor replacement, and state-transition callbacks.
   - View receives only `AppDom`, tree/current-id accessors, and document-switch action.
   - No extracted module receives `EditorController`, AI write callbacks, or notebook file handles.

4. **Preserve async and replacement ordering explicitly.**
   - Session increments a generation before every project/document load and ignores stale read or parse results.
   - The composition root installs the newly parsed editor and save baseline only after the read/parse/create sequence succeeds, then disposes the previous editor.
   - Alternative considered: move all mutable state into a shared store. Rejected because it adds an abstraction and makes ownership less explicit for this refactor.

## Risks / Trade-offs

- [Risk] Callback contracts can accidentally create circular ownership. → Keep state transitions in the composition root and make modules invoke actions rather than mutate unrelated modules.
- [Risk] Moving save logic can alter dirty-baseline or error behavior. → Reuse `EditorSaveState` unchanged and add focused tests for validation failure, persistence failure, and successful save.
- [Risk] A stale asynchronous load could replace a newer document. → Preserve generation checks and test project/document switching races.
- [Risk] Deletion fallback could leave stale overlays or selection state. → Keep the existing reset/close callbacks in the session transition and verify the editor regression suite.

## Migration Plan

1. Add focused module interfaces and tests without changing the public controller.
2. Move view rendering, persistence, and session logic one responsibility at a time, keeping behavior-equivalent callbacks in `editor.ts`.
3. Run focused editor tests, the complete frontend suite, typecheck, lint, and build.
4. If a regression appears, revert the internal extraction while preserving the existing public facade; no data migration or rollback procedure is required.

## Open Questions

None for this scope. Module names and the stable facade are fixed by this design.
