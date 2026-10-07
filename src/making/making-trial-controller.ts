import {
  chainLibraryLoad,
  listenTrialAuthorization,
  listenTrialMessage,
  loadRecentWorks,
  openContentTree,
  trialAuthorizationRespond,
  trialCancelMessage,
  trialSendMessage,
  type ChainVersion,
  type InvokeFn,
  type ListenFn,
} from "../project-api.ts";
import { isDocumentAiVisible } from "../types.ts";
import type { MakingCardDraft } from "./making-conversation.ts";
import {
  findSavedVersionForDrafts,
  generateTrialId,
  trialRunKindLabel,
  trialRunStatusLabel,
  trialSendErrorNotice,
  type TrialRunStatus,
} from "./making-trial.ts";

/**
 * 试问运行区控制器（add-making-module-core 任务 6.3/6.5 前端，车道 F2b）。
 *
 * 职责与边界：
 * - 发起流：草稿面板「开始试问」经 `MakingTrialLauncher` 钩子进入。只对**已保存**
 *   的链路版本可用（草稿组与某版本逐字一致才绑定该版本试问）；未保存草稿点击时
 *   如实提示「先保存这版草稿」，不发起。
 * - 问题先过目：设置面板呈现所试链路·版本、试用作品（当前打开作品，固定）与
 *   关注文档选择（默认当前编辑文档，可换）；问题必填，点「开始试用」才发起。
 * - 运行状态可见：生成中（流式渲染 `trial-message-event` 增量）／等待补读授权
 *   （`trial-authorization-request` → reason＋[允许]/[本次不允许] →
 *   `trial_authorization_respond`）／失败（错误文案）／完成（回复全文只读）。
 * - 对照是显式动作：完成态提供 [跑不带卡对照]，同问题、同版本、`withCard=false`
 *   再发起一次，两份证据并列展示；默认不自动跑。
 * - 试问不切全局链路、不产生任何启用操作；[停止] 经 `trial_cancel_message`，
 *   已流式内容保留、迟到终态不覆盖已停止状态。
 * - 同一试问面板一次只承载一个试问会话；有轮次在途时新发起被如实劝阻。
 * - 本控制器不写任何作品数据；试用环境只经只读命令读取（树结构、最近作品）。
 */

/** 可选关注文档（按 AI 可见性过滤后的内容树文档）。 */
export interface MakingTrialDocumentOption {
  readonly id: string;
  readonly name: string;
}

/** 当前打开作品的解析结果（ok＝可试问；unavailable 附如实原因）。 */
export type MakingTrialWorkResolution =
  | { readonly status: "ok"; readonly workPath: string; readonly workTitle: string }
  | { readonly status: "unavailable"; readonly reason: string };

/** 试问的试用环境来源（当前打开作品／文档列表／默认关注文档）。 */
export interface MakingTrialWorkSource {
  /** 解析当前打开的作品；无作品（或无法确定）时返回 unavailable 与中文原因。 */
  resolve(): Promise<MakingTrialWorkResolution>;
  /** 列出可选关注文档（作品内容树文档，按 AI 可见性过滤；读取失败抛错）。 */
  listDocuments(workPath: string): Promise<readonly MakingTrialDocumentOption[]>;
  /** 默认关注文档（当前编辑中的文档；无法确定返回 null＝不指定）。 */
  defaultFocusDocumentId(documents: readonly MakingTrialDocumentOption[]): string | null;
}

export interface MakingTrialServices {
  /** 试问命令的 invoke 实现（测试注入；缺省用真实 Tauri invoke）。 */
  readonly call?: InvokeFn;
  /** 事件订阅（测试注入；缺省用真实 Tauri listen）。 */
  readonly listen?: ListenFn;
  /** 试用环境来源（测试注入；缺省用 DOM＋最近作品的默认解析）。 */
  readonly work?: MakingTrialWorkSource;
  /** 试问终态后的刷新回调（重读链路库，检视面板的试问记录随之更新）。 */
  readonly onSettled?: () => void;
}

/** 发起试问的请求（与 `MakingTrialLauncher` 钩子形状一致）。 */
export interface MakingTrialLaunchRequest {
  readonly chainId: string;
  readonly chainName: string;
  readonly drafts: readonly MakingCardDraft[];
}

