# project-readme 变更增量

> apply 期扩围（用户确认 2026-09-23）：:171 镜像措辞与 README 现行永久边界句对齐。核对结果：README.md :66 现行句已是「AI 只产出临时材料，永远不直接写入、插入、替换、改写、删除或移动内容树中的任何作品文档」，无需改动 README；本规格镜像句单侧落后，按 README 现行表述对齐。README 其余内容不动（:99/:113 旧双本子迁移说明属合法历史自述，同样不动）。

## MODIFIED Requirements

### Requirement: README 使用使命级统一语言和权威链接
README SHALL 使用“帮助用户重新看见故事”等面向创作者的语言，并 SHALL 将完整使命、第一版方向、协作铁律和已实现事实分别指向正确的权威文档。

#### Scenario: 读者查找完整依据
- **WHEN** 读者希望了解产品完整使命或当前实现事实
- **THEN** README 将完整使命指向 `方向/核心方向宪章.md`
- **AND** README 将第一版取舍指向 `方向/第一版方向共识-2026-07-01.md`
- **AND** README 将协作铁律指向 `AGENTS.md`
- **AND** README 将已实现真相指向 `openspec/specs/`

#### Scenario: README 说明永久 AI 边界
- **WHEN** README 简述 AI 与作品的关系
- **THEN** README 说明 AI 输出是临时材料且永远不直接改动内容树中的任何作品文档
- **AND** README 不复制核心方向宪章中的完整四项权力论证
