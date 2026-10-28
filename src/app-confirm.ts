/**
 * 全软件统一的应用内确认窗（fix-ui-friction-2026-10 · in-app-confirmation）。
 *
 * 设计约束（design D4 / 用户拍板）：
 * - 基于原生 `<dialog>`，视觉沿用 `.making-save-confirm` 的语言但用独立类名；
 * - 常规变体确认按钮用主色、危险变体用危险色；取消与确认按钮几何完全一致
 *   （128×40、内边距 8px 16px），仅颜色角色不同；
 * - 键盘可达：Enter 确认（form method="dialog"＋确认按钮 autofocus）、Esc 取消
 *   （dialog 的 cancel 事件）；打开时焦点在确认按钮，关闭后焦点返回触发元素；
 * - 取消、关闭与任何异常一律 resolve false：失败不得当作已确认；
 * - 每次调用独立实例，不依赖 window.confirm / 原生插件，纯 DOM。
 */

export interface ConfirmInAppOptions {
  /** 标题，如：启用「情节探索·第4版」？ */
  title: string;
  /** 影响说明，可含换行（原样 pre-wrap 呈现）。 */
  body: string;
  /** 确认按钮文案，如：启用 / 删除链路 / 停用当前链路。 */
  confirmLabel: string;
  /** 危险变体：确认按钮用危险色。 */
  danger?: boolean;
}

export function confirmInApp(options: ConfirmInAppOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let dialog: HTMLDialogElement | null = null;
    /** 打开前的焦点元素；关闭后若仍连着文档则归还焦点。 */
    let restoreTarget: HTMLElement | null = null;

    const finish = (accepted: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        dialog?.close();
      } catch {
        // close 失败不阻断收尾；dialog 可能已被外部移除。
      }
      dialog?.remove();
      if (restoreTarget instanceof HTMLElement && restoreTarget.isConnected) {
        try {
          restoreTarget.focus();
        } catch {
          // 焦点归还失败不影响确认结果。
        }
      }
      resolve(accepted);
    };

    try {
      restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog = document.createElement("dialog");
      if (typeof dialog.showModal !== "function") throw new Error("dialog unavailable");
      dialog.className = options.danger ? "app-confirm app-confirm-danger" : "app-confirm";

      // form method="dialog"：真实浏览器里 Enter 走表单对话提交语义（确认按钮为唯一提交器）。
      const form = document.createElement("form");
      form.setAttribute("method", "dialog");

      const heading = document.createElement("h3");
      heading.textContent = options.title;
      const body = document.createElement("p");
      body.textContent = options.body;

      const actions = document.createElement("footer");
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "app-confirm-cancel";
      cancel.textContent = "取消";
      cancel.addEventListener("click", (event) => {
        event.preventDefault();
        finish(false);
      });
      const accept = document.createElement("button");
      accept.type = "submit";
      accept.className = "app-confirm-accept";
      accept.setAttribute("autofocus", "");
      accept.textContent = options.confirmLabel;
      accept.addEventListener("click", (event) => {
        event.preventDefault();
        finish(true);
      });
      actions.append(cancel, accept);

      form.append(heading, body, actions);
      dialog.append(form);

      // Esc：dialog 的 cancel 事件；拦截默认关闭，统一经 finish 收尾。
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
      });
      // 兜底：任何未经确认按钮的关闭路径（外部 close 等）一律视为未确认。
      dialog.addEventListener("close", () => finish(false));
      // Enter：与原生按钮语义一致——焦点在取消按钮上则取消，其余一律确认。
      dialog.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        finish(event.target !== cancel);
      });

      document.body.append(dialog);
      dialog.showModal();
      // 真实浏览器由 autofocus 聚焦；显式调用保证任何环境打开时焦点都在确认按钮。
      accept.focus();
    } catch {
      // 任何异常（dialog 不可用、DOM 操作失败）一律视为未确认。
      finish(false);
    }
  });
}
