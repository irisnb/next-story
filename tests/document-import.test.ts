import assert from "node:assert/strict";
import test from "node:test";

import type { ImportCommitResult, ImportPreview } from "../src/project-api.ts";
import type { ContentTree } from "../src/types.ts";
import {
  buildTargetOptions,
  formatCount,
  lossItemText,
  MARKDOWN_LINE_BREAK_NOTE,
  previewConclusion,
  setupDocumentImport,
  splitOptionLabel,
  structureLine,
  isMarkdownFile,
  type DocumentImportDom,
} from "../src/document-import.ts";

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

interface ListenerEntry { listener: Listener; once: boolean }

class FakeElement {
  readonly classList = new FakeClassList();
  private readonly listeners = new Map<string, ListenerEntry[]>();
  readonly children: FakeElement[] = [];
  textContent = "";
  value = "";
  title = "";
  checked = false;
  disabled = false;
  open = false;

  addEventListener(type: string, listener: Listener, options?: { once?: boolean }): void {
    const entries = this.listeners.get(type) ?? [];
    entries.push({ listener, once: options?.once === true });
    this.listeners.set(type, entries);
  }

  dispatch(type: string): void {
    const entries = this.listeners.get(type) ?? [];
    const remaining = entries.filter((entry) => {
      entry.listener();
      return !entry.once;
    });
    this.listeners.set(type, remaining);
  }

  click(): void { this.dispatch("click"); }

  showModal(): void { this.open = true; }
  close(): void { this.open = false; }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...children);
  }
}

const TREE: ContentTree = {
  root_children: ["f1", "d1"],
  nodes: {
    f1: { id: "f1", name: "第一卷", kind: "Folder", children: ["f2"] },
    f2: { id: "f2", name: "第二卷", kind: "Folder", children: [] },
    d1: { id: "d1", name: "序章", kind: "Document", children: [] },
  },
  recycle_bin: [],
};

const PROJECT_PATH = "/作品/我的剧本";
const FILE_PATH = "D:\\剧本\\61集.docx";

const CLEAN_PREVIEW: ImportPreview = {
  char_count: 55331,
  paragraph_count: 2718,
  default_doc_name: "61集短剧剧本",
  losses: [],
  split_suggestion: null,
  content_hash: "hash-1",
  generator: null,
};

function makePreview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return { ...CLEAN_PREVIEW, ...overrides };
}

async function flushUntil(predicate: () => boolean, maxTicks = 60): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("flushUntil timed out");
}

interface CommitRecord {
  projectPath: string;
  filePath: string;
  parentId: string | null;
  split: boolean;
  expectedHash: string;
}

interface Harness {
  dom: DocumentImportDom;
  elements: Record<string, FakeElement>;
  run(): void;
  previewRequests: string[];
  commitRequests: CommitRecord[];
  imported: ImportCommitResult[];
  busyLog: boolean[];
  alerts: string[];
  restore(): void;
}

