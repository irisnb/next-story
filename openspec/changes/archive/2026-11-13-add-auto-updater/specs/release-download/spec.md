# release-download 规格（增量）

## ADDED Requirements

### Requirement: 更新发布物与清单
每个正式 Release SHALL 附带更新发布物：安装包签名文件（`*-setup.exe.sig`）与更新清单 `latest.json`。清单 SHALL 使用 `platforms."windows-x86_64"` 键；`signature` SHALL 为 `.sig` 文件内容原文；`url` SHALL 指向本 Release 的版本化 NSIS 安装包直链（属机器消费，不受「对外下载入口固定链接」规则约束）；`version` SHALL 与所打标签及应用构建版本一致，且 MUST 严格大于上一正式 Release 的版本。全套发布物（安装包、签名文件、清单、既有稳定名副本）SHALL 以 draft Release 先行上传、逐项核验（附件齐备、清单版本与标签一致、签名与安装包对应、清单可下载可解析）后再转为正式发布；正式发布前，上一正式 Release SHALL 保持 `latest`，部分上传失败 MUST NOT 污染更新渠道。draft 与 prerelease MUST NOT 作为更新来源。发布阶段失败 SHALL 保留 draft 供恢复重试；已正式发布的版本 MUST NOT 经重试替换为不同内容的产物。

#### Scenario: draft 核验后正式发布
- **WHEN** 发版脚本完成全套发布物上传并逐项核验通过
- **THEN** draft 转为正式 Release，`releases/latest/download/latest.json` 随即指向新版本清单

#### Scenario: 部分上传失败不污染渠道
- **WHEN** 发布阶段上传或核验中途失败
- **THEN** 上一正式 Release 仍为 `latest`，已安装应用不受影响，draft 保留供修复后重试

#### Scenario: latest.json 自洽
- **WHEN** 应用请求 `releases/latest/download/latest.json`
- **THEN** 返回最新正式 Release 的清单，其版本号、下载直链与签名一一对应可用

#### Scenario: 版本未升时发布被拒
- **WHEN** 准备阶段检测新版本号不严格大于上一正式 Release
- **THEN** 发布以中文可读错误中止，不上传任何发布物

#### Scenario: draft 不进更新渠道
- **WHEN** 仓库存在 draft 或 prerelease 且版本号更高
- **THEN** `releases/latest` 仍指向上一正式 Release，已安装应用不提示该版本

### Requirement: 发版两阶段一条命令与版本号单一真相源
发版 SHALL 由脚本以准备／发布两阶段一条命令完成。准备阶段 SHALL：前置断言（工作区干净、当前分支为 main、gh 已安装且已登录且对目标仓库具备发布权限）；识别上一正式 Release，并将「不存在上一版＝首次发布」与网络／认证／API 失败区分（后者以中文可读错误中止并说明修复方法，MUST NOT 把失败当作没有上一版）；执行总门禁；执行版本严格递增检查；同步并校验版本号；执行完整打包准备检查；打印应提交的文件清单由维护者提交至 main 并打标签（发布物与源码一致性由「发布一致性」要求约束）。发布阶段 SHALL：校验工作区干净、当前提交与标签与准备阶段绑定一致；交互收集中文更新说明（建议一至五条、每条说明用户可感知的变化，附示例与预览确认），同文写入 `latest.json` 与 Release 正文，Release 正文自动附既有安装指引；私钥与密码仅经环境变量与标准输入传递，MUST NOT 写入仓库或任何落盘文件；签名打包、生成 `latest.json`、按更新发布物要求完成 draft 上传与核验发布。应用版本号 SHALL 以 `tauri.conf.json` 的 `version` 为唯一手改来源（版本号单一真相源）；脚本 SHALL 在准备阶段同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 与 `src-tauri/Cargo.lock` 并校验四处一致。任一阶段失败 SHALL 打印失败阶段、已完成步骤与安全重试指引。

#### Scenario: 准备阶段一条命令
- **WHEN** 维护者在 main 分支运行准备阶段命令
- **THEN** 脚本完成前置断言、上一版识别、门禁、版本检查与同步、打包准备检查，并打印应提交的文件清单

#### Scenario: 首次发布成立
- **WHEN** 仓库可访问但不存在任何正式 Release
- **THEN** 按首次发布分支处理，版本递增检查跳过上一版比对，流程继续

#### Scenario: gh 未登录中文报错
- **WHEN** gh 未安装或未登录或无发布权限
- **THEN** 准备阶段以中文可读错误中止并说明修复方法，不进入构建

#### Scenario: 发布阶段失败可恢复
- **WHEN** 构建或上传或核验失败
- **THEN** 打印失败阶段、已完成步骤与安全重试指引；重试不要求维护者盲目撤销文件、删除标签或覆盖已发布版本

#### Scenario: 更新说明同文两处
- **WHEN** 发布阶段完成
- **THEN** `latest.json` 的 `notes` 与 Release 正文使用同一份维护者确认过的中文更新说明，Release 正文含既有 SmartScreen 指引

#### Scenario: 版本号分岔被同步
- **WHEN** 准备阶段执行版本同步步骤
- **THEN** `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 四处版本号与 `tauri.conf.json` 一致

#### Scenario: 门禁失败即止
- **WHEN** 总门禁任一科目失败
- **THEN** 发版中止，不产出 Release

#### Scenario: 私钥不落盘
- **WHEN** 发版脚本完成一次发版
- **THEN** 私钥与私钥密码不存在于仓库、构建产物或任何脚本写入的文件中
