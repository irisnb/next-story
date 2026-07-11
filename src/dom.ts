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
  tabDraft: HTMLButtonElement;
  tabMain: HTMLButtonElement;
  draftTextarea: HTMLTextAreaElement;
  mainTextarea: HTMLTextAreaElement;
  llmConfigPage: HTMLElement;
  btnLlmConfig: HTMLButtonElement;
  btnSettings: HTMLButtonElement;
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

export function getAppDom(): AppDom {
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
    tabDraft: requireElement("tab-draft"),
    tabMain: requireElement("tab-main"),
    draftTextarea: requireElement("draft-textarea"),
    mainTextarea: requireElement("main-textarea"),
    llmConfigPage: requireElement("llm-config-page"),
    btnLlmConfig: requireElement("btn-llm-config"),
    btnSettings: requireElement("btn-settings"),
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
    btnToggleAi: requireElement("btn-toggle-ai"),
    aiPanel: requireElement("ai-panel"),
    aiResponse: requireElement("ai-response"),
    leaveDialog: requireElement("leave-dialog"),
    btnSaveAndLeave: requireElement("btn-save-and-leave"),
    btnDiscardAndLeave: requireElement("btn-discard-and-leave"),
    btnCancelLeave: requireElement("btn-cancel-leave"),
  };
}
