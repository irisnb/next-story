# 切换边界验证记录

## 状态与证据归属

2026-09-24 登记。用户在提案形成后批准实施，并要求继续；不补写未记录的批准日期或原话。本记录整理本轮已经返回的执行证据，不表示此时重新执行了所有命令。

全量命令由验证代理执行并返回结果，主控核收；主控另外独立执行了下列 36 条定向测试与 OpenSpec 严格校验。Oracle 对树共同接受、宿主身份接线及文档记忆异常降级进行了第二次只读复核，未发现新的具体阻断；静态复核不是运行测试，更不是真机验收。

**当前状态（2026-09-24 晚间更新）：取消后焦点/选区/历史恢复与输入法合成场景已在新构建上重验通过（见文末新章节）；仍不是整批验收完成——`npm run check` 的审计目录 12 项 lint 错误不变、原生目录选择链路与真实模型网络测试未验、任务逐项证据映射尚未全部核收。不提交、不推送、不归档。**

## 已执行命令

| 命令 | 实际结果 | 限制或说明 |
| --- | --- | --- |
| `npm run check` | 退出 1 | 类型检查通过；lint 在 `tmp/project-audit/` 报 12 errors、0 warnings，后续串联步骤未执行 |
| `npm run test:frontend` | 1017 通过，0 失败/跳过 | 有 TextSelection 提示及故障注入日志；不代表原生 UI 验收 |
| `npm run test:reliability` | 120 通过，0 失败/跳过 | 独立补跑 |
| `npm run test:driver` | 13 通过，0 失败/跳过 | 独立补跑 |
| `npm run test:validation` | 78 通过，0 失败/跳过 | 确定性替身验证；原 `check` 不包含此项 |
| `npm run build` | 退出 0；120 模块构建成功 | 不是安装包真机验证 |
| `npm run test:rust` | 360 通过，4 ignored | 4 项真实模型/DSH 网络测试未执行 |
| `npx eslint src` | 退出 0 | 生产源码规范检查通过，不等于仓库全量 lint 通过 |
| `git diff --check` | 退出 0 | 有 LF→CRLF 提示，无差异空白错误 |
| `node --test --test-timeout=5000 tests/workspace-project-flow.test.ts tests/document-memory.test.ts` | 主控独立执行：36 通过，0 失败/跳过 | 装配 23 条、记忆存储 13 条 |
| `openspec validate fix-workspace-transition-boundary --strict` | 主控及验证代理均执行，退出 0 | 规格格式有效，不等于所有任务已完成 |

临时审计目录的 12 项 lint 错误分布：`editor-race.test.ts` 6 项未使用变量；`file-race.mjs` 2 项未定义变量；`lifecycle.mjs` 2 项；`structure.mjs`、`visibility.mjs` 各 1 项。保持这些原有审计脚本不变，未将其缺陷复现断言当作修复证据，未修改 lint 配置掩盖失败。

前端完整日志的本机工具捕获位置：`C:\Users\Administrator\.local\share\opencode\tool-output\tool_0cf65b276001kv2azT7OunTsiu`。此路径可能随本机清理失效，不是仓库内永久测试产物。

## 重点证据与覆盖边界

- **F01**：正式回归位于 `tests/editor.test.ts`、`tests/editor-document-session.test.ts`、`tests/editor-transition-safety.test.ts` 及已有保存相关测试。真实 Tiptap 内核的合成组合输入和修改许可测试，不等于 Windows 微软拼音真实候选窗口行为。
- **F02 / 树共同接受**：`tests/file-management.test.ts` 与装配测试覆盖迟到结果、装载身份、刷新顺序、树回落成功/读取失败/解析失败/取消、旧收尾不释放新保护，以及暂停期间候选恢复或丢弃。界面保留旧树不等于撤销磁盘上已经完成的删除。
- **F08 装配**：实际载体为独立的 `tests/workspace-project-flow.test.ts`，并非由 `project-flow-race.test.ts` 调用。它组合实际 `setupEditor`、`setupFileManagement`、`setupWorkspaceProjectFlow`，树通知与 `main.ts` 共用 `createWorkspaceTreeReceiver`；外部服务与编辑器 adapter 使用替身，不是完整 Tauri/WebView2 端到端测试。
- **重点装配断言**：目标正文待返回时仍忙且两侧保留旧作品；失败不上报成功；新建后装载失败不重复创建；同路径重开等待保存和已发结构写入；欢迎页取消/卸载与销毁后迟到结果；最近作品 DOM 点击成功及失败；成功副作用次数。
- **记忆存储降级**：`tests/document-memory.test.ts` 覆盖 getItem/setItem/removeItem 异常；装配用例覆盖记忆写入配额失败仍正常打开，以及候选编辑器构建失败保留旧实例、未保存内容与身份。

