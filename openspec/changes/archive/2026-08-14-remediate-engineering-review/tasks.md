## 1. 保存大小上限与恢复（P1-01）
- [x] 1.1 先为「草稿超限」「正文超限」「恰好等于上限」「上限 + 1」「Staged 超限事务打开」「Committing 超限事务打开」补 Rust 失败测试，再在 `run_save_transaction` 创建事务前加字节数校验并返回 `ProjectError::ContentTooLarge`
- [x] 1.2 恢复逻辑 `Staged` 直接丢弃暂存目录，`Committing` 超限返回带人工恢复路径的 `ContentTooLarge`

## 2. 保存持久性（P1-02）
- [x] 2.1 `write_file_atomically`（project 与 llm_config）在 `flush` 后加 `sync_all`，`persist` 后同步父目录

## 3. LLM 配置读取上限（P2-03）
- [x] 3.1 `load_llm_config` 改为有界读取（64 KiB），补超大配置返回失败测试

## 4. 移除未使用 opener 权限（P2-04）
- [x] 4.1 移除 `tauri_plugin_opener`（Cargo.toml、lib.rs、capabilities、package.json），dialog 保留

## 5. 订阅退订（P3-02）
- [x] 5.1 `AiPanelState.subscribe` 返回 `() => void` 退订函数，补退订测试

## 6. CI 与静态检查（P1-03 / P2-07）
- [x] 6.1 新增 `.github/workflows/ci.yml`（Linux 全量 + Windows Rust/构建）
- [x] 6.2 运行 `cargo fmt` 统一格式，修复全部 clippy 警告

## 7. 验证
- [x] 7.1 运行 typecheck、前端测试、rust test、clippy、fmt、build 全部通过
