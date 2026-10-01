import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EXPORT_FORMAT,
  buildScopeOptions,
  scopeFromOptionValue,
  scopeIncludesCurrentDocument,
  setupExport,
  type ExportRequest,
} from "../src/export.ts";
import type { ExportFileResult } from "../src/project-api.ts";
import type { ContentTree, ContentTreeNode } from "../src/types.ts";

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
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }
}

/** 导出控制器只真实消费按钮；对话框阶段默认经注入替换，其余字段仅占位。 */
function makeDom(): { btnExport: HTMLButtonElement; raw: FakeElement } {
  const raw = new FakeElement();
  raw.textContent = "导出";
  return { btnExport: raw as unknown as HTMLButtonElement, raw };
}

function makeNode(
  id: string,
  name: string,
  kind: "Folder" | "Document",
  children: string[] = [],
): ContentTreeNode {
  return { id, name, kind, children };
}

function makeTree(): ContentTree {
  return {
    root_children: ["f1", "d3"],
    nodes: {
      f1: makeNode("f1", "第一卷", "Folder", ["d1", "f2"]),
      f2: makeNode("f2", "第二卷", "Folder", ["d2"]),
      d1: makeNode("d1", "小芳", "Document"),
      d2: makeNode("d2", "小刚", "Document"),
      d3: makeNode("d3", "序章", "Document"),
    },
    recycle_bin: [],
  };
}

/** 等待可观察状态出现；导出链跨多个微任务，不能靠固定次数硬等。 */
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

function okResult(path: string): ExportFileResult {
  return { ok: true, path, message: null };
}

// ---------------------------------------------------------------------------
// 纯函数：范围选项、默认值、范围是否包含当前文档
// ---------------------------------------------------------------------------

test("范围选项：默认当前文档，其后整个作品与按树序缩进的文件夹", () => {
  const options = buildScopeOptions(makeTree(), "d1", "我的剧本");
  assert.deepEqual(
    options.map((option) => option.value),
    ["current", "work", "folder:f1", "folder:f2"],
  );
  assert.equal(options[0].selectedByDefault, true, "有当前文档时默认当前文档");
  assert.deepEqual(options[0].scope, { type: "document", id: "d1" });
  assert.equal(options[0].rootName, "小芳", "文件名建议为文档名");
  assert.equal(options[1].rootName, "我的剧本", "整作品建议为作品名");
  assert.equal(options[2].rootName, "第一卷");
  assert.match(options[3].label, /^　/, "嵌套文件夹按层级缩进");
});

test("范围选项：无当前文档时省略文档选项，默认整个作品", () => {
  const options = buildScopeOptions(makeTree(), null, "我的剧本");
  assert.deepEqual(
    options.map((option) => option.value),
    ["work", "folder:f1", "folder:f2"],
  );
  assert.equal(options[0].selectedByDefault, true);
});

test("默认格式为 Word（与既有习惯衔接）", () => {
  assert.equal(DEFAULT_EXPORT_FORMAT, "word");
});

test("scopeFromOptionValue 解析选择器取值", () => {
  assert.deepEqual(scopeFromOptionValue("work"), { type: "work" });
  assert.deepEqual(scopeFromOptionValue("folder:f1"), { type: "folder", id: "f1" });
  assert.equal(scopeFromOptionValue("folder:"), null);
  assert.equal(scopeFromOptionValue("unknown"), null);
});

test("范围是否包含当前文档：作品恒含、文档看自身、文件夹看嵌套子树", () => {
  const tree = makeTree();
  assert.equal(scopeIncludesCurrentDocument({ type: "work" }, tree, "d1"), true);
  assert.equal(scopeIncludesCurrentDocument({ type: "document", id: "d1" }, tree, "d1"), true);
  assert.equal(scopeIncludesCurrentDocument({ type: "document", id: "d2" }, tree, "d1"), false);
  assert.equal(scopeIncludesCurrentDocument({ type: "folder", id: "f1" }, tree, "d1"), true);
  assert.equal(scopeIncludesCurrentDocument({ type: "folder", id: "f1" }, tree, "d2"), true, "嵌套文档属于子树");
  assert.equal(scopeIncludesCurrentDocument({ type: "folder", id: "f1" }, tree, "d3"), false);
  assert.equal(scopeIncludesCurrentDocument({ type: "work" }, tree, null), false, "无当前文档恒不提示");
});

