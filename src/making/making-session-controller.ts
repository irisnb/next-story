import { confirmDialog } from "../app-dialog.ts";
import type { MakingDom } from "../dom.ts";
import {
  chainSaveVersion,
  listenAiDriverLost,
  listenMakingMessage,
  makingCancelMessage,
  makingConversationDelete,
  makingConversationList,
  makingConversationLoad,
  makingConversationSave,
  makingEndSession,
  makingSendMessage,
  makingStartSession,
  type Chain,
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
  draftSlotTypeLabel,
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
  /** 读取链路（草稿确认文案与试问钩子需要链路名称快照）。 */
  readonly getChain: (chainId: string) => Chain | null;
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

  async function refreshList(): Promise<void> {
    const chainId = makingChainId ?? browseChainId;
    if (chainId === null) {
      list = [];
      listSkipped = [];
      listError = null;
      renderRecent();
      renderHistoryList();
      return;
    }
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
    if (makingChainId !== null || browseChainId === null) {
      container.classList.add("hidden");
      return;
    }
    container.classList.remove("hidden");
    const chain = getChain(browseChainId);
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
    heading.textContent = `「${chain?.name ?? "该链路"}」的制作会话`;
    container.append(heading);
    const [mostRecent, ...rest] = list;
    const continueBtn = document.createElement("button");
    continueBtn.type = "button";
    continueBtn.className = "making-action-btn primary making-recent-continue";
    continueBtn.textContent = `继续上次制作：${makingListTitle(mostRecent.title)}（${makingListUpdatedAtLabel(mostRecent.updated_at)}，${mostRecent.turn_count} 轮）`;
    continueBtn.addEventListener("click", () => {
      switchMakingObject(browseChainId);
      void openConversation(mostRecent.id);
    });
    container.append(continueBtn);
    if (rest.length > 0) {
      container.append(buildSessionList(rest, browseChainId));
    }
  }

  function recentLine(text: string): HTMLElement {
    const line = document.createElement("p");
    line.className = "making-recent-note";
    line.textContent = text;
    return line;
  }

  /** 会话列表（历史条目：点击打开＋独立删除动作）。 */
  function buildSessionList(entries: readonly MakingConversationSummary[], chainId: string): HTMLElement {
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
        if (makingChainId === null) switchMakingObject(chainId);
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
    if (makingChainId === null) {
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
      container.append(recentLine("这条链路还没有制作会话。"));
      return;
    }
    container.append(buildSessionList(list, makingChainId));
  }

  // ========== 转录渲染 ==========

  function renderPane(): void {
    if (makingChainId === null) {
      dom.conversationEmpty.classList.remove("hidden");
      dom.conversationActive.classList.add("hidden");
      renderRecent();
      updateInputState();
      return;
    }
    dom.conversationEmpty.classList.add("hidden");
    dom.conversationActive.classList.remove("hidden");
    const session = currentSession();
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
        const panel = buildDraftPanel(turn.text, record.chain_id, index);
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

  function buildDraftPanel(assistantText: string, chainId: string, turnIndex: number): HTMLElement | null {
    const drafts = parseCardDrafts(assistantText);
    if (drafts.length === 0) return null;
    const chain = getChain(chainId);
    const chainName = chain?.name ?? "该链路";
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
      typeBadge.textContent = draftSlotTypeLabel(draft.slotType);
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
    save.addEventListener("click", () => { void saveDrafts(drafts, chainId, chainName); });
    const trial = document.createElement("button");
    trial.type = "button";
    trial.className = "making-mini-btn";
    trial.textContent = "开始试问";
    if (trialLauncher !== null) {
      trial.addEventListener("click", () => trialLauncher!({ chainId, chainName, drafts }));
    } else {
      trial.disabled = true;
      trial.title = "试问功能随后接入";
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

  async function saveDrafts(drafts: readonly MakingCardDraft[], chainId: string, chainName: string): Promise<void> {
    const view = buildCardDraftPanelView(drafts, chainName);
    if (view === null) return;
    if (!await confirm(view.saveConfirm)) return;
    try {
      const version = await chainSaveVersion(chainId, drafts.map(draftToCardInput), "制作会话保存", call);
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

  // ========== 保存与发送 ==========

  async function saveSession(session: MakingSessionRuntime): Promise<void> {
    session.record.updated_at = nowIso();
    try {
      await makingConversationSave(session.record, call);
      session.saveError = null;
    } catch (error) {
      session.saveError = errorMessage(error);
    }
    renderNotice();
  }

  function newRuntime(record: MakingConversationRecord): MakingSessionRuntime {
    return {
      record,
      pendingMessageId: null,
      cancelledMessages: new Set(),
      started: false,
      turnError: null,
      saveError: null,
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
    } catch (error) {
      notice = { kind: "error", text: `打开制作会话失败：${errorMessage(error)}` };
      renderPane();
    }
  }

  function startNewSession(): void {
    if (makingChainId === null) return;
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
    dom.conversationInput.focus();
    // 新会话链路现状附言（add-posture-slot 任务 7.6）：建立新会话后自动经既有
    // 发送通道发出首条「链路现状」附言（最新版本全部卡的全文），让制作助手拿到
    // 既有卡的完整内容（「并存」草稿须完整重述）。取不到链路（getChain null）时
    // 不发（守则的诚实回退覆盖）、不报错；发送失败走正常失败轮如实呈现，不阻断
    // 会话。「继续上次制作」（openConversation）不经此路径，不重复附言。
    const chain = getChain(makingChainId);
    if (chain === null) return;
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
      if (chainId === null) {
        currentId = null;
        historyOpen = false;
      } else {
        const session = currentSession();
        if (session !== null && session.record.chain_id !== chainId) currentId = null;
        if (currentId !== null && sessions.get(currentId) === undefined) currentId = null;
      }
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
