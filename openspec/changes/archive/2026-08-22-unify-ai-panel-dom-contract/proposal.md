## Why

`src/ai-panel.ts` currently mixes the `AppDom` dependency with scattered global
`document.getElementById` lookups and a local root query. This makes the panel's
DOM contract difficult to test and allows the entry point and its internal nodes
to drift apart when the UI changes. The next hardening step is to make the
existing contract explicit without changing user-visible AI behavior.

## What Changes

- Introduce one explicit, typed DOM dependency contract for the AI panel.
- Move required panel-node resolution and validation to the shared DOM assembly
  boundary, or an equivalent narrow adapter owned by that boundary.
- Make `setupAiPanel` consume the resolved contract instead of performing
  scattered global ID lookups.
- Preserve all existing IDs/classes, event behavior, rendering behavior, and
  text-only AI output handling.
- Add contract tests for complete DOM assembly, missing required nodes, and
  existing panel interactions.
- Do not change the AI state machine, request orchestration, layout, or document
  write capabilities.

## Capabilities

### New Capabilities

- `ai-panel-dom-contract`: A single typed and testable dependency contract for
  required AI panel DOM nodes.

### Modified Capabilities

- `ai-panel-rendering-boundaries`: Rendering and interaction behavior remain the
  same, while the panel receives its required DOM nodes through the explicit
  contract.

## Impact

- Affects `src/dom.ts`, `src/ai-panel.ts`, the AI panel DOM fixture/tests, and
  possibly the application bootstrap wiring that constructs `AppDom`.
- No Rust/Tauri changes, storage changes, AI protocol changes, or persisted
  document format changes.
- No user-facing behavior or product concept changes are intended.