以上是证据地图，不自动满足每个复合任务的全部验收条件。特别是任务 4.8 原列出的三个测试文件没有按原任务描述更新；新增装配测试承担了部分替代验证，仍需逐项核对等价覆盖，不能只凭全套绿灯勾选。

## 待核收与未执行

1. `tasks.md` 中尚未勾选的实施项需要完成逐项源码/断言映射；未勾选不自动表示代码不存在，也不表示已经符合全部验收要求。
2. 5.3：已完成有限 Windows Tauri/WebView2 桌面 UI 场景（见下节）；原生微软拼音 IME 与完整交互矩阵未完成。
3. 5.4：暂停提示、目标与当前名称、禁用原因、离开三选项可用性、失败恢复焦点/选区/历史及不抢 AI 输入焦点，完整人工核收未执行。
4. 未执行真实模型网络测试、安装包验收或临时缺陷复现脚本。
5. 6.1–6.4：未提交、未登记报告入库、未归档，未将审计报告中的本批状态写成完成。

## 真机验收模板（以下完整矩阵尚未完成）

仅使用专门创建的合成测试作品，不操作用户实际稿件。验收前记录 Windows 版本、WebView2 版本、微软拼音版本/兼容模式、应用版本及测试构建标识。

| 操作 | 预期 | 实测 / 录屏或截图位置 |
| --- | --- | --- |
| 中文选字中分别切文档、切作品、返回欢迎页；分别确认、取消候选及退格 | 组合输入自然结束，最终正文更新后才暂停；不保存未确认拼音、不提前销毁旧实例 | 待验 |
| 保存/读取等待期间尝试正文输入、格式、撤销重做、替换、粘贴剪切、拖放及额外导航 | 暂停入口被拒绝，命令不排队；目标提示明确，额外导航不覆盖当前操作 | 待验；需可控延迟的合成测试环境 |
| 取消离开或模拟保存/读取失败后继续编辑、撤销重做 | 旧实例内容及应有保存事实保留；焦点、选区、历史与控件正确恢复 | 待验；需故障注入，不破坏真实作品制造故障 |
| 暂停期间操作离开确认三选项及 AI 输入框 | 离开确认仍可操作；不全局锁住 AI、不抢 AI 输入焦点 | 待验 |

每个分支分别记录实际步骤、预期、实测、是否符合及证据位置；不得以一张静态截图替代输入过程证据。环境未具备的延迟/故障场景保持待验，不用自动合成事件代签。

## 2026-09-24 真实 Windows release 有限桌面 UI 验证

### 构建、运行身份与授权范围

- 据本会话既有执行记录，桌面构建命令 `npm run tauri -- build --no-bundle` 退出 0；本次文档收尾未重跑构建。产物 `D:\Next Story\src-tauri\target\release\next-story.exe`，最后修改时间 `2026-09-24T13:00:24+08:00`，SHA256：`10A9BF3FC8844177B5B2CCC74F0B4203DBE9D36FF21BE3D745B353B064156012`。已与用户提供的快捷方式目标核对，无需修改快捷方式；这不是安装包验收。
- 测试实例 PID `7508`，WebView2 `153.0.4234.48`；CDP 仅监听 `127.0.0.1:9222`，监听 PID `15852`、父进程 `7508`。页面 target `3FF3ED7E9DC250688FBE200B36A586E6`，标题 Next Story，origin `http://tauri.localhost`。身份在相关测试开始时重新核对，版本沿用同一实例此前核对值。
- 只测试两份经用户人工确认授权的合成作品：A=`切换验收-合成-A-132223-9aab42`，B=`切换验收-合成-B-20260924`；完整路径分别为 `C:\Users\Administrator\Desktop\test\切换验收-合成-A-132223-9aab42` 和 `C:\Users\Administrator\Desktop\test\切换验收-合成-B-20260924`。未读取真实作品正文、凭据或模型配置，未发起 AI 请求；最近项只输出授权名称与路径的精确匹配，不截图其他作品最近列表。
- 人工贡献：用户人工完成 A 的创建/打开接续、乙重命名及 B 新建；执行者核对后续结果，不声称自动完成这些步骤，也不假定此前 interrupted 的准备 B 调用成功。正文输入使用真实鼠标及 CDP `Input.insertText`，不是原生 IME；DOM 查询只读，无应用状态注入或直接 IPC。

