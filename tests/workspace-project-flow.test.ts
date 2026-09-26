import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { JSONContent } from "@tiptap/core";
import { Window } from "happy-dom";

import type { AiFeatureController } from "../src/ai-feature.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";
import type { AppDom } from "../src/dom.ts";
import { lastDocumentKey, type MemoryStorage } from "../src/document-memory.ts";
import { setupEditor, type WorkspaceTransition } from "../src/editor.ts";
import { setupFileManagement, type FileManagementServices } from "../src/file-management.ts";
import { setupWorkspaceProjectFlow } from "../src/workspace-project-flow.ts";
import { createWorkspaceTreeReceiver } from "../src/workspace-tree-flow.ts";
import type { SessionResult } from "../src/editor-document-session.ts";
import type { ProjectOpenResult, ProjectTreeState } from "../src/types.ts";
import type { LeaveChoice } from "../src/leave-guard.ts";
import { setupLeaveDialog } from "../src/leave-dialog.ts";

type EditorAdapter = ReturnType<NonNullable<Parameters<typeof setupEditor>[2]>["createEditor"]>;
type EditableAdapter = EditorAdapter & {
  destroyed: boolean;
  paused: boolean;
  node: HTMLElement;
  selection: { anchor: number; head: number };
  edit(text: string): void;
};
type WorkspaceServices = NonNullable<Parameters<typeof setupWorkspaceProjectFlow>[1]["services"]>;
interface FixtureOptions {
  services?: WorkspaceServices;
  fileServices?: Partial<FileManagementServices>;
  readDocument?: (path: string, id: string) => Promise<string>;
  saveDocument?: (path: string, id: string, content: string) => Promise<void>;
  choose?: () => Promise<LeaveChoice>;
  realLeaveDialog?: boolean;
  confirmDiscard?: () => boolean;
  memoryStorage?: MemoryStorage | null;
  beforeCreateEditor?: (element: HTMLElement, document: JSONContent) => void;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function openResult(name: string): ProjectOpenResult {
  return {
    metadata: { name, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", version: 3 },
    tree: project(name).tree,
  };
}

function paragraphDoc(text: string): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function notebookJson(text: string): string {
  return JSON.stringify({ format: "next-story-tiptap", version: 2, document: paragraphDoc(text) });
}

function project(name: string): ProjectTreeState {
  const id = `${name}-doc`;
  return {
    projectPath: name,
    projectName: name,
    tree: {
      root_children: [id],
      nodes: { [id]: { id, name: `${name} 文档`, kind: "Document", children: [] } },
      recycle_bin: [],
    },
  };
}

/** 微任务链有明确上限；失败信息指出等待的具体阶段，不靠延长 timeout。 */
async function flushUntil(predicate: () => boolean, stage: string): Promise<void> {
  for (let tick = 0; tick < 100; tick += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(`等待阶段未完成（100 个微任务上限）：${stage}`);
}

async function settled<T>(promise: Promise<T>, stage: string): Promise<T> {
  let done = false;
  void promise.then(() => { done = true; }, () => { done = true; });
  await flushUntil(() => done, stage);
  return promise;
}

function fixture(options: FixtureOptions = {}) {
  const window = new Window();
  const document = window.document as unknown as Document;
  const savedGlobals = new Map(["window", "document", "HTMLElement", "alert", "confirm"].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const));
  const alerts: string[] = [];
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: window },
    document: { configurable: true, value: document },
    HTMLElement: { configurable: true, value: window.HTMLElement },
    alert: { configurable: true, value: (message: unknown) => { alerts.push(String(message)); } },
    confirm: { configurable: true, value: options.confirmDiscard ?? (() => true) },
  });

  // 三个 setup 共享同一份 DOM；所有元素属于同一 document 且可通过 ID 找到。
  // happy-dom 提供真实 childNodes/replaceChildren/事件接口，不伪造 session 的提交行为。
  const elements = new Map<string, HTMLElement>();
  const dom = new Proxy({} as AppDom, {
    get(_target, key: string) {
      if (!elements.has(key)) {
        const tag = key === "leaveDialog" ? "dialog" : /^(btn|tab|fmNew)/.test(key) || ["currentDocToggle", "fmOpenRecycleBin", "fmBackFromRecycle"].includes(key)
          ? "button"
          : /Input$|^input|^findCaseSensitive$/.test(key) ? "input"
            : /^select|^paragraphStyle$/.test(key) ? "select" : "div";
        const element = document.createElement(tag);
        element.id = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        document.body.appendChild(element);
        elements.set(key, element);
      }
      return elements.get(key);
    },
  });
  // 编辑器宿主留在 editor-page 内，候选编辑器则由 session 在离屏容器构建。
  dom.editorPage.appendChild(dom.editorTextarea);

  const adapters: EditableAdapter[] = [];
  const reads: Array<[string, string]> = [];
  const readDeferred = new Map<string, { resolve(value: string): void; reject(reason: unknown): void }>();
  const unexpected = (): never => { throw new Error("测试触发了未预期的外部服务"); };
  const choices: LeaveChoice[] = [];
  const saves: Array<[string, string, string]> = [];
  const restorations: Array<{ adapter: EditableAdapter; syncDOM: boolean; paused: boolean; disabled: boolean; busy: boolean }> = [];
  if (options.realLeaveDialog) {
    dom.leaveDialog.append(dom.btnCancelLeave, dom.btnDiscardAndLeave, dom.btnSaveAndLeave);
  }
  const realDialog = options.realLeaveDialog ? setupLeaveDialog(dom) : null;
  const editor = setupEditor(dom, realDialog ?? { choose: async () => {
    const choice = await (options.choose?.() ?? Promise.resolve("cancel" as const));
    choices.push(choice);
    return choice;
  } }, {
    createEditor(element, initialDocument) {
      options.beforeCreateEditor?.(element, initialDocument);
      let currentDocument = initialDocument;
      const editListeners = new Set<(document: JSONContent) => void>();
      const node = document.createElement("p");
      node.tabIndex = 0;
      node.contentEditable = "true";
      node.textContent = initialDocument.content?.[0]?.content?.[0]?.text ?? "";
      element.appendChild(node);
      const adapter: EditableAdapter = {
        destroyed: false,
        paused: false,
        selection: { anchor: 3, head: 1 },
        node,
        getDocument: () => currentDocument,
        edit(text) {
          assert.equal(adapter.destroyed, false, "不可编辑已销毁的 adapter");
          assert.equal(adapter.paused, false, "不可绕过编辑暂停保护");
          currentDocument = paragraphDoc(text);
          node.textContent = text;
          for (const listener of editListeners) listener(currentDocument);
        },
        focus() {},
        destroy() { adapter.destroyed = true; editListeners.clear(); },
        async pauseEditing() {
          adapter.paused = true;
          const captured = { ...adapter.selection };
          return {
            resume: () => { adapter.paused = false; },
            restoreSelection: ({ syncDOM = false } = {}) => {
              restorations.push({ adapter, syncDOM, paused: adapter.paused, disabled: dom.btnBackWelcome.disabled, busy: flow.isBusy() });
              adapter.selection = { ...captured };
              if (syncDOM) node.focus();
              return !adapter.destroyed;
            },
          };
        },
        onEdit: (listener) => {
          editListeners.add(listener);
          return () => { editListeners.delete(listener); };
        },
        onSelectionChange: () => () => {},
        getSelection: () => ({ from: 1, to: 1, head: 1 }),
        coordinatesAt: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
        runCommand: () => false,
        canUndo: () => false,
        canRedo: () => false,
        setFind: () => 0,
        activateMatch() {},
        replaceCurrent: () => false,
        replaceAll: () => 0,
        pastePlainText: async () => false,
        copySelection: async () => false,
        async cutSelection() {},
      };
      adapters.push(adapter);
      return adapter;
    },
    readDocument: async (path, id) => {
      reads.push([path, id]);
      if (options.readDocument) return options.readDocument(path, id);
      assert.equal(id, `${path}-doc`);
      // A 的初始装载即时完成，只有待切换的 B 正文读取被挂起。
      if (path === "A") return notebookJson("A 正文");
      assert.equal(path, "B");
      return new Promise<string>((resolve, reject) => { readDeferred.set(path, { resolve, reject }); });
    },
    saveDocument: async (path, id, content) => {
      saves.push([path, id, content]);
      return (options.saveDocument ?? unexpected)(path, id, content);
    },
    memoryStorage: options.memoryStorage ?? null,
    marginStorage: null,
  });
  const fileServices: FileManagementServices = {
    openContentTree: unexpected,
    createDocument: unexpected,
    createFolder: unexpected,
    renameNode: unexpected,
    moveNode: unexpected,
    deleteNode: unexpected,
    restoreNode: unexpected,
    setDocumentAiVisibility: unexpected,
    conversationsUsingDocument: unexpected,
    ...options.fileServices,
  };
  const treeChanges: ProjectTreeState["tree"][] = [];
  const treeResults: SessionResult[] = [];
  const receiveTree = createWorkspaceTreeReceiver(editor, (tree) => {
      assert.equal(editor.getTree(), tree, "依赖新树的通知必须在编辑器接受后发布");
      assert.deepEqual(fileIds(), tree.root_children, "通知时文件管理已接受同一树");
      treeChanges.push(tree);
  });
  const files = setupFileManagement(dom, {
    async onTreeChanged(...args) {
      const result = await receiveTree(...args);
      treeResults.push(result);
      return result;
    },
    services: fileServices,
  });
  const fileIds = () => Array.from(dom.fmFileTree.querySelectorAll("[data-node-id]"), (node) => node.getAttribute("data-node-id"));
  const writing: Array<string | null> = [];
  const recent: Array<[string, string]> = [];
  const aiBegins: Array<{ path: string | null; fileIds: Array<string | null> }> = [];
  const lifecycle = { aiEnds: 0, exportUnloads: 0, recentLoads: 0 };
  const ai: AiFeatureController = {
    state: new AiPanelState(),
    beginProject: () => { aiBegins.push({ path: editor.getProjectPath(), fileIds: fileIds() }); },
    endProject() { lifecycle.aiEnds += 1; },
    submitFollowUp: async () => false,
    retryFollowUp: async () => false,
    editFollowUp: async () => false,
    getConversations: () => [],
    openDiscussion() {},
    async deleteDiscussion() {},
    recomputeRestrictions() {},
    drainPendingSaves: async () => {},
    destroy() {},
  };
  editor.attachAi(ai);
  const openedPaths: string[] = [];
  const created: Array<[string, string]> = [];
  const flow = setupWorkspaceProjectFlow(dom, {
    editor, files,
    showWriting: () => { writing.push(editor.getProjectPath()); },
    unloadExport: () => { lifecycle.exportUnloads += 1; },
    services: {
      ...options.services,
      openProject: async (path) => {
        openedPaths.push(path);
        if (options.services?.openProject) return options.services.openProject(path);
        assert.equal(path, "B");
        return openResult("B");
      },
      createProject: async (name, location) => {
        created.push([name, location]);
        return (options.services?.createProject ?? unexpected)(name, location);
      },
      openContentTree: options.services?.openContentTree ?? unexpected,
      loadRecentWorks: async () => {
        lifecycle.recentLoads += 1;
        return options.services?.loadRecentWorks?.() ?? [];
      },
      recordRecentWork: async (name, path) => {
        recent.push([name, path]);
        await options.services?.recordRecentWork?.(name, path);
      },
    },
  });

  return {
    dom, editor, files, flow, adapters, reads, readDeferred, writing, recent, aiBegins, openedPaths, alerts, fileIds,
    choices, saves, treeChanges, treeResults, lifecycle, created, restorations,
    async restore() {
      try { flow.destroy(); }
      finally {
        for (const [key, descriptor] of savedGlobals) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else Reflect.deleteProperty(globalThis, key);
        }
        await window.happyDOM.close();
      }
    },
  };
}

