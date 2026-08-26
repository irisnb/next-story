/**
 * AI 面板的显式 DOM 依赖契约：面板渲染、折叠、思维扩展、错误恢复与临时追问
 * 所需的全部节点，由 `getAppDom()` 在应用启动接线处集中解析和校验。
 *
 * 面板模块只消费本契约，不再执行散落的全局节点查询；契约不包含任何向作品
 * 文档写入、插入、替换或删除的接口（AI 输出只落在面板临时显示区域）。
 */
export interface AiPanelDom {
  panel: HTMLElement;
  panelBody: HTMLElement;
  snapshotBlock: HTMLElement;
  snapshotText: HTMLPreElement;
  loading: HTMLElement;
  response: HTMLPreElement;
  thinkingExpansionPrestate: HTMLElement;
  thinkingExpansionTitle: HTMLElement;
  thinkingExpansionCount: HTMLElement;
  thinkingExpansionForm: HTMLFormElement;
  thinkingExpansionInput: HTMLTextAreaElement;
  thinkingExpansionStart: HTMLButtonElement;
  errorBlock: HTMLElement;
  errorMessage: HTMLElement;
  retryBtn: HTMLButtonElement;
  configBlock: HTMLElement;
  goConfigBtn: HTMLButtonElement;
  collapseBtn: HTMLButtonElement;
  newConversationBtn: HTMLButtonElement;
  toggleBtn: HTMLButtonElement;
  conversation: HTMLElement;
  followUpForm: HTMLFormElement;
  followUpInput: HTMLTextAreaElement;
  followUpSend: HTMLButtonElement;
  followUpError: HTMLElement;
  followUpErrorMessage: HTMLElement;
  followUpRetry: HTMLButtonElement;
  followUpEdit: HTMLButtonElement;
  directQuestion: HTMLElement;
  directQuestionSelection: HTMLElement;
  directQuestionSelectionText: HTMLPreElement;
  directQuestionSelectionRemove: HTMLButtonElement;
  directQuestionForm: HTMLFormElement;
  directQuestionInput: HTMLTextAreaElement;
  directQuestionSend: HTMLButtonElement;
  directQuestionLoading: HTMLElement;
  directQuestionResponse: HTMLPreElement;
  directQuestionError: HTMLElement;
  directQuestionErrorMessage: HTMLElement;
  directQuestionConfig: HTMLElement;
  directQuestionGoConfig: HTMLButtonElement;
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
  aiPanel: HTMLElement;
  aiResponse: HTMLPreElement;
  aiConversation: HTMLElement;
  aiFollowUpForm: HTMLFormElement;
  aiFollowUpInput: HTMLTextAreaElement;
  aiFollowUpSend: HTMLButtonElement;
  aiPanelDom: AiPanelDom;
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

function requirePanelBody(panel: HTMLElement): HTMLElement {
  const body = panel.querySelector<HTMLElement>(".ai-panel-body");

  if (!body) {
    throw new Error("Missing required element: .ai-panel-body");
  }

  return body;
}

export function getAppDom(): AppDom {
  const aiPanel = requireElement("ai-panel");
  const aiResponse = requireElement<HTMLPreElement>("ai-response");
  const btnToggleAi = requireElement<HTMLButtonElement>("btn-toggle-ai");
  const aiConversation = requireElement("ai-conversation");
  const aiFollowUpForm = requireElement<HTMLFormElement>("ai-follow-up-form");
  const aiFollowUpInput = requireElement<HTMLTextAreaElement>("ai-follow-up-input");
  const aiFollowUpSend = requireElement<HTMLButtonElement>("ai-follow-up-send");

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
    aiPanel,
    aiResponse,
    aiConversation,
    aiFollowUpForm,
    aiFollowUpInput,
    aiFollowUpSend,
    aiPanelDom: {
      panel: aiPanel,
      panelBody: requirePanelBody(aiPanel),
      snapshotBlock: requireElement("ai-snapshot-block"),
      snapshotText: requireElement<HTMLPreElement>("ai-snapshot-text"),
      loading: requireElement("ai-loading"),
      response: aiResponse,
      thinkingExpansionPrestate: requireElement("ai-thinking-expansion-prestate"),
      thinkingExpansionTitle: requireElement("ai-thinking-expansion-title"),
      thinkingExpansionCount: requireElement("ai-thinking-expansion-count"),
      thinkingExpansionForm: requireElement<HTMLFormElement>("ai-thinking-expansion-form"),
      thinkingExpansionInput: requireElement<HTMLTextAreaElement>("ai-thinking-expansion-input"),
      thinkingExpansionStart: requireElement<HTMLButtonElement>("ai-thinking-expansion-start"),
      errorBlock: requireElement("ai-error-block"),
      errorMessage: requireElement("ai-error-message"),
      retryBtn: requireElement<HTMLButtonElement>("ai-retry"),
      configBlock: requireElement("ai-config-block"),
      goConfigBtn: requireElement<HTMLButtonElement>("ai-go-config"),
      collapseBtn: requireElement<HTMLButtonElement>("ai-panel-collapse"),
      newConversationBtn: requireElement<HTMLButtonElement>("ai-new-conversation"),
      toggleBtn: btnToggleAi,
      conversation: aiConversation,
      followUpForm: aiFollowUpForm,
      followUpInput: aiFollowUpInput,
      followUpSend: aiFollowUpSend,
      followUpError: requireElement("ai-follow-up-error"),
      followUpErrorMessage: requireElement("ai-follow-up-error-message"),
      followUpRetry: requireElement<HTMLButtonElement>("ai-follow-up-retry"),
      followUpEdit: requireElement<HTMLButtonElement>("ai-follow-up-edit"),
      directQuestion: requireElement("ai-direct-question"),
      directQuestionSelection: requireElement("ai-direct-question-selection"),
      directQuestionSelectionText: requireElement<HTMLPreElement>("ai-direct-question-selection-text"),
      directQuestionSelectionRemove: requireElement<HTMLButtonElement>("ai-direct-question-selection-remove"),
      directQuestionForm: requireElement<HTMLFormElement>("ai-direct-question-form"),
      directQuestionInput: requireElement<HTMLTextAreaElement>("ai-direct-question-input"),
      directQuestionSend: requireElement<HTMLButtonElement>("ai-direct-question-send"),
      directQuestionLoading: requireElement("ai-direct-question-loading"),
      directQuestionResponse: requireElement<HTMLPreElement>("ai-direct-question-response"),
      directQuestionError: requireElement("ai-direct-question-error"),
      directQuestionErrorMessage: requireElement("ai-direct-question-error-message"),
      directQuestionConfig: requireElement("ai-direct-question-config"),
      directQuestionGoConfig: requireElement<HTMLButtonElement>("ai-direct-question-go-config"),
    },
    leaveDialog: requireElement("leave-dialog"),
    btnSaveAndLeave: requireElement("btn-save-and-leave"),
    btnDiscardAndLeave: requireElement("btn-discard-and-leave"),
    btnCancelLeave: requireElement("btn-cancel-leave"),
  };
}
