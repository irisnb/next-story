/** Shared presentation only: one tooltip, responsive tool placement, display preferences. */
export function setupUiV5(): () => void {
  const cleanup: Array<() => void> = [];
  const tooltip = document.createElement("div");
  tooltip.className = "ui-tooltip hidden";
  tooltip.id = "ui-tooltip";
  tooltip.setAttribute("role", "tooltip");
  document.body.append(tooltip);
  let trigger: HTMLElement | null = null;
  let previousDescription: string | null = null;
  function hideTooltip(): void {
    if (trigger) {
      if (previousDescription) trigger.setAttribute("aria-describedby", previousDescription);
      else trigger.removeAttribute("aria-describedby");
    }
    trigger = null;
    tooltip.classList.add("hidden");
  }
  function prepareTitles(root: ParentNode): void {
    const buttons = Array.from(root.querySelectorAll<HTMLElement>("button[title]"));
    if (root instanceof HTMLElement && root.matches("button[title]")) buttons.push(root);
    buttons.forEach((button) => {
      if (button.title) button.dataset.tooltip = button.title;
      button.removeAttribute("title");
    });
    root.querySelectorAll<HTMLButtonElement>('.ai-send-mark').forEach((button) => {
      button.setAttribute("aria-label", button.textContent?.trim() || "发送");
      button.dataset.tooltip = button.getAttribute("aria-label") ?? "发送";
    });
  }
  function showTooltip(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button, [data-tooltip]") : null;
    if (!target || target.closest(".hidden") || target.getClientRects().length === 0) return;
    if (target.classList.contains("ai-send-mark")) {
      const label = target.textContent?.trim() || "发送";
      target.setAttribute("aria-label", label);
      target.dataset.tooltip = label;
    }
    const text = target.dataset.tooltip ?? target.getAttribute("aria-label");
    if (!text) return;
    hideTooltip();
    trigger = target;
    previousDescription = target.getAttribute("aria-describedby");
    tooltip.textContent = text;
    tooltip.classList.remove("hidden");
    target.setAttribute("aria-describedby", [previousDescription, tooltip.id].filter(Boolean).join(" "));
    const rect = target.getBoundingClientRect();
    const x = Math.max(8, Math.min(rect.left + rect.width / 2 - tooltip.offsetWidth / 2, window.innerWidth - tooltip.offsetWidth - 8));
    const y = rect.bottom + tooltip.offsetHeight + 12 < window.innerHeight ? rect.bottom + 8 : rect.top - tooltip.offsetHeight - 8;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${Math.max(8, y)}px`;
  }
  const events: Array<[string, EventListener]> = [
    ["pointerover", showTooltip], ["focusin", showTooltip],
    ["pointerout", hideTooltip], ["focusout", hideTooltip], ["pointerdown", hideTooltip],
    ["keydown", hideTooltip], ["scroll", hideTooltip],
  ];
  for (const [type, handler] of events) {
    document.addEventListener(type, handler, true);
    cleanup.push(() => document.removeEventListener(type, handler, true));
  }
  prepareTitles(document);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLElement && record.attributeName === "title") {
        if (record.target.matches("button[title]")) {
          record.target.dataset.tooltip = record.target.title;
          record.target.removeAttribute("title");
        }
      }
      for (const added of Array.from(record.addedNodes)) if (added instanceof HTMLElement) prepareTitles(added);
      if (record.target instanceof HTMLElement && record.target.classList.contains("ai-send-mark")) {
        const label = record.target.textContent?.trim() || "发送";
        record.target.setAttribute("aria-label", label);
        record.target.dataset.tooltip = label;
      }
    }
    if (trigger && (!trigger.isConnected || trigger.closest(".hidden") || trigger.getClientRects().length === 0)) hideTooltip();
    const name = document.getElementById("current-project-name");
    if (name && name.title !== name.textContent) name.title = name.textContent ?? "";
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["title", "class", "hidden"] });
  cleanup.push(() => observer.disconnect(), () => tooltip.remove());

  const rail = document.getElementById("format-toolbar");
  if (rail) {
    const disposeTools = setupWritingTools(rail);
    const tools = Array.from(rail.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "btn toolbar-btn toolbar-overflow-trigger";
    more.dataset.variant = "ghost";
    more.dataset.size = "icon";
    more.textContent = "···";
    more.setAttribute("aria-label", "更多写作工具");
    more.setAttribute("aria-expanded", "false");
    more.setAttribute("aria-controls", "toolbar-overflow-menu");
    const menu = document.createElement("div");
    menu.id = "toolbar-overflow-menu";
    menu.className = "toolbar-overflow-menu hidden";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "更多写作工具");
    document.body.append(menu);
    rail.append(more);
    function close(): void { menu.classList.add("hidden"); more.setAttribute("aria-expanded", "false"); }
    function arrange(): void {
      if (!rail) return;
      close();
      if (rail.clientHeight === 0) return;
      // Move the original controls: state and listeners remain on the same nodes.
      const available = rail.clientHeight - 66;
      let used = 0;
      let previousGroup = "";
      rail.querySelectorAll(".tool-rule").forEach((rule) => rule.remove());
      for (const tool of tools) {
        rail.insertBefore(tool, more);
        const group = tool.dataset.toolGroup ?? "";
        const separator = previousGroup && previousGroup !== group ? 16 : 0;
        const height = 40 + separator;
        used += height;
        if (used > available) menu.append(tool);
        else {
          if (separator) {
            const rule = document.createElement("div");
            rule.className = "tool-rule";
            rule.setAttribute("role", "separator");
            rail.insertBefore(rule, tool);
          }
          previousGroup = group;
        }
      }
      more.classList.toggle("hidden", menu.children.length === 0);
    }
    const toggleOverflow = (): void => {
      const open = menu.classList.contains("hidden");
      menu.classList.toggle("hidden", !open);
      more.setAttribute("aria-expanded", String(open));
      if (open) {
        const rect = more.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(rect.right + 8, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - menu.offsetHeight - 8))}px`;
        menu.querySelector<HTMLElement>("button, select")?.focus();
      }
    };
    more.addEventListener("click", toggleOverflow);
    // Keep the editor selection while opening the extra controls, as on the rail.
    const retainSelection = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
    };
    more.addEventListener("pointerdown", retainSelection);
    menu.addEventListener("pointerdown", retainSelection);
    const dismiss = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key === "Escape" && !menu.classList.contains("hidden")) { close(); more.focus(); }
      if (event.type === "pointerdown" && !menu.contains(event.target as Node) && event.target !== more) close();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    const closeOnScroll = (event: Event): void => {
      if (!menu.contains(event.target as Node)) close();
    };
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", close);
    const resize = new ResizeObserver(arrange);
    resize.observe(rail);
    cleanup.push(() => resize.disconnect(), () => document.removeEventListener("pointerdown", dismiss), () => document.removeEventListener("keydown", dismiss), () => document.removeEventListener("scroll", closeOnScroll, true), () => window.removeEventListener("resize", close), () => {
      for (const tool of tools) rail.insertBefore(tool, more);
      rail.querySelectorAll(".tool-rule").forEach((rule) => rule.remove());
      more.removeEventListener("click", toggleOverflow);
      more.removeEventListener("pointerdown", retainSelection);
      menu.removeEventListener("pointerdown", retainSelection);
      more.remove(); menu.remove();
    });
    cleanup.push(disposeTools);
  }

  const background = document.getElementById("writing-background") as HTMLSelectElement | null;
  const page = document.getElementById("editor-page");
  if (background && page) {
    const colors: Record<string, string> = { gray: "#f5f5f5", white: "#ffffff", warm: "#f5f2ec" };
    let saved = "gray";
    try { saved = localStorage.getItem("next-story.writing-background") ?? "gray"; } catch { /* default */ }
    background.value = Object.prototype.hasOwnProperty.call(colors, saved) ? saved : "gray";
    const apply = (): void => { page.style.setProperty("--writing-background", colors[background.value] ?? colors.gray!); };
    apply();
    const changeBackground = (): void => {
      apply();
      try { localStorage.setItem("next-story.writing-background", background.value); } catch { /* display still works */ }
    };
    background.addEventListener("change", changeBackground);
    cleanup.push(() => background.removeEventListener("change", changeBackground));
  }
  return () => { hideTooltip(); for (const dispose of cleanup) dispose(); };
}