function deleteCurrent(ui: Fixture): void {
  const row = ui.dom.fmFileTree.querySelector('[data-node-id="A-doc"]');
  const button = Array.from(row?.querySelectorAll("button") ?? []).find((item) => item.textContent === "删除");
  assert.ok(button);
  button.click();
}

for (const outcome of ["success", "read-failure", "parse-failure", "cancel"] as const) {
  test(`tree deletion jointly accepts editor and files only after fallback preparation (${outcome})`, async (t) => {
    const body = deferred<string>();
    const next = project("D2").tree;
    let deleted = 0;
    let confirmed = 0;
    const ui = fixture({
      confirmDiscard: () => { confirmed += 1; return false; },
      readDocument: async (_path, id) => id === "A-doc" ? notebookJson("A 正文") : body.promise,
      fileServices: {
        deleteNode: async (path, id) => { assert.deepEqual([path, id], ["A", "A-doc"]); deleted += 1; },
        openContentTree: async () => next,
      },
    });
    t.after(() => ui.restore());
    await loadA(ui);
    const old = ui.adapters[0];
    if (outcome === "cancel") old.edit("A 未保存修改");
    deleteCurrent(ui);
    if (outcome === "cancel") {
      await flushUntil(() => confirmed === 1 && !ui.editor.isTransitioning(), "删除确认取消");
      await nextTurn();
      assertOldEditor(ui, old, "A 未保存修改");
      assert.equal(ui.editor.hasUnsavedChanges(), true);
      assert.equal(ui.reads.length, 1);
      assert.deepEqual(ui.treeResults, [{ status: "cancelled" }]);
    } else {
      await flushUntil(() => ui.reads.some(([, id]) => id === "D2-doc"), "替代正文开始读取");
      assertOldEditor(ui, old);
      assert.equal(old.paused, true);
      assert.deepEqual(ui.treeChanges, [], "准备期不得发布新树依赖通知");
      if (outcome === "success") body.resolve(notebookJson("D2 正文"));
      else if (outcome === "read-failure") body.reject(new Error("替代正文读取失败"));
      else body.resolve("{broken-json");
      await flushUntil(() => !ui.editor.isTransitioning(), "树回落准备结束");
      await nextTurn();
      if (outcome === "success") {
        assert.equal(ui.editor.getTree(), next);
        assert.deepEqual(ui.fileIds(), ["D2-doc"]);
        assert.equal(ui.editor.getCurrentDocumentId(), "D2-doc");
        assert.equal(ui.dom.editorTextarea.textContent, "D2 正文");
        assert.equal(old.destroyed, true);
        assert.deepEqual(ui.treeChanges, [next]);
        assert.deepEqual(ui.treeResults, [{ status: "committed" }]);
      } else {
        assertOldEditor(ui, old);
        assert.match(ui.dom.fmStatus.textContent ?? "", outcome === "read-failure" ? /读取文档失败/ : /解析文档失败/);
        assert.deepEqual(ui.treeChanges, []);
        assert.equal(ui.treeResults[0]?.status, "failed", "读取/解析错误必须回传文件管理入口");
        old.edit("失败后继续写");
      }
    }
    assert.equal(deleted, 1, "保留界面不回滚已完成的磁盘删除");
    assertReleased(ui);
    assertNoOpenEffects(ui);
  });
}

