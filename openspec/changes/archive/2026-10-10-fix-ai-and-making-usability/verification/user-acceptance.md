# 用户验收记录：fix-ai-and-making-usability

> 日期：2026-10-10。记录人：validation owner（归档 lane）。
> 本文件只记录用户本人的验收结论原话与残留边界；不改产品代码、不改 `openspec/specs/` 真相源内容本身（同步由归档命令执行）。

## 1. 用户原话（逐字）

> **「真机验收通过，归档，git push」**

- 含义：用户已在本机真实安装/运行修复后版本并完成整体真机验收，判定**通过**，并指示归档、随后由主助手提交推送。
- 本条只记录用户给出的**整体**结论，**不虚构**用户未逐项陈述的细节。

## 2. 关闭依据

- 8.2（真实 Windows 桌面验收）以**用户整体真机验收 ＋ 本 change 既有分层证据**关闭。
- 分层证据矩阵见 `verification/completion-evidence.md` §1；真机证据见 `verification/ui-acceptance/` 各记录；安装包构建证据见 `verification/package-build.md`（用户据此重装后测试）。
- 8.3（证据留存）与 8.4（归档同步）随本归档一并完成。

## 3. 残余未单独捕获项（如实保留，不虚构实测）

以下两项**未被单独逐场景真机捕获**，如实保留，不作为已实测项，也不改变用户整体验收关闭的结论：

1. 授权「底层挂起/取消/并发名额不变」与「拒绝 / 跨重启保留 / 讨论关闭授权开关」路径：仅单测或未测（`reading-auth.md` §8 自述只跑「允许」）。
2. `materials`/`stop` 真实显示态逐矩形几何：仅呈现 fixture（`batch2-runtime.md` §2.2）；真实 pending 截图仅证「停止」可见同排（`reading-auth.md` §7）。

此外，`card-delete-cancel-failure.md` §5 已自述：基线失效以隔离 fixture 注入（非多进程真并发竞态）、失败以受控只读 I/O（未覆盖磁盘满等其它 I/O 形态）。均如实标注。

## 4. 归档执行结果（官方命令，validation owner 记录）

- 命令：`npx openspec archive fix-ai-and-making-usability --yes`
- 退出码：**0**（成功）。
- 规格同步（应用主 spec）：`+4 added, ~7 modified, -0 removed, →0 renamed`
  - 新增（ADDED）：`agent-on-demand-reading`、`conversation-list`、`making-conversation`、`making-module-page`。
  - 修改（MODIFIED）：`conversation-list`、`frontend-ui-v5`、`controlled-story-read-visibility`、`selection-ai-summon`、`making-module-page`（2 处）、`chain-library`。
- 归档路径：`openspec/changes/archive/2026-10-10-fix-ai-and-making-usability/`（含 `.openspec.yaml`、`design.md`、`proposal.md`、`tasks.md`、`specs/`、`verification/`，全部保留，未删除）。
- 主动 change 列表：`No active changes found.`（fix-ai 已不在 active）。
- `npx openspec validate --all --strict`：**74 passed / 0 failed**，退出码 0。
- 归档后主 spec 需求数：`agent-on-demand-reading` 16、`conversation-list` 10、`making-conversation` 10、`making-module-page` 9（各 +1）；`chain-library` 6、`controlled-story-read-visibility` 10、`frontend-ui-v5` 5、`selection-ai-summon` 7（修改，数目不变）。
