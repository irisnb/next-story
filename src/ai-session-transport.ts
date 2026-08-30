import {
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

export type { AiReplayTurn } from "./project-api.ts";

/**
 * 常驻 AI 会话传输层（change: resident-ai-session）。
 *
 * 会话身份与传输状态收敛在本模块：驱动进程内维护对话历史，前端首轮发
 * 「问题 + 可选选区材料」（直接提问）或「只带选区材料」（及时召唤），
 * 追问只发新增问题；流式增量经 `"ai-delta"` 事件路由到订阅者，`done`
 * （命令返回的全文）是最终事实。本层同时记录当前对话的发起方式，
 * 崩溃恢复重放时把来源传给后端，按来源组装入口层提示词。
 *
 * 本层不接触面板状态与 DOM，也不持有任何写入草稿本或正本文的入口
 * （零写回边界）；所有依赖可注入，便于测试。
 */

/** 当前流式传输的路由目标：只有匹配的增量才通知订阅者。 */
interface StreamTarget {
  readonly sessionId: string;
  readonly messageId: string;
}

export interface ResidentSessionDependencies {
  startSession?: typeof aiStartSession;
  sendMessage?: typeof aiSendMessage;
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
  sendViaResidentSession(request: GenerateAiRequest): Promise<GenerateAiResult>;
  endActiveSession(): void;
  replayActiveSession(turns: readonly AiReplayTurn[]): Promise<void>;
  onStreamText(listener: (text: string) => void): () => void;
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

export class ResidentAiSessionTransport implements AiSessionTransport {
  private readonly deps: Required<ResidentSessionDependencies>;
  private activeSessionId: string | null = null;
  private sessionStarted = false;
  /** 当前对话的发起方式；随首轮请求记录，新建对话时重置。 */
  private sessionOrigin: AiReplayOrigin | null = null;
  private messageCounter = 0;
  private currentStream: StreamTarget | null = null;
  private readonly streamListeners: Array<(text: string) => void> = [];
  private readonly driverLostListeners: Array<() => void> = [];
  private eventRoutingInstalled = false;

  constructor(dependencies: ResidentSessionDependencies = {}) {
    this.deps = {
      startSession: dependencies.startSession ?? aiStartSession,
      sendMessage: dependencies.sendMessage ?? aiSendMessage,
      endSession: dependencies.endSession ?? aiEndSession,
      replayHistory: dependencies.replayHistory ?? aiReplayHistory,
      replayDone: dependencies.replayDone ?? aiReplayDone,
      listenDelta: dependencies.listenDelta ?? listenAiDelta,
      listenDriverLost: dependencies.listenDriverLost ?? listenAiDriverLost,
      newId: dependencies.newId ?? defaultNewId,
    };
  }

  /** 无会话则分配新会话 ID 并启动；已有会话则复用（增量发送的前提）。 */
  private async ensureSessionStarted(): Promise<string> {
    if (this.sessionStarted && this.activeSessionId !== null) {
      return this.activeSessionId;
    }
    const sessionId = this.deps.newId();
    const result = await this.deps.startSession(sessionId);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    this.activeSessionId = sessionId;
    this.sessionStarted = true;
    return sessionId;
  }

  /** 流式目标只在仍属于本次发送时清空：被更新的发送替换后不得误清。 */
  private clearStreamTarget(sessionId: string, messageId: string): void {
    const stream = this.currentStream;
    if (stream !== null && stream.sessionId === sessionId && stream.messageId === messageId) {
      this.currentStream = null;
    }
  }

  /**
   * 通过常驻会话发送一次生成请求：
   * - `direct_question`：直接提问首轮，发问题 + 可选选区材料；
   * - `summon`：及时召唤首轮，空问题、只带选区材料（后端按召唤语义组装）；
   * - `follow_up`：只发 messages 中最后一条 user 消息（增量问题）。
   */
  async sendViaResidentSession(request: GenerateAiRequest): Promise<GenerateAiResult> {
    const sessionId = await this.ensureSessionStarted();
    this.messageCounter += 1;
    const messageId = `msg-${this.messageCounter}`;
    if (request.kind === "direct_question") {
      this.sessionOrigin = "direct_question";
      this.currentStream = { sessionId, messageId };
      try {
        return await this.deps.sendMessage(
          sessionId,
          messageId,
          "first",
          request.question,
          request.selected_text,
        );
      } finally {
        this.clearStreamTarget(sessionId, messageId);
      }
    }
    if (request.kind === "summon") {
      this.sessionOrigin = "summon";
      this.currentStream = { sessionId, messageId };
      try {
        // 召唤首轮：空问题、只带选区材料；前端不伪造默认问题文本。
        return await this.deps.sendMessage(
          sessionId,
          messageId,
          "summon_first",
          "",
          request.selected_text,
        );
      } finally {
        this.clearStreamTarget(sessionId, messageId);
      }
    }
    const question = lastUserQuestionOf(request.messages);
    this.currentStream = { sessionId, messageId };
    try {
      return await this.deps.sendMessage(sessionId, messageId, "follow_up", question);
    } finally {
      this.clearStreamTarget(sessionId, messageId);
    }
  }

  /**
   * 结束当前常驻会话并重置传输层状态（发起方式随会话一起重置）。
   * `ai_end_session` 幂等且 fire-and-forget：失败被吞掉，不阻塞新建对话 /
   * 作品切换。
   */
  endActiveSession(): void {
    const sessionId = this.activeSessionId;
    if (sessionId !== null && this.sessionStarted) {
      void this.deps.endSession(sessionId).catch(() => {});
    }
    this.activeSessionId = null;
    this.sessionStarted = false;
    this.sessionOrigin = null;
    this.messageCounter = 0;
    this.currentStream = null;
  }

  /**
   * 崩溃恢复：用新会话 ID 启动会话，重放显示历史并标记完成。
   * 重放携带当前对话的发起方式（无记录时按直接提问处理），重放完成后
   * 会话进入可继续追问状态。
   */
  async replayActiveSession(turns: readonly AiReplayTurn[]): Promise<void> {
    const sessionId = this.deps.newId();
    this.activeSessionId = sessionId;
    await this.deps.startSession(sessionId);
    await this.deps.replayHistory(sessionId, [...turns], this.sessionOrigin ?? "direct_question");
    await this.deps.replayDone(sessionId);
    this.sessionStarted = true;
  }

  /** 订阅流式增量文本（仅匹配当前在途消息的增量会到达），返回退订函数。 */
  onStreamText(listener: (text: string) => void): () => void {
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
      const stream = this.currentStream;
      if (stream === null) return;
      if (payload.session_id !== stream.sessionId || payload.message_id !== stream.messageId) {
        return;
      }
      for (const listener of this.streamListeners) listener(payload.text);
    });
    void this.deps.listenDriverLost(() => {
      for (const listener of this.driverLostListeners) listener();
    });
  }
}

/** 应用内共享的常驻会话传输层单例。 */
export const aiSessionTransport: AiSessionTransport = new ResidentAiSessionTransport();
