# Tasks: 恢复 Dependabot 默认更新策略

## 1. 配置与规格

- [x] 1.1 `.github/dependabot.yml` 恢复为 2026-08-15 原始配置（npm/cargo 均 `interval: weekly`，无 ignore/groups/limit），并做 YAML 语法自检——与原始提交内容逐字节一致（ddf103a）
- [x] 1.2 确认改动范围仅此一文件，与 `ci-pipeline` 修订后的 Dependabot 要求一致

## 2. 验证与推送

- [x] 2.1 按 git-master 规范提交推送（中文提交信息）
- [x] 2.2 确认 CI 双平台绿灯（纯配置/文档改动，不应有任何门禁失败）——两分钟缓存命中即绿

## 3. 收尾

- [x] 3.1 归档本 change，同步 `ci-pipeline` 主规格（Dependabot 要求替换为周度默认策略版本）
- [x] 3.2 补注《方向/全量地基审计-2026-09-14.md》第八节插队行：「Dependabot 策略已于 2026-09-15 经用户决策回退为默认周度」；规格复验通过后提交推送
