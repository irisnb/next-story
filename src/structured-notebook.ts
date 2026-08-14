// 结构化本子文档：格式版本 1 的精确外层、grammar、严格校验与规范输出。
//
// 这是草稿本与正文本在磁盘上的唯一事实源契约。前端与 Rust 后端共享同一份
// 规范 / 非规范 JSON 样例（见 tests/fixtures/notebook-samples.json），确保
// 两侧对额外字段、空数组、marks、列表结构、孤立代理项和整数域范围的判定一致。

export const NOTEBOOK_FORMAT = "next-story-tiptap";
export const NOTEBOOK_VERSION = 1;
/** JavaScript 安全整数上限 2^53 - 1。 */
export const MAX_SAFE_INTEGER = 9007199254740991;

// ---------------------------------------------------------------------------
// 类型（格式版本 1 grammar 的精确形状）
// ---------------------------------------------------------------------------

export interface NotebookDocument {
  format: typeof NOTEBOOK_FORMAT;
  version: typeof NOTEBOOK_VERSION;
  document: DocNode;
}

export interface DocNode {
  type: "doc";
  content: BlockNode[];
}

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode;

export interface ParagraphNode {
  type: "paragraph";
  content?: TextNode[];
}

export interface HeadingNode {
  type: "heading";
  attrs: { level: 1 | 2 };
  content?: TextNode[];
}

export interface BulletListNode {
  type: "bulletList";
  content: ListItemNode[];
}

export interface OrderedListNode {
  type: "orderedList";
  attrs: { start: number };
  content: ListItemNode[];
}

export interface ListItemNode {
  type: "listItem";
  content: [ParagraphNode];
}

export interface TextNode {
  type: "text";
  text: string;
  marks?: Mark[];
}

export type Mark = { type: "bold" } | { type: "italic" };

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验对象键：不得含 allowed 之外的键，且 required 键必须全部存在。 */
function checkKeys(
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(value);
  if (!actual.every((key) => allowed.has(key))) return false;
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // 高位代理项：其后必须是低位代理项
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // 低位代理项未前接高位代理项
      return true;
    }
  }
  return false;
}

const MARK_RANK: Record<string, number> = { bold: 0, italic: 1 };

function sameMarkSet(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  return a.every((mark, index) => mark.type === b[index].type);
}

// ---------------------------------------------------------------------------
// 严格校验
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; document: NotebookDocument }
  | { ok: false; error: string };

function fail(error: string): ValidationResult {
  return { ok: false, error };
}

function validateMark(value: unknown, where: string): string | null {
  if (!isPlainObject(value)) return `${where}：mark 不是对象`;
  if (!checkKeys(value, ["type"])) return `${where}：mark 含额外或缺失字段`;
  if (value.type !== "bold" && value.type !== "italic") {
    return `${where}：不支持的行内标记`;
  }
  return null;
}

function validateMarks(value: unknown, where: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `${where}：marks 不是数组`;
  if (value.length === 0) return `${where}：marks 不能为空数组`;
  for (const [index, mark] of value.entries()) {
    const error = validateMark(mark, `${where} 第 ${index + 1} 个 mark`);
    if (error) return error;
  }
  // 去重 + 顺序（bold 在前 italic 在后）
  const types = value.map((mark) => (mark as { type: string }).type);
  if (new Set(types).size !== types.length) return `${where}：marks 重复`;
  for (let i = 1; i < types.length; i++) {
    if (MARK_RANK[types[i - 1]] >= MARK_RANK[types[i]]) {
      return `${where}：marks 顺序必须为 bold、italic`;
    }
  }
  return null;
}

