import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const output = join(directory, 'v5-parity-pages-screens');
mkdirSync(output, { recursive: true });
const evidence = { started: new Date().toISOString(), stages: [], errors: [] };
const targets = await fetch('http://127.0.0.1:9223/json/list', { signal: AbortSignal.timeout(5000) }).then(r => r.json());
const target = targets.find(t => t.type === 'page' && t.title.includes('Next Story'));
if (!target) throw new Error('No real Next Story page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (entry) {
    clearTimeout(entry.timer); pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') evidence.errors.push(message.params.exceptionDetails.text);
});
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: timeout`)); }, 8000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function click(selector) {
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
  if (!point) throw new Error(`Not visible: ${selector}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  }
  await pause(250);
}
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.reload'); await pause(1200);
  if (!await evaluate(`!document.getElementById('welcome-page').classList.contains('hidden')`)) throw new Error('Expected home; refuse unknown project');
  await click('#btn-new-project'); await click('#project-name');
  const name = `UI-v5-pages-${Date.now()}`;
  evidence.projectName = name;
  await send('Input.insertText', { text: name });
  await evaluate(`(()=>{const e=document.getElementById('save-location');e.value='C:/Users/Administrator/AppData/Local/Temp/opencode';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('project-name').dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('#btn-create-project');
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`document.getElementById('current-project-name').textContent===${JSON.stringify(name)}`)) break;
    await pause(200);
  }
  if (!await evaluate(`document.getElementById('current-project-name').textContent===${JSON.stringify(name)}`)) throw new Error('Temporary project create failed');
  for (const [width, height] of [[1024, 670], [1280, 720], [1440, 900]]) {
    const native = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(directory, 'v5-parity-resize.ps1'), '-ClientWidth', String(width), '-ClientHeight', String(height)], { encoding: 'utf8', timeout: 10000 }));
    await pause(300);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    if (!await evaluate(`innerWidth===${width}&&innerHeight===${height}`)) throw new Error('Page viewport did not reach requested size');
    for (const page of ['writing', 'files', 'making', 'settings']) {
      await click(`#tab-${page}`);
      const geometry = await evaluate(`(()=>{const ids=['btn-back-welcome','making-chain-library','making-inspector','making-graph','making-conversation-pane'];const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility==='visible'&&getComputedStyle(e).display!=='none';const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};const module=document.getElementById('module-${page}');return{viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,moduleVisible:visible(module),moduleScrollWidth:module?.scrollWidth,moduleClientWidth:module?.clientWidth,moduleHorizontalOverflow:module?module.scrollWidth>module.clientWidth+1:null,nodes:ids.map(id=>{const e=document.getElementById(id);return{id,visible:visible(e),rect:e?rect(e):null,scrollWidth:e?.scrollWidth,clientWidth:e?.clientWidth}}),visibleButtonsOutside:[...document.querySelectorAll('#module-${page} button')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(e=>e.id)}})()`);
      const screenshot = join(output, `${page}-${width}x${height}.png`);
      const image = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(screenshot, Buffer.from(image.data, 'base64'));
      evidence.stages.push({ page, size: [width, height], native, geometry, screenshot });
    }
  }
  evidence.limitations = ['Isolated empty project; no user document body read or changed; no model request.', 'Viewport explicitly set with CDP; native resize alone did not update WebView viewport, so native resize behavior remains unverified.', 'Global chain library remains untouched; populated graph and empty-library conversation are not certified.', 'Screenshots and geometry require separate visual comparison against the approved prototype.'];
} catch (error) {
  evidence.errors.push(error.message); process.exitCode = 1;
} finally {
  evidence.finished = new Date().toISOString();
  writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ stages: evidence.stages.map(s => ({ page: s.page, size: s.size, visibleButtonsOutside: s.geometry.visibleButtonsOutside, moduleHorizontalOverflow: s.geometry.moduleHorizontalOverflow })), errors: evidence.errors }, null, 2));
  ws.close();
}
