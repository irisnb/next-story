# 长上下文幻觉夹具（long-context-hallucination-fixtures）

> change: `add-long-context-hallucination-fixtures`。目录：`sidecar/reliability/long-context/`。
> 目的：用**确定性生成的合成中文小说**（约 1 万 / 3 万 / 5 万字）和**分档查询矩阵**，把「材料越长、事实越容易丢、混、编」这个主要风险变得可观察。另含一份**手写的连贯叙事对照档**（约 1 万字），用于和模板档对照，标注「真实度接近」而非「合成噪声」证据。它是 `answer-reliability-tester` 的延伸，不改生产驱动、不改评分语义、不碰用户作品。

## 它是什么、不是什么

- **是什么**：离线夹具与校验工具。用固定种子生成三份合成小说，把可审计的事实埋进已知章节，并用**独立于正文的裁判元数据**记录预期事实、错误结论与风险类别；提供 12 / 18 / 24 道查询、三试计划与离线校验。
- **不是什么**：
  - 不用真实用户作品，不声称合成结果证明模型普遍可靠（结果只能标注为「合成证据」）。
  - 不修改生产 `driver.mjs`、不修改 `screening.mjs` 评分语义、不改前端 / Rust 后端。
  - 本次不要求一次性跑完 162 次真实调用；执行是分档、可停、可续的。

## 目录结构

```
long-context/
  manifest.json           档位清单：种子、目标字数、容差、风险类别、查询数、trial_count
  story-specs.mjs         单一真相源：每档人物/地点/锚点语句/查询（含完整事实边界）
  generator.mjs           确定性生成器（纯函数 + CLI）
  validate.mjs            离线校验（确定性、字数、哈希、裁判分离、矩阵覆盖、三试计划）
  build-cases.mjs         把材料 + 裁判组装成现有 runner 可运行的案例文件
  materials/tier-*.json   检入的合成小说正文（含身份/种子/字数/估算 token/哈希）
  materials/coherent-10k.txt  手写连贯叙事正文源（纯文本，不经种子生成）
  oracle/tier-*.json      检入的裁判元数据（实体、锚点、查询、三试计划）
  .generated/             由 build-cases.mjs 生成，不入库（见 .gitignore）
```

材料（`materials/`）与裁判（`oracle/`）**物理分离**：正文是模型会收到的内容；裁判（预期事实、错误结论、风险类别、查询问题）绝不进入正文，也不注入 driver。

## 三个模板档 + 一个手写对照档

| 档位 | 书名 | 目标字数 | 实际字数 | 估算 token | 查询数 |
|------|------|---------|---------|-----------|-------|
| 10k  | 雾城长河 | 10000 | 10086 | ≈7565 | 12 |
| 30k  | 回声旅馆 | 30000 | 30082 | ≈22562 | 18 |
| 50k  | 北境邮差 | 50000 | 50683 | ≈38012 | 24 |
| coherent-10k | 青石巷 | 10000 | 9570 | ≈7178 | 12 |

（实际字数与估算 token 以 `materials/tier-*.json` 与 `oracle/` 为准；估算 token = 字数 × 0.75，**仅估算**，供应商真实 token 数可能不同，属执行层面关注点，不由本夹具断言。）

**模板档 vs 手写对照档**：前三个档（10k/30k/50k）由「锚点逐字 + 种子伪随机填充」生成，是**对抗性上限探针**——噪声会抬高实体混淆，逐字唯一锚点又可能让召回显得过于容易，偏差方向未知。`coherent-10k` 是**手写连贯叙事**（场景连续、人物稳定、因果流动，事实以自然语句而非逐字标记表达），作为**真实度接近的对照**。两者查询矩阵规模一致（各 12 题、七类风险、trial_count=3），可直接对比；报告时两者分开呈现，不混为一谈。

手写档在 `manifest` 里标 `handwritten: true`、`seed: null`，正文来自 `materials/coherent-10k.txt`，由 `generator.mjs` 读入后与种子生成档同样产出 `materials/coherent-10k.json` 与 `oracle/coherent-10k.json`；校验仍跑全部检查（哈希、字数容差、锚点命中、矩阵覆盖、三试计划、裁判分离），只是不通过种子重生成。

七类风险（每档至少各一题，`manifest.risk_categories`）：

