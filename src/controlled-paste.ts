// 受控粘贴：只保留本轮支持的可见文字与结构，清除未支持样式，表格降级为文字，
// 图片忽略，无法保证文字完整时整次拒绝。
// 格式版本 2 扩展：下划线、删除线、文字颜色、背景高亮、链接、一到六级标题、嵌套列表。

/** 把纯文本规范化为比较用行数组：CRLF/CR→LF、NBSP→空格、去行尾空白、去至多一个末尾 LF。 */
export function normalizePlainLines(raw: string): string[] {
  const s = raw.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  const lines = s.split("\n").map((line) => line.replace(/[ \t]+$/, ""));
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

const LIST_MARKER = /^(?:• |- |\* |\d+\. )/;

/** 去掉 `text/plain` 行前导的列表标记（•、-、* 或十进制编号）。 */
export function stripListMarker(line: string): string {
  return line.replace(LIST_MARKER, "");
}

/**
 * 唯一比较规则：HTML 归一化块投影为一行（不生成列表符号），`text/plain` 侧可额外
 * 去掉每行一个前导列表标记，两者归一化后的行数组必须完全相同（含空行、Tab、行序）。
 */
export function compareHtmlAndPlain(htmlProjection: string, plainText: string): boolean {
  const htmlLines = normalizePlainLines(htmlProjection);
  const plainLines = normalizePlainLines(plainText).map(stripListMarker);
  if (htmlLines.length !== plainLines.length) return false;
  return htmlLines.every((line, index) => line === plainLines[index]);
}

/** 把普通文本转换为结构化文档（每行一个段落，清除行内格式）。 */
export function plainTextToDocument(text: string): { type: "doc"; content: unknown[] } {
  const lines = normalizePlainLines(text);
  return {
    type: "doc",
    content: lines.map((line) =>
      line === "" ? { type: "paragraph" } : { type: "paragraph", content: [{ type: "text", text: line }] },
    ),
  };
}

/**
 * 把 HTML 归一化块投影为比较用纯文本行（每块一行，无列表符号，无前导/尾随 LF）。
 * 该函数接收已解析的块文本数组，便于在不依赖 DOM 的情况下测试比较逻辑。
 */
export function blocksToProjection(blockTexts: string[]): string {
  return blockTexts.join("\n");
}

/**
 * 表格降级：按行转段落，单元格用 Tab 分隔，单元格内多块用空格连接。
 * 输入为已解析的表格行结构（字符串），便于无 DOM 测试。
 */
export function tableRowsToText(rows: string[][]): string[] {
  return rows.map((cells) => cells.join("\t"));
}

// ---------------------------------------------------------------------------
// DOM 解析与归一化（浏览器端）
// ---------------------------------------------------------------------------

const EMBED_TAGS = new Set(["iframe", "object", "embed", "canvas", "svg", "video", "audio", "picture", "math"]);
const IGNORED_TAGS = new Set(["img", "script", "style", "meta", "link", "head", "template", "noscript"]);

export interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  href: string | null;
  color: string | null;
  highlight: string | null;
}

export type ParsedNode =
  | { type: "paragraph"; textRuns: TextRun[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; textRuns: TextRun[] }
  | { type: "bulletList"; items: ParsedListItem[] }
  | { type: "orderedList"; start: number; items: ParsedListItem[] };

export interface ParsedListItem {
  textRuns: TextRun[];
  nested: ParsedNode | null;
}

export interface PasteParseResult {
  content: ParsedNode[];
  hasImage: boolean;
  hasUnknownVisibleEmbed: boolean;
}

interface FormatFlags {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  href: string | null;
  color: string | null;
  highlight: string | null;
}

const DEFAULT_FORMAT: FormatFlags = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  href: null,
  color: null,
  highlight: null,
};

/** 把 CSS 颜色字符串归一化为小写 #rrggbb；无法稳定识别返回 null。 */
export function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  const m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[0-9.]+\s*)?\)$/);
  if (m) {
    const hex = (n: string): string =>
      Math.min(255, Math.max(0, parseInt(n, 10))).toString(16).padStart(2, "0");
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  }
  return null;
}

