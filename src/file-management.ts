import type { AppDom } from "./dom.ts";
import {
  moveTargets,
  type MoveTarget,
} from "./content-tree.ts";
import {
  conversationsUsingDocument,
  type ConversationUsage,
} from "./conversation-archive.ts";
import {
  createDocument,
  createFolder,
  deleteNode,
  moveNode,
  openContentTree,
  renameNode,
  restoreNode,
  setDocumentAiVisibility,
} from "./project-api.ts";
import type { ContentTree, ProjectLoadIdentity, ProjectTreeState, TreeRefreshAcceptance } from "./types.ts";
import type { SessionResult } from "./editor-document-session.ts";
import { isDocumentAiVisible } from "./types.ts";

export interface FileManagementServices {
  openContentTree(projectPath: string): Promise<ContentTree>;
  createDocument(projectPath: string, parent: string | null): Promise<string>;
  createFolder(projectPath: string, parent: string | null): Promise<string>;
  renameNode(projectPath: string, id: string, name: string): Promise<void>;
  moveNode(projectPath: string, id: string, newParent: string | null): Promise<void>;
  deleteNode(projectPath: string, id: string): Promise<void>;
  restoreNode(projectPath: string, id: string): Promise<void>;
  setDocumentAiVisibility(projectPath: string, documentId: string, visible: boolean): Promise<void>;
  /**
   * 查询使用过指定文档的讨论（add-agent-on-demand-reading 任务 7.5）：关闭该文档
   * AI 可见性前的影响提示数据。缺省实现来自讨论档案车道（只读）。
   */
  conversationsUsingDocument(
    projectPath: string,
    documentId: string,
  ): Promise<ConversationUsage[]>;
}

export interface FileManagementController {
  showProject(projectState: ProjectTreeState): void;
  commitProject(projectState: ProjectTreeState): void;
  prepareProject(projectState: ProjectTreeState): { project: ProjectTreeState; commit(): void };
  setWorkspacePaused(paused: boolean): void;
  waitForPendingWrites(): Promise<void>;
  unload(): void;
}

const defaultServices: FileManagementServices = {
  openContentTree,
  createDocument,
  createFolder,
  renameNode,
  moveNode,
  deleteNode,
  restoreNode,
  setDocumentAiVisibility,
  conversationsUsingDocument,
};

type FileManagementDom = Pick<
  AppDom,
  "fmNewDocument" | "fmNewFolder" | "fmStatus" | "fmFileTree" | "fmOpenRecycleBin" |
  "fmRecycleBin" | "fmBackFromRecycle" | "fmRecycleList"
>;

