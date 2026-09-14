// session-queue.mjs — 按会话串行、跨会话并行的命令队列。
//
// harden-driver-generation-lifecycle（审计 P1-3）：生产驱动此前对每行输入直接
// 启动异步 handler，replay_done 等待建 Agent 期间，后续 send_message 可再次
// 创建 Agent。本模块让同一会话的命令严格按 stdin 顺序执行；不同会话并行；
// 取消命令由调用方旁路（不排队，否则会排在被取消的操作之后）。
// 独立成模块是为了无 DSH 启动副作用的 node:test 单测。

/**
 * 创建会话命令队列集合。
 * @returns {{
 *   enqueue(sessionId: string, task: () => Promise<void>): Promise<void>,
 *   drain(): Promise<void>,
 *   size: number,
 * }}
 */
export function createSessionQueues() {
  /** @type {Map<string, Promise<void>>} */
  const tails = new Map();

  function enqueue(sessionId, task) {
    const previous = tails.get(sessionId) ?? Promise.resolve();
    // 前序失败不阻塞后续：会话命令各自向宿主回报错误，队列只保证顺序。
    const next = previous.catch(() => {}).then(task);
    tails.set(sessionId, next);
    return next.finally(() => {
      if (tails.get(sessionId) === next) tails.delete(sessionId);
    });
  }

  async function drain() {
    await Promise.allSettled([...tails.values()]);
  }

  return {
    enqueue,
    drain,
    get size() {
      return tails.size;
    },
  };
}