function makeHarness(options: {
  /** 逐次预检结果（Error 表示该次失败）；次数超出的预检直接抛错暴露测试缺口。 */
  previews: Array<ImportPreview | Error>;
  /** 逐次提交结果（Error 表示该次失败）。 */
  commits?: Array<ImportCommitResult | Error>;
  /** 文件选择返回值；null 模拟用户取消。 */
  selectedFile?: string | null;
  /** 预检阶段抛错（选择对话框之后）。 */
  previewThrows?: boolean;
}): Harness {
  const elementIds = [
    "dialog", "conclusion", "structure", "mdNote", "lossesBlock", "lossList",
    "splitField", "splitWhole", "splitByMarker", "splitMarkerLabel",
    "targetSelect", "errorLine", "btnConfirm", "btnCancel",
  ];
  const raw = new Map<string, FakeElement>(elementIds.map((id) => [id, new FakeElement()]));
  const element = (id: string): FakeElement => {
    const found = raw.get(id);
    if (!found) throw new Error(`missing element ${id}`);
    return found;
  };
  const dom = {
    dialog: element("dialog"),
    conclusion: element("conclusion"),
    structure: element("structure"),
    mdNote: element("mdNote"),
    lossesBlock: element("lossesBlock"),
    lossList: element("lossList"),
    splitField: element("splitField"),
    splitWhole: element("splitWhole"),
    splitByMarker: element("splitByMarker"),
    splitMarkerLabel: element("splitMarkerLabel"),
    targetSelect: element("targetSelect"),
    errorLine: element("errorLine"),
    btnConfirm: element("btnConfirm"),
    btnCancel: element("btnCancel"),
  } as unknown as DocumentImportDom;

  const previewRequests: string[] = [];
  const commitRequests: CommitRecord[] = [];
  const imported: ImportCommitResult[] = [];
  const busyLog: boolean[] = [];
  let previewCount = 0;
  let commitCount = 0;

  const previousAlert = globalThis.alert;
  const alerts: string[] = [];
  globalThis.alert = (message?: unknown) => { alerts.push(String(message)); };
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => new FakeElement(),
  } as unknown as Document;

  const controller = setupDocumentImport(dom, {
    getProjectState: () => ({ projectPath: PROJECT_PATH, tree: TREE }),
    onImported: (result) => { imported.push(result); },
    setEntryBusy: (busy) => { busyLog.push(busy); },
    services: {
      selectFile: async () => options.selectedFile === undefined ? FILE_PATH : options.selectedFile,
      preview: async (_projectPath, filePath) => {
        if (options.previewThrows) throw new Error("文件不是有效的文档");
        previewRequests.push(filePath);
        const next = options.previews[previewCount];
        previewCount += 1;
        if (!next) throw new Error("测试未准备该次预检结果");
        if (next instanceof Error) throw next;
        return next;
      },
      commit: async (projectPath, filePath, parentId, split, expectedHash) => {
        commitRequests.push({ projectPath, filePath, parentId, split, expectedHash });
        const next = options.commits?.[commitCount];
        commitCount += 1;
        if (!next) throw new Error("测试未准备该次提交结果");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  });

  return {
    dom,
    elements: Object.fromEntries(raw.entries()) as Record<string, FakeElement>,
    run: () => controller.run(),
    previewRequests,
    commitRequests,
    imported,
    busyLog,
    alerts,
    restore: () => {
      globalThis.alert = previousAlert;
      globalThis.document = previousDocument;
    },
  };
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

test("formatCount 千位分隔", () => {
  assert.equal(formatCount(55331), "55,331");
  assert.equal(formatCount(61), "61");
  assert.equal(formatCount(0), "0");
});

test("预检结论：无损耗显示全部保留，有损耗显示降级或丢弃总项数", () => {
  assert.equal(previewConclusion(CLEAN_PREVIEW), "共 55,331 字，全部保留");
  const withLosses = makePreview({
    losses: [
      { kind: "table_flattened", count: 2, note: "" },
      { kind: "image_dropped", count: 1, note: "" },
      { kind: "footnote_dropped", count: 1, note: "" },
    ],
  });
  assert.equal(previewConclusion(withLosses), "保留 55,331 字，另有 4 处内容需降级或丢弃");
});

test("结构说明：默认整文件一个文档；选拆分时新建文件夹按标记拆分", () => {
  const withSuggestion = makePreview({
    split_suggestion: { marker_sample: "第X集", count: 61, doc_names: [] },
  });
  assert.equal(
    structureLine(withSuggestion, false),
    "整个文件将作为 1 个文档导入：《61集短剧剧本》",
  );
  assert.equal(
    structureLine(withSuggestion, true),
    "将新建文件夹《61集短剧剧本》，其下按标记拆分为 61 个文档",
  );
});

test("拆分选项文案带标记样例与数量；无建议时为空", () => {
  const withSuggestion = makePreview({
    split_suggestion: { marker_sample: "第X集", count: 61, doc_names: [] },
  });
  assert.equal(
    splitOptionLabel(withSuggestion),
    "按 61 个「第X集」标记拆分为 61 个文档（置于新文件夹）",
  );
  assert.equal(splitOptionLabel(CLEAN_PREVIEW), "");
});

test("损耗条目：中文标签＋数量，备注为空时不追加括号", () => {
  assert.equal(
    lossItemText({ kind: "table_flattened", count: 2, note: "逐格转为段落" }),
    "表格拍平保文字：2 处（逐格转为段落）",
  );
  assert.equal(
    lossItemText({ kind: "image_dropped", count: 1, note: "" }),
    "图片丢弃：1 处",
  );
  assert.equal(
    lossItemText({ kind: "revision_finalized", count: 3, note: "" }),
    "修订取最终态：3 处",
  );
});

test("损耗标签表：md 分支新增 kind 全部有平实中文标签", () => {
  // add-markdown-import 扩充的六类降级/丢弃。
  assert.equal(
    lossItemText({ kind: "code_degraded", count: 4, note: "" }),
    "代码降级为纯文字：4 处",
  );
  assert.equal(
    lossItemText({ kind: "quote_degraded", count: 2, note: "" }),
    "引用块降级为普通段落：2 处",
  );
  assert.equal(
    lossItemText({ kind: "tasklist_degraded", count: 3, note: "" }),
    "任务列表转为列表（勾选框保留为文字）：3 处",
  );
  assert.equal(
    lossItemText({ kind: "hr_dropped", count: 1, note: "" }),
    "分隔线丢弃：1 处",
  );
  assert.equal(
    lossItemText({ kind: "html_stripped", count: 5, note: "" }),
    "HTML 标签剥除保文字：5 处",
  );
  assert.equal(
    lossItemText({ kind: "frontmatter_dropped", count: 1, note: "" }),
    "文件头信息剥离：1 处",
  );
  // docx 管线的编号降级（复杂编号体系转普通段落）。
  assert.equal(
    lossItemText({ kind: "numbering_degraded", count: 7, note: "" }),
    "编号降级为普通段落：7 处",
  );
});

test("损耗标签表：fdx 分支新增 kind 全部有平实中文标签", () => {
  // add-fdx-import 扩充的五类结构性降级 / 丢弃 / 忽略。
  assert.equal(
    lossItemText({ kind: "dual_dialogue_degraded", count: 2, note: "" }),
    "双栏对白拆为先后段落：2 处",
  );
  assert.equal(
    lossItemText({ kind: "titlepage_inlined", count: 1, note: "" }),
    "标题页并入正文开头：1 处",
  );
  assert.equal(
    lossItemText({ kind: "scene_metadata_dropped", count: 12, note: "" }),
    "场景元数据丢弃：12 处",
  );
  assert.equal(
    lossItemText({ kind: "scriptnote_dropped", count: 3, note: "" }),
    "剧注丢弃：3 处",
  );
  assert.equal(
    lossItemText({ kind: "revision_marks_ignored", count: 5, note: "" }),
    "修订标记忽略，文字无损：5 处",
  );
  assert.equal(
    lossItemText({ kind: "unknown_element_skipped", count: 4, note: "BeatBoard" }),
    "未知元素已跳过（不影响文字）：4 处（BeatBoard）",
  );
});

test("isMarkdownFile 按扩展名判断且大小写不敏感", () => {
  assert.equal(isMarkdownFile("D:\\笔记.md"), true);
  assert.equal(isMarkdownFile("D:\\笔记.MD"), true);
  assert.equal(isMarkdownFile("D:\\剧本\\61集.docx"), false);
  assert.equal(isMarkdownFile("D:\\剧本\\readme.md.bak"), false);
});

test("目标位置选项：根级默认在首位，其后按树序缩进列出文件夹", () => {
  const options = buildTargetOptions(TREE);
  assert.deepEqual(
    options.map((option) => option.value),
    ["", "f1", "f2"],
  );
  assert.equal(options[0]!.label, "根级（作品顶层）");
  assert.equal(options[1]!.label, "📁 第一卷");
  assert.match(options[2]!.label, /^　/, "嵌套文件夹按层级缩进");
});

// ---------------------------------------------------------------------------
// 控制器：取消＝零副作用
// ---------------------------------------------------------------------------

test("用户取消文件选择：不预检、不提交、不弹对话框，静默结束", async () => {
  const h = makeHarness({ previews: [], selectedFile: null });
  try {
    h.run();
    await flushUntil(() => h.busyLog[h.busyLog.length - 1] === false);
    assert.equal(h.previewRequests.length, 0, "取消后不应预检");
    assert.equal(h.commitRequests.length, 0, "取消后不应提交");
    assert.equal(h.elements["dialog"]!.open, false, "取消后不应弹预检对话框");
    assert.deepEqual(h.alerts, [], "取消应静默，无错误提示");
  } finally {
    h.restore();
  }
});

test("用户在预检对话框取消：不提交、对话框关闭、零副作用", async () => {
  const h = makeHarness({ previews: [makePreview()] });
  try {
    h.run();
    await flushUntil(() => h.elements["dialog"]!.open);
    assert.equal(h.previewRequests.length, 1, "预检应恰好一次");
    h.elements["btnCancel"]!.click();
    await flushUntil(() => h.busyLog[h.busyLog.length - 1] === false);
    assert.equal(h.commitRequests.length, 0, "取消后不应提交");
    assert.equal(h.elements["dialog"]!.open, false, "取消后对话框应关闭");
    assert.deepEqual(h.alerts, []);
  } finally {
    h.restore();
  }
});

// ---------------------------------------------------------------------------
// 控制器：预检呈现
// ---------------------------------------------------------------------------

test("预检呈现：无损耗文件显示全部保留，损耗区与拆分区不出现", async () => {
  const h = makeHarness({ previews: [makePreview()] });
  try {
    h.run();
    await flushUntil(() => h.elements["dialog"]!.open);
    assert.equal(h.elements["conclusion"]!.textContent, "共 55,331 字，全部保留");
    assert.equal(
      h.elements["structure"]!.textContent,
      "整个文件将作为 1 个文档导入：《61集短剧剧本》",
    );
    assert.equal(
      h.elements["lossesBlock"]!.classList.contains("hidden"),
      true,
      "无损耗时损耗明细应隐藏",
    );
    assert.equal(
      h.elements["splitField"]!.classList.contains("hidden"),
      true,
      "无拆分建议时拆分选项不出现",
    );
    assert.deepEqual(h.elements["lossList"]!.children, []);
  } finally {
    h.restore();
  }
});

test("预检呈现：选中 .md 文件时呈现软换行接合说明，.docx 与 .fdx 不出现", async () => {
  const md = makeHarness({ previews: [makePreview()], selectedFile: "D:\\笔记\\大纲.md" });
  try {
    md.run();
    await flushUntil(() => md.elements["dialog"]!.open);
    assert.equal(
      md.elements["mdNote"]!.classList.contains("hidden"),
      false,
      "md 文件应呈现换行接合说明",
    );
    assert.equal(md.elements["mdNote"]!.textContent, MARKDOWN_LINE_BREAK_NOTE);
  } finally {
    md.restore();
  }

  const docx = makeHarness({ previews: [makePreview()] });
  try {
    docx.run();
    await flushUntil(() => docx.elements["dialog"]!.open);
    assert.equal(
      docx.elements["mdNote"]!.classList.contains("hidden"),
      true,
      ".docx 文件不应出现换行接合说明",
    );
    assert.equal(docx.elements["mdNote"]!.textContent, "");
  } finally {
    docx.restore();
  }

  // .fdx 的全部变化都在损耗清单内如实枚举，无需额外说明行（add-fdx-import）。
  const fdx = makeHarness({ previews: [makePreview()], selectedFile: "D:\\剧本\\table-read.fdx" });
  try {
    fdx.run();
    await flushUntil(() => fdx.elements["dialog"]!.open);
    assert.equal(
      fdx.elements["mdNote"]!.classList.contains("hidden"),
      true,
      ".fdx 文件不应出现换行接合说明",
    );
    assert.equal(fdx.elements["mdNote"]!.textContent, "");
  } finally {
    fdx.restore();
  }
});

test("预检呈现：损耗明细逐项完整渲染（标签＋数量），默认不拆分", async () => {
  const h = makeHarness({
    previews: [makePreview({
      losses: [
        { kind: "table_flattened", count: 2, note: "逐格转为段落" },
        { kind: "image_dropped", count: 1, note: "" },
      ],
      split_suggestion: { marker_sample: "第X集", count: 61, doc_names: [] },
    })],
  });
  try {
    h.run();
    await flushUntil(() => h.elements["dialog"]!.open);
    const lossTexts = h.elements["lossList"]!.children.map((item) => item.textContent);
    assert.deepEqual(lossTexts, [
      "表格拍平保文字：2 处（逐格转为段落）",
      "图片丢弃：1 处",
    ], "损耗明细应逐项完整呈现、绝不省略");
    assert.equal(
      h.elements["lossesBlock"]!.classList.contains("hidden"),
      false,
      "有损耗时损耗明细应可见（可折叠展开）",
    );
    assert.equal(
      h.elements["splitField"]!.classList.contains("hidden"),
      false,
      "有拆分建议时拆分选项应出现",
    );
    assert.equal(
      h.elements["splitMarkerLabel"]!.textContent,
      "按 61 个「第X集」标记拆分为 61 个文档（置于新文件夹）",
    );
    assert.equal(h.elements["splitWhole"]!.checked, true, "默认不拆分");
    assert.equal(h.elements["splitByMarker"]!.checked, false, "默认不拆分");
    assert.equal(h.elements["targetSelect"]!.value, "", "默认根级");
  } finally {
    h.restore();
  }
});

// ---------------------------------------------------------------------------
// 控制器：确认导入
// ---------------------------------------------------------------------------

test("确认导入：默认不拆＋根级，按预检哈希提交，成功后回调并提示", async () => {
  const result: ImportCommitResult = { created_doc_ids: ["d-1"], created_folder_id: null };
  const h = makeHarness({
    previews: [makePreview()],
    commits: [result],
  });
  try {
    h.run();
    await flushUntil(() => h.elements["dialog"]!.open);
    h.elements["btnConfirm"]!.click();
    await flushUntil(() => h.alerts.length > 0);
    assert.deepEqual(h.commitRequests, [{
      projectPath: PROJECT_PATH,
      filePath: FILE_PATH,
      parentId: null,
      split: false,
      expectedHash: "hash-1",
    }], "默认整文件、根级，回传预检哈希");
    assert.deepEqual(h.imported, [result], "成功后应通知宿主刷新内容树");
    assert.deepEqual(h.alerts, ["导入完成：新建 1 个文档"]);
    assert.equal(h.elements["dialog"]!.open, false, "成功后对话框应关闭");
  } finally {
    h.restore();
  }
});

test("用户选拆分＋指定文件夹：按拍板结果提交", async () => {
  const result: ImportCommitResult = {
    created_doc_ids: Array.from({ length: 61 }, (_, i) => `d-${i + 1}`),
    created_folder_id: "folder-new",
  };
  const h = makeHarness({
    previews: [makePreview({
      split_suggestion: { marker_sample: "第X集", count: 61, doc_names: [] },
    })],
    commits: [result],
  });
  try {
    h.run();
    await flushUntil(() => h.elements["dialog"]!.open);
    h.elements["splitByMarker"]!.checked = true;
    h.elements["targetSelect"]!.value = "f1";
    h.elements["btnConfirm"]!.click();
    await flushUntil(() => h.alerts.length > 0);
    assert.deepEqual(h.commitRequests, [{
      projectPath: PROJECT_PATH,
      filePath: FILE_PATH,
      parentId: "f1",
      split: true,
      expectedHash: "hash-1",
    }]);
    assert.deepEqual(h.alerts, ["导入完成：新建 61 个文档"]);
  } finally {
    h.restore();
  }
});

// ---------------------------------------------------------------------------
// 控制器：哈希不一致重新预检
// ---------------------------------------------------------------------------

test("哈希不一致：留在对话框重新预检并提示，再次确认用最新哈希", async () => {
  const latestPreview = makePreview({ char_count: 55500, content_hash: "hash-2" });
  const h = makeHarness({
    previews: [makePreview({ content_hash: "hash-1" }), latestPreview],
    commits: [
      new Error("hash_mismatch: expected=hash-1 got=hash-2"),
      { created_doc_ids: ["d-1"], created_folder_id: null },
    ],
  });
  try {
    h.run();
    await flushUntil(() => h.elements["dialog"]!.open);
    h.elements["btnConfirm"]!.click();
    // 哈希不一致：重新预检后对话框保持打开、错误行提示。
    await flushUntil(() => h.previewRequests.length === 2);
    assert.equal(h.elements["dialog"]!.open, true, "哈希不一致时对话框不应关闭");
    assert.match(h.elements["errorLine"]!.textContent, /文件在预检后有变动/);
    assert.equal(
      h.elements["conclusion"]!.textContent,
      `共 ${formatCount(55500)} 字，全部保留`,
      "应以最新预检结果刷新结论",
    );
    // 第二次确认：回传最新哈希并成功。
    h.elements["btnConfirm"]!.click();
    await flushUntil(() => h.alerts.length > 0);
    assert.equal(h.commitRequests.length, 2);
    assert.equal(h.commitRequests[0]!.expectedHash, "hash-1");
    assert.equal(h.commitRequests[1]!.expectedHash, "hash-2", "重试应回传最新预检哈希");
    assert.deepEqual(h.alerts, ["导入完成：新建 1 个文档"]);
    assert.equal(h.elements["dialog"]!.open, false);
  } finally {
    h.restore();
  }
});

// ---------------------------------------------------------------------------
// 控制器：失败呈现
// ---------------------------------------------------------------------------

test("预检失败（如畸形文件）：中文报错、不弹对话框、零副作用", async () => {
  const h = makeHarness({ previews: [], previewThrows: true });
  try {
    h.run();
    await flushUntil(() => h.busyLog[h.busyLog.length - 1] === false);
    assert.equal(h.elements["dialog"]!.open, false);
    assert.equal(h.commitRequests.length, 0);
    assert.deepEqual(h.alerts, ["导入失败：文件不是有效的文档"]);
  } finally {
    h.restore();
  }
});

test("提交失败（非哈希原因）：关闭对话框并中文报错", async () => {
  const h = makeHarness({
    previews: [makePreview()],
    commits: [new Error("单文档超出大小上限，无法导入")],
  });
  try {
    h.run();
    await flushUntil(() => h.elements["dialog"]!.open);
    h.elements["btnConfirm"]!.click();
    await flushUntil(() => h.alerts.length > 0);
    assert.deepEqual(h.alerts, ["导入失败：单文档超出大小上限，无法导入"]);
    assert.equal(h.elements["dialog"]!.open, false, "失败后对话框应关闭");
    assert.deepEqual(h.imported, [], "失败不触发导入完成回调");
  } finally {
    h.restore();
  }
});
