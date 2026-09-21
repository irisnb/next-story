import type { AiPanelState } from "./ai-panel-state.ts";
import type { AiRequestCoordinator } from "./ai-request.ts";
import type { AiRequestScheduler } from "./ai-request-scheduler.ts";
import type { AiSessionTransport } from "./ai-session-transport.ts";
import type { AiDockController } from "./ai-dock.ts";
import type { SelectionEntryController, SelectionEntryEditor } from "./selection-entry.ts";
import type { loadLlmConfig } from "./project-api.ts";
import type { ContentTree } from "./types.ts";

/**
 * 编排组合根的访问器式上下文（change: extract-ai-request-orchestration，design D2）。
 *
 * 把 `setupAiFeature` 闭包宇宙的 8 个核心共享绑定（state / projectToken / destroyed /
 * transport / scheduler / coordinator / selectionEntry / aiDock）与只读依赖收拢为
 * 显式传参的上下文对象，供请求网关与请求生命周期等聚焦模块消费。
 *
 * 铁律（禁快照，design D6）：
 * - 除 `state`（本身就是稳定的外观实例）外，绑定一律经 getter / 访问器函数暴露，
 *   每次使用时现取闭包内的当前值——访问器的求值时机是行为的一部分；
 * - `hiddenDocumentIds` 等派生访问器同样每次调用现算，不缓存结果；
 * - 访问器一律不在装配期求值：`getScheduler` / `getCoordinator` 经网关惰性读取，
 *   构造期不触发；装配点之前的既有惰性回调（如 delete-undo 先于 scheduler 接线）
 *   保持原样（迁移期约定）。
 */
export interface AiFeatureContext {
  // ===== 核心共享绑定（访问器；state 为稳定外观实例可直接暴露） =====

  /** AI 面板状态外观（唯一状态源）。 */
  readonly state: AiPanelState;
  /** 当前作品代次（ABA 安全）：每次调用现取。 */
  getProjectToken(): number;
  /** 推进作品代次（作品切换 / 销毁路径的既有写点）。 */
  advanceProjectToken(): void;
  /** 编排层是否已销毁：每次调用现取。 */
  isDestroyed(): boolean;
  /** 标记编排层已销毁（destroy 的既有写点）。 */
  markDestroyed(): void;
  getTransport(): AiSessionTransport;
  getScheduler(): AiRequestScheduler;
  getCoordinator(): AiRequestCoordinator;
  getSelectionEntry(): SelectionEntryController;
  getAiDock(): AiDockController;

  // ===== 只读依赖与派生访问器（每次调用现取 / 现算） =====

  /** LLM 配置读取（预检用）。 */
  readonly loadConfig: typeof loadLlmConfig;
  readonly getCurrentProjectPath: () => string | null;
  readonly getCurrentDocumentTitle: () => string | null;
  readonly getCurrentTree: () => ContentTree | null;
  readonly getCurrentDocumentVersion: () => string | null;
  readonly getCurrentDocumentId: () => string | null;
  readonly getCurrentEditor: () => SelectionEntryEditor | null;
  /** 当前作品下「不允许 AI 查看」的文档 ID 集合：每次调用现算（可见性红线）。 */
  readonly hiddenDocumentIds: () => ReadonlySet<string>;
}
