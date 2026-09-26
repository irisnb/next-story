## Context

复核报告（`方向/开发前全面工程复核-2026-09-23.md`）第 10 节最后一项，F10–F14 五处工程与文档缺口在四次 change 归档后保持原样（本次逐条核实）：

- **F10**：`package.json` 的 `check` = typecheck＋lint＋前端测试＋可靠性＋驱动＋build＋rust 测试，缺 `test:validation`、`cargo fmt --check`、clippy；`ci.yml` 两平台缺驱动/验证/可靠性，Windows 缺 fmt/clippy（Linux 有）；`ci-pipeline` 现行最低规格只要求「前端四件＋Rust 测试，Linux 额外 fmt/clippy」，故现状不违反规格，本项是规格升级。
- **F11**：`.github/dependabot.yml` 只有 `/` npm 与 `/src-tauri` cargo，缺 `/sidecar`（该目录有独立 `package-lock.json`，CI 已在 `working-directory: sidecar` 执行 `npm ci`）。
- **F12**：`scripts/vendor-node.ps1` 锁定 `24.15.0` 并下载官方 zip，但**无独立哈希核验**、仅跑 `node.exe --version` 未断言版本；Tauri 打包资源（`../sidecar/node-runtime/`、`../sidecar/node_modules/`、`../sidecar/driver/`，见 `tauri.conf.json:28-35`）只被 Tauri 做存在性校验，没有「入口/驱动/运行时辰备」的语义校验；`dsh_sidecar.rs:110-115` 缺内置 Node 时回退 PATH（开发便利，但会掩盖发包缺件）；README 首次安装只有根目录 `npm install`，无 sidecar 依赖与内置 Node 准备步骤（`README.md:177-183`）。
- **F13**：README 第 7 行称阶段 1–6 全部完成，第 73 行又写「Agent 按需补读（阶段 6，未开始）」；数据保存表（`README.md:101-113`）只写「手动保存写入」，未说明切换文档前先保存（`src/editor.ts:453-458`）；`runtime_contract.rs:5-6,12-13,17-26,32,59-60` 仍把流式/取消/工具调用写成未来扩展位，而 `capability_gateway.rs:91-105,125-137` 已放行并测试；`dsh_sidecar.rs:3-15` 头注仍描述一次性任务模型，而同文件 `:40-44` 自述常驻链路才用 `driver.mjs`；`project-readme` 规格第 39 行仍禁止把「Agent 按需补读」写成已实现（阶段 6 已于 2026-09-21 归档）。
- **F14**：`src/conversation-archive.ts:207` 的复合键分隔符是**真实 NUL 字节**（字节级核实：1 个，位于行 207 模板串内），与注释第 201 行声明的 `'\u0000'` 语义一致但以不可见字节存在，影响 rg 等常规文本搜索与差异审查。

约束：AGENTS.md（产品行为不改；一次一个 change；不新增写回）；产品只发行 Windows（内置 Node 与 vendor 脚本按 Windows 处理）；F12 的安装包真机验收在 Change 5 之后的统一真机测试轮执行。

## Goals / Non-Goals

**Goals:**

- 一条标准检查命令（`npm run check`）＝ CI 科目 ＝ README 说明，三者同一集合，且集合本身可被单一命令结构性保证不漂移。
- 三个依赖树全部纳入 Dependabot 周度巡逻；规格与配置一致。
- 打包链：内置 Node 有官方哈希核验与版本断言；资源缺件在构建前以中文错误中止；README 给出完整首次安装与打包步骤。
- 文档与注释与当前调用链一致：README 矛盾消除、数据流补充切文档保存语义、代码注释与规格不再停留在旧阶段。
- 源码 NUL 字节清除，并有回归测试防止复发。

**Non-Goals:**

- 不改任何产品行为、档案格式与 UI；不动 F01–F09（已归档）。
- 不扩 AGENTS.md、方向文档、`sidecar/UPGRADING.md`（各有归属，避免顺手扩范围）。
- 不做「干净 Windows 安装包验收」——按用户已定安排，在 Change 5 结束后的统一真机测试轮执行。
- 不做 §6.4 提到的边界测试递归化/语法树化改造（不在 F10–F14 列表；避免顺手扩范围）。
- 不改 `dsh_sidecar.rs` 的运行期 PATH 回退行为（开发便利保留；发布安全由构建前校验保证——见 D2/D3）。

## Decisions

### D1：单一门禁集合 = `npm run check`，CI 两平台执行同一条命令

- `package.json`：新增 `fmt:rust`（`cargo fmt --manifest-path src-tauri/Cargo.toml --check`）、`clippy:rust`（`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`）、`package:check`（`node scripts/check-package-resources.mjs`）；`check` 更新为：typecheck → lint → test:frontend → test:reliability → test:driver → test:validation → build → fmt:rust → clippy:rust → test:rust。
- `ci.yml`：两个平台在既有准备步骤（checkout、Node、sidecar/根依赖、Linux 系统库、rust toolchain 含 rustfmt+clippy、rust-cache）之后，**单步执行 `npm run check`**；删除逐科目镜像步骤。Windows 作业因此补齐 fmt/clippy/validation 等全部科目。
- 被否决的替代：CI 逐科目镜像 + 一个解析 `package.json` 与 `ci.yml` 的一致性测试。它维护两处清单并引入脆弱的 YAML 解析测试；单命令方案让「本地＝CI」成为结构事实，而不是被测试追认的约定。代价（失败粒度变粗）由步骤日志完整输出抵消。

