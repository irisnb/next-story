## ADDED Requirements

### Requirement: Workspace Artifacts Are Classified Before Cleanup
The project SHALL classify non-product workspace artifacts before changing, tracking, ignoring, restoring, or deleting them.

#### Scenario: Current workspace artifacts are reviewed
- **WHEN** a cleanup change handles `.gitignore`, `.omo/notes/*`, `docs/diagrams/*`, or generated automation outputs
- **THEN** each affected artifact is assigned an explicit classification such as tracked documentation, ignored local note, ignored generated output, restored local material, or user-decision-needed material

#### Scenario: Cleanup stays outside product behavior
- **WHEN** workspace artifact cleanup is implemented
- **THEN** application code, user-facing behavior, AI prompts, AI request payloads, notebook persistence, and project file formats remain unchanged

### Requirement: Local Planning Notes Stay Local Unless Promoted
The project SHALL treat `.omo/notes` material as local planning context unless the user explicitly promotes specific content into tracked project documentation.

#### Scenario: Ignored planning notes are present
- **WHEN** `.omo/notes` contains planning notes used to guide future work
- **THEN** those notes remain ignored local material and are not silently converted into tracked project truth

#### Scenario: A local note is promoted
- **WHEN** the user decides a local planning note should become durable project documentation
- **THEN** the promoted content is moved or copied into a tracked documentation location with an explicit purpose

### Requirement: Architecture Diagrams Have Clear Repository Ownership
Architecture diagrams kept in the repository SHALL have an explicit tracked location and an identifiable source/export relationship when multiple diagram formats exist.

#### Scenario: Diagram source and exports are retained
- **WHEN** a diagram is retained under `docs/diagrams/` in both editable and exported forms
- **THEN** the editable source and exported viewing files are kept together so future updates can identify which file to edit and which files to regenerate

#### Scenario: Diagram files are not retained
- **WHEN** a diagram is judged temporary or not useful as project documentation
- **THEN** it is left local-only or removed only after the user explicitly accepts that outcome

### Requirement: Final Workspace State Is Reported
The project SHALL report the final workspace state after cleanup so later changes start from known Git conditions.

#### Scenario: Cleanup verification runs
- **WHEN** the workspace hygiene change is complete
- **THEN** `git status --porcelain=v1 -uall` is checked and any remaining entries are explained as intentional tracked changes, intentional local-only material, or unresolved user decisions
