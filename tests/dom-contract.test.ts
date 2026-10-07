import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("production uses a single generic editor mount and three module tabs", () => {
  assert.doesNotMatch(html, /<textarea\b[^>]*\bid="(?:draft|main)-textarea"/);
  assert.doesNotMatch(html, /\bid="draft-textarea"/);
  assert.doesNotMatch(html, /\bid="main-textarea"/);
  assert.match(html, /<div\b[^>]*\bid="editor-textarea"/);
  assert.match(html, /<button\b[^>]*\bid="tab-writing"[^>]*>写作<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="tab-files"[^>]*>文件管理<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="tab-settings"[^>]*>设置<\/button>/);
});

test("writing module exposes a lightweight document switcher and empty state", () => {
  assert.match(html, /<button\b[^>]*\bid="current-doc-toggle"/);
  assert.match(html, /<span\b[^>]*\bid="current-document-name"/);
  assert.match(html, /<div\b[^>]*\bid="document-list"/);
  assert.match(html, /<div\b[^>]*\bid="writing-empty-state"[^>]*>[^<]*去文件管理新建一篇/);
});

test("writing module exposes a unified export entry with format/scope/filename dialog", () => {
  assert.match(html, /<button\b[^>]*\bid="btn-export"[^>]*>导出<\/button>/);
  assert.doesNotMatch(html, /\bid="btn-export-word"/);
  // 统一导出对话框：格式三选一（Word 默认选中）、范围选择器、文件名建议输入。
  assert.match(html, /\bid="export-dialog"/);
  assert.match(
    html,
    /<input type="radio" name="export-format" value="word" checked>/,
    "Word 应为默认格式",
  );
  assert.match(html, /<input type="radio" name="export-format" value="pdf">/);
  assert.match(html, /<input type="radio" name="export-format" value="markdown">/);
  assert.match(html, /\bid="export-scope"/);
  assert.match(html, /\bid="export-filename"/);
  assert.match(html, /\bid="btn-export-confirm"/);
  assert.match(html, /\bid="btn-export-cancel"/);
});

test("LLM config lives inside the settings module, not a standalone page", () => {
  assert.doesNotMatch(html, /\bid="llm-config-page"/);
  assert.match(html, /<section\b[^>]*\bid="module-settings"/);
  assert.match(html, /<button\b[^>]*\bid="btn-back-config"[^>]*>返回写作<\/button>/);
  // 任务 8.1：max_tokens 可选输入位于设置模块的 LLM 配置表单（留空 = 默认 131072）。
  assert.match(html, /<input\b[^>]*\bid="max-tokens"[^>]*placeholder="[^"]*131072/);
  assert.match(html, /\bid="max-tokens-error"/);
});

test("file management module exposes tree, recycle bin, and new-node actions", () => {
  assert.match(html, /<button\b[^>]*\bid="fm-new-document"[^>]*>新建文档<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="fm-new-folder"[^>]*>新建文件夹<\/button>/);
  // add-markdown-import：入口泛化为「导入文档」（.docx / .md 共用）。
  assert.match(html, /<button\b[^>]*\bid="fm-import-document"[^>]*>导入文档<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="fm-open-recycle-bin"[^>]*>回收站<\/button>/);
  assert.match(html, /<div\b[^>]*\bid="fm-file-tree"/);
  assert.match(html, /<div\b[^>]*\bid="fm-recycle-list"/);
});

test("document import dialog exposes conclusion, collapsible losses, split choice, and target", () => {
  // add-word-import：预检对话框骨架（复用导出对话框的 .export-dialog）。
  assert.match(html, /<dialog\b[^>]*\bid="document-import-dialog"/);
  assert.match(html, /\bid="document-import-conclusion"/);
  assert.match(html, /\bid="document-import-structure"/);
  // add-markdown-import：md 文件的软换行接合说明行（默认隐藏，选中 .md 时呈现）。
  assert.match(html, /<p\b[^>]*\bid="document-import-note"[^>]*class="[^"]*hidden/);
  // 损耗明细可折叠（details/summary），明细列表完整呈现。
  assert.match(html, /<details\b[^>]*\bid="document-import-losses"[^>]*class="[^"]*hidden/);
  assert.match(html, /\bid="document-import-loss-list"/);
  // 拆分二选一：默认不拆（whole 选中），无建议时整个字段隐藏。
  assert.match(html, /\bid="document-import-split-field"[^>]*class="[^"]*hidden/);
  assert.match(
    html,
    /<input type="radio" name="document-import-split" value="whole" id="document-import-split-whole" checked>/,
    "默认不拆分",
  );
  assert.match(html, /\bid="document-import-split-by-marker"/);
  assert.match(html, /\bid="document-import-split-marker-label"/);
  // 目标位置默认根级，取消 / 确认按钮层级与导出对话框一致。
  assert.match(html, /\bid="document-import-target"/);
  assert.match(html, /\bid="btn-document-import-cancel"/);
  assert.match(html, /\bid="btn-document-import-confirm"/);
});

