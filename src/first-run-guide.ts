// 首启引导控制器（first-run-guide-and-help）：四卡步进渲染、跳过/Esc 视同跳过、
// 完成标记经 resolveLocalStorage() 容错写入。逻辑与 DOM 分离：标记纯函数与步进
// 状态机无 DOM 依赖，可单测。引导只弹一次；「设置 → 帮助」重看永不写标记。

import type { FirstRunGuideDom } from "./dom.ts";
import { FIRST_RUN_GUIDE_STEPS, type FirstRunGuideStep } from "./first-run-guide-steps.ts";
import { resolveLocalStorage, type StorageLike } from "./shared-storage-and-selection-identity.ts";

/** 完成标记存储键（与显示偏好同机制同 next-story. 前缀；清缓存后重弹属预期无害行为）。 */
export const FIRST_RUN_GUIDE_STORAGE_KEY = "next-story.onboarding-completed";

/** 引导是否已完成：存在键且值非空即完成。 */
export function isFirstRunGuideCompleted(storage: StorageLike): boolean {
  const value = storage.getItem(FIRST_RUN_GUIDE_STORAGE_KEY);
  return value !== null && value.length > 0;
}

/** 写入完成标记（固定非空值）。 */
export function markFirstRunGuideCompleted(storage: StorageLike): void {
  storage.setItem(FIRST_RUN_GUIDE_STORAGE_KEY, "1");
}

/** 四卡步进的最小状态机（纯逻辑，无 DOM）。 */
export interface GuideStepMachine {
  /** 当前卡索引（0 起）。 */
  readonly index: number;
  /** 是否可后退（非首卡）。 */
  readonly canPrev: boolean;
  /** 是否已是末卡。 */
  readonly isLast: boolean;
  /** 前进一步；已在末卡时无操作。 */
  next(): void;
  /** 后退一步；已在首卡时无操作。 */
  prev(): void;
  /** 回到第一张（同一向导 close 后再次 open 时复用同一机器）。 */
  reset(): void;
}

export function createGuideStepMachine(stepCount: number): GuideStepMachine {
  let index = 0;
  return {
    get index(): number {
      return index;
    },
    get canPrev(): boolean {
      return index > 0;
    },
    get isLast(): boolean {
      return index === stepCount - 1;
    },
    next(): void {
      if (index < stepCount - 1) index += 1;
    },
    prev(): void {
      if (index > 0) index -= 1;
    },
    reset(): void {
      index = 0;
    },
  };
}

/** 向导打开模式：first-run 完成时写标记；replay（设置 → 帮助重看）永不写。 */
export type FirstRunGuideOpenMode = "first-run" | "replay";

export interface FirstRunGuideController {
  open(mode: FirstRunGuideOpenMode): void;
}

const NEXT_STEP_LABEL = "下一张";
const LAST_STEP_LABEL = "开始使用";
const DOT_CLASS = "first-run-guide-dot";
const DOT_ACTIVE_CLASS = "active";

export function setupFirstRunGuide(
  dom: FirstRunGuideDom,
  steps: readonly FirstRunGuideStep[] = FIRST_RUN_GUIDE_STEPS,
): FirstRunGuideController {
  const machine = createGuideStepMachine(steps.length);
  const doc = dom.body.ownerDocument;
  let mode: FirstRunGuideOpenMode = "first-run";

  function render(): void {
    const step = steps[machine.index];
    if (!step) return;
    dom.title.textContent = step.title;
    dom.body.replaceChildren(
      ...step.paragraphs.map((paragraph) => {
        const p = doc.createElement("p");
        p.textContent = paragraph;
        return p;
      }),
    );
    dom.dots.replaceChildren(
      ...steps.map((_step, i) => {
        const dot = doc.createElement("span");
        dot.classList.add(DOT_CLASS);
        if (i === machine.index) dot.classList.add(DOT_ACTIVE_CLASS);
        return dot;
      }),
    );
    dom.prev.disabled = !machine.canPrev;
    dom.next.textContent = machine.isLast ? LAST_STEP_LABEL : NEXT_STEP_LABEL;
  }

  /** 关闭向导；first-run 模式同时写完成标记（跳过 / 末卡「开始使用」/ Esc 同路径）。 */
  function finish(): void {
    if (mode === "first-run") {
      const storage = resolveLocalStorage();
      // 存储不可用（resolveLocalStorage 为 null）时跳过写入，不报错。
      if (storage !== null) markFirstRunGuideCompleted(storage);
    }
    if (dom.dialog.open) dom.dialog.close();
  }

  dom.skip.addEventListener("click", finish);
  dom.next.addEventListener("click", () => {
    if (machine.isLast) {
      finish();
      return;
    }
    machine.next();
    render();
  });
  dom.prev.addEventListener("click", () => {
    if (!machine.canPrev) return;
    machine.prev();
    render();
  });
  // Esc 触发原生 dialog 的 cancel 事件：阻止默认后按「跳过」路径处理并写标记。
  dom.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });

  return {
    open(nextMode: FirstRunGuideOpenMode): void {
      // first-run：已有完成标记时不弹（供 main.ts 启动无条件调用）；replay：无条件打开。
      if (nextMode === "first-run") {
        const storage = resolveLocalStorage();
        if (storage !== null && isFirstRunGuideCompleted(storage)) return;
      }
      mode = nextMode;
      machine.reset();
      render();
      dom.dialog.showModal();
    },
  };
}
