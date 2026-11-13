/**
 * 应用内更新对话框（add-auto-updater design D3/D4/D6/D12）。
 *
 * 设计约束：
 * - 仅经用户主动操作（帮助入口点击或手动检查）打开；任何程序化路径
 *   （含启动检查发现新版）MUST NOT 自动弹出对话框或移动焦点；
 * - 状态机：检查中（仅手动入口、有限等待）／已是最新／失败／发现新版／
 *   下载中／已就绪（另有内部的「准备安装」锁定态）；
 * - 下载以「立即更新」确认为前提，安装时机以「现在重启安装」再次确认为前提；
 *   下载中关闭对话框＝转后台继续，下载完成不弹窗、只更新入口状态；
 * - 安装前走与正常退出相同的离开守卫（脏文档三选一，取消＝中止安装），
 *   守卫通过后的准备期阻止重复触发与产生新的未保存修改；
 * - Update 对象为模块内存单例，仅本次运行期间有效（design D12）：
 *   随进程销毁，不做任何持久化写入；
 * - 键盘语义（design D4，多状态对话框不照搬确认窗的全局 Enter 确认）：
 *   Enter 只激活当前聚焦按钮（原生按钮语义，本模块不注册任何全局 Enter
 *   映射，也不用 form[method=dialog] 提交结构）；Esc 经 dialog 的 cancel
 *   事件按状态映射（发现新版＝暂不、下载中＝转后台、已就绪＝稍后、
 *   检查中＝关闭——全部＝收起对话框且内存状态保留；准备期锁定无动作）；
 *   Tab 焦点圈闭由原生模态 dialog（showModal）提供；关闭后焦点归还触发元素；
 * - 插件 JS API 全部经依赖注入（check/download/apply/openUrl/stopDriver 可注替），
 *   单测不触真实 Tauri。
 */

/** 「打开下载页」兜底地址（与更新清单同源的 GitHub Releases 固定链接）。 */
export const UPDATE_DOWNLOAD_PAGE_URL = "https://github.com/irisnb/next-story/releases/latest";

/** 手动检查的有限等待（毫秒）：到期按失败呈现，迟到的真实结果作废。 */
export const UPDATE_CHECK_TIMEOUT_MS = 15_000;

/** 更新下载进度事件（与 @tauri-apps/plugin-updater 的 DownloadEvent 同形）。 */
export type DownloadProgressEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/** 与插件 `Update` 同形的结构契约（依赖注入用；只列本模块消费的成员）。 */
export interface UpdateHandle {
  readonly version: string;
  readonly currentVersion: string;
  /** 更新说明（latest.json 的 notes/body，可空）。 */
  readonly body?: string;
  readonly date?: string;
  download(onEvent?: (event: DownloadProgressEvent) => void): Promise<void>;
  install(options?: { restartAfterInstall?: boolean }): Promise<void>;
}

/** 对话框状态（「preparing」为安装准备锁定态，只在安装流程内出现）。 */
export type UpdateDialogStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "failed"
  | "available"
  | "downloading"
  | "ready"
  | "preparing";

/** 失败来源：检查失败（重试＝重新检查）或下载失败（重试＝重新下载）。 */
export type UpdateFailureKind = "check" | "download";

/** 帮助分区入口的联动快照（add-auto-updater 任务 4.3：入口状态可见）。 */
export interface UpdateEntrySnapshot {
  /** 「有新版」轻量标记：发现新版起持续显示，直到安装。 */
  badge: boolean;
  /** 入口状态文本（最近检查结果／检查中／下载中／已就绪；空串＝不显示）。 */
  statusText: string;
  /** 入口按钮身份：check＝「检查更新」，install＝「重启安装更新」（稍后再入）。 */
  entryAction: "check" | "install";
}

