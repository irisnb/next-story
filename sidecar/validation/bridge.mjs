// bridge.mjs — 受控只读作品材料桥接（JS 镜像，change: dsh-capability-integration-validation 任务 2.2/2.3/2.4）
//
// 与 Rust src-tauri/src/project/story_material.rs 的 read_material 边界对齐：
// 逐项校验作品身份、文档存在、可见性（隐藏 / 回收站）、文档类型、版本、范围、快照身份。
// 任何失败都返回结构化拒绝，绝不返回内容，也绝不写入作品。
//
// 能力命名对齐本目录 allowlist.mjs（点分能力名），对应 Rust capability_gateway.rs 的
// 只读工具名 story-list / story-read / story-snapshot（kebab 工具名，仅产品侧命名，本验证不写入 Rust）。
// 本模块纯函数，无 IO、无网络、无作品写入。

import { authorize } from "./allowlist.mjs";
import { isVisible, isRecycled } from "./fixtures/story-fixture.mjs";

/** 验证用只读工具名 → 点分能力名。未知工具一律无映射（default-deny）。 */
export const READ_TOOL_CAPABILITIES = Object.freeze({
  "story.list": "story.list",
  "story.read_document": "story.read_document",
  "story.read_snapshot": "story.read_snapshot",
});

/** 八类结构化拒绝原因（与 Rust MaterialDenialReason 对齐）。 */
export const DENIAL_REASONS = Object.freeze([
  "work_mismatch", "document_missing", "document_not_visible", "document_recycled",
  "not_a_document", "version_unavailable", "invalid_range", "invalid_snapshot",
]);

/** 工具名 → 能力名；非只读工具返回 null。 */
export function toolToCapability(tool) {
  return READ_TOOL_CAPABILITIES[tool] ?? null;
}

/** 工具授权：只读工具走 allowlist；其余把工具名当能力名交给 allowlist default-deny
 *  （已知禁用能力返回 forbidden_capability，其余返回 unknown_capability）。 */
export function authorizeReadTool(tool) {
  return authorize(toolToCapability(tool) ?? tool);
}

function denial(reason) {
  return { ok: false, denial: { reason } };
}

/** 列出某作品内的允许文档（可见、非回收站）。作品不存在则拒绝。 */
export function listAllowedDocuments(fixture, workId) {
  if (!fixture?.works?.[workId]) return denial("work_mismatch");
  const documents = Object.values(fixture.documents)
    .filter((d) => d.workId === workId && isVisible(d) && !isRecycled(d))
    .map((d) => ({ documentId: d.docId, title: d.title, version: String(d.version) }));
  return { ok: true, documents };
}

/**
 * 受控只读读取：校验作品 / 文档 / 可见性 / 版本 / 范围 / 快照后返回结构化材料。
 * 任何失败都以结构化拒绝关闭，不返回内容。
 *
 * @param fixture 固定作品 fixture（见 fixtures/story-fixture.mjs）
 * @param request { workId, documentId, expectedVersion?, range? {start,end}, snapshot? {workId, documentId, version, content} }
 */
export function readMaterial(fixture, request) {
  const { workId, documentId, expectedVersion = null, range = null, snapshot = null } = request ?? {};

  if (!fixture?.works?.[workId]) return denial("work_mismatch");

  const doc = fixture.documents?.[documentId];
  if (doc && isRecycled(doc)) return denial("document_recycled");
  if (!doc) return denial("document_missing");
  if (doc.workId !== workId) return denial("document_missing");
  if (!isVisible(doc)) return denial("document_not_visible");

  // 正文与版本：合法快照优先于磁盘稿（未保存内容最新）。
  let content;
  let version;
  if (snapshot) {
    if (snapshot.workId !== workId || snapshot.documentId !== documentId) return denial("invalid_snapshot");
    if (typeof snapshot.version !== "string" || snapshot.version.trim() === "") return denial("invalid_snapshot");
    if (typeof snapshot.content !== "string" || snapshot.content.length === 0) return denial("invalid_snapshot");
    content = snapshot.content;
    version = snapshot.version;
  } else {
    content = doc.text;
    version = String(doc.version);
  }

  if (expectedVersion !== null && expectedVersion !== version) return denial("version_unavailable");

  const fullEnd = content.length;
  let r;
  if (range) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) return denial("invalid_range");
    if (range.start > range.end || range.end > fullEnd) return denial("invalid_range");
    r = { start: range.start, end: range.end };
  } else {
    r = { start: 0, end: fullEnd };
  }

  return {
    ok: true,
    material: {
      workId,
      documentId,
      documentName: doc.title,
      range: r,
      version,
      content: content.slice(r.start, r.end),
    },
  };
}
