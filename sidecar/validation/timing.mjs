// timing.mjs — 计时证据记录（change: dsh-capability-integration-validation 任务 5.1/5.2）
//
// 记录提交/首字/排队/工具等待/确认等待/完成；进度提示不计入首字（区分进度提示与真实模型文本）。
// 失败或计时源不可用时标记 incomplete，不生成虚假延迟结论（design.md D3）。
// 时钟可注入，纯内存、确定性。
export const TIMING_MARKS = Object.freeze([
  "submission",
  "queue_start", "queue_end",
  "tool_wait_start", "tool_wait_end",
  "confirmation_wait_start", "confirmation_wait_end",
  "first_text",
  "completion",
]);

/** 构造计时记录器。clock 默认 Date.now，可注入确定性时钟。 */
export function createTimingRecorder(clock = () => Date.now()) {
  return { marks: {}, clock, errors: [] };
}

/**
 * 记录一个计时标记。first_text 的 kind="progress" 表示进度提示，不记为真实首字。
 * 返回 { recorded, at?, reason? }。
 */
export function markTiming(recorder, name, opts = {}) {
  if (!TIMING_MARKS.includes(name)) {
    recorder.errors.push(`unknown_timing_mark:${name}`);
    return { recorded: false, reason: "unknown_mark" };
  }
  if (name === "first_text" && opts?.kind === "progress") {
    return { recorded: false, reason: "progress_not_model_text" };
  }
  let t;
  try {
    t = recorder.clock();
  } catch (err) {
    recorder.errors.push(`clock_error:${name}:${String(err?.message ?? err)}`);
    return { recorded: false, reason: "clock_error" };
  }
  if (typeof t !== "number" || !Number.isFinite(t)) {
    recorder.errors.push(`invalid_clock:${name}`);
    return { recorded: false, reason: "invalid_clock" };
  }
  recorder.marks[name] = t;
  return { recorded: true, at: t };
}

/** 两标记间的毫秒差；任一缺失返回 null。 */
export function durationMs(recorder, from, to) {
  const a = recorder.marks[from];
  const b = recorder.marks[to];
  if (typeof a !== "number" || typeof b !== "number") return null;
  return b - a;
}

/**
 * 汇总计时证据。terminal 非 "completed" 或必需标记缺失、计时源出错时标记 incomplete，
 * conclusion 为 null（不生成延迟结论）。
 */
export function summarizeTiming(recorder, opts = {}) {
  const terminal = opts.terminal ?? "completed";
  const durations = {
    queue_ms: durationMs(recorder, "queue_start", "queue_end"),
    tool_wait_ms: durationMs(recorder, "tool_wait_start", "tool_wait_end"),
    confirmation_wait_ms: durationMs(recorder, "confirmation_wait_start", "confirmation_wait_end"),
    first_text_ms: durationMs(recorder, "submission", "first_text"),
    completion_ms: durationMs(recorder, "submission", "completion"),
  };
  const hasSubmission = typeof recorder.marks.submission === "number";
  const hasCompletion = typeof recorder.marks.completion === "number";
  const missing = [];
  if (!hasSubmission) missing.push("submission");
  if (!hasCompletion) missing.push("completion");
  if (terminal !== "completed") missing.push(`terminal:${terminal}`);
  const complete = hasSubmission && hasCompletion && terminal === "completed" && recorder.errors.length === 0;
  const conclusion = complete ? { first_text_ms: durations.first_text_ms, completion_ms: durations.completion_ms } : null;
  return { complete, terminal, durations, missing, errors: [...recorder.errors], conclusion };
}
