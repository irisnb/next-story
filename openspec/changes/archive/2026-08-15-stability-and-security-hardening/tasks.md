## 1. 后端作品级串行化（P0：并发保存）

- [x] 1.1 在 `src-tauri/src/` 新增进程内作品锁注册表（`Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>`），键为规范化后的作品根路径；提供「取锁 → 执行 → 释放」助手函数（实现为 `&'static Mutex` 按路径注册，等价语义，无 unsafe）
- [x] 1.2 让 `save_project` 全程持有对应作品锁
- [x] 1.3 让 `open_project` 与迁移路径复用同一作品锁
- [x] 1.4 给每次保存事务写入唯一 `transaction_id` 到清单，提交前校验事务目录未被替换
- [x] 1.5 新增 Rust 测试：并发保存确定性重叠，断言无混合世代、暂存文件丢失或损坏
- [x] 1.6 新增 Rust 测试：两个不同作品并发保存可并行且各自世代一致
- [x] 1.7 验证：`cargo test` 通过（并发测试连跑 3 次稳定）

## 2. LLM 配置事务化与密钥安全（P0/P1）

- [x] 2.1 重写 `save_llm_config` 保存顺序为「读旧密钥+旧磁盘配置 → 写磁盘临时文件 → 更新钥匙串 → 原子替换磁盘文件」，失败回滚
- [x] 2.2 给 `save_llm_config` 加互斥串行化并发保存
- [x] 2.3 `load_llm_config` 返回 `LlmConfigSummary { api_base_url, model, has_api_key }`（不含明文 `api_key`）
- [x] 2.4 前端 LLM 配置表单改为掩码显示 + 空则复用后端密钥（`src/llm-config-form.ts`、`llm-config-state.ts`）
- [x] 2.5 `GenerateAiRequest` 及子结构加 `#[serde(deny_unknown_fields)]`
- [x] 2.6 新增 Rust 测试：钥匙串成功、磁盘失败 → 恢复旧配置、无分裂
- [x] 2.7 新增 Rust 测试：注入未知字段 → 稳定拒绝且作品文件字节不变
- [x] 2.8 验证：`cargo test` + `npm run typecheck` + `npm run test:frontend` 全绿

## 3. 迁移框架加固（P1）

- [x] 3.1 迁移回滚复用事务式暂存/恢复（`transactional_restore`），替换裸 `fs::copy`
- [x] 3.2 `rollback_backup` 返回 `Result`，原始错误与回滚错误都保留
- [x] 3.3 迁移步骤幂等 + 「中途崩溃后再次打开」恢复语义
- [x] 3.4 新增 Rust 测试：回滚成功；回滚失败显式上报且保留备份
- [x] 3.5 验证：`cargo test` 通过

## 4. 大小限制与 IPC 加固（P1）

- [x] 4.1 项目文件与 `llm-config.json` 读取改为有界读取（句柄 `take(max+1)`）
- [x] 4.2 前端保存/IPC 前先做同一字节上限检查
- [x] 4.3 新增 Rust 测试：检查后、读取前增大的文件被有界拒绝
- [x] 4.4 验证：`cargo test` 通过

## 5. 同步 I/O 移出异步执行线程（P1）

- [x] 5.1 同步目录/文件/钥匙串操作包进 `spawn_blocking`，作品锁在阻塞线程内覆盖完整事务
- [x] 5.2 锁的获取与释放都在阻塞线程内，不跨 `await`
- [x] 5.3 验证：`cargo test` + `npm run build` 通过

## 6. 能力最小化（安全基线）

- [x] 6.1 核实前端 `src/main.ts:53` 关闭守卫确实调用 `appWindow.destroy()`，故**保留** `core:window:allow-destroy`（审查「未使用」的原始判断不成立，移除会破坏窗口关闭）
- [x] 6.2 `dialog:default` 收窄为 `dialog:allow-open`
- [x] 6.3 验证：`npm run build` 通过，目录选择能力保留

## 7. 前端竞态修复（P1）

- [x] 7.1 AI 预检冻结作品 token，`await` 后重新校验，不符则丢弃
- [x] 7.2 离开流程改为「先选并读候选作品 → 替换前确认 → 立即替换」
- [x] 7.3 打开作品加忙碌锁 + 操作序号，只允许最新操作提交
- [x] 7.4 `showProject` 改为「先准备后交换」
- [x] 7.5 为 7.1/7.2/7.3 各新增可控 Promise 时序测试
- [x] 7.6 验证：`npm run typecheck` + `npm run test:frontend` 通过

## 8. 规格与文档对齐

- [x] 8.1 前端保存路径改为「校验并拒绝」非法文档（`validateNotebookDocument`），不再静默规范化
- [x] 8.2 修正 `README.md` 失效引用（`plain-text-editor.ts` → `rich-text-editor.ts`）
- [x] 8.3 核对 README 与 spec 无 `.txt` 本子残留引用
- [x] 8.4 验证：`npm run build` 通过，grep 无 `.txt` 残留

## 9. 测试加固与假绿修复

- [x] 9.1 新增零写回端到端测试（实现为后端命令级集成测试：真实命令 + 真实磁盘 + mock HTTP，走完首次成功/追问成功/401 失败/空回复失败全流程，每步断言草稿/正文/元信息三份文件字节不变，并以用户保存做正对照；未采用 WebDriver 浏览器自动化——成本高、价值增量低）
- [x] 9.2 把 `tests/` 纳入 typecheck 并修复失效类型引用
- [x] 9.3 把「正则检查源码写法」的脆弱测试改为行为断言
- [x] 9.4 把固定 4 次微任务刷洗改为有界循环刷洗（64 次），消除「流程多加一层 await 就失效」的脆弱性；未改为「等待可观察状态」——那会破坏故意用挂起 Promise 断言中间态的 25+ 现有测试
- [x] 9.5 把 `lint` 纳入 `npm run check`
- [x] 9.6 验证：`npm run check` 全绿（typecheck + lint + 前端 329 测试 + build + Rust 107 测试）
