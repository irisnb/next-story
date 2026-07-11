import { getCurrentWindow } from "@tauri-apps/api/window";

import { CloseCoordinator } from "./close-guard";
import { getAppDom } from "./dom";
import { setupEditor } from "./editor";
import { setupLeaveDialog } from "./leave-dialog";
import { setupLlmConfigForm } from "./llm-config-form";
import { setupProjectFlow } from "./new-project-form";
import { showPage } from "./views";

window.addEventListener("DOMContentLoaded", () => {
  const dom = getAppDom();
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage, dom.llmConfigPage];
  const leaveDialog = setupLeaveDialog(dom);
  const editor = setupEditor(dom, leaveDialog);
  const llmConfig = setupLlmConfigForm(dom, pages);

  dom.btnLlmConfig.addEventListener("click", () => llmConfig.open("welcome-page"));
  dom.btnSettings.addEventListener("click", () => llmConfig.open("editor-page"));
  dom.btnBackWelcome.addEventListener("click", async () => {
    if (await editor.guardLeave()) {
      showPage(pages, "welcome-page");
      editor.unload();
    }
  });

  setupProjectFlow(dom, {
    onProjectReady: editor.showProject,
    guardLeave: editor.guardLeave,
  });

  const appWindow = getCurrentWindow();
  const reportCloseError = (error: unknown): void => {
    console.error("关闭窗口失败:", error);
    alert(`关闭窗口失败：${String(error)}`);
  };
  const close = new CloseCoordinator({
    isDirty: editor.hasUnsavedChanges,
    guardLeave: editor.guardLeave,
    destroy: () => appWindow.destroy(),
    reportError: reportCloseError,
  });
  void appWindow.onCloseRequested(async (event) => {
    await close.run(() => event.preventDefault());
  }).catch(reportCloseError);
});
