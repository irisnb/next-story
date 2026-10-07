/**
 * AI 停靠区与讨论窗口的显式 DOM 依赖契约。
 *
 * 窗口初始化只消费 `AiWindowDom`（按窗口根节点解析，`buildAiWindowDom`），
 * 停靠区外壳消费 `AiDockDom`（`getAppDom()` 集中解析）。契约不包含任何向作品
 * 文档写入、插入、替换或删除的接口（AI 输出只落在窗口临时显示区域）。
 */

/** 单个讨论窗口的 DOM 契约（从窗口根节点按 `data-role` 解析，不依赖全局 ID）。 */
export interface AiWindowDom {
  readonly root: HTMLElement;
  readonly head: HTMLElement;
  readonly grip: HTMLElement;
  readonly statusDot: HTMLElement;
  readonly title: HTMLElement;
  readonly doc: HTMLElement;
  /** 「切换关注文档」入口（显式改绑，查看其他文档不自动切换）。 */
  readonly focusSwitch: HTMLButtonElement;
  readonly badge: HTMLElement;
  /** 「本次参考了什么」展开入口。 */
  readonly materialsToggle: HTMLButtonElement;
  readonly stopBtn: HTMLButtonElement;
  readonly moreBtn: HTMLButtonElement;
  readonly closeBtn: HTMLButtonElement;
  readonly body: HTMLElement;
  readonly resize: HTMLElement;
  readonly snapshotBlock: HTMLElement;
  readonly snapshotText: HTMLPreElement;
  readonly loading: HTMLElement;
  readonly response: HTMLPreElement;
  readonly errorBlock: HTMLElement;
  readonly errorMessage: HTMLElement;
  readonly retryBtn: HTMLButtonElement;
  readonly configBlock: HTMLElement;
  readonly goConfigBtn: HTMLButtonElement;
  readonly conversation: HTMLElement;
  readonly followUpForm: HTMLFormElement;
  readonly followUpInput: HTMLTextAreaElement;
  readonly followUpSend: HTMLButtonElement;
  readonly followUpError: HTMLElement;
  readonly followUpErrorMessage: HTMLElement;
  readonly followUpRetry: HTMLButtonElement;
  readonly followUpEdit: HTMLButtonElement;
  readonly directQuestion: HTMLElement;
  readonly directQuestionSelection: HTMLElement;
  readonly directQuestionSelectionText: HTMLPreElement;
  readonly directQuestionSelectionRemove: HTMLButtonElement;
  readonly directQuestionForm: HTMLFormElement;
  readonly directQuestionInput: HTMLTextAreaElement;
  readonly directQuestionSend: HTMLButtonElement;
  readonly directQuestionError: HTMLElement;
  readonly directQuestionErrorMessage: HTMLElement;
  readonly directQuestionConfig: HTMLElement;
  readonly directQuestionGoConfig: HTMLButtonElement;
  /** 空状态欢迎语（无对话轮次且无进行中请求时显示）。 */
  readonly welcome: HTMLElement;
  /** 「本次参考了什么」面板（默认收起，不打断对话）。 */
  readonly materialsPanel: HTMLElement;
  readonly materialsBody: HTMLElement;
  readonly materialsClose: HTMLButtonElement;
  /** 按需补读授权请求卡（等待用户决定时显示；add-agent-on-demand-reading 任务 7.1）。 */
  readonly readingRequest: HTMLElement;
  readonly readingRequestTitle: HTMLElement;
  readonly readingRequestReason: HTMLElement;
  readonly readingRequestNotes: HTMLElement;
  readonly readingAllow: HTMLButtonElement;
  readonly readingDeny: HTMLButtonElement;
  /** 补读过程轻量状态（默认一行，可展开已读文档列表；任务 7.3）。 */
  readonly readingStatus: HTMLElement;
  readonly readingToggle: HTMLButtonElement;
  readonly readingStatusLine: HTMLElement;
  readonly readingStatusList: HTMLElement;
  /** 切换关注文档后的清晰中文提示（短暂显示，随后自动隐藏）。 */
  readonly focusNotice: HTMLElement;
  /** 受限讨论提示容器（材料权限已变化时显示，不泄露隐藏文件身份）。 */
  readonly restrictionNotice: HTMLElement;
  readonly restrictionNoticeMessage: HTMLElement;
  /** 受限提示内的「新建对话」入口（新建干净讨论的继续路径）。 */
  readonly restrictionNewConversation: HTMLButtonElement;
}

