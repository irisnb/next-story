# Tasks: switch-to-mit-license

## 1. 许可文件与对外口径

- [x] 1.1 将 `LICENSE` 整体替换为标准 MIT 许可证原文（英文通行文本，一字不差），版权行 `Copyright (c) 2026 irisnb`，不附加翻译或条款
- [x] 1.2 修改 `README.md`「协作与协议」区为 MIT 口径（可自由使用、修改与再分发，含商业用途，需保留版权与许可声明），同区保留用户内容归属声明，徽章排增加 MIT 徽章
- [x] 1.3 修改 `docs/ARCHITECTURE.md` 许可表述（现「保留所有权利……不得复用、修改、再分发」处）为 MIT 口径，与 README 等价

## 2. 决策记录与清扫核对

- [x] 2.1 在 `方向/行动计划-2026-08-27.md` 账本新增许可拍板记录：从「保留所有权利＋允许使用」改为 MIT，理由＝大大方方给大家用（含改完当自己产品、闭源商用均可），单向门知情确认
- [x] 2.2 检索核对活文档（`README.md`、`docs/`、Release 流程相关模板）确认「保留所有权利／未经书面许可」口径清零；`openspec/changes/archive/` 与 `方向/` 历史引用不改写
- [x] 2.3 核对第三方许可文本原样在场（`public/fonts/LICENSE.txt`、Basecoat LICENSE 等），确认无因主许可切换产生的改动

## 3. 验证

- [x] 3.1 `npm run check` 全绿（纯文档级变更的例行卫生确认；已核对 tests/ 无 README/LICENSE 内容断言）——首跑被既有测试夹具日期过期阻塞（诊断与修复见 verification.md），修后复跑 exit=0
- [ ] 3.2 GitHub 仓库页许可识别复查：本地提交后 `gh repo view --json licenseInfo` 应显示 MIT（或注明缓存延迟，发布前复查）——当前仍显示 Other，待提交推送后复查
- [x] 3.3 官网仓库许可表述人工核对（独立仓库，不在本 change 代码范围）：已核对，官网页脚为旧口径「保留所有权利；可下载安装使用」，结果记入 verification.md，发布前在官网仓库同步为 MIT 口径
