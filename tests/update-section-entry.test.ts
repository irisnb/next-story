import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";

import { setupUpdateEntry } from "../src/update-section.ts";

/**
 * 设置页「软件更新」分区入口（standalone-update-drawer；原 add-auto-updater 帮助分区入口
 * 迁出独立抽屉）的规格测试：
 * - index.html：第四抽屉位于「帮助」之后；检查更新入口（form-help＋btn-secondary 模式）、
 *   版本号行、状态行、summary 层「有新版」轻量标记（收起态可见）在整个设置页各恰一次、
 *   不残留于帮助分区；帮助摘要回退为「重看软件引导，翻常见问题。」；
 * - setupUpdateEntry：入口点击回调、版本号渲染（含未知回退）、
 *   标记呈现、状态文本联动与入口按钮身份切换（检查更新／重启安装更新）。
 */

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

/** 切出整个设置模块的 HTML（module-settings 起至制作模块前）。 */
const settingsStart = html.indexOf('<section id="module-settings"');
const settingsEnd = html.indexOf('id="module-making"');
assert.ok(settingsStart >= 0 && settingsEnd > settingsStart, "设置模块与制作模块边界存在");
const settingsHtml = html.slice(settingsStart, settingsEnd);

/** 切出指定设置分区（按 aria-label）的完整 HTML 段（含 summary 与 body）。 */
function sectionHtml(label: string): string {
  const start = settingsHtml.indexOf(`aria-label="${label}"`);
  assert.ok(start >= 0, `设置分区「${label}」存在`);
  return settingsHtml.slice(start, settingsHtml.indexOf("</section>", start));
}