test("AI dock header exposes new-conversation and collapse entries", () => {
  assert.match(html, /<button\b[^>]*\bid="ai-new-conversation"[^>]*title="新建对话"/);
  assert.match(html, /<button\b[^>]*\bid="ai-dock-collapse"[^>]*title="收起停靠区"/);
  assert.match(html, /<button\b[^>]*\bid="ai-conversation-list-toggle"[^>]*title="会话列表"/);
  assert.match(html, /<template\b[^>]*\bid="ai-window-template"/);
  assert.match(html, /<aside\b[^>]*\bid="ai-dock"/);
});

test("making module exposes a fourth tab and a status bar bound to the global active chain", () => {
  // 第四页面：主导航末位新增「制作模块」，独立占用主内容区。
  assert.match(html, /<button\b[^>]*\bid="tab-making"[^>]*>制作模块<\/button>/);
  assert.match(html, /<section\b[^>]*\bid="module-making"[^>]*aria-label="制作模块"/);
  // 状态条（常驻）：启用态（名·第N版｜所有作品共用｜停用＋生效时机说明）与未启用态。
  assert.match(html, /\bid="making-status-bar"/);
  assert.match(html, /\bid="making-status-active"/);
  assert.match(html, /\bid="making-status-text"/);
  assert.match(html, /\bid="making-status-idle"[^>]*>当前未启用链路，使用日常陪想/);
  assert.match(html, /\bid="making-deactivate-btn"[^>]*>停用<\/button>/);
  assert.match(html, /从下一轮开始使用；正在生成的回复沿用发起时的版本/);
});

test("making module exposes dual tabs, graph zones, and unified detail mounts", () => {
  // 内容区双标签「导图｜制作对话」：链路库左栏保留，状态条常驻在标签之上。
  assert.match(html, /<aside\b[^>]*\bid="making-chain-library"[^>]*aria-label="链路库"/);
  assert.match(html, /<section\b[^>]*\bid="making-inspector"[^>]*aria-label="导图"/);
  assert.match(html, /<aside\b[^>]*\bid="making-conversation-pane"[^>]*aria-label="制作对话"/);
  assert.match(html, /\bid="making-view-switch"/);
  assert.match(html, /<button\b[^>]*\bid="making-view-map-btn"[^>]*role="tab"[^>]*>导图<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="making-view-chat-btn"[^>]*role="tab"[^>]*>制作对话<\/button>/);
  // 链路库：新建（简单命名）＋列表＋空库口述引导。
  assert.match(html, /\bid="making-new-chain-btn"/);
  assert.match(html, /\bid="making-new-chain-form"/);
  assert.match(html, /\bid="making-chain-list"/);
  assert.match(html, /\bid="making-chain-empty"/);
  assert.match(html, /说说你希望 AI 多做什么、少做什么/);
  // 导图视图：三区同构——自定义要求（定高滚动＋要求类插槽＋ghost）／固定底座／每轮动态。
  assert.match(html, /\bid="making-graph"/);
  assert.match(html, /\bid="making-zone-custom"[^>]*aria-label="自定义要求"/);
  assert.match(html, /\bid="making-zone-scroll"/);
  assert.match(html, /要求类插槽/);
  assert.match(html, /\bid="making-card-list"/);
  assert.match(html, /\bid="making-add-card-btn"[^>]*>＋ 添加要求卡<\/button>/);
  assert.match(html, /\bid="making-base-node"/);
  assert.match(html, /<strong>固定底座<\/strong><span>共用 · 只读<\/span>/);
  assert.match(html, /<span>红线<\/span><span>骨<\/span><span>工具<\/span><span>材料规则<\/span>/);
  assert.match(html, /\bid="making-dynamic-node"/);
  assert.match(html, /<strong>每轮动态<\/strong><span>自动<\/span>/);
  // 命名统一：用户可见一律「自定义要求」，不出现「链路可变区」。
  assert.doesNotMatch(html, /链路可变区/);
  // 统一详情挂载位：唯一快捷小窗＋全页详情（卡片五项面板在其中）＋返回入口。
  assert.match(html, /\bid="making-quick-panel"/);
  assert.match(html, /\bid="making-full-detail"/);
  assert.match(html, /\bid="making-card-panel"/);
  assert.match(html, /\bid="making-full-back"[^>]*>返回导图/);
  // 制作对话：标题「正在制作」＋空态引导＋「开始新制作」＋真实会话接线挂点
  // （车道 F2a：会话主区／历史列表／提示行／停止入口；占位文案已随接线移除）。
  assert.match(html, /正在制作：<span id="making-conversation-object">未选择<\/span>/);
  assert.match(html, /\bid="making-conversation-body"/);
  assert.match(html, /\bid="making-conversation-start-btn"[^>]*>开始新制作/);
  assert.match(html, /\bid="making-conversation-empty"/);
  assert.match(html, /\bid="making-conversation-recent"/);
  assert.match(html, /\bid="making-conversation-active"/);
  assert.match(html, /\bid="making-session-new-btn"[^>]*>新会话/);
  assert.match(html, /\bid="making-session-history-btn"[^>]*>历史会话/);
  assert.match(html, /\bid="making-session-messages"/);
  assert.match(html, /\bid="making-conversation-stop"[^>]*>停止/);
  assert.doesNotMatch(html, /会话功能随后接入/);
  // 中等宽度收拢：链路库入口按钮。
  assert.match(html, /\bid="making-library-toggle"/);
});

