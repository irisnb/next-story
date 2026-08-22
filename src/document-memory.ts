import type { StorageLike } from "./shared-storage-and-selection-identity.ts";

/** 兼容别名：与共享 StorageLike 完全一致，保持既有调用方不变。 */
export type MemoryStorage = StorageLike;

const MEMORY_KEY_PREFIX = "next-story.last-document.";

/** 按作品路径区分「上次编辑文档」记忆的存储键。 */
export function lastDocumentKey(projectPath: string): string {
  return MEMORY_KEY_PREFIX + projectPath;
}

/** 读取某个作品的上次编辑文档 ID；缺失或空值返回 null。 */
export function readLastDocumentId(
  storage: StorageLike,
  projectPath: string,
): string | null {
  const raw = storage.getItem(lastDocumentKey(projectPath));
  return raw !== null && raw.length > 0 ? raw : null;
}

/** 记录某个作品的上次编辑文档 ID。 */
export function writeLastDocumentId(
  storage: StorageLike,
  projectPath: string,
  documentId: string,
): void {
  storage.setItem(lastDocumentKey(projectPath), documentId);
}

/** 清除某个作品的上次编辑文档记忆（记忆指向的文档已失效时调用）。 */
export function clearLastDocumentId(
  storage: StorageLike,
  projectPath: string,
): void {
  storage.removeItem(lastDocumentKey(projectPath));
}