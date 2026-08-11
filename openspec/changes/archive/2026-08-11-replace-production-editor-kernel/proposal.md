## Why

当前生产编辑器由两个原生 `textarea` 承载，虽已支持纯文本写作、保存和选区 AI，但后续可靠的文字处理能力需要成熟的编辑器事务、选区、输入法和撤销重做基础。隔离原型已证明 Tiptap/ProseMirror 能在 Windows Tauri 2 / WebView2、微软拼音和 20 万字文本下满足关键门槛，因此现在应先完成一次不改变作品格式和产品范围的等价内核迁移。

## What Changes

- 用 Tiptap（底层为 ProseMirror）替换草稿本和正文本的原生 `textarea`，继续提供纯文本输入、删除、换行、光标移动、鼠标与键盘选区。
- 正式验证中文输入法组合输入、复制、剪切、纯文本粘贴、撤销重做和常见桌面快捷键。
- 保持 `draft` / `main` 双本子、标签切换、手动保存、未保存判断、并发保存期间继续输入、离开保护和保存失败语义不变。
- 保持前后端 `draft` / `main` 两个完整纯文本字符串的打开与保存契约，磁盘事实源仍为 `作品文本/草稿本.txt` 和 `作品文本/正文本.txt`；旧项目无需迁移。
- 将选区快照捕获和 AI 浮动入口定位从 `textarea` 专属接口迁移到 Tiptap/ProseMirror 的选区与坐标能力，同时保持点击时冻结原文、本子类型和起止位置的现有语义。
- 针对中文、emoji、换行、正向与反向选区、滚动、窗口变化和 20 万字文本补充自动化与 Windows 桌面真机验收。
- 不开放标题、粗体、斜体、列表或任何富文本工具栏，不引入结构化作品存储、项目格式升级或旧项目迁移。
- AI 继续只在两个本子之外提供临时材料，不获得写入、插入、替换、删除、移动或整理草稿本和正文本字符的能力。

## Capabilities

### New Capabilities

- `production-editor-kernel`: 规定 Tiptap/ProseMirror 作为生产编辑器内核时的纯文本等价行为、中文输入、剪贴板、撤销重做、长文档性能和桌面验收门槛。

### Modified Capabilities

- `writing-notebooks`: 明确双本子在新内核下仍以完整纯文本参与切换、脏状态、保存快照和重开，并保持保存期间后续编辑不被误标为已保存。
- `selection-ai-invocation`: 将写死的 `textarea` 选区方向、生命周期和镜像坐标要求改为与具体编辑控件解耦的 Tiptap/ProseMirror 选区及几何要求，同时保持冻结快照和 AI 使用边界不变。

## Impact

- 前端将新增 Tiptap/ProseMirror 生产依赖，并调整编辑器创建、销毁、标签切换、内容同步、样式和测试装配。
- 主要受影响代码包括 `src/editor.ts`、`src/dom.ts`、`src/selection-adapter.ts`、`src/selection-entry.ts`、`src/caret-coordinates.ts` 及其相关测试；`EditorSaveState` 与离开协调器的核心字符串语义继续复用。
- 前端与 Rust 的项目打开、保存 IPC 契约以及 `src-tauri/src/project/` 的 `.txt` 文件读写规则不变。
- 现有 AI 面板、及时召唤、思维扩展和单条线性临时追问不扩展任务范围，也不新增任何写回入口。
- 本 change 不包含第二轮的结构化存储与基础富文本，也不包含第三轮的常用文字和段落格式能力。