function validateText(value: unknown, where: string): string | null {
  if (!isPlainObject(value)) return `${where}：text 不是对象`;
  if (!checkKeys(value, ["type", "text"], ["marks"])) {
    return `${where}：text 节点含额外或缺失字段`;
  }
  if (value.type !== "text") return `${where}：节点类型应为 text`;
  if (typeof value.text !== "string") return `${where}：text 缺少文字`;
  if (value.text.length === 0) return `${where}：text 不能为空字符串`;
  if (value.text.includes("\r") || value.text.includes("\n")) {
    return `${where}：text 不能包含 CR 或 LF`;
  }
  if (hasLoneSurrogate(value.text)) {
    return `${where}：text 不能包含孤立代理项`;
  }
  const marksError = validateMarks(value.marks, where);
  if (marksError) return marksError;
  return null;
}

/** 校验段落或标题的 content（只允许 text，且相邻同 marks 文本必须已合并）。 */
function validateInlineContent(value: unknown, where: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `${where}：content 不是数组`;
  if (value.length === 0) return `${where}：content 不能为空数组`;
  let previousMarks: Mark[] | undefined;
  for (const [index, node] of value.entries()) {
    const here = `${where} 第 ${index + 1} 个节点`;
    const error = validateText(node, here);
    if (error) return error;
    const marks = (node as { marks?: Mark[] }).marks;
    if (previousMarks !== undefined && sameMarkSet(previousMarks, marks)) {
      return `${where}：相同 marks 的相邻文本必须合并`;
    }
    previousMarks = marks;
  }
  return null;
}

function validateParagraph(value: unknown, where: string): string | null {
  if (!isPlainObject(value)) return `${where}：paragraph 不是对象`;
  if (!checkKeys(value, ["type"], ["content"])) {
    return `${where}：paragraph 含额外或缺失字段`;
  }
  if (value.type !== "paragraph") return `${where}：节点类型应为 paragraph`;
  return validateInlineContent(value.content, where);
}

function validateHeading(value: unknown, where: string): string | null {
  if (!isPlainObject(value)) return `${where}：heading 不是对象`;
  if (!checkKeys(value, ["type", "attrs"], ["content"])) {
    return `${where}：heading 含额外或缺失字段`;
  }
  if (value.type !== "heading") return `${where}：节点类型应为 heading`;
  if (!isPlainObject(value.attrs) || !checkKeys(value.attrs, ["level"])) {
    return `${where}：heading 的 attrs 应为恰好含 level`;
  }
  if (value.attrs.level !== 1 && value.attrs.level !== 2) {
    return `${where}：heading 等级只能为 1 或 2`;
  }
  return validateInlineContent(value.content, where);
}

function validateListItem(value: unknown, where: string): string | null {
  if (!isPlainObject(value)) return `${where}：listItem 不是对象`;
  if (!checkKeys(value, ["type", "content"])) {
    return `${where}：listItem 含额外或缺失字段`;
  }
  if (value.type !== "listItem") return `${where}：节点类型应为 listItem`;
  if (!Array.isArray(value.content) || value.content.length !== 1) {
    return `${where}：listItem 必须恰好包含一个 paragraph`;
  }
  return validateParagraph(value.content[0], `${where} 的 paragraph`);
}

function validateListItems(value: unknown, where: string): string | null {
  if (!Array.isArray(value)) return `${where}：content 不是数组`;
  if (value.length === 0) return `${where}：列表 content 不能为空`;
  for (const [index, item] of value.entries()) {
    const error = validateListItem(item, `${where} 第 ${index + 1} 个列表项`);
    if (error) return error;
  }
  return null;
}

function validateBulletList(value: unknown, where: string): string | null {
  if (!isPlainObject(value)) return `${where}：bulletList 不是对象`;
  if (!checkKeys(value, ["type", "content"])) {
    return `${where}：bulletList 含额外或缺失字段`;
  }
  if (value.type !== "bulletList") return `${where}：节点类型应为 bulletList`;
  return validateListItems(value.content, where);
}