/** Approved prototype app.js defs, applied to the real command nodes. */
function setupWritingTools(rail: HTMLElement): () => void {
  if (!document.getElementById("format-drawer")) return () => {};
  const originals = Array.from(rail.children);
  const moved: Array<{ node: HTMLElement; parent: Node; next: Node | null }> = [];
  const presentation = new Map<HTMLElement, { attributes: Array<[string, string | null]>; children?: Node[] }>();
  function remember(node: HTMLElement, children = false): void {
    if (presentation.has(node)) return;
    const names = ["class", "data-variant", "data-size", "data-tool-group", "data-tooltip", "data-value", "aria-label", "aria-expanded", "aria-controls"];
    presentation.set(node, { attributes: names.map((name) => [name, node.getAttribute(name)]), children: children ? Array.from(node.childNodes) : undefined });
  }
  const listeners: Array<() => void> = [];
  const triggers: Array<{ button: HTMLButtonElement; controls: HTMLElement[] }> = [];
  const sheet = document.createElement("section");
  sheet.className = "tool-sheet hidden";
  sheet.id = "writing-tool-options";
  sheet.setAttribute("aria-label", "写作工具选项");
  const heading = document.createElement("strong");
  const closeButton = document.createElement("button");
  closeButton.className = "btn";
  closeButton.dataset.variant = "ghost";
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "关闭工具选项");
  const header = document.createElement("header");
  header.append(heading, closeButton);
  const body = document.createElement("div");
  body.className = "tool-option-body";
  sheet.append(header, body);
  document.body.append(sheet);
  let active: HTMLButtonElement | null = null;
  function close(): void {
    sheet.classList.add("hidden");
    active?.setAttribute("aria-expanded", "false");
    active = null;
  }
  function bind(node: EventTarget, type: string, handler: EventListener): void {
    node.addEventListener(type, handler);
    listeners.push(() => node.removeEventListener(type, handler));
  }
  function relocate(node: HTMLElement, target: HTMLElement): void {
    if (!moved.some((entry) => entry.node === node) && node.parentNode) {
      moved.push({ node, parent: node.parentNode, next: node.nextSibling });
    }
    target.append(node);
  }
  // Paths and group order copied from 原型-v5/app.js:24–34.
  const defs: Array<[string, string, string, number, string[]?]> = [
    ["btn-undo", "撤销", "m8 5-4 4 4 4M4 9h10a5 5 0 0 1 0 10", 0],
    ["btn-redo", "重做", "m16 5 4 4-4 4M20 9H10a5 5 0 0 0 0 10", 0],
    ["btn-bold", "粗体", "M7 5h6a3.5 3.5 0 0 1 0 7H7V5M7 12h7a3.5 3.5 0 0 1 0 7H7v-7", 1],
    ["btn-italic", "斜体", "M10 5h8M6 19h8M15 5 9 19", 1],
    ["btn-toolbar-underline", "下划线", "M6 4v7a6 6 0 0 0 12 0V4M5 21h14", 1],
    ["tool-size", "字号", "M3 5h12M9 5v14M5 19h8M17 11h5M19.5 11v8", 1, ["select-font-size"]],
    ["tool-font", "字体", "m4 19 6-14 6 14M6 14h8M18 10h3M19.5 10v9", 1, ["select-font-family"]],
    ["tool-style", "段落样式", "M5 5v14M15 5v14M5 12h10M18 15h3M19.5 15v5", 2, ["paragraph-style"]],
    ["tool-indent", "缩进", "M11 5h9M11 10h9M11 15h9M11 20h9M3 12h5m-2-2 2 2-2 2", 2, ["select-indent-left", "select-indent-right", "select-text-indent"]],
    ["btn-bullet-list", "项目符号", "M9 5h11M9 12h11M9 19h11M3 5h2M3 12h2M3 19h2", 2],
    ["btn-ordered-list", "编号样式", "M10 5h10M10 12h10M10 19h10M3 4l2-1v6M3 12c4-3 4 2 0 4h4M3 19h3l-2 2", 2],
    ["btn-find", "查找 / 替换", "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-1 5 6 6M7 10h6", 3],
    ["btn-align-left", "左对齐", "M4 5h16M4 10h10M4 15h16M4 20h10", 4],
    ["btn-align-center", "居中", "M4 5h16M7 10h10M4 15h16M7 20h10", 4],
    ["btn-align-right", "右对齐", "M4 5h16M10 10h10M4 15h16M10 20h10", 4],
    ["btn-align-justify", "两端对齐", "M4 5h16M4 10h16M4 15h16M4 20h16", 4],
    ["tool-line", "行距", "M10 5h10M10 12h10M10 19h10M4 4v16m-2-14 2-2 2 2m-4 12 2 2 2-2", 4, ["select-line-height"]],
    ["tool-before", "段前间距", "M4 12h16M4 16h16M4 20h16M12 3v6m-3-3 3 3 3-3", 4, ["select-spacing-before"]],
    ["tool-after", "段后间距", "M4 4h16M4 8h16M4 12h16M12 15v6m-3-3 3-3 3 3", 4, ["select-spacing-after"]],
    ["btn-toolbar-strike", "删除线", "M17 6c-2-3-10-3-10 1 0 5 10 4 10 8 0 4-8 5-11 1M3 12h18", 5],
    ["tool-color", "文字颜色", "m6 16 6-12 6 12M8 12h8M4 21h16", 5, ["input-text-color", "btn-clear-text-color"]],
    ["tool-highlight", "文字高亮", "m8 15 8-10 4 4-10 8-4 1ZM8 15l2 2M4 21h16", 5, ["input-highlight", "btn-clear-highlight"]],
    ["tool-link", "文字链接", "m10 14 4-4M9 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M15 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0", 5, ["toolbar-link-url", "toolbar-link-save", "toolbar-link-remove"]],
    ["btn-clear-character-format", "清除字符格式", "M3 5h13M9.5 5v10m5 2 5-5 3 3-5 5h-4l-2-2ZM14 20h8", 5],
    ["btn-clear-paragraph-format", "清除段落格式", "M12 4v12M16 4v8M16 4H7a4 4 0 0 0 0 8h5M17 16l4 4m0-4-4 4", 5],
  ];
  const parking = document.createElement("div");
  parking.className = "hidden";
  document.body.append(parking);
  const linkUrl = document.createElement("input");
  linkUrl.id = "toolbar-link-url";
  linkUrl.type = "url";
  linkUrl.placeholder = "https://";
  linkUrl.setAttribute("aria-label", "链接地址");
  const linkSave = document.createElement("button");
  linkSave.id = "toolbar-link-save";
  linkSave.type = "button";
  linkSave.textContent = "创建 / 编辑链接";
  const linkRemove = document.createElement("button");
  linkRemove.id = "toolbar-link-remove";
  linkRemove.type = "button";
  linkRemove.textContent = "移除链接";
  parking.append(linkUrl, linkSave, linkRemove);
  const orderedRow = rail.querySelector<HTMLElement>(".ol-style-row");
  for (const [id, label, path, group, controlIds] of defs) {
    const existing = document.getElementById(id);
    const button = existing instanceof HTMLButtonElement ? existing : document.createElement("button");
    if (existing) remember(button, true);
    button.id = id;
    button.type = "button";
    button.className = "btn toolbar-btn tool-button";
    button.dataset.variant = "ghost";
    button.dataset.size = "icon";
    button.dataset.toolGroup = String(group);
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;
    button.innerHTML = `<svg class="v5-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    if (id === "btn-ordered-list" && orderedRow) {
      remember(orderedRow);
      orderedRow.dataset.toolGroup = String(group);
      rail.append(orderedRow);
    } else if (existing && !rail.contains(existing)) relocate(button, rail);
    else rail.append(button);
    if (!controlIds) continue;
    const controls = controlIds.map((controlId) => document.getElementById(controlId)).filter((node): node is HTMLElement => node !== null);
    const fields = controls.map((control) => {
      remember(control);
      const field = document.createElement("div");
      field.className = "tool-option-field";
      if (control instanceof HTMLSelectElement || control instanceof HTMLInputElement) {
        const fieldLabel = document.createElement("label");
        fieldLabel.htmlFor = control.id;
        fieldLabel.textContent = document.querySelector(`label[for="${control.id}"]`)?.textContent ?? label;
        field.append(fieldLabel);
        control.classList.add(control instanceof HTMLSelectElement ? "select" : "input");
      } else {
        control.classList.add("btn");
        control.dataset.variant = "outline";
      }
      relocate(control, field);
      parking.append(field);
      return field;
    });
    triggers.push({ button, controls });
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", sheet.id);
    bind(button, "click", () => {
      const wasOpen = active === button;
      close();
      if (wasOpen) return;
      // Return every field to parking before replacing the current panel.
      while (body.firstChild) parking.append(body.firstChild);
      fields.forEach((field) => body.append(field));
      active = button;
      heading.textContent = label;
      button.setAttribute("aria-expanded", "true");
      sheet.classList.remove("hidden");
      const rect = button.getBoundingClientRect();
      sheet.style.left = `${Math.max(8, Math.min(rect.right + 8, window.innerWidth - sheet.offsetWidth - 8))}px`;
      sheet.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - sheet.offsetHeight - 8))}px`;
    });
  }
  const legacy = document.getElementById("btn-format-drawer");
  if (legacy) relocate(legacy, parking);
  function sync(): void {
    for (const { button, controls } of triggers) {
      const select = controls.find((control) => control instanceof HTMLSelectElement) as HTMLSelectElement | undefined;
      const enabled = controls.some((control) => !(control as HTMLButtonElement).disabled);
      button.disabled = !enabled;
      if (select) {
        const value = select.value === "mixed" || select.value === "" ? "" : select.selectedOptions[0]?.textContent ?? "";
        button.dataset.value = value;
        const label = button.getAttribute("aria-label")?.split(" · ")[0];
        button.dataset.tooltip = `${label}${value ? ` · ${value}` : ""}`;
        button.setAttribute("aria-label", button.dataset.tooltip);
      }
    }
    if (active?.disabled) close();
  }
  bind(document, "writing-format-rendered", sync);
  bind(body, "change", sync);
  bind(closeButton, "click", close);
  bind(document, "keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape" && active) { const focus = active; close(); focus.focus(); }
  });
  bind(document, "pointerdown", (event) => {
    const target = event.target as Node;
    if (!sheet.contains(target) && !active?.contains(target)) close();
  });
  const preserveSelection = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
  };
  bind(rail, "pointerdown", preserveSelection);
  bind(sheet, "pointerdown", preserveSelection);
  bind(window, "resize", close);
  sync();
  return () => {
    listeners.forEach((dispose) => dispose());
    for (const { node, parent, next } of moved.reverse()) parent.insertBefore(node, next?.parentNode === parent ? next : null);
    for (const [node, saved] of presentation) {
      for (const [name, value] of saved.attributes) {
        if (value === null) node.removeAttribute(name);
        else node.setAttribute(name, value);
      }
      if (saved.children) node.replaceChildren(...saved.children);
    }
    rail.replaceChildren(...originals);
    sheet.remove(); parking.remove();
  };
}
