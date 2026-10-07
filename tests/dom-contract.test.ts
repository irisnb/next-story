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

test("making module exposes the three regions with inspect-only interactions", () => {
  // 三区并列：链路库（找成品）｜结构检视（看成品与确定使用）｜制作对话（做零件）。
  assert.match(html, /<aside\b[^>]*\bid="making-chain-library"[^>]*aria-label="链路库"/);
  assert.match(html, /<section\b[^>]*\bid="making-inspector"[^>]*aria-label="结构检视"/);
  assert.match(html, /<aside\b[^>]*\bid="making-conversation-pane"[^>]*aria-label="制作对话"/);
  // 链路库：新建（简单命名）＋列表＋空库口述引导。
  assert.match(html, /\bid="making-new-chain-btn"/);
  assert.match(html, /\bid="making-new-chain-form"/);
  assert.match(html, /\bid="making-chain-list"/);
  assert.match(html, /\bid="making-chain-empty"/);
  assert.match(html, /说说你希望 AI 多做什么、少做什么/);
  // 结构检视：版本记录浏览、启用入口（链路版本层级）、卡片列表、卡片检视面板。
  assert.match(html, /\bid="making-version-select"/);
  assert.match(html, /\bid="making-enable-btn"/);
  assert.match(html, /\bid="making-card-list"/);
  assert.match(html, /\bid="making-card-panel"/);
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
  // 窄窗收拢：链路库入口按钮＋页内「结构检视／制作对话」切换。
  assert.match(html, /\bid="making-library-toggle"/);
  assert.match(html, /\bid="making-view-switch"/);
  assert.match(html, /\bid="making-view-inspect-btn"[^>]*>结构检视/);
  assert.match(html, /\bid="making-view-chat-btn"[^>]*>制作对话/);
});

test("making module renders a text-list inspector with a read-only fixed base", () => {
  // 免责句（不暗示 AI 内部思考过程）。
  assert.match(html, /展示链路的组装结构与适用条件，不代表 AI 内部思考过程/);
  // 固定底座四项只读说明（details/summary 只读，无修改或开关控件）。
  assert.match(html, /<summary>红线<\/summary>/);
  assert.match(html, /<summary>骨（底线立场）<\/summary>/);
  assert.match(html, /<summary>工具<\/summary>/);
  assert.match(html, /<summary>材料规则<\/summary>/);
  // 可变区只有要求类插槽说明；姿态／背景／方式不出现占位或「解锁」入口。
  assert.match(html, /要求类插槽：想让 AI 多做什么、别做什么/);
  assert.doesNotMatch(html, /姿态类插槽|背景卡|方式卡|解锁/);
  // 无拖拽、步骤编号、执行箭头等编排形态暗示。
  const makingSection = html.slice(html.indexOf('id="module-making"'));
  assert.doesNotMatch(makingSection, /draggable="true"/);
  assert.doesNotMatch(makingSection, /data-step|步骤\s*[1-9一二三四五]|执行顺序/);
});
