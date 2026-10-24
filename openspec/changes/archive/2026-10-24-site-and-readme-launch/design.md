# 设计：对外门面——官网、README 顶配与首个发布

## Context

仓库 `irisnb/next-story` 公开、无 LICENSE、无 Release、无 Pages；README 为 294 行纯文字开发说明，含多处事实错误（详见提案与勘误任务清单）。安装包 0.1.0 双格式已在本地（`src-tauri/target/release/bundle/`）。可用视觉资产：应用图标（`src-tauri/icons/icon.png`，双色几何）、鸢尾花手绘件（`src/assets/user-mark.png`，黑白扫描、有噪点、被 AI 发送按钮彩蛋引用，不可删改原文件）、UI v5 时期 13 个候选 logo 与界面原型图（`方向/前端UI暂存-2026-10-09/`，可参考）。维护者是非专业开发者，长期维护成本是最重要的约束之一。外部调研结论：README 照 Pake 模板、官网照 Joplin 首屏公式、下载用稳定名直链；官网仓置经用户拍板（2026-10-24）：主仓库不收任何网页文件，官网独立成仓（本地 `Wangye/`＋远程 `next-story-site`）。

## Goals / Non-Goals

**Goals:**

- 诚实好看的对外门面：README 顶配＋事实全部修正；官网单页中文上线
- 下载入口永远有效：首个 Release v0.1.0 ＋稳定名附件＋`releases/latest/download` 固定链接
- 品牌主视觉：应用现有几何图标两用（原双色版＋黑白版）；鸢尾花方案经用户过目撤出（2026-10-24），归档 `Wangye\_archive\` 不发布
- 长期维护成本最小：无构建链、无额外分支；主仓库与官网仓库互不混入、各自自包含
- LICENSE 声明：版权所有＋允许下载安装使用

**Non-Goals:**

- 不做多语言官网（中文为主，英文未来另议）、不买自定义域名、不买代码签名证书
- 不改产品任何行为、不动既有规格；不做 GIF 动图演示（静帧截图，未来可加）
- 官网不做多页/博客/文档站；不引入任何站点生成器（Astro/VitePress 等）

## Decisions

**D1 官网形态与仓置：独立官网仓库，整仓即站。**
本地工作目录 `D:\Next Story\Wangye\`（主仓库 `.gitignore` 忽略 `Wangye/`，永不进入主仓库），远程公开仓库 `irisnb/next-story-site`，GitHub Pages 从该仓库 main 分支根目录发布，地址 `https://irisnb.github.io/next-story-site/`。
理由：用户拍板主仓库不收网页文件；整仓即站连 `/docs` 子目录都省掉，上线即推送、回滚即 revert、下线即删仓。
命名映射（防双名分裂，一个概念一个名字）：中文统一「官网」；本地目录 `Wangye/`；远程仓库 `next-story-site`；线上地址 `irisnb.github.io/next-story-site/`。
替代方案：主仓库 `docs/`（用户否决——主仓库保持干净）、gh-pages 孤儿分支、Actions 部署、Netlify/Vercel 外部托管（多账号多维护面）——全部否决。

**D2 图片资产分仓自包含。**
官网图片随官网仓库（`Wangye/assets/` → `next-story-site`）；README 用图以副本放主仓库 `assets/`、相对路径引用（克隆可见、自包含）。代价：个位数图片两份副本，更新时两处同步（任务清单注明）。
替代方案：README 热链官网仓库 raw 地址（Pake 有先例）——单源但主仓库不自包含、官网仓库变动即断图，弃用。

**D3 下载直链机制：每个 Release 附稳定名副本 `NextStory-setup.exe`（NSIS 主推）与 `NextStory-setup.msi`（备选），另传默认产物名附件（含版本号）供溯源；对外入口一律 `releases/latest/download/<稳定名>`。**
理由：默认产物名带版本号，发版即失效；稳定名不含空格避免 URL 编码坑。Pake 同款做法。
替代方案：链接到 `releases/latest` 页面让用户自选（对小白多一步且文件名迷惑）；带版本直链（每次发版要改所有入口）。