/** AI 停靠区外壳的 DOM 契约（停靠区头、提示区、会话列表、停靠窗口容器与浮动层）。 */
export interface AiDockDom {
  readonly root: HTMLElement;
  readonly rail: HTMLElement;
  readonly count: HTMLElement;
  readonly notice: HTMLElement;
  readonly body: HTMLElement;
  readonly floatLayer: HTMLElement;
  readonly windowTemplate: HTMLTemplateElement;
  readonly listToggleBtn: HTMLButtonElement;
  readonly newConversationBtn: HTMLButtonElement;
  readonly moreBtn: HTMLButtonElement;
  readonly collapseBtn: HTMLButtonElement;
  readonly conversationList: HTMLElement;
  readonly conversationListCloseBtn: HTMLButtonElement;
  readonly conversationListItems: HTMLElement;
  readonly conversationListEmpty: HTMLElement;
  /** 列表内「新建对话」入口。 */
  readonly listNewConversationBtn: HTMLButtonElement;
  /** 列表筛选输入。 */
  readonly searchInput: HTMLInputElement;
  readonly railNewBtn: HTMLButtonElement;
  readonly railListBtn: HTMLButtonElement;
  readonly railMoreBtn: HTMLButtonElement;
  readonly railExpandBtn: HTMLButtonElement;
  readonly railDot: HTMLElement;
}

/**
 * 制作模块页面的显式 DOM 依赖契约（add-chain-mindmap-v0 导图重构）。
 * 全部按全局 id 从 `index.html` 解析；缺失抛出包含 id 的明确错误。
 */
export interface MakingDom {
  /** 制作模块页面根节点（内容区标签切换的 data-making-view 落点）。 */
  readonly moduleRoot: HTMLElement;
  /** 顶部当前链路状态条（常驻；只反映全局 active 指针，不随浏览变化）。 */
  readonly statusBar: HTMLElement;
  readonly statusActive: HTMLElement;
  readonly statusText: HTMLElement;
  readonly statusIdle: HTMLElement;
  readonly statusError: HTMLElement;
  readonly deactivateBtn: HTMLButtonElement;
  /** 中等宽度收拢：链路库入口按钮与其外层条。 */
  readonly collapsedBar: HTMLElement;
  readonly libraryToggle: HTMLButtonElement;
  /** 内容区双标签「导图｜制作对话」（宽窄常驻；切换只改属性，不重建 DOM）。 */
  readonly viewSwitch: HTMLElement;
  readonly viewMapBtn: HTMLButtonElement;
  readonly viewChatBtn: HTMLButtonElement;
  /** 左：链路库。 */
  readonly chainLibrary: HTMLElement;
  readonly libraryCloseBtn: HTMLButtonElement;
  readonly newChainBtn: HTMLButtonElement;
  readonly newChainForm: HTMLFormElement;
  readonly newChainName: HTMLInputElement;
  readonly newChainConfirm: HTMLButtonElement;
  readonly newChainCancel: HTMLButtonElement;
  readonly chainList: HTMLElement;
  readonly chainEmpty: HTMLElement;
  /** 「导图」标签内容区（正在看什么）。 */
  readonly inspector: HTMLElement;
  readonly inspectorEmpty: HTMLElement;
  readonly inspectorContent: HTMLElement;
  readonly inspectorTitle: HTMLElement;
  /** 版本状态标注（「当前启用版本」／「尚未启用」）。 */
  readonly inspectorState: HTMLElement;
  readonly versionSelect: HTMLSelectElement;
  readonly enableBtn: HTMLButtonElement;
  readonly deleteChainBtn: HTMLButtonElement;
  /** 图区容器（组装流＋输出块以图区为基准垂直居中；快捷小窗挂在图区内）。 */
  readonly graph: HTMLElement;
  /** 连线 SVG（唯一箭头载体：marker 定义＋流线组）。 */
  readonly wires: SVGSVGElement;
  readonly wirePaths: SVGGElement;
  /** 三区之一：自定义要求（定高＋区内滚动；卡行＋ghost 在滚动内容内）。 */
  readonly zoneCustom: HTMLElement;
  readonly zoneCustomTrigger: HTMLButtonElement;
  readonly zoneScroll: HTMLElement;
  readonly cardCount: HTMLElement;
  readonly cardList: HTMLElement;
  readonly noCards: HTMLElement;
  readonly addCardBtn: HTMLButtonElement;
  /** 三区之二／之三：固定底座（共用·只读）与每轮动态（自动）。 */
  readonly baseNode: HTMLButtonElement;
  readonly dynamicNode: HTMLButtonElement;
  /** 统一详情：快捷小窗唯一挂载位（三类来源同位同尺寸）。 */
  readonly quickPanel: HTMLElement;
  /** 全页详情（占满导图视图；有返回入口）。 */
  readonly fullDetail: HTMLElement;
  readonly fullEyebrow: HTMLElement;
  readonly fullBackBtn: HTMLButtonElement;
  /** 卡片五项详情挂载（怎么做＝完整正文；试问记录在其中）。 */
  readonly cardPanel: HTMLElement;
  /** 底座／每轮动态的只读详情挂载（无任何操作控件）。 */
  readonly fullReadonly: HTMLElement;
  /** 阅读说明条（图区容器之外贴底；静态三句，控制器不改内容）。 */
  readonly readingNotes: HTMLElement;
  /** 「制作对话」标签内容区（会话控制器承载；行为不变）。 */
  readonly conversationPane: HTMLElement;
  readonly conversationObject: HTMLElement;
  readonly conversationBody: HTMLElement;
  /** 空态引导（无制作对象时显示；含所浏览链路的最近会话入口）。 */
  readonly conversationEmpty: HTMLElement;
  /** 空态内「该链路的最近制作会话」容器（继续上次制作＋历史列表）。 */
  readonly conversationRecent: HTMLElement;
  /** 会话打开后的制作对话主区（会话工具条＋历史列表＋提示＋转录）。 */
  readonly conversationActive: HTMLElement;
  /** 当前会话标题（空标题显示「制作会话」）。 */
  readonly sessionTitle: HTMLElement;
  /** 「新会话」入口（同链路开新会话）。 */
  readonly sessionNewBtn: HTMLButtonElement;
  /** 「历史会话」展开/收起入口。 */
  readonly sessionHistoryBtn: HTMLButtonElement;
  /** 历史会话列表容器（展开时显示）。 */
  readonly sessionHistoryList: HTMLElement;
  /** 会话级提示行（连接恢复、草稿保存结果、保存失败）。 */
  readonly sessionNotice: HTMLElement;
  /** 会话转录容器（轮次消息＋卡草稿面板）。 */
  readonly sessionMessages: HTMLElement;
  readonly conversationStartBtn: HTMLButtonElement;
  readonly conversationInput: HTMLTextAreaElement;
  readonly conversationSend: HTMLButtonElement;
  /** 「停止」生成入口（仅生成中显示）。 */
  readonly conversationStop: HTMLButtonElement;
  readonly conversationForm: HTMLFormElement;
}