// ---------------------------------------------------------------------------
// 控制器：取消静默、防重、未保存提示粒度、成功失败提示
// ---------------------------------------------------------------------------

function setup(dom: { btnExport: HTMLButtonElement }, overrides: {
  openDialog: () => Promise<ExportRequest | null>;
  runExport: (format: ExportRequest["format"], projectPath: string, scope: ExportRequest["scope"], fileName: string) => Promise<ExportFileResult>;
  hasUnsavedChanges?: () => boolean;
  currentDocumentId?: string | null;
}): void {
  setupExport(dom as never, {
    getProjectPath: () => "/作品/我的剧本",
    getProjectName: () => "我的剧本",
    getTree: () => makeTree(),
    getCurrentDocumentId: () => overrides.currentDocumentId ?? "d1",
    hasUnsavedChanges: () => overrides.hasUnsavedChanges?.() ?? false,
    services: {
      openDialog: overrides.openDialog,
      runExport: overrides.runExport,
    },
  });
}

test("无作品时不打开导出对话框", async () => {
  const { btnExport } = makeDom();
  let opened = false;
  setupExport({ btnExport } as never, {
    getProjectPath: () => null,
    getProjectName: () => null,
    getTree: () => null,
    getCurrentDocumentId: () => null,
    hasUnsavedChanges: () => false,
    services: {
      openDialog: async () => { opened = true; return null; },
      runExport: async () => okResult("x"),
    },
  });
  btnExport.click();
  await Promise.resolve();
  assert.equal(opened, false);
});

test("关闭导出对话框静默结束：不执行导出、不显示错误、按钮不卡死", async () => {
  const { btnExport, raw } = makeDom();
  const alertBox = installAlert();
  let called = false;
  setup({ btnExport }, {
    openDialog: async () => null,
    runExport: async () => { called = true; return okResult("x"); },
  });
  btnExport.click();
  await flushUntil(() => true);
  assert.equal(called, false, "取消不应执行导出");
  assert.deepEqual(alertBox.alerts, []);
  assert.equal(raw.disabled, false);
  alertBox.restore();
});

test("保存对话框取消不视为错误", async () => {
  const { btnExport } = makeDom();
  const alertBox = installAlert();
  setup({ btnExport }, {
    openDialog: async () => ({ format: "word", scope: { type: "document", id: "d1" }, fileName: "小芳" }),
    runExport: async () => ({ ok: false, cancelled: true, path: null, message: null }),
  });
  btnExport.click();
  await flushUntil(() => !btnExport.disabled);
  assert.deepEqual(alertBox.alerts, [], "取消不应显示错误");
  alertBox.restore();
});

test("导出成功提示目标位置并恢复按钮", async () => {
  const { btnExport } = makeDom();
  const alertBox = installAlert();
  let resolveExport!: (r: ExportFileResult) => void;
  const exportPromise = new Promise<ExportFileResult>((resolve) => { resolveExport = resolve; });
  const calls: ExportRequest[] = [];
  setup({ btnExport }, {
    openDialog: async () => ({ format: "word", scope: { type: "document", id: "d1" }, fileName: "小芳" }),
    runExport: async (format, _path, scope, fileName) => {
      calls.push({ format, scope, fileName });
      return exportPromise;
    },
  });

  btnExport.click();
  assert.equal(btnExport.disabled, true, "导出中应禁用按钮");
  assert.equal(btnExport.textContent, "导出中...");

  resolveExport(okResult("/导出/小芳.docx"));
  await flushUntil(() => !btnExport.disabled);

  assert.equal(btnExport.disabled, false);
  assert.equal(btnExport.textContent, "导出");
  assert.deepEqual(alertBox.alerts, ["导出成功：/导出/小芳.docx"]);
  assert.deepEqual(calls, [
    { format: "word", scope: { type: "document", id: "d1" }, fileName: "小芳" },
  ]);
  alertBox.restore();
});

