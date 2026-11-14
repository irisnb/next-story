import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check as checkForUpdates } from "@tauri-apps/plugin-updater";
import { installNativeDialogs, showMessage } from "./app-dialog.ts";

import {
  CloseCoordinator,
  composeCloseGuards,
  createApplicationDestroyer,
  runLeaveGuard,
} from "./close-guard";
import { getAppDom } from "./dom";
import { setupEditor } from "./editor";
import { setupExport } from "./export";
import { setupFileManagement } from "./file-management";
import { setupFirstRunGuide } from "./first-run-guide";
import { setupHelpSection } from "./help-section";
import { setupLeaveDialog } from "./leave-dialog";
import { setupLlmConfigForm } from "./llm-config-form";
import { setupMaking } from "./making/making-module";
import { createDefaultTrialWorkSource } from "./making/making-trial-controller";
import { openUrl, stopDriverForUpdate } from "./project-api";
import { createUpdateDialog, UPDATE_DOWNLOAD_PAGE_URL } from "./update-dialog";
import { setupUpdateEntry } from "./update-section";
import { setupWorkspaceProjectFlow } from "./workspace-project-flow";
import { createWorkspaceTreeReceiver } from "./workspace-tree-flow";
import { setupAiFeature } from "./ai-feature";
import { canonicalNotebookJson } from "./structured-notebook";
import { showModule, type ModuleId, type ModuleViews } from "./views";
import { hiddenDocumentIdsFromTree } from "./types";
import { setupUiV5 } from "./ui-v5";

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

