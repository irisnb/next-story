// 受控粘贴：只保留本轮支持的可见文字与结构，清除未支持样式，表格降级为文字，
// 图片忽略，无法保证文字完整时整次拒绝。

/** 把纯文本规范化为比较用行数组：CRLF/CR→LF、NBSP→空格、去行尾空白、去至多一个末尾 LF。 */
export function normalizePlainLines(raw: string): string[] {
  let s = raw.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  let lines = s.split("\n").map((line) => line.replace(/[ \t]+$/, ""));
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

interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

interface ParsedBlock {
  type: "paragraph" | "heading";
  level?: 1 | 2;
  listType?: "bullet" | "ordered";
  textRuns: TextRun[];
}

export interface PasteParseResult {
  blocks: ParsedBlock[];
  hasImage: boolean;
  hasUnknownVisibleEmbed: boolean;
}

/** 收集元素的内联文字与格式（strong/b/em/i 映射为粗斜体），不进入块级子元素。 */
function collectInlineRuns(
  element: Element,
  runs: TextRun[],
  bold: boolean,
  italic: boolean,
  state: { hasImage: boolean; hasUnknownVisibleEmbed: boolean },
): void {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? "";
      if (text.length > 0) runs.push({ text, bold, italic });
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
    // 块级或列表元素由外层处理，这里只透传内联元素。
    // 注意：p/div 不能跳过——Tiptap 序列化的列表项是 <li><p>文字</p></li>，
    // 网页里列表项也可能是 <li><div>文字</div></li>，跳过会导致文字丢失。
    if (tag === "ul" || tag === "ol" || tag === "table" || tag === "li") {
      continue;
    }
    if (tag === "br") continue;
    collectInlineRuns(
      el,
      runs,
      bold || tag === "strong" || tag === "b",
      italic || tag === "em" || tag === "i",
      state,
    );
  }
}

/** 处理一个段落/标题块，按 `br` 拆成多个同类型块。 */
function pushBlockWithBr(
  element: Element,
  type: "paragraph" | "heading",
  level: 1 | 2 | undefined,
  blocks: ParsedBlock[],
  state: { hasImage: boolean; hasUnknownVisibleEmbed: boolean },
): void {
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

  for (const fragment of fragments) {
    const runs: TextRun[] = [];
    collectInlineRuns(fragment, runs, false, false, state);
    blocks.push({ type, level, textRuns: runs });
  }
}

function normalizeList(
  list: Element,
  listType: "bullet" | "ordered",
  blocks: ParsedBlock[],
  state: { hasImage: boolean; hasUnknownVisibleEmbed: boolean },
): void {
  for (const item of Array.from(list.children)) {
    if (item.nodeType !== 1) continue;
    const tag = (item as Element).tagName.toLowerCase();
    if (tag === "ul") {
      normalizeList(item as Element, "bullet", blocks, state);
      continue;
    }
    if (tag === "ol") {
      normalizeList(item as Element, "ordered", blocks, state);
      continue;
    }
    if (tag !== "li") continue;

    // 先把 li 自身文字作为列表项输出，再按显示顺序输出嵌套子列表。
    // collectInlineRuns 内部会跳过 ul/ol/li 子元素，只收取内联文字。
    const runs: TextRun[] = [];
    collectInlineRuns(item as Element, runs, false, false, state);
    blocks.push({ type: "paragraph", listType, textRuns: runs });

    for (const child of Array.from(item.childNodes)) {
      if (child.nodeType !== 1) continue;
      const childEl = child as Element;
      const childTag = childEl.tagName.toLowerCase();
      if (childTag === "ul") normalizeList(childEl, "bullet", blocks, state);
      else if (childTag === "ol") normalizeList(childEl, "ordered", blocks, state);
    }
  }
}

/** 单元格文字：多块扁平化为空格连接。 */
function cellText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 归一化外部 HTML：只保留正文、两级标题、粗斜体与两种列表；表格降级为文字；
 * 图片忽略；含可见文字的嵌入结构标记为未知（供整次拒绝）。
 */
