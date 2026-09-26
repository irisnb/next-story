import {
  aiCancelMessage,
  aiEndSession,
  aiReplayDone,
  aiReplayHistory,
  aiSendMessage,
  aiStartSession,
  listenAiDelta,
  listenAiDriverLost,
  listenAiReadingRequest,
  listenAiToolCall,
  type AiReplayOrigin,
  type AiReplayTurn,
} from "./project-api.ts";
import { resolveConversationIdentity } from "./ai-conversation-identity.ts";
import type { GenerateAiRequest, GenerateAiResult } from "./types.ts";

export type { AiReplayOrigin, AiReplayTurn } from "./project-api.ts";

/**
 * 常驻 AI 会话传输层（change: resident-ai-session；本 change 升级为按讨论多会话）。
 *
 * 会话身份与传输状态收敛在本模块：驱动进程内为每个讨论维护一个会话（`Map<conversationId,
 * sessionId>`），首轮发「问题 + 可选选区材料」（直接提问）或「只带选区材料」（及时召唤），
 * 追问只发新增问题；流式增量经 `"ai-delta"` 事件路由到订阅者，`done`（命令返回的全文）是
 * 最终事实。消息编号由全局计数器生成并拼成 `{conversation_id}:msg-{n}`，保证跨讨论唯一。
 *
 * 本层不接触面板状态与 DOM，也不持有任何写入用户文档的入口（零写回边界）；
 * 所有依赖可注入，便于测试。
 */

/** 当前流式传输的路由目标：只有匹配的增量才通知订阅者。 */
interface StreamTarget {
  readonly conversationId: string;
  readonly sessionId: string;
  readonly messageId: string;
}

/**
 * 流式增量事件：携带讨论身份（`conversationId`）与消息身份（`messageId`），
 * 供编排层按讨论把增量写入对应讨论，替代「统一写入当前活动讨论」。
 */
export interface StreamTextEvent {
  readonly conversationId: string;
  readonly messageId: string;
  readonly text: string;
}

/**
 * 工具调用轻量过程事件（add-agent-on-demand-reading 任务 7.3）：按在途消息路由到
 * 所属讨论，供「正在搜索 / 正在阅读」状态显示。不携带任何作品数据或执行结果。
 */
export interface ToolCallEvent {
  readonly conversationId: string;
  readonly messageId: string;
  readonly callId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

/**
 * 按需补读授权请求事件（任务 7.1）：后端拦截 `story-request-reading` 后转为面向
 * 用户的授权提示；载荷只携带身份与模型提供的请求原因，不携带作品数据。
 */
export interface ReadingRequestEvent {
  readonly conversationId: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly callId: string;
  readonly reason: string;
}

export interface ResidentSessionDependencies {
  startSession?: typeof aiStartSession;
  sendMessage?: typeof aiSendMessage;
  cancelMessage?: typeof aiCancelMessage;
  endSession?: typeof aiEndSession;
  replayHistory?: typeof aiReplayHistory;
  replayDone?: typeof aiReplayDone;
  listenDelta?: typeof listenAiDelta;
  listenDriverLost?: typeof listenAiDriverLost;
  listenToolCall?: typeof listenAiToolCall;
  listenReadingRequest?: typeof listenAiReadingRequest;
  /**
   * 当前作品根路径访问器（design D7）：发送时与讨论 id 一起解析为讨论身份，
   * 供后端注册按需补读工具路由；缺省返回 null（不携带，与旧发送行为向后兼容）。
   */
  getCurrentProjectPath?: () => string | null;
  /** 会话 / 消息 ID 生成器；默认 `crypto.randomUUID`。 */
  newId?: () => string;
}

/** 常驻会话传输层的公开接口（供编排层与测试注入使用）。 */
export interface AiSessionTransport {
  sendViaResidentSession(conversationId: string, request: GenerateAiRequest): Promise<GenerateAiResult>;
  /** 取消指定讨论的当前在途生成（`ai_cancel_message`，幂等 fire-and-forget）。 */
  cancelMessage(conversationId: string): void;
  endSession(conversationId: string): void;
  endAllSessions(): void;
  replaySession(conversationId: string, turns: readonly AiReplayTurn[], origin: AiReplayOrigin): Promise<void>;
  onStreamText(listener: (event: StreamTextEvent) => void): () => void;
  onDriverLost(listener: () => void): () => void;
  /** 订阅工具调用轻量过程事件（按在途消息路由到所属讨论），返回退订函数。 */
  onToolCall(listener: (event: ToolCallEvent) => void): () => void;
  /** 订阅按需补读授权请求事件（按载荷中的讨论身份路由），返回退订函数。 */
  onReadingRequest(listener: (event: ReadingRequestEvent) => void): () => void;
  installSessionEventRouting(): void;
  destroySessionEventRouting(): void;
}

function defaultNewId(): string {
  return crypto.randomUUID();
}

function lastUserQuestionOf(
  messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>,
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return message.content;
  }
  return "";
}

