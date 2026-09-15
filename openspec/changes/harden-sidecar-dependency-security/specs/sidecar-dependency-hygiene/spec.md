# Delta：sidecar-dependency-hygiene

## ADDED Requirements

### Requirement: 有修复版的传递依赖漏洞必须钉修复版范围

sidecar 运行时依赖中出现有修复版可用的在册安全警报时，系统 SHALL 通过 `sidecar/package.json` 的 `overrides` 把对应传递依赖钉到**覆盖修复版的语义化范围**，使 `sidecar/` 目录内 `npm audit` 报告零漏洞。钉版 MUST NOT 使用死版本号（必须为 `^` 等范围形式），以保证 DSH SDK 未来升级自带新版分包商时自动满足、可平滑移除。

#### Scenario: 钉版后审计归零

- **WHEN** 在 `sidecar/` 目录执行 `npm audit`
- **THEN** 报告 0 条漏洞（无 high / medium / low / critical）

#### Scenario: 钉版使用范围而非死版本

- **WHEN** 检查 `sidecar/package.json` 的 `overrides` 字段
- **THEN** 每一条钉版值都是语义化范围（如 `^4.3.2`），不存在裸版本号

### Requirement: 无修复版的警报必须记录已接受风险

sidecar 传递依赖出现**无修复版可钉**的在册安全警报时，SHALL 在 `sidecar/UPGRADING.md` 的风险记录区登记：包名、警报编号、接受理由（含实际暴露面评估）与复评条件。MUST NOT 留在册警报无记录、无解释。

#### Scenario: 无修复版时登记接受理由

- **WHEN** 某传递依赖警报在 npm 生态中暂无修复版发布
- **THEN** `sidecar/UPGRADING.md` 记录该包名、警报编号、接受理由与复评条件（如「修复版发布后复评」）

### Requirement: DSH SDK 升级须遵循文档化路径

DSH SDK（`@deepseek-ai/dsh`）版本升级 SHALL 遵循 `sidecar/UPGRADING.md` 记载的流程：改版本号 → 重建锁文件 → 全量离线回归（驱动队列、可靠性、离线协议验证）→ `npm audit` 复查 → 清理或保留 overrides → 真实链路验证。升级完成后 sidecar 审计 MUST NOT 回潮到未处理状态。overrides 与 DSH 本身版本 MUST 保持正交：overrides 只约束传递依赖，不限制 DSH 的版本选择。

#### Scenario: 按文档路径完成升级

- **WHEN** 维护者按 `sidecar/UPGRADING.md` 流程升级 DSH SDK 版本
- **THEN** 全量离线回归与真实链路验证通过，且 `sidecar/` 内 `npm audit` 保持零漏洞

#### Scenario: 新 DSH 自带修复版时清理冗余钉版

- **WHEN** 升级后的 DSH 声明的依赖范围已自然满足修复版要求
- **THEN** 多余的 overrides 条目被移除，`npm audit` 仍为零漏洞

#### Scenario: 新 DSH 仍带旧包时钉版继续兜底

- **WHEN** 升级后的 DSH 仍引入含警报的旧版本传递依赖
- **THEN** 既有 overrides 继续生效，`npm audit` 不回潮

### Requirement: 换包必须经回归与真实链路验证

对 sidecar 传递依赖的任何更换（钉版、清理 overrides）MUST 在合入前通过全量离线回归（`test:driver`、`test:reliability`、`test:validation`）与真实链路生成验证。

#### Scenario: 换包后全量验证通过

- **WHEN** overrides 或锁文件发生变更
- **THEN** 驱动队列、可靠性、离线协议验证全部通过，且真实链路（智谱 `glm-5.3-flash`）完成一轮完整生成 smoke
