// 金样本测试的浏览器环境安装助手。
//
// node --test 进程没有 DOM，而 Tiptap v2 的 Editor 构造依赖 document /
// MutationObserver 等浏览器全局。这里创建一个 happy-dom Window，把它提供的
// 全局成员指到 globalThis，用完 restore 恢复原状。只安装 happy-dom Window
// 上确实存在的成员；Node 自带的 navigator 是只读 getter，需要 defineProperty
// 覆盖。不触碰任何生产代码。
import { Window, type BrowserWindow } from "happy-dom";

/** 需要安装到 globalThis 的全局名（存在才装；不足时按报错逐项补齐）。 */
const GLOBAL_KEYS = [
  "document",
  "window",
  "navigator",
  "DOMParser",
  "MutationObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getComputedStyle",
  "CustomEvent",
  "KeyboardEvent",
  "Node",
  "Element",
  "HTMLElement",
  "Range",
] as const;

export interface BrowserEnv {
  window: BrowserWindow;
  /** 用 happy-dom 的 DOMParser 解析 HTML，供 parseHtmlToBlocks 注入。 */
  parseHtml(source: string): Document;
  /** 恢复被覆盖的全局并关闭 Window。 */
  restore(): void;
}

export function installBrowserEnv(): BrowserEnv {
  const window = new Window();
  const globals = globalThis as unknown as Record<string, unknown>;
  const originalDescriptors = new Map<string, PropertyDescriptor>();
  const installedKeys = new Set<string>();

  for (const key of GLOBAL_KEYS) {
    const value = (window as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor) {
      originalDescriptors.set(key, descriptor);
    } else {
      installedKeys.add(key);
    }
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: descriptor?.enumerable ?? false,
    });
  }

  return {
    window,
    parseHtml(source: string): Document {
      return new window.DOMParser().parseFromString(source, "text/html") as unknown as Document;
    },
    restore(): void {
      for (const [key, descriptor] of originalDescriptors) {
        Object.defineProperty(globalThis, key, descriptor);
      }
      for (const key of installedKeys) {
        delete globals[key];
      }
      void window.close();
    },
  };
}