for (const latest of ["success", "failure"] as const) {
  test(`late older refresh cannot start fallback; latest ${latest} owns state`, async (t) => {
    const refreshes = [deferred<ProjectTreeState["tree"]>(), deferred<ProjectTreeState["tree"]>()];
    const body = deferred<string>();
    let reads = 0;
    const next = project("LATEST").tree;
    const ui = fixture({
      readDocument: async (_path, id) => id === "A-doc" ? notebookJson("A 正文")
        : id === "D2-doc" ? body.promise : notebookJson("LATEST 正文"),
      fileServices: {
        deleteNode: async () => {},
        openContentTree: async () => refreshes[reads++].promise,
      },
    });
    t.after(() => ui.restore());
    await loadA(ui);
    deleteCurrent(ui);
    await flushUntil(() => reads === 1, "刷新 1 开始");
    deleteCurrent(ui);
    await flushUntil(() => reads === 2, "刷新 2 开始");
    if (latest === "success") refreshes[1].resolve(next);
    else refreshes[1].reject(new Error("最新树读取失败"));
    await nextTurn();
    refreshes[0].resolve(project("D2").tree);
    body.resolve(notebookJson("迟到 D2 正文"));
    await nextTurn();
    assert.equal(ui.reads.some(([, id]) => id === "D2-doc"), false);
    assert.equal(ui.editor.getCurrentDocumentId() === "D2-doc", false);
    if (latest === "success") {
      assert.equal(ui.editor.getTree(), next);
      assert.deepEqual(ui.fileIds(), ["LATEST-doc"]);
      assert.deepEqual(ui.treeChanges, [next]);
    } else {
      assertOldEditor(ui, ui.adapters[0]);
      assert.match(ui.dom.fmStatus.textContent ?? "", /最新树读取失败/);
      assert.deepEqual(ui.treeChanges, []);
    }
    assertNoOpenEffects(ui);
    assertReleased(ui);
  });
}

for (const outcome of ["success", "failure"] as const) {
  test(`old-load fallback ${outcome} after same-path new load cannot commit or clear new protection`, async (t) => {
    const body = deferred<string>();
    const ui = fixture({
      readDocument: async (_path, id) => id === "A-doc" ? notebookJson("A 正文") : body.promise,
      fileServices: { deleteNode: async () => {}, openContentTree: async () => project("D2").tree },
    });
    t.after(() => ui.restore());
    await loadA(ui);
    const identity = ui.editor.getProjectIdentity();
    deleteCurrent(ui);
    await flushUntil(() => ui.reads.length === 2, "旧装载替代正文等待");
    ui.files.unload(); ui.editor.unload();
    const peer = ui.files.prepareProject(project("A"));
    const reload = ui.editor.beginWorkspaceTransition("A")!;
    const candidate = await reload.prepare(peer.project);
    candidate.commit(peer.commit);
    reload.release();
    assert.notDeepEqual(ui.editor.getProjectIdentity(), identity);
    const protection = ui.editor.beginWorkspaceTransition("新的操作")!;
    await protection.protect();
    if (outcome === "success") body.resolve(notebookJson("旧装载 D2"));
    else body.reject(new Error("旧装载失败"));
    await flushUntil(() => ui.treeResults.length === 1, "旧候选失效返回");
    assert.deepEqual(ui.treeResults, [{ status: "stale" }]);
    assertProject(ui, "A");
    assert.equal(protection.isCurrent(), true);
    assert.equal(ui.adapters[ui.adapters.length - 1]?.paused, true);
    assert.equal(ui.dom.fmNewDocument.disabled, true);
    assert.deepEqual(ui.treeChanges, []);
    assert.equal(ui.dom.fmStatus.textContent, "");
    assert.deepEqual(ui.alerts, []);
    protection.release();
    assertReleased(ui);
  });
}

for (const outcome of ["cancel", "failure", "success"] as const) {
  test(`refresh during project transition resumes only latest original candidate after ${outcome}`, async (t) => {
    const refresh = deferred<ProjectTreeState["tree"]>();
    const choice = deferred<LeaveChoice>();
    const body = deferred<string>();
    let treeReads = 0;
    const next = project("D2").tree;
    const ui = fixture({
      choose: () => choice.promise,
      readDocument: async (path, id) => path === "B" ? body.promise
        : id === "A-doc" ? notebookJson("A 正文") : notebookJson("D2 正文"),
      fileServices: {
        deleteNode: async () => {},
        openContentTree: async () => { treeReads += 1; return refresh.promise; },
      },
    });
    t.after(() => ui.restore());
    await loadA(ui);
    ui.adapters[0].edit("A 未保存修改");
    deleteCurrent(ui);
    await flushUntil(() => treeReads === 1, "结构写入后的刷新已开始");
    const opening = ui.flow.openPath("B");
    await flushUntil(() => ui.adapters[0].paused, "作品切换保护生效");
    refresh.resolve(next);
    await nextTurn();
    assertProject(ui, "A", "A 未保存修改");
    assert.deepEqual(ui.treeResults, []);
    choice.resolve(outcome === "cancel" ? "cancel" : "discard-and-leave");
    if (outcome !== "cancel") {
      await flushUntil(() => ui.reads.some(([path]) => path === "B"), "B 正文读取");
      if (outcome === "success") body.resolve(notebookJson("B 正文"));
      else body.reject(new Error("B 正文失败"));
    }
    const result = await settled(opening, "作品切换结束");
    assert.equal(result.status, outcome === "success" ? "committed" : outcome === "cancel" ? "cancelled" : "failed");
    await nextTurn();
    if (outcome === "success") {
      assertProject(ui, "B");
      assert.deepEqual(ui.treeResults, []);
    } else {
      assert.equal(ui.editor.getTree(), next);
      assert.deepEqual(ui.fileIds(), ["D2-doc"]);
      assert.deepEqual(ui.treeResults, [{ status: "committed" }]);
      assertNoOpenEffects(ui);
    }
    assert.equal(treeReads, 1, "恢复必须复核原候选，不重造刷新身份或重读树");
    assertReleased(ui);
  });
}

type Fixture = ReturnType<typeof fixture>;

function assertProject(ui: Fixture, name: string, text = `${name} 正文`): void {
  assert.equal(ui.editor.getProjectPath(), name);
  assert.equal(ui.editor.getCurrentDocumentId(), `${name}-doc`);
  assert.deepEqual(ui.editor.getTree(), project(name).tree);
  assert.deepEqual(ui.editor.getCurrentEditor()?.getDocument(), paragraphDoc(text));
  assert.equal(ui.dom.editorTextarea.textContent, text);
  assert.deepEqual(ui.fileIds(), [`${name}-doc`]);
  assert.equal(ui.dom.fmFileTree.querySelector(".file-name")?.textContent, `${name} 文档`);
}

async function loadA(ui: Fixture): Promise<void> {
  const peer = ui.files.prepareProject(project("A"));
  const owner = ui.editor.beginWorkspaceTransition("A")!;
  const candidate = await settled(owner.prepare(peer.project), "初始作品 A 准备");
  candidate.commit(peer.commit);
  owner.release();
  assertProject(ui, "A");
  assert.equal(ui.adapters.length, 1);
  assert.deepEqual(ui.aiBegins, [{ path: "A", fileIds: ["A-doc"] }]);
  assert.equal(ui.flow.isBusy(), false);
}

