// add-list-numbering-formats 真机验收：磁盘级核对（落盘 notebook）
// 断言：字数 1,141 / 字母列表 type=A 且 start 1,2,3 / 符号 / 字体 / 行距 / 全序列仅 SYM01 一处差异
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:\\Users\\Administrator\\Desktop\\test\\编号复验-20261005";
const OUT = "D:\\Next Story\\本地测试文档\\导入冒烟证据\\编号-20261005";
const OLD = "D:\\Next Story\\openspec\\changes\\archive\\2026-10-03-verify-import-fidelity-ui\\verification\\evidence-docx\\first-extraction.json";

const docsDir = join(ROOT, "作品文本", "documents");
const files = readdirSync(docsDir).filter((f) => f.endsWith(".json"));
const recText = (node) => (node.type === "text" ? node.text ?? "" : (node.content ?? []).map(recText).join(""));
let found = null;
for (const f of files) {
  const val = JSON.parse(readFileSync(join(docsDir, f), "utf8"));
  const content = val.document?.content ?? [];
  if (content.some((b) => recText(b).includes("SYM01"))) {
    found = { f, content, mtime: statSync(join(docsDir, f)).mtime.toISOString() };
    break;
  }
}
if (!found) {
  console.log("NO-SYM01-DOC");
  process.exit(1);
}
const { f, content, mtime } = found;
const blocks = content;
const fullText = blocks.map(recText).join("");
const charCount = [...fullText].length;
const symbolsOk = ["\u{2714}", "\u{1F5F6}", "\u{03BB}", "\u{2022}", "\u{25AA}"].every((c) => fullText.includes(c));
const noOldValues = !["\u{2713}", "\u{2717}", "\u{25CF}"].some((c) => fullText.includes(c));

// 有序列表清单（含嵌套）：样式 / start / 首项文本
const lists = [];
const walk = (node) => {
  if (node.type === "orderedList") {
    const items = (node.content ?? []).map((li) => (li.content ?? []).map(recText).join(""));
    lists.push({ type: node.attrs?.type ?? "1", start: node.attrs?.start ?? 1, items });
  }
  for (const child of node.content ?? []) walk(child);
};
for (const b of blocks) walk(b);
const alpha = lists.filter((l) => l.type === "A");
const alphaOk =
  alpha.length >= 3 &&
  alpha.some((l) => l.start === 1 && l.items.some((t) => t.includes("C02"))) &&
  alpha.some((l) => l.start === 2 && l.items.some((t) => t.includes("C04"))) &&
  alpha.some((l) => l.start === 3 && l.items.some((t) => t.includes("C08")));

const findRun = (needle) => {
  const stack = [...blocks];
  while (stack.length) {
    const n = stack.shift();
    if (n.type === "text" && (n.text ?? "").includes(needle)) return n;
    if (n.content) stack.push(...n.content);
  }
  return null;
};
const fontOf = (node) => ((node?.marks ?? []).find((m) => m.type === "textStyle")?.attrs?.fontFamily ?? null);
const latin = findRun("A03 AcceptanceBase expects");
const cjk = findRun("中文运行保持原样");
const paraByText = (needle) => blocks.find((b) => recText(b).includes(needle));
const p3 = paraByText("A03 AcceptanceBase");
const p1 = paraByText("BEGIN marker paragraph A01");

console.log("notebook:", f, " mtime:", mtime);
console.log("blockCount:", blocks.length, " charCount:", charCount, " symbolsOk:", symbolsOk, " noOldValues:", noOldValues);
console.log("ordered-lists(", lists.length, "):", JSON.stringify(lists.map((l) => ({ type: l.type, start: l.start }))));
console.log("alpha(type=A):", JSON.stringify(alpha.map((l) => ({ start: l.start, first: l.items[0]?.slice(0, 28) }))), " alphaOk:", alphaOk);
console.log("latinFont:", fontOf(latin), " cjkFont:", fontOf(cjk), " p1.lineHeight:", p1?.attrs?.lineHeight, " p3.lineHeight:", p3?.attrs?.lineHeight);

// 全序列与归档比对（文本投影；预期仅 SYM01 一处）
const oldExtract = JSON.parse(readFileSync(OLD, "utf8"));
const oldTexts = oldExtract.docStruct.blocks.map((b) =>
  b.text !== undefined ? b.text : (b.children ?? []).map((li) => (li.children ?? []).map((p) => p.text ?? "").join("")).join("\n"),
);
const newTexts = blocks.map((b) =>
  b.type === "orderedList" || b.type === "bulletList"
    ? (b.content ?? []).map((li) => (li.content ?? []).map(recText).join("")).join("\n")
    : recText(b),
);
const diffs = [];
for (let i = 0; i < Math.max(oldTexts.length, newTexts.length); i++) {
  if (oldTexts[i] !== newTexts[i]) diffs.push(i);
}
console.log("seq: old", oldTexts.length, "new", newTexts.length, "diff-indexes:", JSON.stringify(diffs));

writeFileSync(
  join(OUT, "persisted-after.json"),
  JSON.stringify({ file: f, blockCount: blocks.length, charCount, symbolsOk, noOldValues, alphaOk, alpha, latinFont: fontOf(latin), cjkFont: fontOf(cjk), p1LineHeight: p1?.attrs?.lineHeight ?? null, p3LineHeight: p3?.attrs?.lineHeight ?? null, diffIndexes: diffs }, null, 2),
  "utf8",
);
process.exit(0);
