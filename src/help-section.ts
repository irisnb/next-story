// 设置页「帮助」分区（first-run-guide-and-help）：FAQ 渲染与「重看软件引导」接线。
// 文案数据集中在 help-faq-items.ts；本文件只管行为，文本一律 textContent 赋值，不拼 HTML。

import type { HelpSectionDom } from "./dom.ts";
import { HELP_FAQ_ITEMS, type HelpFaqItem } from "./help-faq-items.ts";

/** 把 FAQ 条目渲染为可折叠的 <details> 列表（先清空后重建，幂等可重复调用）。 */
export function renderHelpFaqItems(
  container: HTMLElement,
  items: readonly HelpFaqItem[],
): void {
  const doc = container.ownerDocument;
  const nodes = items.map((item) => {
    const details = doc.createElement("details");
    details.classList.add("help-faq-item");
    const summary = doc.createElement("summary");
    summary.textContent = item.question;
    const answer = doc.createElement("div");
    answer.classList.add("help-faq-answer");
    answer.textContent = item.answer;
    details.append(summary, answer);
    if (item.links && item.links.length > 0) {
      const list = doc.createElement("div");
      list.classList.add("help-faq-links");
      for (const link of item.links) {
        const anchor = doc.createElement("a");
        anchor.classList.add("help-faq-link");
        anchor.href = link.url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = link.label;
        list.append(anchor);
      }
      details.append(list);
    }
    return details;
  });
  container.replaceChildren(...nodes);
}

/** 装配帮助分区：渲染十一条 FAQ；「重看软件引导」调用首启同一向导组件（不写标记）。 */
export function setupHelpSection(
  dom: Pick<HelpSectionDom, "replayBtn" | "faqList">,
  handlers: { openReplayGuide(): void },
  items: readonly HelpFaqItem[] = HELP_FAQ_ITEMS,
): void {
  renderHelpFaqItems(dom.faqList, items);
  dom.replayBtn.addEventListener("click", () => {
    handlers.openReplayGuide();
  });
}

/** 帮助分区更新入口的受控视图（add-auto-updater 任务 4.3；由更新对话框控制器驱动）。 */
export interface HelpUpdateEntry {
  /** 渲染当前版本号（来自版本号单一真相源）；null／空＝「当前版本未知」。 */
  renderVersion(version: string | null): void;
  /** 应用入口联动快照：标记、状态文本与入口按钮身份（检查更新／重启安装更新）。 */
  setUpdateView(snapshot: { badge: boolean; statusText: string; entryAction: "check" | "install" }): void;
}

/**
 * 装配帮助分区的更新入口：「检查更新」点击交回调（打开更新对话框），
 * 版本号、状态文本与「有新版」标记经返回的受控视图由 update-dialog 驱动。
 * 文本一律 textContent 赋值，不拼 HTML。
 */
export function setupHelpUpdateEntry(
  dom: Pick<HelpSectionDom, "checkUpdateBtn" | "updateStatus" | "versionText" | "updateBadge">,
  handlers: { openUpdate(): void },
): HelpUpdateEntry {
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
