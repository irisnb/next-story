import type { AppDom } from "./dom.ts";
import {
  moveTargets,
  type MoveTarget,
} from "./content-tree.ts";
import {
  createDocument,
  createFolder,
  deleteNode,
  moveNode,
  openContentTree,
  renameNode,
  restoreNode,
} from "./project-api.ts";
import type { ContentTree, ProjectTreeState } from "./types.ts";

export interface FileManagementServices {
  openContentTree(projectPath: string): Promise<ContentTree>;
  createDocument(projectPath: string, parent: string | null): Promise<string>;
  createFolder(projectPath: string, parent: string | null): Promise<string>;
  renameNode(projectPath: string, id: string, name: string): Promise<void>;
  moveNode(projectPath: string, id: string, newParent: string | null): Promise<void>;
  deleteNode(projectPath: string, id: string): Promise<void>;
  restoreNode(projectPath: string, id: string): Promise<void>;
}

export interface FileManagementController {
  showProject(projectState: ProjectTreeState): void;
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
};

type FileManagementDom = Pick<
  AppDom,
  "fmNewDocument" | "fmNewFolder" | "fmStatus" | "fmFileTree" | "fmOpenRecycleBin" |
  "fmRecycleBin" | "fmBackFromRecycle" | "fmRecycleList"
>;

export function setupFileManagement(
  dom: FileManagementDom,
  options: {
    /** 结构操作后通知宿主（编辑器）刷新其持有的树。 */
    onTreeChanged(tree: ContentTree): void;
    services?: Partial<FileManagementServices>;
  },
): FileManagementController {
  const services: FileManagementServices = { ...defaultServices, ...options.services };
  let projectPath: string | null = null;
  let tree: ContentTree | null = null;
  let view: "tree" | "recycle" = "tree";
  /** 展开中的文件夹 ID 集合（主文件树）。 */
  const expanded = new Set<string>();

  function setStatus(message: string, kind: "idle" | "busy" | "error" = "idle"): void {
    dom.fmStatus.textContent = message;
    dom.fmStatus.className = "fm-status" + (kind === "error" ? " error" : kind === "busy" ? " busy" : "");
  }

  async function refreshTree(): Promise<void> {
    if (projectPath === null) return;
    const next = await services.openContentTree(projectPath);
    tree = next;
    options.onTreeChanged(next);
    render();
  }

  async function runOperation(op: () => Promise<unknown>): Promise<void> {
    if (projectPath === null) return;
    setStatus("正在处理...", "busy");
    try {
      await op();
      await refreshTree();
      setStatus("", "idle");
    } catch (error) {
      setStatus(String(error), "error");
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
    void runOperation(() => services.renameNode(projectPath as string, id, name));
  }

  function startMove(id: string, currentParent: string | null): void {
    if (tree === null) return;
    const targets = moveTargets(tree, id);
    const select = makeSelect(targets, currentParent);
    const apply = makeButton("确定", () => {
      const value = select.value === "" ? null : select.value;
      void runOperation(() => services.moveNode(projectPath as string, id, value));
    });
    const cancel = makeButton("取消", () => render());
    const row = dom.fmFileTree.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    const actions = row?.querySelector<HTMLElement>(".file-actions");
    if (!actions) return;
    actions.replaceChildren(select, apply, cancel);
  }

  function renderNodeRow(container: HTMLElement, id: string, depth: number): void {
    if (tree === null) return;
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
        void runOperation(() => services.createDocument(projectPath as string, id));
      }));
      actions.appendChild(makeButton("新建文件夹", () => {
        expanded.add(id);
        void runOperation(() => services.createFolder(projectPath as string, id));
      }));
    }
    actions.appendChild(makeButton("重命名", () => startRename(id, node.name)));
    actions.appendChild(makeButton("移动", () => startMove(id, parentOf(id))));
    actions.appendChild(makeButton("删除", () => {
      void runOperation(() => services.deleteNode(projectPath as string, id));
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
        void runOperation(() => services.restoreNode(projectPath as string, entry.root_id));
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
    void runOperation(() => services.createDocument(projectPath as string, null));
  });
  dom.fmNewFolder.addEventListener("click", () => {
    void runOperation(() => services.createFolder(projectPath as string, null));
  });
  dom.fmOpenRecycleBin.addEventListener("click", openRecycleBin);
  dom.fmBackFromRecycle.addEventListener("click", backFromRecycle);

  return {
    showProject(projectState: ProjectTreeState): void {
      projectPath = projectState.projectPath;
      tree = projectState.tree;
      expanded.clear();
      view = "tree";
      render();
      setStatus("", "idle");
    },
    unload(): void {
      projectPath = null;
      tree = null;
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
