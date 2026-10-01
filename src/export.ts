import type { AppDom } from "./dom.ts";
import { showMessage } from "./app-dialog.ts";
import {
  exportProject,
  type ExportFileResult,
  type ExportFormat,
  type ExportScope,
} from "./project-api.ts";
import type { ContentTree, ContentTreeNode } from "./types.ts";

/** 对话框确认后的导出请求（格式 + 范围 + 建议文件名）。 */
export interface ExportRequest {
  format: ExportFormat;
  scope: ExportScope;
  fileName: string;
}

/** 导出链服务：对话框与执行两个阶段都可注入替换（测试用）。 */
export interface ExportServices {
  /** 打开导出对话框，返回确认的导出请求；取消返回 null。 */
  openDialog(): Promise<ExportRequest | null>;
  /** 对话框确认后的执行阶段：原生保存对话框 + 后端导出命令。 */
  runExport(
    format: ExportFormat,
    projectPath: string,
    scope: ExportScope,
    fileName: string,
  ): Promise<ExportFileResult>;
}

export interface ExportController {
  unload(): void;
}

type ExportDom = Pick<
  AppDom,
  | "btnExport"
  | "exportDialog"
  | "exportFormatOptions"
  | "exportScope"
  | "exportFilename"
  | "btnExportConfirm"
  | "btnExportCancel"
>;

export const DEFAULT_EXPORT_FORMAT: ExportFormat = "word";

/** 范围选择器的选项值编码：`current`（当前文档）/ `work` / `folder:<id>`。 */
export type ScopeOptionValue = "current" | "work" | `folder:${string}`;

export interface ScopeOption {
  value: ScopeOptionValue;
  label: string;
  /** 该选项对应的范围（无当前文档时 current 选项不生成）。 */
  scope: ExportScope;
  /** 范围根名称（文件名建议）。 */
  rootName: string;
  selectedByDefault?: boolean;
}

/**
 * 从内容树构造范围选择器选项：当前文档（默认）→ 整个作品 → 各文件夹（按树序、
 * 全角空格缩进表示层级）。无当前文档时省略「当前文档」选项，默认整个作品。
 */
export function buildScopeOptions(
  tree: ContentTree,
  currentDocumentId: string | null,
  projectName: string,
): ScopeOption[] {
  const options: ScopeOption[] = [];
  const current = currentDocumentId === null ? null : tree.nodes[currentDocumentId] ?? null;
  if (current !== null && current.kind === "Document") {
    options.push({
      value: "current",
      label: `当前文档：${current.name}`,
      scope: { type: "document", id: current.id },
      rootName: current.name,
      selectedByDefault: true,
    });
  }
  options.push({
    value: "work",
    label: "整个作品",
    scope: { type: "work" },
    rootName: projectName,
    selectedByDefault: current === null,
  });
  const appendFolders = (ids: readonly string[], depth: number): void => {
    for (const id of ids) {
      const node = tree.nodes[id];
      if (!node || node.kind !== "Folder") continue;
      options.push({
        value: `folder:${node.id}`,
        label: `${"　".repeat(depth)}📁 ${node.name}`,
        scope: { type: "folder", id: node.id },
        rootName: node.name,
      });
      appendFolders(node.children, depth + 1);
    }
  };
  appendFolders(tree.root_children, 0);
  return options;
}

/** 解析范围选择器选项值为范围对象；无法识别时返回 null（含无意义的 current 占位）。 */
export function scopeFromOptionValue(value: string): ExportScope | null {
  if (value === "work") return { type: "work" };
  if (value.startsWith("folder:")) {
    const id = value.slice("folder:".length);
    return id === "" ? null : { type: "folder", id };
  }
  return null;
}

/**
 * 判断导出范围是否包含当前文档：作品恒包含；文档范围即该文档本身；文件夹范围
 * 包含其嵌套子树内的所有文档。未保存提示只在该值为真且编辑器有未保存修改时出现
 * ——范围不含当前文档时，当前编辑器的未保存状态与导出无关，提示纯属噪音。
 */
export function scopeIncludesCurrentDocument(
  scope: ExportScope,
  tree: ContentTree,
  currentDocumentId: string | null,
): boolean {
  if (currentDocumentId === null) return false;
  if (scope.type === "work") return true;
  if (scope.type === "document") return scope.id === currentDocumentId;
  const contains = (node: ContentTreeNode | undefined): boolean => {
    if (!node) return false;
    if (node.id === currentDocumentId) return true;
    return node.children.some((childId) => contains(tree.nodes[childId]));
  };
  return contains(tree.nodes[scope.id]);
}

/**
 * 统一导出入口：「导出」按钮打开导出对话框（格式三选一，默认 Word；范围三选一，
 * 默认当前文档；文件名按范围自动建议、可改）→ 原生保存对话框 → 调用后端导出。
 * 防重、取消静默、成功 / 失败提示语义逐条沿用旧「导出 Word」实现；未保存提示
 * 收窄为仅当导出范围包含当前文档且该文档有未保存修改时出现。
 * 导出只读取后端已保存版本。
 */
