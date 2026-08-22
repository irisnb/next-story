# editor-module-boundaries Specification

## Purpose
TBD - created by archiving change split-editor-controller-modules. Update Purpose after archive.
## Requirements
### Requirement: Editor interaction responsibilities use narrow module boundaries
The writing editor SHALL isolate keyboard handling, toolbar and format-drawer behavior, find/replace behavior, link-popover behavior, and context-menu behavior behind focused modules whose dependencies are narrower than the complete editor controller.

#### Scenario: Interaction module is initialized with focused dependencies
- **WHEN** the editor is initialized
- **THEN** each extracted interaction module receives only the DOM nodes, editor capabilities, state accessors, and actions required by that module
- **AND** no extracted module requires the complete `EditorController` object

### Requirement: The editor facade remains compatible
The editor SHALL preserve the existing `EditorController` methods and the existing narrow rich-text adapter capability boundary used by current consumers.

#### Scenario: Existing consumer uses the controller
- **WHEN** `main.ts`, leave protection, document navigation, or AI integration calls an existing editor controller method
- **THEN** the call continues to compile and produces the same observable result as before the module extraction

### Requirement: Existing editor interactions retain their behavior
The editor SHALL preserve current event phases, keyboard focus guards, Escape and outside-click dismissal, formatting actions, find/replace actions, link actions, context-menu actions, document switching, and save-before-switch behavior.

#### Scenario: Keyboard shortcut targets an editor-owned control
- **WHEN** a supported shortcut is pressed while the editor owns focus and the event is not inside a text input or editable control
- **THEN** the same editor action runs and the event handling result remains unchanged

#### Scenario: Keyboard shortcut targets a text input
- **WHEN** a save, undo, redo, find, or formatting shortcut is pressed inside a text input, textarea, contenteditable, or find control
- **THEN** the editor does not steal the control's native behavior

#### Scenario: Overlay is dismissed by an existing dismissal event
- **WHEN** the user presses Escape, clicks outside an active overlay, scrolls, or switches the relevant editor context
- **THEN** the same overlay closes or becomes invalid as it did before extraction

### Requirement: Refactoring does not expand product scope
The module extraction SHALL NOT modify document storage formats, Rust/Tauri commands, AI request semantics, AI panel behavior, selection-entry semantics, or the boundary that AI output remains outside user documents.

#### Scenario: AI integration remains a read-only editor attachment
- **WHEN** the editor attaches or detaches AI integration
- **THEN** the existing attachment and current-editor access behavior remains intact
- **AND** no extracted editor module gains a capability to write user document content on behalf of AI

### Requirement: Interaction coverage protects extracted behavior
The change SHALL retain the existing editor regression suite and add focused tests for any extracted interaction boundary that was previously only covered indirectly.

#### Scenario: Full frontend verification runs after extraction
- **WHEN** the change's verification commands run
- **THEN** editor behavior tests and the complete frontend test suite pass without changing existing behavior expectations

