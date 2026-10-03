# fix-import-fidelity Design

## Context

oracle 审计证据（文件:行号，2026-10-02）：

1. **md 列表重排**（P1）：`md_import.rs:632–674,715–730`——列表项内的后续段落被软接合进首段、第二个及以后的嵌套子列表被移到**整个列表之后**。原顺序「父项A → 子项B → 续段C」变成「A+C → B」，无任何告知。
2. **docx 符号丢弃**（P1）：`docx_import.rs:391–393` 明确跳过 `Sym`——依赖侧 `docx-rs reader/run.rs:76–81` **已读取** `w:sym`（符号字体字符引用），我们拿到后扔掉且不计数。符号字符是可见文字，丢弃违反逐字保留。
3. **docx 样式链未生效**（P1）：`docx_import.rs:158–163` 只存样式 ID→名称；`:233,357` 只消费直接属性——docDefaults／`basedOn` 继承链／段落样式属性全部未合并。归档 design 承诺「docDefaults 基准字体字号＋缺漏计入告知」两项均未实现，还把丢弃合理化为「等价编辑器默认」。
4. **docx 编号错乱**（P1）：`docx_import.rs:62–87` 只读 abstractNum 层级起点；`:707–756` 同一编号列表被普通段落打断后**重新从同一起点建列表**。Word 语义：同 `numId` 计数跨打断持续、更浅层级出现时更深层级重置、`startOverride` 可覆盖起点——输出错号比降级更糟。

Word 编号语义依据（OOXML 标准模型，`w:num`→`w:abstractNum`，计数器按 (numId, ilvl) 维持，打断不重置；重开编号＝换 numId 或 startOverride）。真实测试样本：python-docx fixtures（MIT）之 `num-having-numbering-part.docx`／`sty-having-styles-part.docx`／`par-known-styles.docx` 恰好覆盖 3、4 号问题域。

## Goals / Non-Goals

**Goals:** 四项 P1 全修，每项先有复现测试；真实样本（含新入库的样式／编号真实 docx）回归零退步；新增告知走损耗清单不静默。

**Non-Goals:** 审计 P2 项（md HTML 实体／属性边角、未闭合 `<u>` 误伤、docx rightChars、atLeast 语义、损耗清单的样式／布局缺口）——记档待后续；不改导出侧；不动 fdx／md 其余行为。

## Decisions

### D1. md 列表溢出：保序就近降级（不重排）

语法对列表项的承载＝`[首段, 一个嵌套列表]`。溢出内容（项内后续段落、第二个及以后的子列表、子列表之后的内容）按**原文遍历顺序**在**该项结束处**降级为普通段落输出（继承该项可得的段落属性），随后才是下一个同级项——阅读顺序与源文件一致。溢出按元素计数入 `list_overflow_degraded`（note 区分段落／子列表）。仅在首个子列表之前尚无溢出内容时，首段＋首个子列表可留在列表项内；若续段先出现，后面的首个子列表也须就近拍平，不能回填到续段之前。空首段占位同样不得吸收已保留子列表或溢出内容之后的文字（能保真的保真，保不了的降级＋告知，顺序永不变）。

### D2. docx 符号：映射表＋诚实丢弃

`w:sym`＝`{font, char}` 字符引用（char 为十六进制，多在私用区）。建常用映射表（约 30 项）：Wingdings 常用（项目符 ▪•◦、箭头 →←⇒、勾叉 ✓✗、破折 —、方框 □■ 等）＋ Symbol 常用（±×÷∞、希腊字母等）。映射成功→插入对应 Unicode 字符（与转义还原同理，属忠实解码非改写）；映射失败→`symbol_dropped` 计数告知（note 含字体名）。映射表 `match` 常量，可随真实样本扩充。

### D3. docx 样式链：docDefaults＋basedOn 合并，未解析告知

导入开始构建样式上下文：`docDefaults`（rPrDefault 基准字体字号等；docx-rs 暴露面在任务 1.1 spike 验证，不足则走既有预扫描通道以 roxmltree 解 styles.xml）＋样式表（styleId→{basedOn, 类型, rPr, pPr}，环防护深度上限 8）。生效属性＝`docDefaults ← 段落样式链（basedOn 逐级）← 字符样式（rStyle）← 直接属性`（后者覆盖前者），字符属性（b/i/u/strike/color/sz/rFonts/highlight）与段落属性（jc/ind/spacing）分别合并后走既有映射器。链上存在但无法解析/映射的属性按出现次数计 `style_degraded`（note 说明来源样式）。撤销「等价编辑器默认」注释——现在要么真应用、要么真告知。

### D4. docx 编号：计数器跨打断续算

维持 `HashMap<(numId, ilvl), u64>`；遇带 numPr 段落：该级计数 +1，**更深层级计数清零**（嵌套重置）；普通段落打断**不**重置；`startOverride`（spike 验证 docx-rs 暴露，不足则预扫描 numbering.xml 以 roxmltree 解 `num→abstractNum` 与 `lvlOverride`）改写起点。输出：连续列表段输出为一个有序列表块；打断后重续时输出新块且 `start`＝当前计数值（语法已支持 start——md 往返 start=3 已证）。无法表达的情形（自定义 numFmt 等）沿用 `numbering_degraded` 降级。子弹列表不受影响。

## Risks / Trade-offs

- [docx-rs 暴露面不确定（Sym 字段形状／docDefaults／lvlOverride）] → 任务 1.1 spike 集中验证；兜底通道＝既有预扫描＋roxmltree（零新增依赖）。
- [样式链合并的正确性] → 真实样式样本（python-docx fixtures）驱动＋合成链状 fixture（祖孙三层 basedOn）单测；环防护。
- [编号语义边角（多 numId 并存／重启意图）] → 合成 fixture 矩阵单测（连续／打断／嵌套重置／startOverride／双列表交错）；重开编号在 OOXML 里本来就走新 numId——按文件事实，不猜意图。
- [符号映射表错映射风险] → 只收高置信常用符号；失败路径是诚实丢弃＋告知，宁缺毋滥。

## Migration Plan

纯缺陷修复，无数据迁移；已导入文档不受影响。回滚＝恢复旧行为（但四项修复各自独立成测试锚定的提交单元）。

## Open Questions

- 映射表的具体条目集在 review 时定稿（30 项上下，Wingdings/Symbol 为主）。
- `style_degraded` 的计数粒度（按段落/按 run/按属性种类）以实现自然粒度为准，note 说明来源——不追求精确到属性级的账单。
