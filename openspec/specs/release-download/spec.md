# release-download Specification

## Purpose

GitHub Release 安装包发布物要求、稳定名副本机制与对外下载链接规则。

## Requirements

### Requirement: Release 发布物与稳定名副本
每个版本 Release SHALL 上传 Windows 安装包：NSIS `setup.exe`（主推）与 MSI（备选），并同时附稳定名副本 `NextStory-setup.exe` 与 `NextStory-setup.msi`（不含空格与版本号）；默认产物名附件（含版本号）可一并上传供溯源。

#### Scenario: 稳定名直链可用
- **WHEN** 访问 `releases/latest/download/NextStory-setup.exe`
- **THEN** 下载到最新版 NSIS 安装包，且发布新版本后该链接仍有效

#### Scenario: MSI 备选存在
- **WHEN** 查看最新 Release 附件
- **THEN** 存在 MSI 安装包及其稳定名副本

### Requirement: 下载链接规则
对外下载入口（官网、README）SHALL 统一使用 `releases/latest` 或 `releases/latest/download/<稳定名>` 固定链接；MUST NOT 使用含版本号的直链。

#### Scenario: 新版发布后入口不变
- **WHEN** 发布新版本 Release
- **THEN** 官网与 README 的下载入口无需修改即指向新版

### Requirement: 无 Release 过渡形态
没有任何可用 Release 时，对外下载入口 SHALL 指向 `/releases` 页面并注明「即将发布」，MUST NOT 放置会 404 的直链。

#### Scenario: 过渡期不 404
- **WHEN** 首个 Release 尚未发布时访问下载入口
- **THEN** 跳转 releases 列表页，不出现 404

### Requirement: 未签名 SmartScreen 说明
因安装包未购买代码签名，官网下载区与 Release 说明 SHALL 注明 Windows 首次运行的 SmartScreen 提示属预期，并给出处理方式（点「仍要运行」）。

#### Scenario: SmartScreen 说明存在
- **WHEN** 查看官网下载区与 Release 说明
- **THEN** 均包含 SmartScreen 预期提示与处理说明

### Requirement: 发布一致性
Release 安装包 MUST 由与所打标签对应的 main 代码完整打包产出（含 sidecar 安装与 vendor-node 步骤），MUST NOT 使用与 main 不一致的陈旧产物。

#### Scenario: 发布前重打包
- **WHEN** 创建 Release
- **THEN** 安装包来自对应提交的完整打包流程产物
