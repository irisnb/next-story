## ADDED Requirements

### Requirement: Shared browser storage adapter
前端 SHALL 通过一个共享的最小存储接口访问可选的浏览器持久化存储，该接口 MUST 支持读取、写入和删除键值；当浏览器存储不存在或访问被拒绝时，解析函数 MUST 返回 `null` 而不是抛出异常。

#### Scenario: Browser storage is available
- **WHEN** 应用运行在可访问 `localStorage` 的浏览器环境
- **THEN** 共享解析函数返回支持 `getItem`、`setItem` 和 `removeItem` 的存储适配器

#### Scenario: Browser storage is unavailable
- **WHEN** 应用运行在没有 `window` 或访问 `localStorage` 会抛出异常的环境
- **THEN** 共享解析函数返回 `null`
- **AND** 调用方继续使用各自既有的内存/默认值回退行为

### Requirement: Shared selection snapshot identity
前端 SHALL 使用一个共享函数判断两个选区快照是否代表同一份可提交上下文；判断 MUST 比较 `documentId`、`from`、`to` 和 `selectedText` 四个字段，任何一个字段不同都 MUST 判定为不同快照。

#### Scenario: Identical snapshots
- **WHEN** 两个快照的四个身份字段完全相同
- **THEN** 共享函数返回相同

#### Scenario: Different snapshot identity
- **WHEN** 两个快照的文档、范围或选区文字任一身份字段不同
- **THEN** 共享函数返回不同
