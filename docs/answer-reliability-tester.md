# 回答可靠性测试器（answer-reliability-tester）

> change: `add-answer-reliability-tester-core`。脚本目录：`sidecar/reliability/`。
> 目的：用真实 DSH driver 对固定案例做可重复、可留证的离线回答可靠性检验，并做保守自动初筛。
> 它不是协议回归脚本（那是 `sidecar/driver/test-driver.mjs`），不进入实时用户对话。

## 它是什么、不是什么

- **是什么**：离线测试工具。读取版本控制的案例文件，拉起真实 `driver.mjs` 走 JSONL 协议，把每案例的完整回答、事件摘要、耗时、自动判定与理由落成独立证据 JSON。
- **不是什么**：
  - 不做用户可见 UI、不做在线监控平台。
  - 不引入 Python、DeepEval、Inspect AI、Phoenix。
  - 不修改生产 `driver.mjs`、前端、Rust 后端，也不修改任何用户作品。
  - 不把开放性创作判断变成单一正确答案；只核对案例声明的事实边界。

## 运行命令

```powershell
# PowerShell 示例
$env:DEEPSEEK_API_KEY = "<你的 key>"
node sidecar/reliability/runner.mjs --api-base https://z30.top/v1 --model <model>
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `--api-base <url>` | 是 | — | 与 `driver.mjs` 一致的 DSH 端点（需含 `/v1`，见旧探针记录） |
| `--model <model>` | 是 | — | 模型名，后端必须真实可调用 |
| `--cases <path>` | 否 | `sidecar/reliability/fixtures` | 案例文件或目录（`.json` / `.jsonl`） |
| `--out <dir>` | 否 | `sidecar/reliability/evidence` | 证据输出根目录 |
| `--run-id <id>` | 否 | 时间戳生成 | 本次运行标识，决定证据目录名 |
| `--timeout-ms <ms>` | 否 | `180000` | 每轮默认超时 |

环境变量：`DEEPSEEK_API_KEY`（与 `driver.mjs` 相同，由宿主注入，绝不落盘）。

退出码：`0` = 完整跑完（含 `FAIL_LIKELY`/`NEEDS_REVIEW` 这些是「结果」不是运行错误）；`1` = 出现运行性失败（驱动起不来、某案例 `RUNTIME_ERROR`、密钥泄漏、没有合法案例）。

## 案例格式

每个案例是一个 JSON 对象（也支持 JSON 数组或 JSONL，每行一个对象）。必填字段：

```jsonc
{
  "id": "案例标识（唯一）",
  "description": "人类可读说明（可选）",
  "material": {
    "name": "材料名",
    "version": "1",                  // 材料版本
    "hash": "sha256:<64位十六进制>",   // = sha256(material.text)，改动正文必须同步更新
    "text": "离线固定材料正文（不是用户作品）"
  },
  "steps": [ { "text": "前置多轮用户提问（可选，每轮都会得到一次真实回答并记入证据，但不评分）" } ],
  "question": "最终评分问题",
  "expect": {
    "factBoundary": {
      "mustContain": ["答案应明确断言的事实"],   // 命中全部才可能 PASS
      "mustNegate":  ["答案应明确否定的旧事实"]  // 被正向断言即 FAIL
    },
    "wrongConclusions": ["明确错误结论，被断言即 FAIL"],
    "allowedUncertainty": ["未知", "未提及"],   // 非空 = 接受“未知/不确定”为正确回答
    "evidenceLocations": ["原文依据位置"],
    "riskTags": ["version-conflict", "negation"]
  },
  "timeoutMs": 180000                    // 可选
}
```

材料正文经 `replay_history` 作为种子历史注入（`driver.mjs` 的 `system_prompt` 当前未实际传给 agent，故不用它）。校验失败（缺 id / 材料身份 / 问题、哈希与正文不匹配等）的案例**不会**被发送给 driver。

更新材料的正确姿势：改完 `material.text` 后重算哈希。可在任意 Node 环境执行：

```powershell
node -e "const c=require('crypto');const t='<你的正文>';console.log('sha256:'+c.createHash('sha256').update(t,'utf8').digest('hex'))"
```

## 证据格式

每次运行在 `<out>/<run-id>/` 下产生：

```
<out>/<run-id>/
  manifest.json               # 汇总：配置、计数、每案例判定与证据路径
  cases/<caseId>.json         # 每案例一份独立证据