function styleValue(element: Element, property: "color" | "backgroundColor"): string | null {
  const style = (element as HTMLElement).style;
  if (!style) return null;
  const value = (style as unknown as Record<string, string>)[property];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** 收集元素的内联文字与格式，不进入块级子元素（ul/ol/li/table）。 */
function collectInlineRuns(
  element: Element,
  runs: TextRun[],
  fmt: FormatFlags,
  state: { hasImage: boolean; hasUnknownVisibleEmbed: boolean },
): void {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? "";
      if (text.length > 0) runs.push({ text, ...fmt });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (IGNORED_TAGS.has(tag)) {
      if (tag === "img") state.hasImage = true;
      continue;
    }
    if (EMBED_TAGS.has(tag)) {
      if ((el.textContent ?? "").trim().length > 0) state.hasUnknownVisibleEmbed = true;
      continue;
    }
    if (tag === "ul" || tag === "ol" || tag === "table" || tag === "li") continue;
    if (tag === "br") continue;

    const next: FormatFlags = { ...fmt };
    if (tag === "strong" || tag === "b") next.bold = true;
    if (tag === "em" || tag === "i") next.italic = true;
    if (tag === "u" || tag === "ins") next.underline = true;
    if (tag === "s" || tag === "del") next.strike = true;
    if (tag === "a") {
      const href = el.getAttribute("href");
      if (href && href.trim().length > 0) next.href = href.trim();
    }
    const color = normalizeColor(styleValue(el, "color"));
    if (color) next.color = color;
    if (tag === "mark") {
      next.highlight = normalizeColor(styleValue(el, "backgroundColor")) ?? "#ffff00";
    } else {
      const background = normalizeColor(styleValue(el, "backgroundColor"));
      if (background) next.highlight = background;
    }
    collectInlineRuns(el, runs, next, state);
  }
}

/** 处理一个段落/标题块，按 `br` 拆成多个同类型块，返回 ParsedNode 数组。 */
function blockNodesWithBr(
  element: Element,
  type: "paragraph" | "heading",
  level: 1 | 2 | 3 | 4 | 5 | 6 | undefined,
  state: { hasImage: boolean; hasUnknownVisibleEmbed: boolean },
): ParsedNode[] {
  const fragments: Element[] = [];
  let current: Element | null = null;
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1 && (child as Element).tagName.toLowerCase() === "br") {
      current = null;
      continue;
    }
    if (!current) {
      current = element.ownerDocument.createElement("span");
      fragments.push(current);
    }
    current.appendChild(child.cloneNode(true));
  }
  if (fragments.length === 0) fragments.push(element);

  return fragments.map((fragment) => {
    const runs: TextRun[] = [];
    collectInlineRuns(fragment, runs, DEFAULT_FORMAT, state);
    return type === "heading" ? { type: "heading", level: level ?? 1, textRuns: runs } : { type: "paragraph", textRuns: runs };
  });
}

/** 归一化一个列表，返回嵌套的列表项树（每项含自身文字与可选嵌套子列表）。 */
function normalizeList(
  list: Element,
  state: { hasImage: boolean; hasUnknownVisibleEmbed: boolean },
): ParsedListItem[] {
  const items: ParsedListItem[] = [];
  for (const item of Array.from(list.children)) {
    if (item.nodeType !== 1) continue;
    const tag = (item as Element).tagName.toLowerCase();
    if (tag === "ul") {
      items.push(...normalizeList(item as Element, state));
      continue;
    }
    if (tag === "ol") {
      items.push(...normalizeList(item as Element, state));
      continue;
    }
    if (tag !== "li") continue;

    // 先把 li 自身文字作为列表项输出，再检测嵌套子列表。
    const runs: TextRun[] = [];
    collectInlineRuns(item as Element, runs, DEFAULT_FORMAT, state);

    let nested: ParsedNode | null = null;
    for (const child of Array.from((item as Element).childNodes)) {
      if (child.nodeType !== 1) continue;
      const childEl = child as Element;
      const childTag = childEl.tagName.toLowerCase();
      if (childTag === "ul") {
        const childItems = normalizeList(childEl, state);
        if (childItems.length > 0) nested = { type: "bulletList", items: childItems };
        break;
      }
      if (childTag === "ol") {
        const childItems = normalizeList(childEl, state);
        if (childItems.length > 0) {
          nested = { type: "orderedList", start: orderedListStart(childEl), items: childItems };
        }
        break;
      }
    }

    items.push({ textRuns: runs, nested });
  }
  return items;
}

