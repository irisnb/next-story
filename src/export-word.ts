import type { AppDom } from "./dom.ts";
import { exportProjectToWord, type ExportWordResult } from "./project-api.ts";

export interface ExportWordServices {
  exportProjectToWord(projectPath: string, projectName: string): Promise<ExportWordResult>;
}

export interface ExportWordController {
  unload(): void;
}

const defaultServices: ExportWordServices = { exportProjectToWord };

type ExportWordDom = Pick<AppDom, "btnExportWord">;

/**
 * 写作界面的「导出 Word」入口：弹出保存对话框（默认建议作品名称 `.docx`），
 * 导出中防重复触发，取消不显示错误，成功提示目标位置，失败提示中文说明。
 * 导出只读取后端已保存版本；存在未保存修改时先明确告知用户。
 */
export function setupExportWord(
  dom: ExportWordDom,
  options: {
    getProjectPath(): string | null;
    getProjectName(): string | null;
    hasUnsavedChanges(): boolean;
    services?: Partial<ExportWordServices>;
  },
): ExportWordController {
  const services: ExportWordServices = { ...defaultServices, ...options.services };
  let exporting = false;

  async function runExport(): Promise<void> {
    if (exporting) return;
    const projectPath = options.getProjectPath();
    const projectName = options.getProjectName();
    if (projectPath === null || projectName === null) return;

    if (options.hasUnsavedChanges()) {
      alert("当前有尚未保存的修改。导出使用后端已保存版本，不包含未保存内容。");
    }

    exporting = true;
    dom.btnExportWord.disabled = true;
    const originalText = dom.btnExportWord.textContent;
    dom.btnExportWord.textContent = "导出中...";
    try {
      const result = await services.exportProjectToWord(projectPath, projectName);
      if (result.cancelled) {
        // 用户取消保存对话框：不生成文件，也不显示错误。
        return;
      }
      if (result.ok && result.path) {
        alert(`导出成功：${result.path}`);
      } else {
        alert(`导出失败：${result.message ?? "未知错误"}`);
      }
    } catch (error) {
      alert(`导出失败：${String(error)}`);
    } finally {
      exporting = false;
      dom.btnExportWord.disabled = false;
      dom.btnExportWord.textContent = originalText;
    }
  }

  dom.btnExportWord.addEventListener("click", () => {
    void runExport();
  });

  return {
    unload(): void {
      exporting = false;
      dom.btnExportWord.disabled = false;
    },
  };
}