function countOccurrences(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

interface EntryDom {
  checkUpdateBtn: HTMLButtonElement;
  updateStatus: HTMLElement;
  versionText: HTMLElement;
  updateBadge: HTMLElement;
}

function buildEntryDom(window: Window): EntryDom {
  const checkUpdateBtn = window.document.createElement("button");
  checkUpdateBtn.textContent = "检查更新";
  const updateStatus = window.document.createElement("p");
  updateStatus.className = "hidden";
  const versionText = window.document.createElement("p");
  const updateBadge = window.document.createElement("span");
  updateBadge.className = "update-badge hidden";
  return {
    checkUpdateBtn: checkUpdateBtn as unknown as HTMLButtonElement,
    updateStatus: updateStatus as unknown as HTMLElement,
    versionText: versionText as unknown as HTMLElement,
    updateBadge: updateBadge as unknown as HTMLElement,
  };
}

// ========== index.html 结构（standalone-update-drawer design D1/D2） ==========

test("index.html：设置页恰四个主抽屉，「软件更新」第四、位于「帮助」之后", () => {
  const drawers = [...settingsHtml.matchAll(/<details\b[^>]*class="[^"]*\bsettings-drawer\b[^"]*"/g)].map((m) => m.index);
  assert.equal(drawers.length, 4, "四个主抽屉：API 连接／写作显示／帮助／软件更新");
  const helpSection = settingsHtml.indexOf('aria-label="帮助"');
  const updateSection = settingsHtml.indexOf('aria-label="软件更新"');
  assert.ok(helpSection >= 0, "帮助分区存在");
  assert.ok(updateSection > helpSection, "软件更新分区位于帮助之后");
  assert.ok(drawers[3]! > updateSection, "第四个抽屉属于软件更新分区");
  assert.ok(drawers[2]! > helpSection && drawers[2]! < updateSection, "第三个抽屉属于帮助分区");
});

test("index.html：「软件更新」分区含「检查更新」按钮（form-help＋btn-secondary 既有模式）", () => {
  const section = sectionHtml("软件更新");
  assert.match(
    section,
    /<p class="form-help">[^<]*<\/p>\s*<button id="btn-check-update" class="btn-secondary" type="button">检查更新<\/button>/,
    "检查更新沿用 p.form-help 说明＋btn-secondary 按钮模式",
  );
  assert.match(section, /\bid="update-version"/, "当前版本号显示行存在");
  assert.match(section, /\bid="update-status"/, "更新状态行存在");
});

test("index.html：「有新版」标记位于「软件更新」summary 层（收起态可见）且默认隐藏", () => {
  const section = sectionHtml("软件更新");
  const summary = section.match(/<summary[^>]*>[\s\S]*?<\/summary>/);
  assert.ok(summary, "软件更新分区有 summary");
  assert.match(summary[0], /\bid="update-badge"/, "标记在 summary 内（展开前可见）");
  assert.match(summary[0], /class="[^"]*hidden[^"]*"/, "标记默认隐藏");
  assert.match(summary[0], />有新版</, "标记文案「有新版」");
  assert.match(summary[0], /data-hint="有新版本可用，展开软件更新分区查看详情"/, "悬停提示指向软件更新分区");
});

test("index.html：帮助摘要回退为「重看软件引导，翻常见问题。」", () => {
  const drawerStart = settingsHtml.indexOf("settings-help");
  const drawerEnd = settingsHtml.indexOf("</details>", drawerStart);
  assert.ok(drawerStart >= 0, "帮助分区抽屉存在");
  const drawer = settingsHtml.slice(drawerStart, drawerEnd);
  const summary = drawer.match(/<summary[^>]*>[\s\S]*?<\/summary>/);
  assert.ok(summary, "帮助抽屉有 summary");
  assert.match(summary[0], /重看软件引导，翻常见问题。/, "描述不再提版本与检查更新");
});

test("index.html：帮助分区（整体）不再含任何更新入口元素", () => {
  const help = sectionHtml("帮助");
  assert.doesNotMatch(help, /\bid="btn-check-update"/, "无检查更新按钮");
  assert.doesNotMatch(help, /\bid="update-version"/, "无版本号行");
  assert.doesNotMatch(help, /\bid="update-status"/, "无状态行");
  assert.doesNotMatch(help, /\bid="update-badge"/, "无「有新版」标记");
  assert.doesNotMatch(help, /update-badge|update-section/, "无更新相关 class 残留");
});

test("index.html：更新四元素在整个设置页各恰出现一次（搬出而非复制）", () => {
  assert.equal(countOccurrences(settingsHtml, /\bid="btn-check-update"/g), 1, "检查更新按钮恰一次");
  assert.equal(countOccurrences(settingsHtml, /\bid="update-status"/g), 1, "更新状态行恰一次");
  assert.equal(countOccurrences(settingsHtml, /\bid="update-version"/g), 1, "版本号行恰一次");
  assert.equal(countOccurrences(settingsHtml, /\bid="update-badge"/g), 1, "「有新版」标记恰一次");
});

// ========== setupUpdateEntry 行为（任务 4.3/4.4，standalone-update-drawer 原样迁移） ==========

test("入口回调：点击「检查更新」逐次调用 openUpdate", async () => {
  const window = new Window();
  try {
    const dom = buildEntryDom(window);
    let opened = 0;
    const entry = setupUpdateEntry(dom, { openUpdate: () => { opened += 1; } });
    void entry;
    dom.checkUpdateBtn.click();
    dom.checkUpdateBtn.click();
    assert.equal(opened, 2, "每次点击都打开更新流程");
  } finally {
    await window.happyDOM.abort();
  }
});

test("版本号渲染：如实显示；空／null 回退「当前版本未知」", async () => {
  const window = new Window();
  try {
    const dom = buildEntryDom(window);
    const entry = setupUpdateEntry(dom, { openUpdate: () => {} });
    entry.renderVersion("0.1.2");
    assert.equal(dom.versionText.textContent, "当前版本 0.1.2", "与应用实际构建版本一致");
    entry.renderVersion("  0.2.0  ");
    assert.equal(dom.versionText.textContent, "当前版本 0.2.0", "去除首尾空白");
    entry.renderVersion(null);
    assert.equal(dom.versionText.textContent, "当前版本未知", "取不到版本时如实说明");
    entry.renderVersion("");
    assert.equal(dom.versionText.textContent, "当前版本未知");
  } finally {
    await window.happyDOM.abort();
  }
});

test("更新标记：badge 控制「有新版」小标显隐", async () => {
  const window = new Window();
  try {
    const dom = buildEntryDom(window);
    const entry = setupUpdateEntry(dom, { openUpdate: () => {} });
    assert.equal(dom.updateBadge.classList.contains("hidden"), true, "初始无标记");
    entry.setUpdateView({ badge: true, statusText: "有新版本可用（0.2.1）", entryAction: "check" });
    assert.equal(dom.updateBadge.classList.contains("hidden"), false, "发现新版呈现标记");
    entry.setUpdateView({ badge: false, statusText: "已是最新版本", entryAction: "check" });
    assert.equal(dom.updateBadge.classList.contains("hidden"), true, "无更新隐藏标记");
  } finally {
    await window.happyDOM.abort();
  }
});

test("状态文本联动：非空显示、空串隐藏该行", async () => {
  const window = new Window();
  try {
    const dom = buildEntryDom(window);
    const entry = setupUpdateEntry(dom, { openUpdate: () => {} });
    entry.setUpdateView({ badge: false, statusText: "正在检查更新…", entryAction: "check" });
    assert.equal(dom.updateStatus.textContent, "正在检查更新…");
    assert.equal(dom.updateStatus.classList.contains("hidden"), false, "检查中状态可查看");
    entry.setUpdateView({ badge: false, statusText: "", entryAction: "check" });
    assert.equal(dom.updateStatus.textContent, "");
    assert.equal(dom.updateStatus.classList.contains("hidden"), true, "无状态时不占位");
  } finally {
    await window.happyDOM.abort();
  }
});

test("入口按钮身份：就绪后变「重启安装更新」，其余保持「检查更新」", async () => {
  const window = new Window();
  try {
    const dom = buildEntryDom(window);
    const entry = setupUpdateEntry(dom, { openUpdate: () => {} });
    entry.setUpdateView({ badge: false, statusText: "已是最新版本", entryAction: "check" });
    assert.equal(dom.checkUpdateBtn.textContent, "检查更新");
    entry.setUpdateView({ badge: true, statusText: "更新已就绪，可随时安装", entryAction: "install" });
    assert.equal(dom.checkUpdateBtn.textContent, "重启安装更新", "稍后入口可再入安装确认");
    entry.setUpdateView({ badge: true, statusText: "正在下载更新…", entryAction: "check" });
    assert.equal(dom.checkUpdateBtn.textContent, "检查更新");
  } finally {
    await window.happyDOM.abort();
  }
});
