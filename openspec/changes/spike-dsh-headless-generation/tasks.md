## 1. 环境与版本锁定

- [x] 1.1 精确锁定 `@deepseek-ai/dsh@0.1.0-rc.7`（避开 `latest` 标签陷阱），记录到依赖清单
- [x] 1.2 vendor Node 22.19+ 运行时与 `dsh` CLI（方案见测试文档；实际打包归迁移 phase）
- [x] 1.3 搭一个最小 headless 调用通路：`dsh --profile headless "task"` 能拿到最终答案与退出码

## 2. Tauri 壳 sidecar 通路

- [x] 2.1 Rust 壳实现 spawn dsh sidecar 进程（`generate_via_dsh`：spawn `node bin.js --profile headless`）
- [x] 2.2 实现退出码监控与错误映射（one-shot 无需重启；退出码 + stderr → 错误分类）
- [x] 2.3 实现超时终止回收子进程（`try_wait` 轮询 + `kill`）
- [x] 2.4 实现生成超时的壳侧强制终止（180s；并修掉管道死锁：并发排空 stdout/stderr）

## 3. 生成链迁移到 DSH

- [x] 3.1 等价迁移配置：禁用全部能力工具（验证无工具生成照常 + 写文件被明确拒绝、文件未创建）
- [x] 3.2 首问：冻结选区 + 可选方向 → 生成等价响应（不代写、不评价、纯文本）
- [x] 3.3 追问：完整消息轮次列表 → 生成等价响应（仍锚定首次冻结选区）
- [x] 3.4 A/B 对照开关（方案见测试文档；默认走 Rust 的接线归迁移 phase）

## 4. 凭据接缝

- [x] 4.1 把 `dsh-credentials-keyring` 挂载进 DSH `ctx.credentials` 接缝（正确语法：`disabled` + `insert`，非 `name` 覆盖）
- [x] 4.2 真机验证：确认插件底层与 Rust 同一钥匙串槽位（`com.nextstory.desktop`）；因 `llm-api-key` 含连字符不合法，改一次性交接（已复制到 `DEEPSEEK_API_KEY`，旧 key 保留）
- [x] 4.3 验证缺少 Key 时 fail loud（清空所有 key 源 → `MISSING_CREDENTIAL`、退出码 1）

## 5. 错误契约

- [x] 5.1 把 DSH 退出码 / 输出映射到现有 `GenerateAiErrorCode`（`map_dsh_failure`：认证/超时/网络/配置缺失/服务）
- [x] 5.2 验证错误 `message` 不泄露 API Key、Authorization、请求正文或完整远端响应（单测覆盖）
- [x] 5.3 分别造认证失败、超时、网络失败、配置缺失、未知失败用例，确认映射到对应 `code`（单测覆盖）

## 6. 验证与收尾

- [x] 6.1 运行现有 Rust 测试，确认 Rust 对照路径仍全部通过（108 项全过；DSH 改动纯后端，前端未触及）
- [x] 6.2 DSH 路径等价性测试：首问、追问、错误映射各覆盖（首问/追问真机手工 + 错误映射单测）
- [x] 6.3 Windows 真机冒烟：DSH sidecar 实际生成成功响应，走通钥匙串
- [x] 6.4 记录 spike 结论（可行性 / 阻塞点），作为「一次性迁移到 DSH」的决策依据（结论见 design.md「验证结论」与 `docs/dsh-migration-spike.md`）