export interface UpdateDialogDependencies {
  /** 检查更新：返回 null＝无更新；抛错／超时＝失败。 */
  checkUpdates(): Promise<UpdateHandle | null>;
  /** 在系统浏览器打开下载页（兜底路径）。 */
  openDownloadPage(): void;
  /**
   * 与正常退出相同的离开守卫（design D6：复用 CloseCoordinator 的判定段）：
   * 存在脏文档时呈现同一三选一；false＝用户取消，必须中止安装且不退出。
   */
  runLeaveGuard(): Promise<boolean>;
  /**
   * 守卫通过后的安装准备：prepare 阻止产生新的未保存修改并排空保存
   * （失败须自行恢复正常操作并返回 false）；restore 在安装中止后恢复
   * 正常操作（准备失败或 install 抛错时由本模块调用）。
   */
  preparation: {
    prepare(): Promise<boolean>;
    restore(): void;
  };
  /**
   * 安装前显式停止 DSH sidecar（design D5 修正：插件 2.11.0 无插件级
   * on_before_exit 钩子，停止由前端在准备完成后、触发安装前显式执行）。
   * 抛错按准备失败处理：恢复现场、保留就绪状态、可重试。
   */
  stopDriver(): Promise<void>;
  /** 入口联动（每次状态变化回调；构造时不发初始快照，入口以 HTML 初始态为准）。 */
  onEntryState?(snapshot: UpdateEntrySnapshot): void;
  /** 诊断日志（console.error 一类；任何失败都不打断界面语义）。 */
  reportError?(error: unknown): void;
  /** 检查有限等待毫秒数，缺省 {@link UPDATE_CHECK_TIMEOUT_MS}。 */
  checkTimeoutMs?: number;
}

export interface UpdateDialogController {
  /** 打开对话框并立即执行一次检查（手动检查入口）。 */
  openManualCheck(): void;
  /** 帮助入口点击：有进行中流程时呈现现状，否则按手动检查打开。 */
  openEntry(): void;
  /**
   * 启动静默检查：失败与无更新完全静默；发现新版只经 onEntryState 设置
   * 入口标记，MUST NOT 弹窗、移动焦点或覆盖首启引导。
   */
  startupCheck(): Promise<void>;
  getStatus(): UpdateDialogStatus;
  /**
   * 释放内存单例与全部状态（进程销毁语义；无任何持久化写入）。
   * 生产路径不调用——进程退出即等效；供测试表达「状态不跨重启」。
   */
  dispose(): void;
}

