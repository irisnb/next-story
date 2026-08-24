import assert from "node:assert/strict";
import test from "node:test";

import { setupExportWord } from "../src/export-word.ts";
import type { ExportWordResult } from "../src/project-api.ts";

type Listener = () => void;

class FakeClassList {
  private readonly values = new Set<string>();
  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
  toggle(value: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(value);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  private readonly listeners = new Map<string, Listener[]>();
  textContent = "";
  disabled = false;

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }
}

function makeDom(): { btnExportWord: HTMLButtonElement; raw: FakeElement } {
  const raw = new FakeElement();
  raw.textContent = "导出 Word";
  return { btnExportWord: raw as unknown as HTMLButtonElement, raw };
}

/** 等待可观察状态出现；导出链跨越多个微任务，不能靠固定次数的硬等。 */
async function flushUntil(predicate: () => boolean, maxTicks = 60): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("flushUntil timed out");
}

function installAlert(): { alerts: string[]; restore(): void } {
  const alerts: string[] = [];
  const previous = globalThis.alert;
  globalThis.alert = (message?: unknown) => { alerts.push(String(message)); };
  return { alerts, restore: () => { globalThis.alert = previous; } };
}

test("无作品时不触发导出", async () => {
  const { btnExportWord } = makeDom();
  let called = false;
  setupExportWord({ btnExportWord }, {
    getProjectPath: () => null,
    getProjectName: () => null,
    hasUnsavedChanges: () => false,
    services: { exportProjectToWord: async () => { called = true; return { ok: true, path: "x", message: null }; } },
  });
  btnExportWord.click();
  await Promise.resolve();
  assert.equal(called, false);
});

test("导出成功提示目标位置并恢复按钮", async () => {
  const { btnExportWord } = makeDom();
  const alertBox = installAlert();
  let resolveExport!: (r: ExportWordResult) => void;
  const exportPromise = new Promise<ExportWordResult>((resolve) => { resolveExport = resolve; });

  setupExportWord({ btnExportWord }, {
    getProjectPath: () => "/作品/我的剧本",
    getProjectName: () => "我的剧本",
    hasUnsavedChanges: () => false,
    services: { exportProjectToWord: () => exportPromise },
  });

  btnExportWord.click();
  assert.equal(btnExportWord.disabled, true, "导出中应禁用按钮");
  assert.equal(btnExportWord.textContent, "导出中...");

  resolveExport({ ok: true, path: "/导出/我的剧本.docx", message: null });
  await flushUntil(() => !btnExportWord.disabled);

  assert.equal(btnExportWord.disabled, false);
  assert.equal(btnExportWord.textContent, "导出 Word");
  assert.deepEqual(alertBox.alerts, ["导出成功：/导出/我的剧本.docx"]);
  alertBox.restore();
});

test("用户取消不显示错误", async () => {
  const { btnExportWord } = makeDom();
  const alertBox = installAlert();

  setupExportWord({ btnExportWord }, {
    getProjectPath: () => "/作品/我的剧本",
    getProjectName: () => "我的剧本",
    hasUnsavedChanges: () => false,
    services: {
      exportProjectToWord: async () => ({ ok: false, cancelled: true, path: null, message: null }),
    },
  });

  btnExportWord.click();
  await flushUntil(() => !btnExportWord.disabled);
  assert.deepEqual(alertBox.alerts, [], "取消不应显示错误");
  alertBox.restore();
});

test("导出失败显示中文说明", async () => {
  const { btnExportWord } = makeDom();
  const alertBox = installAlert();

  setupExportWord({ btnExportWord }, {
    getProjectPath: () => "/作品/我的剧本",
    getProjectName: () => "我的剧本",
    hasUnsavedChanges: () => false,
    services: {
      exportProjectToWord: async () => ({ ok: false, path: null, message: "写入目标文件失败" }),
    },
  });

  btnExportWord.click();
  await flushUntil(() => !btnExportWord.disabled);
  assert.deepEqual(alertBox.alerts, ["导出失败：写入目标文件失败"]);
  alertBox.restore();
});

test("有未保存修改时先提示导出基于已保存版本", async () => {
  const { btnExportWord } = makeDom();
  const alertBox = installAlert();
  let resolveExport!: (r: ExportWordResult) => void;
  const exportPromise = new Promise<ExportWordResult>((resolve) => { resolveExport = resolve; });

  setupExportWord({ btnExportWord }, {
    getProjectPath: () => "/作品/我的剧本",
    getProjectName: () => "我的剧本",
    hasUnsavedChanges: () => true,
    services: { exportProjectToWord: () => exportPromise },
  });

  btnExportWord.click();
  await flushUntil(() => alertBox.alerts.length === 1);
  assert.match(alertBox.alerts[0], /已保存版本/);

  resolveExport({ ok: true, path: "/导出/out.docx", message: null });
  await flushUntil(() => !btnExportWord.disabled);
  assert.equal(alertBox.alerts.length, 2, "提示后仍继续导出并显示成功");
  alertBox.restore();
});

test("导出中防重复触发", async () => {
  const { btnExportWord } = makeDom();
  const alertBox = installAlert();
  let resolveExport!: (r: ExportWordResult) => void;
  const exportPromise = new Promise<ExportWordResult>((resolve) => { resolveExport = resolve; });
  let calls = 0;

  setupExportWord({ btnExportWord }, {
    getProjectPath: () => "/作品/我的剧本",
    getProjectName: () => "我的剧本",
    hasUnsavedChanges: () => false,
    services: {
      exportProjectToWord: () => { calls += 1; return exportPromise; },
    },
  });

  btnExportWord.click();
  btnExportWord.click();
  btnExportWord.click();
  await Promise.resolve();
  assert.equal(calls, 1, "导出中重复点击不应再次触发");

  resolveExport({ ok: true, path: "/导出/out.docx", message: null });
  await flushUntil(() => !btnExportWord.disabled);
  assert.equal(calls, 1);
  alertBox.restore();
});