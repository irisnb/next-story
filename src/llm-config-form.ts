import type { AppDom } from "./dom.ts";
import { LeaveCoordinator, type LeaveChoice } from "./leave-guard.ts";
import { LlmConfigUiState } from "./llm-config-state.ts";
import { loadLlmConfig, saveLlmConfig, testLlmConnection } from "./project-api.ts";
import type { LlmConfig, LlmConfigSummary } from "./types.ts";

export interface LlmConfigController {
  open(): void;
  hasUnsavedChanges(): boolean;
  save(): Promise<boolean>;
  guardLeave(): Promise<boolean>;
}

export interface LlmConfigFormServices {
  chooseLeave(): Promise<LeaveChoice>;
  /** 进入设置模块（由导航层负责显示设置模块视图）。 */
  showSettings(): void;
  /** 离开设置模块，返回写作模块（保存/放弃/取消后）。 */
  backToWriting(): void;
  loadConfig(): Promise<LlmConfigSummary | null>;
  saveConfig(config: LlmConfig): Promise<void>;
  testConnection(config: LlmConfig): Promise<void>;
}

/**
 * 密钥输入区显示的固定掩码：后端绝不回读明文密钥，加载后只以掩码表示「已保存」。
 * 用户点击该输入框时会自动清空掩码，允许输入新密钥；空输入则复用钥匙串旧密钥。
 */
export const KEY_MASK = "••••••••";

export function setupLlmConfigForm(
  dom: AppDom,
  overrides: Partial<LlmConfigFormServices> = {},
): LlmConfigController {
  const services: LlmConfigFormServices = {
    chooseLeave: async () => "cancel",
    showSettings: () => {},
    backToWriting: () => {},
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

  /** 掩码视为「未输入新密钥」，返回空串；其余原样返回（不 trim，保留用户输入）。 */
  function enteredKey(): string {
    return dom.apiKeyInput.value === KEY_MASK ? "" : dom.apiKeyInput.value;
  }

  function validateForm(): boolean {
    const url = dom.apiBaseUrlInput.value.trim();
    const key = dom.apiKeyInput.value;
    const model = dom.modelNameInput.value.trim();
    let valid = true;

    if (!url) {
      showError(dom.apiBaseUrlError, "请填写 API 地址");
      valid = false;
    } else {
      hideError(dom.apiBaseUrlError);
    }

    // 密钥合法条件：用户输入了新密钥，或已有已保存密钥可被后端复用（空输入/掩码均可）。
    const hasEnteredKey = key !== KEY_MASK && key.trim() !== "";
    if (!hasEnteredKey && !uiState.hasSavedKey()) {
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

  /** 只有用户主动输入新密钥时才在保存/测试载荷里携带 `api_key`。 */
  function currentConfig(): LlmConfig {
    const key = enteredKey();
    const config: LlmConfig = {
      api_base_url: dom.apiBaseUrlInput.value.trim(),
      model: dom.modelNameInput.value.trim(),
    };
    if (key !== "") config.api_key = key;
    return config;
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

  /** 加载后只回填非敏感字段；密钥区显示掩码而非真实密钥。 */
  function applyLoadedConfig(saved: LlmConfigSummary | null): void {
    dom.apiBaseUrlInput.value = saved?.api_base_url ?? "";
    dom.modelNameInput.value = saved?.model ?? "";
    dom.apiKeyInput.value = saved?.has_api_key ? KEY_MASK : "";
  }

  async function loadSaved(generation: number): Promise<void> {
    try {
      const saved = await services.loadConfig();
      const completion = uiState.completeRefresh(generation);
      if (!completion.isCurrent) {
        return;
      }

      if (completion.shouldApply) {
        applyLoadedConfig(saved);
        uiState.commitBaseline(currentConfig(), saved?.has_api_key ?? false);
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
      // 保存成功后把密钥输入还原为掩码：后端不会把明文密钥回读给前端。
      if (dom.apiKeyInput.value !== KEY_MASK) {
        dom.apiKeyInput.value = uiState.hasSavedKey() ? KEY_MASK : "";
      }
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

  function open(): void {
    const generation = uiState.beginOpen();
    services.showSettings();
    setStatus("正在加载...", "saving");
    validateForm();
    void loadSaved(generation);
  }

  async function handleBack(): Promise<void> {
    if (await leave.run()) {
      services.backToWriting();
    }
  }

  dom.btnSaveConfig.addEventListener("click", handleSave);
  dom.btnTestConfig.addEventListener("click", handleTest);
  dom.btnBackConfig.addEventListener("click", () => { void handleBack(); });
  dom.apiBaseUrlInput.addEventListener("input", handleInput);
  dom.apiKeyInput.addEventListener("input", handleInput);
  dom.modelNameInput.addEventListener("input", handleInput);
  // 聚焦掩码输入框时清空掩码，让用户直接输入新密钥，而不是把新密钥追加到掩码后面。
  dom.apiKeyInput.addEventListener("focus", () => {
    if (dom.apiKeyInput.value === KEY_MASK) {
      dom.apiKeyInput.value = "";
    }
  });

  return {
    open,
    hasUnsavedChanges,
    save,
    guardLeave: () => leave.run(),
  };
}
