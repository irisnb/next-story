import type { AppDom } from "./dom.ts";
import { LeaveCoordinator, type LeaveChoice } from "./leave-guard.ts";
import { LlmConfigUiState, type LlmConfigReturnPage } from "./llm-config-state.ts";
import { loadLlmConfig, saveLlmConfig, testLlmConnection } from "./project-api.ts";
import type { LlmConfig } from "./types.ts";
import { showPage } from "./views.ts";

export interface LlmConfigController {
  open(returnPage: LlmConfigReturnPage): void;
  hasUnsavedChanges(): boolean;
  save(): Promise<boolean>;
  guardLeave(): Promise<boolean>;
}

export interface LlmConfigFormServices {
  chooseLeave(): Promise<LeaveChoice>;
  loadConfig(): Promise<LlmConfig | null>;
  saveConfig(config: LlmConfig): Promise<void>;
  testConnection(config: LlmConfig): Promise<void>;
}

export function setupLlmConfigForm(
  dom: AppDom,
  pages: HTMLElement[],
  overrides: Partial<LlmConfigFormServices> = {},
): LlmConfigController {
  const services: LlmConfigFormServices = {
    chooseLeave: async () => "cancel",
    loadConfig: loadLlmConfig,
    saveConfig: saveLlmConfig,
    testConnection: testLlmConnection,
    ...overrides,
  };
  const uiState = new LlmConfigUiState();
  const leave = new LeaveCoordinator({
    isDirty: hasUnsavedChanges,
    choose: chooseLeave,
    save,
  });

  function hideError(element: HTMLElement): void {
    element.classList.add("hidden");
    element.textContent = "";
  }

  function showError(element: HTMLElement, message: string): void {
    element.textContent = message;
    element.classList.remove("hidden");
  }

  function setStatus(message: string, kind: "idle" | "saving" | "error" = "idle"): void {
    dom.llmSaveStatus.textContent = message;
    dom.llmSaveStatus.className =
      "save-status" + (kind === "error" ? " error" : kind === "saving" ? " saving" : "");
  }

  function validateForm(): boolean {
    const url = dom.apiBaseUrlInput.value.trim();
    const key = dom.apiKeyInput.value.trim();
    const model = dom.modelNameInput.value.trim();
    let valid = true;

    if (!url) {
      showError(dom.apiBaseUrlError, "请填写 API 地址");
      valid = false;
    } else {
      hideError(dom.apiBaseUrlError);
    }

    if (!key) {
      showError(dom.apiKeyError, "请填写 API Key");
      valid = false;
    } else {
      hideError(dom.apiKeyError);
    }

    if (!model) {
      showError(dom.modelNameError, "请填写模型名");
      valid = false;
    } else {
      hideError(dom.modelNameError);
    }

    const disabled = uiState.controlsDisabled(valid);
    dom.btnSaveConfig.disabled = disabled;
    dom.btnTestConfig.disabled = disabled;
    const fieldsDisabled = uiState.fieldsDisabled();
    dom.apiBaseUrlInput.disabled = fieldsDisabled;
    dom.apiKeyInput.disabled = fieldsDisabled;
    dom.modelNameInput.disabled = fieldsDisabled;
    return valid;
  }

  function currentConfig(): LlmConfig {
    return {
      api_base_url: dom.apiBaseUrlInput.value.trim(),
      api_key: dom.apiKeyInput.value,
      model: dom.modelNameInput.value.trim(),
    };
  }

  function hasUnsavedChanges(): boolean {
    return uiState.hasUnsavedChanges(currentConfig());
  }

  async function chooseLeave(): Promise<LeaveChoice> {
    const choice = await services.chooseLeave();
    if (choice === "discard-and-leave") {
      uiState.discardChanges();
    }
    return choice;
  }

  async function loadSaved(generation: number): Promise<void> {
    try {
      const saved = await services.loadConfig();
      const completion = uiState.completeRefresh(generation);
      if (!completion.isCurrent) {
        return;
      }

      if (completion.shouldApply) {
        dom.apiBaseUrlInput.value = saved?.api_base_url ?? "";
        dom.apiKeyInput.value = saved?.api_key ?? "";
        dom.modelNameInput.value = saved?.model ?? "";
        uiState.commitBaseline(currentConfig());
        setStatus(saved ? "已加载已保存配置" : "未保存");
      } else {
        setStatus("已保留当前输入");
      }
    } catch (error) {
      const completion = uiState.completeRefresh(generation);
      if (completion.isCurrent) {
        setStatus(`加载配置失败: ${String(error)}`, "error");
      }
    } finally {
      validateForm();
    }
  }

  async function save(): Promise<boolean> {
    const valid = validateForm();
    if (!uiState.beginOperation(valid)) {
      return false;
    }

    validateForm();
    setStatus("正在保存...", "saving");

    try {
      const config = currentConfig();
      await services.saveConfig(config);
      uiState.commitBaseline(config);
      setStatus("已保存");
      return true;
    } catch (error) {
      setStatus(`保存失败: ${String(error)}`, "error");
      return false;
    } finally {
      uiState.endOperation();
      validateForm();
    }
  }

  async function handleSave(): Promise<void> {
    await save();
  }

  async function handleTest(): Promise<void> {
    const valid = validateForm();
    if (!uiState.beginOperation(valid)) {
      return;
    }

    validateForm();
    setStatus("正在测试连接...", "saving");

    try {
      await services.testConnection(currentConfig());
      setStatus("连接测试成功");
    } catch (error) {
      setStatus(`连接测试失败: ${String(error)}`, "error");
    } finally {
      uiState.endOperation();
      validateForm();
    }
  }

  function handleInput(): void {
    uiState.markDirty();
    validateForm();
  }

  function open(returnPage: LlmConfigReturnPage): void {
    const generation = uiState.beginOpen(returnPage);
    showPage(pages, "llm-config-page");
    setStatus("正在加载...", "saving");
    validateForm();
    void loadSaved(generation);
  }

  async function handleBack(): Promise<void> {
    if (await leave.run()) {
      showPage(pages, uiState.returnPage);
    }
  }

  dom.btnSaveConfig.addEventListener("click", handleSave);
  dom.btnTestConfig.addEventListener("click", handleTest);
  dom.btnBackConfig.addEventListener("click", () => { void handleBack(); });
  dom.apiBaseUrlInput.addEventListener("input", handleInput);
  dom.apiKeyInput.addEventListener("input", handleInput);
  dom.modelNameInput.addEventListener("input", handleInput);

  return {
    open,
    hasUnsavedChanges,
    save,
    guardLeave: () => leave.run(),
  };
}