function validateOrderedList(value: unknown, where: string): string | null {
  if (!isPlainObject(value)) return `${where}：orderedList 不是对象`;
  if (!checkKeys(value, ["type", "attrs", "content"])) {
    return `${where}：orderedList 含额外或缺失字段`;
  }
  if (value.type !== "orderedList") return `${where}：节点类型应为 orderedList`;
  if (!isPlainObject(value.attrs) || !checkKeys(value.attrs, ["start"])) {
    return `${where}：orderedList 的 attrs 应为恰好含 start`;
  }
  const start = value.attrs.start;
  if (typeof start !== "number" || !Number.isInteger(start)) {
    return `${where}：start 必须为整数`;
  }
  if (start < 1 || start > MAX_SAFE_INTEGER) {
    return `${where}：start 必须在 1 到 2^53-1 之间`;
  }
  const itemsError = validateListItems(value.content, where);
  if (itemsError) return itemsError;
  const count = (value.content as unknown[]).length;
  if (start + (count - 1) > MAX_SAFE_INTEGER) {
    return `${where}：列表实际编号超出安全整数范围`;
  }
  return null;
}

function validateDocNode(value: unknown): string | null {
  if (!isPlainObject(value)) return "document 不是对象";
  if (!checkKeys(value, ["type", "content"])) {
    return "document 含额外或缺失字段";
  }
  if (value.type !== "doc") return "document 节点类型应为 doc";
  if (!Array.isArray(value.content) || value.content.length === 0) {
    return "document.content 不能为空数组";
  }
  for (const [index, node] of value.content.entries()) {
    const here = `document 第 ${index + 1} 个块`;
    if (!isPlainObject(node)) return `${here} 不是对象`;
    switch (node.type) {
      case "paragraph": {
        const error = validateParagraph(node, here);
        if (error) return error;
        break;
      }
      case "heading": {
        const error = validateHeading(node, here);
        if (error) return error;
        break;
      }
      case "bulletList": {
        const error = validateBulletList(node, here);
        if (error) return error;
        break;
      }
      case "orderedList": {
        const error = validateOrderedList(node, here);
        if (error) return error;
        break;
      }
      default:
        return `${here}：不支持的节点类型 ${String(node.type)}`;
    }
  }
  return null;
}

export function validateNotebookDocument(value: unknown): ValidationResult {
  if (!isPlainObject(value)) return fail("本子不是 JSON 对象");
  if (!checkKeys(value, ["format", "version", "document"])) {
    return fail("本子外层字段不正确");
  }
  if (value.format !== NOTEBOOK_FORMAT) return fail("本子格式不受支持");
  if (value.version !== NOTEBOOK_VERSION) return fail("本子文档版本不受支持");
  const docError = validateDocNode(value.document);
  if (docError) return fail(docError);
  return { ok: true, document: value as unknown as NotebookDocument };
}

// ---------------------------------------------------------------------------
// 规范输出（从 Tiptap 的宽松 JSONContent 重建为严格规范形态）
// ---------------------------------------------------------------------------

/** 排序并去重 marks 为 bold、italic 顺序。 */
function canonicalMarks(raw: unknown): Mark[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const seen = new Set<string>();
  const marks: Mark[] = [];
  for (const mark of raw) {
    if (!isPlainObject(mark)) continue;
    if (mark.type !== "bold" && mark.type !== "italic") continue;
    if (seen.has(mark.type)) continue;
    seen.add(mark.type);
    marks.push({ type: mark.type });
  }
  marks.sort((a, b) => MARK_RANK[a.type] - MARK_RANK[b.type]);
  return marks.length > 0 ? marks : undefined;
}

/** 合并相邻同 marks 文本，规范化单个段落的 text 序列。 */
function canonicalTextNodes(rawContent: unknown): TextNode[] {
  if (!Array.isArray(rawContent)) return [];
  const merged: TextNode[] = [];
  for (const node of rawContent) {
    if (!isPlainObject(node) || node.type !== "text") continue;
    if (typeof node.text !== "string" || node.text.length === 0) continue;
    const marks = canonicalMarks(node.marks);
    const previous = merged[merged.length - 1];
    if (previous && sameMarkSet(previous.marks, marks)) {
      previous.text += node.text;
    } else {
      const textNode: TextNode = { type: "text", text: node.text };
      if (marks) textNode.marks = marks;
      merged.push(textNode);
    }
  }
  return merged;
}

