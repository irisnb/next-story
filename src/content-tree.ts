import type { ContentTree, ContentTreeNode } from "./types.ts";

/**
 * 按 `root_children` 顺序展开整棵内容树，收集所有文档节点（扁平、不含文件夹层级）。
 * 写作页的极简切换列表与「第一篇文档」回退都依赖此顺序。
 */
export function flattenDocuments(tree: ContentTree): ContentTreeNode[] {
  const result: ContentTreeNode[] = [];
  const visit = (id: string): void => {
    const node = tree.nodes[id];
    if (!node) return;
    if (node.kind === "Document") {
      result.push(node);
      return;
    }
    for (const childId of node.children) visit(childId);
  };
  for (const id of tree.root_children) visit(id);
  return result;
}

/** 内容树中的第一篇文档；无任何文档时返回 null。 */
export function firstDocument(tree: ContentTree): ContentTreeNode | null {
  return flattenDocuments(tree)[0] ?? null;
}

/** 某个 ID 是否仍在回收站中（回收站内文档已从 `nodes` 移除）。 */
export function isInRecycleBin(tree: ContentTree, id: string): boolean {
  return tree.recycle_bin.some((entry) =>
    Object.prototype.hasOwnProperty.call(entry.nodes, id),
  );
}

/** 某个 ID 是否为内容树中「仍在、未被删除」的文档节点。 */
export function isDocumentInTree(tree: ContentTree, id: string): boolean {
  const node = tree.nodes[id];
  return node !== undefined && node.kind === "Document" && !isInRecycleBin(tree, id);
}

export interface ResolvedCurrentDocument {
  /** 选中的当前文档 ID；无任何文档时为 null。 */
  documentId: string | null;
  /** 记忆指向的文档已失效（需要清除记忆）。 */
  invalidMemory: boolean;
}

/**
 * 打开作品时确定当前文档：记忆的 ID 仍在树中则用它；否则回退到第一篇文档，
 * 并标记记忆失效（供调用方清除）。
 */
export function resolveCurrentDocument(
  tree: ContentTree,
  rememberedId: string | null,
): ResolvedCurrentDocument {
  if (rememberedId !== null && isDocumentInTree(tree, rememberedId)) {
    return { documentId: rememberedId, invalidMemory: false };
  }
  const first = firstDocument(tree);
  return { documentId: first?.id ?? null, invalidMemory: rememberedId !== null };
}

/** 展开整棵内容树，收集所有文件夹节点（用于移动目标候选）。 */
export function collectFolders(tree: ContentTree): ContentTreeNode[] {
  const result: ContentTreeNode[] = [];
  const visit = (id: string): void => {
    const node = tree.nodes[id];
    if (!node) return;
    if (node.kind === "Folder") result.push(node);
    for (const childId of node.children) visit(childId);
  };
  for (const id of tree.root_children) visit(id);
  return result;
}

export interface MoveTarget {
  /** 目标父级 ID；null 表示根级。 */
  value: string | null;
  label: string;
}

/**
 * 计算某个节点可移动到的父级候选（根级 + 所有文件夹），
 * 排除节点自身与它的全部后代，避免循环与自身移动。
 */
export function moveTargets(tree: ContentTree, nodeId: string): MoveTarget[] {
  const descendants = new Set<string>();
  const collectDescendants = (id: string): void => {
    const node = tree.nodes[id];
    if (!node) return;
    for (const childId of node.children) {
      descendants.add(childId);
      collectDescendants(childId);
    }
  };
  collectDescendants(nodeId);

  const targets: MoveTarget[] = [{ value: null, label: "根级" }];
  for (const folder of collectFolders(tree)) {
    if (folder.id === nodeId || descendants.has(folder.id)) continue;
    targets.push({ value: folder.id, label: folder.name });
  }
  return targets;
}