```

每份案例证据字段（`schema_version: 1`）：

- `run_id` / `case_id` / `tester_version`
- `material`：材料身份（name / version / hash，不含正文——正文在案例文件里，证据不重复）
- `configuration`：模型名 + 非敏感 API base 标识（只保留 `协议//主机`，去路径/凭证）
- `timing`：起止时间、总耗时
- `conversation`：前置步骤 + 最终问题
- `protocol`：终态、delta 数、事件摘要、会话/消息 id
- `response`：**完整回答文本** + 每一步的终态/耗时
- `result`：`automatic`（四种自动结果之一）+ `reasons` + `human_review`（独立于自动结果，默认 `null`）
- `runtime_error`：运行/协议失败（与模型回答失败区分）
- `secret_check`：脱敏复核是否通过

## 自动初筛（四种状态）

| 状态 | 触发 |
|------|------|
| `PASS_LIKELY` | 证据足够明确：命中全部预期事实且无错误结论；或未知信息案例明确表达「未知/未提及」 |
| `FAIL_LIKELY` | 空回答；明确断言了错误结论 / 被取代旧事实 |
| `NEEDS_REVIEW` | 否定、引用、未知、事实与推测边界等无法安全判定的自然语言 |
| `RUNTIME_ERROR` | 驱动起不来、超时、提前退出、协议错误、`message_failed`、密钥泄漏 |

**保守立场**：只用关键词做「足够明确」的判定；一旦答案含否定、引用、推断措辞，一律落到 `NEEDS_REVIEW`，绝不把关键词匹配冒充绝对裁判。

否定识别覆盖两类：直接否定词（没有/不是/未/否认…）与「脱离旧状态」的语义否定词（辞去/辞职/离职/离开/放弃/停止/不再/退出/卸任/终止/中断），所以「辞去了盐镇中学的工作」会正确识别为否定「在盐镇中学教书」，而非断言。

**命题规范**：`mustNegate` / `wrongConclusions` 必须写含动作/关系词的完整命题短语（如「住在盐城」「母亲留给她的」「在盐镇中学教书」），禁止写裸实体名（如「盐城」「母亲」「盐镇中学」）。裸实体名会出现在正确回答里（「林蔓住盐城」「外婆留给母亲」），导致误判 `FAIL_LIKELY`。`mustContain` 仍可用裸词（它表示「答案应断言的事实」）。

人工复核结论独立存储（`MODEL_OK` / `MODEL_ERROR` / `SCORER_ERROR` / `UNRESOLVED`），不覆盖自动原始结果——用于区分「模型答错」与「评分器误读引用/否定」。

## 测试与边界

- 本地单元测试（离线、无需 key、不启动 DSH）：`npm run test:reliability`（等价 `node --test sidecar/reliability/tests/*.test.mjs`），覆盖案例校验、评分分类、证据序列化、密钥脱敏。
- 核心固定案例覆盖八类高风险语义：版本冲突、明确否定、未提及信息、否定句引用、事实/推测区分、多轮旧事实冲突、压缩后事实保持（**近似**：长上下文早期事实召回，真实 compaction 触发留待后续 change）、多场景多跳关系。
- 证据与运行目录（`.run-home/`、`evidence/`）已被 `sidecar/reliability/.gitignore` 忽略，不入库。
- 保密责任：测试器只读取明确指定的离线固定材料，结果不进入生产作品存储；证据不含 API key。

## 长上下文幻觉夹具（扩展）

对「材料越长、事实越容易丢、混、编」这一主要风险，另有 `sidecar/reliability/long-context/` 提供确定性生成的合成中文小说（约 1 万 / 3 万 / 5 万字）与分档查询矩阵（12 / 18 / 24 题、七类风险、三试计划），材料与裁判元数据物理分离。详见 `sidecar/reliability/long-context/README.md`。

- 重新生成：`node sidecar/reliability/long-context/generator.mjs`
- 离线校验：`node sidecar/reliability/long-context/validate.mjs`
- 组装可运行案例：`node sidecar/reliability/long-context/build-cases.mjs`（产物在 `.generated/`，可经 `--cases` 喂给本测试器的 runner 分档执行；完整三试矩阵约 162 次调用）
