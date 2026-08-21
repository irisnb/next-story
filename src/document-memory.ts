/** 与 localStorage 兼容的最小存储接口，便于在 node 测试里注入假存储。 */
export interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const MEMORY_KEY_PREFIX = "next-story.last-document.";

/** 按作品路径区分「上次编辑文档」记忆的存储键。 */
export function lastDocumentKey(projectPath: string): string {
  return MEMORY_KEY_PREFIX + projectPath;
}

/** 读取某个作品的上次编辑文档 ID；缺失或空值返回 null。 */
export function readLastDocumentId(
  storage: MemoryStorage,
  projectPath: string,
): string | null {
  const raw = storage.getItem(lastDocumentKey(projectPath));
  return raw !== null && raw.length > 0 ? raw : null;
}

/** 记录某个作品的上次编辑文档 ID。 */
export function writeLastDocumentId(
  storage: MemoryStorage,
  projectPath: string,
  documentId: string,
): void {
  storage.setItem(lastDocumentKey(projectPath), documentId);
}

/** 清除某个作品的上次编辑文档记忆（记忆指向的文档已失效时调用）。 */
export function clearLastDocumentId(
  storage: MemoryStorage,
  projectPath: string,
): void {
  storage.removeItem(lastDocumentKey(projectPath));
}