export interface AppDom {
  welcomePage: HTMLElement;
  newProjectPage: HTMLElement;
  editorPage: HTMLElement;
  btnNewProject: HTMLButtonElement;
  btnOpenProject: HTMLButtonElement;
  projectNameInput: HTMLInputElement;
  saveLocationInput: HTMLInputElement;
  btnBrowse: HTMLButtonElement;
  btnCancelNew: HTMLButtonElement;
  btnCreateProject: HTMLButtonElement;
  nameError: HTMLElement;
  locationError: HTMLElement;
  /** 欢迎页最近作品列表容器（batch-improvement-candidates 任务组 3④）。 */
  recentWorksList: HTMLElement;
  /** 最近作品空态文案（列表为空时显示「还没有打开过的作品」）。 */
  recentWorksEmpty: HTMLElement;
  currentProjectName: HTMLElement;
  saveStatus: HTMLElement;
  btnSave: HTMLButtonElement;
  btnBackWelcome: HTMLButtonElement;
  tabWriting: HTMLButtonElement;
  tabFiles: HTMLButtonElement;
  tabSettings: HTMLButtonElement;
  /** 第四页面「制作模块」导航项（add-making-module-core 任务 7.1）。 */
  tabMaking: HTMLButtonElement;
  moduleWriting: HTMLElement;
  moduleFiles: HTMLElement;
  moduleSettings: HTMLElement;
  /** 制作模块页面根节点。 */
  moduleMaking: HTMLElement;
  /** 制作模块页面内部的显式 DOM 依赖契约（按 id 解析）。 */
  making: MakingDom;
  editorTextarea: HTMLElement;
  currentDocToggle: HTMLButtonElement;
  currentDocumentName: HTMLElement;
  documentList: HTMLElement;
  writingEmptyState: HTMLElement;
  btnExport: HTMLButtonElement;
  /** 统一导出对话框（格式 × 范围 × 文件名，见 src/export.ts）。 */
  exportDialog: HTMLDialogElement;
  exportFormatOptions: HTMLElement;
  exportScope: HTMLSelectElement;
  exportFilename: HTMLInputElement;
  btnExportConfirm: HTMLButtonElement;
  btnExportCancel: HTMLButtonElement;
  fmNewDocument: HTMLButtonElement;
  fmNewFolder: HTMLButtonElement;
  /** 文件管理区「导入文档」入口（add-word-import 建立，add-markdown-import 泛化；见 src/document-import.ts）。 */
  fmImportDocument: HTMLButtonElement;
  /** 文档导入预检对话框。 */
  documentImportDialog: HTMLDialogElement;
  documentImportConclusion: HTMLElement;
  documentImportStructure: HTMLElement;
  /** md 文件的软换行接合说明行（仅 .md 时可见）。 */
  documentImportNote: HTMLElement;
  documentImportLosses: HTMLElement;
  documentImportLossList: HTMLElement;
  documentImportSplitField: HTMLElement;
  documentImportSplitWhole: HTMLInputElement;
  documentImportSplitByMarker: HTMLInputElement;
  documentImportSplitMarkerLabel: HTMLElement;
  documentImportTarget: HTMLSelectElement;
  documentImportError: HTMLElement;
  btnDocumentImportConfirm: HTMLButtonElement;
  btnDocumentImportCancel: HTMLButtonElement;
  fmStatus: HTMLElement;
  fmFileTree: HTMLElement;
  fmOpenRecycleBin: HTMLButtonElement;
  fmRecycleBin: HTMLElement;
  fmBackFromRecycle: HTMLButtonElement;
  fmRecycleList: HTMLElement;
  /** 文件管理区域中关于文档 AI 可见性开关的说明文案。 */
  fmAiVisibilityHelp: HTMLElement;
  paragraphStyle: HTMLSelectElement;
  btnBold: HTMLButtonElement;
  btnItalic: HTMLButtonElement;
  btnBulletList: HTMLButtonElement;
  btnOrderedList: HTMLButtonElement;
  /** 有序列表编号样式 flyout 触发器（「有序列表」按钮旁，PS 风格；见 editor-toolbar.ts）。 */
  btnOrderedListStyle: HTMLButtonElement;
  /** 编号样式 flyout 菜单容器（紧邻触发器右侧弹出）。 */
  orderedListStyleMenu: HTMLElement;
  /** 菜单顶部状态行：统一样式显示中文名，多种样式显示「多种格式」。 */
  orderedListStyleCurrent: HTMLElement;
  /** 菜单内五个样式项按钮（`data-style` 标识样式值）。 */
  orderedListStyleItems: readonly HTMLButtonElement[];
  btnToolbarUnderline: HTMLButtonElement;
  btnToolbarStrike: HTMLButtonElement;
  btnUndo: HTMLButtonElement;
  btnRedo: HTMLButtonElement;
  btnFind: HTMLButtonElement;
  btnMargin: HTMLButtonElement;
  btnColumnWidth: HTMLButtonElement;
  btnFormatDrawer: HTMLButtonElement;
  formatToolbar: HTMLElement;
  formatDrawer: HTMLElement;
  btnFormatDrawerClose: HTMLButtonElement;
  btnUnderline: HTMLButtonElement;
  btnStrike: HTMLButtonElement;
  btnToggleCharacterSection: HTMLButtonElement;
  btnToggleParagraphSection: HTMLButtonElement;
  selectFontFamily: HTMLSelectElement;
  selectFontSize: HTMLSelectElement;
  inputTextColor: HTMLInputElement;
  btnClearTextColor: HTMLButtonElement;
  inputHighlight: HTMLInputElement;
  btnClearHighlight: HTMLButtonElement;
  btnClearCharacterFormat: HTMLButtonElement;
  btnAlignLeft: HTMLButtonElement;
  btnAlignCenter: HTMLButtonElement;
  btnAlignRight: HTMLButtonElement;
  btnAlignJustify: HTMLButtonElement;
  selectLineHeight: HTMLSelectElement;
  selectSpacingBefore: HTMLSelectElement;
  selectSpacingAfter: HTMLSelectElement;
  selectTextIndent: HTMLSelectElement;
  selectIndentLeft: HTMLSelectElement;
  selectIndentRight: HTMLSelectElement;
  btnClearParagraphFormat: HTMLButtonElement;
  findBar: HTMLElement;
  findInput: HTMLInputElement;
  findCaseSensitive: HTMLInputElement;
  btnFindPrev: HTMLButtonElement;
  btnFindNext: HTMLButtonElement;
  findCount: HTMLElement;
  replaceInput: HTMLInputElement;
  btnReplace: HTMLButtonElement;
  btnReplaceAll: HTMLButtonElement;
  btnFindClose: HTMLButtonElement;
  contextMenu: HTMLElement;
  btnCtxCut: HTMLButtonElement;
  btnCtxCopy: HTMLButtonElement;
  btnCtxPaste: HTMLButtonElement;
  btnCtxPastePlain: HTMLButtonElement;
  btnCtxLinkCreate: HTMLButtonElement;
  ctxLinkGroup: HTMLElement;
  btnCtxLinkOpen: HTMLButtonElement;
  btnCtxLinkEdit: HTMLButtonElement;
  btnCtxLinkRemove: HTMLButtonElement;
  linkPopover: HTMLElement;
  btnLinkOpen: HTMLButtonElement;
  btnLinkEdit: HTMLButtonElement;
  btnLinkRemove: HTMLButtonElement;
  apiBaseUrlInput: HTMLInputElement;
  apiBaseUrlError: HTMLElement;
  apiKeyInput: HTMLInputElement;
  apiKeyError: HTMLElement;
  modelNameInput: HTMLInputElement;
  modelNameError: HTMLElement;
  maxTokensInput: HTMLInputElement;
  maxTokensError: HTMLElement;
  llmSaveStatus: HTMLElement;
  btnSaveConfig: HTMLButtonElement;
  btnTestConfig: HTMLButtonElement;
  btnBackConfig: HTMLButtonElement;
  btnToggleAi: HTMLButtonElement;
  aiDock: AiDockDom;
  leaveDialog: HTMLDialogElement;
  btnSaveAndLeave: HTMLButtonElement;
  btnDiscardAndLeave: HTMLButtonElement;
  btnCancelLeave: HTMLButtonElement;
}

