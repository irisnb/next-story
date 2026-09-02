// evidence.mjs — 回答可靠性测试器的证据记录（change: add-answer-reliability-tester-core 任务 3.1/3.2）
//
// 每个案例一次运行生成独立证据 JSON（design.md D2），保存：
//   案例身份、材料身份、模型与非敏感配置摘要、耗时、协议终态、完整回答、
//   相关事件摘要、自动判定与理由、运行错误。
// 证据里绝不出现 API key（由 runner 经 redact.mjs 脱敏并复核后才落盘）。
export const TESTER_VERSION = "0.1.0";
export const EVIDENCE_SCHEMA_VERSION = 1;

/** 非敏感 API base 标识：只保留协议与主机，去掉路径/凭证，避免把端点细节写进证据。 */
export function apiBaseLabel(apiBase) {
  if (!apiBase) return null;
  try {
    const u = new URL(apiBase);
    return `${u.protocol}//${u.host}`;
  } catch {
    return typeof apiBase === "string" ? apiBase : null;
  }
}

/**
 * 构造证据记录。参数见各字段注释；runtimeError 非空表示运行/协议失败（区分于模型回答失败）。
 * 返回纯对象（尚未序列化/脱敏；由 runner 脱敏后落盘）。
 */
export function buildEvidenceRecord({
  runId,
  caseId,
  material,
  model,
  apiBaseLabel: apiBaseLabelValue,
  startedAt,
  finishedAt,
  durationMs,
  steps,
  question,
  response,
  protocol,
  result,
  runtimeError,
}) {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    tester_version: TESTER_VERSION,
    run_id: runId,
    case_id: caseId,
    material: {
      name: material?.name ?? null,
      version: material?.version ?? null,
      hash: material?.hash ?? null,
    },
    configuration: {
      model: model ?? null,
      api_base: apiBaseLabelValue ?? null,
    },
    timing: {
      started_at: startedAt ?? null,
      finished_at: finishedAt ?? null,
      duration_ms: durationMs ?? null,
    },
    conversation: {
      steps: steps ?? [],
      question: question ?? null,
    },
    protocol: protocol ?? null,
    response: {
      text: response?.text ?? null,
      steps: response?.steps ?? [],
    },
    result: {
      automatic: result?.automatic ?? null,
      reasons: result?.reasons ?? [],
      human_review: null, // 人工复核结论（MODEL_OK/MODEL_ERROR/SCORER_ERROR/UNRESOLVED），独立于自动结果
      reviewer_notes: null,
    },
    runtime_error: runtimeError
      ? { category: runtimeError.category ?? "unknown", message: runtimeError.message ?? null }
      : null,
  };
}

/** 证据输出路径：<outDir>/<runId>/cases/<caseId>.json。确定性命名，便于定位。 */
export function evidenceOutputPath(outDir, runId, caseId) {
  return { dir: `${outDir}/${runId}/cases`, file: `${caseId}.json` };
}