/** 有限等待：超时以拒绝收场；底层 promise 的迟到结果由序号守卫作废。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("update-check-timeout")), ms);
    const settle = (finish: () => void): void => {
      clearTimeout(timer);
      finish();
    };
    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

export function createUpdateDialog(deps: UpdateDialogDependencies): UpdateDialogController {
  const timeoutMs = deps.checkTimeoutMs ?? UPDATE_CHECK_TIMEOUT_MS;
  let status: UpdateDialogStatus = "idle";
  let failureKind: UpdateFailureKind = "check";
  let installAbortNote: string | null = null;
  /** 内存单例（design D12）：仅本次运行期间有效，随进程销毁，不做任何持久化。 */
  let update: UpdateHandle | null = null;
  let dialog: HTMLDialogElement | null = null;
  let dialogOpen = false;
  let restoreTarget: HTMLElement | null = null;
  let downloadTotal: number | null = null;
  let downloadReceived = 0;
  /** 序号守卫：新一轮检查 / 下载或 dispose 后，作废迟到的回调。 */
  let checkSeq = 0;
  let downloadSeq = 0;
  let installInFlight = false;
  /** 下载态渲染出的进度节点引用（进度事件只更新文本与宽度，不整帧重渲染）。 */
  let progressText: HTMLElement | null = null;
  let progressTrack: HTMLElement | null = null;
  let progressFill: HTMLElement | null = null;

  function entrySnapshot(): UpdateEntrySnapshot {
    let badge = false;
    let statusText = "";
    let entryAction: "check" | "install" = "check";
    switch (status) {
      case "checking":
        statusText = "正在检查更新…";
        break;
      case "up-to-date":
        statusText = "已是最新版本";
        break;
      case "failed":
        // 手动检查失败文案固定（规格：不显示「已是最新」）；下载失败同样如实。
        statusText = failureKind === "check"
          ? "未能连接更新服务，当前版本仍可使用"
          : "下载未完成，可重试";
        badge = failureKind === "download";
        break;
      case "available":
        badge = true;
        statusText = `有新版本可用${update ? `（${update.version}）` : ""}`;
        break;
      case "downloading":
        badge = true;
        statusText = "正在下载更新…";
        break;
      case "preparing":
      case "ready":
        badge = true;
        statusText = "更新已就绪，可随时安装";
        entryAction = "install";
        break;
      case "idle":
        break;
    }
    return { badge, statusText, entryAction };
  }

  function setStatus(next: UpdateDialogStatus): void {
    status = next;
    deps.onEntryState?.(entrySnapshot());
    if (dialogOpen) {
      render();
      focusPrimary();
    }
  }

  function ensureDialog(): HTMLDialogElement {
    if (dialog?.isConnected) return dialog;
    const host = document.createElement("dialog");
    host.className = "app-confirm update-dialog";
    host.setAttribute("aria-label", "软件更新");
    // Esc 按状态映射（design D4）：发现新版＝暂不、下载中＝转后台、已就绪＝
    // 稍后、检查中＝关闭——全部＝收起对话框且内存状态保留（下载照常继续、
    // 就绪状态与入口「重启安装更新」保留）；安装准备期锁定，Esc 无动作。
    host.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (status === "preparing") return;
      closeDialog();
    });
    dialog = host;
    document.body.append(host);
    return host;
  }

  function makeButton(label: string, options: { primary?: boolean; onClick(): void }): HTMLButtonElement {
    const button = document.createElement("button");
    // 全部 type="button" 且对话框不含 form：Enter 没有任何全局提交语义，
    // 只会原生激活当前聚焦按钮（规格：Enter MUST NOT 全局映射到更新动作）。
    button.type = "button";
    button.className = options.primary ? "app-confirm-accept" : "app-confirm-cancel";
    button.textContent = label;
    button.addEventListener("click", options.onClick);
    return button;
  }

  function downloadPercent(): number | null {
    if (downloadTotal === null || downloadTotal <= 0) return null;
    return Math.min(100, Math.floor((downloadReceived / downloadTotal) * 100));
  }

  function progressTextValue(): string {
    const percent = downloadPercent();
    return percent === null ? "正在下载…" : `正在下载… ${percent}%`;
  }

  /** 进度事件回填：只更新既有节点（对话框转后台后不渲染、不弹窗、不动焦点）。 */
  function refreshProgress(): void {
    if (!dialogOpen || !progressText) return;
    progressText.textContent = progressTextValue();
    const percent = downloadPercent();
    if (percent === null || !progressTrack || !progressFill) return;
    progressTrack.classList.remove("hidden");
    progressFill.style.width = `${percent}%`;
  }

  /** 按当前状态重建对话框内容（无 HTML 拼接，一律 textContent）。 */
  function render(): void {
    const host = ensureDialog();
    const doc = host.ownerDocument;
    progressText = null;
    progressTrack = null;
    progressFill = null;

    const heading = doc.createElement("h3");
    heading.textContent = "软件更新";
    const body = doc.createElement("div");
    body.className = "update-dialog-body";
    const footer = doc.createElement("footer");
    const actions: HTMLButtonElement[] = [];

    const note = (text: string, className = "update-dialog-note"): void => {
      const p = doc.createElement("p");
      p.textContent = text;
      p.className = className;
      body.append(p);
    };

    switch (status) {
      case "checking":
        note("正在检查更新…");
        actions.push(makeButton("关闭", { onClick: closeDialog }));
        break;
      case "up-to-date":
        note("已是最新版本。");
        actions.push(makeButton("关闭", { onClick: closeDialog }));
        break;
      case "failed":
        note(failureKind === "check"
          ? "未能连接更新服务，当前版本仍可使用。"
          : "下载未完成，当前版本仍可使用。");
        actions.push(makeButton("打开下载页", { onClick: () => deps.openDownloadPage() }));
        actions.push(makeButton("重试", { primary: true, onClick: retryFromFailure }));
        break;
      case "available": {
        note(`发现新版本 ${update?.version ?? "未知版本"}。`);
        const notes = doc.createElement("div");
        notes.className = "update-notes";
        notes.setAttribute("aria-label", "更新说明");
        const text = update?.body?.trim();
        notes.textContent = text && text.length > 0 ? text : "本次更新没有填写说明。";
        body.append(notes);
        actions.push(makeButton("暂不", { onClick: closeDialog }));
        actions.push(makeButton("打开下载页", { onClick: () => deps.openDownloadPage() }));
        actions.push(makeButton("立即更新", { primary: true, onClick: startDownload }));
        break;
      }
      case "downloading": {
        progressText = doc.createElement("p");
        progressText.className = "update-dialog-note";
        progressText.textContent = progressTextValue();
        body.append(progressText);
        progressTrack = doc.createElement("div");
        progressTrack.className = `update-progress-track${downloadTotal === null ? " hidden" : ""}`;
        progressFill = doc.createElement("div");
        progressFill.className = "update-progress-fill";
        const percent = downloadPercent();
        progressFill.style.width = `${percent === null ? 0 : percent}%`;
        progressTrack.append(progressFill);
        body.append(progressTrack);
        // 关闭＝转后台继续：下载不中断、不弹窗，完成只更新入口状态。
        actions.push(makeButton("转后台继续", { onClick: closeDialog }));
        break;
      }
      case "ready":
        note(`新版本 ${update?.version ?? ""}已下载完成，可以安装。`);
        if (installAbortNote) note(installAbortNote, "update-dialog-hint");
        note("本次打开软件期间可随时安装；关闭软件后需重新下载。", "update-dialog-hint");
        actions.push(makeButton("稍后", { onClick: closeDialog }));
        actions.push(makeButton("现在重启安装", { primary: true, onClick: () => { void startInstall(); } }));
        break;
      case "preparing":
        // 准备期锁定：无按钮（阻止重复触发），Esc 无动作（cancel 监听内拦）。
        note("正在准备安装…");
        break;
      case "idle":
        note("正在检查更新…");
        actions.push(makeButton("关闭", { onClick: closeDialog }));
        break;
    }
    footer.append(...actions);
    host.replaceChildren(heading, body, footer);
  }

  function focusPrimary(): void {
    if (!dialog) return;
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("footer button")];
    const primary = buttons.find((button) => button.classList.contains("app-confirm-accept")) ?? buttons[0];
    try {
      primary?.focus();
    } catch {
      // 聚焦失败不影响状态呈现。
    }
  }

  function openDialog(): void {
    const host = ensureDialog();
    if (dialogOpen) {
      render();
      focusPrimary();
      return;
    }
    restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogOpen = true;
    render();
    host.showModal();
    focusPrimary();
  }

  function closeDialog(): void {
    if (!dialogOpen) return;
    dialogOpen = false;
    try {
      dialog?.close();
    } catch {
      // dialog 可能已被外部移除；关闭失败不影响状态收尾。
    }
    const target = restoreTarget;
    restoreTarget = null;
    if (target && target.isConnected) {
      try {
        target.focus();
      } catch {
        // 焦点归还失败不影响对话框语义。
      }
    }
  }

  async function runCheck(manual: boolean): Promise<void> {
    if (manual) {
      // 已有进行中的更新流程时不开新检查（openEntry/openManualCheck 已拦，双保险）。
      if (status === "downloading" || status === "preparing" || status === "ready") return;
      setStatus("checking");
    }
    const seq = ++checkSeq;
    // async 包一层：checkUpdates 同步抛错也走拒绝路径，不产生未处理异常。
    const invoke = async (): Promise<UpdateHandle | null> => deps.checkUpdates();
    const outcome = await withTimeout(invoke(), timeoutMs).then(
      (result) => ({ ok: true as const, result }),
      () => ({ ok: false as const }),
    );
    if (seq !== checkSeq) return;
    if (!outcome.ok) {
      if (manual) {
        failureKind = "check";
        setStatus("failed");
      }
      // 启动检查失败：完全静默（不弹窗、不写入口状态）。
      return;
    }
    if (outcome.result) {
      update = outcome.result;
      setStatus("available");
      return;
    }
    update = null;
    if (manual) setStatus("up-to-date");
    // 启动检查无更新：完全静默，不产生任何可见提示。
  }

  function startDownload(): void {
    if (!update || status === "downloading" || status === "preparing" || installInFlight) return;
    const seq = ++downloadSeq;
    const handle = update;
    downloadTotal = null;
    downloadReceived = 0;
    setStatus("downloading");
    handle.download((event) => {
      if (seq !== downloadSeq) return;
      if (event.event === "Started") {
        downloadTotal = event.data.contentLength ?? null;
        refreshProgress();
      } else if (event.event === "Progress") {
        downloadReceived += event.data.chunkLength;
        refreshProgress();
      }
    }).then(
      () => {
        if (seq !== downloadSeq) return;
        // 完成不自动重启：进入已就绪等待用户挑时机；对话框已关（转后台）时
        // 只更新入口状态（「重启安装更新」），不弹窗、不抢焦点。
        setStatus("ready");
      },
      (error) => {
        if (seq !== downloadSeq) return;
        deps.reportError?.(error);
        failureKind = "download";
        setStatus("failed");
      },
    );
  }

  function retryFromFailure(): void {
    if (status !== "failed") return;
    if (failureKind === "download" && update) startDownload();
    else void runCheck(true);
  }

  async function startInstall(): Promise<void> {
    if (!update || status !== "ready" || installInFlight) return;
    installInFlight = true;
    installAbortNote = null;
    setStatus("preparing");
    try {
      // 顺序固定（design D5 修正 / D6）：离开守卫（含保存）→ 前端准备 →
      // 显式停止 sidecar（stop_driver_for_update）→ 触发安装 → 进程退出、
      // NSIS 安装并自动重启。
      if (!(await deps.runLeaveGuard())) {
        // 用户取消＝中止安装：不退出应用，编辑内容与就绪状态保留。
        setStatus("ready");
        return;
      }
      let prepared = false;
      try {
        prepared = await deps.preparation.prepare();
      } finally {
        if (!prepared) deps.preparation.restore();
      }
      if (!prepared) {
        // 准备失败（如保存出错）：中止安装、恢复正常操作、保留就绪状态。
        installAbortNote = "安装准备未完成，可再次尝试。";
        setStatus("ready");
        return;
      }
      try {
        await deps.stopDriver();
      } catch (error) {
        // sidecar 停止失败＝准备未完成：恢复现场、保留就绪状态供再次尝试
        //（驱动随后按懒启动语义在下次 AI 请求自动重生，无损失）。
        deps.reportError?.(error);
        deps.preparation.restore();
        installAbortNote = "安装准备未完成，可再次尝试。";
        setStatus("ready");
        return;
      }
      try {
        // Windows：安装器接管后进程退出，本 promise 不会 resolve；
        // resolve / reject 都按「未完成安装」恢复现场，保留就绪状态供再次尝试。
        await update.install();
        deps.reportError?.(new Error("更新安装未退出应用（异常路径），已回到就绪状态"));
      } catch (error) {
        deps.reportError?.(error);
      }
      deps.preparation.restore();
      installAbortNote = "安装未能完成，可再次尝试。";
      setStatus("ready");
    } finally {
      installInFlight = false;
    }
  }

  function openManualCheck(): void {
    if (status === "downloading" || status === "preparing" || status === "ready") {
      openDialog();
      return;
    }
    openDialog();
    void runCheck(true);
  }

  function openEntry(): void {
    switch (status) {
      case "available":
      case "downloading":
      case "ready":
      case "preparing":
        openDialog();
        break;
      default:
        openManualCheck();
    }
  }

  return {
    openManualCheck,
    openEntry,
    async startupCheck(): Promise<void> {
      try {
        await runCheck(false);
      } catch (error) {
        // 诊断日志即可：启动检查的任何失败对界面完全静默。
        deps.reportError?.(error);
      }
    },
    getStatus(): UpdateDialogStatus {
      return status;
    },
    dispose(): void {
      checkSeq += 1;
      downloadSeq += 1;
      installInFlight = false;
      installAbortNote = null;
      failureKind = "check";
      update = null;
      closeDialog();
      try {
        dialog?.remove();
      } catch {
        // 移除失败不影响重置语义。
      }
      dialog = null;
      status = "idle";
      deps.onEntryState?.(entrySnapshot());
    },
  };
}