function canonicalParagraph(raw: unknown): ParagraphNode {
  const node = isPlainObject(raw) ? raw : {};
  const content = canonicalTextNodes(node.content);
  const paragraph: ParagraphNode = { type: "paragraph" };
  if (content.length > 0) paragraph.content = content;
  return paragraph;
}

function canonicalHeading(raw: unknown): HeadingNode | null {
  if (!isPlainObject(raw)) return null;
  const level = isPlainObject(raw.attrs) ? raw.attrs.level : undefined;
  if (level !== 1 && level !== 2) return null;
  const content = canonicalTextNodes(raw.content);
  const heading: HeadingNode = { type: "heading", attrs: { level } };
  if (content.length > 0) heading.content = content;
  return heading;
}

function canonicalListItem(raw: unknown): ListItemNode | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.content) || raw.content.length === 0) {
    return null;
  }
  const paragraph = canonicalParagraph(raw.content[0]);
  return { type: "listItem", content: [paragraph] };
}

function canonicalBulletList(raw: unknown): BulletListNode | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.content)) return null;
  const content: ListItemNode[] = [];
  for (const item of raw.content) {
    const listItem = canonicalListItem(item);
    if (listItem) content.push(listItem);
  }
  if (content.length === 0) return null;
  return { type: "bulletList", content };
}

function canonicalOrderedList(raw: unknown): OrderedListNode | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.content)) return null;
  const start = isPlainObject(raw.attrs) ? raw.attrs.start : undefined;
  if (typeof start !== "number" || !Number.isInteger(start)) return null;
  if (start < 1 || start > MAX_SAFE_INTEGER) return null;
  const content: ListItemNode[] = [];
  for (const item of raw.content) {
    const listItem = canonicalListItem(item);
    if (listItem) content.push(listItem);
  }
  if (content.length === 0) return null;
  return { type: "orderedList", attrs: { start }, content };
}

function canonicalBlock(raw: unknown): BlockNode | null {
  if (!isPlainObject(raw)) return null;
  switch (raw.type) {
    case "paragraph":
      return canonicalParagraph(raw);
    case "heading":
      return canonicalHeading(raw);
    case "bulletList":
      return canonicalBulletList(raw);
    case "orderedList":
      return canonicalOrderedList(raw);
    default:
      return null;
  }
}

export function canonicalDoc(raw: unknown): DocNode {
  const content: BlockNode[] = [];
  if (isPlainObject(raw) && Array.isArray(raw.content)) {
    for (const node of raw.content) {
      const block = canonicalBlock(node);
      if (block) content.push(block);
    }
  }
  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

/** 从 Tiptap JSONContent 重建规范本子文档（含空块兜底）。 */
export function serializeNotebookDocument(rawDocument: unknown): NotebookDocument {
  return {
    format: NOTEBOOK_FORMAT,
    version: NOTEBOOK_VERSION,
    document: canonicalDoc(rawDocument),
  };
}

/** 生成稳定可比较的规范 JSON 字符串（保存状态与 IPC 使用）。 */
export function canonicalNotebookJson(rawDocument: unknown): string {
  return JSON.stringify(serializeNotebookDocument(rawDocument));
}

/** 新建本子时的合法最小空白文档。 */
export function emptyNotebookDocument(): NotebookDocument {
  return {
    format: NOTEBOOK_FORMAT,
    version: NOTEBOOK_VERSION,
    document: { type: "doc", content: [{ type: "paragraph" }] },
  };
}

/** 解析并校验来自后端的本子 JSON 字符串，失败时抛出中文错误。 */
export function parseNotebookDocumentJson(json: string): NotebookDocument {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("本子文件不是合法 JSON");
  }
  const result = validateNotebookDocument(value);
  if (!result.ok) throw new Error(result.error);
  return result.document;
}

