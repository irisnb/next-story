// allowlist.mjs — 阶段 1 的 DSH 能力 allowlist，默认拒绝（change: dsh-capability-integration-validation 任务 1.3）
//
// 允许集只含受控只读能力；通用文件、Shell、网络、子代理、无限循环、作品写入全部保持禁用。
// 任何未知能力也默认拒绝（default-deny）。本模块纯函数，无 IO。
export const ALLOWED_CAPABILITIES = Object.freeze([
  "story.list",          // 列出允许范围
  "story.read_document", // 读取指定文档（受控只读）
  "story.read_snapshot", // 传递未保存快照（受控只读）
]);

export const FORBIDDEN_CAPABILITIES = Object.freeze([
  // 通用文件系统
  "fs", "fs.read", "fs.write", "fs.search", "fs.list",
  // Shell / 命令执行
  "shell", "bash", "pwsh", "shell.exec",
  // 网络
  "network", "web", "web.search", "web.fetch",
  // 子代理
  "subagent", "subagent.spawn", "subagent.fork",
  // 无限循环 / 目标驱动
  "loop", "goal", "goal.round_driver",
  // 作品写入（AI 永远不得直接改作品）
  "story.write", "story.insert", "story.edit", "story.delete", "story.rename",
]);

const STORY_WRITE_CAPABILITIES = Object.freeze([
  "story.write", "story.insert", "story.edit", "story.delete", "story.rename",
]);

/** 能力是否在允许集内（default-deny：未知一律 false）。 */
export function isAllowed(capability) {
  return ALLOWED_CAPABILITIES.includes(capability);
}

/** 是否为作品写入类能力（区别于通用文件写入）。 */
export function isStoryWrite(capability) {
  return STORY_WRITE_CAPABILITIES.includes(capability);
}

/**
 * 结构化授权结果：
 *   allowed=true  → { allowed, capability, reason: null }
 *   allowed=false → reason 为 "forbidden_capability"（已知禁用）或 "unknown_capability"（默认拒绝）
 */
export function authorize(capability) {
  if (isAllowed(capability)) return { allowed: true, capability, reason: null };
  if (FORBIDDEN_CAPABILITIES.includes(capability)) {
    return { allowed: false, capability, reason: "forbidden_capability" };
  }
  return { allowed: false, capability, reason: "unknown_capability" };
}
