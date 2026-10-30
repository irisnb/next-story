import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

test("approved send PNG bytes and intrinsic ratio remain unchanged", () => {
  const png = readFileSync(new URL("../src/assets/user-mark.png", import.meta.url));
  assert.equal(createHash("sha256").update(png).digest("hex"), "b8296fa14dc2f9c3e889e9dcd9d8677be1fc9ada57b1f46edfea2ed7dd8a9d96");
  assert.equal(png.readUInt32BE(16), 988);
  assert.equal(png.readUInt32BE(20), 789);
});

test("send actions carry a real img pattern plus a visually hidden accessible name", () => {
  // fix-tooltip-rule-ownership D2：纹样从 ::after 伪元素背景改为按钮内真实 <img>，
  // 对任何作用于伪元素的 CSS 全局规则免疫；功能名文字保留（派生 aria-label/data-hint），
  // 视觉隐藏不改几何。
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/ui-v5.css", import.meta.url), "utf8");
  const sends: Array<[string, RegExp, string]> = [
    ["follow-up-send", /<button[^>]*data-role="follow-up-send"[^>]*aria-label="发送"[^>]*type="submit"[^>]*disabled/, "追问发送"],
    ["direct-question-send", /<button[^>]*data-role="direct-question-send"[^>]*aria-label="提问"[^>]*type="submit"[^>]*disabled/, "直接提问"],
  ];
  for (const [role, buttonPattern, label] of sends) {
    assert.match(html, buttonPattern, `${label}按钮合同保持（aria-label 与禁用初始态）`);
    const button = html.match(new RegExp(`<button[^>]*data-role="${role}"[^>]*>`))![0];
    const body = html.slice(html.indexOf(button) + button.length, html.indexOf("</button>", html.indexOf(button)));
    assert.match(
      body,
      /<img src="src\/assets\/user-mark\.png" alt="" aria-hidden="true">/,
      `${label}按钮内嵌真实 img（同一 user-mark.png）`,
    );
    assert.match(body, /<span class="ai-send-label">(发送|提问)<\/span>/, `${label}按钮保留功能名文字节点`);
  }
  // 制作对话发送按钮（无 data-role，按 id 定位）同款结构。
  const making = html.match(/<button id="making-conversation-send"[^>]*>/)![0];
  const makingBody = html.slice(html.indexOf(making) + making.length, html.indexOf("</button>", html.indexOf(making)));
  assert.match(makingBody, /<img src="src\/assets\/user-mark\.png" alt="" aria-hidden="true">/);
  assert.match(makingBody, /<span class="ai-send-label">发送<\/span>/);
  // CSS：img 定宽 28px、比例 988/789、反色；伪元素方案（font-size:0 与 ::after 背景）已退场。
  assert.match(css, /\.ai-send-mark img\s*\{[^}]*width:\s*28px;[^}]*height:\s*auto;[^}]*aspect-ratio:\s*988\s*\/\s*789;[^}]*filter:\s*invert\(1\);/);
  assert.match(css, /\.ai-send-mark:disabled img\s*\{[^}]*filter:\s*none;[^}]*opacity:\s*\.45;/);
  assert.doesNotMatch(css, /\.ai-send-mark::after/, "纹样不得再依赖伪元素背景");
  assert.doesNotMatch(css, /\.ai-send-mark\s*\{[^}]*font-size:\s*0/, "font-size:0 随伪元素方案移除");
  assert.match(css, /\.ai-send-mark:focus-visible\s*\{[^}]*outline:\s*2px/, "焦点合同保持");
  assert.match(css, /\.ai-send-mark:disabled\s*\{[^}]*background:\s*#e4e4e4/, "禁用灰底合同保持");
});
