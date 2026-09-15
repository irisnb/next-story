# Tasks: CI 恢复绿灯与 Dependabot 治理

## 1. 时区依赖测试修复

- [x] 1.1 修改 `tests/ai-panel-conversation-list.test.ts` 中「更早」分组月份断言的测试数据：`"2025-06-01T00:00:00+08:00"` → `"2025-06-15T12:00:00+00:00"`、`"2025-05-01T00:00:00+08:00"` → `"2025-05-15T12:00:00+00:00"`，断言期望值保持不变
- [x] 1.2 以 `TZ=UTC` 与本地时区分别运行前端测试，确认两环境下该测试均通过（时区无关性验证）

## 2. Rust 格式化与 clippy 修复

- [x] 2.1 执行 `cargo fmt --manifest-path src-tauri/Cargo.toml`（全量格式化），确认 `cargo fmt --check` 通过
- [x] 2.2 修复 clippy 告警（库 9 处 + 测试 14 处）：机械类逐处人工确认改写；`generate.rs:267` 与 `lib.rs:1467` 参数超限采用定点 `#[allow(clippy::too_many_arguments)]` 加注释（结构性拆分归审计 P2-1/P2-2），确认 `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` 通过
- [x] 2.3 运行 `cargo test --manifest-path src-tauri/Cargo.toml`，确认全部通过（0 失败，既有 1 项忽略项照旧）

## 3. Dependabot 策略调整

- [x] 3.1 重写 `.github/dependabot.yml`：npm 与 cargo 均 `interval: monthly`、`ignore` semver-major、按生态 `groups` 分组、`open-pull-requests-limit: 2`
- [x] 3.2 核对新配置与 `ci-pipeline` 规格 Dependabot 要求一致

## 4. 本地全量验证

- [x] 4.1 运行 `npm run typecheck`、`npm run lint`、`npm run test:frontend`、`npm run build`，全部通过
- [x] 4.2 复核 git 差异：除测试数据、格式化产物、clippy 修复与 `.github/dependabot.yml` 外无其他改动（零产品行为变化）

## 5. 推送与 CI 验证

- [ ] 5.1 按 git-master 规范提交并推送（中文提交信息，分开逻辑提交：测试修复 / 格式化与 clippy / dependabot 配置）
- [ ] 5.2 等待 CI 双平台结果：全绿则通过；若 Windows 再现 `jetscii` 依赖缓存错误，删除该仓库 Actions 的 rust-cache 缓存后重跑；出现新的失败项则按根因小步追修（仍属本 change 范围，目标即 CI 绿）
- [ ] 5.3 （5.2 首轮发现）CI 两平台增加 `sidecar/node-runtime/` 占位目录步骤：Tauri 构建脚本校验资源路径存在，而 vendor 的 Node 运行时有意不入库（`.gitignore`）且 vendor 脚本仅支持 Windows；CI 不打包安装包，占位即可（见设计决策 6）

## 6. 收尾

- [ ] 6.1 CI 全绿后关闭 10 张现存 Dependabot 旧 PR（#1–#10）
- [ ] 6.2 归档本 change，同步更新《方向/全量地基审计-2026-09-14.md》第八节（记录 CI 修复完成，并注明审计本地验证未含 fmt/clippy 的教训）
