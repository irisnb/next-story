import { showMessage } from "./app-dialog.ts";
import {
  importDocumentCommit,
  importDocumentPreview,
  selectDocumentFile,
  type ImportCommitResult,
  type ImportLoss,
  type ImportPreview,
} from "./project-api.ts";
import type { ContentTree } from "./types.ts";

/**
 * 文档导入预检对话框（add-word-import design D6 建立管线，add-markdown-import、
 * add-fdx-import 先后接入 .md 与 .fdx）：一句话结论 → 可折叠损耗明细（完整呈现、
 * 绝不省略）→ 拆分二选一（默认不拆）→ 目标位置（默认根级）→ 确认导入。
 * 任何一步取消＝零副作用；确认后文件被改动（哈希不一致）时留在对话框内重新预检，
 * 由用户再次拍板。.md 文件额外面呈一行软换行接合说明（add-markdown-import design D3：
 * 该规则不属于损耗、不在损耗清单内，故单独告知）；.fdx 的全部变化都在损耗清单内，
 * 无需额外说明。
 */

/** 后端「预览与提交之间文件已变化」错误的固定前缀（add-word-import design D1）。 */
export const HASH_MISMATCH_PREFIX = "hash_mismatch:";

/**
 * 损耗类型的中文标签——明细完整呈现、绝不省略（简化的是路径，不是诚实）。
 * docx 管线六类（add-word-import）；md 分支六类（add-markdown-import）；
 * fdx 分支六类（add-fdx-import）；保真修复三类（fix-import-fidelity）；
 * 另有跨管线兜底的 block_skipped。
 */
export const IMPORT_LOSS_LABELS: Record<ImportLoss["kind"], string> = {
  table_flattened: "表格拍平保文字",
  image_dropped: "图片丢弃",
  footnote_dropped: "脚注丢弃",
  comment_dropped: "批注丢弃",
  revision_finalized: "修订取最终态",
  numbering_degraded: "编号降级为普通段落",
  code_degraded: "代码降级为纯文字",
  quote_degraded: "引用块降级为普通段落",
  tasklist_degraded: "任务列表转为列表（勾选框保留为文字）",
  hr_dropped: "分隔线丢弃",
  html_stripped: "HTML 标签剥除保文字",
  frontmatter_dropped: "文件头信息剥离",
  dual_dialogue_degraded: "双栏对白拆为先后段落",
  titlepage_inlined: "标题页并入正文开头",
  scene_metadata_dropped: "场景元数据丢弃",
  scriptnote_dropped: "剧注丢弃",
  revision_marks_ignored: "修订标记忽略，文字无损",
  unknown_element_skipped: "未知元素已跳过（不影响文字）",
  list_overflow_degraded: "列表溢出内容降级为普通段落",
  symbol_dropped: "符号字符丢弃",
  style_degraded: "样式属性未解析",
  block_skipped: "无法识别的块跳过",
};

/** 选中 .md 文件时预检对话框呈现的软换行接合说明（add-markdown-import design D3）。 */
export const MARKDOWN_LINE_BREAK_NOTE = "换行按文字接合处理";

/** 判断选中的文件是否 Markdown（决定是否呈现软换行接合说明）。 */
export function isMarkdownFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".md");
}

/** 千位分隔（确定性实现，不依赖运行环境的 toLocaleString 行为）。 */
export function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 预检一句话结论：「共 N 字，全部保留」或「保留 N 字，另有 X 项内容需降级或丢弃」。 */
export function previewConclusion(preview: ImportPreview): string {
  const lossTotal = preview.losses.reduce((sum, loss) => sum + loss.count, 0);
  if (lossTotal === 0) return `共 ${formatCount(preview.char_count)} 字，全部保留`;
  return `保留 ${formatCount(preview.char_count)} 字，另有 ${formatCount(lossTotal)} 处内容需降级或丢弃`;
}

/** 拟创建结构说明，随拆分选择联动（默认整文件一个文档，design D4）。 */
export function structureLine(preview: ImportPreview, split: boolean): string {
  if (split && preview.split_suggestion !== null) {
    return `将新建文件夹《${preview.default_doc_name}》，其下按标记拆分为 ${formatCount(preview.split_suggestion.count)} 个文档`;
  }
  return `整个文件将作为 1 个文档导入：《${preview.default_doc_name}》`;
}

/** 拆分选项的动态文案；无建议时为空（不出现拆分选项）。 */
export function splitOptionLabel(preview: ImportPreview): string {
  const suggestion = preview.split_suggestion;
  if (suggestion === null) return "";
  const count = formatCount(suggestion.count);
  return `按 ${count} 个「${suggestion.marker_sample}」标记拆分为 ${count} 个文档（置于新文件夹）`;
}

