import { confirmDialog } from "../app-dialog.ts";
import type { MakingDom } from "../dom.ts";
import {
  chainSaveVersion,
  listenAiDriverLost,
  listenMakingMessage,
  makingCancelMessage,
  makingChainEnsureForConversation,
  makingConversationDelete,
  makingConversationList,
  makingConversationLoad,
  makingConversationSave,
  makingEndSession,
  makingSendMessage,
  makingStartSession,
  type Chain,
  type EnsureChainResult,
  type InvokeFn,
  type ListenFn,
  type MakingConversationRecord,
  type MakingConversationSummary,
  type MakingConversationTurn,
} from "../project-api.ts";
import {
  buildCardDraftPanelView,
  buildChainStatusMessage,
  deriveMakingTitle,
  draftToCardInput,
  makingListTitle,
  makingListUpdatedAtLabel,
  makingSendErrorNotice,
  makingTurnStatusLabel,
  parseCardDrafts,
  type MakingCardDraft,
} from "./making-conversation.ts";

/**
 * 制作对话区控制器（add-making-module-core 任务 7.5/7.6，车道 F2a）。
 *
 * 职责与边界：
 * - 会话按链路组织：制作对象未选＝空态引导（含所浏览链路的最近会话「继续」
 *   与历史列表）；制作对象已选＝当前会话转录＋输入（同会话单轮进行中禁发）。
 * - 发送流镜像日常讨论的保存节奏：本地追加轮次 → 整档保存 → 懒启动会话 →
 *   发送 → 流式渲染（`making-message-event`）→ 终态原子更新 → 再保存；
 *   保存失败如实提示，绝不显示「已保存」。
 * - 崩溃复位：`ai-driver-lost` 后对已启动的制作会话调 `making_end_session`
 *   （随后 start/send 自动走恢复路径），界面提示「连接已恢复，可继续」。
 * - 卡草稿：解析助手消息中的标记块渲染草稿面板；**只有用户点「保存这版草稿」
 *   并经确认后才 `chain_save_version`**（链路库不因助手输出自动写入）；
 *   「开始试问」留给下一车道（钩子见 `setTrialLauncher`）。
 * - 新会话链路现状附言（add-posture-slot 任务 7.6）：新会话建立（「开始新制作」
 *   等 startNewSession 路径）后自动经既有发送通道发出首条「链路现状」附言
 *   （最新版本全部卡的全文），让制作助手能完整重述既有卡（「并存」草稿）；
 *   取不到链路时不发（守则的诚实回退覆盖）；「继续上次制作」不重复附言。
 * - 本控制器不触碰任何作品数据（制作助手不读作品；user 文本纯文本直发）。
 */

/** 试问车道挂点：拿到草稿组与链路身份后发起试问（由下一车道提供实现）。 */
export type MakingTrialLauncher = (request: {
  readonly chainId: string;
  readonly chainName: string;
  readonly drafts: readonly MakingCardDraft[];
}) => void;

export interface MakingConversationServices {
  /** 制作对话命令的 invoke 实现（测试注入；缺省用真实 Tauri invoke）。 */
  readonly call?: InvokeFn;
  /** 事件订阅（测试注入；缺省用真实 Tauri listen）。 */
  readonly listen?: ListenFn;
  /** 确认对话框（测试注入；缺省用 app-dialog 的原生确认）。 */
  readonly confirm?: (message: string) => Promise<boolean>;
  /** 读取链路（草稿确认文案与试问钩子需要链路名称快照）；未绑定（null）返回 null。 */
  readonly getChain: (chainId: string | null) => Chain | null;
  /** 链路库刷新入口（保存草稿成功后调用，刷新链路库与状态条的新草稿提示）。 */
  readonly refreshLibrary: () => Promise<void>;
  /** 切换制作对象（空态「继续最近会话」入口需要；即制作页的 setMakingObject）。 */
  readonly switchMakingObject: (chainId: string | null) => void;
  /** 试问入口（下一车道接线）；缺省「开始试问」禁用占位。 */
  readonly startTrial?: MakingTrialLauncher;
}