interface TrialRun {
  readonly trialId: string;
  readonly withCard: boolean;
  readonly question: string;
  status: TrialRunStatus;
  replyText: string;
  /** 流式事件给出的消息 id（停止时回传后端；未收到增量前为 null）。 */
  messageId: string | null;
  /** 等待补读授权时的请求原因。 */
  authorizationReason: string | null;
  authorizationError: string | null;
  /** 失败错误文案（成功/取消为 null）。 */
  errorText: string | null;
  /** 用户已点停止：随后到达的终态一律忽略（已停止状态不被迟到结果覆盖）。 */
  stopRequested: boolean;
}

interface TrialSession {
  readonly chainId: string;
  readonly chainName: string;
  readonly versionId: string;
  readonly versionIndex: number;
  readonly workPath: string;
  readonly workTitle: string;
  readonly focusDocumentId: string | null;
  readonly focusDocumentLabel: string;
  readonly question: string;
  readonly runs: TrialRun[];
}

/** 通过设置面板发起前的待定上下文（库与作品环境已解析）。 */
interface PendingLaunch {
  readonly chainId: string;
  readonly chainName: string;
  readonly version: ChainVersion;
  readonly workPath: string;
  readonly workTitle: string;
  readonly documents: readonly MakingTrialDocumentOption[];
}

interface MakingTrialDom {
  readonly panel: HTMLElement;
  readonly form: HTMLElement;
  readonly meta: HTMLElement;
  readonly focusSelect: HTMLSelectElement;
  readonly questionInput: HTMLTextAreaElement;
  readonly guard: HTMLElement;
  readonly startBtn: HTMLButtonElement;
  readonly cancelBtn: HTMLButtonElement;
  readonly closeBtn: HTMLButtonElement;
  readonly runSection: HTMLElement;
  readonly runMeta: HTMLElement;
  readonly runList: HTMLElement;
}

function resolveTrialDom(): MakingTrialDom {
  const byId = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (element === null) throw new Error(`Missing required element: #${id}`);
    return element as T;
  };
  return {
    panel: byId("making-trial-panel"),
    form: byId("making-trial-form"),
    meta: byId("making-trial-meta"),
    focusSelect: byId<HTMLSelectElement>("making-trial-focus"),
    questionInput: byId<HTMLTextAreaElement>("making-trial-question"),
    guard: byId("making-trial-guard"),
    startBtn: byId<HTMLButtonElement>("making-trial-start"),
    cancelBtn: byId<HTMLButtonElement>("making-trial-cancel"),
    closeBtn: byId<HTMLButtonElement>("making-trial-close"),
    runSection: byId("making-trial-run"),
    runMeta: byId("making-trial-run-meta"),
    runList: byId("making-trial-runs"),
  };
}