/**
 * 请求的材料身份：作品 / 文档 / 版本身份 + 未保存正文快照。
 * 全部缺省时返回 `undefined`（旧调用方 / 无选区路径不携带身份，后端按缺省放行）。
 * 追问请求若保留了首轮快照与来源身份，也经同一对象透传（后端按增量语义校验）。
 */
function materialIdentityOf(
  request: GenerateAiRequest,
): {
  documentId?: string;
  projectPath?: string;
  documentVersion?: string;
  snapshot?: string;
  focusDocumentId?: string;
  focusProjectPath?: string;
  focusDocumentVersion?: string;
  focusSnapshot?: string;
} | undefined {
  if (
    request.document_id === undefined &&
    request.project_path === undefined &&
    request.document_version === undefined &&
    request.snapshot === undefined &&
    request.focus_document_id === undefined &&
    request.focus_project_path === undefined &&
    request.focus_document_version === undefined &&
    request.focus_snapshot === undefined
  ) {
    return undefined;
  }
  return {
    documentId: request.document_id,
    projectPath: request.project_path,
    documentVersion: request.document_version,
    snapshot: request.snapshot,
    focusDocumentId: request.focus_document_id,
    focusProjectPath: request.focus_project_path,
    focusDocumentVersion: request.focus_document_version,
    focusSnapshot: request.focus_snapshot,
  };
}

export class ResidentAiSessionTransport implements AiSessionTransport {
  private readonly deps: Required<ResidentSessionDependencies>;
  private readonly sessions: Map<string, string> = new Map();
  private readonly startingAttempts: Map<string, { invalidated: boolean }> = new Map();
  private messageCounter = 0;
  private readonly currentStreams: Map<string, StreamTarget> = new Map();
  private readonly inFlightByConversation: Map<string, StreamTarget> = new Map();
  private readonly streamListeners: Array<(event: StreamTextEvent) => void> = [];
  private readonly driverLostListeners: Array<() => void> = [];
  private readonly toolCallListeners: Array<(event: ToolCallEvent) => void> = [];
  private readonly readingRequestListeners: Array<(event: ReadingRequestEvent) => void> = [];
  private eventRoutingGeneration = 0;
  private eventRoutingCleanup: Array<() => void> | null = null;

  constructor(dependencies: ResidentSessionDependencies = {}) {
    this.deps = {
      startSession: dependencies.startSession ?? aiStartSession,
      sendMessage: dependencies.sendMessage ?? aiSendMessage,
      cancelMessage: dependencies.cancelMessage ?? aiCancelMessage,
      endSession: dependencies.endSession ?? aiEndSession,
      replayHistory: dependencies.replayHistory ?? aiReplayHistory,
      replayDone: dependencies.replayDone ?? aiReplayDone,
      listenDelta: dependencies.listenDelta ?? listenAiDelta,
      listenDriverLost: dependencies.listenDriverLost ?? listenAiDriverLost,
      listenToolCall: dependencies.listenToolCall ?? listenAiToolCall,
      listenReadingRequest: dependencies.listenReadingRequest ?? listenAiReadingRequest,
      getCurrentProjectPath: dependencies.getCurrentProjectPath ?? (() => null),
      newId: dependencies.newId ?? defaultNewId,
    };
  }