/** 制作会话的运行期状态（档案真相源＋在途消息与提示位）。 */
interface MakingSessionRuntime {
  record: MakingConversationRecord;
  /** 在途消息 id（同会话单轮进行中；null＝空闲）。 */
  pendingMessageId: string | null;
  /** 已本地停止的消息 id（迟到结果与增量不覆盖已停止状态）。 */
  readonly cancelledMessages: Set<string>;
  /** 本次应用运行内是否已 `making_start_session`（driver lost 后复位）。 */
  started: boolean;
  /** 最近一次失败轮的用户可见错误（档案只存 status，不存错误文案）。 */
  turnError: string | null;
  /** 最近一次整档保存的错误；null＝无失败（不显示任何「已保存」表态）。 */
  saveError: string | null;
  /**
   * 待补保存的绑定链路 id：首次保存已建立链路，但会话绑定的整档保存失败时置位；
   * 该阶段只补保存绑定，不重复 ensure、不再追加版本。null＝无待补绑定。
   */
  pendingBindChainId: string | null;
  /** 同会话整档保存串行队列（避免旧轮快照晚到覆盖新状态）。 */
  saveQueue: Promise<void>;
}

/** 制作对话区控制器的稳定接口（供制作页控制器与后续试问车道使用）。 */
export interface MakingConversationController {
  /** 制作对象链路变化（null＝回到空态；切换后不自动打开会话）。 */
  setChain(chainId: string | null): void;
  /** 所浏览链路变化（空态「继续最近会话」列表随之刷新；不影响制作对象）。 */
  onBrowseChain(chainId: string | null): void;
  /** 为当前制作链路开一个新制作会话（标题在首条消息后派生）。 */
  startNewSession(): void;
  /** 打开指定制作会话（继续；后端自动恢复会话与重放历史，前端不传历史）。 */
  openConversation(id: string): Promise<void>;
  /** 重读会话列表（refresh 链路库后调用，历史列表与最近入口保持新鲜）。 */
  refreshList(): Promise<void>;
  /** 当前打开的制作会话 id（未开＝null）。 */
  readonly currentConversationId: string | null;
  /** 试问车道挂点：注册后「开始试问」可用，把草稿组与链路身份交给试问 UI。 */
  setTrialLauncher(launcher: MakingTrialLauncher | null): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 生成制作会话 id（`mc-` 前缀，时间戳＋随机段）。 */
export function generateMakingConversationId(randomSegment: () => string = defaultRandomSegment): string {
  return `mc-${Date.now().toString(36)}-${randomSegment()}`;
}

function defaultRandomSegment(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export function setupMakingConversation(
  dom: MakingDom,
  services: MakingConversationServices,
): MakingConversationController {
  const call = services.call;
  const listen = services.listen;
  const confirm = services.confirm ?? confirmDialog;
  const getChain = services.getChain;
  const refreshLibrary = services.refreshLibrary;
  const switchMakingObject = services.switchMakingObject;
  let trialLauncher: MakingTrialLauncher | null = services.startTrial ?? null;

  /** 制作对象链路（null＝空态）。 */
  let makingChainId: string | null = null;
  /** 所浏览链路（空态最近会话列表的数据源；不影响制作对象）。 */
  let browseChainId: string | null = null;
  /** 当前打开的制作会话 id。 */
  let currentId: string | null = null;
  /** 制作链路的会话列表（`updated_at` 倒序）与如实提示位。 */
  let list: MakingConversationSummary[] = [];
  let listSkipped: string[] = [];
  let listError: string | null = null;
  /** 面板级提示（连接恢复 / 草稿保存结果等）；保存失败独立于该位显示。 */
  let notice: { readonly kind: "info" | "error"; readonly text: string } | null = null;
  let historyOpen = false;
  let messageCounter = 0;
  const sessions = new Map<string, MakingSessionRuntime>();

  function currentSession(): MakingSessionRuntime | null {
    return currentId === null ? null : sessions.get(currentId) ?? null;
  }

  function lastAssistantTurn(record: MakingConversationRecord): MakingConversationTurn | null {
    for (let index = record.turns.length - 1; index >= 0; index -= 1) {
      const turn = record.turns[index];
      if (turn.role === "assistant") return turn;
    }
    return null;
  }

  // ========== 提示与输入状态 ==========

  function renderNotice(): void {
    const session = currentSession();
    const saveError = session?.saveError ?? null;
    if (saveError !== null) {
      dom.sessionNotice.classList.remove("hidden", "making-session-notice-error");
      dom.sessionNotice.classList.add("making-session-notice-error");
      dom.sessionNotice.textContent = `制作会话保存失败：${saveError}（当前内容未保存成功，可继续对话）`;
      return;
    }
    if (notice !== null) {
      dom.sessionNotice.classList.remove("hidden");
      dom.sessionNotice.classList.toggle("making-session-notice-error", notice.kind === "error");
      dom.sessionNotice.textContent = notice.text;
      return;
    }
    dom.sessionNotice.classList.add("hidden");
    dom.sessionNotice.textContent = "";
  }

  function updateInputState(): void {
    const session = currentSession();
    const generating = session !== null && session.pendingMessageId !== null;
    const enabled = session !== null && !generating;
    dom.conversationInput.disabled = !enabled;
    dom.conversationInput.placeholder = session === null
      ? "先开始或继续一个制作会话"
      : "说说希望 AI 多做什么、少做什么";
    dom.conversationSend.disabled = !enabled;
    dom.conversationSend.removeAttribute("title");
    dom.conversationStop.hidden = !generating;
  }

  // ========== 会话列表（空态最近入口＋历史列表共用） ==========

  /**
   * 会话列表的作用域身份：有打开会话时以会话自身绑定为准（未绑定＝null），
   * 不被当前浏览对象覆盖；无打开会话时用制作对象或浏览对象。
   */
  function listScopeChainId(): string | null {
    const session = currentSession();
    if (session !== null) return session.record.chain_id;
    return makingChainId ?? browseChainId;
  }

  async function refreshList(): Promise<void> {
    // 打开会话：按会话绑定身份列出（未绑定＝未绑定列表）；否则按制作/浏览对象。
    const chainId = listScopeChainId();
    try {
      const result = await makingConversationList(chainId, call);
      list = result.conversations;
      listSkipped = result.skipped;
      listError = null;
    } catch (error) {
      list = [];
      listSkipped = [];
      listError = errorMessage(error);
    }
    renderRecent();
    renderHistoryList();
  }

  /** 空态「该链路的最近制作会话」区（继续上次制作＋历史列表入口）。 */
  function renderRecent(): void {
    const container = dom.conversationRecent;
    container.replaceChildren();
    // 只在空态（未打开会话）显示最近入口；制作对象存在或已有打开会话时由转录接管。
    if (makingChainId !== null || currentSession() !== null) {
      container.classList.add("hidden");
      return;
    }
    container.classList.remove("hidden");
    // browseChainId 为 null 时展示未绑定会话（空库直接口述建立、尚未保存草稿）。
    const chainId = browseChainId;
    const chain = chainId === null ? null : getChain(chainId);
    if (listError !== null) {
      container.append(recentLine(`读取制作会话列表失败：${listError}`));
      return;
    }
    if (listSkipped.length > 0) {
      container.append(recentLine(`有 ${listSkipped.length} 份历史会话无法读取，已跳过。`));
    }
    if (list.length === 0) {
      if (listSkipped.length === 0) container.classList.add("hidden");
      return;
    }
    const heading = document.createElement("p");
    heading.className = "making-recent-title";
    heading.textContent = chainId === null ? "未绑定的制作会话" : `「${chain?.name ?? "该链路"}」的制作会话`;
    container.append(heading);
    const [mostRecent, ...rest] = list;
    const continueBtn = document.createElement("button");
    continueBtn.type = "button";
    continueBtn.className = "making-action-btn primary making-recent-continue";
    continueBtn.textContent = `继续上次制作：${makingListTitle(mostRecent.title)}（${makingListUpdatedAtLabel(mostRecent.updated_at)}，${mostRecent.turn_count} 轮）`;
    continueBtn.addEventListener("click", () => {
      if (chainId !== null) switchMakingObject(chainId);
      void openConversation(mostRecent.id);
    });
    container.append(continueBtn);
    if (rest.length > 0) {
      container.append(buildSessionList(rest, chainId));
    }
  }

  function recentLine(text: string): HTMLElement {
    const line = document.createElement("p");
    line.className = "making-recent-note";
    line.textContent = text;
    return line;
  }

  /** 会话列表（历史条目：点击打开＋独立删除动作）。 */
  function buildSessionList(entries: readonly MakingConversationSummary[], chainId: string | null): HTMLElement {
    const listElement = document.createElement("div");
    listElement.className = "making-session-list";
    listElement.setAttribute("role", "list");
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "making-session-list-row";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "making-session-list-open";
      open.textContent = `${makingListTitle(entry.title)}（${makingListUpdatedAtLabel(entry.updated_at)}，${entry.turn_count} 轮）`;
      open.addEventListener("click", () => {
        if (chainId !== null && makingChainId === null) switchMakingObject(chainId);
        void openConversation(entry.id);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "making-mini-btn making-session-list-delete";
      del.textContent = "删除";
      del.addEventListener("click", () => { void deleteConversation(entry); });
      row.append(open, del);
      listElement.append(row);
    }
    return listElement;
  }

  function renderHistoryList(): void {
    const container = dom.sessionHistoryList;
    container.replaceChildren();
    // 有打开会话（含未绑定）或制作对象时都可用；未绑定时列出未绑定会话。
    const scopeChainId = listScopeChainId();
    if (scopeChainId === null && currentSession() === null) {
      container.classList.add("hidden");
      dom.sessionHistoryBtn.setAttribute("aria-expanded", "false");
      return;
    }
    dom.sessionHistoryBtn.setAttribute("aria-expanded", historyOpen ? "true" : "false");
    container.classList.toggle("hidden", !historyOpen);
    if (!historyOpen) return;
    if (listError !== null) {
      container.append(recentLine(`读取制作会话列表失败：${listError}`));
      return;
    }
    if (listSkipped.length > 0) {
      container.append(recentLine(`有 ${listSkipped.length} 份历史会话无法读取，已跳过。`));
    }
    if (list.length === 0) {
      container.append(recentLine("还没有制作会话。"));
      return;
    }
    container.append(buildSessionList(list, scopeChainId));
  }

  // ========== 转录渲染 ==========

  function renderPane(): void {
    const session = currentSession();
    if (makingChainId === null && session === null) {
      dom.conversationEmpty.classList.remove("hidden");
      dom.conversationActive.classList.add("hidden");
      renderRecent();
      updateInputState();
      return;
    }
    dom.conversationEmpty.classList.add("hidden");
    dom.conversationActive.classList.remove("hidden");
    dom.sessionTitle.textContent = session === null
      ? "（尚未打开会话）"
      : makingListTitle(session.record.title);
    renderMessages();
    renderHistoryList();
    renderNotice();
    updateInputState();
  }

  function nearBottom(element: HTMLElement): boolean {
    return element.scrollTop + element.clientHeight >= element.scrollHeight - 48;
  }

  function scrollToBottom(): void {
    dom.sessionMessages.scrollTop = dom.sessionMessages.scrollHeight;
  }

  function renderMessages(): void {
    const container = dom.sessionMessages;
    const session = currentSession();
    const shouldStick = container.children.length === 0 || nearBottom(container);
    container.replaceChildren();
    if (session === null) {
      const hint = document.createElement("p");
      hint.className = "making-recent-note";
      hint.textContent = "点「新会话」开始，或从「历史会话」继续之前的制作。";
      container.append(hint);
      if (shouldStick) scrollToBottom();
      return;
    }
    const record = session.record;
    for (let index = 0; index < record.turns.length; index += 1) {
      const turn = record.turns[index];
      const message = document.createElement("div");
      message.className = `making-msg making-msg-${turn.role}`;
      message.dataset.turnIndex = String(index);
      const text = document.createElement("p");
      text.className = "making-msg-text";
      text.textContent = turn.text;
      message.append(text);
      const statusLabel = turn.role === "assistant"
        ? makingTurnStatusLabel(turn.status)
        : null;
      if (statusLabel !== null || (turn.role === "assistant" && turn.status === "failed" && index === record.turns.length - 1 && session.turnError !== null)) {
        const status = document.createElement("p");
        status.className = `making-msg-status${turn.status === "failed" ? " is-error" : turn.status === "pending" ? " is-pending" : ""}`;
        // 失败轮附最近一次错误文案（档案只存 status，文案为运行期提示）。
        status.textContent = turn.status === "failed" && index === record.turns.length - 1 && session.turnError !== null
          ? `生成失败：${session.turnError}`
          : statusLabel ?? "";
        message.append(status);
      }
      container.append(message);
      // 卡草稿面板：仅终态 assistant 轮解析（生成中不解析半截标记）。
      if (turn.role === "assistant" && (turn.status === "success" || turn.status === "cancelled")) {
        const panel = buildDraftPanel(turn.text, session, index);
        if (panel !== null) container.append(panel);
      }
    }
    if (shouldStick) scrollToBottom();
  }

  /** 流式增量：只更新末尾 assistant 轮的文本节点（不重建整个转录）。 */
  function appendStreamText(session: MakingSessionRuntime, text: string): void {
    const record = session.record;
    const assistant = lastAssistantTurn(record);
    if (assistant === null) return;
    assistant.text += text;
    const index = record.turns.findIndex((turn) => turn === assistant);
    if (index < 0) return;
    const node = dom.sessionMessages.querySelector<HTMLParagraphElement>(
      `[data-turn-index="${index}"] > .making-msg-text`,
    );
    if (node === null) {
      renderMessages();
      return;
    }
    const stick = nearBottom(dom.sessionMessages);
    node.textContent = assistant.text;
    if (stick) scrollToBottom();
  }

  // ========== 卡草稿面板（保存经用户确认；试问留钩子） ==========

  /** 草稿保存的链路名：已绑定取链路名；未绑定以会话标题（首条口述）为名，空则「新链路」。 */
  function chainNameOf(session: MakingSessionRuntime): string {
    const boundChainId = session.record.chain_id;
    const boundName = boundChainId === null ? null : getChain(boundChainId)?.name ?? null;
    if (boundName !== null) return boundName;
    const title = session.record.title.trim();
    return title.length > 0 ? title : "新链路";
  }

  function buildDraftPanel(assistantText: string, session: MakingSessionRuntime, turnIndex: number): HTMLElement | null {
    const drafts = parseCardDrafts(assistantText);
    if (drafts.length === 0) return null;
    const chainName = chainNameOf(session);
    const view = buildCardDraftPanelView(drafts, chainName);
    if (view === null) return null;
    const panel = document.createElement("section");
    panel.className = "making-draft-panel";
    panel.dataset.draftTurnIndex = String(turnIndex);
    const heading = document.createElement("h4");
    heading.className = "making-draft-heading";
    heading.textContent = `卡草稿（${drafts.length > 1 ? `${drafts.length} 张` : "1 张"}）`;
    panel.append(heading);
    for (const draft of drafts) {
      const card = document.createElement("div");
      card.className = "making-draft-card";
      // 逐卡类型徽标（add-posture-slot 任务 3.2）：草稿面板先看清是要求卡还是姿态卡。
      const typeBadge = document.createElement("p");
      typeBadge.className = `making-draft-type${draft.slotType === "posture" ? " is-posture" : ""}`;
      typeBadge.textContent = draft.slotType === "posture" ? "回应风格" : "回应要求";
      card.append(
        typeBadge,
        draftLine("卡名", draft.title),
        draftLine("何时用", draft.whenToUse.length > 0 ? draft.whenToUse : "（未说明）"),
        draftLine("何时不用", draft.whenNotToUse.length > 0 ? draft.whenNotToUse : "（未说明）"),
        draftBody(draft.body),
      );
      panel.append(card);
    }
    const actions = document.createElement("div");
    actions.className = "making-draft-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "making-mini-btn primary";
    save.textContent = "保存这版草稿";
    save.addEventListener("click", () => { void saveDrafts(drafts, session); });
    const trial = document.createElement("button");
    trial.type = "button";
    trial.className = "making-mini-btn";
    trial.textContent = "开始试问";
    const boundChainId = session.record.chain_id;
    if (boundChainId !== null && trialLauncher !== null) {
      trial.addEventListener("click", () => trialLauncher!({ chainId: boundChainId, chainName, drafts }));
    } else {
      trial.disabled = true;
      trial.title = boundChainId === null ? "先保存草稿建立链路后再试问" : "试问功能随后接入";
    }
    actions.append(save, trial);
    panel.append(actions);
    const note = document.createElement("p");
    note.className = "making-draft-note";
    note.textContent = view.boundaryNote;
    panel.append(note);
    return panel;
  }

  function draftLine(label: string, value: string): HTMLElement {
    const line = document.createElement("p");
    line.className = "making-draft-line";
    const name = document.createElement("span");
    name.className = "making-draft-label";
    name.textContent = `${label}：`;
    const content = document.createElement("span");
    content.textContent = value;
    line.append(name, content);
    return line;
  }

  function draftBody(body: string): HTMLElement {
    const pre = document.createElement("pre");
    pre.className = "making-draft-body";
    pre.textContent = body.length > 0 ? body : "（无正文）";
    return pre;
  }

  async function saveDrafts(drafts: readonly MakingCardDraft[], session: MakingSessionRuntime): Promise<void> {
    const chainName = chainNameOf(session);
    const view = buildCardDraftPanelView(drafts, chainName);
    if (view === null) return;
    // 取消保存：不建立链路（未绑定会话保持未绑定）。
    if (!await confirm(view.saveConfirm)) return;
    const cards = drafts.map(draftToCardInput);
    // 优先处理「待补绑定」阶段：首次保存的链路已建立，只需把绑定写回档案，
    // 不再重复 ensure、不再追加版本。
    if (session.pendingBindChainId !== null) {
      await retryBind(session);
      return;
    }
    const boundChainId = session.record.chain_id;
    if (boundChainId === null) {
      // 未绑定：一次建立「链路＋首版本」（后端有界限定操作，以会话 id 派生确定性 id、
      // 以卡内容判重），再绑定并持久化。绑定保存失败进入待补绑定阶段，可安全重试。
      try {
        const result = await makingChainEnsureForConversation(
          session.record.id,
          chainName,
          cards,
          "制作会话保存",
          call,
        );
        await persistBinding(session, result.chain.id, result);
      } catch (error) {
        notice = { kind: "error", text: `草稿保存失败：${errorMessage(error)}` };
        renderNotice();
      }
      return;
    }
    // 已绑定：追加新版本（普通保存路径）。
    try {
      const version = await chainSaveVersion(boundChainId, cards, "制作会话保存", call);
      notice = {
        kind: "info",
        text: `已保存为「${chainName}·第${version.index}版」草稿；尚未启用，启用请在结构检视里显式操作。`,
      };
      await refreshLibrary();
    } catch (error) {
      notice = { kind: "error", text: `草稿保存失败：${errorMessage(error)}` };
    }
    renderNotice();
  }

  /**
   * 绑定并持久化首次保存建立的链路。绑定保存失败时不改内存绑定为「已成功」，
   * 而是进入待补绑定阶段：重试只补保存绑定，不重复 ensure、不再追加版本。
   */
  /**
   * 异步完成后：该会话仍是当前打开且未被替换/删除时，才允许切换制作对象等 UI。
   * 旧会话在等待期间被切走/替换/删除时，保存照旧完成，但不得抢当前投影。
   */
  function isStillCurrentSession(session: MakingSessionRuntime): boolean {
    return currentId === session.record.id && sessions.get(session.record.id) === session;
  }

  async function persistBinding(
    session: MakingSessionRuntime,
    chainId: string,
    result: EnsureChainResult,
  ): Promise<void> {
    session.record.chain_id = chainId;
    const saved = await saveSession(session);
    if (!saved) {
      session.pendingBindChainId = chainId;
      notice = {
        kind: "error",
        text: "链路已建立，但会话绑定未能保存；请再次点「保存这版草稿」补保存绑定（不会重复建立链路或版本）。",
      };
      renderNotice();
      return;
    }
    session.pendingBindChainId = null;
    await refreshLibrary();
    // 异步保存期间用户可能已切到别的会话：不得用旧会话完成抢当前投影/制作对象。
    if (!isStillCurrentSession(session)) return;
    switchMakingObject(chainId);
    if (result.action === "conflict") {
      // 既有链路已有不同版本：明确冲突，不谎称已保存；恢复绑定后由普通保存追加。
      notice = {
        kind: "info",
        text: `该制作会话此前已建立链路「${result.chain.name}」；已绑定。当前草稿与既有版本不同，请再次点「保存这版草稿」追加为新版本。`,
      };
    } else {
      const version = result.chain.versions[result.chain.versions.length - 1];
      notice = {
        kind: "info",
        text: `已保存为「${result.chain.name}·第${version?.index ?? 1}版」草稿；尚未启用，启用请在结构检视里显式操作。`,
      };
    }
    renderNotice();
  }

  /** 待补绑定阶段：只补保存会话绑定（不建链路、不追加版本）。 */
  async function retryBind(session: MakingSessionRuntime): Promise<void> {
    const chainId = session.pendingBindChainId;
    if (chainId === null) return;
    session.record.chain_id = chainId;
    const saved = await saveSession(session);
    if (saved) {
      session.pendingBindChainId = null;
      await refreshList();
      if (!isStillCurrentSession(session)) return;
      switchMakingObject(chainId);
      notice = { kind: "info", text: "已补保存会话绑定；可继续对话或再次保存草稿。" };
    } else {
      notice = {
        kind: "error",
        text: `会话绑定仍未保存：${session.saveError ?? "保存失败"}，可再次重试。`,
      };
    }
    renderNotice();
  }

  // ========== 保存与发送 ==========

  /**
   * 整档保存（同会话串行）：呼叫方按入队顺序取快照落盘，旧轮快照不会晚到覆盖新状态。
   * 返回本次写入是否成功（失败设置 `saveError`，调用方可据此决定重试/待补绑定）。
   */
  async function saveSession(session: MakingSessionRuntime): Promise<boolean> {
    session.record.updated_at = nowIso();
    const snapshot = structuredClone(session.record);
    const write = session.saveQueue.then(async (): Promise<boolean> => {
      try {
        await makingConversationSave(snapshot, call);
        session.saveError = null;
        // 任意成功写入若已带上绑定，则待补绑定阶段结束（避免重复补绑定）。
        if (session.pendingBindChainId !== null && session.record.chain_id === session.pendingBindChainId) {
          session.pendingBindChainId = null;
        }
        return true;
      } catch (error) {
        session.saveError = errorMessage(error);
        return false;
      } finally {
        renderNotice();
      }
    });
    // 队列只负责串行；前序失败不影响后续写入。
    session.saveQueue = write.then(() => undefined, () => undefined);
    return write;
  }

  function newRuntime(record: MakingConversationRecord): MakingSessionRuntime {
    return {
      record,
      pendingMessageId: null,
      cancelledMessages: new Set(),
      started: false,
      turnError: null,
      saveError: null,
      pendingBindChainId: null,
      saveQueue: Promise.resolve(),
    };
  }

  /**
   * 发送一轮用户消息（正常轮次机制：本地追加轮次 → 整档保存 → 懒启动会话 →
   * 发送 → 流式渲染 → 终态原子更新 → 再保存）。手动输入与新会话的「链路现状」
   * 附言共用此通道；附言不派生标题（标题留给用户首条口述）。附言发送期间同样
   * 占用「同会话单轮进行中禁发」约束。
   */
  async function sendUserTurn(
    session: MakingSessionRuntime,
    text: string,
    options: { readonly deriveTitle: boolean },
  ): Promise<void> {
    if (session.pendingMessageId !== null) return;
    const record = session.record;
    if (options.deriveTitle) {
      notice = null;
      session.turnError = null;
      if (record.title.trim().length === 0) record.title = deriveMakingTitle(text);
    }
    record.turns.push({ role: "user", text, status: "success" });
    record.turns.push({ role: "assistant", text: "", status: "pending" });
    renderPane();
    await saveSession(session);

    messageCounter += 1;
    const messageId = `${record.id}:mmsg-${messageCounter}`;
    session.pendingMessageId = messageId;
    renderPane();
    try {
      if (!session.started) {
        const start = await makingStartSession(record.id, call);
        if (!start.ok) throw new Error(makingSendErrorNotice(start.error.code, start.error.message));
        session.started = true;
      }
      const result = await makingSendMessage(record.id, messageId, text, call);
      if (session.cancelledMessages.has(messageId)) return;
      const assistant = lastAssistantTurn(record);
      if (assistant === null) return;
      if (result.ok) {
        assistant.text = result.content;
        assistant.status = "success";
      } else {
        assistant.status = "failed";
        session.turnError = makingSendErrorNotice(result.error.code, result.error.message);
      }
    } catch (error) {
      if (session.cancelledMessages.has(messageId)) return;
      const assistant = lastAssistantTurn(record);
      if (assistant !== null) assistant.status = "failed";
      session.turnError = errorMessage(error);
    } finally {
      if (session.pendingMessageId === messageId) session.pendingMessageId = null;
      session.cancelledMessages.delete(messageId);
      renderPane();
      await saveSession(session);
      await refreshList();
    }
  }

  async function handleSubmit(): Promise<void> {
    const session = currentSession();
    const text = dom.conversationInput.value.trim();
    if (session === null || session.pendingMessageId !== null || text.length === 0) return;
    dom.conversationInput.value = "";
    await sendUserTurn(session, text, { deriveTitle: true });
  }

  function handleStop(): void {
    const session = currentSession();
    if (session === null || session.pendingMessageId === null) return;
    const messageId = session.pendingMessageId;
    session.cancelledMessages.add(messageId);
    void makingCancelMessage(session.record.id, messageId, call).catch(() => {});
    const assistant = lastAssistantTurn(session.record);
    if (assistant !== null) assistant.status = "cancelled";
    session.pendingMessageId = null;
    session.turnError = null;
    renderPane();
    void saveSession(session).then(() => refreshList());
  }

  async function deleteConversation(entry: MakingConversationSummary): Promise<void> {
    const confirmed = await confirm(
      `删除制作会话「${makingListTitle(entry.title)}」？对话记录将删除，不可恢复；链路与卡片不受影响。`,
    );
    if (!confirmed) return;
    try {
      await makingConversationDelete(entry.id, call);
    } catch (error) {
      notice = { kind: "error", text: `删除制作会话失败：${errorMessage(error)}` };
      renderNotice();
      return;
    }
    sessions.delete(entry.id);
    const deletedCurrent = currentId === entry.id;
    if (deletedCurrent) currentId = null;
    await refreshList();
    if (deletedCurrent) {
      const mostRecent = list[0];
      if (mostRecent !== undefined) {
        await openConversation(mostRecent.id);
      } else {
        startNewSession();
      }
    }
    renderPane();
  }

  // ========== 对外接口 ==========

  async function openConversation(id: string): Promise<void> {
    const existing = sessions.get(id);
    if (existing !== undefined && existing.pendingMessageId !== null) {
      // 在途会话：保留本地较新状态，只切换显示。
      currentId = id;
      historyOpen = false;
      renderPane();
      void refreshList();
      return;
    }
    try {
      const record = await makingConversationLoad(id, call);
      if (existing !== undefined) {
        existing.record = record;
      } else {
        sessions.set(id, newRuntime(record));
      }
      currentId = id;
      historyOpen = false;
      renderPane();
      void refreshList();
    } catch (error) {
      notice = { kind: "error", text: `打开制作会话失败：${errorMessage(error)}` };
      renderPane();
    }
  }

  function startNewSession(): void {
    // 允许未绑定会话（空库直接口述）：makingChainId 为 null 时 chain_id 记 null，
    // 不发「链路现状」附言（没有链路可述，不虚构），保存草稿时才建立链路并绑定。
    const record: MakingConversationRecord = {
      id: generateMakingConversationId(),
      chain_id: makingChainId,
      title: "",
      created_at: nowIso(),
      updated_at: nowIso(),
      turns: [],
    };
    const runtime = newRuntime(record);
    sessions.set(record.id, runtime);
    currentId = record.id;
    notice = null;
    historyOpen = false;
    renderPane();
    void refreshList();
    dom.conversationInput.focus();
    // 新会话链路现状附言（add-posture-slot 任务 7.6）：建立新会话后自动经既有
    // 发送通道发出首条「链路现状」附言（最新版本全部卡的全文），让制作助手拿到
    // 既有卡的完整内容（「并存」草稿须完整重述）。取不到链路（getChain null）时
    // 不发（守则的诚实回退覆盖）、不报错；发送失败走正常失败轮如实呈现，不阻断
    // 会话。「继续上次制作」（openConversation）不经此路径，不重复附言。
    const chain = makingChainId === null ? null : getChain(makingChainId);
    if (chain === null) {
      // 未绑定（空库直接口述）：无「链路现状」附言可发；立即落一版空档案，
      // 使未绑定会话在重启后仍可从最近入口重开（保存失败如实提示，不阻断）。
      void saveSession(runtime);
      return;
    }
    void sendUserTurn(runtime, buildChainStatusMessage(chain), { deriveTitle: false });
  }

  // ========== 事件接线 ==========

  dom.conversationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleSubmit();
  });

  dom.conversationStop.addEventListener("click", handleStop);

  dom.sessionNewBtn.addEventListener("click", startNewSession);

  dom.sessionHistoryBtn.addEventListener("click", () => {
    historyOpen = !historyOpen;
    renderHistoryList();
  });

  // 流式增量：按在途消息路由（迟到/未知消息的增量不转发，不污染其他会话）。
  listenMakingMessage((payload) => {
    const session = sessions.get(payload.session_id);
    if (session === undefined || session.pendingMessageId !== payload.message_id) return;
    appendStreamText(session, payload.text);
  }, listen).catch(() => {});

  // 驱动进程丢失：对已启动的制作会话复位（随后 start/send 自动走恢复路径）。
  listenAiDriverLost(() => {
    for (const session of sessions.values()) {
      if (!session.started) continue;
      session.started = false;
      void makingEndSession(session.record.id, call).catch(() => {});
    }
    notice = { kind: "info", text: "连接已恢复，可继续" };
    renderNotice();
  }, listen).catch(() => {});

  const controller: MakingConversationController = {
    setChain(chainId) {
      const changed = chainId !== makingChainId;
      makingChainId = chainId;
      // 制作对象真实变化且与当前会话绑定不一致时才复位；未绑定会话在制作对象保持
      // null（刷新 / 浏览链路）时保留，不丢草稿、不自动绑定。
      if (changed && currentId !== null) {
        const session = sessions.get(currentId);
        const bound = session?.record.chain_id ?? null;
        if (bound !== chainId) {
          currentId = null;
          historyOpen = false;
        }
      }
      if (currentId !== null && sessions.get(currentId) === undefined) currentId = null;
      // 只有制作对象真实变化才清提示：链路库 refresh（如启用/保存草稿后的重读）
      // 会带同一链路再次 setChain，不得抹掉「已保存草稿」等结果提示。
      if (changed) notice = null;
      renderPane();
      void refreshList();
    },
    onBrowseChain(chainId) {
      browseChainId = chainId;
      if (makingChainId !== null) return;
      void refreshList();
    },
    startNewSession,
    openConversation,
    refreshList,
    get currentConversationId(): string | null {
      return currentId;
    },
    setTrialLauncher(launcher) {
      trialLauncher = launcher;
      renderMessages();
    },
  };

  return controller;
}
