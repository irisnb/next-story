// 只读 UI 状态探针（fix-import-fidelity 验收用）：
// 仅连接 CDP 并执行只读 Runtime.evaluate（纯 DOM 查询）。
// 无点击、无输入事件、无对话框处置、无截图、无文件写入（本文件自身除外，位于 %TEMP%\opencode）。
const BASE = "http://127.0.0.1:9222";

function die(msg) {
  console.error("PROBE_FAIL " + msg);
  process.exit(1);
}

const watchdog = setTimeout(() => die("看门狗超时（8 秒）"), 8000);
watchdog.unref?.();

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
if (!target) die("未找到 Next Story 页面目标（应用未启动或调试通道未开）");
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
await new Promise((res, rej) => {
  ws.addEventListener("open", res);
  ws.addEventListener("error", () => rej(new Error("WebSocket 连接失败")));
});

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) die("页面求值异常: " + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result?.value;
}

const EXPRESSIONS = [
  // [1] 全局态＋阻塞信号＋全部对话框＋导入预检对话框完整状态＋导入入口按钮
  `JSON.stringify((() => {
    const q = (s) => document.querySelector(s);
    const txt = (s) => { const el = q(s); return el ? el.textContent.trim() : null; };
    const d = q("#document-import-dialog");
    const importDlg = d ? {
      open: d.open,
      conclusion: txt("#document-import-conclusion"),
      structure: txt("#document-import-structure"),
      note: txt("#document-import-note"),
      lossesHidden: q("#document-import-losses") ? q("#document-import-losses").classList.contains("hidden") : null,
      lossItems: [...document.querySelectorAll("#document-import-loss-list li")].map((li) => li.textContent.trim()),
      errorLine: txt("#document-import-error"),
      confirmText: txt("#btn-document-import-confirm"),
      confirmDisabled: q("#btn-document-import-confirm") ? q("#btn-document-import-confirm").disabled : null,
      cancelDisabled: q("#btn-document-import-cancel") ? q("#btn-document-import-cancel").disabled : null
    } : null;
    const btn = q("#fm-import-document");
    return {
      url: location.href,
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      activeElement: document.activeElement ? (document.activeElement.tagName + "|" + (document.activeElement.id || document.activeElement.className || "")) : null,
      openDialogs: [...document.querySelectorAll("dialog[open]")].map((x) => x.id),
      allDialogs: [...document.querySelectorAll("dialog")].map((x) => ({ id: x.id, open: x.open })),
      importDialog: importDlg,
      importBtn: btn ? { text: btn.textContent.trim(), disabled: btn.disabled, title: btn.title } : null
    };
  })())`,

  // [2] 当前页面/作品/文档/编辑器/文件树状态（判断预检或提交是否发生过）
  `JSON.stringify((() => {
    const q = (s) => document.querySelector(s);
    const txt = (s) => { const el = q(s); return el ? el.textContent.trim() : null; };
    const welcome = q("#welcome-page");
    const editorPage = q("#editor-page");
    const editorEl = q("#editor-textarea");
    const paragraphs = editorEl ? [...editorEl.querySelectorAll(":scope > *")] : [];
    const tree = q("#fm-file-tree");
    const treeRows = tree ? [...tree.querySelectorAll("*")].filter((el) => el.childElementCount === 0 && (el.textContent || "").trim().length > 0) : [];
    return {
      welcomeHidden: welcome ? welcome.classList.contains("hidden") : null,
      editorPageHidden: editorPage ? editorPage.classList.contains("hidden") : null,
      projectName: txt("#current-project-name"),
      currentDocumentName: txt("#current-document-name"),
      editorParagraphCount: paragraphs.length,
      editorFirstTexts: paragraphs.slice(0, 6).map((p) => (p.textContent || "").trim().slice(0, 60)),
      editorTags: paragraphs.slice(0, 6).map((p) => p.tagName.toLowerCase() + (p.classList.contains("ProseMirror") ? ".ProseMirror" : "")),
      fileTreeRowTexts: [...new Set(treeRows.map((el) => (el.textContent || "").trim()))].slice(0, 40)
    };
  })())`,

  // [3] 文件管理区可见性＋导入按钮忙碌态细节＋保存按钮/未保存标记
  `JSON.stringify((() => {
    const q = (s) => document.querySelector(s);
    const btns = [...document.querySelectorAll("button")].map((b) => ({
      text: (b.textContent || "").trim(),
      disabled: b.disabled
    })).filter((b) => b.text.length > 0 && b.text.length < 24);
    const saveBtn = btns.find((b) => /保存/.test(b.text));
    return {
      importBusyLabel: btns.find((b) => /导入/.test(b.text)) || null,
      saveBtn: saveBtn || null,
      totalButtons: btns.length,
      prosemirrorEditable: (() => { const pm = q(".ProseMirror"); return pm ? { exists: true, contentEditable: pm.getAttribute("contenteditable"), childCount: pm.childElementCount } : { exists: false }; })()
    };
  })())`
];

const labels = ["global+dialogs", "project/doc/editor/tree", "buttons/editor-state"];
for (let i = 0; i < EXPRESSIONS.length; i++) {
  const value = await evaluate(EXPRESSIONS[i]);
  console.log(`--- [${i + 1}] ${labels[i]} ---`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 1));
}
ws.close();
process.exit(0);