| 类别 | 含义 |
|------|------|
| `distant-recall` | 远距召回：早期事实被大量无关内容埋深 |
| `cross-chapter-relation` | 跨章关系：答案需拼接两个以上章节的事实 |
| `similar-entity` | 相似实体：名字相近的人物/地点需区分 |
| `version-conflict` | 版本冲突：早期事实后来被更正，需依据最新 |
| `unknown-fact` | 未知事实：材料未提供，应表达「未知/未提及」 |
| `false-premise` | 错误前提纠正：问题自带错误前提，应纠正 |
| `multi-turn-recall` | 多轮召回：经前置追问后召回材料事实 |

## 运行命令（全部离线，无需 API key）

```powershell
# 1) 重新生成材料与裁判（确定性，覆盖 materials/ 与 oracle/）
node sidecar/reliability/long-context/generator.mjs

# 2) 只校验不写盘（重新生成并比对已检入文件）
node sidecar/reliability/long-context/generator.mjs --check

# 3) 离线校验（确定性哈希、字数容差、裁判分离、查询数、风险覆盖、三试计划）
node sidecar/reliability/long-context/validate.mjs

# 4) 组装成现有 runner 可运行的案例（写入 .generated/）
node sidecar/reliability/long-context/build-cases.mjs

# 5) 离线单元测试（随 npm run test:reliability 一起跑，也单独可跑）
node --test sidecar/reliability/tests/long-context.test.mjs
```

## 分档执行（真实调用，需 API key）

`build-cases.mjs` 产出 `.generated/tier-<档>.jsonl`，每行一个现有 schema 案例，可被现有 runner 直接运行。**逐档执行**可隔离上下文/协议故障并控制成本：

```powershell
$env:DEEPSEEK_API_KEY = "<你的 key>"

# 只跑 10k 档（12 个案例，一次 pass）
node sidecar/reliability/runner.mjs --cases sidecar/reliability/long-context/.generated/tier-10k.jsonl --api-base <url> --model <model> --run-id lc-10k-pass1

# 再跑 30k、50k
node sidecar/reliability/runner.mjs --cases sidecar/reliability/long-context/.generated/tier-30k.jsonl --api-base <url> --model <model> --run-id lc-30k-pass1
node sidecar/reliability/runner.mjs --cases sidecar/reliability/long-context/.generated/tier-50k.jsonl --api-base <url> --model <model> --run-id lc-50k-pass1
```

**调用量**：一次 pass = 54 次（12 + 18 + 24）。三试计划（`trial_count=3`，即 `manifest` 与 `oracle` 里的 `trial_ids`）意味着完整矩阵 = 54 × 3 = **162 次**。当前 runner 每案例只跑一次；三试的重复执行与聚合是**后续 runner 变更**，本夹具只提供稳定 id 与计划元数据，不改变现有 runner 语义。

**建议顺序**：先 10k（隔离基础故障）→ 30k → 50k（逼近供应商上下文/协议上限，失败要作为证据显式记录，而非隐藏）。

## 证据位置与结果解读

证据落在 `<out>/<run-id>/manifest.json` 与 `<out>/<run-id>/cases/<caseId>.json`（默认 `out = sidecar/reliability/evidence`，已 gitignore，不入库；与 `answer-reliability-tester` 一致，API key 绝不落盘）。

四态结果要区分三类不同含义：

- **模型回答结果**：`PASS_LIKELY` / `FAIL_LIKELY` / `NEEDS_REVIEW`。`NEEDS_REVIEW` 表示关键词裁判无法安全判定（否定、引用、不确定、事实/推测边界），**不表示模型答错**——正确引用式回答也可能落到这里（设计已明示，评分器改进留待后续 change）。
- **评分器不确定**：`NEEDS_REVIEW` 的原因字段记录了「哪个条件无法判定」，人工复核用 `MODEL_OK / MODEL_ERROR / SCORER_ERROR / UNRESOLVED` 区分「模型答错」与「评分器误读」。
- **运行/协议失败**：`RUNTIME_ERROR` 及 `runtime_error` 字段记录驱动起不来、超时、提前退出、协议错误、密钥泄漏等，与模型回答失败严格区分。

## 边界与红线

- 材料与裁判分离：裁判（答案键）绝不进入正文；`validate.mjs` 已断言正文不含 `sk-` 密钥、裁判标签、查询问题。
- 合成性：正文是模板 + 种子伪随机生成的合成散文，只用于受控召回与矛盾风险测量，不代表真实写作风格；结果只标注为「合成证据」。
- 字数 ≠ token：中文按码点计字，token 为估算，供应商上下文限制属执行层面问题。
- 不改变生产驱动契约与评分语义：本夹具只新增夹具、生成器、校验、文档与离线测试。
