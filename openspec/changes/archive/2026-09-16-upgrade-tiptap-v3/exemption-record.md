# 依赖安全告警豁免记录（阶段一：Tiptap 2.27.3 垫底）

- 记录日期：2026-09-16
- 所属 change：`upgrade-tiptap-v3`
- 状态：**历史备注**。阶段二已于 2026-09-16 完成 3.31.3 迁移；迁移提交推送后，GitHub Dependabot 已自动关闭 `@tiptap/core` 警报。

## 背景

审计队列 5b（`方向/全量地基审计-2026-09-14.md` 第八节与补充六）确认编辑器内核 Tiptap 存在两个已公开漏洞，处置方案为一个 change 两阶段：阶段一升 2.27.3 安全垫底，阶段二全量迁移 3.31.3。本记录是阶段一期间的告警豁免依据与处置指引。

## 告警一：GHSA-c8x8-7fp4-3x9w（high，prosemirror-view 粘贴 XSS）

- **通报内容**：prosemirror-view < 1.42.3 在粘贴精心构造的 HTML 时可执行任意 JavaScript。
- **本仓库状态**：**已修复，且告警库已认账**。`@tiptap/pm@2.27.3` 依赖锁 prosemirror-view ^1.42.3；2026-09-16 实测锁文件由 1.42.2 升至 1.42.3（全树单一版本），`npm audit` 已不再报告本条。
- **处置**：无需豁免。预期 Dependabot 下一次扫描后警报自动消除；若未消除，以本记录为据在 GitHub 手动标记已解决。

## 告警二：GHSA-cp6q-959q-f8rh（medium，@tiptap/core mergeAttributes 原型污染）

- **通报内容**：`mergeAttributes` 把自有 `__proto__` 键转为可执行的原型继承 DOM 属性；告警库判定受影响范围为 `@tiptap/core <=3.30.3`。
- **本仓库状态**：**代码级已修复，但告警库未收录**。源码级比对（2026-09-16 调研，见审计文档补充六）实证 2.27.3 的 `mergeAttributes` 已含 `__proto__` 防护；但告警库未把 2.27.3 列为修复版，`npm audit` 对 2.27.3 持续报红。当前报告的 19 条 moderate 全部是本条经由各扩展包的传导（"Depends on vulnerable versions of @tiptap/core"），并非 19 个独立漏洞。
- **暴露面评估**：本地桌面应用，无外部监听面；粘贴全部经自研白名单管线（`handlePaste` 无条件返回 true，ProseMirror 默认粘贴管线不运行）；`mergeAttributes` 触发需要攻击者控制的属性键流入，本项目内容为用户自写 JSON 与自建粘贴字段，无触达路径。实际可利用性低。
- **处置**：阶段一期间豁免。**不得运行 `npm audit fix --force`**（会把整个内核强升到 breaking 的 3.x，绕过本 change 的迁移纪律）；推荐保持警报打开等阶段二随 3.31.3 自动消除，或以本记录为据 dismiss（理由选 not affected：修复已包含于 2.27.3 且无暴露面）。

## 补充事实

- CI 不运行 `npm audit`（已核实 `.github/workflows` 无 audit 门禁），红灯不影响任何流水线。
- 阶段二已迁至 3.31.3，本地 `npm audit` 为 0 vulnerabilities；本记录不再作为当前版本的豁免依据。2026-09-16 推送迁移提交后，GitHub Dependabot 开放警报由 3 条降至 2 条，`@tiptap/core` #1 已自动关闭；剩余两条为已另行判定处置的 `time` / `glib` moderate 警报。
