// summary.mjs — 验证结果汇总（change: dsh-capability-integration-validation 任务 5.3）
//
// 汇总验证结果、可复用 DSH 能力与必须新增的桥接，形成阶段 2 之前的接入结论。
// 确定性验证与真实模型验证严格分离；真实模型/API 未验证时不生成延迟基线。
// 本模块纯函数，无 IO。

/** 已验证可复用的 DSH 能力（确定性替身 + 类型契约层面确认）。 */
export const REUSABLE_DSH_CAPABILITIES = Object.freeze([
  "agent-loop：最小受控循环可在应用会话生命周期边界内运行",
  "session 工具事件契约：tool/call（callId/name/arguments）与 tool/result（message/error/meta）",
  "tools/pre-execute ask → approval 确认/拒绝（allowed-once / rejected / cancelled / unavailable）",
  "工具终态纪律：每个调用唯一终态，迟到结果不重开（validation/tool-lifecycle.mjs）",
]);

/** 必须新增的桥接（阶段 2 接入前）——本 change 只验证契约，不落地产品层。 */
export const REQUIRED_BRIDGES = Object.freeze([
  "受控只读作品材料边界（Rust story_material.rs 已具备，需在阶段 2 接入真实 Agent Loop）",
  "未保存快照显式传递通道（前端快照 → 权限校验 → 只读返回，绝不静默读旧稿）",
  "工具材料与确认等待状态的跨重启恢复（当前明确降级为不可恢复）",
]);

/**
 * 汇总验证项。每项 { taskId, mode: "deterministic"|"real", verified: boolean, notes? }。
 * 返回结构化接入结论；真实模型项未验证时 realModelLatencyAvailable 恒为 false，
 * 绝不生成虚假延迟结论。
 */
export function summarizeValidation(items = []) {
  const list = Array.isArray(items) ? items : [];
  const verified = list.filter((i) => i.verified === true);
  const unverified = list.filter((i) => i.verified !== true);
  const realItems = list.filter((i) => i.mode === "real");
  const realVerified = realItems.filter((i) => i.verified === true);
  const realUnverified = realItems.filter((i) => i.verified !== true);

  return {
    verifiedCount: verified.length,
    unverifiedCount: unverified.length,
    // 是否只有确定性验证、没有任何真实模型项被验证通过
    deterministicOnly: realVerified.length === 0,
    // 真实模型/API 延迟基线是否可用（本 change 的确定性替身永远不可用）
    realModelLatencyAvailable: realVerified.length > 0,
    unverifiedRealItems: realUnverified.map((i) => i.taskId),
    reusableCapabilities: REUSABLE_DSH_CAPABILITIES,
    requiredBridges: REQUIRED_BRIDGES,
  };
}
