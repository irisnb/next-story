## Context

`LlmConfigUiState` already tracks whether the user has edited the current LLM configuration form. Today that dirty flag only prevents a late async load from overwriting input. It is not exposed as a leave guard.

The configuration page has two important exits: the page back button in `src/llm-config-form.ts`, and native window close handling in `src/main.ts`. The back button currently calls `showPage(...)` directly. Native close currently uses `CloseCoordinator` with only `editor.hasUnsavedChanges()` and `editor.guardLeave()`, so it does not know about unsaved LLM configuration edits.

The project already has a small leave-protection abstraction: `LeaveCoordinator` handles dirty state, user choice, save-and-leave, discard-and-leave, and cancellation. Reusing that behavior keeps this change scoped to configuration state and page wiring.

## Goals / Non-Goals

**Goals:**

- Protect unsaved API address, API Key, and model name edits when leaving the LLM configuration page.
- Protect unsaved LLM configuration edits during native window close.
- Keep editor notebook save semantics unchanged.
- Keep API Key out of confirmation text, logs, thrown errors, and test snapshots.
- Clear the configuration dirty state only after a successful configuration save or after the user explicitly discards changes.

**Non-Goals:**

- No autosave for LLM configuration.
- No backup, versioning, or recovery for LLM configuration.
- No change to Rust LLM configuration storage format.
- No change to草稿本/正文本 save behavior.
- No new provider, model slot, or model selection behavior.

## Decisions

### Reuse the existing leave coordinator for LLM configuration

The configuration form should create its own `LeaveCoordinator` using the existing leave dialog. Its `isDirty` function should read configuration dirty state, and its `save` function should run the same validation and save path as the Save button.

Alternative considered: add a separate custom confirmation dialog just for configuration. That would duplicate the existing three-choice leave behavior and increase the chance that editor and configuration exits diverge.

### Track a saved baseline in configuration state

The dirty flag should represent “current form values differ from the last saved or loaded baseline,” not only “an input event happened.” Loading saved config establishes the baseline. Successful save updates it. Discarding changes clears dirty because the user explicitly authorized leaving without keeping the typed values.

Alternative considered: keep the current boolean dirty flag and clear it only on save. That is too weak because loading, failed load, repeated open, and discard all need explicit semantics.

### Compose close protection in main

Native close should be dirty if either the editor or the configuration form is dirty. The close guard should route through the relevant leave protection. If both are dirty, both guards must pass before the window is destroyed.

Alternative considered: make the editor guard know about configuration state. That would couple writing-content protection to system-configuration protection and blur the product boundary between user notebooks and LLM settings.

## Risks / Trade-offs

- [Risk] Reusing the existing leave dialog means its button labels are generic rather than configuration-specific. → Mitigation: keep the choices semantically identical: save current dirty thing and leave, discard current dirty thing and leave, or cancel.
- [Risk] Save-and-leave during native close may involve both editor save and configuration save. → Mitigation: compose guards in a deterministic order and close only if every required guard returns true.
- [Risk] A failed configuration save could accidentally clear dirty state. → Mitigation: update the configuration baseline only after `saveLlmConfig(...)` resolves successfully.
- [Risk] Tests might accidentally include a literal API Key in expected dialog text. → Mitigation: assert behavior through dirty state and redacted/generic text only.

## Migration Plan

No persisted data migration is required. This is a frontend state and control-flow change around the existing LLM configuration file.

Rollback is removing the configuration leave guard wiring and returning native close to editor-only protection.

## Open Questions

None.