/** 解析全局 id；缺省返回 HTMLElement，SVG 节点用显式类型参数解析。 */
function requireElement<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }

  return element as unknown as T;
}

/** 在窗口根节点内按 `data-role` 解析必需节点；缺失抛出包含角色标识的明确错误。 */
function requireRole<T extends HTMLElement>(root: HTMLElement, role: string): T {
  const element = root.querySelector<T>(`[data-role="${role}"]`);
  if (!element) {
    throw new Error(`Missing required window node: [data-role="${role}"]`);
  }
  return element;
}

/**
 * 从窗口根节点组装单个讨论窗口的 DOM 契约（按 `data-role` 解析，不依赖全局 ID）。
 * 窗口模板结构见 `index.html` 的 `#ai-window-template`。
 */
export function buildAiWindowDom(root: HTMLElement): AiWindowDom {
  return {
    root,
    head: requireRole(root, "drag-handle"),
    grip: requireRole(root, "grip"),
    statusDot: requireRole(root, "status-dot"),
    title: requireRole(root, "title"),
    doc: requireRole(root, "doc"),
    focusSwitch: requireRole<HTMLButtonElement>(root, "focus-switch"),
    badge: requireRole(root, "badge"),
    materialsToggle: requireRole<HTMLButtonElement>(root, "materials-toggle"),
    stopBtn: requireRole<HTMLButtonElement>(root, "stop"),
    moreBtn: requireRole<HTMLButtonElement>(root, "more"),
    closeBtn: requireRole<HTMLButtonElement>(root, "close"),
    body: requireRole(root, "body"),
    resize: requireRole(root, "resize"),
    snapshotBlock: requireRole(root, "snapshot-block"),
    snapshotText: requireRole<HTMLPreElement>(root, "snapshot-text"),
    loading: requireRole(root, "loading"),
    response: requireRole<HTMLPreElement>(root, "response"),
    errorBlock: requireRole(root, "error-block"),
    errorMessage: requireRole(root, "error-message"),
    retryBtn: requireRole<HTMLButtonElement>(root, "retry"),
    configBlock: requireRole(root, "config-block"),
    goConfigBtn: requireRole<HTMLButtonElement>(root, "go-config"),
    conversation: requireRole(root, "conversation"),
    followUpForm: requireRole<HTMLFormElement>(root, "follow-up-form"),
    followUpInput: requireRole<HTMLTextAreaElement>(root, "follow-up-input"),
    followUpSend: requireRole<HTMLButtonElement>(root, "follow-up-send"),
    followUpError: requireRole(root, "follow-up-error"),
    followUpErrorMessage: requireRole(root, "follow-up-error-message"),
    followUpRetry: requireRole<HTMLButtonElement>(root, "follow-up-retry"),
    followUpEdit: requireRole<HTMLButtonElement>(root, "follow-up-edit"),
    directQuestion: requireRole(root, "direct-question"),
    directQuestionSelection: requireRole(root, "direct-question-selection"),
    directQuestionSelectionText: requireRole<HTMLPreElement>(root, "direct-question-selection-text"),
    directQuestionSelectionRemove: requireRole<HTMLButtonElement>(root, "direct-question-selection-remove"),
    directQuestionForm: requireRole<HTMLFormElement>(root, "direct-question-form"),
    directQuestionInput: requireRole<HTMLTextAreaElement>(root, "direct-question-input"),
    directQuestionSend: requireRole<HTMLButtonElement>(root, "direct-question-send"),
    directQuestionError: requireRole(root, "direct-question-error"),
    directQuestionErrorMessage: requireRole(root, "direct-question-error-message"),
    directQuestionConfig: requireRole(root, "direct-question-config"),
    directQuestionGoConfig: requireRole<HTMLButtonElement>(root, "direct-question-go-config"),
    welcome: requireRole(root, "welcome"),
    materialsPanel: requireRole(root, "materials-panel"),
    materialsBody: requireRole(root, "materials-body"),
    materialsClose: requireRole<HTMLButtonElement>(root, "materials-close"),
    readingRequest: requireRole(root, "reading-request"),
    readingRequestTitle: requireRole(root, "reading-request-title"),
    readingRequestReason: requireRole(root, "reading-request-reason"),
    readingRequestNotes: requireRole(root, "reading-request-notes"),
    readingAllow: requireRole<HTMLButtonElement>(root, "reading-allow"),
    readingDeny: requireRole<HTMLButtonElement>(root, "reading-deny"),
    readingStatus: requireRole(root, "reading-status"),
    readingToggle: requireRole<HTMLButtonElement>(root, "reading-toggle"),
    readingStatusLine: requireRole(root, "reading-status-line"),
    readingStatusList: requireRole(root, "reading-status-list"),
    focusNotice: requireRole(root, "focus-notice"),
    restrictionNotice: requireRole(root, "restriction-notice"),
    restrictionNoticeMessage: requireRole(root, "restriction-notice-message"),
    restrictionNewConversation: requireRole<HTMLButtonElement>(root, "restriction-new-conversation"),
  };
}

