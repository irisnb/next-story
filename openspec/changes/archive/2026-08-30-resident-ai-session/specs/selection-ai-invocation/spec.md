# selection-ai-invocation 变更增量

## MODIFIED Requirements

### Requirement: 召唤时冻结与编辑器实现解耦的选区快照
系统 SHALL 在用户提交附带选区的直接提问时，冻结本次选区的本子类型、Tiptap 有序选区位置和由该结构化选区切片生成的纯文本 `selectedText`，并 SHALL 让后续 AI 链路只依赖冻结的 `selectedText` 而不是 Tiptap/ProseMirror 实例。投影 MUST 只保留实际选中的可见文字，并用单个 LF 表示每个相邻块边界，空段落 MUST 表示为空行。投影结果 MUST NOT 以 LF 开头（不生成前导换行），也 MUST NOT 以 LF 结尾（不生成尾随换行），无论选区是否从块起点开始或在块终点结束。若选区包含一个非空列表项的全部可见文字，则该项行 MUST 以 `- `（无序）或其实际编号加 `. `（例如 `3. `）开头；"全部"只要求该项所有可见文字均在有序选区内，不要求额外选中不可见节点边界。嵌套列表项在投影时 MUST 先按嵌套深度输出 `2` 个空格 × 深度的缩进，再接列表前缀与文字；顶层深度为 0 不缩进。空列表项不生成前缀，只保留其块边界。部分列表项选区 MUST NOT 补充前缀、缩进、未选文字或其它结构信息。相邻列表、列表与正文及普通段落之间均只使用上述单个 LF 连接，不额外插入空行。投影 MUST 丢弃标题等级、粗体、斜体、下划线、删除线、文字颜色、背景高亮、字体、字号、链接、段落属性和 JSON 结构，且 MUST NOT 静默裁剪或改写文字。选区位置只用于本次应用打开周期内的来源和界面锚定，MUST NOT 持久化或用于请求时重新读取当前编辑器。

#### Scenario: 冻结草稿本结构化选区
- **WHEN** 用户在草稿本选中"背叛"并提交附带该选区的直接提问
- **THEN** 系统冻结一个标记为草稿本且 `selectedText` 为"背叛"的选区快照
- **AND** 快照记录冻结时的 Tiptap 有序选区位置

#### Scenario: 请求期间改变编辑器
- **WHEN** 用户已经提交一个冻结快照
- **AND** 用户随后编辑文字或格式、改变选区或切换本子
- **THEN** 已提交请求继续使用原冻结 `selectedText`
- **AND** 系统 MUST NOT 从当前位置重新读取或替换原选区

#### Scenario: 投影段落和行内格式
- **WHEN** 有效选区包含标题段落、正文换行、粗体、斜体、下划线、颜色、中文、emoji 或前后空格
- **THEN** `selectedText` 保留实际选中的可见文字、空格、标点、emoji、段落和换行
- **AND** `selectedText` 不包含标题等级、任何字符标记、段落属性或 JSON 表示

#### Scenario: 投影完整无序列表项
- **WHEN** 有效选区包含多个无序列表项的全部文字
- **THEN** `selectedText` 按显示顺序使用 `- 第一项\n- 第二项` 的形式保留项目

#### Scenario: 投影完整有序列表项的实际编号
- **WHEN** 有效选区包含有序列表中显示为第 3 项和第 4 项的全部文字
- **THEN** `selectedText` 使用 `3. 第三项\n4. 第四项` 的形式保留实际显示编号
- **AND** 系统不把所选片段重新编号为 1 和 2

#### Scenario: 投影嵌套列表层级缩进
- **WHEN** 有效选区包含一个父级列表项及其下的两个子级列表项的全部文字
- **THEN** `selectedText` 使用 `- 父项\n  - 子项一\n  - 子项二` 的形式（子级每行缩进两个空格）保留层级

#### Scenario: 只选择列表项中的部分文字
- **WHEN** 用户只选择有序列表第 3 项中间的一个词
- **THEN** `selectedText` 只包含该词
- **AND** 系统不补充 `3.`、缩进、该项其它文字或其它列表结构

#### Scenario: 从列表项中间跨到正文
- **WHEN** 选区从一个列表项中间开始并跨到后续正文段落中间结束
- **THEN** `selectedText` 只保留实际选中的文字和跨段换行
- **AND** 未完整选择的列表项不附加项目符号、编号或缩进

#### Scenario: 完整列表项连接后续正文
- **WHEN** 选区完整包含显示为第 3 项的"选择"并继续包含下一正文段落"代价"
- **THEN** `selectedText` 为 `3. 选择\n代价`
- **AND** 列表与正文之间不额外插入空行

#### Scenario: 选区跨过空段落或空列表项
- **WHEN** 有效选区跨过一个空段落或空列表项
- **THEN** `selectedText` 在对应块位置保留一个空行
- **AND** 空列表项不生成 `- `、编号前缀或缩进

#### Scenario: 选区恰好从块边界开始或结束
- **WHEN** 有效选区恰好从第一段起点开始并在最后一段终点结束
- **THEN** `selectedText` 不包含前导 LF 也不包含尾随 LF
- **AND** 相邻块之间恰好有一个 LF

