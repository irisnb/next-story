## ADDED Requirements

### Requirement: 跨平台编译覆盖

main 分支的双平台 CI SHALL 覆盖非 Windows 目标代码的编译完整性：`cargo clippy --all-targets -- -D warnings` 在 Linux 任务中 MUST 通过，使 `#[cfg(not(windows))]` 等平台特有分支的编译错误不会因"本地 Windows 不编译该分支"而长期潜伏。

#### Scenario: Linux 任务编译非 Windows 分支

- **WHEN** CI 在 Linux 运行 `npm run check`
- **THEN** Rust 编译与 clippy 全目标通过，不因非 Windows 平台分支的编译错误失败

#### Scenario: 平台分支编译错误按平台暴露

- **WHEN** 任一平台专属分支存在编译错误
- **THEN** 对应平台的 CI 任务失败，错误在合并前可见（不得只存在于无人编译的分支）

### Requirement: 夹具字节稳定性（LF 规范）

被内容哈希校验的文本夹具 SHALL 以 LF 规范检出并在读取入口归一，使同一内容的哈希在 Windows 与 Linux 上一致；`npm run test:reliability` 的磁盘夹具校验 MUST 在两平台均通过。

#### Scenario: Windows 检出后磁盘夹具校验通过

- **WHEN** Windows 检出发生换行转换（autocrlf）后运行 `npm run test:reliability`
- **THEN** 手写档材料哈希与存档一致，磁盘夹具校验全部通过

#### Scenario: CRLF 输入经归一后哈希不漂移

- **WHEN** 以 CRLF 变体读取手写档文本
- **THEN** 归一后的材料哈希与 LF 基准存档一致（由回归用例钉住）
