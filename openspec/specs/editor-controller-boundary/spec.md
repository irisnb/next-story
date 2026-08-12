## ADDED Requirements

### Requirement: Narrow editor controller dependency without behavior change
The internal editor controller type cleanup MUST preserve existing editor text, selection, coordinate, save, and AI invocation behavior.

#### Scenario: Controller uses the narrowed editor dependency
- **WHEN** the unused `getHeadCoordinates` requirement is removed from the editor controller adapter type
- **THEN** the controller continues to obtain selection coordinates through `coordinatesAt(position)` without any runtime behavior change