#### Scenario: 正向与反向选择得到同一冻结内容
- **WHEN** 用户分别用正向和反向操作选择同一结构化范围
- **THEN** 两次快照得到相同的 `selectedText` 和有序选区范围
- **AND** 选择方向只影响待附带提示的显示，不影响冻结内容

#### Scenario: 后续追问不重新发送选区
- **WHEN** 首次回应后用户在当前临时对话中追问
- **THEN** 后续请求不重新发送选区材料
- **AND** 系统不读取当前本子的新内容、格式或 JSON
- **AND** 会话继续基于首轮冻结材料回答

### Requirement: 选区快照本子类型代码标识唯一
系统在选区快照中记录的本子类型代码标识 SHALL 仅为 `draft` 或 `main`，并 MUST 分别且仅对应草稿本与正文本。系统 MUST NOT 使用 `manuscript`、`screenplay` 或其它第二英文名标识正文本。标签页当前本子标识与快照中的本子标识 MUST 使用同一套代码值，MUST NOT 依赖「UI 一套名字、快照另一套名字」的翻译层作为长期设计。

#### Scenario: 草稿本选区快照使用 draft
- **WHEN** 用户在草稿本形成有效选区并提交附带该选区的直接提问
- **THEN** 冻结快照的本子类型代码标识为 `draft`
- **AND** 该标识与草稿本标签页所用代码值一致

#### Scenario: 正文本选区快照使用 main
- **WHEN** 用户在正文本形成有效选区并提交附带该选区的直接提问
- **THEN** 冻结快照的本子类型代码标识为 `main`
- **AND** 该标识与正文本标签页所用代码值一致
- **AND** 快照 MUST NOT 使用 `manuscript` 标识正文本

#### Scenario: 禁止为本子维护第二套英文 ID
- **WHEN** 实现或评审选区适配、快照类型或直接提问附带代码
- **THEN** 不得引入仅用于「把 main 翻译成另一正文本英文名」的映射作为正式本子 ID 体系
- **AND** 产品中文名仍为草稿本与正文本，代码标识不替代中文产品名

#### Scenario: 快照本子标识不进入模型请求
- **WHEN** 用户基于草稿本或正本选区提交附带选区的直接提问
- **THEN** 前端可以在运行期快照中记录 `draft` 或 `main` 以识别选区来源
- **AND** 模型请求仍只使用已确认范围内的选区原文与当前问题
- **AND** 不得因为本子代码标识统一而向模型新增本子类型、附近上下文、全文、摘要或作品信息

#### Scenario: 统一命名不改变 AI 边界
- **WHEN** 正文本选区快照的本子标识从 `manuscript` 统一为 `main`
- **THEN** AI 回复仍只能显示在 AI 面板中作为临时材料
- **AND** 系统仍不得提供把 AI 内容直接插入、追加、替换、改写、删除或移动到草稿本或正文本的入口

## REMOVED Requirements

### Requirement: 有效选区显示 AI 开启入口
**Reason**: 旧选区工具（`AI 及时召唤`、`思维扩展`）随常驻会话改造退场，选区浮动 AI 入口及其小菜单一并退场。
**Migration**: 选区作为直接提问的可选重点提示自动附带，见 `persistent-ai-panel-entry`。

### Requirement: 浮动入口跟随活选区生命周期
**Reason**: 浮动入口随旧选区工具退场。
**Migration**: 无替代入口；选区附带语义见 `persistent-ai-panel-entry`。

### Requirement: 长文本选区入口更新保持可用性能
**Reason**: 浮动入口退场，其几何定位性能要求随之失效。
**Migration**: 无。

### Requirement: 首版请求只使用选区和固定思考任务
**Reason**: `及时召唤` 的固定思考任务随工具退场；其陪想姿态要求（区分观察与可能解释、不代写、不裁判）已并入 `dsh-headless-generation` 的生成链等价要求。
**Migration**: 见 `dsh-headless-generation`（DSH headless 生成与现有链等价）。

### Requirement: 召唤入口不接收初始问题
**Reason**: 浮动入口与 `及时召唤` 退场；直接提问本身即以问题为输入。
**Migration**: 见 `persistent-ai-panel-entry`。

### Requirement: 新召唤接受后替换当前临时对话
**Reason**: 旧选区工具退场；"新的首轮请求被接受时替换当前临时对话"已由 `ai-thinking-panel`（面板使用可替换的当前临时对话策略）覆盖。
**Migration**: 见 `ai-thinking-panel`。

### Requirement: 同一时间只允许一个 AI 请求
**Reason**: 该要求已由 `ai-feature-orchestration`（同一时刻只允许一轮请求）与 `ai-thinking-panel`（同一作品仍只允许一个请求）覆盖，本能力不再单独持有。
**Migration**: 见 `ai-feature-orchestration`、`ai-thinking-panel`。

### Requirement: 及时召唤不得静默停在首次预览态
**Reason**: `及时召唤` 退场；"请求未发出状态显式呈现"的通用要求已由 `ai-thinking-panel`（面板显式呈现首次请求未发出状态）覆盖。
**Migration**: 见 `ai-thinking-panel`。
