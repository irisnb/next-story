import { getAppDom } from "./dom";
import { setupEditor } from "./editor";
import { setupProjectFlow } from "./new-project-form";
import { setupLlmConfigForm } from "./llm-config-form";

window.addEventListener("DOMContentLoaded", () => {
  const dom = getAppDom();
  const editor = setupEditor(dom);
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage, dom.llmConfigPage];
  const llmConfig = setupLlmConfigForm(dom, pages);

  dom.btnLlmConfig.addEventListener("click", () => llmConfig.open("welcome-page"));
  dom.btnSettings.addEventListener("click", () => llmConfig.open("editor-page"));

  setupProjectFlow(dom, {
    onProjectReady: editor.showProject,
  });
});
