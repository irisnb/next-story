// 设置页「软件更新」分区（standalone-update-drawer；原帮助分区内更新入口迁出独立抽屉）：
// 更新入口装配。本文件只管入口呈现与点击接线，文本一律 textContent 赋值，不拼 HTML。

import type { UpdateSectionDom } from "./dom.ts";

/** 「软件更新」分区入口的受控视图（add-auto-updater 任务 4.3；由更新对话框控制器驱动）。 */
export interface UpdateEntry {
  /** 渲染当前版本号（来自版本号单一真相源）；null／空＝「当前版本未知」。 */
  renderVersion(version: string | null): void;
  /** 应用入口联动快照：标记、状态文本与入口按钮身份（检查更新／重启安装更新）。 */
  setUpdateView(snapshot: { badge: boolean; statusText: string; entryAction: "check" | "install" }): void;
}

/**
 * 装配「软件更新」分区的更新入口：「检查更新」点击交回调（打开更新对话框），
 * 版本号、状态文本与「有新版」标记经返回的受控视图由 update-dialog 驱动。
 * 文本一律 textContent 赋值，不拼 HTML。
 */
export function setupUpdateEntry(
  dom: Pick<UpdateSectionDom, "checkUpdateBtn" | "updateStatus" | "versionText" | "updateBadge">,
  handlers: { openUpdate(): void },
): UpdateEntry {
  dom.checkUpdateBtn.addEventListener("click", () => {
    handlers.openUpdate();
  });
  return {
    renderVersion(version): void {
      const text = version?.trim();
      dom.versionText.textContent = text && text.length > 0 ? `当前版本 ${text}` : "当前版本未知";
    },
    setUpdateView(snapshot): void {
      dom.updateBadge.classList.toggle("hidden", !snapshot.badge);
      const text = snapshot.statusText.trim();
      dom.updateStatus.textContent = text;
      dom.updateStatus.classList.toggle("hidden", text.length === 0);
      dom.checkUpdateBtn.textContent = snapshot.entryAction === "install" ? "重启安装更新" : "检查更新";
    },
  };
}
