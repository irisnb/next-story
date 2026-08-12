## Context

`EditorAdapter` is an internal structural type used by `setupEditor` to describe the editor operations that the controller consumes. It currently includes `getHeadCoordinates`, but the controller never calls that method; selection entry coordinate lookup uses `coordinatesAt(position)` instead. The extra member also forces controller test doubles to implement behavior outside the controller's real dependency boundary.

## Goals / Non-Goals

**Goals:**

- Make `EditorAdapter` describe only the capabilities consumed by `setupEditor`.
- Remove the matching obsolete method from the focused controller test double.
- Preserve all runtime editor and selection coordinate behavior.

**Non-Goals:**

- Removing or changing `PlainTextEditorAdapter.getHeadCoordinates`.
- Changing `coordinatesAt(position)`, selection mapping, AI selection entry, or editor behavior.
- Changing any product requirement or public data format.

## Decisions

- Remove only `getHeadCoordinates` from the `Pick<PlainTextEditorAdapter, ...>` declaration in `src/editor.ts`. This narrows the controller dependency without changing the concrete adapter.
- Remove `getHeadCoordinates` from `FakePlainTextEditor` in `tests/editor.test.ts` because the fake should satisfy the narrowed controller boundary rather than the concrete adapter's full surface.
- Retain the concrete adapter method and its coordinate tests. Removing it would expand this cleanup into a broader API decision without a demonstrated need.
- Verify with TypeScript type checking and the frontend test suite because the intended effect is compile-time boundary cleanup with zero runtime change.

## Risks / Trade-offs

- [Risk] Another controller path might rely on the removed member indirectly. -> The source graph shows no production call from `src/editor.ts`; type checking and focused tests will verify the narrowed interface.
- [Trade-off] The concrete adapter continues to expose an apparently unused convenience method. -> Keeping it confines this change to the confirmed stale controller requirement and avoids an unrelated public-surface cleanup.