window.addEventListener("DOMContentLoaded", () => {
  installNativeDialogs();
  const dom = getAppDom();
  const disposeUiV5 = setupUiV5();
  const moduleViews: ModuleViews = {
    writing: dom.moduleWriting,
    files: dom.moduleFiles,
    settings: dom.moduleSettings,
    making: dom.moduleMaking,
  };
  const leaveDialog = setupLeaveDialog(dom);

  let activeModule: ModuleId = "writing";

  // 制作模块第四页面（add-making-module-core 任务 7.1）：页面控制器自持状态，
  // 进入页面时重读链路库（状态条只反映全局当前链路）。
  // 试问的试用环境直连编辑器（替换默认源的「DOM＋最近作品」自证）：resolve 读
  // editor.getProjectPath()——闭包延迟求值，调用发生在用户交互时，编辑器已创建；
  // 文档列举与默认关注文档沿用默认实现。
  const defaultTrialWork = createDefaultTrialWorkSource();
  const making = setupMaking(dom.making, {
    trialWork: {
      ...defaultTrialWork,
      async resolve() {
        const workPath = editor.getProjectPath();
        if (workPath === null) {
          return {
            status: "unavailable" as const,
            reason: "还没有打开的作品。试问要以一个真实作品为试用环境，请先打开或新建一个作品。",
          };
        }
        return {
          status: "ok" as const,
          workPath,
          workTitle: (dom.currentProjectName.textContent ?? "").trim(),
        };
      },
    },
  });

  function setModule(moduleId: ModuleId): void {
    activeModule = moduleId;
    showModule(moduleViews, moduleId);
    dom.tabWriting.classList.toggle("active", moduleId === "writing");
    dom.tabFiles.classList.toggle("active", moduleId === "files");
    dom.tabSettings.classList.toggle("active", moduleId === "settings");
    dom.tabMaking.classList.toggle("active", moduleId === "making");
    // 制作页隐藏作品保存与 AI 面板入口：链路对所有作品共用，
    // 避免误解为单作品设置（制作页内 AI 浮窗也随写作模块一并隐藏）。
    dom.btnSave.classList.toggle("hidden", moduleId === "making");
    dom.btnToggleAi.classList.toggle("hidden", moduleId === "making");
    if (moduleId === "making") void making.refresh();
  }

  const editor = setupEditor(dom, leaveDialog);
  // 延迟绑定：文件树结构变化（含 AI 可见性切换）后，同步重算已打开讨论的材料限制。
  let ai: ReturnType<typeof setupAiFeature> | null = null;
  const fileManagement = setupFileManagement(dom, {
    onTreeChanged: createWorkspaceTreeReceiver(editor, () => { ai?.recomputeRestrictions(); }),
    async onOpenDocument(documentId, identity) {
      const current = editor.getProjectIdentity();
      if (!current || current.projectPath !== identity.projectPath || current.loadGeneration !== identity.loadGeneration) return;
      await editor.switchDocument(documentId);
      const latest = editor.getProjectIdentity();
      if (latest?.projectPath === identity.projectPath && latest.loadGeneration === identity.loadGeneration && editor.getCurrentDocumentId() === documentId) setModule("writing");
    },
  });

  const exportController = setupExport(dom, {
    getProjectPath: () => editor.getProjectPath(),
    getProjectName: () => {
      const state = editor.getTree();
      return state === null ? null : dom.currentProjectName.textContent;
    },
    getTree: () => editor.getTree(),
    getCurrentDocumentId: () => editor.getCurrentDocumentId(),
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
  dom.tabMaking.addEventListener("click", () => { void requestModule("making"); });

  const projectFlow = setupWorkspaceProjectFlow(dom, {
    editor, files: fileManagement,
    showWriting: () => setModule("writing"),
    unloadExport: () => exportController.unload(),
  });

  // 首启引导：无完成标记时自动弹出，仅此一次（重看入口在设置 → 帮助，重放不写标记）。
  const firstRunGuide = setupFirstRunGuide(dom.firstRunGuide);
  setupHelpSection(dom.helpSection, { openReplayGuide: () => firstRunGuide.open("replay") });
  firstRunGuide.open("first-run");

  const appWindow = getCurrentWindow();
  const reportCloseError = (error: unknown): void => {
    console.error("关闭窗口失败:", error);
    showMessage(`关闭窗口失败：${String(error)}`);
  };
  const closeGuard = composeCloseGuards([
    { isDirty: editor.hasUnsavedChanges, guardLeave: editor.guardLeave },
    { isDirty: llmConfig.hasUnsavedChanges, guardLeave: llmConfig.guardLeave },
  ]);
  const destroyApplication = createApplicationDestroyer({
    drainSaves: () => ai?.drainPendingSaves() ?? Promise.resolve(),
    destroyAi: () => ai?.destroy(),
    destroyEditor: () => { disposeUiV5(); projectFlow.destroy(); editor.destroy(); },
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

  // 应用内更新（add-auto-updater）：对话框只经软件更新分区入口或手动检查打开；
  // Update 对象为内存单例，仅本次运行有效、不做任何持久化。
  let updateEntry: ReturnType<typeof setupUpdateEntry> | null = null;
  const updateDialog = createUpdateDialog({
    checkUpdates: () => checkForUpdates(),
    openDownloadPage: () => { void openUrl(UPDATE_DOWNLOAD_PAGE_URL); },
    // 安装前走与正常退出相同的离开守卫（脏文档三选一；取消＝中止安装不退出）。
    runLeaveGuard: () => runLeaveGuard(closeGuard),
    preparation: {
      // 守卫通过后的准备期：沿用离开守卫同款 inert 手法阻止产生新的未保存
      // 修改，并排空 AI 讨论保存；失败自恢复并交由对话框回到就绪状态。
      async prepare(): Promise<boolean> {
        dom.editorTextarea.inert = true;
        try {
          await (ai?.drainPendingSaves() ?? Promise.resolve());
          return true;
        } catch (error) {
          console.error("更新安装准备失败:", error);
          dom.editorTextarea.inert = false;
          return false;
        }
      },
      restore(): void {
        dom.editorTextarea.inert = false;
      },
    },
    // 安装前显式停止 DSH sidecar（design D5 修正）：准备成功后、触发安装前执行；
    // 失败由对话框按准备失败处理（恢复现场、保留就绪状态、可重试）。
    stopDriver: () => stopDriverForUpdate(),
    onEntryState: (snapshot) => updateEntry?.setUpdateView(snapshot),
    reportError: (error) => console.error("更新流程出错:", error),
  });
  updateEntry = setupUpdateEntry(dom.updateSection, {
    openUpdate: () => updateDialog.openEntry(),
  });
  void getVersion().then(
    (version) => updateEntry.renderVersion(version),
    () => updateEntry.renderVersion(null),
  );
  // 启动静默检查：失败与无更新完全静默；发现新版只设置软件更新分区入口标记，
  // 不弹窗、不移动焦点、不覆盖首启引导。
  void updateDialog.startupCheck();
});
