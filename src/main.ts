import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  CloseCoordinator,
  composeCloseGuards,
  createApplicationDestroyer,
} from "./close-guard";
import { getAppDom } from "./dom";
import { setupEditor } from "./editor";
import { setupExportWord } from "./export-word";
import { setupFileManagement } from "./file-management";
import { setupLeaveDialog } from "./leave-dialog";
import { setupLlmConfigForm } from "./llm-config-form";
import { setupWorkspaceProjectFlow } from "./workspace-project-flow";
import { createWorkspaceTreeReceiver } from "./workspace-tree-flow";
import { setupAiFeature } from "./ai-feature";
import { waitTiming } from "./ai-timing";
import { canonicalNotebookJson } from "./structured-notebook";
import { showModule, type ModuleId, type ModuleViews } from "./views";
import { hiddenDocumentIdsFromTree } from "./types";

function currentDocumentVersion(editor: ReturnType<typeof setupEditor>): string | null {
  const current = editor.getCurrentEditor();
  if (!current) return null;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonicalNotebookJson(current.getDocument()))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

// 等待计时采集仅供真实接入验证（第 10 组）：暴露到 devtools 控制台取数。
(globalThis as Record<string, unknown>).__waitTiming = waitTiming;

window.addEventListener("DOMContentLoaded", () => {
  const dom = getAppDom();
  const moduleViews: ModuleViews = {
    writing: dom.moduleWriting,
    files: dom.moduleFiles,
    settings: dom.moduleSettings,
  };
  const leaveDialog = setupLeaveDialog(dom);

  let activeModule: ModuleId = "writing";

  function setModule(moduleId: ModuleId): void {
    activeModule = moduleId;
    showModule(moduleViews, moduleId);
    dom.tabWriting.classList.toggle("active", moduleId === "writing");
    dom.tabFiles.classList.toggle("active", moduleId === "files");
    dom.tabSettings.classList.toggle("active", moduleId === "settings");
  }

  const editor = setupEditor(dom, leaveDialog);
  // 延迟绑定：文件树结构变化（含 AI 可见性切换）后，同步重算已打开讨论的材料限制。
  let ai: ReturnType<typeof setupAiFeature> | null = null;
  const fileManagement = setupFileManagement(dom, {
    onTreeChanged: createWorkspaceTreeReceiver(editor, () => { ai?.recomputeRestrictions(); }),
  });

  const exportWord = setupExportWord(dom, {
    getProjectPath: () => editor.getProjectPath(),
    getProjectName: () => {
      const state = editor.getTree();
      return state === null ? null : dom.currentProjectName.textContent;
    },
    hasUnsavedChanges: () => editor.hasUnsavedChanges(),
  });

  const llmConfig = setupLlmConfigForm(dom, {
    chooseLeave: leaveDialog.choose,
    showSettings: () => { if (!projectFlow.isBusy()) setModule("settings"); },
    backToWriting: () => { if (!projectFlow.isBusy()) setModule("writing"); },
  });

  ai = setupAiFeature(dom, {
    getCurrentDocumentId: () => editor.getCurrentDocumentId(),
    getCurrentEditor: () => editor.getCurrentEditor(),
    openConfigPage: () => llmConfig.open(),
    getCurrentProjectPath: () => editor.getProjectPath(),
    getCurrentDocumentVersion: () => currentDocumentVersion(editor),
    getCurrentTree: () => editor.getTree(),
    getCurrentDocumentTitle: () => {
      const tree = editor.getTree();
      const documentId = editor.getCurrentDocumentId();
      if (tree === null || documentId === null) return null;
      return tree.nodes[documentId]?.name ?? null;
    },
  }, {
    // 集成点：从当前作品树实时派生「不允许 AI 查看」的文档 ID 集合。
    getHiddenDocumentIds: () => hiddenDocumentIdsFromTree(editor.getTree()),
  });
  editor.attachAi(ai);

  /** 切换模块：离开设置模块前先守卫未保存的 LLM 配置修改。 */
  async function requestModule(moduleId: ModuleId): Promise<void> {
    if (projectFlow.isBusy()) return;
    if (activeModule === "settings" && moduleId !== "settings") {
      if (!await llmConfig.guardLeave()) return;
    }
    if (!projectFlow.isBusy()) setModule(moduleId);
  }

  dom.tabWriting.addEventListener("click", () => { void requestModule("writing"); });
  dom.tabFiles.addEventListener("click", () => { void requestModule("files"); });
  dom.tabSettings.addEventListener("click", () => { if (!projectFlow.isBusy()) llmConfig.open(); });

  const projectFlow = setupWorkspaceProjectFlow(dom, {
    editor, files: fileManagement,
    showWriting: () => setModule("writing"),
    unloadExport: () => exportWord.unload(),
  });

  const appWindow = getCurrentWindow();
  const reportCloseError = (error: unknown): void => {
    console.error("关闭窗口失败:", error);
    alert(`关闭窗口失败：${String(error)}`);
  };
  const closeGuard = composeCloseGuards([
    { isDirty: editor.hasUnsavedChanges, guardLeave: editor.guardLeave },
    { isDirty: llmConfig.hasUnsavedChanges, guardLeave: llmConfig.guardLeave },
  ]);
  const destroyApplication = createApplicationDestroyer({
    drainSaves: () => ai?.drainPendingSaves() ?? Promise.resolve(),
    destroyAi: () => ai?.destroy(),
    destroyEditor: () => { projectFlow.destroy(); editor.destroy(); },
    destroyWindow: () => appWindow.destroy(),
  });
  const close = new CloseCoordinator({
    isDirty: closeGuard.isDirty,
    guardLeave: closeGuard.guardLeave,
    destroy: destroyApplication,
    reportError: reportCloseError,
  });
  void appWindow.onCloseRequested(async (event) => {
    await close.run(() => event.preventDefault());
  }).catch(reportCloseError);
});