export function setupMakingTrial(services: MakingTrialServices = {}): { launch: (request: MakingTrialLaunchRequest) => void } {
  const call = services.call;
  const work = services.work ?? createDefaultTrialWorkSource(call);
  const dom = resolveTrialDom();
  let session: TrialSession | null = null;
  let pending: PendingLaunch | null = null;

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function runInFlight(run: TrialRun): boolean {
    return run.status === "pending" || run.status === "waiting";
  }

  function sessionBusy(): boolean {
    return session !== null && session.runs.some(runInFlight);
  }

  // ========== 提示与面板显隐 ==========

  function showGuard(text: string): void {
    dom.panel.classList.remove("hidden");
    dom.guard.classList.remove("hidden");
    dom.guard.textContent = text;
    dom.form.classList.add("hidden");
  }

  function clearGuard(): void {
    dom.guard.classList.add("hidden");
    dom.guard.textContent = "";
  }

  function closePanel(): void {
    dom.panel.classList.add("hidden");
  }

  // ========== 发起流（launcher 钩子入口） ==========

  function launch(request: MakingTrialLaunchRequest): void {
    if (sessionBusy()) {
      showGuard("当前试问还在进行，等它完成或停止后再开始新的试问。");
      return;
    }
    dom.runSection.classList.add("hidden");
    void (async () => {
      // 1) 链路与已保存版本：草稿组必须与某版本逐字一致（试问只绑定已保存版本）。
      let library;
      try {
        library = await chainLibraryLoad(call);
      } catch (error) {
        showGuard(`读取链路库失败：${errorMessage(error)}`);
        return;
      }
      const chain = library.chains.find((candidate) => candidate.id === request.chainId) ?? null;
      if (chain === null) {
        showGuard("这条链路已不存在，无法试问；请刷新链路库后再试。");
        return;
      }
      const version = findSavedVersionForDrafts(chain, request.drafts);
      if (version === null) {
        showGuard("这版草稿还没有保存。先在草稿面板点「保存这版草稿」，保存后再开始试问。");
        return;
      }
      // 2) 试用环境：当前打开作品（work_path 固定为该作品）＋关注文档候选。
      const resolved = await work.resolve();
      if (resolved.status === "unavailable") {
        showGuard(resolved.reason);
        return;
      }
      let documents: readonly MakingTrialDocumentOption[];
      try {
        documents = await work.listDocuments(resolved.workPath);
      } catch (error) {
        showGuard(`读取作品文档列表失败：${errorMessage(error)}`);
        return;
      }
      // 3) 设置面板（问题先过目）：预填环境与默认关注文档，问题留空必填。
      pending = {
        chainId: chain.id,
        chainName: chain.name,
        version,
        workPath: resolved.workPath,
        workTitle: resolved.workTitle,
        documents,
      };
      clearGuard();
      dom.panel.classList.remove("hidden");
      dom.meta.textContent =
        `所试版本：「${chain.name}」·第${version.index}版（带卡试问）｜试用作品：${resolved.workTitle}`;
      fillFocusOptions(documents, work.defaultFocusDocumentId(documents));
      dom.questionInput.value = "";
      updateStartState();
      dom.form.classList.remove("hidden");
      dom.questionInput.focus();
    })();
  }

  function fillFocusOptions(documents: readonly MakingTrialDocumentOption[], defaultId: string | null): void {
    dom.focusSelect.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "（不指定关注文档）";
    dom.focusSelect.append(none);
    for (const doc of documents) {
      const option = document.createElement("option");
      option.value = doc.id;
      option.textContent = doc.name;
      dom.focusSelect.append(option);
    }
    dom.focusSelect.value = defaultId !== null && documents.some((doc) => doc.id === defaultId)
      ? defaultId
      : "";
  }

  function updateStartState(): void {
    const question = dom.questionInput.value.trim();
    dom.startBtn.disabled = question.length === 0 || pending === null;
  }

  dom.questionInput.addEventListener("input", updateStartState);

  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void startTrial();
  });

  function cancelSetup(): void {
    dom.form.classList.add("hidden");
    clearGuard();
    closePanel();
    pending = null;
  }

  async function startTrial(): Promise<void> {
    const context = pending;
    const question = dom.questionInput.value.trim();
    if (context === null || question.length === 0) return;
    const focusId = dom.focusSelect.value.length > 0 ? dom.focusSelect.value : null;
    const focusLabel = focusId !== null
      ? context.documents.find((doc) => doc.id === focusId)?.name ?? focusId
      : "（不指定）";
    const newSession: TrialSession = {
      chainId: context.chainId,
      chainName: context.chainName,
      versionId: context.version.id,
      versionIndex: context.version.index,
      workPath: context.workPath,
      workTitle: context.workTitle,
      focusDocumentId: focusId,
      focusDocumentLabel: focusLabel,
      question,
      runs: [],
    };
    session = newSession;
    pending = null;
    dom.form.classList.add("hidden");
    clearGuard();
    dom.panel.classList.remove("hidden");
    dom.runMeta.textContent =
      `所试：「${newSession.chainName}」·第${newSession.versionIndex}版｜` +
      `试用作品：${newSession.workTitle}｜关注文档：${focusLabel}`;
    dom.runSection.classList.remove("hidden");
    renderRuns();
    void sendRun(newSession, newRun(newSession.question, true));
  }

  function newRun(question: string, withCard: boolean): TrialRun {
    return {
      trialId: generateTrialId(),
      withCard,
      question,
      status: "pending",
      replyText: "",
      messageId: null,
      authorizationReason: null,
      authorizationError: null,
      errorText: null,
      stopRequested: false,
    };
  }

  // ========== 发送与终态 ==========

  async function sendRun(context: TrialSession, run: TrialRun): Promise<void> {
    context.runs.push(run);
    renderRuns();
    try {
      const result = await trialSendMessage(
        run.trialId,
        context.chainId,
        context.versionId,
        run.withCard,
        run.question,
        context.focusDocumentId,
        context.workPath,
        call,
      );
      // 用户已停止：迟到终态一律忽略，不覆盖已停止状态（对齐制作会话口径）。
      if (run.stopRequested) return;
      if (result.ok) {
        run.status = "success";
        run.replyText = result.content;
      } else {
        run.status = "failed";
        run.errorText = trialSendErrorNotice(result.error.code, result.error.message);
      }
    } catch (error) {
      if (run.stopRequested) return;
      run.status = "failed";
      run.errorText = errorMessage(error);
    }
    renderRuns();
    services.onSettled?.();
  }

  function stopRun(run: TrialRun): void {
    if (!runInFlight(run)) return;
    run.status = "cancelled";
    run.stopRequested = true;
    renderRuns();
    void trialCancelMessage(run.trialId, run.messageId ?? "trial-msg", call).catch(() => {});
    services.onSettled?.();
  }

  async function respondAuthorization(run: TrialRun, grant: boolean): Promise<void> {
    if (run.status !== "waiting") return;
    run.authorizationError = null;
    renderRuns();
    try {
      await trialAuthorizationRespond(run.trialId, grant, call);
      if (run.status === "waiting") {
        run.status = "pending";
        run.authorizationReason = null;
        renderRuns();
      }
    } catch (error) {
      if (run.status === "waiting") {
        run.authorizationError = `授权应答失败：${errorMessage(error)}`;
        renderRuns();
      }
    }
  }

  /** 对照是显式动作：同问题、同版本、不带卡再发起一次（并列展示）。 */
  function runComparison(): void {
    const context = session;
    if (context === null || sessionBusy()) return;
    const withCardRun = context.runs.find((run) => run.withCard);
    if (withCardRun === undefined || withCardRun.status !== "success") return;
    if (context.runs.some((run) => !run.withCard)) return;
    void sendRun(context, newRun(context.question, false));
  }

  // ========== 渲染 ==========

  function renderRuns(): void {
    const context = session;
    dom.runList.replaceChildren();
    if (context === null) {
      dom.runSection.classList.add("hidden");
      return;
    }
    dom.runSection.classList.remove("hidden");
    for (const run of context.runs) {
      dom.runList.append(runBlockElement(context, run));
    }
  }

  function runBlockElement(context: TrialSession, run: TrialRun): HTMLElement {
    const block = document.createElement("div");
    block.className = "making-trial-block";
    block.dataset.trialId = run.trialId;

    const head = document.createElement("div");
    head.className = "making-trial-block-head";
    const kind = document.createElement("span");
    kind.className = "making-trial-block-kind";
    kind.textContent = trialRunKindLabel(run.withCard);
    const status = document.createElement("span");
    status.className = `making-trial-block-status${statusClass(run.status)}`;
    status.textContent = run.status === "failed" && run.errorText !== null
      ? `${trialRunStatusLabel(run.status)}：${run.errorText}`
      : trialRunStatusLabel(run.status);
    head.append(kind, status);
    if (runInFlight(run)) {
      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "making-mini-btn";
      stop.textContent = "停止";
      stop.addEventListener("click", () => { stopRun(run); });
      head.append(stop);
    }
    block.append(head);

    if (run.status === "waiting") {
      block.append(authorizationCard(run));
    }

    const question = document.createElement("p");
    question.className = "making-trial-q";
    question.textContent = `问题：${run.question}`;
    block.append(question);

    const reply = document.createElement("pre");
    reply.className = "making-trial-reply";
    reply.textContent = run.replyText.length > 0
      ? run.replyText
      : run.status === "pending" || run.status === "waiting"
        ? "正在等待回复…"
        : run.status === "failed"
          ? "（本次未收到回复）"
          : "（已停止，以上为已生成内容）";
    block.append(reply);

    // 对照入口：仅带卡轮成功且无轮次在途时提供（显式动作，默认不自动跑）。
    if (run.withCard && run.status === "success" && !sessionBusy() && !context.runs.some((r) => !r.withCard)) {
      const actions = document.createElement("div");
      actions.className = "making-trial-block-actions";
      const compare = document.createElement("button");
      compare.type = "button";
      compare.className = "making-mini-btn";
      compare.textContent = "跑不带卡对照（同一问题）";
      compare.addEventListener("click", runComparison);
      actions.append(compare);
      const hint = document.createElement("span");
      hint.className = "making-trial-record-note";
      hint.textContent = "对照不自动运行；两份结果并列保存为试问证据。";
      actions.append(hint);
      block.append(actions);
    }
    return block;
  }

  function authorizationCard(run: TrialRun): HTMLElement {
    const card = document.createElement("div");
    card.className = "making-trial-auth";
    const title = document.createElement("p");
    title.className = "making-trial-auth-title";
    title.textContent = "AI 希望围绕这个问题补充阅读你的作品文档";
    const reason = document.createElement("p");
    reason.className = "making-trial-auth-reason";
    reason.textContent = run.authorizationReason ?? "";
    const actions = document.createElement("div");
    actions.className = "making-trial-auth-actions";
    const allow = document.createElement("button");
    allow.type = "button";
    allow.className = "making-mini-btn primary";
    allow.textContent = "允许";
    allow.addEventListener("click", () => { void respondAuthorization(run, true); });
    const deny = document.createElement("button");
    deny.type = "button";
    deny.className = "making-mini-btn";
    deny.textContent = "本次不允许";
    deny.addEventListener("click", () => { void respondAuthorization(run, false); });
    actions.append(allow, deny);
    card.append(title, reason, actions);
    if (run.authorizationError !== null) {
      const errorLine = document.createElement("p");
      errorLine.className = "making-trial-record-error";
      errorLine.textContent = run.authorizationError;
      card.append(errorLine);
    }
    return card;
  }

  function statusClass(status: TrialRunStatus): string {
    switch (status) {
      case "pending":
        return " is-pending";
      case "waiting":
        return " is-waiting";
      case "failed":
        return " is-error";
      default:
        return "";
    }
  }

  /** 流式增量：只更新对应试问块的回复节点（不重建整个运行区）。 */
  function appendStreamText(payload: { trial_id: string; message_id: string; text: string }): void {
    const run = session?.runs.find((candidate) => candidate.trialId === payload.trial_id);
    if (run === undefined || !runInFlight(run)) return;
    if (run.messageId === null) run.messageId = payload.message_id;
    run.replyText += payload.text;
    const reply = dom.runList.querySelector<HTMLPreElement>(
      `[data-trial-id="${run.trialId}"] > .making-trial-reply`,
    );
    if (reply === null) {
      renderRuns();
      return;
    }
    reply.textContent = run.replyText;
  }

  // ========== 事件接线 ==========

  dom.closeBtn.addEventListener("click", closePanel);
  dom.cancelBtn.addEventListener("click", cancelSetup);

  // 流式增量：按试问编号路由（未知/迟到试问的增量不转发，不污染其他状态）。
  listenTrialMessage((payload) => { appendStreamText(payload); }, services.listen).catch(() => {});

  // 按需补读授权：等待用户决定期间轮次挂起（豁免停滞时限）；应答后回到生成中。
  listenTrialAuthorization((payload) => {
    const run = session?.runs.find((candidate) => candidate.trialId === payload.trial_id);
    if (run === undefined || run.status !== "pending") return;
    run.status = "waiting";
    run.authorizationReason = payload.reason;
    renderRuns();
  }, services.listen).catch(() => {});

  return { launch };
}