async function assertPendingB(ui: Fixture): Promise<void> {
  await flushUntil(() => ui.readDeferred.has("B"), "B 正文读取已开始");
  assertProject(ui, "A");
  assert.equal(ui.adapters.length, 1, "候选正文未完成前不创建/替换编辑器");
  assert.equal(ui.adapters[0].destroyed, false);
  assert.equal(ui.dom.editorTextarea.firstChild, ui.adapters[0].node, "A 编辑器实例的 DOM 仍在原宿主");
  assert.equal(ui.adapters[0].paused, true);
  assert.equal(ui.editor.isTransitioning(), true);
  assert.equal(ui.flow.isBusy(), true);
  assert.equal(ui.dom.fmNewDocument.disabled, true);
  assert.equal(ui.dom.tabWriting.disabled, true);
  assert.deepEqual(await settled(ui.flow.open(), "busy 时额外 open"), { status: "busy" });
  assert.deepEqual(await settled(ui.flow.openPath("C"), "busy 时额外 openPath"), { status: "busy" });
  ui.dom.projectNameInput.value = "C";
  ui.dom.saveLocationInput.value = "D:\\作品";
  assert.deepEqual(await settled(ui.flow.create(), "busy 时额外 create"), { status: "busy" });
  assert.deepEqual(await settled(ui.flow.backToWelcome(), "busy 时返回欢迎页"), { status: "busy" });
  assert.deepEqual(ui.openedPaths, ["B"]);
  assert.deepEqual(ui.reads, [["A", "A-doc"], ["B", "B-doc"]]);
  assert.deepEqual(ui.writing, []);
  assert.deepEqual(ui.recent, []);
  assert.deepEqual(ui.aiBegins, [{ path: "A", fileIds: ["A-doc"] }]);
  assert.deepEqual(ui.alerts, []);
}

function assertReleased(ui: Fixture): void {
  assert.equal(ui.flow.isBusy(), false);
  assert.equal(ui.editor.isTransitioning(), false);
  assert.equal(ui.dom.fmNewDocument.disabled, false);
  assert.equal(ui.dom.tabWriting.disabled, false);
}

test("real workspace assembly keeps A while B body is pending, then commits once", { timeout: 5000 }, async (t) => {
  const ui = fixture();
  t.after(() => ui.restore());
  await loadA(ui);
  const oldEditor = ui.adapters[0];
  const opening = ui.flow.openPath("B");
  await assertPendingB(ui);

  ui.readDeferred.get("B")!.resolve(notebookJson("B 正文"));
  assert.deepEqual(await settled(opening, "B 正文完成后提交"), { status: "committed" });
  assertProject(ui, "B");
  assertReleased(ui);
  assert.equal(ui.adapters.length, 2);
  assert.equal(oldEditor.destroyed, true);
  assert.notEqual(ui.adapters[1], oldEditor);
  assert.equal(ui.adapters[1].destroyed, false);
  assert.equal(ui.dom.editorTextarea.firstChild, ui.adapters[1].node);
  assert.deepEqual(ui.writing, ["B"], "showWriting 恰一次");
  assert.deepEqual(ui.recent, [["B", "B"]], "recordRecentWork 恰一次");
  assert.deepEqual(ui.aiBegins, [
    { path: "A", fileIds: ["A-doc"] },
    { path: "B", fileIds: ["B-doc"] },
  ], "B 的 AI 初始化恰一次，且发布前文件管理已安装 B");
  assert.deepEqual(ui.alerts, []);
});

test("real workspace assembly commits B after dirty A discard despite document-memory quota failure", { timeout: 5000 }, async (t) => {
  const stored = new Map<string, string>();
  const writes: Array<[string, string]> = [];
  const privateMessage = "存储异常含私密正文，不得写进日志";
  const quotaError = new DOMException(privateMessage, "QuotaExceededError");
  const warnings: unknown[][] = [];
  const warning = t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  let candidateConstructed = false;
  let memoryCommitState: unknown;
  try {
    const ui = fixture({
      choose: async () => "discard-and-leave",
      memoryStorage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem(key, value) {
          writes.push([key, value]);
          if (key === lastDocumentKey("B")) {
            memoryCommitState = {
              path: ui.editor.getProjectPath(),
              documentId: ui.editor.getCurrentDocumentId(),
              fileIds: ui.fileIds(),
              candidateInstalled: ui.editor.getCurrentEditor()?.getDocument() === ui.adapters[1].getDocument(),
              oldDestroyed: ui.adapters[0].destroyed,
            };
            throw quotaError;
          }
          stored.set(key, value);
        },
        removeItem: (key) => { stored.delete(key); },
      },
      beforeCreateEditor(element, document) {
        if (document.content?.[0]?.content?.[0]?.text !== "B 正文") return;
        candidateConstructed = true;
        assertOldEditor(ui, ui.adapters[0], "A 未保存修改");
        assert.equal(ui.editor.getCurrentEditor()?.getDocument(), ui.adapters[0].getDocument());
        assert.equal(ui.editor.hasUnsavedChanges(), true, "discard 授权不提前清除 dirty");
        assert.equal(element.isConnected, false, "B 必须在离屏容器准备");
        assertNoOpenEffects(ui);
      },
    });
    t.after(() => ui.restore());
    await loadA(ui);
    assert.equal(stored.get(lastDocumentKey("A")), "A-doc", "A 初始化存储正常");
    assert.deepEqual(warnings, []);
    const old = ui.adapters[0];
    const destroyed = t.mock.method(old, "destroy");
    const preparePeer = t.mock.method(ui.files, "prepareProject");
    old.edit("A 未保存修改");
    const opening = ui.flow.openPath("B");
    await flushUntil(() => ui.readDeferred.has("B"), "discard 后等待 B 正文");
    assertOldEditor(ui, old, "A 未保存修改");
    assert.equal(old.paused, true);
    assert.equal(ui.editor.hasUnsavedChanges(), true);
    assert.equal(destroyed.mock.callCount(), 0);
    assert.deepEqual(writes, [[lastDocumentKey("A"), "A-doc"]]);
    assertNoOpenEffects(ui);

    ui.readDeferred.get("B")!.resolve(notebookJson("B 正文"));
    assert.deepEqual(await settled(opening, "记忆写入失败仍成功提交 B"), { status: "committed" });
    assert.equal(candidateConstructed, true);
    assertProject(ui, "B");
    assertReleased(ui);
    assert.equal(preparePeer.mock.callCount(), 1);
    const peerProject = preparePeer.mock.calls[0].result!.project;
    assert.equal(ui.editor.getTree(), peerProject.tree, "编辑器与真实文件管理候选共用同一树");
    assert.deepEqual(ui.editor.getProjectIdentity(), peerProject.loadIdentity);
    assert.deepEqual(memoryCommitState, {
      path: "B", documentId: "B-doc", fileIds: ["B-doc"], candidateInstalled: true, oldDestroyed: true,
    }, "记忆写入只在两侧安装完成后发生");
    assert.equal(destroyed.mock.callCount(), 1, "候选构建成功进入提交后才销毁旧 A，且仅一次");
    assert.equal(ui.adapters.length, 2);
    assert.equal(ui.adapters[1].destroyed, false);
    assert.equal(ui.dom.editorTextarea.firstChild, ui.adapters[1].node);
    assert.equal(ui.editor.hasUnsavedChanges(), false);
    assert.deepEqual(ui.choices, ["discard-and-leave"]);
    assert.deepEqual(ui.saves, []);
    assert.deepEqual(ui.writing, ["B"], "showWriting 恰一次");
    assert.deepEqual(ui.recent, [["B", "B"]], "最近记录恰一次");
    assert.deepEqual(ui.aiBegins, [
      { path: "A", fileIds: ["A-doc"] },
      { path: "B", fileIds: ["B-doc"] },
    ], "B beginProject 恰一次");
    assert.deepEqual(ui.alerts, [], "辅助存储失败不冒充打开作品失败");
    assert.deepEqual(writes, [[lastDocumentKey("A"), "A-doc"], [lastDocumentKey("B"), "B-doc"]]);
    assert.deepEqual([...stored], [[lastDocumentKey("A"), "A-doc"]]);
    assert.deepEqual(warnings, [[
      "[document-memory] setItem failed; last-document preference unavailable",
      { errorName: "QuotaExceededError" },
    ]], "存储故障独立 warning，且不重试");
    assert.equal(JSON.stringify(warnings).includes(privateMessage), false);
    assert.equal(warnings.flat().some((argument) => Object.is(argument, quotaError)), false, "不泄露原异常对象");
  } finally {
    warning.mock.restore();
  }
});

