# 验收记录：fix-dependabot-alerts-round-2（sidecar 依赖钉版＋两项有据挂账）

日期：2026-11-14。范围：GitHub Dependabot 开放警报 11 个——sidecar 钉版清偿 7 个（hono ×5、@hono/node-server ×2），zip ×3 与 minimatch ×1 有据挂账（规格分支＋长期账本），docx-rs 切回条件复核记录。

## 一、机器验证

- `sidecar/package.json` 覆盖：hono `^4.13.5` → `^4.13.16`、新增 `@hono/node-server ^2.1.6`；`npm install --prefix sidecar` 再生成锁文件。
- 断言：`sidecar/ npm audit` **0 漏洞**；锁解析 hono **4.13.18**、@hono/node-server **2.1.8**（均高于警报修复门槛 4.13.16／2.1.6）；`@deepseek-ai/dsh` 仍 `0.1.2-rc.1`；锁 diff 仅 2 文件 12 行（无无关漂移）。
- 双树干净安装复验：`npm ci --prefix sidecar` 与根 `npm ci` 退出码均 0。
- `npm run check` 总门禁全绿（EXIT=0；Rust 无改动照跑证无连带）。

## 二、真机 AI 冒烟（发布前置）——含一次排查插曲，如实记录

**第一轮（2026-11-14 16:0x，未通过）**：用户在 tauri:dev 真机实测，首轮流式正常，**追问轮出现「不逐字、成批呈现」且 UI 卡顿**。

按系统化调试流程做根因排查（未做任何代码改动）：

1. **库变更排除**（librarian 源码级查证）：hono 4.13.13→4.13.18 流式代码（streaming/streamSSE/StreamingApi）**逐字节相同**，五个版本全部是路由/校验层安全修复；@hono/node-server 2.1.5→2.1.8 区间内唯一碰流式的是 2.1.8 #417——**修掉** paced 流 Promise 无限堆积（改内存行为、不改送达时机，且该 bug 旧版就有）；两仓库均无「升级后成批到达」的已知报告。
2. **进程证据**：sidecar（node 30828）两轮采样 **0s/5s CPU**（空闲健康）；真正烧 CPU 的是开发工具链 tsserver（累计 1771s，采样 7.78s/6s ≈ 1.3 核）与用户同时运行的 League of Legends 进程族（约 2 核）；整机负载 42–63%。
3. **单变量复测**：停掉 tsserver（开发工具噪音），用户关闭游戏后原样复测——**通过**：原讨论追问＋新讨论首轮＋追问全部逐字流式、无卡顿。

**结论**：首测症状为**机器 CPU 争抢所致的环境假象**（游戏＋开发后台把事件处理挤慢），非依赖升级引入的回归；依赖升级被排除。冒烟判定通过，同时留档教训：**真机冒烟须在机器安静时进行，开发工具与游戏等重负载会制造假阳性**。

## 三、挂账与规格

- `rust-dependency-security-hygiene`：「修复路径」要求补第三分支（路径穷尽时有据挂账）＋场景；zip ×3 挂账入长期账本（证据链：tauri-plugin-updater 2.11.0 要求 zip ^4、上游稳定线止步 2.11.x 仅 3.0.0-alpha、先验签后解压 updater.rs:740→841；复评触发＝插件稳定版要求 zip ≥9 或随 tauri 2.12 升级）。
- `root-dev-dependency-hygiene`：新增「纯传递依赖跨大版本警报的挂账纪律」＋场景；minimatch ×1 复核（eslint 10.15.0 已要求 ^11.0.5，typescript-estree 8.72.2 仍锁 ^10.2.2，警报暂不可消）挂账入长期账本，复评触发＝typescript-eslint 发布要求 minimatch ^11 的版本。
- docx-rs 切回条件复核：crates.io 官方最高仍 0.4.22（2026-11-14 查），未满足，git 钉 rev ad7fede6a7 继续有效。
- 账本（方向/行动计划-2026-08-27.md）：顶部 2026-11-14 更新一条；长期账本 zip 新增一行、minimatch 行补复核、docx-rs 行补复核。

## 四、远端警报复扫

推送后复扫 GitHub Dependabot 开放警报（预期 11 → 4：剩 zip ×3、minimatch ×1；Dependabot 消警有延迟，按实际所见记录）：**待推送后回填**。
