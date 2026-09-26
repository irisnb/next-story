# dsh-sidecar-lifecycle Specification Delta

## ADDED Requirements

### Requirement: 内置 Node 运行时按锁定版本与官方校验和准备

系统 SHALL 以锁定版本准备打包所用的内置 Node 运行时：下载 SHALL 依据官方分发目录的校验和清单做 SHA-256 核验，MUST NOT 使用未经核验的归档；核验通过后 SHALL 断言运行时版本等于锁定版本。打包构建前 SHALL 校验全部打包资源（DSH 入口、常驻驱动与内置 Node 运行时）齐备；缺失时构建 MUST 以中文可读错误中止并给出补救步骤，MUST NOT 产出缺少内置运行时的安装包。发布产物 MUST NOT 依赖用户 PATH 中的 Node。

#### Scenario: 下载后按官方清单核验

- **WHEN** 打包机运行内置 Node 准备脚本
- **THEN** 下载归档后以官方 SHA-256 清单核验其完整性
- **AND** 核验失败或版本断言不符时中止，不安装该运行时

#### Scenario: 打包资源缺件时构建中止

- **WHEN** 打包所需的 DSH 入口、常驻驱动或内置 Node 运行时任一缺失
- **THEN** 构建在编译前以中文可读错误停止并给出补救步骤
- **AND** 不产出缺少运行时的安装包

#### Scenario: 发布产物不依赖 PATH

- **WHEN** 已安装的桌面应用启动常驻 AI 核心
- **THEN** 系统只使用打包的内置 Node 运行时，不依赖用户 PATH 中的 Node
