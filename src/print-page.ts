// PDF 打印页（常驻隐藏 print-window 加载）：接收后端经 Tauri 事件发来的导出投影，
// 用与编辑器一致的 HTML/CSS 渲染（共享 styles.css 的字体与令牌），Paged.js 预分页
// （A4 页盒、统一边距、底部居中页码），就绪后回发 print-ready（design.md 决策 3）。
//
// 就绪三重信号：页面脚本已运行（蕴含导航完成）→ document.fonts.ready（字体定稿）
// → Paged.js 分页完成；三者齐备才回发就绪，不做任何固定延时。
//
// 本页面只读：不调用任何写入作品数据的命令，内容仅来自后端已保存数据的投影。

import { emit, listen } from "@tauri-apps/api/event";

// Paged.js 以版本锁定的静态脚本资产离线捆绑（UMD 全局 PagedModule.Previewer）。
// 不经 npm exports 深导入、不进 JS 打包分片：502KB 的压缩文件原样随 dist 分发，
// 保持 frontend-bundle-structure 的单包体积警戒线语义。
const PAGEDJS_SCRIPT_URL = "/vendor/pagedjs-0.4.3.min.js";

// ---------- 后端导出投影的 serde 形状（与 src-tauri/src/project/export.rs 对齐） ----------

type ExportScope =
  | { type: "work" }
  | { type: "document"; id: string }
  | { type: "folder"; id: string };

type ExportAlign = "left" | "center" | "right" | "justify";

type ExportMark =
  | { kind: "bold" }
  | { kind: "italic" }
  | { kind: "underline" }
  | { kind: "strike" }
  | { kind: "color"; value: string }
  | { kind: "link"; value: string };

interface ExportText {
  text: string;
  marks: ExportMark[];
}

interface ExportListItem {
  content: ExportText[];
  nested: ExportBlock | null;
}

type ExportBlock =
  | { kind: "paragraph"; align: ExportAlign | null; content: ExportText[] }
  | { kind: "heading"; level: number; align: ExportAlign | null; content: ExportText[] }
  | { kind: "bulletList"; items: ExportListItem[] }
  | { kind: "orderedList"; start: number; listType: string | null; items: ExportListItem[] };

type ExportNode =
  | { kind: "folder"; name: string; children: ExportNode[] }
  | { kind: "document"; name: string; blocks: ExportBlock[] };

interface ExportProject {
  scope: ExportScope;
  root_name: string;
  children: ExportNode[];
}

interface PrintPayload {
  job: number;
  project: ExportProject;
}

// ---------- DOM 渲染（与编辑器 ProseMirror 的默认块呈现同构） ----------

function headingElement(level: number, text: string): HTMLHeadingElement {
  const element = document.createElement(`h${Math.min(6, Math.max(1, level))}`) as HTMLHeadingElement;
  element.textContent = text;
  return element;
}

function applyAlign(element: HTMLElement, align: ExportAlign | null): void {
  if (align !== null) element.style.textAlign = align;
}

function renderInline(container: HTMLElement, texts: readonly ExportText[]): void {
  for (const part of texts) {
    if (part.text === "") continue;
    // 逐个标记包裹；链接最外层（可点击）；颜色行内样式；无法映射的呈现属性
    // （highlight / fontFamily / fontSize）按规格降级为纯文字，不丢字符。
    let link: string | null = null;
    let color: string | null = null;
    const wraps: HTMLElement[] = [];
    for (const mark of part.marks) {
      if (mark.kind === "bold") wraps.push(document.createElement("strong"));
      else if (mark.kind === "italic") wraps.push(document.createElement("em"));
      else if (mark.kind === "underline") wraps.push(document.createElement("u"));
      else if (mark.kind === "strike") wraps.push(document.createElement("s"));
      else if (mark.kind === "color") color = mark.value;
      else if (mark.kind === "link") link = mark.value;
    }
    let node: Node = document.createTextNode(part.text);
    if (color !== null) {
      const span = document.createElement("span");
      span.style.color = color;
      span.appendChild(node);
      node = span;
    }
    for (const wrap of wraps) {
      wrap.appendChild(node);
      node = wrap;
    }
    if (link !== null) {
      const anchor = document.createElement("a");
      anchor.href = link;
      anchor.appendChild(node);
      node = anchor;
    }
    container.appendChild(node);
  }
}

function renderBlocks(container: HTMLElement, blocks: readonly ExportBlock[]): void {
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      const paragraph = document.createElement("p");
      applyAlign(paragraph, block.align);
      renderInline(paragraph, block.content);
      container.appendChild(paragraph);
    } else if (block.kind === "heading") {
      const heading = headingElement(block.level, "");
      applyAlign(heading, block.align);
      renderInline(heading, block.content);
      container.appendChild(heading);
    } else if (block.kind === "bulletList" || block.kind === "orderedList") {
      container.appendChild(renderList(block));
    }
  }
}

function renderList(block: Extract<ExportBlock, { kind: "bulletList" | "orderedList" }>):
  HTMLUListElement | HTMLOListElement {
  const list =
    block.kind === "bulletList"
      ? document.createElement("ul")
      : document.createElement("ol");
  if (block.kind === "orderedList") {
    if (block.start !== 1) {
      list.setAttribute("start", String(block.start));
    }
    // 编号样式透传：ol[type] 由浏览器按 presentational hint 原生渲染
    // （项目样式表不以 list-style-type 覆盖，见 add-list-numbering-formats D1）。
    if (block.listType !== null && block.listType !== "1") {
      list.setAttribute("type", block.listType);
    }
  }
  for (const item of block.items) {
    const listItem = document.createElement("li");
    const paragraph = document.createElement("p");
    renderInline(paragraph, item.content);
    listItem.appendChild(paragraph);
    if (item.nested !== null && (item.nested.kind === "bulletList" || item.nested.kind === "orderedList")) {
      listItem.appendChild(renderList(item.nested));
    }
    list.appendChild(listItem);
  }
  return list;
}

