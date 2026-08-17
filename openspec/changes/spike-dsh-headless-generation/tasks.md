## 1. 环境与版本锁定

- [x] 1.1 精确锁定 `@deepseek-ai/dsh@0.1.0-rc.7`（避开 `latest` 标签陷阱），记录到依赖清单
- [ ] 1.2 vendor Node 22.19+ 运行时与 `dsh` CLI 到应用资源目录
- [x] 1.3 搭一个最小 headless 调用通路：`dsh --profile headless "task"` 能拿到最终答案与退出码

## 2. Tauri 壳 sidecar 通路

- [ ] 2.1 Rust 壳实现 spawn dsh sidecar 进程，传入配置目录 / 模型名 / API 地址
- [ ] 2.2 实现退出码监控与异常重启（看守进程）
- [ ] 2.3 实现应用退出时回收 sidecar 进程（不残留孤儿进程）
- [ ] 2.4 实现 60s 生成超时的壳侧强制终止（沿用现有 `GENERATION_TIMEOUT_SECS` 语义）

## 3. 生成链迁移到 DSH

- [ ] 3.1 写最小 DSH 插件，承接结构化请求（复用现有 `FIXED_SYSTEM_PROMPT` + 消息构造）
- [ ] 3.2 首问：冻结选区 + 可选方向 → 生成等价响应（不代写、不评价、纯文本）
- [ ] 3.3 追问：完整消息轮次列表 → 生成等价响应（仍锚定首次冻结选区）
- [ ] 3.4 与 Rust 路径做 A/B 对照，用开关切换（默认仍走 Rust）

## 4. 凭据接缝

- [ ] 4.1 把 `dsh-credentials-keyring` 挂载进 DSH `ctx.credentials` 接缝
- [x] 4.2 真机验证：确认插件底层与 Rust 同一钥匙串槽位（`com.nextstory.desktop`）；因 `llm-api-key` 含连字符不合法，改一次性交接（已复制到 `DEEPSEEK_API_KEY`，旧 key 保留）
- [ ] 4.3 验证缺少 Key 时 fail loud（明确报缺，不静默假装成功）

## 5. 错误契约

- [ ] 5.1 把 DSH 退出码 / 输出映射到现有 `GenerateAiErrorCode` 六类（配置缺失 / 认证 / 超时 / 网络 / 请求过长 / 服务 / 响应无效）
- [ ] 5.2 验证错误 `message` 不泄露 API Key、Authorization、请求正文或完整远端响应
- [ ] 5.3 分别造认证失败、超时、网络失败、无效响应用例，确认映射到对应 `code`

## 6. 验证与收尾

- [ ] 6.1 运行现有 Rust 测试 + 前端测试 + 构建，确认 Rust 对照路径仍全部通过
- [ ] 6.2 DSH 路径等价性测试：首问、追问、错误映射各覆盖
- [ ] 6.3 Windows 真机冒烟：DSH sidecar 实际生成一次成功响应，走通钥匙串
- [ ] 6.4 记录 spike 结论（可行性 / 阻塞点），作为「一次性迁移到 DSH」的决策依据
