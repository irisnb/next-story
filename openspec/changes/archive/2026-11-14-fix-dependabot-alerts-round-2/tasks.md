## 1. sidecar 依赖钉版

- [x] 1.1 `sidecar/package.json`：hono 覆盖 `^4.13.5` → `^4.13.16`、新增 `"@hono/node-server": "^2.1.6"`（范围式）；`npm install --prefix sidecar` 再生成锁文件
- [x] 1.2 验收断言：`sidecar/` 内 `npm audit` 报 0 漏洞；锁解析 hono ≥4.13.16、`@hono/node-server` ≥2.1.6；`@deepseek-ai/dsh` 仍 `0.1.2-rc.1`；锁文件 diff 人工核对无无关漂移
- [x] 1.3 双树干净安装复验：`npm ci --prefix sidecar` 与根 `npm ci` 均通过

## 2. 规格分支与挂账

- [x] 2.1 两份 delta 落盘：`rust-dependency-security-hygiene` 修复路径要求补「路径穷尽时有据挂账」第三分支（含场景）；`root-dev-dependency-hygiene` 新增「纯传递依赖跨大版本警报的挂账纪律」要求（含场景）
- [x] 2.2 `方向/行动计划-2026-08-27.md`：顶部记 2026-11-14 更新一条；长期账本 zip ×3 新增挂账行（证据链＋复评触发）、minimatch 行补 2026-11-14 复核（eslint 已升 ^11、typescript-estree 仍锁 ^10，纪律升格为规格）、docx-rs 行补复核结论（crates.io 仍 0.4.22，未满足）
- [x] 2.3 `AGENTS.md` 当前实现补记：2026-11-14 第二轮依赖警报——sidecar 侧钉版清偿、npm audit 归零；zip ×3 与 minimatch ×1 有据挂账待上游（见账本）

## 3. 门禁与真机冒烟

- [x] 3.1 `npm run check` 总门禁全绿（Rust 无改动照跑，证无连带；EXIT=0）
- [x] 3.2 真机 AI 冒烟（发布 v0.2.2 前置，用户参与）：首轮实测出现「追问不逐字＋卡顿」，经系统化排查（librarian 源码级排除库回归＋进程证据定位机器 CPU 争抢：开发 tsserver ≈1.3 核＋用户侧游戏 ≈2 核）后安静复测**通过**（原讨论追问＋新讨论两轮均逐字流式无卡顿）；结论＝环境假象非依赖回归，证据与教训记录于 verification.md

## 4. 归档与推送

- [ ] 4.1 `openspec validate` 通过后归档本 change
- [ ] 4.2 git-master 流程提交并推送
- [ ] 4.3 推送后复扫 GitHub Dependabot 开放警报实数（预期 11 → 4：剩 zip ×3、minimatch ×1，均有账可查；消警有延迟，按实际所见如实记录）
