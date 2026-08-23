## ADDED Requirements

### Requirement: Document lifecycle uses narrow internal modules

The editor SHALL isolate document session, document view, and persistence responsibilities behind focused modules, and no extracted module SHALL require the complete `EditorController`.

#### Scenario: Editor is composed from focused modules

- **WHEN** `setupEditor` initializes the writing editor
- **THEN** document session, document view, and persistence modules receive only the DOM nodes, state accessors, editor capabilities, callbacks, and storage functions required by their responsibility
- **AND** `src/editor.ts` remains the composition root and stable controller facade

### Requirement: Controller facade remains behavior-compatible

The editor SHALL preserve the existing `EditorController` methods and the narrow rich-text editor capability boundary used by current consumers.

#### Scenario: Existing controller consumer calls the facade

- **WHEN** project navigation, leave protection, AI attachment, or file management calls an existing editor controller method
- **THEN** the call continues to compile and produces the same observable result as before the extraction

### Requirement: Document loading and switching preserve ordering guarantees

The document session SHALL preserve stale-load isolation, successful editor replacement ordering, and save-before-switch behavior.

#### Scenario: Stale document read resolves after a newer load

- **WHEN** an earlier asynchronous document read resolves after a later project or document load has started
- **THEN** the stale result is ignored and cannot replace the current editor, document id, or save baseline

#### Scenario: Switching from an unsaved document

- **WHEN** the user switches documents while the current document has unsaved changes
- **THEN** the current document is saved before the switch
- **AND** a failed save prevents the switch and preserves the unsaved baseline

### Requirement: Persistence extraction preserves validation and failure semantics

The persistence module SHALL preserve notebook normalization, structural validation, size-limit checks, save-status rendering, and the existing dirty-baseline behavior on failure.

#### Scenario: Invalid or oversized document is saved

- **WHEN** the current editor document fails notebook validation or the size limit
- **THEN** the save operation reports the existing user-facing failure state
- **AND** it does not write the document through the persistence callback
- **AND** the current content remains unsaved

#### Scenario: Successful document save

- **WHEN** a valid current document is saved
- **THEN** the persistence callback receives the canonical serialized document
- **AND** the save state reports the same successful baseline and status as before extraction

### Requirement: Document view and deletion fallback remain consistent

The document view module SHALL preserve current-document title, document-list selection, empty-state rendering, and deletion fallback behavior.

#### Scenario: Current document is deleted from the content tree

- **WHEN** a tree update removes the current document and the user confirms discarding unsaved changes when required
- **THEN** the editor switches to the first remaining document or displays the existing empty state
- **AND** the current document id, editor instance, save state, selection entry, and overlays are reset consistently

### Requirement: Refactoring does not expand product scope

The module extraction SHALL NOT modify document storage formats, Rust/Tauri commands, AI request semantics, AI panel behavior, selection-entry semantics, or the boundary that AI output remains outside user documents.

#### Scenario: AI remains attached without document write authority

- **WHEN** AI integration is attached to the composed editor
- **THEN** current-editor access and attachment behavior remain unchanged
- **AND** no extracted lifecycle module receives a capability to write user document content on behalf of AI

### Requirement: Regression coverage protects extracted boundaries

The change SHALL retain existing editor regression coverage and add focused tests for the extracted document lifecycle, view, and persistence contracts.

#### Scenario: Verification runs after extraction

- **WHEN** focused editor tests and the complete frontend verification commands run
- **THEN** they pass without changing existing behavior expectations
