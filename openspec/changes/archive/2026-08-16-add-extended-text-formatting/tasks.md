## 1. 格式版本 2：schema 与校验升级（地基）

- [x] 1.1 升级 `tests/fixtures/notebook-samples.json` 到版本 2 全集：新增下划线/删除线/textStyle（color/fontFamily/fontSize）/highlight（color）/link（href）的合法与非法形态、段落 attrs、三到六级标题、嵌套列表、版本 1 样例仍判合法、未来版本仍判非法
- [x] 1.2 前端 `src/structured-notebook.ts` 升级版本 2 grammar：mark rank 顺序（bold/italic/underline/strike/textStyle/highlight/link）、带属性 mark 校验、`listItem` 嵌套结构、`paragraph`/`heading` 可选段落 attrs、heading level 1–6
- [x] 1.3 前端 `canonicalMarks`/`canonicalTextNodes` 支持带属性 mark 的身份比较（type + attrs）与排序去重；`sameMarkSet` 按完整 attrs 比较
- [x] 1.4 Rust `src-tauri/src/project/notebook.rs` 同步升级版本 2 校验镜像，与前端共享同一组样例判定一致
- [x] 1.5 打开路径接受 `version` 为 1 或 2、统一按版本 2 校验；保存路径统一写 `version` 为 2；拒绝 `version > 2`
- [x] 1.6 前后端往返测试与共享样例两侧一致性测试通过（含 v1 样例在 v2 下合法、相邻不同 color 文本保持分离）

## 2. 字符格式

- [x] 2.1 添加并锁定 Tiptap 扩展版本：underline、strike、text-style、color、highlight、font-family、font-size
- [x] 2.2 扩展 `FormatCommand` 与 `runCommand`：下划线、删除线、文字颜色、背景高亮、字体、字号、清除字符格式
- [x] 2.3 扩展 `analyzeSelection`：下划线/删除线三态、颜色/字体/字号/高亮的混合与统一状态
- [x] 2.4 侧边抽屉「字符格式组」UI（下划线/删除线/字体/字号/文字颜色/高亮/清除字符格式），交由 @designer 出方向并实现
- [x] 2.5 快捷键 `Ctrl+U` 下划线；清除字符格式只移除字符标记、保留节点类型与段落属性
- [x] 2.6 字符格式相关测试：format-commands、rich-text-editor、保存重开保持一致、撤销重做覆盖

## 3. 段落格式与嵌套列表

- [x] 3.1 添加 TextAlign 扩展及行距、段前后间距、首行缩进、左右缩进的段落属性能力（自定义扩展或组合），锁定版本
- [x] 3.2 段落 attrs 的校验、规范输出与默认省略规则（textAlign/lineHeight/spacingBefore/spacingAfter/textIndent/indentLeft/indentRight）
- [x] 3.3 扩展 `analyzeSelection`：对齐、行距、段间距、缩进的统一与混合状态
- [x] 3.4 嵌套列表：`listItem` 支持 `paragraph + 嵌套列表` 结构；`Tab`/`Shift+Tab` 升降级；`list-numbering.ts` 递归化并保留各层实际编号
- [x] 3.5 `structured-notebook.ts` 的 `collectLines`（AI 快照）与 `format-commands.ts` 的 `collectBlocks`（工具栏状态）改为递归展开并记录嵌套深度
- [x] 3.6 侧边抽屉「段落格式组」UI（对齐×4/行距/段前后间距/首尾缩进/清除段落格式），交由 @designer 出方向并实现
- [x] 3.7 清除段落格式只重置段落属性并恢复正文、保留字符标记
- [x] 3.8 段落格式与嵌套列表测试：AI 快照缩进、部分选中、跨层选区、拆分编号保留、保存重开一致

## 4. 编辑效率：查找替换、链接、右键菜单、粘贴选项、性能

- [x] 4.1 查找与替换：查找栏、字面匹配、区分大小写开关、命中高亮（Decoration）、总数与序号、上一个/下一个、替换当前项、替换全部（单事务）
- [x] 4.2 链接：创建/编辑/移除/打开；点击不导航、弹层提供打开/编辑/移除；仅允许 http/https 通过系统默认浏览器打开
- [x] 4.3 桌面右键菜单：剪切/复制/粘贴/粘贴为纯文本 + 上下文相关的格式与链接命令，交由 @designer 出方向并实现
- [x] 4.4 粘贴选项：白名单扩展到本轮格式、嵌套列表按真实层级重建、`Ctrl+Shift+V` 与右键菜单粘贴为纯文本
- [x] 4.5 大型文档性能：建立带格式基准（如 20 万字符 + 混合格式），实测输入、滚动、查找、撤销重做、保存；必要时把完整序列化从编辑路径移到保存路径
- [x] 4.6 编辑效率相关测试：查找替换撤销、链接保存重开、右键菜单状态、粘贴两条路径

## 5. 验收与归档准备

- [x] 5.1 `npm run check` 全量通过（typecheck / lint / test:frontend / build / test:rust），任何既有无关失败单独记录
- [x] 5.2 Windows 桌面真机验收：中文输入、格式组合保存重开、撤销重做、嵌套列表、查找替换、链接、粘贴、大型文档，用户确认后才进入归档
