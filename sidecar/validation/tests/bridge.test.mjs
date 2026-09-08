// bridge.test.mjs — 受控只读作品材料桥接的本地单元测试（change: dsh-capability-integration-validation 任务 2.2/2.3/2.4）
// JS 镜像 Rust src-tauri/src/project/story_material.rs 的 read_material 边界：
// 作品身份 / 文档存在 / 可见性 / 回收站 / 版本 / 范围 / 快照身份，任何失败都结构化拒绝、绝不返回内容。
import assert from "node:assert/strict";
import test from "node:test";

import { STORY_FIXTURE } from "../fixtures/story-fixture.mjs";
import {
  toolToCapability,
  authorizeReadTool,
  readMaterial,
  listAllowedDocuments,
  DENIAL_REASONS,
} from "../bridge.mjs";

test("toolToCapability 映射三个只读能力，未知/写入工具返回 null", () => {
  assert.equal(toolToCapability("story.read_document"), "story.read_document");
  assert.equal(toolToCapability("story.read_snapshot"), "story.read_snapshot");
  assert.equal(toolToCapability("story.list"), "story.list");
  assert.equal(toolToCapability("story.write"), null);
  assert.equal(toolToCapability("tool-fs"), null);
  assert.equal(toolToCapability("unknown.thing"), null);
});

test("authorizeReadTool 只放行只读能力，写入/未知默认拒绝", () => {
  assert.deepEqual(authorizeReadTool("story.read_document"), {
    allowed: true, capability: "story.read_document", reason: null,
  });
  assert.equal(authorizeReadTool("story.write").allowed, false);
  assert.equal(authorizeReadTool("story.write").reason, "forbidden_capability");
  assert.equal(authorizeReadTool("totally.unknown").reason, "unknown_capability");
});

test("readMaterial 对允许文档返回结构化材料（作品/文档/名称/版本/范围/内容）", () => {
  const r = readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-01" });
  assert.equal(r.ok, true);
  assert.equal(r.material.workId, "work-wuzhen");
  assert.equal(r.material.documentId, "doc-01");
  assert.equal(r.material.documentName, "第一幕");
  assert.equal(r.material.version, "2");
  assert.equal(r.material.content, "林悦在城西的画廊上班，负责展览宣传的设计。");
  assert.deepEqual(r.material.range, { start: 0, end: r.material.content.length });
});

test("readMaterial 失败关闭：作品不匹配 / 隐藏 / 回收站 / 另一部作品 / 缺失", () => {
  assert.equal(readMaterial(STORY_FIXTURE, { workId: "别的作品", documentId: "doc-01" }).denial.reason, "work_mismatch");
  assert.equal(readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-02-hidden" }).denial.reason, "document_not_visible");
  assert.equal(readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-03-recycled" }).denial.reason, "document_recycled");
  // doc-04-other 属于另一部作品，从 work-wuzhen 视角不可见
  assert.equal(readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-04-other" }).denial.reason, "document_missing");
  assert.equal(readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "no-such-doc" }).denial.reason, "document_missing");
});

test("readMaterial 拒绝旧版本 / 非法范围", () => {
  assert.equal(readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-01", expectedVersion: "1" }).denial.reason, "version_unavailable");
  assert.equal(readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-01", range: { start: 5, end: 2 } }).denial.reason, "invalid_range");
  assert.equal(readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-01", range: { start: 0, end: 99999 } }).denial.reason, "invalid_range");
});

test("readMaterial 返回指定范围切片", () => {
  const doc = STORY_FIXTURE.documents["doc-01"];
  const r = readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-01", range: { start: 0, end: 2 } });
  assert.equal(r.ok, true);
  assert.equal(r.material.content, doc.text.slice(0, 2));
  assert.deepEqual(r.material.range, { start: 0, end: 2 });
});

test("readMaterial 合法快照优先于磁盘稿（最新未保存快照）", () => {
  const r = readMaterial(STORY_FIXTURE, {
    workId: "work-wuzhen", documentId: "doc-05-unsaved",
    snapshot: { workId: "work-wuzhen", documentId: "doc-05-unsaved", version: "2", content: "这是编辑器里尚未保存的最新文本。" },
  });
  assert.equal(r.ok, true);
  assert.equal(r.material.version, "2");
  assert.equal(r.material.content, "这是编辑器里尚未保存的最新文本。");
});

test("readMaterial 无快照读 doc-05-unsaved 返回磁盘旧稿（不静默读未保存内容）", () => {
  const r = readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-05-unsaved" });
  assert.equal(r.ok, true);
  assert.equal(r.material.version, "1");
  assert.equal(r.material.content, "磁盘上的旧稿。");
});

test("readMaterial 快照身份不匹配 / 空版本被拒绝（不返回内容）", () => {
  assert.equal(readMaterial(STORY_FIXTURE, {
    workId: "work-wuzhen", documentId: "doc-05-unsaved",
    snapshot: { workId: "别的作品", documentId: "doc-05-unsaved", version: "2", content: "x" },
  }).denial.reason, "invalid_snapshot");

  assert.equal(readMaterial(STORY_FIXTURE, {
    workId: "work-wuzhen", documentId: "doc-05-unsaved",
    snapshot: { workId: "work-wuzhen", documentId: "doc-05-unsaved", version: "", content: "x" },
  }).denial.reason, "invalid_snapshot");
});

test("listAllowedDocuments 只返回可见文档，排除隐藏/回收站/另一部作品", () => {
  const r = listAllowedDocuments(STORY_FIXTURE, "work-wuzhen");
  assert.equal(r.ok, true);
  const ids = r.documents.map((d) => d.documentId);
  assert.ok(ids.includes("doc-01"));
  assert.ok(ids.includes("doc-05-unsaved"));
  assert.ok(!ids.includes("doc-02-hidden"));
  assert.ok(!ids.includes("doc-03-recycled"));
  assert.ok(!ids.includes("doc-04-other"));
});

test("DENIAL_REASONS 覆盖八类结构化拒绝原因", () => {
  assert.deepEqual(DENIAL_REASONS, [
    "work_mismatch", "document_missing", "document_not_visible", "document_recycled",
    "not_a_document", "version_unavailable", "invalid_range", "invalid_snapshot",
  ]);
});