### 有限场景与结果归属

下表 PASS 来自执行时会话工具返回及执行者分轮报告，不表示所有断言已完整落入 `.log` 文件；证据缺口见下一小节。主控负责最终核收。

| 场景 | 有限结果 | 具体覆盖及报告 |
| --- | --- | --- |
| 编辑与保存、两文档往返 | PASS | A 空白甲输入保存，创建乙并输入保存，甲乙往返时名称、正文及树对应；`result.md` |
| 取消离开后继续编辑 | PASS | A 的乙取消离开后全文及未保存状态保留，并再次实际输入；不等于完整焦点/选区/撤销历史验证；`result.md` |
| 先保存再返回、不保存离开重开 | PASS | 前者重开保存基线一致；后者丢弃独特尾标后重开，尾标不存在、保存基线一致；`result.md` |
| 真正保存并离开 | PASS | 未先点保存，直接点击 `btn-save-and-leave`，重开后尾标及全文一致、已保存；`result-followup.md` |
| 人工重命名后的结果与往返 | PASS（人工接续） | 自动重命名阶段曾看门狗超时，prompt 处理返回 No dialog is showing，原 BLOCKED 记录保留，不判为产品重命名缺陷；用户手动重命名后核对同一乙节点、新名称、完整正文及甲乙往返；`result-followup.md`、`result-followup2.md` |
| 已保存乙删除至回收站、自动共同回落甲 | PASS | 一次点击删除；未手动选甲，活动树与当前正文自动共同回落甲，甲全文精确匹配且已保存；回收站只读确认乙存在，未恢复或永久删除；`result-followup3.md` |
| 已保存删除前取消 | N/A | 已保存删除没有前置确认。早期因步骤不匹配停止的记录保留，主控调整后记不适用；没有测试 dirty 删除取消，也不能把普通离开取消当作该分支 |
| 经欢迎页最近列表 A/B 往返 | PASS | B 空白基线确认后输入保存，B→欢迎页→A→欢迎页→B；名称、完整路径、正文及各自活动节点一致，A 乙仍在回收站；`result-cross-project.md` |
| B 未保存尾标取消与跨作品保存 | PASS | B 加尾标后取消离开，身份、节点、全文及 dirty 保留；再真正保存并离开，经欢迎页打开 A 后重开 B，尾标完整保留、已保存、无 A 内容；`result-cross-project.md` |

### 证据位置与捕获缺口（收尾纠正）

本机临时证据目录：`C:\Users\Administrator\AppData\Local\Temp\opencode\next-story-transition-20260924-132814-fb09f4`。其中 `result.md`、`result-followup.md`、`result-followup2.md`、`result-followup3.md`、`result-cross-project.md` 为执行者报告；编号 `.log` 为 PowerShell transcript；PNG 为当时写出的截图。此目录可能清理失效，不是永久归档。

收尾实际抽查 `19-delete-once.log`、`24-b-save.log`、`30-final-b-reopen.log`：有命令及时间记录，但 Node 标准输出未捕获入文件。`19-delete-once.log` 保留 PowerShell 的 `DELETE_CLICK_EXIT=0`，不含删除后 DOM 返回；`24-b-save.log` 的输出区为空；`30-final-b-reopen.log` 第 43–45 行为空，仅后续 PowerShell 进程/端口结果仍在。命令中出现断言表达式不等于断言返回 true。