test("导出失败显示中文说明", async () => {
  const { btnExport } = makeDom();
  const alertBox = installAlert();
  setup({ btnExport }, {
    openDialog: async () => ({ format: "markdown", scope: { type: "work" }, fileName: "我的剧本" }),
    runExport: async () => ({ ok: false, path: null, message: "写入目标文件失败" }),
  });

  btnExport.click();
  await flushUntil(() => !btnExport.disabled);
  assert.deepEqual(alertBox.alerts, ["导出失败：写入目标文件失败"]);
  alertBox.restore();
});

test("范围包含当前文档且有未保存修改时提示使用已保存版本", async () => {
  const { btnExport } = makeDom();
  const alertBox = installAlert();
  setup({ btnExport }, {
    openDialog: async () => ({ format: "word", scope: { type: "document", id: "d1" }, fileName: "小芳" }),
    runExport: async () => okResult("/导出/小芳.docx"),
    hasUnsavedChanges: () => true,
    currentDocumentId: "d1",
  });

  btnExport.click();
  await flushUntil(() => alertBox.alerts.length >= 1);
  assert.match(alertBox.alerts[0], /已保存版本/);
  await flushUntil(() => !btnExport.disabled);
  assert.equal(alertBox.alerts.length, 2, "提示后仍继续导出并显示成功");
  alertBox.restore();
});

test("范围不含当前文档时不弹未保存提示（即使有未保存修改）", async () => {
  const { btnExport } = makeDom();
  const alertBox = installAlert();
  setup({ btnExport }, {
    // f1 子树包含 d1/d2；选不含 d3（序章）所在的范围之外——这里选 f1？d1 在 f1 内。
    // 选「文档 d3」范围：不含当前文档 d1。
    openDialog: async () => ({ format: "pdf", scope: { type: "document", id: "d3" }, fileName: "序章" }),
    runExport: async () => okResult("/导出/序章.pdf"),
    hasUnsavedChanges: () => true,
    currentDocumentId: "d1",
  });

  btnExport.click();
  await flushUntil(() => !btnExport.disabled);
  assert.deepEqual(alertBox.alerts, ["导出成功：/导出/序章.pdf"], "不应出现未保存提示，只显示成功");
  alertBox.restore();
});

test("范围含当前文档但无未保存修改时不提示", async () => {
  const { btnExport } = makeDom();
  const alertBox = installAlert();
  setup({ btnExport }, {
    openDialog: async () => ({ format: "word", scope: { type: "work" }, fileName: "我的剧本" }),
    runExport: async () => okResult("/导出/我的剧本.docx"),
    hasUnsavedChanges: () => false,
    currentDocumentId: "d1",
  });

  btnExport.click();
  await flushUntil(() => !btnExport.disabled);
  assert.deepEqual(alertBox.alerts, ["导出成功：/导出/我的剧本.docx"]);
  alertBox.restore();
});

test("导出中防重复触发", async () => {
  const { btnExport } = makeDom();
  const alertBox = installAlert();
  let resolveExport!: (r: ExportFileResult) => void;
  const exportPromise = new Promise<ExportFileResult>((resolve) => { resolveExport = resolve; });
  let calls = 0;

  setup({ btnExport }, {
    openDialog: async () => ({ format: "word", scope: { type: "work" }, fileName: "我的剧本" }),
    runExport: async () => { calls += 1; return exportPromise; },
  });

  btnExport.click();
  await flushUntil(() => calls === 1);
  // 第二、三次点击发生在导出进行中：对话框阶段也不应再次打开。
  btnExport.click();
  btnExport.click();
  await Promise.resolve();
  assert.equal(calls, 1, "导出中重复点击不应再次触发");

  resolveExport(okResult("/导出/out.docx"));
  await flushUntil(() => !btnExport.disabled);
  assert.equal(calls, 1);
  alertBox.restore();
});
