## ADDED Requirements

### Requirement: README 公开说明使命但不把使命冒充当前能力
项目 README SHALL 在开头用普通语言说明 Next Story 希望降低开始创作和获得帮助的前置门槛，让用户不必先系统掌握专业剧作理论就能认真开始自己的故事；README MUST 将这项长期使命与当前已实现能力和未来规划明确区分。

#### Scenario: 新读者查看项目开头
- **WHEN** 读者首次打开 README
- **THEN** README 用短摘要说明工具把复杂创作知识转化为贴合故事的问题和可能性
- **AND** README 说明最终判断、选择和故事完成属于创作者
- **AND** README 不承诺用户自动获得专业创作者能力或必然写出优秀作品

#### Scenario: README 同时描述使命与现状
- **WHEN** README 在使命摘要后列出当前里程碑
- **THEN** README 只把当前正式规格确认的能力标记为已实现
- **AND** README 将知识系统、完整作品认知或其他未来能力明确标记为规划或未实现

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
- **THEN** README 说明 AI 输出是临时材料且永远不直接改动草稿本和正文本
- **AND** README 不复制核心方向宪章中的完整四项权力论证
