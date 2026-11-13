import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";

import { setupHelpUpdateEntry } from "../src/help-section.ts";

/**
 * 帮助分区更新入口（add-auto-updater 任务 4.4）的规格测试：
 * - index.html：检查更新入口（form-help＋btn-secondary 模式）、版本号行、状态行、
 *   summary 层「有新版」轻量标记（收起态可见）、抽屉摘要文案更新；
 * - setupHelpUpdateEntry：入口点击回调、版本号渲染（含未知回退）、
 *   标记呈现、状态文本联动与入口按钮身份切换（检查更新／重启安装更新）。
 */

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

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
  updateBadge.className = "help-update-badge hidden";
  return {
    checkUpdateBtn: checkUpdateBtn as unknown as HTMLButtonElement,
    updateStatus: updateStatus as unknown as HTMLElement,
    versionText: versionText as unknown as HTMLElement,
    updateBadge: updateBadge as unknown as HTMLElement,
  };
}

// ========== index.html 结构（任务 4.1） ==========

test("index.html：帮助分区含「检查更新」按钮（form-help＋btn-secondary 既有模式）", () => {
  assert.match(
    html,
    /<p class="form-help">[^<]*<\/p>\s*<button id="btn-check-update" class="btn-secondary" type="button">检查更新<\/button>/,
    "检查更新沿用 p.form-help 说明＋btn-secondary 按钮模式",
  );
  assert.match(html, /\bid="help-version"/, "当前版本号显示行存在");
  assert.match(html, /\bid="help-update-status"/, "更新状态行存在");
});

test("index.html：抽屉摘要文案更新为含「查看版本、检查更新」", () => {
  const drawerStart = html.indexOf("settings-help");
  const drawerEnd = html.indexOf("</details>", drawerStart);
  const drawer = html.slice(drawerStart, drawerEnd);
  assert.ok(drawerStart >= 0, "帮助分区抽屉存在");
  assert.match(drawer, /查看版本、检查更新/, "摘要文案覆盖更新能力");
});

test("index.html：「有新版」标记位于 summary 层（收起态可见）且默认隐藏", () => {
  const drawerStart = html.indexOf("settings-help");
  const drawerEnd = html.indexOf("</details>", drawerStart);
  const drawer = html.slice(drawerStart, drawerEnd);
  const summary = drawer.match(/<summary[^>]*>[\s\S]*?<\/summary>/);
  assert.ok(summary, "帮助抽屉有 summary");
  assert.match(summary[0], /\bid="help-update-badge"/, "标记在 summary 内（展开前可见）");
  assert.match(summary[0], /class="[^"]*hidden[^"]*"/, "标记默认隐藏");
  assert.match(summary[0], />有新版</, "标记文案「有新版」");
  assert.match(summary[0], /data-hint=/, "悬停提示用共享提示的 data-hint");
});

// ========== setupHelpUpdateEntry 行为（任务 4.3/4.4） ==========

test("入口回调：点击「检查更新」逐次调用 openUpdate", async () => {
  const window = new Window();
  try {
    const dom = buildEntryDom(window);
    let opened = 0;
    const entry = setupHelpUpdateEntry(dom, { openUpdate: () => { opened += 1; } });
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
    const entry = setupHelpUpdateEntry(dom, { openUpdate: () => {} });
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
    const entry = setupHelpUpdateEntry(dom, { openUpdate: () => {} });
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
    const entry = setupHelpUpdateEntry(dom, { openUpdate: () => {} });
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
    const entry = setupHelpUpdateEntry(dom, { openUpdate: () => {} });
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
