// fix-docx-fidelity-residuals 真机验收：磁盘级核对
// 读导入文档的落盘 notebook → 符号/字体/行距断言 → 与归档 first-extraction 全序列比对
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:\\Users\\Administrator\\Desktop\\test\\保真复验-20261004";
const OUT = "D:\\Next Story\\本地测试文档\\导入冒烟证据\\保真-20261004";
const OLD = "D:\\Next Story\\openspec\\changes\\archive\\2026-10-03-verify-import-fidelity-ui\\verification\\evidence-docx\\first-extraction.json";

const docsDir = join(ROOT, "\u4f5c\u54c1\u6587\u672c", "documents");
const files = readdirSync(docsDir).filter((f) => f.endsWith(".json"));
console.log("docs:", JSON.stringify(files));

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

const symbolsOk =
  fullText.includes("\u{2714}") &&
  fullText.includes("\u{1F5F6}") &&
  fullText.includes("\u{03BB}") &&
  fullText.includes("\u{2022}") &&
  fullText.includes("\u{25AA}");
const noOldValues = !fullText.includes("\u{2713}") && !fullText.includes("\u{2717}") && !fullText.includes("\u{25CF}");

const findRun = (needle) => {
  const stack = [...blocks];
  while (stack.length) {
    const n = stack.shift();
    if (n.type === "text" && (n.text ?? "").includes(needle)) return n;
    if (n.content) stack.push(...n.content);
  }
  return null;
};
const fontOf = (node) => {
  const ts = (node?.marks ?? []).find((m) => m.type === "textStyle");
  return ts?.attrs?.fontFamily ?? null;
};
const latin = findRun("A03 AcceptanceBase expects");
const cjk = findRun("\u4e2d\u6587\u8fd0\u884c\u4fdd\u6301\u539f\u6837");
const paraByText = (needle) => blocks.find((b) => recText(b).includes(needle));
const p3 = paraByText("A03 AcceptanceBase");
const p7 = paraByText("SYM01");
const p1 = paraByText("BEGIN marker paragraph A01");

console.log("blockCount:", blocks.length);
console.log("charCount:", charCount);
console.log("symbolsOk:", symbolsOk, " noOldValues:", noOldValues);
console.log("latinFont:", fontOf(latin), " cjkFont:", fontOf(cjk));
console.log("p1.lineHeight:", p1?.attrs?.lineHeight, " p3.lineHeight:", p3?.attrs?.lineHeight, " p3.spacingAfter:", p3?.attrs?.spacingAfter, " p7.lineHeight:", p7?.attrs?.lineHeight);
console.log("notebook:", f, " mtime:", mtime);

// 与归档 first-extraction 全序列比对
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
  if (oldTexts[i] !== newTexts[i]) diffs.push({ index: i, old: oldTexts[i], new: newTexts[i] });
}
console.log("oldBlockCount:", oldTexts.length, " newBlockCount:", newTexts.length);
console.log("diffs:", JSON.stringify(diffs, null, 1));

writeFileSync(
  join(OUT, "persisted-after.json"),
  JSON.stringify({ file: f, blockCount: blocks.length, charCount, symbolsOk, noOldValues, latinFont: fontOf(latin), cjkFont: fontOf(cjk), p1LineHeight: p1?.attrs?.lineHeight ?? null, p3LineHeight: p3?.attrs?.lineHeight ?? null, p7LineHeight: p7?.attrs?.lineHeight ?? null, diffsVsOld: diffs.length }, null, 2),
  "utf8",
);
process.exit(0);
