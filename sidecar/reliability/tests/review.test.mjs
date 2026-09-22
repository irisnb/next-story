// review.test.mjs — 人工裁决落档工具的本地单元测试（change: fix-reliability-scorer-mislabels 任务 4.3）
//
// 覆盖：四态校验拒绝非法值、applyReview 只写 human_review/reviewer_notes 且不改自动结果、
// 重复裁决幂等（覆盖同一条）、CLI 参数解析。全部离线：临时目录构造最小证据，不发网络。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { isValidOutcome, applyReview, parseReviewArgs } from "../review.mjs";
import { REVIEW_OUTCOMES, RESULT_NEEDS_REVIEW } from "../screening.mjs";

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "review-test-"));
}

function writeJson(file, obj) {
  writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

test("isValidOutcome 只接受四态，拒绝非法值", () => {
  for (const o of REVIEW_OUTCOMES) {
    assert.equal(isValidOutcome(o), true, `应接受 ${o}`);
  }
  for (const bad of ["MODEL", "model_ok", "HUMAN_OK", "", null, undefined, "SCORER_ERROR "]) {
    assert.equal(isValidOutcome(bad), false, `应拒绝 ${JSON.stringify(bad)}`);
  }
});

test("applyReview 写入 human_review/reviewer_notes，不改 automatic 等自动结果", () => {
  const record = {
    case_id: "case-a",
    response: { text: "回答正文" },
    result: { automatic: RESULT_NEEDS_REVIEW, reasons: ["未明确否定旧事实：X"], human_review: null, reviewer_notes: null },
  };
  const out = applyReview(record, "MODEL_OK", "答案正确，评分器漏判");
  assert.equal(out.result.human_review, "MODEL_OK");
  assert.equal(out.result.reviewer_notes, "答案正确，评分器漏判");
  assert.equal(out.result.automatic, RESULT_NEEDS_REVIEW, "automatic 不被触碰");
  assert.deepEqual(out.result.reasons, ["未明确否定旧事实：X"], "reasons 不被触碰");
  assert.equal(out.response.text, "回答正文", "response 正文不被触碰");
  assert.equal(record.result.human_review, null, "纯函数：不改入参");
});

test("applyReview 空白 notes 归一为 null；重复裁决覆盖同一条（幂等）", () => {
  const record = { result: { automatic: RESULT_NEEDS_REVIEW, reasons: [], human_review: "MODEL_OK", reviewer_notes: "旧结论" } };
  const out = applyReview(applyReview(record, "SCORER_ERROR", "  "), "UNRESOLVED", "新结论");
  assert.equal(out.result.human_review, "UNRESOLVED", "后写覆盖先写");
  assert.equal(out.result.reviewer_notes, "新结论");
  assert.equal(applyReview(record, "MODEL_ERROR").result.reviewer_notes, null, "未提供 notes 时为 null");
});

test("parseReviewArgs 解析位置参数与选项", () => {
  const a = parseReviewArgs(["run-1", "case-a", "MODEL_OK", "--notes", "理由 A", "--evidence", "some/dir"]);
  assert.deepEqual(
    { runId: a.runId, caseId: a.caseId, outcome: a.outcome, notes: a.notes, evidenceDir: a.evidenceDir, help: a.help },
    { runId: "run-1", caseId: "case-a", outcome: "MODEL_OK", notes: "理由 A", evidenceDir: "some/dir", help: false },
  );
  const missing = parseReviewArgs(["run-1", "--notes", "x"]);
  assert.equal(missing.caseId, null);
  assert.equal(missing.outcome, null);
  assert.equal(missing.notes, "x");
});

test("端到端：applyReview 落盘后重读，自动结果保持原样", () => {
  const root = makeTmpDir();
  const caseFile = join(root, "case-a.json");
  const record = {
    case_id: "case-a",
    result: { automatic: RESULT_NEEDS_REVIEW, reasons: ["r1"], human_review: null, reviewer_notes: null },
  };
  writeJson(caseFile, applyReview(record, "SCORER_ERROR", "评分器误标"));
  const reread = JSON.parse(readFileSync(caseFile, "utf8"));
  assert.equal(reread.result.human_review, "SCORER_ERROR");
  assert.equal(reread.result.automatic, RESULT_NEEDS_REVIEW);
  assert.ok(existsFile(caseFile));
  rmSync(root, { recursive: true, force: true });
});

function existsFile(p) {
  // 轻量存在性检查（避免引入额外 import 噪音）
  try {
    readFileSync(p, "utf8");
    return true;
  } catch {
    return false;
  }
}