  /** 无会话则分配新会话 ID 并启动；已有会话则复用（增量发送的前提）。 */
  private async ensureSessionStarted(conversationId: string): Promise<string> {
    const existing = this.sessions.get(conversationId);
    if (existing !== undefined) return existing;
    const sessionId = this.deps.newId();
    const attempt = { invalidated: false };
    this.startingAttempts.set(conversationId, attempt);
    try {
      const result = await this.deps.startSession(sessionId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      if (attempt.invalidated) {
        void this.deps.endSession(sessionId).catch(() => {});
        throw new Error("请求已取消");
      }
      this.sessions.set(conversationId, sessionId);
      return sessionId;
    } finally {
      // 迟到尝试只清理自己，不得删除同一讨论后续尝试的记录。
      if (this.startingAttempts.get(conversationId) === attempt) {
        this.startingAttempts.delete(conversationId);
      }
    }
  }

  /** 记录一条在途流式目标（用于增量路由与取消）。 */
  private beginStreamTarget(target: StreamTarget): void {
    this.currentStreams.set(target.messageId, target);
    this.inFlightByConversation.set(target.conversationId, target);
  }

  /** 流式目标只在仍属于本次发送时清空：被更新的发送替换后不得误清。 */
  private clearStreamTarget(target: StreamTarget): void {
    this.currentStreams.delete(target.messageId);
    const existing = this.inFlightByConversation.get(target.conversationId);
    if (existing !== undefined && existing.messageId === target.messageId) {
      this.inFlightByConversation.delete(target.conversationId);
    }
  }

  /**
   * 通过常驻会话发送一次生成请求：
   * - `direct_question`：直接提问首轮，发问题 + 可选选区材料；
   * - `summon`：及时召唤首轮，空问题、只带选区材料（后端按召唤语义组装）；
   * - `follow_up`：只发 messages 中最后一条 user 消息（增量问题）。
   * 首轮请求携带来源身份（作品 / 文档 / 版本）与未保存正文快照（`snapshot`）；
   * 追问请求若保留首轮快照与来源身份，也随请求透传（后端可据增量语义选择是否使用）。
   *
   * 讨论身份（design D7）：三类发送统一在提交时解析 `讨论 id＋当前作品根路径`，
   * 随 identity 携带（后端据此注册本轮按需补读工具路由）；任一为空白时不携带，
   * 后端清路由，与旧发送行为向后兼容。作品路径在进入任何 await 前现取，避免
   * 会话启动期间切换作品读到新值。
   */
  async sendViaResidentSession(conversationId: string, request: GenerateAiRequest): Promise<GenerateAiResult> {
    const conversation = resolveConversationIdentity(conversationId, this.deps.getCurrentProjectPath());
    const sessionId = await this.ensureSessionStarted(conversationId);
    this.messageCounter += 1;
    const messageId = `${conversationId}:msg-${this.messageCounter}`;
    const target: StreamTarget = { conversationId, sessionId, messageId };
    const identity =
      conversation === null ? materialIdentityOf(request) : { ...materialIdentityOf(request), conversation };
    if (request.kind === "direct_question") {
      this.beginStreamTarget(target);
      try {
        return await this.deps.sendMessage(
          sessionId,
          messageId,
          "first",
          request.question,
          request.selected_text,
          identity,
        );
      } finally {
        this.clearStreamTarget(target);
      }
    }
    if (request.kind === "summon") {
      this.beginStreamTarget(target);
      try {
        return await this.deps.sendMessage(
          sessionId,
          messageId,
          "summon_first",
          "",
          request.selected_text,
          identity,
        );
      } finally {
        this.clearStreamTarget(target);
      }
    }
    const question = lastUserQuestionOf(request.messages);
    this.beginStreamTarget(target);
    try {
      return await this.deps.sendMessage(
        sessionId,
        messageId,
        "follow_up",
        question,
        undefined,
        identity,
      );
    } finally {
      this.clearStreamTarget(target);
    }
  }

  /** 取消指定讨论的当前在途生成（幂等 fire-and-forget，失败静默）。 */
  cancelMessage(conversationId: string): void {
    const target = this.inFlightByConversation.get(conversationId);
    if (target === undefined) {
      const attempt = this.startingAttempts.get(conversationId);
      if (attempt !== undefined) attempt.invalidated = true;
      return;
    }
    void this.deps.cancelMessage(target.sessionId, target.messageId).catch(() => {});
  }

  /** 结束某个讨论的常驻会话（`ai_end_session` 幂等且 fire-and-forget）。 */
  endSession(conversationId: string): void {
    const attempt = this.startingAttempts.get(conversationId);
    if (attempt !== undefined) attempt.invalidated = true;
    const sessionId = this.sessions.get(conversationId);
    if (sessionId === undefined) return;
    this.sessions.delete(conversationId);
    void this.deps.endSession(sessionId).catch(() => {});
  }

  /** 结束全部讨论的常驻会话（切换作品 / 应用退出）。 */
  endAllSessions(): void {
    for (const attempt of this.startingAttempts.values()) {
      attempt.invalidated = true;
    }
    for (const conversationId of [...this.sessions.keys()]) {
      this.endSession(conversationId);
    }
  }

  /**
   * 崩溃恢复：用新会话 ID 启动会话，重放显示历史并标记完成。
   * `origin` 携带讨论的发起方式，重放时按来源组装对应的入口层提示词。
   */
  async replaySession(
    conversationId: string,
    turns: readonly AiReplayTurn[],
    origin: AiReplayOrigin,
  ): Promise<void> {
    const sessionId = this.deps.newId();
    const attempt = { invalidated: false };
    this.startingAttempts.set(conversationId, attempt);
    try {
      const startResult = await this.deps.startSession(sessionId);
      if (!startResult.ok) throw new Error(startResult.error.message);

      try {
        if (attempt.invalidated) throw new Error("请求已取消");
        const replayResult = await this.deps.replayHistory(sessionId, [...turns], origin);
        if (attempt.invalidated) throw new Error("请求已取消");
        if (!replayResult.ok) throw new Error(replayResult.error.message);

        const doneResult = await this.deps.replayDone(sessionId);
        if (attempt.invalidated) throw new Error("请求已取消");
        if (!doneResult.ok) throw new Error(doneResult.error.message);

        this.sessions.set(conversationId, sessionId);
      } catch (error: unknown) {
        void this.deps.endSession(sessionId).catch(() => {});
        throw error;
      }
    } finally {
      if (this.startingAttempts.get(conversationId) === attempt) {
        this.startingAttempts.delete(conversationId);
      }
    }
  }

  /** 订阅流式增量事件（仅匹配当前在途消息的增量会到达），返回退订函数。 */
  onStreamText(listener: (event: StreamTextEvent) => void): () => void {
    this.streamListeners.push(listener);
    return () => {
      const index = this.streamListeners.indexOf(listener);
      if (index !== -1) this.streamListeners.splice(index, 1);
    };
  }

  /** 订阅驱动进程丢失事件，返回退订函数。 */
  onDriverLost(listener: () => void): () => void {
    this.driverLostListeners.push(listener);
    return () => {
      const index = this.driverLostListeners.indexOf(listener);
      if (index !== -1) this.driverLostListeners.splice(index, 1);
    };
  }

  /** 订阅工具调用轻量过程事件，返回退订函数。 */
  onToolCall(listener: (event: ToolCallEvent) => void): () => void {
    this.toolCallListeners.push(listener);
    return () => {
      const index = this.toolCallListeners.indexOf(listener);
      if (index !== -1) this.toolCallListeners.splice(index, 1);
    };
  }

  /** 订阅按需补读授权请求事件，返回退订函数。 */
  onReadingRequest(listener: (event: ReadingRequestEvent) => void): () => void {
    this.readingRequestListeners.push(listener);
    return () => {
      const index = this.readingRequestListeners.indexOf(listener);
      if (index !== -1) this.readingRequestListeners.splice(index, 1);
    };
  }

  /** 安装 Tauri 事件路由（当前生命周期内幂等）：ai-delta 按在途消息过滤转发。 */
  installSessionEventRouting(): void {
    if (this.eventRoutingCleanup !== null) return;
    const generation = ++this.eventRoutingGeneration;
    const cleanup: Array<() => void> = [];
    this.eventRoutingCleanup = cleanup;
    const retainUnlisten = (unlisten: () => void): void => {
      if (this.eventRoutingCleanup !== cleanup || generation !== this.eventRoutingGeneration) {
        unlisten();
        return;
      }
      cleanup.push(unlisten);
    };
    void this.deps.listenDelta((payload) => {
      if (generation !== this.eventRoutingGeneration) return;
      const stream = this.currentStreams.get(payload.message_id);
      if (stream === undefined) return;
      if (payload.session_id !== stream.sessionId || payload.message_id !== stream.messageId) {
        return;
      }
      for (const listener of this.streamListeners) {
        listener({
          conversationId: stream.conversationId,
          messageId: stream.messageId,
          text: payload.text,
        });
      }
    }).then(retainUnlisten).catch(() => {});
    void this.deps.listenDriverLost(() => {
      if (generation !== this.eventRoutingGeneration) return;
      // 驱动进程丢失：所有会话失效，清空会话映射。
      this.sessions.clear();
      for (const listener of this.driverLostListeners) listener();
    }).then(retainUnlisten).catch(() => {});
    // 工具调用轻量过程（任务 7.3）：按在途消息路由到所属讨论（与增量同一过滤，
    // 迟到 / 未知消息的工具调用事件不转发，不污染其他讨论）。
    void this.deps.listenToolCall((payload) => {
      if (generation !== this.eventRoutingGeneration) return;
      const stream = this.currentStreams.get(payload.message_id);
      if (stream === undefined) return;
      if (payload.session_id !== stream.sessionId || payload.message_id !== stream.messageId) {
        return;
      }
      for (const listener of this.toolCallListeners) {
        listener({
          conversationId: stream.conversationId,
          messageId: payload.message_id,
          callId: payload.call_id,
          tool: payload.tool,
          args: payload.args ?? {},
        });
      }
    }).then(retainUnlisten).catch(() => {});
    // 按需补读授权请求（任务 7.1）：按载荷中的讨论身份路由（授权属于讨论）。
    void this.deps.listenReadingRequest((payload) => {
      if (generation !== this.eventRoutingGeneration) return;
      for (const listener of this.readingRequestListeners) {
        listener({
          conversationId: payload.conversation_id,
          sessionId: payload.session_id,
          messageId: payload.message_id,
          callId: payload.call_id,
          reason: payload.reason,
        });
      }
    }).then(retainUnlisten).catch(() => {});
  }

  /** 销毁当前 Tauri 事件路由；可重复调用，之后允许重新安装。 */
  destroySessionEventRouting(): void {
    const cleanup = this.eventRoutingCleanup;
    if (cleanup === null) return;
    this.eventRoutingCleanup = null;
    this.eventRoutingGeneration += 1;
    for (const unlisten of cleanup.splice(0)) unlisten();
  }
}