因此撤回旧报告中“各 .log 记录驱动实际输出与 DOM 断言”以及笼统“以日志中的 DOM 读回为依据”的表述：这些文件只能按实际内容作为操作命令、时间和部分 PowerShell 输出记录，不能统称完整断言日志。实际断言输出由本会话工具返回及代理报告提供；未抽查文件也不假定完整捕获。旧文件保留，不回填为当时原始输出；补充说明见临时目录 `evidence-capture-correction.md`（执行者事后整理，非原始日志）。不为补日志重跑 UI。

截图写出不等于视觉核验；执行者未读取图片内容做视觉核验，不用 PNG 文件存在代替过程或断言证据。

### 终态与独立核对

执行者最后读回：B 的“未命名文档”，唯一活动节点 `node-1790229611340579900-3`，完整正文 `合成验收B正文【140108-fb09f4-B】【B跨作品保存尾标-140108-fb09f4】`，已保存，无可见对话框；PID 7508 窗口保持打开。

主控在本次收尾指令中提供其另行执行的只读 CDP 终态断言返回（不是执行者本次重跑）：

```json
{"expectedProject":true,"current":"未命名文档","finalBExact":true,"status":"已保存","tree":[{"id":"node-1790229611340579900-3","name":"未命名文档"}],"visibleDialogs":[]}
```

`finalBExact` 比对上述完整 B 基线。该独立核对仅支持终态，不反向证明全部中间步骤；本次文档收尾未再操作或查询 UI，未关闭窗口。

### 尚未解决与不扩展的结论

- 跨作品仅验证经过欢迎页最近项的路径，未验证作品内直接打开另一作品的原生目录选择链路。
- 原生 IME、可控延迟/竞态、F02 所有复合条件、完整焦点/选区/撤销历史、故障恢复及 AI 输入焦点矩阵未完成；快路径成功不证明这些场景。
- 重开持久仅指同一进程内保存、离开作品再重开，不是进程重启耐久性；恢复/永久删除及安装包未验，真实模型网络测试仍未执行。
- 原 `npm run check` 的 12 项 lint 失败不变，本次不重跑全量测试或构建，不改脚本或配置掩盖失败。
- 任务逐项映射与完整核收仍待完成；未改 tasks 勾选、未提交、未推送、未归档，不将此有限 UI 结果写成整批验收完成。

## 2026-09-24 取消恢复缺陷的修复与重验（晚间批次）

### 缺陷与修复来源

- 真实失败证据：临时目录 `32-focus-history.jsonl`（旧构建）——取消离开后正文/dirty/editable 恢复，但焦点落 `BODY`、DOM 选区在编辑器外，反向选区 `20 → 0` 丢失。这是本批修复的 RED 依据。
- 中途两个新会话 writer 均 `Task cancelled`（模型上游中断），未产生执行结果；已显式取消且不复用，进程排查未发现可归属残留。之后改为分两个短任务由同一 fixer 会话执行，全部完成。
- Oracle 第二/三轮只读核收：无发现新的具体阻断；桌面验收前明确「happy-dom 不能证明真实 WebView2 行为」。

### 修复实现（两段，均先 RED 后 GREEN）

- 第一段（内核，`src/rich-text-editor.ts` + `tests/editor-transition-safety.test.ts`）：`pauseEditing()` 返回暂停句柄 `{ resume(), restoreSelection({syncDOM}) }`；在 `domObserver.flush()` 之后、`setEditable(false)` 之前捕获文档与选区 bookmark（保留 anchor/head 方向）；恢复前校验实例未销毁、许可代次匹配、正文仍对应；恢复事务 `addToHistory=false`。RED：旧接口下真实内核反向选区恢复断言失败（anchor/head `2/2` ≠ `3/1`）；GREEN：该文件 14 通过 0 失败。
- 第二段（`src/editor.ts`、`src/leave-dialog.ts`、`src/workspace-project-flow.ts`、`src/new-project-form.ts` 及对应测试）：由切换所有者统一持有恢复材料，捕获时机在禁导航前；离开弹框默认行为不退化，仅受工作区切换保护时由外层负责最终恢复；释放顺序为「恢复编辑能力 → 恢复控件 → 解禁导航 → 再核验所有权/实例/未提交 → 恢复选区 → 按焦点规则恢复 DOM」；`new-project-form.ts` 两处 finally 改为先清自身忙碌再释放外层（Oracle 原计划遗漏，实施中发现）。RED：真实离开弹框取消测试 23 通过 1 失败（恢复发生在全部解锁前/未发生）；GREEN：定向 123 通过 0 失败（39＋66＋18）。
- 焦点规则：外部输入（AI 等）已接管时不碰其 DOM 选区、不抢焦点；原目标为调用按钮时恢复正文 DOM 选区后把焦点还给该按钮；目标断开/禁用/不可用不强制聚焦正文兜底。成功提交与卸载丢弃旧恢复材料。