test("real workspace assembly preserves dirty A after discard when B editor construction fails", { timeout: 5000 }, async (t) => {
  const constructionError = new Error("B 候选编辑器构建失败");
  let constructionAttempts = 0;
  const ui = fixture({
    choose: async () => "discard-and-leave",
    beforeCreateEditor(element, document) {
      if (document.content?.[0]?.content?.[0]?.text !== "B 正文") return;
      constructionAttempts += 1;
      assertOldEditor(ui, ui.adapters[0], "A 未保存修改");
      assert.equal(ui.editor.hasUnsavedChanges(), true);
      assert.equal(element.isConnected, false);
      throw constructionError;
    },
  });
  t.after(() => ui.restore());
  await loadA(ui);
  const old = ui.adapters[0];
  const oldTree = ui.editor.getTree();
  const oldIdentity = ui.editor.getProjectIdentity();
  const oldRow = ui.dom.fmFileTree.firstChild;
  const destroyed = t.mock.method(old, "destroy");
  old.edit("A 未保存修改");
  const opening = ui.flow.openPath("B");
  await flushUntil(() => ui.readDeferred.has("B"), "discard 后等待 B 候选构建");
  assertOldEditor(ui, old, "A 未保存修改");
  assert.equal(old.paused, true);
  assert.equal(ui.editor.hasUnsavedChanges(), true);
  assertNoOpenEffects(ui);
  ui.readDeferred.get("B")!.resolve(notebookJson("B 正文"));
  const result = await settled(opening, "候选构建失败保留 A");
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.error, constructionError);
  assert.equal(constructionAttempts, 1);
  assertOldEditor(ui, old, "A 未保存修改");
  assert.equal(ui.editor.getCurrentEditor()?.getDocument(), old.getDocument(), "当前接口仍引用旧实例的文档");
  assert.equal(ui.editor.getTree(), oldTree, "保留旧树对象而非重新装载");
  assert.deepEqual(ui.editor.getProjectIdentity(), oldIdentity);
  assert.equal(ui.dom.fmFileTree.firstChild, oldRow, "文件管理旧树 DOM 未被替换");
  assert.equal(destroyed.mock.callCount(), 0);
  assert.equal(ui.editor.hasUnsavedChanges(), true);
  assert.equal(old.paused, false);
  assertReleased(ui);
  assertNoOpenEffects(ui);
  assert.deepEqual(ui.choices, ["discard-and-leave"]);
  assert.deepEqual(ui.saves, []);
  assert.deepEqual(ui.reads, [["A", "A-doc"], ["B", "B-doc"]]);
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0], /打开作品失败：.*B 候选编辑器构建失败/);
  old.edit("A 构建失败后继续写");
  assertOldEditor(ui, old, "A 构建失败后继续写");
  assert.equal(ui.editor.hasUnsavedChanges(), true);
  assertNoOpenEffects(ui);
});

test("real workspace assembly preserves A and has no success side effects when B body read fails", { timeout: 5000 }, async (t) => {
  const ui = fixture();
  t.after(() => ui.restore());
  await loadA(ui);
  const oldEditor = ui.adapters[0];
  const opening = ui.flow.openPath("B");
  await assertPendingB(ui);

  ui.readDeferred.get("B")!.reject(new Error("正文读取失败"));
  const result = await settled(opening, "B 正文失败后释放并保留 A");
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.match(String(result.error), /读取文档失败：正文读取失败/);
  assertProject(ui, "A");
  assertReleased(ui);
  assert.equal(ui.adapters.length, 1);
  assert.equal(ui.adapters[0], oldEditor);
  assert.equal(oldEditor.destroyed, false);
  assert.equal(oldEditor.paused, false, "失败后 A 恢复可编辑");
  assert.equal(ui.dom.editorTextarea.firstChild, oldEditor.node);
  assert.deepEqual(ui.writing, []);
  assert.deepEqual(ui.recent, []);
  assert.deepEqual(ui.aiBegins, [{ path: "A", fileIds: ["A-doc"] }]);
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0], /打开作品失败：.*读取文档失败：正文读取失败/);
});

function assertNoOpenEffects(ui: Fixture): void {
  assert.deepEqual(ui.writing, []);
  assert.deepEqual(ui.recent, []);
  assert.deepEqual(ui.aiBegins, [{ path: "A", fileIds: ["A-doc"] }]);
}

function assertOldEditor(ui: Fixture, old: EditableAdapter, text = "A 正文"): void {
  assertProject(ui, "A", text);
  assert.equal(ui.adapters.length, 1);
  assert.equal(ui.adapters[0], old);
  assert.equal(old.destroyed, false);
  assert.equal(ui.dom.editorTextarea.firstChild, old.node);
}

test("created directory survives failed body load; duplicate create is blocked and openPath retries it", { timeout: 5000 }, async (t) => {
  const createdPath = "D:\\作品\\B";
  let bodyAttempts = 0;
  const ui = fixture({
    services: {
      createProject: async (name, location) => {
        assert.equal(name, "B");
        assert.equal(location, "D:\\作品");
        return createdPath;
      },
      openContentTree: async (path) => { assert.equal(path, createdPath); return project("B").tree; },
      openProject: async (path) => { assert.equal(path, createdPath); return openResult("B"); },
    },
    readDocument: async (path, id) => {
      if (path === "A") return notebookJson("A 正文");
      assert.equal(path, createdPath);
      assert.equal(id, "B-doc");
      bodyAttempts += 1;
      if (bodyAttempts === 1) throw new Error("新建正文装载失败");
      return notebookJson("B 正文");
    },
  });
  t.after(() => ui.restore());
  await loadA(ui);
  const old = ui.adapters[0];
  ui.dom.btnNewProject.click();
  ui.dom.projectNameInput.value = "B";
  ui.dom.saveLocationInput.value = "D:\\作品";
  const result = await settled(ui.flow.create(), "目录创建成功但正文读取失败");
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.match(String(result.error), /新建正文装载失败/);
  assertOldEditor(ui, old);
  assertReleased(ui);
  assertNoOpenEffects(ui);
  assert.equal(old.paused, false);
  assert.equal(ui.dom.nameError.classList.contains("hidden"), false);
  assert.match(ui.dom.nameError.textContent ?? "", /作品已创建，但未能打开/);
  assert.ok(ui.dom.nameError.textContent?.includes(`文件夹：${createdPath}`));
  assert.equal(ui.dom.btnCreateProject.disabled, true);
  assert.equal(ui.dom.projectNameInput.disabled, true);
  assert.equal(ui.dom.saveLocationInput.disabled, true);
  assert.deepEqual(await settled(ui.flow.create(), "重复 create 不再创建目录"), { status: "cancelled" });
  assert.deepEqual(ui.created, [["B", "D:\\作品"]]);
  assert.equal(bodyAttempts, 1);

  assert.deepEqual(await settled(ui.flow.openPath(createdPath), "openPath 重试已创建目录"), { status: "committed" });
  assert.equal(bodyAttempts, 2);
  assert.deepEqual(ui.created, [["B", "D:\\作品"]]);
  assert.deepEqual(ui.openedPaths, [createdPath]);
  assert.equal(ui.editor.getProjectPath(), createdPath);
  assert.deepEqual(ui.editor.getTree(), project("B").tree);
  assert.equal(ui.editor.getCurrentDocumentId(), "B-doc");
  assert.equal(ui.dom.editorTextarea.textContent, "B 正文");
  assert.deepEqual(ui.fileIds(), ["B-doc"]);
  assert.equal(old.destroyed, true);
  assert.equal(ui.adapters.length, 2);
  assert.deepEqual(ui.writing, [createdPath]);
  assert.deepEqual(ui.recent, [["B", createdPath]]);
  assert.deepEqual(ui.aiBegins, [
    { path: "A", fileIds: ["A-doc"] },
    { path: createdPath, fileIds: ["B-doc"] },
  ]);
  assert.deepEqual(ui.alerts, []);
  assertReleased(ui);
});

