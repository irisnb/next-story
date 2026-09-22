# frontend-bundle-structure Delta

## ADDED Requirements

### Requirement: 前端生产构建按依赖域分包

前端生产构建 SHALL 按依赖域将 JavaScript 拆分为多个静态包：编辑器栈依赖（@tiptap 系、prosemirror 系、linkifyjs）独立成包，Tauri API 依赖（@tauri-apps 系）独立成包，应用代码与其余零散依赖归入默认包。分包 MUST 保持静态导入形态，不因分片改变应用加载行为。

#### Scenario: 构建产出按域划分的包

- **WHEN** 执行前端生产构建
- **THEN** 编辑器栈依赖与 Tauri API 依赖各自位于独立的 JS 包
- **AND** 应用代码位于默认包

#### Scenario: 新增编辑器依赖归入编辑器域包

- **WHEN** 前端引入新的编辑器栈依赖并执行生产构建
- **THEN** 该依赖进入编辑器域包，不落入应用默认包

### Requirement: 单包体积受警戒线约束

前端生产构建的每个 JS 包 SHALL 保持在 500 kB 警戒线（vite 默认 chunk 体积警告线）之下。包体超线时 MUST 通过调整分包边界解决，MUST NOT 通过调高 `chunkSizeWarningLimit` 或等价配置令警告静默。

#### Scenario: 生产构建零体积警告

- **WHEN** 执行前端生产构建
- **THEN** 构建完成且不出现任何单包超过 500 kB 的体积警告

#### Scenario: 超线时调整边界而非阈值

- **WHEN** 依赖或应用代码增长使某一 JS 包超过警戒线
- **THEN** 通过重新划分包边界使各包回到线内
- **AND** 构建配置中的体积警告阈值保持默认值，未被调高或禁用
