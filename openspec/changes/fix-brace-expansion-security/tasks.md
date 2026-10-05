## 1. 定向更新锁文件

- [x] 1.1 记录基线：root `npm ls brace-expansion` 与 root `npm audit`（应见 brace-expansion 5.0.9 / 1 条 high）；确认 `git status` 起点状态
- [x] 1.2 在根目录执行 `npm update brace-expansion`
- [x] 1.3 审查 `git diff -- package-lock.json package.json`：仅 brace-expansion 5.0.9 → 5.0.12 相关条目变化，`package.json` 零变化；出现任何额外变动即停止检查、还原并重新评估（不使用 `npm audit fix` 回退——其影响面更宽，见 design 修订；禁止 `--force`）

## 2. 验证

- [x] 2.1 锁一致：`npm install` 后 `git status` 无新的锁变动（lock 与 registry 一致）
- [x] 2.2 root `npm ls brace-expansion` 显示 5.0.12；sidecar 目录 `npm ls brace-expansion` 确认不引入（预期空）
- [x] 2.3 告警消除：root `npm audit` 不再包含 brace-expansion 条目，并与 GHSA 官方修复版本对照（受影响区间 4.0.0 – 5.0.11，修复版 5.0.12）；sidecar `npm audit` 保持零漏洞
- [x] 2.4 `npm run check` 全门禁通过（typecheck → lint → test:frontend → test:reliability → test:driver → test:validation → build → fmt:rust → clippy:rust → test:rust）；lint 为直接消费路径、重点回归，其余为常规回归门禁
- [x] 2.5 汇总验证证据到本 change 的 verification 记录，如实注明：远端 GitHub 告警关闭须待另行授权的 commit / push 且复扫后确认，本轮不提交不推送