for (const order of ["save-first", "structure-first"] as const) {
  test(`same-path reopen waits for save and issued structural write (${order}), rejects late old refresh`, { timeout: 5000 }, async (t) => {
    const saving = deferred<void>();
    const structuralWrite = deferred<string>();
    const oldRefresh = deferred<ProjectTreeState["tree"]>();
    const events: string[] = [];
    const newTree = project("A").tree;
    newTree.root_children.push("new-doc");
    newTree.nodes["new-doc"] = { id: "new-doc", name: "写入完成后的新文档", kind: "Document", children: [] };
    let diskBody = notebookJson("A 正文");
    let oldRefreshCalls = 0;
    let freshTreeCalls = 0;
    const ui = fixture({
      choose: async () => "save-and-leave",
      readDocument: async (path, id) => {
        assert.equal(path, "A");
        assert.equal(id, "A-doc");
        events.push("read-body");
        return diskBody;
      },
      saveDocument: async (path, id, content) => {
        assert.equal(path, "A");
        assert.equal(id, "A-doc");
        events.push("save-start");
        await saving.promise;
        diskBody = content;
        events.push("save-end");
      },
      fileServices: {
        createDocument: async (path, parent) => {
          assert.equal(path, "A");
          assert.equal(parent, null);
          events.push("structure-start");
          const id = await structuralWrite.promise;
          events.push("structure-end");
          return id;
        },
        openContentTree: async (path) => {
          assert.equal(path, "A");
          oldRefreshCalls += 1;
          events.push("old-refresh-start");
          return oldRefresh.promise;
        },
      },
      services: {
        openProject: async (path) => {
          assert.equal(path, "A");
          events.push("open-stale-metadata");
          return openResult("A");
        },
        openContentTree: async (path) => {
          assert.equal(path, "A");
          freshTreeCalls += 1;
          events.push("fresh-tree");
          assert.ok(events.includes("save-end"), "不得在保存完成前重读树");
          assert.ok(events.includes("structure-end"), "不得在已发结构写入完成前重读树");
          return newTree;
        },
      },
    });
    t.after(() => ui.restore());
    await loadA(ui);
    const old = ui.adapters[0];
    old.edit("A 已保存的新正文");
    assert.equal(ui.editor.hasUnsavedChanges(), true);
    // 真实文件管理入口先发出结构写入，然后再从工作区入口请求重开。
    ui.dom.fmNewDocument.click();
    await flushUntil(() => events.includes("structure-start"), "文件管理 createDocument 已发出");
    const opening = ui.flow.openPath("A");
    await flushUntil(() => events.includes("save-start"), "dirty 离开授权启动保存");
    assertOldEditor(ui, old, "A 已保存的新正文");
    assert.deepEqual(ui.choices, ["save-and-leave"]);
    assert.equal(old.paused, true);
    assert.equal(ui.flow.isBusy(), true);
    assert.equal(freshTreeCalls, 0);
    assert.equal(ui.reads.length, 1);
    assertNoOpenEffects(ui);

    if (order === "save-first") {
      saving.resolve();
      await flushUntil(() => events.includes("save-end"), "保存先完成");
      // 给本轮 promise continuation 完整运行机会；不以任意毫秒 sleep 判断顺序。
      await nextTurn();
      assert.equal(freshTreeCalls, 0, "仍在等已发结构写入");
      assert.equal(ui.reads.length, 1);
      assert.equal(ui.flow.isBusy(), true);
      assertOldEditor(ui, old, "A 已保存的新正文");
      structuralWrite.resolve("new-doc");
    } else {
      structuralWrite.resolve("new-doc");
      await flushUntil(() => oldRefreshCalls === 1, "结构写入先完成并发起旧装载的树刷新");
      await nextTurn();
      assert.equal(freshTreeCalls, 0, "仍在等正文保存");
      assert.equal(ui.reads.length, 1);
      assert.equal(ui.flow.isBusy(), true);
      assertOldEditor(ui, old, "A 已保存的新正文");
      saving.resolve();
    }

    assert.deepEqual(await settled(opening, "保存与结构写入均完成后重开 A"), { status: "committed" });
    assert.equal(freshTreeCalls, 1);
    assert.equal(oldRefreshCalls, 1);
    assert.equal(ui.saves.length, 1);
    assert.deepEqual(JSON.parse(ui.saves[0][2]).document, paragraphDoc("A 已保存的新正文"));
    assert.deepEqual(ui.reads, [["A", "A-doc"], ["A", "A-doc"]]);
    assert.ok(events.indexOf("fresh-tree") > events.indexOf("save-end"));
    assert.ok(events.indexOf("fresh-tree") > events.indexOf("structure-end"));
    assert.ok(events.lastIndexOf("read-body") > events.indexOf("fresh-tree"));
    assert.equal(ui.editor.getProjectPath(), "A");
    assert.deepEqual(ui.editor.getTree(), newTree);
    assert.deepEqual(ui.fileIds(), ["A-doc", "new-doc"]);
    assert.deepEqual(ui.editor.getCurrentEditor()?.getDocument(), paragraphDoc("A 已保存的新正文"));
    assert.equal(ui.dom.editorTextarea.textContent, "A 已保存的新正文");
    assert.equal(ui.editor.hasUnsavedChanges(), false);
    assert.equal(old.destroyed, true);
    assert.equal(ui.adapters.length, 2);
    assert.deepEqual(ui.writing, ["A"]);
    assert.deepEqual(ui.recent, [["A", "A"]]);
    assert.deepEqual(ui.aiBegins, [
      { path: "A", fileIds: ["A-doc"] },
      { path: "A", fileIds: ["A-doc", "new-doc"] },
    ]);
    assertReleased(ui);

    // 旧装载的刷新最后才到达；不能覆盖已提交的新树或触发额外 AI 初始化。
    oldRefresh.resolve(project("STALE").tree);
    await nextTurn();
    assert.deepEqual(ui.treeChanges, [], "旧装载刷新不得发布到宿主");
    assert.deepEqual(ui.editor.getTree(), newTree);
    assert.deepEqual(ui.fileIds(), ["A-doc", "new-doc"]);
    assert.equal(ui.editor.getCurrentDocumentId(), "A-doc");
    assert.equal(ui.dom.editorTextarea.firstChild, ui.adapters[1].node);
    assert.equal(ui.dom.editorTextarea.textContent, "A 已保存的新正文");
    assert.equal(ui.adapters[1].destroyed, false);
    assert.equal(ui.reads.length, 2);
    assert.equal(oldRefreshCalls, 1);
    assert.deepEqual(ui.writing, ["A"]);
    assert.deepEqual(ui.recent, [["A", "A"]]);
    assert.equal(ui.aiBegins.length, 2);
    assert.deepEqual(ui.alerts, []);
  });
}

