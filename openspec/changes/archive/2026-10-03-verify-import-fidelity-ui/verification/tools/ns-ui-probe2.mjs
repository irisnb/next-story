// 只读补充探针：页面目标清单＋欢迎页最近作品＋可见文本概要
const BASE = "http://127.0.0.1:9222";
function die(m){ console.error("PROBE_FAIL "+m); process.exit(1); }
const w = setTimeout(() => die("看门狗超时"), 8000); w.unref?.();
const list = await fetch(`${BASE}/json/list`).then(r=>r.json());
console.log("--- targets ---");
for (const t of list) console.log(JSON.stringify({type:t.type,title:t.title,url:t.url}));
const target = list.find(t => t.type === "page" && t.title.includes("Next Story"));
if (!target) die("无 Next Story 页面");
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq=0; const pending=new Map();
const send=(m,p={})=>new Promise((res,rej)=>{const id=++seq;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method:m,params:p}));});
ws.addEventListener("message",ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}});
await new Promise((res,rej)=>{ws.addEventListener("open",res);ws.addEventListener("error",()=>rej(new Error("ws fail")))});
const ev=async(e)=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true});if(r.exceptionDetails)die(JSON.stringify(r.exceptionDetails).slice(0,400));return r.result?.value;};
const recent = await ev(`JSON.stringify((() => {
  const listEl = document.querySelector("#recent-works-list");
  const rows = listEl ? [...listEl.querySelectorAll("*")].filter(el => el.childElementCount === 0 && (el.textContent||"").trim()) : [];
  const empty = document.querySelector("#recent-works-empty");
  return {
    emptyHidden: empty ? empty.classList.contains("hidden") : null,
    rows: rows.map(el => (el.textContent||"").trim()).slice(0,20)
  };
})())`);
console.log("--- recent works ---"); console.log(recent);
const welcomeText = await ev(`(() => {
  const el = document.querySelector("#welcome-page");
  return el ? (el.innerText || "").replace(/\\s+/g, " ").slice(0, 600) : null;
})()`);
console.log("--- welcome visible text (truncated) ---"); console.log(welcomeText);
ws.close(); process.exit(0);
