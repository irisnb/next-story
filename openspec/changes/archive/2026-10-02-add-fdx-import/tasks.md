# add-fdx-import Tasks

## 1. Spike 与依赖

- [x] 1.1 roxmltree 0.20 入依赖；两真实样本入库 `src-tauri/tests/fixtures/fdx/`；spike 全部实证——根元素三属性（V1/V3 双版本解析通过）、Type 全集＋195 个无 Type 段落的上下文来源、**`Text@Style` 属性 `+` 分隔词组编码**（Bold/Italic/Underline/AllCaps）、DualDialogue 包裹结构与 ScriptNote 段内嵌套、段落布局属性＝默认值回声（忽略）、Number 仅限 Scene Heading 读取（设置段污染实证）——详见 design.md Spike 补记

## 2. Rust fdx 解析与映射

- [x] 2.1 `.fdx` 识别全项：.fdr 中文拒绝（「请在 Final Draft 中打开并另存为 .fdx 后导入」）、BOM 剥离、UTF-8、XML 良构＋根元素校验、16MB 上限——`fdx_import.rs` 69–95
- [x] 2.2 段落类型映射全表：Scene Heading/Shot→heading 2＋Number 并入（仅 Scene Heading 读取，Action「123」污染实证不读）、New Act→heading 1、Outline N→clamp、Character/Dialogue→2em 缩进、Parenthetical→3em、Transition→右对齐、未知兜底 paragraph；`Text@Style` 词组→bold/italic/underline（AllCaps/未知词忽略不计损耗）；Text 内换行拆同属性相邻段落（真实 fixture 实证的 pretty-print 回声）
- [x] 2.3 结构性降级：DualDialogue 拆先后两组（括注随组、包裹段剧注计数）；TitlePage 文字逐段并入开头（空段丢、HeaderAndFooter 页面家具跳过防页码点号入正文）
- [x] 2.4 元数据丢弃计数：SceneProperties（含 Summary/SceneArcBeats）×30、ScriptNote×14（12 段内嵌＋2 未锚定）、修订体系×19（RevisionID=0 默认不计）、机器家具（含 ListItems/Beat Board 测试杂项）无感
- [x] 2.5 拆分建议复用（场景头标记识别用无编号前缀文本——编号不阻断集数序列；正反例与带编号集数测试）
- [x] 2.6 canonical v2＋严格校验（preview 自检＋commit 逐份＋fixture 端到端断言）；generator 印记＝`FinalDraft Version=…, DocumentType=…`

## 3. 管线接入与命名清理

- [x] 3.1 `import_document_*` 加 `.fdx`/`.fdr` 分发；Rust 全量 **510 passed 0 failed**（484 基线零回归）
- [x] 3.2 word→document 机械重命名（前端车道完成）：`src/word-import.ts`→`document-import.ts`、两个测试文件、DOM id（`fm-import-word`→`fm-import-document`、`word-import-*`→`document-import-*`）、符号与 CSS 类；旧名残留扫描零命中；`hash_mismatch:` 协议与行为逐字不变
- [x] 3.3 失败路径中文可读、稳定（.fdr／编码／超限／畸形 XML／错根；无 panic、无半成品）

## 4. 前端

- [x] 4.1 过滤器三扩展名（docx/md/fdx），过滤器名「Word / Markdown / Final Draft 文档」，逐字断言
- [x] 4.2 损耗标签表扩至 18 项：双栏对白拆为先后段落／标题页并入正文开头／场景元数据丢弃／剧注丢弃／修订标记忽略（文字无损）——编排者复核通过
- [x] 4.3 命名清理前端同步（契约字段、harness、断言全部随迁）；.fdx 不加说明行（理由：fdx 一切非忠实映射均已入损耗清单，说明行只重复清单——诚实已在清单，路径不加步）；前端 **1181/1181 全过**（含测试桩概念残留修正）

## 5. 测试与验收