test("same-path reopen with failed save preserves dirty A and never rereads candidate tree or body", { timeout: 5000 }, async (t) => {
  const saving = deferred<void>();
  let treeReads = 0;
  const ui = fixture({
    choose: async () => "save-and-leave",
    saveDocument: async () => saving.promise,
    services: {
      openProject: async (path) => { assert.equal(path, "A"); return openResult("A"); },
      openContentTree: async () => { treeReads += 1; return project("A").tree; },
    },
  });
  t.after(() => ui.restore());
  await loadA(ui);
  const old = ui.adapters[0];
  old.edit("A 未保存修改");
  assert.equal(ui.editor.hasUnsavedChanges(), true);
  const opening = ui.flow.openPath("A");
  await flushUntil(() => ui.saves.length === 1, "同路径重开等待保存");
  assert.equal(ui.flow.isBusy(), true);
  assertOldEditor(ui, old, "A 未保存修改");
  assert.equal(treeReads, 0);
  saving.reject(new Error("磁盘写入失败"));
  const result = await settled(opening, "保存失败后保留 A");
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.match(String(result.error), /保存失败.*磁盘写入失败/);
  assertOldEditor(ui, old, "A 未保存修改");
  assert.equal(old.paused, false);
  assert.equal(ui.editor.hasUnsavedChanges(), true);
  assert.deepEqual(ui.choices, ["save-and-leave"]);
  assert.equal(treeReads, 0);
  assert.deepEqual(ui.reads, [["A", "A-doc"]]);
  assertNoOpenEffects(ui);
  assertReleased(ui);
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0], /保存失败.*磁盘写入失败/);
});

test("real leave cancel restores only after resume, navigation unlock and flow release", async (t) => {
  const ui = fixture({ realLeaveDialog: true });
  t.after(() => ui.restore());
  await loadA(ui);
  const old = ui.adapters[0];
  old.edit("A 未保存修改");
  ui.dom.btnBackWelcome.focus();
  const focused: Array<{ paused: boolean; disabled: boolean; busy: boolean }> = [];
  ui.dom.btnBackWelcome.addEventListener("focus", () => {
    focused.push({ paused: old.paused, disabled: ui.dom.btnBackWelcome.disabled, busy: ui.flow.isBusy() });
  });
  const leaving = ui.flow.backToWelcome();
  await flushUntil(() => ui.dom.leaveDialog.open, "真实离开框打开");
  old.selection = { anchor: 2, head: 2 };
  ui.dom.btnCancelLeave.click();
  assert.deepEqual(await leaving, { status: "cancelled" });
  assert.deepEqual(focused, [{ paused: false, disabled: false, busy: false }]);
  assert.equal(ui.dom.btnBackWelcome.ownerDocument.activeElement, ui.dom.btnBackWelcome);
  assert.deepEqual(old.selection, { anchor: 3, head: 1 });
  assertOldEditor(ui, old, "A 未保存修改");
  assert.equal(ui.editor.hasUnsavedChanges(), true);
});

for (const entry of ["open", "create"] as const) {
  test(`${entry} cancellation restores editor only after all flow locks are cleared`, async (t) => {
    const ui = fixture({ realLeaveDialog: true });
    t.after(() => ui.restore());
    await loadA(ui);
    const old = ui.adapters[0];
    old.edit("A 未保存修改");
    old.node.focus();
    ui.dom.projectNameInput.value = "B";
    ui.dom.saveLocationInput.value = "unused";
    const pending = entry === "open" ? ui.flow.openPath("B") : ui.flow.create();
    await flushUntil(() => ui.dom.leaveDialog.open, "打开真实离开框");
    old.selection = { anchor: 2, head: 2 };
    ui.dom.btnCancelLeave.click();
    assert.equal((await pending).status, "cancelled");
    assert.equal(ui.dom.editorPage.ownerDocument.activeElement, old.node);
    assert.deepEqual(old.selection, { anchor: 3, head: 1 });
    assert.ok(ui.restorations.length > 0);
    assert.ok(ui.restorations.every((r) => !r.paused && !r.disabled && !r.busy));
    assert.equal(ui.restorations.filter((r) => r.syncDOM).length, 1);
    assertOldEditor(ui, old, "A 未保存修改");
    assert.equal(ui.editor.hasUnsavedChanges(), true);
  });
}

test("failed candidate restores the original editor after the open flow is unlocked", async (t) => {
  const ui = fixture({ realLeaveDialog: true });
  t.after(() => ui.restore());
  await loadA(ui);
  const old = ui.adapters[0];
  old.edit("A 未保存修改"); old.node.focus();
  const opening = ui.flow.openPath("B");
  await flushUntil(() => ui.dom.leaveDialog.open, "授权框");
  ui.dom.btnDiscardAndLeave.click();
  await flushUntil(() => ui.readDeferred.has("B"), "候选正文读取");
  old.selection = { anchor: 2, head: 2 };
  ui.readDeferred.get("B")!.reject(new Error("读取失败"));
  assert.equal((await opening).status, "failed");
  assertOldEditor(ui, old, "A 未保存修改");
  assert.equal(ui.editor.hasUnsavedChanges(), true);
  assert.equal(ui.dom.editorPage.ownerDocument.activeElement, old.node);
  assert.deepEqual(old.selection, { anchor: 3, head: 1 });
  assert.ok(ui.restorations.every((r) => !r.paused && !r.disabled && !r.busy));
  assert.equal(ui.restorations.filter((r) => r.syncDOM).length, 1);
});

for (const outcome of ["commit", "unload"] as const) {
  test(`successful ${outcome} discards old focus and selection recovery`, async (t) => {
    const ui = fixture({ realLeaveDialog: true });
    t.after(() => ui.restore());
    await loadA(ui);
    const old = ui.adapters[0];
    old.edit("A 未保存修改"); old.node.focus();
    const pending = outcome === "commit" ? ui.flow.openPath("B") : ui.flow.backToWelcome();
    await flushUntil(() => ui.dom.leaveDialog.open, "授权框");
    ui.dom.btnDiscardAndLeave.click();
    if (outcome === "commit") {
      await flushUntil(() => ui.readDeferred.has("B"), "候选正文读取");
      ui.readDeferred.get("B")!.resolve(notebookJson("B 正文"));
    }
    assert.equal((await pending).status, "committed");
    assert.equal(old.destroyed, true);
    assert.equal(ui.restorations.length, 0);
    assert.notEqual(ui.dom.editorPage.ownerDocument.activeElement, old.node);
  });
}

test("AI input takeover preserves its DOM selection while restoring only the kernel selection", async (t) => {
  const ui = fixture({ realLeaveDialog: true });
  t.after(() => ui.restore());
  await loadA(ui);
  const old = ui.adapters[0];
  old.edit("A 未保存修改"); old.node.focus();
  const input = ui.dom.editorPage.ownerDocument.createElement("textarea");
  ui.dom.editorPage.append(input);
  input.value = "AI 临时问题";
  const pending = ui.flow.backToWelcome();
  await flushUntil(() => ui.dom.leaveDialog.open, "授权框");
  old.selection = { anchor: 2, head: 2 };
  input.focus(); input.setSelectionRange(1, 4, "backward");
  ui.dom.btnCancelLeave.click();
  assert.equal((await pending).status, "cancelled");
  assert.equal(input.ownerDocument.activeElement, input);
  assert.equal(input.selectionStart, 1);
  assert.equal(input.selectionEnd, 4);
  assert.equal(input.selectionDirection, "backward");
  assert.deepEqual(old.selection, { anchor: 3, head: 1 });
  assert.equal(ui.restorations.length, 1);
  assert.equal(ui.restorations[0].syncDOM, false);
});

test("old release and notify(false) reentry never recover over the new owner", async (t) => {
  const ui = fixture();
  t.after(() => ui.restore());
  await loadA(ui);
  const old = ui.adapters[0]; old.node.focus();
  const owner = ui.editor.beginWorkspaceTransition("first")!;
  await owner.protect();
  const input = ui.dom.editorPage.ownerDocument.createElement("textarea");
  ui.dom.editorPage.append(input);
  let next: ReturnType<typeof ui.editor.beginWorkspaceTransition> = null;
  let protection: Promise<void> | null = null;
  const unsubscribe = ui.editor.onTransitionChanged((busy) => {
    if (busy || next) return;
    next = ui.editor.beginWorkspaceTransition("second");
    protection = next!.protect();
    input.focus();
  });
  owner.release();
  await protection;
  owner.release();
  assert.equal(ui.restorations.length, 0);
  assert.equal(old.paused, true);
  assert.equal(input.ownerDocument.activeElement, input);
  unsubscribe();
  assert.ok(next);
  (next as WorkspaceTransition).release();
  assert.equal(old.paused, false);
  assert.equal(input.ownerDocument.activeElement, input);
});