test("making graph keeps arrows in the wire svg only and the output block purely symbolic", () => {
  const makingSection = html.slice(html.indexOf('id="module-making"'));
  // 连线 SVG 是唯一箭头载体：整个制作页只有一个 svg＋一个 marker；静态连线不得带
  // 箭头属性（marker-end=…）——流线路径由控制器按视图模型的连线数据渲染时挂载，
  // 且只挂「分区→组装」「组装→输出」两类流线（散文注释提及不算属性用法）。
  const svgCount = (makingSection.match(/<svg\b/g) ?? []).length;
  assert.equal(svgCount, 1, "制作页只允许连线一个 svg");
  assert.match(makingSection, /<svg\b[^>]*\bid="making-wires"[^>]*viewBox="0 0 840 440"/);
  const markerCount = (makingSection.match(/<marker\b/g) ?? []).length;
  assert.equal(markerCount, 1, "唯一箭头 marker");
  assert.match(makingSection, /<marker\b[^>]*\bid="making-arrow"/);
  assert.doesNotMatch(makingSection, /marker-end\s*=/);
  // 卡片之间零连线：除 marker 内的箭头形状外，制作页不含任何 path 元素。
  const pathCount = (makingSection.match(/<path\b/g) ?? []).length;
  assert.equal(pathCount, 1, "唯一 path 是 marker 的箭头形状；流线由渲染时生成");
  // 输出象征块是纯 div：不可点（非 button）、无详情入口、无 hover 可点态。
  assert.match(html, /<div\b[^>]*\bid="making-output-node"/);
  assert.doesNotMatch(html, /<button\b[^>]*making-output-node/);
  assert.doesNotMatch(html, /\bid="making-output-node"[^>]*\bdraggable/);
  // 无占位／解锁／拖拽／步骤编号（「执行顺序」字样只允许出现在阅读说明条的否定句里）。
  // add-posture-slot：姿态类插槽组升为正式静态节点（下方正面锚定）；占位禁令收窄为背景/方式/解锁。
  assert.doesNotMatch(makingSection, /背景卡|方式卡|解锁/);
  assert.doesNotMatch(makingSection, /draggable="true"/);
  assert.doesNotMatch(makingSection, /data-step|步骤\s*[1-9一二三四五]/);
  // add-posture-slot：自定义要求分区＝说明性副标＋要求类/姿态类两组同构（静态节点）。
  assert.match(makingSection, /<p\b[^>]*\bid="making-zone-subtitle"[^>]*>包含要求卡与姿态卡</);
  assert.match(makingSection, /<section\b[^>]*\bid="making-posture-group"[^>]*aria-label="姿态类插槽"/);
  assert.match(makingSection, /\bid="making-posture-card-count"/);
  assert.match(makingSection, /\bid="making-posture-card-list"/);
  assert.match(makingSection, /<button\b[^>]*\bid="making-add-posture-btn"[^>]*>＋ 添加姿态卡</);
  const orderMentions = makingSection.match(/执行顺序/g) ?? [];
  assert.equal(orderMentions.length, 1, "「执行顺序」仅出现于阅读说明条的否定句");
  assert.match(makingSection, /箭头只表示流向组装，不表示卡片执行顺序/);
});

test("making module keeps the reading notes bar with three exact sentences", () => {
  // 阅读说明条在图区容器之外贴底（不参与图区垂直居中计算），三句逐字固定。
  assert.match(html, /\bid="making-reading-notes"/);
  assert.match(html, /箭头只表示流向组装，不表示卡片执行顺序/);
  assert.match(html, /启用对象是整个链路版本/);
  assert.match(html, /展示链路的组装结构与适用条件，不代表 AI 内部思考过程。/);
});
