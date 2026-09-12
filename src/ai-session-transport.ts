import {
  aiCancelMessage,
  aiEndSession,
  aiReplayDone,
  aiReplayHistory,
  aiSendMessage,
  aiStartSession,
  listenAiDelta,
  listenAiDriverLost,
  type AiReplayOrigin,
  type AiReplayTurn,
} from "./project-api.ts";
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
 * 本层不接触面板状态与 DOM，也不持有任何写入草稿本或正本文的入口（零写回边界）；
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

export interface ResidentSessionDependencies {
  startSession?: typeof aiStartSession;
  sendMessage?: typeof aiSendMessage;
  cancelMessage?: typeof aiCancelMessage;
  endSession?: typeof aiEndSession;
  replayHistory?: typeof aiReplayHistory;
  replayDone?: typeof aiReplayDone;
  listenDelta?: typeof listenAiDelta;
  listenDriverLost?: typeof listenAiDriverLost;
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
  installSessionEventRouting(): void;
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
} | undefined {
  if (
    request.document_id === undefined &&
    request.project_path === undefined &&
    request.document_version === undefined &&
    request.snapshot === undefined
  ) {
    return undefined;
  }
  return {
    documentId: request.document_id,
    projectPath: request.project_path,
    documentVersion: request.document_version,
    snapshot: request.snapshot,
  };
}

export class ResidentAiSessionTransport implements AiSessionTransport {
  private readonly deps: Required<ResidentSessionDependencies>;
  private readonly sessions: Map<string, string> = new Map();
  private messageCounter = 0;
  private readonly currentStreams: Map<string, StreamTarget> = new Map();
  private readonly inFlightByConversation: Map<string, StreamTarget> = new Map();
  private readonly streamListeners: Array<(event: StreamTextEvent) => void> = [];
  private readonly driverLostListeners: Array<() => void> = [];
  private eventRoutingInstalled = false;

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
      newId: dependencies.newId ?? defaultNewId,
    };
  }

  /** 无会话则分配新会话 ID 并启动；已有会话则复用（增量发送的前提）。 */
  private async ensureSessionStarted(conversationId: string): Promise<string> {
    const existing = this.sessions.get(conversationId);
    if (existing !== undefined) return existing;
    const sessionId = this.deps.newId();
    const result = await this.deps.startSession(sessionId);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    this.sessions.set(conversationId, sessionId);
    return sessionId;
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
   */
  async sendViaResidentSession(conversationId: string, request: GenerateAiRequest): Promise<GenerateAiResult> {
    const sessionId = await this.ensureSessionStarted(conversationId);
    this.messageCounter += 1;
    const messageId = `${conversationId}:msg-${this.messageCounter}`;
    const target: StreamTarget = { conversationId, sessionId, messageId };
    if (request.kind === "direct_question") {
      this.beginStreamTarget(target);
      try {
        return await this.deps.sendMessage(
          sessionId,
          messageId,
          "first",
          request.question,
          request.selected_text,
          materialIdentityOf(request),
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
          materialIdentityOf(request),
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
        materialIdentityOf(request),
      );
    } finally {
      this.clearStreamTarget(target);
    }
  }

  /** 取消指定讨论的当前在途生成（幂等 fire-and-forget，失败静默）。 */
  cancelMessage(conversationId: string): void {
    const target = this.inFlightByConversation.get(conversationId);
    if (target === undefined) return;
    void this.deps.cancelMessage(target.sessionId, target.messageId).catch(() => {});
  }

  /** 结束某个讨论的常驻会话（`ai_end_session` 幂等且 fire-and-forget）。 */
  endSession(conversationId: string): void {
    const sessionId = this.sessions.get(conversationId);
    if (sessionId === undefined) return;
    this.sessions.delete(conversationId);
    void this.deps.endSession(sessionId).catch(() => {});
  }

  /** 结束全部讨论的常驻会话（切换作品 / 应用退出）。 */
  endAllSessions(): void {
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
    await this.deps.startSession(sessionId);
    await this.deps.replayHistory(sessionId, [...turns], origin);
    await this.deps.replayDone(sessionId);
    this.sessions.set(conversationId, sessionId);
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

  /** 安装 Tauri 事件路由（幂等，只装一次）：ai-delta 按在途消息过滤转发。 */
  installSessionEventRouting(): void {
    if (this.eventRoutingInstalled) return;
    this.eventRoutingInstalled = true;
    void this.deps.listenDelta((payload) => {
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
    });
    void this.deps.listenDriverLost(() => {
      // 驱动进程丢失：所有会话失效，清空会话映射。
      this.sessions.clear();
      for (const listener of this.driverLostListeners) listener();
    });
  }
}

/** 应用内共享的常驻会话传输层单例。 */
export const aiSessionTransport: AiSessionTransport = new ResidentAiSessionTransport();
