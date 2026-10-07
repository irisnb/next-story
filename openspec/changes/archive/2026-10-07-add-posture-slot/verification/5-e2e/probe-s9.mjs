// probe-s9.mjs — 只读：S9 崩溃后的制作对话现状（助手上轮文本＋草稿面板内容）
const BASE = "http://127.0.0.1:9222";
const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const t = list.find((x) => x.type === "page" && x.title.includes("Next Story"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
let seq = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener("open", r));
const r = await send("Runtime.evaluate", { expression: `(() => {
  const vis = (el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0;
  const msgs = [...document.querySelectorAll("#making-session-messages > *")].map((el) => ({
    cls: el.className.split(" ").slice(0, 2).join("."),
    isAssistant: el.classList.contains("making-msg-assistant"),
    isUser: el.classList.contains("making-msg-user"),
    text: (el.querySelector(".making-msg-text")?.textContent ?? "").trim(),
  }));
  return {
    chatVisible: vis(document.getElementById("making-conversation-pane")),
    convActive: vis(document.getElementById("making-conversation-active")),
    inputDisabled: document.getElementById("making-conversation-input")?.disabled ?? null,
    stopHidden: !document.getElementById("making-conversation-stop") || document.getElementById("making-conversation-stop").hidden,
    draftPanels: document.querySelectorAll("#making-session-messages .making-draft-panel").length,
    draftCards: [...document.querySelectorAll("#making-session-messages .making-draft-panel .making-draft-card")].map((c) => ({
      type: c.querySelector(".making-draft-type")?.textContent?.trim() ?? "",
      title: c.querySelector(".making-draft-card-title, .making-draft-title, h5, strong")?.textContent?.trim() ?? "",
      head: c.textContent.trim().slice(0, 80),
    })),
    lastAssistant: [...document.querySelectorAll("#making-session-messages .making-msg-assistant .making-msg-text")].at(-1)?.textContent ?? "",
    userMsgCount: msgs.filter((m) => m.isUser).length,
    assistantMsgCount: msgs.filter((m) => m.isAssistant).length,
  };
})()`, returnByValue: true });
const v = r.result.value;
console.log(JSON.stringify({ chatVisible: v.chatVisible, convActive: v.convActive, inputDisabled: v.inputDisabled, stopHidden: v.stopHidden, draftPanels: v.draftPanels, draftCards: v.draftCards, userMsgCount: v.userMsgCount, assistantMsgCount: v.assistantMsgCount }, null, 1));
console.log("--- lastAssistant (前1200字) ---");
console.log(v.lastAssistant.slice(0, 1200));
ws.close(); process.exit(0);