/** 子树节点的标题层级：Work 扁平（文件夹 h2 / 文档 h3）；Folder 按深度递进封顶 6。 */
function nodeHeadingLevel(scope: ExportScope, depth: number, isFolder: boolean): number {
  if (scope.type === "work") return isFolder ? 2 : 3;
  return Math.min(6, depth + 2);
}

function renderNodes(container: HTMLElement, nodes: readonly ExportNode[], scope: ExportScope, depth: number): void {
  for (const node of nodes) {
    if (node.kind === "folder") {
      container.appendChild(headingElement(nodeHeadingLevel(scope, depth, true), node.name));
      renderNodes(container, node.children, scope, depth + 1);
    } else {
      container.appendChild(headingElement(nodeHeadingLevel(scope, depth, false), node.name));
      renderBlocks(container, node.blocks);
    }
  }
}

function renderProject(project: ExportProject): HTMLElement {
  const container = document.createElement("div");
  container.className = "print-root";
  container.appendChild(headingElement(1, project.root_name));
  if (project.scope.type === "document") {
    const only = project.children[0];
    if (only !== undefined && only.kind === "document") {
      renderBlocks(container, only.blocks);
    }
  } else {
    renderNodes(container, project.children, project.scope, 0);
  }
  return container;
}

// ---------- Paged.js 加载与分页 ----------

interface PagedPreviewer {
  preview(content: HTMLElement, stylesheets: string[], renderTo: HTMLElement): Promise<unknown>;
}

type PagedGlobal = { Previewer: new () => PagedPreviewer };

let pagedLoader: Promise<void> | null = null;

function loadPagedJs(): Promise<void> {
  if (pagedLoader === null) {
    pagedLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = PAGEDJS_SCRIPT_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("无法加载分页脚本（Paged.js）"));
      document.head.appendChild(script);
    });
  }
  return pagedLoader;
}

function pagedGlobal(): PagedGlobal {
  const global = (window as unknown as { PagedModule?: PagedGlobal }).PagedModule;
  if (global === undefined) throw new Error("分页脚本未就绪（Paged.js）");
  return global;
}

/** 把 CSS 文本里的相对 url(...) 以 base 解析为绝对地址。blob: 不是层级 URL，
 *  不能当解析基底（Paged.js 会拿样式表 URL 作 base 去 new URL 相对路径，必抛
 *  Invalid URL）；进 blob 前全部绝对化，釜底抽薪。已绝对/非路径值原样保留。 */
function absolutizeUrls(cssText: string, base: string): string {
  return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote: string, target: string) => {
    if (/^(https?:|data:|asset:|blob:|#)/i.test(target)) return match;
    try {
      return `url(${quote}${new URL(target, base).href}${quote})`;
    } catch {
      return match;
    }
  });
}

/**
 * 从 `document.styleSheets` 直读当前文档的全部 CSS 规则文本（含 @font-face 与
 * @page）。真机验收发现：生产 CSP 的 `connect-src` 只放行 IPC，不含同源资产，
 * Paged.js 的 `preview()` 内部会 fetch 样式表 URL——直接把 link 的 href 传给它
 * 必然 "Failed to fetch"。改为从 DOM 读出样式文本、经 blob URL 交给 Paged.js，
 * 零网络请求。同源样式表可读；单张表读取抛异常（如跨源受限）就跳过该表继续，
 * 不让整条分页链失败。相对 url(...) 先以 document.baseURI 绝对化——blob: URL
 * 不能作相对路径的解析基底，否则 Paged.js 内部 new URL(相对路径, blobURL) 抛
 * Invalid URL。
 */
function collectCssTextFromDocument(): string[] {
  const texts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 受限样式表：跳过，不让单表失败拖垮整链
    }
    const parts: string[] = [];
    for (const rule of Array.from(rules)) {
      parts.push(rule.cssText);
    }
    if (parts.length > 0) {
      texts.push(absolutizeUrls(parts.join("\n"), document.baseURI));
    }
  }
  return texts;
}

async function runPrintJob(payload: PrintPayload): Promise<void> {
  const content = renderProject(payload.project);
  // 信号 2：字体加载定稿后再分页，避免以回退字体度量分页导致观感漂移。
  await document.fonts.ready;
  // 信号 3：Paged.js 按 @page 规则生成分页页盒（A4、统一边距、底部居中页码）。
  await loadPagedJs();
  // 样式文本从 DOM 直读后包成 blob URL（页面自建、零外部网络），代替会触发
  // fetch 的 link href；CSP connect-src 已为页面自建 blob 放行 blob:。
  const blobUrls = collectCssTextFromDocument().map((text) =>
    URL.createObjectURL(new Blob([text], { type: "text/css" })),
  );
  try {
    await new (pagedGlobal().Previewer)().preview(content, blobUrls, document.body);
  } finally {
    // 无论分页成败都释放 blob URL，避免常驻打印窗口反复导出时累积内存。
    for (const url of blobUrls) URL.revokeObjectURL(url);
  }
}

async function main(): Promise<void> {
  await listen<PrintPayload>("print-payload", (event) => {
    const payload = event.payload;
    runPrintJob(payload)
      .then(() => emit("print-ready", { job: payload.job, ok: true }))
      .catch((error: unknown) =>
        emit("print-ready", {
          job: payload.job,
          ok: false,
          message: String(error instanceof Error ? error.message : error),
        }),
      );
  });
  // 信号 1：页面脚本已运行且载荷监听已注册（蕴含导航完成），可以接收导出内容。
  await emit("print-page-boot", { ok: true });
}

void main();
