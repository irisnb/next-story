/**
 * 讨论身份解析（change: app-real-chain-validation 任务 6.1，design D7）。
 *
 * 后端 `ai_send_message`（src-tauri/src/ai_orchestration.rs）以 `conversation_id`＋
 * `conversation_project_path` 二元组注册本轮工具路由（按需补读授权与执行的依据）；
 * 任一为空白（trim 后为空）即视为未携带，走清路由路径（模型工具调用失败关闭）。
 * 本模块在前端镜像同一守卫语义，供传输层发送前解析讨论身份；纯函数、零依赖
 * （叶子模块，ai-module-boundaries 无涉）。
 */

/** 一次发送携带的讨论身份：讨论 id＋所属作品根路径。 */
export interface ConversationIdentity {
  readonly conversationId: string;
  readonly conversationProjectPath: string;
}

/**
 * 解析讨论身份：讨论 id 或作品路径任一为 null／undefined／空白（trim 后为空，
 * 镜像后端 `!trim().is_empty()` 守卫）时返回 null——调用方不携带该字段，后端按
 * 未携带处理（清路由，与旧发送行为向后兼容）；两者都有效时返回身份对象。
 * 返回值保留原字符串（后端守卫只看 trim 结果，不改写注册内容）。
 */
export function resolveConversationIdentity(
  conversationId: string | null | undefined,
  projectPath: string | null | undefined,
): ConversationIdentity | null {
  if (conversationId === null || conversationId === undefined) return null;
  if (projectPath === null || projectPath === undefined) return null;
  if (conversationId.trim() === "" || projectPath.trim() === "") return null;
  return { conversationId, conversationProjectPath: projectPath };
}