### 全量核验（主控直接执行，非代理转述）

| 命令 | 实际结果 |
| --- | --- |
| `npm run test:frontend` | 1047 通过，0 失败/取消/跳过，退出 0 |
| `npm run typecheck` | 退出 0 |
| `npx --no-install eslint src` | 退出 0 |
| `git diff --check` | 退出 0（仅 LF→CRLF 提示） |
| `openspec validate fix-workspace-transition-boundary --strict` | valid，退出 0 |

`npm run check` 的审计目录 12 项 lint 错误不变（`tmp/project-audit/` 只读，不重跑、不改脚本或配置掩盖）。

### 新桌面构建与运行身份

- `npm run tauri -- build --no-bundle` 退出 0（1 分 56 秒）。产物 `D:\Next Story\src-tauri\target\release\next-story.exe`，最后修改 `2026-09-24T17:13:01+08:00`，16,621,056 字节，SHA256 `B97F66865A58955000548D29325ED1B85801C6613552F7BD130AFE51CD43B47D`。旧 EXE 身份（`10A9BF…`）随重建失效。
- 验收实例一：PID `22852`，CDP 仅 `127.0.0.1:9222`，target `261DE8DDEF6FF2DE76FFDE10E40DBF9C`；经优雅关闭（非强制杀进程）后实例二：PID `21724`，target `31126F4C70582E1C5333CCAFE0F715AA`。WebView2 `153.0.4234.48` 不变。每阶段开始时均重新核对程序路径、哈希、监听归属。
- 全部 UI 操作经 CDP 前端输入通道（真实鼠标事件、键盘事件、`Input.insertText`、`Input.imeSetComposition`），DOM 查询只读，**未直接调用后端**，未注入应用状态或走 IPC。合成作品 B 的正文被验收标记修改并保存，属用户已授权范围。

### 桌面重验结果（证据：临时目录 `36-focus-reverify.jsonl`，逐条断言落盘）

| 场景 | 结果 | 关键断言 |
| --- | --- | --- |
| 取消恢复（旧构建失败场景） | PASS | 取消后正文/dirty/editable 保留；反向选区逐字节恢复（anchor 18 → focus 0，方向 reversed，节点路径一致）；焦点回到 `btn-back-welcome`，不落 `BODY`、不抢到编辑器 |
| 历史与继续输入 | PASS | 取消后 Ctrl+Z 回到取消前基线、Ctrl+Shift+Z 重做恢复、可继续输入、保存成功；磁盘文档 JSON 读回含全部内容 |
| 输入法合成（CDP 合成事件，非原生候选窗） | PASS | 变体 1：编辑器内合成 `nihao` → 提交「你好」落字、状态变未保存；变体 2：合成 `shijie` 进行中点「返回欢迎页」无冻结、离开框在合成解决后出现且编辑器已暂停、取消后「你好 shijie」一字不丢、编辑恢复 |
| 重启恢复 | PASS | 优雅关闭→重启→经欢迎页重开 B：正文逐字恢复（含「你好 shijie」尾段）、状态已保存、编辑器可编辑 |

### 诚实边界（不因本轮通过而收缩）

- 真实微软拼音候选窗口是系统层窗口，CDP 合成事件不能代替；合成中失焦时浏览器提交或取消合成文本属系统输入法策略，本轮按「不冻结、不丢已有正文、取消后恢复编辑」的应用契约断言并如实记录实际文本。
- 截图 `36-before-leave.png`、`36-after-cancel.png` 已写出但未做视觉核验，不作为断言证据。
- 原生目录选择链路（跨作品不经欢迎页）、真实模型网络测试、安装包验收仍未执行。
- 未改 `tasks.md` 勾选，未提交、未推送、未归档。
