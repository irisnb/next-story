import type { AppDom } from "./dom";
import { LlmConfigUiState, type LlmConfigReturnPage } from "./llm-config-state";
import { loadLlmConfig, saveLlmConfig, testLlmConnection } from "./project-api";
import type { LlmConfig } from "./types";
import { showPage } from "./views";

export interface LlmConfigController {
  open(returnPage: LlmConfigReturnPage): void;
}

export function setupLlmConfigForm(dom: AppDom, pages: HTMLElement[]): LlmConfigController {
  const uiState = new LlmConfigUiState();

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

  async function loadSaved(generation: number): Promise<void> {
    try {
      const saved = await loadLlmConfig();
      const completion = uiState.completeRefresh(generation);
      if (!completion.isCurrent) {
        return;
      }

      if (completion.shouldApply) {
        dom.apiBaseUrlInput.value = saved?.api_base_url ?? "";
        dom.apiKeyInput.value = saved?.api_key ?? "";
        dom.modelNameInput.value = saved?.model ?? "";
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

  async function handleSave(): Promise<void> {
    const valid = validateForm();
    if (!uiState.beginOperation(valid)) {
      return;
    }

    validateForm();
    setStatus("正在保存...", "saving");

    try {
      await saveLlmConfig(currentConfig());
      setStatus("已保存");
    } catch (error) {
      setStatus(`保存失败: ${String(error)}`, "error");
    } finally {
      uiState.endOperation();
      validateForm();
    }
  }

  async function handleTest(): Promise<void> {
    const valid = validateForm();
    if (!uiState.beginOperation(valid)) {
      return;
    }

    validateForm();
    setStatus("正在测试连接...", "saving");

    try {
      await testLlmConnection(currentConfig());
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

  dom.btnSaveConfig.addEventListener("click", handleSave);
  dom.btnTestConfig.addEventListener("click", handleTest);
  dom.btnBackConfig.addEventListener("click", () => showPage(pages, uiState.returnPage));
  dom.apiBaseUrlInput.addEventListener("input", handleInput);
  dom.apiKeyInput.addEventListener("input", handleInput);
  dom.modelNameInput.addEventListener("input", handleInput);

  return { open };
}
