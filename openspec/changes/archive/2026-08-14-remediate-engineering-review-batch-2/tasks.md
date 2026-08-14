## 1. API Key 系统凭据存储（P2-02）
- [x] 1.1 `llm_config` 新增 `SecretStore` trait + keyring 实现 + 内存 mock；`save_llm_config` / `load_llm_config` 走钥匙串，配置文件只存非敏感字段
- [x] 1.2 旧明文配置自动迁移 + 钥匙串不可用时的中文错误 + 相关测试

## 2. CSP 收紧（P2-05）
- [x] 2.1 去掉 `script-src 'unsafe-inline'` 与 `'wasm-unsafe-eval'`，保留 `style-src 'unsafe-inline'`

## 3. 依赖版本与审计（P2-06 / P2-07）
- [x] 3.1 npm + cargo 关键桌面框架钉到 minor（`~`），新增 Dependabot 周检
- [x] 3.2 `npm audit fix` 修复 nanoid / postcss 两个高危传递依赖

## 4. ESLint 门禁（P2-07）
- [x] 4.1 新增 eslint 9 flat config（范围 src/），修 src 问题，CI 加 lint 步骤

## 5. 项目版本迁移框架（P2-01）
- [x] 5.1 新增 `migration.rs`：迁移步骤抽象 + 备份 + 逐级迁移 + 校验 + 回滚；生产零迁移注册；接线打开流程
- [x] 5.2 合成迁移步骤的单元测试（成功/逐级/失败回滚/非法定义）

## 6. AI 面板状态机（P3-01）
- [x] 6.1 新增 `ai-panel-reducer.ts` 纯 reducer + 事件联合类型；`AiPanelState` 瘦身为 facade；对话状态改不可变
- [x] 6.2 公开 API 与行为零漂移，320 条前端测试零改动全绿

## 7. 文档与验证
- [x] 7.1 同步 index.html / README 密钥存储文案
- [x] 7.2 typecheck / lint / 前端测试 / rust test / clippy -D warnings / fmt / build 全部通过