export function setupExport(
  dom: ExportDom,
  options: {
    getProjectPath(): string | null;
    getProjectName(): string | null;
    getTree(): ContentTree | null;
    getCurrentDocumentId(): string | null;
    hasUnsavedChanges(): boolean;
    services?: Partial<ExportServices>;
  },
): ExportController {
  /** DOM 版对话框实现（默认）：刷新选项 → showModal → 等确认 / 取消。 */
  function defaultOpenDialog(): Promise<ExportRequest | null> {
    refreshDialog();
    return new Promise((resolve) => {
      const dialog = dom.exportDialog;
      let settled = false;

      const finish = (request: ExportRequest | null): void => {
        if (settled) return;
        settled = true;
        dialog.close();
        resolve(request);
      };

      const onConfirm = (): void => {
        const format = selectedFormat();
        const option = currentOption();
        if (option === null) return;
        const fileName = dom.exportFilename.value.trim() || option.rootName;
        finish({ format, scope: option.scope, fileName });
      };
      const onCancel = (): void => finish(null);
      // Esc / 点击 backdrop 触发 dialog 的 cancel 事件：与点「取消」同样静默。
      const onDialogCancel = (event: Event): void => {
        event.preventDefault();
        finish(null);
      };

      dom.btnExportConfirm.addEventListener("click", onConfirm, { once: true });
      dom.btnExportCancel.addEventListener("click", onCancel, { once: true });
      dialog.addEventListener("cancel", onDialogCancel, { once: true });
      dialog.showModal();
    });
  }

  const services: ExportServices = {
    openDialog: defaultOpenDialog,
    runExport: exportProject,
    ...options.services,
  };
  let exporting = false;
  /** 最近一次刷新进对话框的范围选项（确认时按选项值取回范围与建议名）。 */
  let latestScopeOptions: ScopeOption[] = [];

  function selectedFormat(): ExportFormat {
    const checked = dom.exportFormatOptions.querySelector<HTMLInputElement>(
      "input[name=\"export-format\"]:checked",
    );
    return (checked?.value as ExportFormat | undefined) ?? DEFAULT_EXPORT_FORMAT;
  }

  function currentOption(): ScopeOption | null {
    return latestScopeOptions.find((option) => option.value === dom.exportScope.value) ?? null;
  }

  /** 重建范围选项与文件名建议（每次打开对话框时按当前树刷新）。 */
  function refreshDialog(): void {
    const tree = options.getTree();
    const projectName = options.getProjectName();
    if (tree === null || projectName === null) return;

    const scopeOptions = buildScopeOptions(
      tree,
      options.getCurrentDocumentId(),
      projectName,
    );
    latestScopeOptions = scopeOptions;
    dom.exportScope.innerHTML = "";
    for (const option of scopeOptions) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      element.selected = option.selectedByDefault === true;
      dom.exportScope.appendChild(element);
    }

    const defaultOption =
      scopeOptions.find((option) => option.selectedByDefault) ?? scopeOptions[0];
    if (defaultOption) dom.exportFilename.value = defaultOption.rootName;
  }

  async function runExport(): Promise<void> {
    if (exporting) return;
    const projectPath = options.getProjectPath();
    if (projectPath === null) return;

    // 从对话框打开到后端导出完成整段防重：模态期间按钮同时进入忙碌态。
    exporting = true;
    dom.btnExport.disabled = true;
    const originalText = dom.btnExport.textContent;
    dom.btnExport.textContent = "导出中...";
    try {
      const request = await services.openDialog();
      if (request === null) {
        // 用户关闭导出对话框：不生成文件，也不显示错误。
        return;
      }

      const tree = options.getTree();
      if (
        tree !== null &&
        options.hasUnsavedChanges() &&
        scopeIncludesCurrentDocument(request.scope, tree, options.getCurrentDocumentId())
      ) {
        showMessage("当前有尚未保存的修改。导出使用后端已保存版本，不包含未保存内容。");
      }

      const result = await services.runExport(
        request.format,
        projectPath,
        request.scope,
        request.fileName,
      );
      if (result.cancelled) {
        // 用户取消保存对话框：不生成文件，也不显示错误。
        return;
      }
      if (result.ok && result.path) {
        showMessage(`导出成功：${result.path}`);
      } else {
        showMessage(`导出失败：${result.message ?? "未知错误"}`);
      }
    } catch (error) {
      showMessage(`导出失败：${String(error)}`);
    } finally {
      exporting = false;
      dom.btnExport.disabled = false;
      dom.btnExport.textContent = originalText;
    }
  }

  dom.btnExport.addEventListener("click", () => {
    void runExport();
  });

  return {
    unload(): void {
      exporting = false;
      dom.btnExport.disabled = false;
    },
  };
}
