# editor-controller-boundary Specification

## Purpose
约束编辑器控制器只依赖实际需要的编辑器能力，删除未使用的坐标接口依赖，并在收窄依赖类型后保持文本、选区、坐标、保存和 AI 调用等现有行为不变。

## Requirements

### Requirement: Narrow editor controller dependency without behavior change
The internal editor controller type cleanup MUST preserve existing editor text, selection, coordinate, save, and AI invocation behavior.

#### Scenario: Controller uses the narrowed editor dependency
- **WHEN** the unused `getHeadCoordinates` requirement is removed from the editor controller adapter type
- **THEN** the controller continues to obtain selection coordinates through `coordinatesAt(position)` without any runtime behavior change
