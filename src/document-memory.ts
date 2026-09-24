import type { StorageLike } from "./shared-storage-and-selection-identity.ts";

/** 兼容别名：与共享 StorageLike 完全一致，保持既有调用方不变。 */
export type MemoryStorage = StorageLike;

const MEMORY_KEY_PREFIX = "next-story.last-document.";

/** 辅助偏好失效不影响正文流程；不记录可能携带正文的异常消息或对象。 */
function warnStorageFailure(operation: keyof StorageLike, error: unknown): void {
  console.warn(
    `[document-memory] ${operation} failed; last-document preference unavailable`,
    { errorName: error instanceof Error ? error.name : "UnknownError" },
  );
}

/** 按作品路径区分「上次编辑文档」记忆的存储键。 */
export function lastDocumentKey(projectPath: string): string {
  return MEMORY_KEY_PREFIX + projectPath;
}

/** 读取某个作品的上次编辑文档 ID；缺失、空值或存储不可用返回 null。 */
export function readLastDocumentId(
  storage: StorageLike,
  projectPath: string,
): string | null {
  const key = lastDocumentKey(projectPath);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch (error) {
    warnStorageFailure("getItem", error);
    return null;
  }
  return raw !== null && raw.length > 0 ? raw : null;
}

/** 记录某个作品的上次编辑文档 ID。 */
export function writeLastDocumentId(
  storage: StorageLike,
  projectPath: string,
  documentId: string,
): void {
  const key = lastDocumentKey(projectPath);
  try {
    storage.setItem(key, documentId);
  } catch (error) {
    warnStorageFailure("setItem", error);
  }
}

/** 清除某个作品的上次编辑文档记忆（记忆指向的文档已失效时调用）。 */
export function clearLastDocumentId(
  storage: StorageLike,
  projectPath: string,
): void {
  const key = lastDocumentKey(projectPath);
  try {
    storage.removeItem(key);
  } catch (error) {
    warnStorageFailure("removeItem", error);
  }
}
