## 1. Establish module contracts

- [x] 1.1 Define narrow interfaces for document session, document view, and persistence without changing `EditorController`.
- [x] 1.2 Add focused test fixtures for editor, DOM, storage, and project/document callbacks as needed.

## 2. Extract persistence

- [x] 2.1 Move save-state rendering, serialization, validation, size checks, save, and reject-save behavior to `editor-persistence.ts`.
- [x] 2.2 Wire persistence into `editor.ts` and add focused success, validation failure, size failure, and write failure tests.

## 3. Extract document view

- [x] 3.1 Move document title, empty-state, document-list rendering, list toggle, and close behavior to `editor-document-view.ts`.
- [x] 3.2 Wire view callbacks and add focused current-document and list rendering tests.

## 4. Extract document session

- [x] 4.1 Move document reading, parsing, generation checks, switching, project loading, and deletion fallback coordination to `editor-document-session.ts`.
- [x] 4.2 Wire session transitions while preserving editor replacement ordering, overlay cleanup, memory restoration, and AI selection reset.
- [x] 4.3 Add focused tests for stale loads, save-before-switch, project open failure, and current-document deletion fallback.

## 5. Verify and document

- [x] 5.1 Confirm `src/editor.ts` remains the stable composition root and no extracted module depends on `EditorController`.
- [x] 5.2 Run focused editor tests, `npm run test:frontend`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- [x] 5.3 Run `openspec validate --all` and inspect the final diff for scope compliance.
