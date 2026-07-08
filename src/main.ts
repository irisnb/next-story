import { getAppDom } from "./dom";
import { setupEditor } from "./editor";
import { setupProjectFlow } from "./new-project-form";

window.addEventListener("DOMContentLoaded", () => {
  const dom = getAppDom();
  const editor = setupEditor(dom);

  setupProjectFlow(dom, {
    onProjectReady: editor.showProject,
  });
});
