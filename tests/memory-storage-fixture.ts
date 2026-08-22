import type { StorageLike } from "../src/shared-storage-and-selection-identity.ts";

/**
 * 可复用的内存存储测试夹具：Record 支撑的 StorageLike 假实现。
 * 暴露 `data` 便于断言写入内容；支持初始值注入。
 */
export function memoryStorageFixture(
  initial: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}