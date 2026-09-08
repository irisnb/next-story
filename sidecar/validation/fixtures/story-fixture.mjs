// story-fixture.mjs — 固定作品 fixture（change: dsh-capability-integration-validation 任务 1.1）
//
// 覆盖允许文档、隐藏文档、回收站文档、另一部作品、带未保存修改的文档。
// 只提供离线固定材料及其元数据（可见性/版本/未保存快照），供验证只读桥接的授权判定使用；
// 不包含任何真实用户作品，不提供作品写入能力。
export const STORY_FIXTURE = Object.freeze({
  mainWorkId: "work-wuzhen",
  otherWorkId: "work-shan-yu",
  works: Object.freeze({
    "work-wuzhen": Object.freeze({ workId: "work-wuzhen", title: "雾镇来信" }),
    "work-shan-yu": Object.freeze({ workId: "work-shan-yu", title: "山雨欲来" }),
  }),
  documents: Object.freeze({
    "doc-01": Object.freeze({
      docId: "doc-01", workId: "work-wuzhen", title: "第一幕", visibility: "visible", version: 2,
      text: "林悦在城西的画廊上班，负责展览宣传的设计。",
    }),
    "doc-02-hidden": Object.freeze({
      docId: "doc-02-hidden", workId: "work-wuzhen", title: "隐藏笔记", visibility: "hidden", version: 1,
      text: "这段隐藏笔记不应被 AI 读取。",
    }),
    "doc-03-recycled": Object.freeze({
      docId: "doc-03-recycled", workId: "work-wuzhen", title: "回收站草稿", visibility: "recycled", version: 1,
      text: "已删除的草稿，不应被 AI 读取。",
    }),
    "doc-04-other": Object.freeze({
      docId: "doc-04-other", workId: "work-shan-yu", title: "另一部作品第一章", visibility: "visible", version: 1,
      text: "这是另一部作品《山雨欲来》的正文。",
    }),
    "doc-05-unsaved": Object.freeze({
      docId: "doc-05-unsaved", workId: "work-wuzhen", title: "未保存修改", visibility: "visible", version: 1,
      text: "磁盘上的旧稿。",
      unsavedSnapshot: Object.freeze({ version: 2, text: "这是编辑器里尚未保存的最新文本。" }),
    }),
  }),
});

export function documentsOfWork(workId) {
  return Object.values(STORY_FIXTURE.documents).filter((d) => d.workId === workId);
}

export function getDocument(docId) {
  return STORY_FIXTURE.documents[docId] ?? null;
}

export function isVisible(doc) {
  return doc?.visibility === "visible";
}

export function isHidden(doc) {
  return doc?.visibility === "hidden";
}

export function isRecycled(doc) {
  return doc?.visibility === "recycled";
}

export function savedVersion(doc) {
  return doc?.version ?? null;
}

export function hasUnsaved(doc) {
  return Boolean(doc?.unsavedSnapshot);
}

export function snapshotOf(doc) {
  return doc?.unsavedSnapshot ?? null;
}

const VISIBILITIES = new Set(["visible", "hidden", "recycled"]);

/** fixture 自洽校验：文档身份、所属作品、可见性、版本与未保存快照版本。 */
export function validateFixture(fixture) {
  if (fixture === null || typeof fixture !== "object") {
    return { ok: false, errors: ["fixture 必须是对象"] };
  }
  const errors = [];
  if (typeof fixture.mainWorkId !== "string" || !fixture.mainWorkId) errors.push("缺少 mainWorkId");
  if (typeof fixture.otherWorkId !== "string" || !fixture.otherWorkId) errors.push("缺少 otherWorkId");
  if (fixture.works === null || typeof fixture.works !== "object") errors.push("缺少 works");
  if (fixture.documents === null || typeof fixture.documents !== "object") errors.push("缺少 documents");
  if (errors.length > 0) return { ok: false, errors };

  for (const [key, doc] of Object.entries(fixture.documents)) {
    if (doc === null || typeof doc !== "object") { errors.push(`${key}: 文档必须是对象`); continue; }
    if (typeof doc.docId !== "string" || !doc.docId) errors.push(`${key}: 缺少 docId`);
    if (typeof doc.workId !== "string" || !fixture.works?.[doc.workId]) errors.push(`${key}: workId 未在 works 中注册`);
    if (!VISIBILITIES.has(doc.visibility)) errors.push(`${key}: visibility 必须是 visible/hidden/recycled`);
    if (!Number.isInteger(doc.version) || doc.version <= 0) errors.push(`${key}: version 必须是正整数`);
    if (doc.unsavedSnapshot) {
      const snap = doc.unsavedSnapshot;
      if (!Number.isInteger(snap.version) || snap.version <= doc.version) errors.push(`${key}: 未保存快照版本必须大于已保存版本`);
      if (typeof snap.text !== "string" || !snap.text) errors.push(`${key}: 未保存快照缺少 text`);
    }
  }
  return { ok: errors.length === 0, errors };
}
