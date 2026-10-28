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

test("basecoat pseudo tooltips stay globally suppressed (shared tip is the only tooltip)", () => {
  // 2026-10-28 验收：最大化/恢复按钮悬停出现两个黑色提示（Basecoat ::before 在上＋
  // 共享 #ui-tooltip 在下）。共享提示独占全部提示；Basecoat 伪元素全局关闭，带
  // !important 保证对 vendor 样式表的决定性（不受加载顺序影响）。
  assert.match(
    css,
    /\[data-tooltip\]::before,\s*\[data-tooltip\]::after\s*\{\s*display:\s*none\s*!important;\s*\}/,
    "Basecoat 伪元素提示应全局关闭（display:none !important）",
  );
});