// ========== 默认试用环境来源（DOM＋最近作品的自证解析） ==========

/**
 * 默认试用环境来源：制作页无法直接读取编辑器闭包状态（main 装配层持有），此处以
 * 页面事实自证——「当前作品名」来自 `#current-project-name`，作品路径取最近作品
 * 首条且**名称必须与页面一致**（打开作品时后端必记录最近作品，首条即当前打开的
 * 作品；名称不符视为无法确定，如实降级为不可试问，绝不猜路径）。
 */
export function createDefaultTrialWorkSource(call?: InvokeFn): MakingTrialWorkSource {
  const projectTitle = (): string =>
    (document.getElementById("current-project-name")?.textContent ?? "").trim();
  return {
    async resolve() {
      const title = projectTitle();
      if (title.length === 0) {
        return {
          status: "unavailable",
          reason: "还没有打开的作品。试问要以一个真实作品为试用环境，请先打开或新建一个作品。",
        };
      }
      try {
        const works = await loadRecentWorks(call);
        const top = works[0];
        if (top !== undefined && top.name === title) {
          return { status: "ok", workPath: top.path, workTitle: top.name };
        }
      } catch {
        // 读取失败如实降级，不猜测路径。
      }
      return {
        status: "unavailable",
        reason: "暂时无法确定当前打开的作品，请稍后再试，或重新打开这个作品后再试问。",
      };
    },
    async listDocuments(workPath) {
      const tree = await openContentTree(workPath, call);
      const documents: MakingTrialDocumentOption[] = [];
      const walk = (ids: readonly string[]): void => {
        for (const id of ids) {
          const node = tree.nodes[id];
          if (node === undefined) continue;
          if (node.kind === "Document") {
            if (isDocumentAiVisible(node)) documents.push({ id, name: node.name });
          } else {
            walk(node.children);
          }
        }
      };
      walk(tree.root_children);
      return documents;
    },
    defaultFocusDocumentId(documents) {
      const name = (document.getElementById("current-document-name")?.textContent ?? "").trim();
      if (name.length === 0) return null;
      return documents.find((doc) => doc.name === name)?.id ?? null;
    },
  };
}
