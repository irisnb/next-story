# 实施裁决记录（8d 文档维护批量）

日期：2026-09-22。本文件记录 apply 期间各泳道上报、由主控裁决的判断，及最终状态账目。

## 一、主控裁决清单

| # | 事项 | 裁决 | 依据 |
|---|---|---|---|
| 1 | requirement 标题含映射词（4＋1 个） | REMOVED＋ADDED 对承载（不用 RENAMED） | 交叉引用核实为零；工具基础操作语义明确 |
| 2 | llm-configuration :323/:328 守护句（清单外补入） | **接受** | 同文件同型条款（「MUST NOT 修改草稿本、正文本或作品元数据」），不改则同文件处理不一致 |
| 3 | project-readme :171 守护句（镜像 README 措辞） | **跳过＋登记** | README 本身不在本批；只改 spec 会与 README 脱钩——遗留至下次 README 相关 change |
| 4 | selection-ai-invocation :107 守护句 | **跳过** | 所在 requirement 属 D7 登记的 draft/main 本子标识条款，整份规格另有归属 |
| 5 | 英文守护句 ×3（orchestration :27/:31、state-structure :36 的 draft/main notebook） | **并入**（守护对象→user document(s)） | 与已批准守护句现代化同类；单数定语形（user document text/callbacks）按英语语法接受 |
| 6 | 英文场景标题 ×2（notebook write functions/path）＋枚举对齐 ×1（full notebook text→full-document text）＋残留形容词 ×1（linear temporary follow-up→linear follow-up） | **主控直接改** | 正文已现代化、标题/枚举留旧词即「改一半」；full-document text 有 state-structure 平行先例；temporary 是临时对话时代残词 |
| 7 | 「项目结构版本」族 9 处存疑 | **统一为「作品结构版本」** | mod.rs:56 已有「当前作品结构版本」先例（代码原已两头不一致）；规格侧连带出第 15/16 份 delta |
| 8 | structured-notebook-storage :7 措辞 | **选 (b)**「不得用于表示作品结构版本」 | 避免「作品的作品结构版本」叠字，语义不变 |
| 9 | fix-3 超「只改两文件」边界：tests/project_test.rs 断言随改 4 处 | **接受＋登记** | 「断言随改」规则与残留清零要求的必然推论，不改则 test:rust 必挂 |
| 10 | fix-4 判定：writing-notebooks Purpose 保留「双本子」措辞、production-editor-kernel「两个本子」描述性引用、orchestration Purpose 为清长度警告扩写 | **全部接受** | 事实源以当前 Requirements 为准＋D2 界面模型描述不动；扩写限于既有 requirement 内容 |

## 二、最终状态账目

- **delta：16 份**（13 术语＋editor-margin-preference＋desktop-project-lifecycle＋structured-notebook-storage）；结构合计 5 组 REMOVED/ADDED（4 术语标题＋1 版本标题）；`openspec validate` 通过。
- **Purpose：44 份直改**（39 TBD 补齐＋3 附加修正＋2 清扫）；55 份规格严格校验通过；Purpose 层概念性旧词 0 残留（合法引用 6 处在册：新建对话控件 ×3 类、双本子迁移、思维扩展退场声明、writing-notebooks 主体描述）。
- **失效路径：5 处标注**；docs/ 与 方向/ 复核无非 archive 残留（目录泛指说明除外）。
- **Rust：SAFETY ×3；「项目」统一 20＋13＝33 处改动**（含 project_test.rs 断言 4 处）；保留：代码标识（project.json/ProjectError 等）、「项目符号」（Word bullet 假阳性）；`test:rust` 342 通过 0 失败；`cargo check --all-targets` 零新增警告。
- **apply 期验收**：validate --specs 55 过；Purpose 层 grep 清零；16 份 delta 与主规格逐块 diff 仅含授权改动。

## 三、登记的遗留（不进本批）

1. **D7 结构性失真**：writing-notebooks、production-editor-kernel（主体）、basic-rich-text-editing（部分）、editor-context-menu、selection-ai-invocation（本子标识条款）整份描述旧双本子世界——须单开 change 与现实对账（本 change 归档时补记入审计文档）。
2. **project-readme :171**：spec 镜像 README 永久边界措辞，待 README 相关 change 一并处理。
3. **历史文档中的旧词**（方向/ 各快照文档、docs/ 报告里的「临时对话」等）：已挂历史基线标注，按「不改历史决策原文」保留。
