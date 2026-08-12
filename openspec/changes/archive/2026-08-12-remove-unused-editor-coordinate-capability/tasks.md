## 1. Narrow The Controller Boundary

- [x] 1.1 Remove `getHeadCoordinates` from the `EditorAdapter` capability list in `src/editor.ts`.
- [x] 1.2 Remove the now-unnecessary `getHeadCoordinates` implementation from `FakePlainTextEditor` in `tests/editor.test.ts`.

## 2. Verify Behavior Is Unchanged

- [x] 2.1 Run TypeScript type checking and confirm the narrowed test double still satisfies the editor dependency.
- [x] 2.2 Run the frontend test suite and confirm editor selection, coordinate, save, and AI entry behavior remains green.