/** 读取有序列表的起始编号（浏览器解析后的 start，1..2^53-1，非法回退 1）。 */
function orderedListStart(list: Element): number {
  const raw = list.getAttribute("start");
  const parsed = raw === null ? NaN : Number(raw);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 9007199254740991) return parsed;
  return 1;
}

/** 单元格文字：多块扁平化为空格连接。 */
function cellText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 归一化外部 HTML：保留正文、一到六级标题、粗斜体、下划线、删除线、文字颜色、
 * 背景高亮、链接、两种列表（含嵌套）；表格降级为文字；图片忽略；含可见文字的
 * 嵌入结构标记为未知（供整次拒绝）。
 */
export function parseHtmlToBlocks(
  html: string,
  parser: (html: string) => Document = (source) => new DOMParser().parseFromString(source, "text/html"),
): PasteParseResult {
  const state = { hasImage: false, hasUnknownVisibleEmbed: false };
  const content: ParsedNode[] = [];

  const walk = (element: Element): void => {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (IGNORED_TAGS.has(tag)) {
        if (tag === "img") state.hasImage = true;
        continue;
      }
      if (EMBED_TAGS.has(tag)) {
        if ((el.textContent ?? "").trim().length > 0) state.hasUnknownVisibleEmbed = true;
        continue;
      }
      if (tag === "ul") {
        content.push({ type: "bulletList", items: normalizeList(el, state) });
        continue;
      }
      if (tag === "ol") {
        content.push({ type: "orderedList", start: orderedListStart(el), items: normalizeList(el, state) });
        continue;
      }
      if (tag === "table") {
        for (const row of Array.from(el.querySelectorAll("tr"))) {
          const cells = Array.from(row.children).map((cell) => cellText(cell as Element));
          content.push({
            type: "paragraph",
            textRuns: [{ text: cells.join("\t"), ...DEFAULT_FORMAT }],
          });
        }
        continue;
      }
      if (/^h[1-6]$/.test(tag)) {
        content.push(...blockNodesWithBr(el, "heading", Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, state));
        continue;
      }
      if (tag === "p" || tag === "div") {
        content.push(...blockNodesWithBr(el, "paragraph", undefined, state));
        continue;
      }
      // 其它元素按普通容器透明降级
      walk(el);
    }
  };

  const doc = parser(html);
  walk(doc.body);

  return { content, hasImage: state.hasImage, hasUnknownVisibleEmbed: state.hasUnknownVisibleEmbed };
}

// ---------------------------------------------------------------------------
// 归一化节点 → 结构化文档 与 粘贴决策（纯逻辑）
// ---------------------------------------------------------------------------

