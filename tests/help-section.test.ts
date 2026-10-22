import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Window } from "happy-dom";

import { HELP_FAQ_ITEMS } from "../src/help-faq-items.ts";
import { renderHelpFaqItems, setupHelpSection } from "../src/help-section.ts";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

/** design.md 附录 B 十一条问题定稿（逐字硬编码，防数据文件漂移）。 */
const EXPECTED_FAQ_QUESTIONS = [
  "界面四个标签各管什么？",
  "会自动保存吗？",
  "API 是什么？怎么获取？",
  "AI 怎么连？连不上怎么办？",
  "AI 怎么用？",
  "它到底看了我哪些东西？",
  "\"让我再读几篇\"是怎么回事？",
  "有没有它不能看的？",
  "AI 会改我的稿子吗？",
  "制作页怎么用？",
  "怎么重看软件引导？",
] as const;

test("FAQ 数据：恰好十一条且问题与附录 B 定稿逐字一致", () => {
  assert.equal(HELP_FAQ_ITEMS.length, 11);
  assert.deepEqual(
    HELP_FAQ_ITEMS.map((item) => item.question),
    [...EXPECTED_FAQ_QUESTIONS],
  );
});

test("FAQ 数据：每条答案非空", () => {
  for (const item of HELP_FAQ_ITEMS) {
    assert.ok(item.answer.trim().length > 0, `「${item.question}」答案非空`);
  }
});

test("FAQ 链接：仅 API 条目携带链接且全部为 https 官方地址", () => {
  for (const item of HELP_FAQ_ITEMS) {
    if (!item.links) continue;
    assert.equal(item.question, "API 是什么？怎么获取？", "只有 API 条目携带链接");
    assert.ok(item.links.length >= 6, "服务商链接至少六家");
    for (const link of item.links) {
      assert.match(link.url, /^https:\/\//, `「${link.label}」必须是 https 官方地址`);
      assert.ok(link.label.trim().length > 0);
    }
  }
});

test("DOM 契约：帮助分区 id、抽屉结构与「重看软件引导」按钮存在", () => {
  assert.match(html, /\bid="btn-replay-first-run-guide"/);
  assert.match(html, /\bid="help-faq-list"/);
  assert.match(
    html,
    /<button\b[^>]*\bid="btn-replay-first-run-guide"[^>]*>\s*重看软件引导\s*</,
    "重看按钮文字为「重看软件引导」",
  );
  // 帮助分区是默认收起的抽屉：包裹容器为不带 open 属性的 details。
  const helpDrawer = html.match(/<details\b[^>]*class="[^"]*settings-help[^"]*"[^>]*>/);
  assert.ok(helpDrawer, "帮助分区用 details 抽屉承载");
  assert.doesNotMatch(helpDrawer![0], /\bopen\b/, "帮助抽屉默认收起");
});

test("renderHelpFaqItems：渲染十一条可折叠 details，summary/answer 逐字对应", async () => {
  const window = new Window();
  try {
    const container = window.document.createElement("div");
    // happy-dom 元素与 lib.dom 类型分属两套声明，按仓库先例（leave-dialog-focus.test.ts）桥接。
    renderHelpFaqItems(container as unknown as HTMLElement, HELP_FAQ_ITEMS);
    const items = container.querySelectorAll("details.help-faq-item");
    assert.equal(items.length, 11);
    for (let i = 0; i < HELP_FAQ_ITEMS.length; i += 1) {
      const details = items[i];
      const summary = details.querySelector("summary");
      const answer = details.querySelector("div.help-faq-answer");
      assert.ok(summary, `第 ${i + 1} 条有 summary`);
      assert.ok(answer, `第 ${i + 1} 条有答案节点`);
      assert.equal(summary?.textContent, HELP_FAQ_ITEMS[i]!.question);
      assert.equal(answer?.textContent, HELP_FAQ_ITEMS[i]!.answer);
    }
    // 幂等：重复渲染不叠加。
    renderHelpFaqItems(container as unknown as HTMLElement, HELP_FAQ_ITEMS);
    assert.equal(container.querySelectorAll("details.help-faq-item").length, 11);
  } finally {
    await window.happyDOM.abort();
  }
});

test("renderHelpFaqItems：API 条目的官网链接渲染为新窗口锚点", async () => {
  const window = new Window();
  try {
    const container = window.document.createElement("div");
    renderHelpFaqItems(container as unknown as HTMLElement, HELP_FAQ_ITEMS);
    const apiItem = Array.from(container.querySelectorAll("details.help-faq-item")).find(
      (details) => details.querySelector("summary")?.textContent === "API 是什么？怎么获取？",
    );
    assert.ok(apiItem, "API 条目存在");
    const links = apiItem!.querySelectorAll("a.help-faq-link");
    const expected = HELP_FAQ_ITEMS[2]!.links!;
    assert.equal(links.length, expected.length);
    const first = links[0] as unknown as HTMLAnchorElement;
    assert.equal(first.getAttribute("href"), expected[0]!.url);
    assert.equal(first.getAttribute("target"), "_blank");
    assert.equal(first.getAttribute("rel"), "noopener noreferrer");
    assert.equal(first.textContent, expected[0]!.label);
  } finally {
    await window.happyDOM.abort();
  }
});

test("setupHelpSection：渲染十一条并接线「重看软件引导」入口", async () => {
  const window = new Window();
  try {
    const replayBtn = window.document.createElement("button");
    const faqList = window.document.createElement("div");
    let opened = 0;
    setupHelpSection(
      { replayBtn: replayBtn as unknown as HTMLButtonElement, faqList: faqList as unknown as HTMLElement },
      { openReplayGuide: () => { opened += 1; } },
    );
    assert.equal(faqList.querySelectorAll("details.help-faq-item").length, 11);
    replayBtn.click();
    replayBtn.click();
    assert.equal(opened, 2, "重看按钮每次点击都调用重放入口");
  } finally {
    await window.happyDOM.abort();
  }
});
