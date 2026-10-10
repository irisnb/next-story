# 制作显示命名最终核对（final-name-reconcile，2026-10-10）

范围：唯一批准 change `update-frontend-ui-v5` 的文字命名核对（bounded，无设计决策）。仅覆盖用户可见命名与其在 UI/viewmodel/tests/当前 change delta/IR/验收状态文档中的一致性；不改 schema、requirement/posture 卡类型、草稿解析协议、真实提示词底线、读取授权、CSS 设计与任何业务行为。

## 1. 批准完整词（准确名称：待定 → 已定）

用户本轮批准的制作显示命名完整集合（此前的「待定/保留旧名」状态由此转为**已定**）：

| 位置 | 批准名称 |
| --- | --- |
| 整图区域 | 提示词组成 |
| 来源一 | 自定义提示词（副标保留「规定回应的方向与说话方式」） |
| 来源二（内公用） | 公用基础提示词（精确用「公」；内层「红线」「基本立场」「工具」「材料规则」） |
| 来源三（dynamic） | 本次问题与材料（内层「你的问题」「参考材料」「提问方式」） |
| 中 | 组装 |
| 输出 | 完整提示词（副文案「发给 AI 的说明」） |
| 两类 | 回应要求 / 回应风格 |
| 添加 | 添加回应要求 / 添加回应风格（操作文案可附「请制作助手」） |
| 导航 | 导图｜制作对话（不改） |

旧命名退役映射：骨（底线立场）→ 基本立场；当轮材料 → 参考材料；入口 → 提问方式；固定底座 → 公用基础提示词；每轮动态 → 本次问题与材料；要求类/姿态类 → 回应要求/回应风格。历史原型「固定规则/本轮动态」只作历史，不入当前合同。

## 2. 核对结论：用户可见文案与断言已一致（全已改，只验证）

- `index.html`：`提示词组成`、`自定义提示词`、`公用基础提示词` + `红线/基本立场/工具/材料规则`、`本次问题与材料` + `你的问题/参考材料/提问方式`、`组装`、`完整提示词`、`回应要求/回应风格`、`＋添加回应要求/＋添加回应风格` 均为新名。
- `src/making/making-view-model.ts`：`MAKING_BASE_ITEMS.stance` = 基本立场；`MAKING_DYNAMIC_ITEMS.materials/entry` = 参考材料/提问方式；分区 heading、详情 title/eyebrow、`slotTypeLabel`、`MAKING_DETAIL_ACTION_LABELS` 与姿态添加文案均为新名（详见 git 工作区差异）。
- `src/making/making-session-controller.ts`：草稿类型徽标渲染「回应风格/回应要求」。
- `tests/dom-contract.test.ts`、`tests/making-module.test.ts`：显示断言已为新名。

因此本轮对用户可见文字**未新增无谓改动**，只做验证与文档对齐。

## 3. 本轮补齐的文档（此前仍写旧名/未决，属未完成处）

| 文件 | 变更 |
| --- | --- |
| `specs/making-module-page/spec.md` | 命名要求内层句改为内层批准名（替代「骨/当轮材料/入口」）；「命名统一」场景扩展为含内层并禁止回退旧名 |
| `design.md` | 追加「更正（2026-10-10 内层命名已定）」，保留 2026-10-09/10 原时态 |
| `implementation-record.md` | 追加「2026-10-10 内层命名落实」节；上节内层保持描述原时态保留 |
| `verification/acceptance-status-2026-10-10.md` | 追加 §6：命名合同 resolve；§4C 原时态保留；不改任务复选框 |
| `verification/making-naming-2026-10-10.md` | 追加更正，说明内层名已批准落实，原时态保留 |
| `verification/v5-bounded-observer-fix-2026-10-10.md` | 追加更正，说明第 7 段规格命名冲突已 resolve |
| `tasks.md` 5.5 | 补入内层批准名（不改复选框） |

历史记录一律保留原时态并附新决定，未改写旧记录。

## 4. 验证（退出码）

- `node --test tests/making-module.test.ts tests/making-conversation.test.ts tests/making-trial.test.ts tests/dom-contract.test.ts tests/ui-v5.test.ts` → **113 pass / 0 fail / 0 skipped**，exit 0。
- `npm run typecheck` → exit 0。
- `npm run lint` → exit 0。
- `npm run build` → exit 0（`built in 1.37s`）。
- `openspec validate update-frontend-ui-v5 --strict` → **valid**，exit 0。

未运行：native 截图、桌面重打包、`npm run check` 全门禁、安装器。属本 lane 明令排除范围，交依赖的 build/final 车道。

## 5. 残留与需视觉/父代理项

- **源码/测试注释残留**：`src/dom.ts`、`src/making/making-view-model.ts`、`src/making/making-module.ts`、`index.html`、`tests/making-module.test.ts`、`tests/dom-contract.test.ts` 的注释中仍有旧内部区名（「固定底座区/每轮动态/自定义要求区/要求类/姿态类」等）作架构描述。它们不影响用户可见文案、断言与行为；是否清理属命名 churn，留待父代理裁定（未擅自扩大写入）。
- **历史证据不回溯**：`verification/ui-screens/ui-evidence.json` 等旧截图证据含「自定义要求与姿态」，为历史快照，不改写。
- **需真实视觉/父验收**：三档长标题换行、内层四项/三项在窄档的实际字体渲染、输出块「完整提示词」最小档余量——源码尺寸分析（见 `making-naming-2026-10-10.md`）不能代替桌面视觉；由 observer 同尺寸图像比对。
- 命名合同 resolve 不等于 1.4 可勾（1.4 另有单投影/职责迁移/全规格查漏）。

## 6. owned 运行应用记录（供父核查，未处置）

- `verification/v5-launch-owner.json` 记录：PID 32224、parent 33240、exe `D:/Next Story/src-tauri/target/debug/next-story.exe`、创建 2026-10-10T02:14:23、调试端口 9223；真实窗口 HWND 3348336（`Tauri Window`），错误历史 HWND 2102734（`com.nextstory.desktop-sic`）。标注为 handoff 追记、非原始 spawn。
- 本 lane **未启动应用、未停止或杀任何进程**；上记录未被本轮核验或处置。
- 另：`src-tauri/target/debug/next-story.exe` 可能锁定构建产物（前序 lane 曾记录 `test:rust` 因此阻塞），本 lane 未运行 Rust 测试，未触及。

## 7. 边界确认

未做 native 截图、未跑长时全 `npm run check`、未打包、未 Git archive/提交、未发真实模型、未读写用户正文或密钥、未改全局链路、未启动/杀进程。仅改本 change 的文字/文档与验证记录。
