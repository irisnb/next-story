// cdp-client.mjs — 复用型 WebView2 CDP 客户端（browser_* 插件不可用时的直接 websocket 路径）。
// 只读几何与 DOM 状态；不读取正文、不读取输入值、不读取配置；不写入用户项目。
// 用法（作为模块）：
//   import { connect } from './cdp-client.mjs';
//   const cdp = await connect(9225);
//   const value = await cdp.evaluate(`1+1`);
//   await cdp.screenshot('out/name.png');
//   cdp.close();
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export async function connect(port = 9225) {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
  const target = list.find(t => t.type === 'page' && t.title.includes('Next Story')) ?? list.find(t => t.type === 'page');
  if (!target) throw new Error('No real Next Story CDP page on port ' + port);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const consoleErrors = [];
  const dialogs = [];
  let dialogPolicy = null; // null | 'accept' | 'dismiss'
  let seq = 0;
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const p = pending.get(message.id);
      clearTimeout(p.timer);
      pending.delete(message.id);
      message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text ?? 'exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map(a => a.description ?? a.value ?? a.type).join(' ').slice(0, 600));
    }
    if (message.method === 'Page.javascriptDialogOpening') {
      dialogs.push({ type: message.params.type, message: message.params.message });
      if (dialogPolicy !== null) {
        send('Page.handleJavaScriptDialog', { accept: dialogPolicy === 'accept' })
          .catch(err => consoleErrors.push('dialog handle failed: ' + err.message));
      }
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket error')), { once: true });
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: 8s timeout`)); }, 8000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  }
  const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  async function click(selector) {
    const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
    if (!p) throw new Error(`Click target not visible: ${selector}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, ...p, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
    await pause(180);
  }
  async function hover(selector) {
    const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
    if (!p) throw new Error(`Hover target not visible: ${selector}`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
    await pause(120);
  }
  async function key(key, code, vk) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    await pause(150);
  }
  // 在当前焦点处插入文本（类 IME 提交，支持中文）；不读取、不打印内容。
  async function insertText(text) {
    await send('Input.insertText', { text });
    await pause(80);
  }
  // 在指定元素上聚焦并清空后插入文本（用于把普通文本填入受控 input）。
  async function fillText(selector, text) {
    await click(selector);
    await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return; e.value=''; e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await insertText(text);
    await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(e) e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await pause(80);
  }
  // 把环境变量的值插入当前焦点（值不进日志），只返回长度；键不存在返回 null。
  async function insertEnv(name) {
    const secret = process.env[name] ?? '';
    if (!secret) return null;
    await send('Input.insertText', { text: secret });
    await pause(80);
    return { name, length: secret.length };
  }
  async function screenshot(file) {
    mkdirSync(dirname(file), { recursive: true });
    const image = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(image.data, 'base64'));
    return file;
  }
  await send('Runtime.enable');
  await send('Page.enable');
  const setDialogPolicy = (policy) => { dialogPolicy = policy; };
  return { target: { id: target.id, url: target.url, title: target.title }, send, evaluate, pause, click, hover, key, insertText, fillText, insertEnv, screenshot, consoleErrors, dialogs, setDialogPolicy, close: () => ws.close() };
}
