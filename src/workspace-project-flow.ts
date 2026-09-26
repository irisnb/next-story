import type { AppDom } from "./dom.ts";
import { showMessage } from "./app-dialog.ts";
import type { EditorController, WorkspaceTransition } from "./editor.ts";
import type { FileManagementController } from "./file-management.ts";
import { setupProjectFlow } from "./new-project-form.ts";
import { createProject, openContentTree, openProject, recordRecentWork, loadRecentWorks, type RecentWorkEntry } from "./project-api.ts";
import type { ContentTree, ProjectOpenResult } from "./types.ts";
import { showPage } from "./views.ts";

/** main 与装配测试共用的生产接线；测试只能替换磁盘/窗口等外部服务。 */
export function setupWorkspaceProjectFlow(dom: AppDom, options: {
  editor: EditorController;
  files: FileManagementController;
  showWriting(): void;
  unloadExport(): void;
  services?: Partial<{
    openContentTree(projectPath: string): Promise<ContentTree>;
    createProject(name: string, location: string): Promise<string>;
    openProject(projectPath: string): Promise<ProjectOpenResult>;
    recordRecentWork(name: string, projectPath: string): Promise<void>;
    loadRecentWorks(): Promise<RecentWorkEntry[]>;
  }>;
}) {
  const { editor, files } = options;
  const services = { openContentTree, recordRecentWork, createProject, openProject, loadRecentWorks, ...options.services };
  let transition: WorkspaceTransition | null = null;
  let destroyed = false;
  let welcomeBusy = false;
  const navigation = [dom.tabWriting, dom.tabFiles, dom.tabSettings, dom.btnBackWelcome];
  let previousDisabled: boolean[] | null = null;
  const unsubscribe = editor.onTransitionChanged((busy) => {
    files.setWorkspacePaused(busy);
    if (busy && previousDisabled === null) {
      previousDisabled = navigation.map((button) => button.disabled);
      for (const button of navigation) { button.disabled = true; }
    } else if (!busy && previousDisabled !== null) {
      navigation.forEach((button, index) => { button.disabled = previousDisabled![index]; });
      previousDisabled = null;
    }
  });
  const flow = setupProjectFlow(dom, {
    services,
    isBusy: () => destroyed || welcomeBusy || editor.isTransitioning(),
    isCurrent: () => !destroyed && (transition === null || transition.isCurrent()),
    async protect(target) {
      transition = editor.beginWorkspaceTransition(target);
      if (!transition) throw new Error("正在处理上一次切换，请完成后再操作。");
      await transition.protect();
    },
    guardLeave: () => transition!.authorize(),
    async onProjectReady(project) {
      const owner = transition;
      if (!owner?.isCurrent()) throw new Error("作品装载已失效");
      // 已授权保存后才重取同路径的新树；正文始终由 prepare 在保存后读取。
      if (editor.getProjectPath() === project.projectPath) {
        await files.waitForPendingWrites();
        if (!owner.isCurrent()) throw new Error("作品装载已失效");
        project = { ...project, tree: await services.openContentTree(project.projectPath) };
      }
      if (!owner.isCurrent()) throw new Error("作品装载已失效");
      const peer = files.prepareProject(project);
      const candidate = await owner.prepare(peer.project);
      try {
        // commit 无 await；peer 在编辑器发布视图/记忆/AI 之前安装。
        candidate.commit(peer.commit);
      } finally { candidate.dispose(); }
      options.showWriting();
      void services.recordRecentWork(project.projectName, project.projectPath).catch((error) => {
        console.error("记录最近作品失败:", error);
      });
    },
    release() { const owner = transition; transition = null; owner?.release(); },
  });

  async function backToWelcome() {
    if (destroyed || welcomeBusy || flow.isBusy()) return { status: "busy" } as const;
    const owner = editor.beginWorkspaceTransition("欢迎页");
    if (!owner) return { status: "busy" } as const;
    welcomeBusy = true;
    try {
      await owner.protect();
      if (!await owner.authorize()) return { status: "cancelled" } as const;
      owner.unload(() => { files.unload(); options.unloadExport(); });
      showPage([dom.welcomePage, dom.newProjectPage, dom.editorPage], "welcome-page");
      void flow.refreshRecentWorks();
      return { status: "committed" } as const;
    } catch (error) {
      if (!owner.isCurrent() || destroyed) return { status: "stale" } as const;
      showMessage(`未能返回欢迎页：${String(error)}`);
      return { status: "failed", error } as const;
    } finally { welcomeBusy = false; owner.release(); }
  }
  const onBack = () => { void backToWelcome(); };
  dom.btnBackWelcome.addEventListener("click", onBack);
  return {
    ...flow, backToWelcome,
    isBusy: () => destroyed || welcomeBusy || flow.isBusy(),
    destroy() {
      destroyed = true;
      // 先使编辑器候选失效，再释放入口，避免迟到读取复活页面。
      editor.unload(); files.unload(); flow.destroy(); unsubscribe();
      dom.btnBackWelcome.removeEventListener("click", onBack);
    },
  };
}