export function parseHtmlToBlocks(
  html: string,
  parser: (html: string) => Document = (source) => new DOMParser().parseFromString(source, "text/html"),
): PasteParseResult {
  const state = { hasImage: false, hasUnknownVisibleEmbed: false };
  const blocks: ParsedBlock[] = [];

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
        normalizeList(el, "bullet", blocks, state);
        continue;
      }
      if (tag === "ol") {
        normalizeList(el, "ordered", blocks, state);
        continue;
      }
      if (tag === "table") {
        for (const row of Array.from(el.querySelectorAll("tr"))) {
          const cells = Array.from(row.children).map((cell) => cellText(cell as Element));
          blocks.push({ type: "paragraph", textRuns: [{ text: cells.join("\t"), bold: false, italic: false }] });
        }
        continue;
      }
      if (tag === "p" || tag === "h1" || tag === "h2" || tag === "div") {
        pushBlockWithBr(el, tag === "h1" || tag === "h2" ? "heading" : "paragraph", tag === "h1" ? 1 : tag === "h2" ? 2 : undefined, blocks, state);
        continue;
      }
      // 其它元素按普通容器透明降级
      walk(el);
    }
  };

  const doc = parser(html);
  walk(doc.body);

  return { blocks, hasImage: state.hasImage, hasUnknownVisibleEmbed: state.hasUnknownVisibleEmbed };
}

// ---------------------------------------------------------------------------
// 归一化块 → 结构化文档 与 粘贴决策（纯逻辑）
// ---------------------------------------------------------------------------

function textRunsToContent(runs: TextRun[]): unknown[] | undefined {
  const merged: TextRun[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.bold === run.bold && prev.italic === run.italic) {
      prev.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  if (merged.length === 0) return undefined;
  return merged.map((run) => {
    const node: { type: string; text: string; marks?: { type: string }[] } = { type: "text", text: run.text };
    if (run.bold || run.italic) {
      node.marks = [];
      if (run.bold) node.marks.push({ type: "bold" });
      if (run.italic) node.marks.push({ type: "italic" });
    }
    return node;
  });
}

function blockToParagraphNode(block: ParsedBlock): { type: "paragraph"; content?: unknown[] } {
  const content = textRunsToContent(block.textRuns);
  return content ? { type: "paragraph", content } : { type: "paragraph" };
}

function blockToNode(block: ParsedBlock): unknown {
  if (block.type === "heading") {
    const content = textRunsToContent(block.textRuns);
    return content
      ? { type: "heading", attrs: { level: block.level ?? 1 }, content }
      : { type: "heading", attrs: { level: block.level ?? 1 } };
  }
  return blockToParagraphNode(block);
}

/** 把归一化块组装为结构化文档（连续同类列表项合并为列表，有序列表从 1 开始）。 */
export function blocksToDocument(blocks: ParsedBlock[]): { type: "doc"; content: unknown[] } {
  const content: unknown[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.listType) {
      const listType = block.listType;
      const items: unknown[] = [];
      while (i < blocks.length && blocks[i].listType === listType) {
        items.push({ type: "listItem", content: [blockToParagraphNode(blocks[i])] });
        i += 1;
      }
      content.push({
        type: listType === "bullet" ? "bulletList" : "orderedList",
        ...(listType === "ordered" ? { attrs: { start: 1 } } : {}),
        content: items,
      });
    } else {
      content.push(blockToNode(block));
      i += 1;
    }
  }
  return { type: "doc", content };
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

  const totalText = parsed.blocks.reduce(
    (sum, block) => sum + block.textRuns.reduce((t, run) => t + run.text.length, 0),
    0,
  );

  if (parsed.hasImage && totalText === 0) {
    return { kind: "nothing" };
  }

  if (plain === "" && parsed.hasUnknownVisibleEmbed) {
    return { kind: "reject", reason: "内容无法可靠提取，已取消粘贴" };
  }

  const document = blocksToDocument(parsed.blocks);

  if (plain !== "") {
    const projection = blocksToProjection(
      parsed.blocks.map((block) => block.textRuns.map((run) => run.text).join("")),
    );
    if (!compareHtmlAndPlain(projection, plain)) {
      return { kind: "reject", reason: "粘贴内容与纯文本不一致，已取消粘贴" };
    }
  }

  return { kind: "insert", document };
}