### D2：打包资源校验接入 `beforeBuildCommand`

- 新增 `scripts/check-package-resources.mjs`（Node，跨平台执行）：校验 `sidecar/node-runtime/node.exe`、`sidecar/node_modules/@deepseek-ai/dsh`（入口）、`sidecar/driver/driver.mjs` 存在；缺失时以中文错误列出补救步骤（`sidecar` 目录 `npm ci`；`scripts\vendor-node.ps1`）并 `exit 1`。
- `tauri.conf.json`：`beforeBuildCommand` 由 `npm run build` 改为 `npm run build && npm run package:check`。任何 `tauri build` 入口（含直接 `npm run tauri build`）都先过资源校验，MUST NOT 产出缺件安装包。
- 被否决的替代：只改 `npm run tauri:build` 脚本前缀。直接调用 `npm run tauri build`（README 现状写法）或 IDE 任务会绕过；`beforeBuildCommand` 是所有 Tauri 构建路径的必经点。

### D3：内置 Node 哈希核验依据官方清单

- `scripts/vendor-node.ps1`：下载归档后，再从同一分发目录取 `SHASUMS256.txt`，解析对应归档文件名的官方 SHA-256，与 `Get-FileHash` 结果比对；不匹配即中止且不安装；随后执行 `node.exe --version` 并断言等于 `v$NodeVersion`（替换现有的「只跑不比对」）。
- 被否决的替代：把哈希硬编码进脚本。官方清单与归档同源发布、每次升级 Node 版本无需改两处，且报告要求的是「独立哈希核验」。

### D4：文档校正按当前调用链改写，不做状态堆叠

- README：修正第 7/73 行矛盾（按需补读为已实现，移出「当前未实现」列表）；数据保存表补充「当前文档在切换前先保存，保存失败保留当前内容并提示」（对应 `src/editor.ts:453-458`）；检查命令章节说明 `npm run check` 的完整科目与「CI 使用同一套」；首次安装补 sidecar 依赖与内置 Node 准备（版本、脚本、仅 Windows）；补打包步骤。
- `runtime_contract.rs`：流式/取消/工具调用的注释改为「已实现并授权（随常驻会话 / 按需补读），随能力网关放行」；多 Agent 仍为未来扩展位；`Cancelled` 结果注释改为「取消路径已实现」。
- `dsh_sidecar.rs`：头注改述两条路径——常驻驱动（生产主路径，`sidecar/driver/driver.mjs`）与旧一次性路径（`bin.js`，常驻链路不使用）；PATH 回退处补注释「打包产物由构建前资源校验保证不依赖 PATH」。
- `project-readme` 规格：解除「不得把 Agent 按需补读写成已实现」的过时禁令，改为允许并说明；安装步骤要求补 sidecar 依赖与内置 Node 准备；数据流要求补切文档先保存语义。
- 被否决的替代：只改 README 不改规格。规格是「已实现真相源」的契约，第 39 行的禁令与阶段 6 归档事实冲突，必须同 change 修正，否则下一次文档检查会再次被规格拖回旧状态。

### D5：NUL 字节修复 + 回归测试

- `src/conversation-archive.ts:207`：模板串中的真实 NUL 替换为 `\u0000` 转义（同一字符、运行语义零变化；注释第 201 行已按转义书写，本修复让代码与注释一致）。
- 新增源码卫生回归测试（`tests/source-hygiene.test.ts`）：递归扫描 `src/` 与 `tests/` 下 `.ts` 文件，断言不含真实 NUL 字节（逐字节检查，不依赖 ripgrep 的二进制判定）；失败时给出文件与字节偏移。

## Risks / Trade-offs

- [CI 时长增加（Windows 补 fmt/clippy/validation）] → 保留 rust-cache；门禁完整性优先于分钟级成本，接受。
- [资源校验在非 Windows 打包环境拦截] → 产品只发行 Windows（方向决策）；脚本错误信息注明平台前提与补救步骤。
- [哈希核验依赖 nodejs.org 可用] → 打包机本就需要下载归档；核验失败即中止，宁可失败不产出未验证产物。
- [新检查脚本本身出错导致打包被误拦] → 脚本只做存在性检查、无副作用；失败信息含逐项通过/缺失清单，便于一眼归因。
- [文档再次漂移] → 「本地＝CI」由单命令结构性保证；规格解除过时禁令后，文档事实以 specs＋README 双向对齐维护。

## Migration Plan

- 无数据迁移；回滚即代码回退（CI/脚本/文档/注释与一处等价转义）。
- 规格与实现同一 change 内完成；归档时同步 `ci-pipeline`、`project-readme`、`dsh-sidecar-lifecycle` 并更新第 10 节状态行（Change 5 → ✅，全部五次完成）。

## Open Questions

- 无阻塞性未知项。验证方式：`npm run check` 全绿（现在含 validation/fmt/clippy）、`npm run test:validation`、新增源码卫生测试；`vendor-node.ps1` 的哈希核验与资源校验脚本以本地干跑验证（不下载真实归档的可注入路径由任务定义）。
