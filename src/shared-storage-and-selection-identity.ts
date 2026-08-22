import type { SelectionSnapshot } from "./types.ts";

/**
 * 与 localStorage 兼容的最小存储接口，支持读取、写入和删除键值。
 * 所有前端浏览器持久化访问统一走该接口，便于在 node 测试里注入假存储。
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 选区快照类型（与 types.ts 同一类型，此处再导出便于共享模块调用方单点导入）。 */
export type { SelectionSnapshot };

/**
 * 解析浏览器 localStorage 为共享存储适配接口。
 * window/localStorage 不存在或访问抛错时返回 null，不抛出异常；
 * 调用方对 null 采用各自既有的内存/默认值回退行为。
 */
export function resolveLocalStorage(): StorageLike | null {
  if (typeof globalThis.window === "undefined") return null;
  try {
    const storage = globalThis.window.localStorage;
    if (!storage) return null;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key),
    };
  } catch {
    return null;
  }
}

/**
 * 两个选区快照是否代表同一份可提交上下文。
 * 只比较 documentId、from、to、selectedText 四个身份字段，
 * 不把方向、UI 状态或其他临时字段误纳入快照身份。
 */
export function sameSelectionSnapshot(
  left: SelectionSnapshot,
  right: SelectionSnapshot,
): boolean {
  return (
    left.documentId === right.documentId &&
    left.from === right.from &&
    left.to === right.to &&
    left.selectedText === right.selectedText
  );
}