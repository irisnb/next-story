## 1. 统一门禁（F10）

- [x] 1.1 `package.json`：新增 `fmt:rust`（`cargo fmt --manifest-path src-tauri/Cargo.toml --check`）与 `clippy:rust`（`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`）脚本；`check` 更新为完整集合：typecheck → lint → test:frontend → test:reliability → test:driver → test:validation → build → fmt:rust → clippy:rust → test:rust
- [x] 1.2 `.github/workflows/ci.yml`：两个平台在既有准备步骤（checkout、Node、sidecar 与根依赖、Linux 系统库、rust toolchain 含 rustfmt/clippy、rust-cache）之后**单步执行 `npm run check`**，删除逐科目镜像步骤；Windows 作业因此与 Linux 执行完全相同的科目集合
- [x] 1.3 本地验证：`npm run check` 全绿（此时已包含离线协议验证、`fmt:rust` 与 `clippy:rust`）

## 2. 依赖巡逻与打包链（F11/F12）

- [x] 2.1 `.github/dependabot.yml`：新增 `/sidecar` 的 npm 周度巡逻条目（与 `/` npm、`/src-tauri` cargo 并列）
- [x] 2.2 `scripts/vendor-node.ps1`：下载归档后从同一分发目录获取官方 `SHASUMS256.txt`，解析对应归档的 SHA-256 并以 `Get-FileHash` 比对；不匹配即中止且不安装；随后断言 `node.exe --version` 等于 `v$NodeVersion`（替换现有「只运行不比对」）
- [x] 2.3 新增 `scripts/check-package-resources.mjs`（Node，跨平台执行）：校验 `sidecar/node-runtime/node.exe`、`sidecar/node_modules/@deepseek-ai/dsh` 入口与 `sidecar/driver/driver.mjs` 齐备；缺失时输出中文可读错误（逐项通过/缺失清单＋补救步骤：`sidecar` 内 `npm ci`、`scripts\vendor-node.ps1`）并以非零码退出
- [x] 2.4 `src-tauri/tauri.conf.json`：`beforeBuildCommand` 改为 `npm run build && npm run package:check`（所有 `tauri build` 入口统一经过资源校验）
- [x] 2.5 干跑验证并留证：资源齐备路径通过、缺件路径（临时移走/改名资源后恢复）以中文错误中止且退出码非零；哈希核验以本地临时归档＋本地清单文件验证「匹配通过 / 不匹配中止」两种结果；已记录到验证文档

## 3. 文档现实校正（F13）

- [x] 3.1 `README.md`：修正阶段状态矛盾（第 7 行「阶段 1–6 全部完成」与第 73 行「按需补读未开始」二选一为准）：按需补读移入已实现能力陈述，并同步「当前未实现」列表（移出按需补读，保留附近文本、整本摘要、语义检索、自动保存等真未实现项）
- [x] 3.2 `README.md` 数据保存表：补充「当前文档在切换之前先执行保存；保存失败保留当前内容并提示、不切换」语义；说明作品正文为手动保存、讨论档案为自动保存的区别
- [x] 3.3 `README.md` 安装与命令章节：首次安装补 `sidecar` 依赖安装与内置 Node 运行时准备（锁定版本、脚本名、仅 Windows）；明确 Node 版本要求；检查命令说明改为 `npm run check` 完整科目＋「CI 执行同一套」；补打包步骤与构建前资源校验说明
- [x] 3.4 `src-tauri/src/runtime_contract.rs` 注释校正：流式、取消、工具调用改为「已实现并授权（随常驻会话 / 按需补读）」现状；多 Agent 保持未来扩展位；`Cancelled` 结果说明与现状一致；与 `capability_gateway.rs` 的授权事实不矛盾
- [x] 3.5 `src-tauri/src/dsh_sidecar.rs` 头注校正：常驻驱动（生产主路径，`sidecar/driver/driver.mjs`）与旧一次性路径（`bin.js`，常驻链路不使用）分述；PATH 回退处补注释说明发布安全由构建前资源校验保证（运行期行为不变）

## 4. 源码卫生与收尾（F14）

- [x] 4.1 `src/conversation-archive.ts`：第 207 行模板串中的真实 NUL 字节替换为可见转义 `\u0000`（同一字符、运行语义零变化，与第 201 行注释一致）
- [x] 4.2 新增 `tests/source-hygiene.test.ts`：递归扫描 `src/` 与 `tests/` 下全部 `.ts` 文件，断言不含真实 NUL 字节；失败输出文件路径与字节偏移
- [x] 4.3 门禁全绿：`npm run check`（含新增科目）与 `npm run test:validation`
- [x] 4.4 `verification/validation.md`：记录门禁结果、脚本干跑证据、文档校正清单与如实边界（不实际下载归档、不执行安装包真机验收——后者按用户安排在 Change 5 结束后的统一真机测试轮）
- [ ] 4.5 归档前核对：规格 delta 完整（MODIFIED 全文、场景 4 级标题格式）；更新《开发前全面工程复核-2026-09-23.md》第 10 节 Change 5 行为 ✅（附归档 change 名与日期），并核对五次 change 全部完成、无遗留 ⬜