/** 行内 runs 合并相邻同格式并转成 text 节点序列。 */
function textRunsToContent(runs: TextRun[]): unknown[] | undefined {
  const merged: TextRun[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.bold === run.bold &&
      prev.italic === run.italic &&
      prev.underline === run.underline &&
      prev.strike === run.strike &&
      prev.href === run.href &&
      prev.color === run.color &&
      prev.highlight === run.highlight
    ) {
      prev.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  if (merged.length === 0) return undefined;
  return merged.map((run) => {
    const node: { type: "text"; text: string; marks?: unknown[] } = { type: "text", text: run.text };
    const marks: unknown[] = [];
    if (run.bold) marks.push({ type: "bold" });
    if (run.italic) marks.push({ type: "italic" });
    if (run.underline) marks.push({ type: "underline" });
    if (run.strike) marks.push({ type: "strike" });
    if (run.color) marks.push({ type: "textStyle", attrs: { color: run.color } });
    if (run.highlight) marks.push({ type: "highlight", attrs: { color: run.highlight } });
    if (run.href) marks.push({ type: "link", attrs: { href: run.href } });
    if (marks.length > 0) node.marks = marks;
    return node;
  });
}

function runsToParagraph(runs: TextRun[]): { type: "paragraph"; content?: unknown[] } {
  const content = textRunsToContent(runs);
  return content ? { type: "paragraph", content } : { type: "paragraph" };
}

function nodeToDocument(node: ParsedNode): unknown {
  switch (node.type) {
    case "paragraph":
      return runsToParagraph(node.textRuns);
    case "heading": {
      const content = textRunsToContent(node.textRuns);
      return content
        ? { type: "heading", attrs: { level: node.level }, content }
        : { type: "heading", attrs: { level: node.level } };
    }
    case "bulletList":
      return { type: "bulletList", content: node.items.map(itemToDocument) };
    case "orderedList":
      return { type: "orderedList", attrs: { start: node.start }, content: node.items.map(itemToDocument) };
  }
}

function itemToDocument(item: ParsedListItem): unknown {
  const paragraph = runsToParagraph(item.textRuns);
  if (item.nested) {
    return { type: "listItem", content: [paragraph, nodeToDocument(item.nested)] };
  }
  return { type: "listItem", content: [paragraph] };
}

/** 把归一化节点树组装为结构化文档。 */
export function nodesToDocument(content: ParsedNode[]): { type: "doc"; content: unknown[] } {
  return { type: "doc", content: content.map(nodeToDocument) };
}

/** 按显示顺序把节点树投影为每块一行的纯文本行数组（列表项不含符号）。 */
export function flattenNodeTexts(content: ParsedNode[]): string[] {
  const texts: string[] = [];
  for (const node of content) {
    if (node.type === "paragraph" || node.type === "heading") {
      texts.push(node.textRuns.map((run) => run.text).join(""));
    } else {
      for (const item of node.items) {
        texts.push(item.textRuns.map((run) => run.text).join(""));
        if (item.nested) texts.push(...flattenNodeTexts([item.nested]));
      }
    }
  }
  return texts;
}

function totalTextOfNodes(content: ParsedNode[]): number {
  let total = 0;
  for (const node of content) {
    if (node.type === "paragraph" || node.type === "heading") {
      total += node.textRuns.reduce((sum, run) => sum + run.text.length, 0);
    } else {
      for (const item of node.items) {
        total += item.textRuns.reduce((sum, run) => sum + run.text.length, 0);
        if (item.nested) total += totalTextOfNodes([item.nested]);
      }
    }
  }
  return total;
}

export type PasteAction =
  | { kind: "insert"; document: { type: "doc"; content: unknown[] } }
  | { kind: "reject"; reason: string }
  | { kind: "nothing" };

/**
 * 粘贴决策：无 HTML 时按纯文本插入；有 HTML 时归一化、做完整性比较并决定
 * 插入 / 整次拒绝 / 纯图片不插入。
 */
export function decidePasteAction(plain: string, hasHtml: boolean, parsed: PasteParseResult): PasteAction {
  if (!hasHtml) {
    return { kind: "insert", document: plainTextToDocument(plain) };
  }

  const totalText = totalTextOfNodes(parsed.content);

  if (parsed.hasImage && totalText === 0) {
    return { kind: "nothing" };
  }

  if (plain === "" && parsed.hasUnknownVisibleEmbed) {
    return { kind: "reject", reason: "内容无法可靠提取，已取消粘贴" };
  }

  const document = nodesToDocument(parsed.content);

  if (plain !== "") {
    const projection = blocksToProjection(flattenNodeTexts(parsed.content));
    if (!compareHtmlAndPlain(projection, plain)) {
      return { kind: "reject", reason: "粘贴内容与纯文本不一致，已取消粘贴" };
    }
  }

  return { kind: "insert", document };
}