export function getAppDom(): AppDom {
  const btnToggleAi = requireElement<HTMLButtonElement>("btn-toggle-ai");
  const aiDock = requireElement("ai-dock");
  const aiDockRail = requireElement("ai-dock-rail");

  return {
    welcomePage: requireElement("welcome-page"),
    newProjectPage: requireElement("new-project-page"),
    editorPage: requireElement("editor-page"),
    btnNewProject: requireElement("btn-new-project"),
    btnOpenProject: requireElement("btn-open-project"),
    projectNameInput: requireElement("project-name"),
    saveLocationInput: requireElement("save-location"),
    btnBrowse: requireElement("btn-browse"),
    btnCancelNew: requireElement("btn-cancel-new"),
    btnCreateProject: requireElement("btn-create-project"),
    nameError: requireElement("name-error"),
    locationError: requireElement("location-error"),
    recentWorksList: requireElement("recent-works-list"),
    recentWorksEmpty: requireElement("recent-works-empty"),
    currentProjectName: requireElement("current-project-name"),
    saveStatus: requireElement("save-status"),
    btnSave: requireElement("btn-save"),
    btnBackWelcome: requireElement("btn-back-welcome"),
    tabWriting: requireElement("tab-writing"),
    tabFiles: requireElement("tab-files"),
    tabSettings: requireElement("tab-settings"),
    tabMaking: requireElement("tab-making"),
    moduleWriting: requireElement("module-writing"),
    moduleFiles: requireElement("module-files"),
    moduleSettings: requireElement("module-settings"),
    moduleMaking: requireElement("module-making"),
    making: {
      moduleRoot: requireElement("module-making"),
      statusBar: requireElement("making-status-bar"),
      statusActive: requireElement("making-status-active"),
      statusText: requireElement("making-status-text"),
      statusIdle: requireElement("making-status-idle"),
      statusError: requireElement("making-status-error"),
      deactivateBtn: requireElement("making-deactivate-btn"),
      collapsedBar: requireElement("making-collapsed-bar"),
      libraryToggle: requireElement("making-library-toggle"),
      viewSwitch: requireElement("making-view-switch"),
      viewMapBtn: requireElement<HTMLButtonElement>("making-view-map-btn"),
      viewChatBtn: requireElement<HTMLButtonElement>("making-view-chat-btn"),
      chainLibrary: requireElement("making-chain-library"),
      libraryCloseBtn: requireElement("making-library-close-btn"),
      newChainBtn: requireElement("making-new-chain-btn"),
      newChainForm: requireElement("making-new-chain-form"),
      newChainName: requireElement("making-new-chain-name"),
      newChainConfirm: requireElement("making-new-chain-confirm"),
      newChainCancel: requireElement("making-new-chain-cancel"),
      chainList: requireElement("making-chain-list"),
      chainEmpty: requireElement("making-chain-empty"),
      inspector: requireElement("making-inspector"),
      inspectorEmpty: requireElement("making-inspector-empty"),
      inspectorContent: requireElement("making-inspector-content"),
      inspectorTitle: requireElement("making-inspector-title"),
      inspectorState: requireElement("making-inspector-state"),
      versionSelect: requireElement<HTMLSelectElement>("making-version-select"),
      enableBtn: requireElement<HTMLButtonElement>("making-enable-btn"),
      deleteChainBtn: requireElement<HTMLButtonElement>("making-delete-chain-btn"),
      graph: requireElement("making-graph"),
      wires: requireElement<SVGSVGElement>("making-wires"),
      wirePaths: requireElement<SVGGElement>("making-wire-paths"),
      zoneCustom: requireElement("making-zone-custom"),
      zoneCustomTrigger: requireElement<HTMLButtonElement>("making-custom-trigger"),
      zoneScroll: requireElement("making-zone-scroll"),
      cardCount: requireElement("making-card-count"),
      cardList: requireElement("making-card-list"),
      noCards: requireElement("making-no-cards"),
      addCardBtn: requireElement<HTMLButtonElement>("making-add-card-btn"),
      baseNode: requireElement<HTMLButtonElement>("making-base-node"),
      dynamicNode: requireElement<HTMLButtonElement>("making-dynamic-node"),
      quickPanel: requireElement("making-quick-panel"),
      fullDetail: requireElement("making-full-detail"),
      fullEyebrow: requireElement("making-full-eyebrow"),
      fullBackBtn: requireElement<HTMLButtonElement>("making-full-back"),
      cardPanel: requireElement("making-card-panel"),
      fullReadonly: requireElement("making-full-readonly"),
      readingNotes: requireElement("making-reading-notes"),
      conversationPane: requireElement("making-conversation-pane"),
      conversationObject: requireElement("making-conversation-object"),
      conversationBody: requireElement("making-conversation-body"),
      conversationEmpty: requireElement("making-conversation-empty"),
      conversationRecent: requireElement("making-conversation-recent"),
      conversationActive: requireElement("making-conversation-active"),
      sessionTitle: requireElement("making-session-title"),
      sessionNewBtn: requireElement<HTMLButtonElement>("making-session-new-btn"),
      sessionHistoryBtn: requireElement<HTMLButtonElement>("making-session-history-btn"),
      sessionHistoryList: requireElement("making-session-history-list"),
      sessionNotice: requireElement("making-session-notice"),
      sessionMessages: requireElement("making-session-messages"),
      conversationStartBtn: requireElement("making-conversation-start-btn"),
      conversationInput: requireElement("making-conversation-input"),
      conversationSend: requireElement("making-conversation-send"),
      conversationStop: requireElement<HTMLButtonElement>("making-conversation-stop"),
      conversationForm: requireElement("making-conversation-form"),
    },
    editorTextarea: requireElement("editor-textarea"),
    currentDocToggle: requireElement("current-doc-toggle"),
    currentDocumentName: requireElement("current-document-name"),
    documentList: requireElement("document-list"),
    writingEmptyState: requireElement("writing-empty-state"),
    btnExport: requireElement("btn-export"),
    exportDialog: requireElement("export-dialog"),
    exportFormatOptions: requireElement("export-format-options"),
    exportScope: requireElement("export-scope"),
    exportFilename: requireElement("export-filename"),
    btnExportConfirm: requireElement("btn-export-confirm"),
    btnExportCancel: requireElement("btn-export-cancel"),
    fmNewDocument: requireElement("fm-new-document"),
    fmNewFolder: requireElement("fm-new-folder"),
    fmImportDocument: requireElement("fm-import-document"),
    documentImportDialog: requireElement("document-import-dialog"),
    documentImportConclusion: requireElement("document-import-conclusion"),
    documentImportStructure: requireElement("document-import-structure"),
    documentImportNote: requireElement("document-import-note"),
    documentImportLosses: requireElement("document-import-losses"),
    documentImportLossList: requireElement("document-import-loss-list"),
    documentImportSplitField: requireElement("document-import-split-field"),
    documentImportSplitWhole: requireElement("document-import-split-whole"),
    documentImportSplitByMarker: requireElement("document-import-split-by-marker"),
    documentImportSplitMarkerLabel: requireElement("document-import-split-marker-label"),
    documentImportTarget: requireElement("document-import-target"),
    documentImportError: requireElement("document-import-error"),
    btnDocumentImportConfirm: requireElement("btn-document-import-confirm"),
    btnDocumentImportCancel: requireElement("btn-document-import-cancel"),
    fmStatus: requireElement("fm-status"),
    fmFileTree: requireElement("fm-file-tree"),
    fmOpenRecycleBin: requireElement("fm-open-recycle-bin"),
    fmRecycleBin: requireElement("fm-recycle-bin"),
    fmBackFromRecycle: requireElement("fm-back-from-recycle"),
    fmRecycleList: requireElement("fm-recycle-list"),
    fmAiVisibilityHelp: requireElement("fm-ai-visibility-help"),
    paragraphStyle: requireElement("paragraph-style"),
    btnBold: requireElement("btn-bold"),
    btnItalic: requireElement("btn-italic"),
    btnBulletList: requireElement("btn-bullet-list"),
    btnOrderedList: requireElement("btn-ordered-list"),
    btnOrderedListStyle: requireElement<HTMLButtonElement>("btn-ordered-list-style"),
    orderedListStyleMenu: requireElement("ordered-list-style-menu"),
    orderedListStyleCurrent: requireElement("ordered-list-style-current"),
    orderedListStyleItems: [
      requireElement<HTMLButtonElement>("btn-ol-style-1"),
      requireElement<HTMLButtonElement>("btn-ol-style-A"),
      requireElement<HTMLButtonElement>("btn-ol-style-a"),
      requireElement<HTMLButtonElement>("btn-ol-style-I"),
      requireElement<HTMLButtonElement>("btn-ol-style-i"),
    ],
    btnToolbarUnderline: requireElement("btn-toolbar-underline"),
    btnToolbarStrike: requireElement("btn-toolbar-strike"),
    btnUndo: requireElement("btn-undo"),
    btnRedo: requireElement("btn-redo"),
    btnFind: requireElement("btn-find"),
    btnMargin: requireElement("btn-margin"),
    btnColumnWidth: requireElement("btn-column-width"),
    btnFormatDrawer: requireElement("btn-format-drawer"),
    formatToolbar: requireElement("format-toolbar"),
    formatDrawer: requireElement("format-drawer"),
    btnFormatDrawerClose: requireElement("btn-format-drawer-close"),
    btnUnderline: requireElement("btn-underline"),
    btnStrike: requireElement("btn-strike"),
    btnToggleCharacterSection: requireElement("btn-toggle-character-section"),
    btnToggleParagraphSection: requireElement("btn-toggle-paragraph-section"),
    selectFontFamily: requireElement("select-font-family"),
    selectFontSize: requireElement("select-font-size"),
    inputTextColor: requireElement("input-text-color"),
    btnClearTextColor: requireElement("btn-clear-text-color"),
    inputHighlight: requireElement("input-highlight"),
    btnClearHighlight: requireElement("btn-clear-highlight"),
    btnClearCharacterFormat: requireElement("btn-clear-character-format"),
    btnAlignLeft: requireElement("btn-align-left"),
    btnAlignCenter: requireElement("btn-align-center"),
    btnAlignRight: requireElement("btn-align-right"),
    btnAlignJustify: requireElement("btn-align-justify"),
    selectLineHeight: requireElement("select-line-height"),
    selectSpacingBefore: requireElement("select-spacing-before"),
    selectSpacingAfter: requireElement("select-spacing-after"),
    selectTextIndent: requireElement("select-text-indent"),
    selectIndentLeft: requireElement("select-indent-left"),
    selectIndentRight: requireElement("select-indent-right"),
    btnClearParagraphFormat: requireElement("btn-clear-paragraph-format"),
    findBar: requireElement("find-bar"),
    findInput: requireElement("find-input"),
    findCaseSensitive: requireElement("find-case-sensitive"),
    btnFindPrev: requireElement("btn-find-prev"),
    btnFindNext: requireElement("btn-find-next"),
    findCount: requireElement("find-count"),
    replaceInput: requireElement("replace-input"),
    btnReplace: requireElement("btn-replace"),
    btnReplaceAll: requireElement("btn-replace-all"),
    btnFindClose: requireElement("btn-find-close"),
    contextMenu: requireElement("context-menu"),
    btnCtxCut: requireElement("ctx-cut"),
    btnCtxCopy: requireElement("ctx-copy"),
    btnCtxPaste: requireElement("ctx-paste"),
    btnCtxPastePlain: requireElement("ctx-paste-plain"),
    btnCtxLinkCreate: requireElement("ctx-link-create"),
    ctxLinkGroup: requireElement("ctx-link-group"),
    btnCtxLinkOpen: requireElement("ctx-link-open"),
    btnCtxLinkEdit: requireElement("ctx-link-edit"),
    btnCtxLinkRemove: requireElement("ctx-link-remove"),
    linkPopover: requireElement("link-popover"),
    btnLinkOpen: requireElement("link-open"),
    btnLinkEdit: requireElement("link-edit"),
    btnLinkRemove: requireElement("link-remove"),
    apiBaseUrlInput: requireElement("api-base-url"),
    apiBaseUrlError: requireElement("api-base-url-error"),
    apiKeyInput: requireElement("api-key"),
    apiKeyError: requireElement("api-key-error"),
    modelNameInput: requireElement("model-name"),
    modelNameError: requireElement("model-name-error"),
    maxTokensInput: requireElement("max-tokens"),
    maxTokensError: requireElement("max-tokens-error"),
    llmSaveStatus: requireElement("llm-save-status"),
    btnSaveConfig: requireElement("btn-save-config"),
    btnTestConfig: requireElement("btn-test-config"),
    btnBackConfig: requireElement("btn-back-config"),
    btnToggleAi,
    aiDock: {
      root: aiDock,
      rail: aiDockRail,
      count: requireElement("ai-dock-count"),
      notice: requireElement("ai-dock-notice"),
      body: requireElement("ai-dock-body"),
      floatLayer: requireElement("ai-dock-float-layer"),
      windowTemplate: requireElement<HTMLTemplateElement>("ai-window-template"),
      listToggleBtn: requireElement<HTMLButtonElement>("ai-conversation-list-toggle"),
      newConversationBtn: requireElement<HTMLButtonElement>("ai-new-conversation"),
      moreBtn: requireElement<HTMLButtonElement>("ai-dock-more"),
      collapseBtn: requireElement<HTMLButtonElement>("ai-dock-collapse"),
      conversationList: requireElement("ai-conversation-list"),
      conversationListCloseBtn: requireElement<HTMLButtonElement>("ai-conversation-list-close"),
      conversationListItems: requireElement("ai-conversation-list-items"),
      conversationListEmpty: requireElement("ai-conversation-list-empty"),
      listNewConversationBtn: requireElement<HTMLButtonElement>("ai-list-new-conversation"),
      searchInput: requireElement<HTMLInputElement>("ai-conversation-list-filter"),
      railNewBtn: requireElement<HTMLButtonElement>("ai-rail-new"),
      railListBtn: requireElement<HTMLButtonElement>("ai-rail-list"),
      railMoreBtn: requireElement<HTMLButtonElement>("ai-rail-more"),
      railExpandBtn: requireElement<HTMLButtonElement>("ai-rail-expand"),
      railDot: requireElement("ai-rail-dot"),
    },
    leaveDialog: requireElement("leave-dialog"),
    btnSaveAndLeave: requireElement("btn-save-and-leave"),
    btnDiscardAndLeave: requireElement("btn-discard-and-leave"),
    btnCancelLeave: requireElement("btn-cancel-leave"),
  };
}