- [x] 5.1 映射规则单测 21 项：Type 全集、Outline clamp/非法、Number 并入与污染不读、DualDialogue（含括注随组/包裹段剧注）、TitlePage（并入/空段/页眉跳过/无 TitlePage 反例）、修订（定义＋行内＋RevisionID=0 不计）、Style 词组全组合、未知容忍、.fdr/畸形/错根/非 UTF-8/超限/BOM 拒绝、换行拆分三形态、集数正反例、严格校验
- [x] 5.2 真实 fixture 端到端：storyboarder 样本（167KB，FD Version 3）全量导入——**独立 oracle 二次遍历 XML 求期望块序列，487 块逐块逐字一致**、字符 19,251 三方断言、损耗清单双重锚定（oracle＋spike census：1/1/30/14/19）；screenplain 双栏样本拆分顺序（GIRL→Hey!→GUY→Hello!）断言
- [x] 5.3 合成样本：集数场景头拆分（≥3 触发/不足不触发/带编号仍识别/按边界落盘）、混合格式齐套、既有文档逐字节不变
- [x] 5.4 真机冒烟（账本第 21 条）：CDP 全链路零产品缺陷——fdx 预检与 oracle 逐项精确一致（19,251 字/487 段/五类损耗/版本印记）；**.fdr 拒绝文案精确**；docx 回归 55,331 字/61 标记/WPS 印记；md 金样本零损耗复验；整文件提交落盘；树与编辑器渲染（标题页并入段 FARMLAND、场景头 EXT、20,370 字）；word→document 重命名后命令注册面真机确认。截图存 `%TEMP%\opencode\smoke-import\`（fdx-01~03）。验证记录见本 change `验收记录.md`
- [x] 5.4b 追加实机轮（用户指令）：预检对话框首次真机打开（服务注入）——fdx 五项损耗逐条渲染、md 说明行、拆分默认不拆、**哈希不一致循环真改文件触发**（留场提示＋自动重预检＋字数联动）、确认按钮真实提交；原生文件框 SendKeys 突击失败（唯一待用户环节）。截图 dlg-01~05

## 6. 交叉验证轮（用户验收质疑触发，2026-10-02 晚）

- [x] 6.1 缩进保真修正：ElementSettings 成为布局权威（对齐三态含 Full→justify、相对缩进按文件基准换算、FirstIndent→textIndent 含悬挂）；回退固定档相对顺序修正（Dialogue 2em／Parenthetical 3em／Character 4em＝1:1.5:2，修正原倒挂）；Transition 只消费对齐。librarian 双样本交叉验证语义：ParagraphSpec＝纸张左缘英寸绝对坐标、PageLayout 用磅、Alignment 全集 Left/Center/Right/Full、用户自定义版式随文件落盘（rsdoiel 基准 1.25" 实证必须读文件值）
- [x] 6.2 oracle 独立审计五项 fdx 修复：显式 Left 不再误触转场右对齐回退；未知元素计数落实（新 kind `unknown_element_skipped`，note 含去重元素名；顺修 ElementSettings 误计未知 bug）；TitlePage 段落对齐保留；Text 显式 Font/Size/Color→textStyle（48bit 色截 RGB；类型级 FontSpec 仍按回声不搬运）；首行行首空白保留（indentation 样本实证作者语义）
- [x] 6.3 多样本交叉验证：edge/ 五份 MIT 边角入库测试（BOM 剥离路径——上游文件实无 BOM 由测试前置字节驱动；前导空格逐字；多语种；回退档序；强制分段）；本地三份实测（许可证原因不入库）——rsdoiel×2 自定义版式（基准 1.25" 缩进换算正确：Character 180pt/Dialogue 94.32pt/Parenthetical 悬挂 −7.2pt）、Big-Fish V1 435KB 疑似真实 FD8 压力（141,883 字/2,780 块；预检 31ms/提交 112ms/落盘 797KB 过严格校验）。**Version 5 真实样本公开渠道不存在——待用户 FD12/13 导出补齐（已记录最大空白）**
- [x] 6.4 前端损耗标签表同步 `unknown_element_skipped`（19 项；1181 测试全绿）
- [x] 6.5 测试基线：510→528 passed 0 failed（缩进修正＋审计修复＋边角集，零回归）；oracle 对 docx/md 的审计发现（4 项 P1＋多项 P2）记档待另立 change 修复（见 design.md 交叉验证轮补记第 6 条）
