# 工程卫生批·验证记录（门禁统一、打包链与文档校正）

> 2026-09-26。本记录整理本次 change 的门禁结果、脚本干跑证据与文档校正清单。
> 范围如实声明：**未下载真实 Node 归档、未构建安装包、未执行干净机器验收**——按用户安排，安装包与真机验收在 Change 5 结束后的统一真机测试轮执行；未运行远端 CI（本地 Windows 全量门禁通过，CI 工作流以静态核对＋同一命令验证）。

## 一、方法与范围

- **修复对象**：复核报告（`方向/开发前全面工程复核-2026-09-23.md`）F10（门禁集合不一致）、F11（Dependabot 缺 sidecar）、F12（内置 Node 无哈希核验、无构建前资源校验、README 步骤不全）、F13（入口文档与注释停留在旧状态）、F14（源码真实 NUL 字节）。
- **统一不变量**：一条 check 命令＝CI 科目＝文档现实。
- **证据形态**：本地全量门禁（唯一命令）；打包资源校验与哈希核验以离线干跑留证（含退出码与清理证据）；文档与注释逐条对照现状核对。

## 二、门禁结果（全部通过）

| 门禁 | 结果 | 说明 |
|---|---|---|
| `npm run check`（新完整集合） | 通过（exit 0） | typecheck / lint / 前端 1114 / 可靠性 120 / 驱动 13 / 离线协议验证 78 / 生产构建 / `fmt:rust` / `clippy:rust` / Rust 302 单元＋80 集成（真实链路 3 项按既有约定忽略） |
| 前端测试新增项 | 通过 | `tests/source-hygiene.test.ts`（源码 NUL 扫描）1 项通过 |
| `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings` | 通过 | 现已进入 `npm run check`；CI 两平台执行同一命令 |
| CI 工作流静态核对 | 通过 | Linux 与 Windows 作业准备步骤后就地执行单步 `npm run check`；逐科目镜像步骤已删除；两平台均含 rustfmt/clippy 组件 |

## 三、脚本干跑证据

### 打包资源校验（`scripts/check-package-resources.mjs`）

| 场景 | 观察结果 |
|---|---|
| 原始资源（含真实 `node.exe`） | `RESOURCE_BASELINE_EXIT=0`（中文「打包资源检查通过」） |
| 临时移走 `sidecar/node-runtime/node.exe` | `[缺失] sidecar/node-runtime/node.exe`，其余两项通过，输出补救步骤，`RESOURCE_MISSING_EXIT=1` |
| 临时创建占位 `node.exe` 后 | 检查通过，`RESOURCE_COMPLETE_EXIT=0` |
| 清理证据 | `ORIGINAL_NODE_RESTORED=True`、`TEMP_BACKUP_REMOVED=True`；恢复前后 SHA-256 一致，未遗留临时文件 |

### 哈希核验（`scripts/verify-archive-hash.ps1`，完全离线）

| 场景 | 观察结果 |
|---|---|
| 临时归档与本地清单匹配 | `SHA-256 核验通过：fake-node.zip`，`HASH_MATCH_EXIT=0` |
| 篡改归档、保留原清单 | `SHA-256 核验失败：fake-node.zip 的哈希与官方清单不匹配；已中止，不安装运行时。`，`HASH_MISMATCH_EXIT=1` |
| 清理证据 | `HASH_TEMP_REMOVED=True` |

`scripts/vendor-node.ps1` 已接线：下载归档后取同分发目录官方清单核验，失败中止不安装；解压后、安装前断言 `node.exe --version` 等于锁定版本（24.15.0）。真实下载与安装留待打包机/真机轮。

## 四、F14 源码卫生

- 字节级修复：`src/conversation-archive.ts` 真实 NUL 字节 1 个 → 0 个；第 207 行现为可见转义 `${projectPath}\u0000${conversationId}`，与第 201 行注释一致，运行语义不变。
- 回归测试：`tests/source-hygiene.test.ts` 递归扫描 `src/` 与 `tests/` 全部 `.ts` 文件，防止复发；当前通过。

## 五、文档校正清单（F13）

- `README.md`：按需补读从「未开始」矛盾中修正为已实现能力（授权属于讨论、可随时关闭、跨重启保留），并移出「当前未实现」列表；数据保存表补充「切换文档前先保存、失败不切换」及正文手动保存与讨论档案自动保存的区别；安装章节补 Node 版本要求（DSH ≥22.19、CI 22、内置 24.15.0）、sidecar 依赖安装与内置 Node 准备（仅 Windows 打包）；检查命令章节改述 `npm run check` 完整十项与「CI 双平台执行同一套」；补 Windows 安装包构建步骤与构建前资源校验说明。
- `src-tauri/src/runtime_contract.rs`：纯注释校正——流式、取消、工具调用改为「已实现并授权」（随常驻会话 / 按需补读），多 Agent 保持未来扩展位；`Cancelled` 与事件/取消关联说明同步现状。
- `src-tauri/src/dsh_sidecar.rs`：纯注释校正——头注分述常驻驱动生产主路径（`sidecar/driver/driver.mjs`）与旧一次性路径（`bin.js`）；PATH 回退处注明发布产物由构建前 `package:check` 保证不依赖 PATH，回退仅服务开发链路。
- 注释改动经 `cargo fmt --check` 与逐行 `git diff` 自查：仅注释行，无类型、枚举值或逻辑变化。

## 六、边界与未验事项

- **未下载真实 Node 归档**：哈希核验以本地临时归档＋清单验证逻辑，真实下载与安装由打包机执行。
- **未构建安装包、未做干净 Windows 机器验收**：按用户安排放入 Change 5 结束后的统一真机测试轮（含 F12 的安装包入包检查：内置 Node、DSH 入口、常驻驱动齐备且不依赖 PATH）。
- **未运行远端 CI**：工作流改动以静态核对与「本地执行同一命令」验证；首次推送后由 CI 实际运行确认。
- Git 提示 LF→CRLF（仓库既有行为），不影响检查结果。
