import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 最大化几何合同（fix-ui-friction-2026-10 → frontend-ui-v5「最大化时讨论窗口头部贴边」）：
 * 760px 限宽居中只作用于讨论正文与输入区；头部不参与限宽（通栏、动作组钉在面板
 * 右缘），恢复常宽后行为一致（限宽规则一律以 .ai-panel-maximized 为前提）。
 */

/** 剥掉块注释后的样式表文本，避免说明注释干扰规则级断言。 */
const css = readFileSync(new URL("../src/ui-v5.css", import.meta.url), "utf8")
  .replace(/\/\*[^]*?\*\//g, "");

test("maximized measure keeps body and input at 760px centered", () => {
  assert.match(
    css,
    /\.ai-panel-maximized \.ai-window-body,\s*\.ai-panel-maximized \.ai-window-input\s*\{\s*width:\s*min\(100%,\s*760px\);\s*margin-inline:\s*auto;\s*\}/,
    "正文与输入区应保留 760px 限宽居中",
  );
});

test("maximized measure must not constrain the discussion head width", () => {
  // 头部不得出现在任何 760px 限宽规则的选择器里（否则动作组悬在 760px 列右缘）。
  assert.doesNotMatch(
    css,
    /[^{}]*\.ai-window-head[^{}]*\{[^}]*min\(100%,\s*760px\)/,
    "ai-window-head 不得被 760px 限宽覆盖（头部应通栏贴边）",
  );
});

test("restoring the side width leaves no residual head or column cap", () => {
  // 恢复常宽行为一致：所有 760px 限宽规则都以 .ai-panel-maximized 为前提，
  // 不存在常宽状态下仍生效的头部或正文/输入限宽残留。
  const capped = css.match(/[^{}]+\{[^}]*min\(100%,\s*760px\)[^}]*\}/g) ?? [];
  assert.ok(capped.length > 0, "应存在最大化限宽规则");
  for (const rule of capped) {
    const selector = rule.slice(0, rule.indexOf("{")).trim();
    assert.match(
      selector,
      /^\.ai-panel-maximized\b/,
      `760px 限宽必须限定在最大化状态内：${selector.slice(0, 80)}`,
    );
  }
});

test("head action group stays a non-shrinking cluster anchored to the head", () => {
  // 动作组不拆散：保持 flex 且不收缩、头部不换行——贴边后整组钉在面板右缘。
  assert.match(css, /\.ai-window-actions\s*\{[^}]*display:\s*flex;[^}]*flex:\s*none;/);
  assert.match(css, /\.ai-window-head\s*\{[^}]*flex-wrap:\s*nowrap;/);
});

test("tooltip ownership is separated: no data-tooltip writes, no blocking rules, shared tip reads data-hint", () => {
  // 提示所有权分离（fix-tooltip-rule-ownership D1，2026-10-30 结构修）：共享提示系统
  // 只读写自家 data-hint；全部代码路径不再向元素写入 data-tooltip（vendor Basecoat
  // 伪元素提示因此断粮，双提示根除）；样式表不得存在任何封锁/禁用伪元素的全局或
  // 局部规则（2026-10-28 全局封锁已删——它误杀了发送纹样与禁用态提示）。
  // 断言用「写入形态」精确匹配（dataset.tooltip 赋值、HTML 属性、CSS 选择器），
  // 不匹配说明注释里的字面提及。
  const sources = ["../src/ui-v5.ts", "../src/ai-dock.ts", "../src/dom.ts", "../src/ai-window.ts", "../index.html"];
  for (const file of sources) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(
      text,
      /\.dataset\.tooltip\b|setAttribute\(\s*["']data-tooltip["']|data-tooltip\s*=/,
      `${file} 不得再写入 data-tooltip（共享提示改用 data-hint）`,
    );
  }
  const allCss = ["../src/ui-v5.css", "../src/styles.css"].map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(
    allCss,
    /\[data-tooltip\][^{}]*::(?:before|after)\s*\{[^}]*display:\s*none/,
    "样式表不得存在封锁伪元素提示的规则（所有权分离后无需镇压）",
  );
  assert.match(
    readFileSync(new URL("../src/ui-v5.ts", import.meta.url), "utf8"),
    /dataset\.hint/,
    "共享提示应由 data-hint 驱动",
  );
});
