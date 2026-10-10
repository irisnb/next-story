## REMOVED Requirements

### Requirement: 新粗野主义视觉方向
**Reason**: 已认可v5替换旧重结构线和硬阴影。
**Migration**: 使用新增v5中性视觉合同与集中令牌。

### Requirement: 主色承担选中与动作态
**Reason**: 旧规则禁止黑色选中，与v5黑色主操作/激活态冲突。
**Migration**: 近黑主操作与激活态，辅以文字/形状/aria状态。

### Requirement: 文本编辑区为视觉焦点
**Reason**: 旧最重边框与阴影方式退场。
**Migration**: 通过稿纸、留白和阅读节奏突出正文。

### Requirement: 成体系的配色令牌
**Reason**: 旧强制主辅色角色与v5中性色体系冲突。
**Migration**: 使用统一中性、主操作及语义色令牌。

## ADDED Requirements

### Requirement: v5中性视觉与状态体系
系统 SHALL 使用中性白/浅灰面、近黑文字/主操作/激活态、细线与轻圆角，正文靠阅读空间突出；浮层允许轻柔阴影，MUST NOT 保留旧重框硬偏移阴影。颜色、边框、阴影、圆角及尺寸 SHALL 引用集中令牌，危险/错误/成功状态 SHALL 使用一致语义色与可读文案，选中和焦点 MUST NOT 仅靠颜色。

#### Scenario: 显示写作界面
- **WHEN** 写作页与AI面板显示
- **THEN** 使用v5细线灰白面与黑色激活态，正文无旧最重框要求，所有组件引用统一令牌

#### Scenario: 错误和选中可辨
- **WHEN** 操作失败或控件选中
- **THEN** 系统以文案/形状及可访问状态表达，错误与禁用不混淆