/** 单项损耗的展示文本：中文标签＋数量，附后端备注。 */
export function lossItemText(loss: ImportLoss): string {
  const base = `${IMPORT_LOSS_LABELS[loss.kind]}：${formatCount(loss.count)} 处`;
  return loss.note === "" ? base : `${base}（${loss.note}）`;
}

/** 目标位置选项：根级在前（默认），其后按树序缩进列出全部文件夹（与导出范围选择器同风格）。 */
export interface TargetOption {
  /** "" 表示根级（对应后端 `parent_id: null`），其余为文件夹 ID。 */
  value: string;
  label: string;
}

export function buildTargetOptions(tree: ContentTree): TargetOption[] {
  const options: TargetOption[] = [{ value: "", label: "根级（作品顶层）" }];
  const walk = (ids: readonly string[], depth: number): void => {
    for (const id of ids) {
      const node = tree.nodes[id];
      if (!node || node.kind !== "Folder") continue;
      options.push({ value: id, label: `${"　".repeat(depth)}📁 ${node.name}` });
      walk(node.children, depth + 1);
    }
  };
  walk(tree.root_children, 0);
  return options;
}

/** 预检对话框的显式 DOM 依赖契约。 */
export interface DocumentImportDom {
  dialog: HTMLDialogElement;
  /** 一句话结论。 */
  conclusion: HTMLElement;
  /** 拟创建结构说明（随拆分选择联动）。 */
  structure: HTMLElement;
  /** 可折叠损耗明细容器（无损耗时隐藏）。 */
  lossesBlock: HTMLElement;
  lossList: HTMLElement;
  /** 拆分选择字段（无建议时隐藏）。 */
  splitField: HTMLElement;
  /** 「不拆分」单选（默认选中，design D4）。 */
  splitWhole: HTMLInputElement;
  /** 「按标记拆分」单选。 */
  splitByMarker: HTMLInputElement;
  /** 拆分单选的动态文案。 */
  splitMarkerLabel: HTMLElement;
  /** 目标位置（根级＋文件夹，默认根级）。 */
  targetSelect: HTMLSelectElement;
  /** md 文件的软换行接合说明行（仅选中 .md 时可见）。 */
  mdNote: HTMLElement;
  /** 对话框内错误行（哈希不一致等，留场提示）。 */
  errorLine: HTMLElement;
  btnConfirm: HTMLButtonElement;
  btnCancel: HTMLButtonElement;
}

/** 导入链服务：文件选择、预检、提交三个阶段都可注入替换（测试用）。 */
export interface DocumentImportServices {
  /** 打开系统文件选择对话框；取消返回 null。 */
  selectFile(): Promise<string | null>;
  /** 预检（后端只读解析，零副作用）。 */
  preview(projectPath: string, filePath: string): Promise<ImportPreview>;
  /** 提交落盘；哈希不一致时以 `hash_mismatch:` 前缀错误拒绝。 */
  commit(
    projectPath: string,
    filePath: string,
    parentId: string | null,
    split: boolean,
    expectedHash: string,
  ): Promise<ImportCommitResult>;
}

/** 当前作品状态（未打开作品时为 null；入口本应禁用，此处兜底防误触）。 */
export interface DocumentImportProjectState {
  projectPath: string;
  tree: ContentTree;
}

