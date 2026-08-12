## Why

`EditorAdapter` currently declares the unused `getHeadCoordinates` capability even though the editor controller obtains coordinates exclusively through `coordinatesAt(position)`. Removing this stale type requirement keeps the controller boundary aligned with the behavior it actually consumes and avoids requiring test doubles to implement an irrelevant method.

## What Changes

- Remove `getHeadCoordinates` from the `EditorAdapter` capability list in `src/editor.ts`.
- Remove the corresponding unused method from the editor controller test double.
- Keep `PlainTextEditorAdapter.getHeadCoordinates`, `coordinatesAt(position)`, selection handling, and all runtime behavior unchanged.

## Capabilities

### New Capabilities

- `editor-controller-boundary`: Defines that narrowing the editor controller's internal dependency surface preserves existing editor and AI-entry behavior.

### Modified Capabilities

None.

## Impact

- Affected code: `src/editor.ts` and its focused test double in `tests/editor.test.ts`.
- Public product behavior, saved project data, AI boundaries, dependencies, and runtime editor coordinate handling are unchanged.
