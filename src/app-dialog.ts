import { confirm as pluginConfirm, message as pluginMessage } from "@tauri-apps/plugin-dialog";

export interface NativeDialogImpls {
  confirm?: (message: string) => Promise<boolean>;
  message?: (message: string) => Promise<void>;
}

/**
 * 安装原生对话框的运行期实现。不能依赖插件注入的覆写：2.7.1 的
 * window.confirm 覆写引用了不存在的 plugin:dialog|confirm 命令。
 */
export function installNativeDialogs(impls: NativeDialogImpls = {}): void {
  const confirm = impls.confirm ?? pluginConfirm;
  const message = impls.message ?? pluginMessage;
  globalThis.confirm = ((text?: string): Promise<boolean> => confirm(text ?? "")) as unknown as typeof globalThis.confirm;
  globalThis.alert = (text: string): void => {
    void message(text).catch(() => {});
  };
}

/**
 * 按 design D1/D3 兼容同步桩与异步确认：无对话框能力时保持放行，
 * 调用抛错或异步拒绝时视为未确认，拦住需要用户确认的操作。
 */
export async function confirmDialog(message: string): Promise<boolean> {
  if (typeof globalThis.confirm !== "function") return true;
  try {
    return Boolean(await globalThis.confirm(message));
  } catch {
    return false;
  }
}

/**
 * 按 design D1/D3 保持提示的同步调用形状并兼容异步实现：无能力时不操作，
 * 吞掉异步拒绝，避免信息提示失败产生未处理拒绝。
 */
export function showMessage(message: string): void {
  if (typeof globalThis.alert !== "function") return;
  const result: unknown = globalThis.alert(message);
  if (result instanceof Promise) void result.catch(() => {});
}