/** 提取可读错误信息：Error 实例取 message（避免「Error: 」前缀污染中文报错），其余原样。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function setupDocumentImport(
  dom: DocumentImportDom,
  options: {
    getProjectState(): DocumentImportProjectState | null;
    /** 导入成功后的收尾（刷新内容树、展开新文件夹）。 */
    onImported(result: ImportCommitResult): Promise<void> | void;
    /** 入口按钮忙碌态（文案与禁用策略由文件管理区统一管理）。 */
    setEntryBusy(busy: boolean): void;
    services?: Partial<DocumentImportServices>;
  },
): { run(): void } {
  const services: DocumentImportServices = {
    selectFile: () => selectDocumentFile(),
    preview: importDocumentPreview,
    commit: importDocumentCommit,
    ...options.services,
  };

  let running = false;
  /** 当前对话框呈现的预览（确认时取 `content_hash` 回传校验）。 */
  let currentPreview: ImportPreview | null = null;

  function showError(message: string): void {
    dom.errorLine.textContent = message;
    dom.errorLine.classList.remove("hidden");
  }

  function hideError(): void {
    dom.errorLine.textContent = "";
    dom.errorLine.classList.add("hidden");
  }

  /** 结构说明随拆分单选联动。 */
  function syncStructure(): void {
    if (currentPreview === null) return;
    dom.structure.textContent = structureLine(currentPreview, dom.splitByMarker.checked === true);
  }
  dom.splitWhole.addEventListener("change", syncStructure);
  dom.splitByMarker.addEventListener("change", syncStructure);

  /** 按预检结果刷新对话框内容；不动错误行（哈希重预检时要保留提示）。 */
  function refreshDialog(preview: ImportPreview, tree: ContentTree): void {
    currentPreview = preview;
    dom.conclusion.textContent = previewConclusion(preview);
    dom.lossList.replaceChildren(
      ...preview.losses.map((loss) => {
        const item = document.createElement("li");
        item.textContent = lossItemText(loss);
        return item;
      }),
    );
    dom.lossesBlock.classList.toggle("hidden", preview.losses.length === 0);
    const suggestion = preview.split_suggestion;
    dom.splitField.classList.toggle("hidden", suggestion === null);
    dom.splitMarkerLabel.textContent = splitOptionLabel(preview);
    // 默认不拆（design D4）：每次呈现预检都回到默认值，拆分由用户主动选择。
    dom.splitWhole.checked = true;
    dom.splitByMarker.checked = false;
    dom.targetSelect.replaceChildren(
      ...buildTargetOptions(tree).map((option) => {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        return element;
      }),
    );
    dom.targetSelect.value = ""; // 默认根级
    syncStructure();
  }

  /** 呈现模态预检，返回是否确认。Esc / 点击遮罩与「取消」同样视为取消。 */
  function showPrecheck(): Promise<boolean> {
    if (!dom.dialog.open) dom.dialog.showModal();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (confirmed: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(confirmed);
      };
      const onConfirm = (): void => finish(true);
      const onCancel = (): void => finish(false);
      const onDialogCancel = (event: Event): void => {
        event.preventDefault();
        finish(false);
      };
      dom.btnConfirm.addEventListener("click", onConfirm, { once: true });
      dom.btnCancel.addEventListener("click", onCancel, { once: true });
      dom.dialog.addEventListener("cancel", onDialogCancel, { once: true });
    });
  }

  function setDialogBusy(busy: boolean, label = "导入中..."): void {
    dom.btnConfirm.disabled = busy;
    dom.btnCancel.disabled = busy;
    dom.btnConfirm.textContent = busy ? label : "确认导入";
  }

  async function runImport(): Promise<void> {
    if (running) return;
    const state = options.getProjectState();
    if (state === null) return;
    running = true;
    options.setEntryBusy(true);
    try {
      const filePath = await services.selectFile();
      if (filePath === null) return; // 取消选择＝零副作用
      // md 文件的软换行接合说明（design D3：规则在预检告知；.docx 不出现）。
      if (isMarkdownFile(filePath)) {
        dom.mdNote.textContent = MARKDOWN_LINE_BREAK_NOTE;
        dom.mdNote.classList.remove("hidden");
      } else {
        dom.mdNote.textContent = "";
        dom.mdNote.classList.add("hidden");
      }
      let preview = await services.preview(state.projectPath, filePath);
      hideError();
      for (;;) {
        refreshDialog(preview, state.tree);
        if (!(await showPrecheck())) {
          dom.dialog.close();
          return; // 预检取消＝零副作用
        }
        const split = dom.splitByMarker.checked === true;
        const parentId = dom.targetSelect.value === "" ? null : dom.targetSelect.value;
        setDialogBusy(true);
        let result: ImportCommitResult;
        try {
          result = await services.commit(
            state.projectPath,
            filePath,
            parentId,
            split,
            preview.content_hash,
          );
        } catch (error) {
          setDialogBusy(false);
          const message = errorMessage(error);
          if (message.startsWith(HASH_MISMATCH_PREFIX)) {
            // 文件在预检后被改动：留在对话框内重新预检，以最新结果再次请用户确认。
            showError("文件在预检后有变动，已重新读取最新内容，请确认后再次导入。");
            setDialogBusy(true, "重新预检中...");
            preview = await services.preview(state.projectPath, filePath);
            setDialogBusy(false);
            continue;
          }
          dom.dialog.close();
          showMessage(`导入失败：${message}`);
          return;
        }
        setDialogBusy(false);
        dom.dialog.close();
        await options.onImported(result);
        showMessage(`导入完成：新建 ${formatCount(result.created_doc_ids.length)} 个文档`);
        return;
      }
    } catch (error) {
      // 文件选择或预检阶段失败（含畸形 / 超限文件）：尚未落盘，零副作用。
      dom.dialog.close();
      showMessage(`导入失败：${errorMessage(error)}`);
    } finally {
      running = false;
      options.setEntryBusy(false);
    }
  }

  return {
    run(): void {
      void runImport();
    },
  };
}
