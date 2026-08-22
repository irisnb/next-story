## 1. Baseline and contracts

- [x] 1.1 Record the current editor behavior test baseline and inspect the existing `EditorController` and adapter contracts.
- [x] 1.2 Add or formalize narrow interfaces for extracted interaction modules without changing public controller types.
- [x] 1.3 Add contract tests for module setup and disposal ownership where existing coverage is indirect.

## 2. Extract interaction modules

- [x] 2.1 Extract toolbar and format-drawer behavior with focused DOM and editor-command dependencies.
- [x] 2.2 Extract find/replace behavior and its local state behind the existing editor adapter capabilities.
- [x] 2.3 Extract link popover behavior and preserve link discovery, editing, creation, removal, and dismissal semantics.
- [x] 2.4 Extract context-menu behavior and preserve clipboard, paste, and link action semantics.
- [x] 2.5 Extract global keyboard handling with the existing capture phase and text-input focus guards.

## 3. Rewire and verify

- [x] 3.1 Wire extracted modules from `setupEditor`, preserving listener ordering, cleanup, and lifecycle ownership.
- [x] 3.2 Keep document lifecycle, switching, saving, AI attachment, and the public controller facade behavior-compatible.
- [x] 3.3 Add minimal focused tests for previously indirect toolbar, overlay, and keyboard interactions.
- [x] 3.4 Run editor-focused tests and complete frontend verification: `npm run test:frontend`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- [x] 3.5 Run OpenSpec strict validation, update the roadmap and bug ledger, sync the capability spec if needed, and archive after confirmation.
