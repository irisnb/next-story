import { getCurrentWindow } from "@tauri-apps/api/window";

import { CloseCoordinator, composeCloseGuards } from "./close-guard";
import { getAppDom } from "./dom";
import { setupEditor } from "./editor";
import { setupFileManagement } from "./file-management";
import { setupLeaveDialog } from "./leave-dialog";
import { setupLlmConfigForm } from "./llm-config-form";
import { setupProjectFlow } from "./new-project-form";
import { setupAiFeature } from "./ai-feature";
import { showModule, showPage, type ModuleId, type ModuleViews } from "./views";
import type { ProjectTreeState } from "./types";

window.addEventListener("DOMContentLoaded", () => {
  const dom = getAppDom();
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage];
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
  const fileManagement = setupFileManagement(dom, {
    onTreeChanged: (tree) => editor.applyTree(tree),
  });

  const llmConfig = setupLlmConfigForm(dom, {
    chooseLeave: leaveDialog.choose,
    showSettings: () => setModule("settings"),
    backToWriting: () => setModule("writing"),
  });

  const ai = setupAiFeature(dom, {
    getCurrentDocumentId: () => editor.getCurrentDocumentId(),
    getCurrentEditor: () => editor.getCurrentEditor(),
    openConfigPage: () => llmConfig.open(),
  });
  editor.attachAi(ai);

  /** 切换模块：离开设置模块前先守卫未保存的 LLM 配置修改。 */
  async function requestModule(moduleId: ModuleId): Promise<void> {
    if (activeModule === "settings" && moduleId !== "settings") {
      if (!await llmConfig.guardLeave()) return;
    }
    setModule(moduleId);
  }

  dom.tabWriting.addEventListener("click", () => { void requestModule("writing"); });
  dom.tabFiles.addEventListener("click", () => { void requestModule("files"); });
  dom.tabSettings.addEventListener("click", () => llmConfig.open());

  function openProject(projectState: ProjectTreeState): void {
    fileManagement.showProject(projectState);
    editor.showProject(projectState)
      .then(() => setModule("writing"))
      .catch((error) => {
        console.error("打开作品失败:", error);
        alert(`打开作品失败: ${String(error)}`);
      });
  }

  dom.btnBackWelcome.addEventListener("click", async () => {
    if (await editor.guardLeave()) {
      showPage(pages, "welcome-page");
      editor.unload();
      fileManagement.unload();
    }
  });

  setupProjectFlow(dom, {
    onProjectReady: openProject,
    guardLeave: editor.guardLeave,
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
  const close = new CloseCoordinator({
    isDirty: closeGuard.isDirty,
    guardLeave: closeGuard.guardLeave,
    destroy: () => appWindow.destroy(),
    reportError: reportCloseError,
  });
  void appWindow.onCloseRequested(async (event) => {
    await close.run(() => event.preventDefault());
  }).catch(reportCloseError);
});
