// 查找替换：查找栏的打开/关闭、命中计数、前后导航与替换动作。
// 只依赖查找栏 DOM 节点与编辑器窄能力（setFind/activateMatch/replaceCurrent/replaceAll/focus），
// 不依赖完整编辑器控制器；本地状态（是否打开、命中数、当前索引）由本模块持有。

import type { AppDom } from "./dom.ts";

/** 查找替换模块所需的编辑器窄能力。 */
export interface FindEditorCapabilities {
  setFind(query: string, caseSensitive: boolean): number;
  activateMatch(index: number): void;
  replaceCurrent(replacement: string): boolean;
  replaceAll(replacement: string): number;
  focus(): void;
}

export interface EditorFindDeps {
  dom: Pick<
    AppDom,
    | "findBar"
    | "findInput"
    | "findCaseSensitive"
    | "findCount"
    | "btnFindPrev"
    | "btnFindNext"
    | "btnReplace"
    | "btnReplaceAll"
    | "btnFindClose"
    | "replaceInput"
  >;
  /** 返回当前编辑器窄能力；无编辑器时为 null。 */
  getEditor(): FindEditorCapabilities | null;
}

export interface EditorFind {
  openFindBar(focusTarget: "find" | "replace"): void;
  closeFindBar(): void;
  /** 文档编辑后刷新命中；仅当查找栏打开且有关键词时重新查找。 */
  refreshFindAfterEdit(): void;
  /** 移除全部监听并复位查找栏状态。 */
  dispose(): void;
}

export function createEditorFind(deps: EditorFindDeps): EditorFind {
  const { dom } = deps;
  let findBarOpen = false;
  let findCount = 0;
  let findIndex = -1;

  function renderFindCount(): void {
    const hasQuery = dom.findInput.value !== "";
    dom.findCount.textContent = hasQuery ? `${findCount === 0 ? 0 : findIndex + 1} / ${findCount}` : "";
    dom.btnFindPrev.disabled = findCount === 0;
    dom.btnFindNext.disabled = findCount === 0;
    dom.btnReplace.disabled = findCount === 0;
    dom.btnReplaceAll.disabled = findCount === 0;
  }

  function runFind(): void {
    const current = deps.getEditor();
    if (!current) return;
    findCount = current.setFind(dom.findInput.value, dom.findCaseSensitive.checked);
    findIndex = findCount > 0 ? 0 : -1;
    renderFindCount();
  }

  function refreshFindAfterEdit(): void {
    if (!findBarOpen || dom.findInput.value === "") return;
    runFind();
  }

  function openFindBar(focusTarget: "find" | "replace"): void {
    findBarOpen = true;
    dom.findBar.classList.remove("hidden");
    if (focusTarget === "find") {
      dom.findInput.focus();
      dom.findInput.select();
    } else {
      dom.replaceInput.focus();
    }
    runFind();
  }

  function closeFindBar(): void {
    if (!findBarOpen) return;
    findBarOpen = false;
    dom.findBar.classList.add("hidden");
    const current = deps.getEditor();
    if (current && dom.findInput.value !== "") current.setFind("", dom.findCaseSensitive.checked);
    findCount = 0;
    findIndex = -1;
    renderFindCount();
    current?.focus();
  }

  function stepFind(delta: 1 | -1): void {
    const current = deps.getEditor();
    if (!current || findCount === 0) return;
    findIndex = (findIndex + delta + findCount) % findCount;
    current.activateMatch(findIndex);
    renderFindCount();
  }

  function stepPrev(): void {
    stepFind(-1);
  }

  function stepNext(): void {
    stepFind(1);
  }

  function replaceCurrent(): void {
    const current = deps.getEditor();
    if (!current || findCount === 0) return;
    current.replaceCurrent(dom.replaceInput.value);
  }

  function replaceAll(): void {
    const current = deps.getEditor();
    if (!current || findCount === 0) return;
    current.replaceAll(dom.replaceInput.value);
  }

  dom.findInput.addEventListener("input", runFind);
  dom.findCaseSensitive.addEventListener("change", runFind);
  dom.btnFindPrev.addEventListener("click", stepPrev);
  dom.btnFindNext.addEventListener("click", stepNext);
  dom.btnReplace.addEventListener("click", replaceCurrent);
  dom.btnReplaceAll.addEventListener("click", replaceAll);
  dom.btnFindClose.addEventListener("click", closeFindBar);

  return {
    openFindBar,
    closeFindBar,
    refreshFindAfterEdit,
    dispose: () => {
      dom.findInput.removeEventListener("input", runFind);
      dom.findCaseSensitive.removeEventListener("change", runFind);
      dom.btnFindPrev.removeEventListener("click", stepPrev);
      dom.btnFindNext.removeEventListener("click", stepNext);
      dom.btnReplace.removeEventListener("click", replaceCurrent);
      dom.btnReplaceAll.removeEventListener("click", replaceAll);
      dom.btnFindClose.removeEventListener("click", closeFindBar);
      findBarOpen = false;
      dom.findBar.classList.add("hidden");
      findCount = 0;
      findIndex = -1;
      renderFindCount();
    },
  };
}