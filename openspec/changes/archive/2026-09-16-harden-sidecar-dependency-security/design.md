# 设计：sidecar 传递依赖安全整备

## Context

sidecar 是独立的 AI 引擎后台进程（无监听端口、headless），唯一直接依赖是 `@deepseek-ai/dsh@0.1.0-rc.7`。DSH 带入 587 个依赖节点，其中 5 个包有在册安全警报（2026-09-16 实测，共 11 条：fast-uri 4 条 high、js-yaml 1 条 high、sharp 1 条 high、hono 3 条 medium、qs 2 条 medium），全部存在修复版：

| 包 | 修复版 | 钉法（范围） |
|---|---|---|
| fast-uri | 3.1.6 | `^3.1.6` |
| js-yaml | 4.3.2 | `^4.3.2` |
| sharp | 0.35.4 | `^0.35.4`（0.x 语义下即 0.35.x 内 ≥0.35.4，恰好覆盖） |
| hono | 4.13.5 | `^4.13.5` |
| qs | 6.16.0 | `^6.16.0` |

CI（`.github/workflows/ci.yml`）在双平台用 `npm ci` 按 `sidecar/package-lock.json` 安装，因此改动只需落在 `sidecar/package.json` + 重新生成锁文件，CI 无需任何调整。

**用户硬约束**：不得妨碍未来 DSH SDK 的版本升级；升级路径要文档化。

## Goals / Non-Goals

**Goals:**

- sidecar 运行时传递依赖的在册安全警报归零（`npm audit` 于 `sidecar/` 目录内 0 漏洞）。
- 换包后 AI 生成功能经全量离线回归 + 真实链路验证确认无损。
- DSH 升级路径落为正式文档（`sidecar/UPGRADING.md`），明确 overrides 与 DSH 版本正交。
- 立住「无修复版须记录接受风险」的规则，防未来新警报无章可循。

**Non-Goals:**

- 不升级 DSH SDK 本身（`0.1.0-rc.7` 不动）。
- 不处理 `@tiptap/core` 警报（队列 5b）。
- 不给 CI 加 `npm audit` 硬门禁。
- 不改 driver / Rust / 前端代码。

## Decisions

### D1：用 npm overrides，而非 `npm audit fix` 或升级 DSH

`npm audit fix` 只能在依赖方（DSH）声明的 semver 范围内刷新锁文件；DSH 声明范围若不含修复版，它无能为力。overrides 是写在自家 `sidecar/package.json` 里的声明式条款——「不管 DSH 点名要哪个版本，一律用满足修复版的范围」——不改 DSH 任何代码，删行即完全回退。升级 DSH 是另一个 change 的事，二者正交。

### D2：钉范围（`^x.y.z`），绝不钉死单版本

死钉单版本会在未来 DSH 升级时制造人为冲突（DSH 想要更新的分包商、我们条款说不行）。钉范围则：DSH 哪天自带修复版，条款自动满足，届时顺手删掉多余 overrides 即可，零冲突。这是满足用户硬约束的关键决定。

注意 sharp 处于 0.x 版本段：`^0.35.4` 语义是「0.35.x 内且 ≥0.35.4」，与修复版边界恰好一致，不会越界引入 0.36 行为变化。

### D3：升级路径文档放在 `sidecar/UPGRADING.md`

贴着代码放（而非 `方向/` 或 `docs/`），未来执行 DSH 升级的人或 AI 在动手现场最先看到。内容五步：

```
1. 改 sidecar/package.json 中 @deepseek-ai/dsh 的版本号（一行）
2. 删 sidecar/package-lock.json 并重装（npm install）重建依赖树
3. 全量回归：test:driver / test:reliability / test:validation
4. sidecar/ 内跑 npm audit 复查：
   - 新 DSH 自带修复版 → 删除多余 overrides（本 change 钉的五行中已多余者）
   - 新 DSH 仍带旧包   → overrides 继续兜底，警报不回潮
   - 出现新警报        → 有修复版：钉；无修复版：在 UPGRADING.md 记录接受理由
5. 真实链路 smoke 验证后合入
```

另附一段「overrides 与 DSH 版本正交」的说明，把误解（「钉了就换不了 DSH」）在文档里直接驳清。

### D4：验证组合 = 离线三层 + audit 归零 + 真实链路 smoke

离线三层是现有命令（驱动队列、可靠性、离线协议验证），CI 双平台自动跑；audit 归零在 `sidecar/` 目录断言；真实链路用已配置的智谱 `glm-5.3-flash` 跑一轮完整生成。sharp 换版涉及原生二进制，真实链路 smoke 是它最容易暴露问题的地方。

## Risks / Trade-offs

- **[sharp 钉版后原生二进制加载失败]** → 离线回归与真实链路 smoke 当场暴露；回退 = 删除该行 override + 在 UPGRADING.md 记录接受理由（漏洞路径在当前架构无外部触达面，接受有依据）。
- **[未来 DSH 新版本与钉的范围冲突]** → `npm ci` / `npm install` 在重建依赖树时直接报错，升级现场即可发现；UPGRADING.md 写明处置办法。
- **[overrides 长期残留变成「为什么钉这个」的谜团]** → UPGRADING.md 记录每条 override 的来源警报与清理条件；规格要求升级时复查清理。
- **[未来新警报无修复版]** → 规格已立「记录接受风险与理由」规则，有章可循，不装看不见。

## Migration Plan

改动全部落在 `sidecar/package.json`（新增 `overrides` 字段）、`sidecar/package-lock.json`（重新生成）、新增 `sidecar/UPGRADING.md`。无代码迁移。回滚 = git revert 这三个文件的改动，无残留状态。

## Open Questions

（无——5/5 包有修复版已实测确认，无需接受风险台账初始条目。）