for (const unavailable of ["disabled", "inert", "disconnected"] as const) {
  test(`an original ${unavailable} target does not cause an editor focus fallback`, async (t) => {
    const ui = fixture({ realLeaveDialog: true });
    t.after(() => ui.restore());
    await loadA(ui);
    const old = ui.adapters[0]; old.edit("A 未保存修改");
    const button = ui.dom.editorPage.ownerDocument.createElement("button");
    ui.dom.editorPage.append(button); button.focus();
    const pending = ui.flow.backToWelcome();
    await flushUntil(() => ui.dom.leaveDialog.open, "授权框");
    if (unavailable === "disabled") button.disabled = true;
    else if (unavailable === "inert") button.inert = true;
    else button.remove();
    ui.dom.btnCancelLeave.click();
    await pending;
    assert.ok(ui.restorations.length > 0);
    assert.ok(ui.restorations.every((r) => !r.syncDOM));
    assert.notEqual(button.ownerDocument.activeElement, old.node);
  });
}

test("backToWelcome cancellation retains dirty A; authorized exit unloads both sides without open effects", { timeout: 5000 }, async (t) => {
  let choice: LeaveChoice = "cancel";
  const ui = fixture({ choose: async () => choice });
  t.after(() => ui.restore());
  await loadA(ui);
  const old = ui.adapters[0];
  old.edit("A 未保存修改");
  assert.deepEqual(await settled(ui.flow.backToWelcome(), "取消返回欢迎页"), { status: "cancelled" });
  assertOldEditor(ui, old, "A 未保存修改");
  assert.equal(old.paused, false);
  assert.equal(ui.editor.hasUnsavedChanges(), true);
  assert.equal(ui.dom.editorPage.classList.contains("hidden"), false);
  assert.equal(ui.dom.welcomePage.classList.contains("hidden"), true);
  assert.equal(ui.lifecycle.exportUnloads, 0);
  assert.equal(ui.lifecycle.aiEnds, 0);
  assertReleased(ui);
  assertNoOpenEffects(ui);

  choice = "discard-and-leave";
  const recentLoads = ui.lifecycle.recentLoads;
  // 成功路径直接点击真实返回按钮，而不是替换卸载方法。
  ui.dom.btnBackWelcome.click();
  await flushUntil(() => ui.lifecycle.exportUnloads === 1 && !ui.flow.isBusy(), "确认离开后两侧卸载");
  assert.equal(ui.editor.hasProject(), false);
  assert.equal(ui.editor.getProjectPath(), null);
  assert.equal(ui.editor.getTree(), null);
  assert.equal(ui.editor.getCurrentDocumentId(), null);
  assert.equal(ui.editor.getCurrentEditor(), null);
  assert.equal(ui.editor.hasUnsavedChanges(), false);
  assert.deepEqual(ui.fileIds(), []);
  assert.equal(ui.dom.fmFileTree.childNodes.length, 0);
  assert.equal(ui.dom.fmRecycleList.childNodes.length, 0);
  assert.equal(old.destroyed, true);
  assert.equal(ui.lifecycle.aiEnds, 1);
  assert.equal(ui.lifecycle.exportUnloads, 1);
  assert.equal(ui.lifecycle.recentLoads, recentLoads + 1);
  assert.equal(ui.dom.welcomePage.classList.contains("hidden"), false);
  assert.equal(ui.dom.editorPage.classList.contains("hidden"), true);
  assert.deepEqual(ui.choices, ["cancel", "discard-and-leave"]);
  assert.deepEqual(ui.saves, []);
  assert.deepEqual(ui.openedPaths, []);
  assertNoOpenEffects(ui);
  assertReleased(ui);
  assert.deepEqual(ui.alerts, []);
});

test("destroy during B body read prevents late completion from reviving either workspace side", { timeout: 5000 }, async (t) => {
  const ui = fixture();
  t.after(() => ui.restore());
  await loadA(ui);
  const old = ui.adapters[0];
  const opening = ui.flow.openPath("B");
  await assertPendingB(ui);
  ui.flow.destroy();
  const htmlAfterDestroy = ui.dom.editorPage.innerHTML;
  assert.equal(old.destroyed, true);
  assert.equal(ui.editor.getProjectPath(), null);
  assert.equal(ui.editor.getCurrentEditor(), null);
  assert.deepEqual(ui.fileIds(), []);

  ui.readDeferred.get("B")!.resolve(notebookJson("B 正文"));
  assert.deepEqual(await settled(opening, "销毁后迟到正文失效"), { status: "stale" });
  assert.equal(ui.editor.hasProject(), false);
  assert.equal(ui.editor.getTree(), null);
  assert.equal(ui.editor.getCurrentDocumentId(), null);
  assert.equal(ui.editor.getCurrentEditor(), null);
  assert.equal(ui.adapters.length, 1, "销毁后不得构建 B 编辑器");
  assert.deepEqual(ui.fileIds(), []);
  assert.equal(ui.dom.editorPage.innerHTML, htmlAfterDestroy);
  assertNoOpenEffects(ui);
  assert.deepEqual(ui.alerts, []);
  assert.deepEqual(await settled(ui.flow.openPath("B"), "销毁后入口不再可用"), { status: "busy" });
});

for (const outcome of ["success", "failure"] as const) {
  test(`recent-work DOM click uses workspace coordinator (${outcome})`, { timeout: 5000 }, async (t) => {
    const ui = fixture({ services: {
      loadRecentWorks: async () => [{ name: "B", path: "B", last_opened_at: "2026-09-24T00:00:00Z" }],
    } });
    t.after(() => ui.restore());
    await loadA(ui);
    const old = ui.adapters[0];
    await flushUntil(() => ui.dom.recentWorksList.children.length === 1, "真实最近作品条目渲染");
    const item = ui.dom.recentWorksList.querySelector<HTMLButtonElement>("button.recent-work-item");
    assert.ok(item);
    assert.equal(item.title, "B");
    item.click();
    await assertPendingB(ui);
    assert.equal(item.disabled, true);
    if (outcome === "success") ui.readDeferred.get("B")!.resolve(notebookJson("B 正文"));
    else ui.readDeferred.get("B")!.reject(new Error("最近作品正文读取失败"));
    await flushUntil(() => !ui.flow.isBusy(), `最近作品 click ${outcome} 流程结束`);
    assertReleased(ui);
    assert.equal(item.disabled, false);
    assert.deepEqual(ui.openedPaths, ["B"]);
    if (outcome === "success") {
      assertProject(ui, "B");
      assert.equal(old.destroyed, true);
      assert.equal(ui.adapters.length, 2);
      assert.equal(ui.dom.editorTextarea.firstChild, ui.adapters[1].node);
      assert.deepEqual(ui.writing, ["B"]);
      assert.deepEqual(ui.recent, [["B", "B"]]);
      assert.deepEqual(ui.aiBegins, [
        { path: "A", fileIds: ["A-doc"] },
        { path: "B", fileIds: ["B-doc"] },
      ]);
      assert.deepEqual(ui.alerts, []);
    } else {
      assertOldEditor(ui, old);
      assert.equal(old.paused, false);
      assertNoOpenEffects(ui);
      assert.equal(ui.alerts.length, 1);
      assert.match(ui.alerts[0], /打开作品失败：.*最近作品正文读取失败/);
    }
  });
}