// ---------------------------------------------------------------------------
// 结构化选区 → 纯文本切片（AI 冻结快照的唯一序列化规则）
// ---------------------------------------------------------------------------

/** 计算一个节点的 ProseMirror 尺寸（text 为文字长度，其余为 2 + 子内容长度）。 */
function nodeSize(node: unknown): number {
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return (n.text ?? "").length;
  let size = 2;
  for (const child of n.content ?? []) {
    size += nodeSize(child);
  }
  return size;
}

function inlineText(content: TextNode[] | undefined): string {
  return (content ?? []).map((textNode) => textNode.text).join("");
}

interface SelectionLine {
  /** 该块（或列表项）的起止位置。 */
  start: number;
  end: number;
  /** 可见文字的起止位置（marks 不占位置）。 */
  textStart: number;
  textEnd: number;
  /** 完整可见文字。 */
  text: string;
  /** 完整列表项时应使用的前缀（`- ` 或 `N. `），否则 null。 */
  prefix: string | null;
}

function collectLines(doc: DocNode): SelectionLine[] {
  const lines: SelectionLine[] = [];
  // ProseMirror 位置模型：doc 节点的开/闭 token 不计入位置，第一个 block 从 0 开始。
  let pos = 0;
  for (const block of doc.content) {
    const blockStart = pos;
    const blockEnd = pos + nodeSize(block);
    if (block.type === "paragraph" || block.type === "heading") {
      const text = inlineText(block.content);
      const textStart = blockStart + 1;
      lines.push({
        start: blockStart,
        end: blockEnd,
        textStart,
        textEnd: textStart + text.length,
        text,
        prefix: null,
      });
    } else if (block.type === "bulletList") {
      let itemPos = blockStart + 1;
      for (const item of block.content) {
        const itemEnd = itemPos + nodeSize(item);
        const text = inlineText(item.content[0].content);
        const textStart = itemPos + 2;
        lines.push({
          start: itemPos,
          end: itemEnd,
          textStart,
          textEnd: textStart + text.length,
          text,
          prefix: "- ",
        });
        itemPos = itemEnd;
      }
    } else {
      // orderedList
      let itemPos = blockStart + 1;
      let index = 0;
      for (const item of block.content) {
        const itemEnd = itemPos + nodeSize(item);
        const text = inlineText(item.content[0].content);
        const textStart = itemPos + 2;
        const number = block.attrs.start + index;
        lines.push({
          start: itemPos,
          end: itemEnd,
          textStart,
          textEnd: textStart + text.length,
          text,
          prefix: `${number}. `,
        });
        itemPos = itemEnd;
        index += 1;
      }
    }
    pos = blockEnd;
  }
  return lines;
}

/**
 * 把结构化文档中 `[from, to)` 的选区投影为唯一纯文本。
 *
 * 规则：单个 LF 表示相邻块边界；空段落/空列表项表示为空行；完整非空列表项
 * 添加 `- ` 或实际编号加 `. ` 前缀，部分列表项不加前缀；丢弃标题等级、粗体、
 * 斜体和 JSON 结构；不产生前导或尾随 LF。
 */
export function serializeSelectionToPlainText(
  doc: DocNode,
  from: number,
  to: number,
): string {
  if (from >= to) return "";
  const lines = collectLines(doc);
  const parts: string[] = [];
  for (const line of lines) {
    if (line.end <= from || line.start >= to) continue;
    const selStart = Math.max(line.textStart, from);
    const selEnd = Math.min(line.textEnd, to);
    const selectedText = selStart >= selEnd ? "" : line.text.slice(selStart - line.textStart, selEnd - line.textStart);
    const fullySelected = from <= line.textStart && to >= line.textEnd;
    if (line.prefix !== null && fullySelected && selectedText.length > 0) {
      parts.push(line.prefix + selectedText);
    } else {
      parts.push(selectedText);
    }
  }
  return parts.join("\n");
}