export function setupFileManagement(
  dom: FileManagementDom,
  options: {
    /** 结构操作后通知宿主（编辑器）刷新其持有的树及其装载身份。 */
    onTreeChanged(tree: ContentTree, identity: ProjectLoadIdentity, acceptance: TreeRefreshAcceptance): Promise<SessionResult> | SessionResult | void;
    services?: Partial<FileManagementServices>;
  },
): FileManagementController {
  const services: FileManagementServices = { ...defaultServices, ...options.services };
  let projectPath: string | null = null;
  let loadGeneration = 0;
  let allocatedLoadGeneration = 0;
  let refreshSequence = 0;
  let operationSequence = 0;
  let statusOwner = 0;
  let tree: ContentTree | null = null;
  let view: "tree" | "recycle" = "tree";
  /** 展开中的文件夹 ID 集合（主文件树）。 */
  const expanded = new Set<string>();
  const pendingWrites = new Set<Promise<unknown>>();
  let workspacePaused = false;
  type TreeCandidate = { identity: ProjectLoadIdentity; request: number; tree: ContentTree; owner?: number };
  let deferredTree: TreeCandidate | null = null;

  async function trackWrite<T>(promise: Promise<T>): Promise<T> {
    pendingWrites.add(promise);
    try { return await promise; } finally { pendingWrites.delete(promise); }
  }

  function currentIdentity(): ProjectLoadIdentity | null {
    return projectPath === null ? null : { projectPath, loadGeneration };
  }

  function owns(identity: ProjectLoadIdentity, operation?: number): boolean {
    return projectPath === identity.projectPath && loadGeneration === identity.loadGeneration &&
      (operation === undefined || operation === operationSequence);
  }

  function setStatus(message: string, kind: "idle" | "busy" | "error" = "idle", owner?: number): void {
    if (owner !== undefined && owner !== statusOwner) return;
    dom.fmStatus.textContent = message;
    dom.fmStatus.className = "fm-status" + (kind === "error" ? " error" : kind === "busy" ? " busy" : "");
  }

  async function refreshTree(owner?: number): Promise<boolean> {
    const identity = currentIdentity();
    if (identity === null) return false;
    const request = ++refreshSequence;
    let next: ContentTree;
    try {
      next = await services.openContentTree(identity.projectPath);
    } catch (error) {
      if (owns(identity, owner) && request === refreshSequence) setStatus(String(error), "error", owner);
      return false;
    }
    if (!owns(identity, owner) || request !== refreshSequence) return false;
    return acceptTree({ identity, request, tree: next, owner });
  }

  async function acceptTree(candidate: TreeCandidate): Promise<boolean> {
    const { identity, request, owner } = candidate;
    const isCurrent = () => owns(identity, owner) && request === refreshSequence;
    if (!isCurrent()) return false;
    if (workspacePaused) { deferredTree = candidate; return false; }
    let committed = false;
    try {
      const result = await options.onTreeChanged(candidate.tree, identity, {
        isCurrent,
        installPeer() {
          if (!isCurrent() || committed) throw new Error("文件树刷新已失效");
          tree = candidate.tree;
          committed = true;
          render();
        },
      });
      if (!isCurrent()) return false;
      if (result?.status === "failed") throw result.error;
      // 取消只结束这次操作；不接受树，也不宣称撤销已完成的磁盘写入。
      if (committed || result?.status === "cancelled") setStatus("", "idle", owner);
      return committed;
    } catch (error) {
      if (isCurrent()) setStatus(String(error), "error", owner);
      return false;
    }
  }

  async function runOperation(identity: ProjectLoadIdentity, op: () => Promise<unknown>): Promise<void> {
    if (!owns(identity) || workspacePaused) return;
    const operation = ++operationSequence;
    statusOwner = operation;
    setStatus("正在处理...", "busy", operation);
    try {
      await trackWrite(op());
      if (!owns(identity, operation)) return;
      const refreshed = await refreshTree(operation);
      if (refreshed && owns(identity, operation)) setStatus("", "idle", operation);
    } catch (error) {
      if (owns(identity, operation)) setStatus(String(error), "error", operation);
    }
  }

  function makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-action-btn";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function makeSelect(targets: MoveTarget[], currentParent: string | null): HTMLSelectElement {
    const select = document.createElement("select");
    select.className = "file-move-select";
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = target.value ?? "";
      option.textContent = target.label;
      if (target.value === currentParent) option.selected = true;
      select.appendChild(option);
    }
    return select;
  }

  function startRename(id: string, currentName: string): void {
    const input = window.prompt("新名称", currentName);
    if (input === null) return;
    const name = input.trim();
    if (name === "" || name === currentName) return;
    const identity = currentIdentity();
    if (identity !== null) void runOperation(identity, () => services.renameNode(identity.projectPath, id, name));
  }

  function startMove(id: string, currentParent: string | null): void {
    const identity = currentIdentity();
    if (tree === null || identity === null) return;
    const targets = moveTargets(tree, id);
    const select = makeSelect(targets, currentParent);
    const apply = makeButton("确定", () => {
      const value = select.value === "" ? null : select.value;
      void runOperation(identity, () => services.moveNode(identity.projectPath, id, value));
    });
    const cancel = makeButton("取消", () => render());
    const row = dom.fmFileTree.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    const actions = row?.querySelector<HTMLElement>(".file-actions");
    if (!actions) return;
    actions.replaceChildren(select, apply, cancel);
  }

  /**
   * 关闭 AI 可见性前的影响提示文案（add-agent-on-demand-reading 任务 7.5）：
   * 明示后果（受影响讨论永久只读、旧出处脱敏），并列出受影响讨论的标题。
   */
  function visibilityImpactMessage(documentName: string, usage: ConversationUsage[]): string {
    const titles = usage.slice(0, 5).map((item) => `「${item.title}」`).join("、");
    const suffix = usage.length > 5 ? "等" : "";
    return (
      `以下 ${usage.length} 个讨论使用过《${documentName}》：${titles}${suffix}。\n` +
      "关闭后这些讨论将永久只读，无法沿原上下文继续；旧的参考出处会脱敏显示。\n" +
      "确定要关闭这篇文档的 AI 可见性吗？"
    );
  }

  /** 查询使用过指定文档的讨论；查询失败时按「有影响」保守处理（失败关闭）。 */
  async function documentUsage(documentId: string, identity: ProjectLoadIdentity): Promise<ConversationUsage[] | null> {
    if (!owns(identity)) return null;
    try {
      const usage = await services.conversationsUsingDocument(identity.projectPath, documentId);
      return owns(identity) ? usage : null;
    } catch {
      return null;
    }
  }

  /**
   * 切换单篇文档的 AI 可见性：成功刷新树；失败保持原状态并显示中文提示。
   * 关闭前先展示受影响讨论的后果说明（永久只读、旧出处脱敏），确认后才执行
   * （任务 7.5）；开启不需要确认。
   */
  async function toggleVisibility(id: string, currentVisible: boolean): Promise<void> {
    const identity = currentIdentity();
    if (identity === null || tree === null || workspacePaused) return;
    const operation = ++operationSequence;
    statusOwner = operation;
    const path = identity.projectPath;
    const next = !currentVisible;
    if (!next) {
      const node = tree.nodes[id];
      const usage = await documentUsage(id, identity);
      if (!owns(identity, operation) || workspacePaused) return;
      // 查询失败（null）时保守拦截：宁可多一次确认，不悄悄关闭。
      if (usage === null || usage.length > 0) {
        const message =
          usage === null
            ? "无法确认有哪些讨论使用过这篇文档。关闭后相关讨论将永久只读、旧出处脱敏。\n确定要关闭吗？"
            : visibilityImpactMessage(node?.name ?? "这篇文档", usage);
        if (!owns(identity, operation) || !window.confirm(message) || !owns(identity, operation)) return;
      }
    }
    if (!owns(identity, operation) || workspacePaused) return;
    setStatus("正在保存 AI 可见性...", "busy", operation);
    try {
      await trackWrite(services.setDocumentAiVisibility(path, id, next));
      if (!owns(identity, operation)) return;
      const refreshed = await refreshTree(operation);
      if (refreshed && owns(identity, operation)) setStatus("", "idle", operation);
    } catch {
      // 失败回滚：不改动本地树，保持原可见性状态，只给中文可读提示。
      if (owns(identity, operation)) setStatus("AI 可见性保存失败，已保持原状态。", "error", operation);
    }
  }

  /** 文档节点的 AI 可见性开关（文件夹不渲染该开关）。 */
  function makeVisibilityToggle(id: string, visible: boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-ai-visibility-toggle";
    button.textContent = visible ? "允许 AI 查看" : "不允许 AI 查看";
    button.addEventListener("click", () => {
      void toggleVisibility(id, visible);
    });
    return button;
  }

  function renderNodeRow(container: HTMLElement, id: string, depth: number): void {
    if (tree === null) return;
    const rowIdentity = currentIdentity();
    if (rowIdentity === null) return;
    const node = tree.nodes[id];
    if (!node) return;

    const row = document.createElement("div");
    row.className = "file-row";
    row.dataset.nodeId = id;
    row.style.paddingLeft = `${depth * 1.5 + 0.75}rem`;

    if (node.kind === "Folder") {
      const isExpanded = expanded.has(id);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "file-expander";
      toggle.textContent = isExpanded ? "▾" : "▸";
      toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      toggle.addEventListener("click", () => {
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        render();
      });
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "file-expander-spacer";
      row.appendChild(spacer);
    }

    const name = document.createElement("span");
    name.className = node.kind === "Folder" ? "file-name file-folder" : "file-name file-document";
    name.textContent = node.name;
    row.appendChild(name);

    const actions = document.createElement("span");
    actions.className = "file-actions";
    if (node.kind === "Folder") {
      actions.appendChild(makeButton("新建文档", () => {
        // 在折叠的文件夹内新建节点后自动展开该文件夹，让新节点立即可见。
        expanded.add(id);
        void runOperation(rowIdentity, () => services.createDocument(rowIdentity.projectPath, id));
      }));
      actions.appendChild(makeButton("新建文件夹", () => {
        expanded.add(id);
        void runOperation(rowIdentity, () => services.createFolder(rowIdentity.projectPath, id));
      }));
    } else {
      // 文档级 AI 可见性开关：只作用于当前文档，文件夹不显示。
      actions.appendChild(makeVisibilityToggle(id, isDocumentAiVisible(node)));
    }
    actions.appendChild(makeButton("重命名", () => startRename(id, node.name)));
    actions.appendChild(makeButton("移动", () => startMove(id, parentOf(id))));
    actions.appendChild(makeButton("删除", () => {
      void runOperation(rowIdentity, () => services.deleteNode(rowIdentity.projectPath, id));
    }));
    row.appendChild(actions);

    container.appendChild(row);

    if (node.kind === "Folder" && expanded.has(id)) {
      const children = document.createElement("div");
      children.className = "file-children";
      for (const childId of node.children) renderNodeRow(children, childId, depth + 1);
      container.appendChild(children);
    }
  }

  function parentOf(id: string): string | null {
    if (tree === null) return null;
    if (tree.root_children.includes(id)) return null;
    for (const node of Object.values(tree.nodes)) {
      if (node.children.includes(id)) return node.id;
    }
    return null;
  }

  function renderFileTree(): void {
    if (tree === null) return;
    dom.fmFileTree.replaceChildren();
    for (const id of tree.root_children) {
      renderNodeRow(dom.fmFileTree, id, 0);
    }
    if (tree.root_children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "file-tree-empty";
      empty.textContent = "这里还没有内容，点击上方「新建文档」或「新建文件夹」开始。";
      dom.fmFileTree.appendChild(empty);
    }
  }

  function renderRecycleBin(): void {
    if (tree === null) return;
    dom.fmRecycleList.replaceChildren();
    if (tree.recycle_bin.length === 0) {
      const empty = document.createElement("div");
      empty.className = "file-tree-empty";
      empty.textContent = "回收站是空的。";
      dom.fmRecycleList.appendChild(empty);
      return;
    }
    for (const entry of tree.recycle_bin) {
      const root = entry.nodes[entry.root_id];
      const row = document.createElement("div");
      row.className = "file-row";
      row.dataset.nodeId = entry.root_id;
      const name = document.createElement("span");
      name.className = root?.kind === "Folder" ? "file-name file-folder" : "file-name file-document";
      name.textContent = root?.name ?? entry.root_id;
      row.appendChild(name);
      const actions = document.createElement("span");
      actions.className = "file-actions";
      actions.appendChild(makeButton("恢复", () => {
        const identity = currentIdentity();
        if (identity !== null) void runOperation(identity, () => services.restoreNode(identity.projectPath, entry.root_id));
      }));
      row.appendChild(actions);
      dom.fmRecycleList.appendChild(row);
    }
  }

  function render(): void {
    if (view === "recycle") {
      dom.fmFileTree.classList.add("hidden");
      dom.fmRecycleBin.classList.remove("hidden");
      renderRecycleBin();
    } else {
      dom.fmRecycleBin.classList.add("hidden");
      dom.fmFileTree.classList.remove("hidden");
      renderFileTree();
    }
  }

  function openRecycleBin(): void {
    view = "recycle";
    render();
  }

  function backFromRecycle(): void {
    view = "tree";
    render();
  }

  dom.fmNewDocument.addEventListener("click", () => {
    const identity = currentIdentity();
    if (identity !== null) void runOperation(identity, () => services.createDocument(identity.projectPath, null));
  });
  dom.fmNewFolder.addEventListener("click", () => {
    const identity = currentIdentity();
    if (identity !== null) void runOperation(identity, () => services.createFolder(identity.projectPath, null));
  });
  dom.fmOpenRecycleBin.addEventListener("click", openRecycleBin);
  dom.fmBackFromRecycle.addEventListener("click", backFromRecycle);

  function commitProject(projectState: ProjectTreeState): void {
    loadGeneration = projectState.loadIdentity?.loadGeneration ?? ++allocatedLoadGeneration;
    refreshSequence += 1;
    operationSequence += 1;
    statusOwner = operationSequence;
    projectPath = projectState.projectPath;
    tree = projectState.tree;
    deferredTree = null;
    expanded.clear();
    view = "tree";
    render();
    setStatus("", "idle");
  }

  return {
    prepareProject(projectState) {
      // 候选期不构建带事件闭包的 DOM；事件必须捕获提交后的装载身份。
      let consumed = false;
      const project = { ...projectState, loadIdentity: { projectPath: projectState.projectPath, loadGeneration: ++allocatedLoadGeneration } };
      return { project, commit() {
        if (consumed) throw new Error("文件管理候选已提交");
        consumed = true;
        commitProject(project);
      } };
    },
    setWorkspacePaused(paused) {
      workspacePaused = paused;
      dom.fmNewDocument.disabled = paused;
      dom.fmNewFolder.disabled = paused;
      // 退出通知先完成，再用原身份/刷新序号重新走同一接受协议，不另造刷新代次。
      if (!paused && deferredTree) {
        const pending = deferredTree; deferredTree = null;
        queueMicrotask(() => { void acceptTree(pending); });
      }
    },
    commitProject(projectState: ProjectTreeState): void {
      commitProject(projectState);
    },
    async waitForPendingWrites(): Promise<void> { await Promise.all([...pendingWrites]); },
    showProject(projectState: ProjectTreeState): void {
      this.commitProject(projectState);
    },
    unload(): void {
      loadGeneration = ++allocatedLoadGeneration;
      refreshSequence += 1;
      operationSequence += 1;
      statusOwner = operationSequence;
      projectPath = null;
      tree = null;
      deferredTree = null;
      expanded.clear();
      view = "tree";
      dom.fmFileTree.replaceChildren();
      dom.fmRecycleList.replaceChildren();
      dom.fmRecycleBin.classList.add("hidden");
      dom.fmFileTree.classList.remove("hidden");
      setStatus("", "idle");
    },
  };
}
