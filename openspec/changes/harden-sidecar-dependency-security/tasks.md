# 任务：sidecar 传递依赖安全整备

## 1. 钉版与锁文件

- [x] 1.1 在 `sidecar/package.json` 增加 `overrides` 字段，钉 5 个包到修复版范围：`fast-uri: ^3.1.6`、`js-yaml: ^4.3.2`、`sharp: ^0.35.4`、`hono: ^4.13.5`、`qs: ^6.16.0`
- [x] 1.2 删除 `sidecar/package-lock.json` 并在 `sidecar/` 内重新 `npm install` 重建锁文件
- [x] 1.3 在 `sidecar/` 内执行 `npm audit`，确认 0 条漏洞；如有残留，逐条处理（有修复版补钉 / 无修复版转任务 3.3）

## 2. 回归与真实链路验证

- [x] 2.1 跑离线三层回归：`npm run test:driver`、`npm run test:reliability`、`npm run test:validation`，全部通过
- [x] 2.2 真实链路 smoke：用已配置的智谱 `glm-5.3-flash` 完成一轮完整生成（重点观察 sharp 换版后原生模块加载无异常）
  - 验证记录（2026-09-16）：智谱端点（paas/v4，glm-5.3-flash 在可用名单）因钥匙持续 429 限流无法完成（该钥匙同时供 opencode 会话使用，配额撞满；codingpaas 端点对该钥匙整体 404）。改以 **DeepSeek 官方端点 `deepseek-flash` 完成**：12/12 全过（流式 delta、message_sent 回执恰一次且先于终态、多轮、replay、取消终态、干净退出、stderr 无 key 泄漏）。换包验证目标由此充分覆盖；智谱路径待配额恢复后可随时用 `sidecar/UPGRADING.md` 流程复跑。
- [ ] 2.3 推送后确认 CI（双平台）保持绿灯

## 3. 升级路径文档

- [x] 3.1 新建 `sidecar/UPGRADING.md`：写入五步 DSH 升级流程（改版本号 → 重建锁文件 → 全量回归 → audit 复查 → 清理/保留 overrides → 真实链路验证）
- [x] 3.2 在 UPGRADING.md 写明「overrides 与 DSH 版本正交」说明段，记录每条 override 的来源警报与清理条件
- [x] 3.3 在 UPGRADING.md 建立风险记录区（包名 / 警报编号 / 接受理由 / 复评条件）；当前 5/5 有修复版，预期为空区，写明使用规则

## 4. 收尾

- [ ] 4.1 更新 `方向/全量地基审计-2026-09-14.md` 第八节 3c 行状态为已归档，并同步处理进度注记
- [ ] 4.2 归档 change（openspec archive）
