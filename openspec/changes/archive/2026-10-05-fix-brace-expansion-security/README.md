# fix-brace-expansion-security

定向修复根目录开发依赖 brace-expansion 5.0.9 → 5.0.12（GHSA-q2hr-2g5m-vwhr 等，high）：仅更新 root package-lock 并补充验证证据，不改产品功能。

状态：已完成并归档（2026-10-05）。8 项任务全部完成，验证通过（见 `verification/验证记录.md`）；delta spec 已同步为正式规格 `openspec/specs/root-dev-dependency-hygiene/spec.md`。验证时点未 commit、未 push；GitHub 远端告警关闭须待另行授权的提交推送并复扫后确认（历史时态，如实保留，不凭推测改称已关闭）。