**D4 品牌视觉：应用定案图标 04「开口」＋黑白配色体系（2026-10-24 用户过目后改向）。**
鸢尾花重绘方案经两轮观察员验收后交用户过目，用户撤下；文件归档 `Wangye\_archive\`（`Wangye\.gitignore` 排除，不进官网仓库），原手绘件始终未动。观察员进一步核查发现：512 `icon.png` 的双色弧是 Tauri 模板残留（当年图标变更明确「不覆盖」该文件），应用真实定案图标是 v3-04「开口」黑线稿（窗口/任务栏在用），SVG 源已在 `src-tauri/icon-sources/04-aperture.svg`。决定：品牌视觉直接采用 04「开口」（复制入 `Wangye\assets\`，不改动源文件），两版配色主题仅点缀色不同、图标恒为黑线稿。`icon.png` 512 模板残留已拍板（2026-10-24）：以定案图标 SVG 渲染 512 透明底 PNG 覆盖，随 5.2 重打包生效。

**D5 README 结构：Pake 式模板。**
居中鸢尾花标志＋定位语（「辅助剧本创作的陪想软件」口径）→ 徽章排（License：保留所有权利｜Platform：Windows｜Version：0.1.0｜Stack：Tauri·React·Rust）→ 真机截图 → 能力分区（写作空间/AI 陪想/制作模块/导入导出）→ 下载区 → 技术同行亮点（规格驱动开发：openspec 76 项已归档规格、全量门禁 CI）→ 勘误（按 explorer 九项清单执行，任务清单逐条列出）。

**D6 favicon：应用图标 32x32 复制到前端 `public/favicon.png`，`index.html` 加 `<link rel="icon">`。** 与门面品牌一致；不引入新依赖。

**D7 LICENSE 文本：简洁中文声明。** 版权所有 © 2026 irisnb；任何人可免费下载、安装、使用本软件与官网内容；未经书面许可不得复用、修改、再分发代码与文档或用于商业用途。

**D9 设计基准（2026-10-24 用户过目后提升）。**
现稿被用户评「平庸」，推倒重做。新基准来自 librarian 实测研究（Apple/Linear/Stripe/iA Writer/Ulysses/Bear/Craft 的可命名手法）：章节式全屏节奏（每节 90vh＋背景交替）、中文 hero 48–56px 手工断行宋体（每行 5–9 字）、发丝线＋四级灰阶层级、深色反转下载区（黑白对比即「墨」）、排版符号做图形（中文标点 8% 灰）、标题嵌黑线稿小图、截图平放不装饰、入场动效纪律（IntersectionObserver，0.6s expo-out，触发一次，尊重 prefers-reduced-motion）。约束不变：黑白纸墨、纯静态零构建链、系统字体栈（宋体标题/黑体正文/等宽点缀）、中文、两版点缀色（A 印章红/B 墨蓝）机制保留待拍板。

**D8 发布流程：** 资产 → `Wangye/` 官网＋README 重写 → LICENSE/favicon/清理 → `npm run check` 绿 → 完整打包（`npm ci --prefix sidecar` → `vendor-node` → `tauri:build`，确保与 main 一致，不用 10/23 陈旧产物）→ `gh repo create irisnb/next-story-site --public` 并推送 `Wangye/` → 在官网仓库开启 Pages（main 根目录，`gh api` 自动，失败给用户网页两步指引）→ 主仓库 `gh release create v0.1.0` 上传四附件 → 链接验证。版本号保持 0.1.0（首个对外发布）。

## Risks / Trade-offs

- [未签名安装包触发 SmartScreen 蓝色警告，吓退用户] → 官网下载区与 Release 说明注明「点『仍要运行』」属预期；签名证书年费高昂暂不购买
- [Pages 开启需仓库管理员设置，自动化可能失败] → 优先 `gh api` 自动开启（对象：官网仓库）；失败给用户两条路径的网页指引（官网仓库 Settings→Pages 选 main 分支根目录）
- [两仓图片为两份副本，可能失同步] → 更新图片的任务明确写「两处同步复制」；图片数量控制在个位数
- [`Wangye/` 是嵌套在主仓库文件夹里的独立仓库，怕误操作] → 已入主仓库 `.gitignore`，主仓库任何 git 操作都看不见它
- [重绘标志与原手绘气质偏差] → 原件不动；重绘版用户过目后才上线
- [README 相对路径图片在 npm 等第三方页面可能不渲染] → 本项目无 npm 分发，主场景是 GitHub 页面，接受
- [Release 上传 60–110MB 附件可能因网络失败] → 产物本地在盘，重试即可；附件上限 2GiB 远未触及
- [单页无构建链，未来扩展需手写 HTML] → 单页规模小可接受；如需多页另立 change

## Migration Plan

顺序：视觉资产（鸢尾花重绘、真机截图）→ `Wangye/` 官网＋README → LICENSE/favicon/脚手架清理 → 门禁绿 → 重打包 → 建官网仓库并推送 → 官网仓库开 Pages → 主仓库发 Release → 用户真机验收（官网预览、README 核对、下载走通）→ 归档。
回滚：主仓库改动走 git revert；官网仓库整仓删除即完全下线（或 revert 单次推送）；Release 可删除（删除会使已传播的下载链接失效，删除前须评估）。

## Open Questions

无阻塞项。鸢尾花重绘的具体配色与官网视觉细节由设计师出方案、用户过目，属实施环节而非设计分歧。
