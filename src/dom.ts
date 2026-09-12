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
  readonly badge: HTMLElement;
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
  currentProjectName: HTMLElement;
  saveStatus: HTMLElement;
  btnSave: HTMLButtonElement;
  btnBackWelcome: HTMLButtonElement;
  tabWriting: HTMLButtonElement;
  tabFiles: HTMLButtonElement;
  tabSettings: HTMLButtonElement;
  moduleWriting: HTMLElement;
  moduleFiles: HTMLElement;
  moduleSettings: HTMLElement;
  editorTextarea: HTMLElement;
  currentDocToggle: HTMLButtonElement;
  currentDocumentName: HTMLElement;
  documentList: HTMLElement;
  writingEmptyState: HTMLElement;
  btnExportWord: HTMLButtonElement;
  fmNewDocument: HTMLButtonElement;
  fmNewFolder: HTMLButtonElement;
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
  btnToolbarUnderline: HTMLButtonElement;
  btnToolbarStrike: HTMLButtonElement;
  btnUndo: HTMLButtonElement;
  btnRedo: HTMLButtonElement;
  btnFind: HTMLButtonElement;
  btnMargin: HTMLButtonElement;
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

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }

  return element as T;
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
    badge: requireRole(root, "badge"),
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
    currentProjectName: requireElement("current-project-name"),
    saveStatus: requireElement("save-status"),
    btnSave: requireElement("btn-save"),
    btnBackWelcome: requireElement("btn-back-welcome"),
    tabWriting: requireElement("tab-writing"),
    tabFiles: requireElement("tab-files"),
    tabSettings: requireElement("tab-settings"),
    moduleWriting: requireElement("module-writing"),
    moduleFiles: requireElement("module-files"),
    moduleSettings: requireElement("module-settings"),
    editorTextarea: requireElement("editor-textarea"),
    currentDocToggle: requireElement("current-doc-toggle"),
    currentDocumentName: requireElement("current-document-name"),
    documentList: requireElement("document-list"),
    writingEmptyState: requireElement("writing-empty-state"),
    btnExportWord: requireElement("btn-export-word"),
    fmNewDocument: requireElement("fm-new-document"),
    fmNewFolder: requireElement("fm-new-folder"),
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
    btnToolbarUnderline: requireElement("btn-toolbar-underline"),
    btnToolbarStrike: requireElement("btn-toolbar-strike"),
    btnUndo: requireElement("btn-undo"),
    btnRedo: requireElement("btn-redo"),
    btnFind: requireElement("btn-find"),
    btnMargin: requireElement("btn-margin"),
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
