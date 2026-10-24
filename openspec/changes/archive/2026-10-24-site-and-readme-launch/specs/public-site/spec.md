# Delta：public-site

## ADDED Requirements

### Requirement: 官网部署与地址
官网 SHALL 为纯静态单页，发布于官网专用仓库 `irisnb/next-story-site`（整仓即站，main 分支根目录）；官网本地工作目录 MUST 为主仓库下的 `Wangye/`（独立 git 仓库，被主仓库 `.gitignore` 忽略，网页文件 MUST NOT 进入主仓库）；对外地址 MUST 为 `https://irisnb.github.io/next-story-site/`；页面内资源引用 MUST 使用相对路径以兼容子路径部署。

#### Scenario: 访问官网
- **WHEN** 访问 `https://irisnb.github.io/next-story-site/`
- **THEN** 返回官网单页，样式与图片均正常加载，无资源 404

#### Scenario: 内容更新上线
- **WHEN** 官网仓库 main 分支内容更新并推送
- **THEN** 官网在 GitHub Pages 下次部署后呈现更新内容

#### Scenario: 主仓库保持干净
- **WHEN** 检查主仓库的文件清单
- **THEN** 不含任何网页文件（`Wangye/` 被忽略）

### Requirement: 首屏构成与界面画廊
官网首屏 SHALL 突出三要素——中文口号、一句白话定位说明、Windows 下载按钮；MUST NOT 出现注册、账号、术语墙等抬高门槛的元素。首屏 SHALL 以大尺度排印呈现「大气」的第一印象：标题字号数倍于正文、各元素与间距成比例放大、以尺度填满视口而非留白（2026-10-24 用户拍板：第一页要大气，不要小）。真机界面截图 SHALL 以按需展开的界面画廊呈现：默认收起、用户主动打开才查看；画廊入口 SHALL 置于页面底部、深色下载区之上，MUST NOT 出现在首屏或其后的显要位置（2026-10-24 用户拍板：不前置、放最下面）。

#### Scenario: 首屏三要素
- **WHEN** 打开官网首屏
- **THEN** 可见远大于正文尺度的口号、一句白话说明与下载按钮，无注册或账号入口，无截图框

#### Scenario: 界面画廊在底部按需展开
- **WHEN** 滚动到页面底部深色下载区上方，点击查看软件界面的入口
- **THEN** 画廊展开显示真机截图，再次操作可收起

### Requirement: 下载入口指向
官网下载按钮 SHALL 指向主仓库 `irisnb/next-story` 的最新版固定链接（`https://github.com/irisnb/next-story/releases/latest/download/NextStory-setup.exe`）；在主仓库没有任何可用 Release 的过渡期，SHALL 指向主仓库 `/releases` 页面并注明「即将发布」；MUST NOT 放置会 404 的直链。

#### Scenario: 已有 Release
- **WHEN** 点击官网下载按钮且已存在 Release
- **THEN** 开始下载最新 Release 的稳定名 NSIS 安装包

#### Scenario: 无 Release 过渡期
- **WHEN** 首个 Release 尚未发布
- **THEN** 下载入口跳转 releases 列表页并标注即将发布，不出现 404

### Requirement: 视觉主元素与语言
官网 SHALL 以应用定案图标 04「开口」黑线稿（源 `src-tauri/icon-sources/04-aperture.svg`）为品牌主视觉；页面配色 MUST 以黑白为主、点缀色克制（点缀色经用户过目拍板）；官网语言 MUST 为中文。

#### Scenario: 主视觉呈现
- **WHEN** 浏览官网
- **THEN** 04「开口」黑线稿图标作为品牌主视觉出现，页面以黑白为主、点缀色克制，文案为中文

### Requirement: 文案口径
官网文案 MUST 遵守项目宪法：只讲降低起步与求助门槛，MUST NOT 出现能力或结果承诺（如「保证写出好故事」「替代创作」）；AI 相关表述 MUST 保持「陪想／观察／问题／可能性」口径；定位语 MUST 与「辅助剧本创作的陪想软件」一致。

#### Scenario: 宪法口径审查
- **WHEN** 审阅官网全部文案
- **THEN** 无能力或结果承诺表述，定位语与「辅助剧本创作的陪想软件」口径一致

### Requirement: 截图真实性
官网展示的界面图 MUST 为真机运行截图，MUST NOT 用设计稿原型图冒充。

#### Scenario: 截图来源核对
- **WHEN** 核对官网界面图
- **THEN** 每张界面对应真机运行界面，而非 UI v5 设计稿原型图
