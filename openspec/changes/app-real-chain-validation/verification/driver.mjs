// CDP 驱动仪器（app-real-chain-validation 验证会话用；design D1 2026-09-21 修订）
// 前提：应用以 --remote-debugging-port=9222 启动（WebView2 调试通道）。
// 用法：node driver.mjs <command> [args...]
//   eval "<js表达式>"            — 在真实应用页面求值（returnByValue），输出 JSON
//   click "<css选择器>"          — 真实鼠标事件点击元素中心
//   clickText "<可见文本>" [序号] — 按可见文本找可点元素点击（默认第 0 个）
//   type "<css选择器>" "<文本>"   — 先点击聚焦，再 Input.insertText 插入（类 IME 提交，支持中文）
//   key "<键名>"                 — Enter／Escape／Backspace／Tab／ArrowUp 等
//   shot "<文件路径.png>"        — 页面截图存盘（证据留档）
//   wait "<js表达式>" [超时ms]   — 每 300ms 轮询直到表达式为真（默认 30000ms）
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:9222";

const KEY_MAP = {
  enter: { key: "Enter", code: "Enter", vk: 13 },
  escape: { key: "Escape", code: "Escape", vk: 27 },
  backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  tab: { key: "Tab", code: "Tab", vk: 9 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
};

function die(msg) {
  console.error("DRIVER_FAIL " + msg);
  process.exit(1);
}

// 看门狗：任何 CDP 调用 8 秒未返回则干净退出（渲染线程被系统对话框堵住时用）
const WATCHDOG_MS = 8000;
const watchdog = setTimeout(() => die("看门狗超时（页面线程可能被系统对话框阻塞）"), WATCHDOG_MS);
watchdog.unref?.();

async function connect() {
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
  return { ws, send };
}

async function evaluate(send, expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) die("页面求值异常: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
}

const RECT_EXPR = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`;

const TEXT_EXPR = (text, index) => `(() => {
  const want = ${JSON.stringify(text)};
  const els = [...document.querySelectorAll('button, [role=button], a, [class*=menu] *, [class*=btn] *')]
    .filter(el => (el.textContent || '').trim() === want && el.offsetParent !== null);
  const el = els[${index ?? 0}];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, matched: els.length };
})()`;

async function mouseClick(send, x, y) {
  const base = { x, y, button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
  await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  const { ws, send } = await connect();
  const done = (v) => {
    console.log(typeof v === "string" ? v : JSON.stringify(v));
    ws.close();
    process.exit(0);
  };

  if (cmd === "eval") {
    done(await evaluate(send, args[0]));
  } else if (cmd === "click") {
    const rect = await evaluate(send, RECT_EXPR(args[0]));
    if (!rect) die("元素不存在或不可见: " + args[0]);
    await mouseClick(send, rect.x, rect.y);
    done({ clicked: args[0], at: rect });
  } else if (cmd === "clickText") {
    const rect = await evaluate(send, TEXT_EXPR(args[0], Number(args[1] ?? 0)));
    if (!rect) die("按文本未找到可点元素: " + args[0]);
    await mouseClick(send, rect.x, rect.y);
    done({ clickedText: args[0], at: rect });
  } else if (cmd === "type") {
    const rect = await evaluate(send, RECT_EXPR(args[0]));
    if (!rect) die("输入目标不存在或不可见: " + args[0]);
    await mouseClick(send, rect.x, rect.y);
    await send("Input.insertText", { text: args[1] });
    done({ typed: args[1].slice(0, 30) + (args[1].length > 30 ? "…" : ""), into: args[0] });
  } else if (cmd === "insert") {
    // insert "<text>" — 不点击，直接在当前焦点处插入文本（需先 click/type 聚焦目标）
    await send("Input.insertText", { text: args[0] });
    done({ inserted: (args[0] ?? "").slice(0, 30) + (args[0]?.length > 30 ? "…" : "") });
  } else if (cmd === "insertEnv") {
    // insertEnv <ENV_VAR> — 在当前焦点/选区处插入环境变量的值；内容不进任何日志
    const secret = process.env[args[0]] ?? "";
    if (!secret) die("环境变量未设置: " + args[0]);
    await send("Input.insertText", { text: secret });
    done({ envVar: args[0], length: secret.length });
  } else if (cmd === "key") {
    const k = KEY_MAP[String(args[0] ?? "").toLowerCase()];
    if (!k) die("不支持的键: " + args[0]);
    for (const type of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", {
        type,
        key: k.key,
        code: k.code,
        windowsVirtualKeyCode: k.vk,
        nativeVirtualKeyCode: k.vk,
      });
    }
    done({ key: k.key });
  } else if (cmd === "dialog") {
    // dialog <true|false> [promptText] — 处置页面级 JS 对话框（alert/confirm/prompt）
    const accept = String(args[0]) === "true";
    const params = { accept };
    if (args[1] !== undefined) params.promptText = args[1];
    try {
      const r = await send("Page.handleJavaScriptDialog", params);
      done({ dialogHandled: params, result: r ?? null });
    } catch (e) {
      die("处置对话框失败（可能没有对话框）: " + e.message);
    }
  } else if (cmd === "shot") {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(args[0], Buffer.from(r.data, "base64"));
    done({ saved: args[0], bytes: r.data.length });
  } else if (cmd === "wait") {
    const deadline = Date.now() + Number(args[1] ?? 30000);
    while (Date.now() < deadline) {
      let v = null;
      try {
        v = await evaluate(send, args[0]);
      } catch {
        /* 轮询中异常视为未满足 */
      }
      if (v) done({ waited: true, value: v });
      await new Promise((r) => setTimeout(r, 300));
    }
    die("等待超时: " + args[0]);
  } else {
    die("未知命令: " + cmd);
  }
}

main().catch((e) => die(e.message));
