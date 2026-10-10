import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../../方向/前端UI暂存-2026-10-09');
const out = join(directory, 'v5-reference-screens');
const temporary = 'C:/Users/Administrator/AppData/Local/Temp/opencode';
if (!existsSync(temporary)) throw new Error('Approved temporary parent missing');
mkdirSync(out, { recursive: true });
const server = createServer((request, response) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!path.startsWith(root + '\\')) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader('Content-Type', ({'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png'})[extname(path)] ?? 'application/octet-stream');
    response.end(readFileSync(path));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(1428, '127.0.0.1', resolve));
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!edge) throw new Error('Edge unavailable');
const process = spawn(edge, ['--headless=new','--disable-gpu','--remote-debugging-port=9224',`--user-data-dir=${temporary}/v5-reference-${Date.now()}`,'http://127.0.0.1:1428/原型-v5/index.html'], { stdio:'ignore' });
let socket;
const evidence = { stages:[], errors:[], screenshots:[] };
try {
  let target;
  for (let i=0;i<50;i++) {
    try { target=(await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json())).find(t=>t.type==='page'); } catch {}
    if (target) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending=new Map(); let sequence=0;
  socket.addEventListener('message', event=>{ const message=JSON.parse(event.data); if(message.method==='Runtime.exceptionThrown') evidence.errors.push(message.params.exceptionDetails.text); const entry=pending.get(message.id); if(entry){pending.delete(message.id);message.error?entry.reject(new Error(JSON.stringify(message.error))):entry.resolve(message.result);} });
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;};
  const settle=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await send('Runtime.enable'); await send('Page.enable');
  for (const [width,height] of [[1024,670],[1280,720],[1440,900]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:'http://127.0.0.1:1428/原型-v5/index.html'});
    for(let i=0;i<30;i++){if(await evaluate("typeof showWorkspace==='function'"))break;await new Promise(r=>setTimeout(r,100));}
    await evaluate("showWorkspace('雨停之前','writing')"); await settle();
    for(const state of ['sidebar','maximized','restored','writing','files','making','settings']) {
      if(state==='maximized'||state==='restored')await evaluate("document.getElementById('expand-ai').click()");
      if(state==='writing')await evaluate("document.getElementById('close-ai').click()");
      if(['files','making','settings'].includes(state))await evaluate(`go(${JSON.stringify(state)})`);
      await settle();
      const metrics=await evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,client:e.clientWidth,scroll:e.scrollWidth}};return{viewport:[innerWidth,innerHeight],page:[...document.querySelectorAll('.page')].filter(e=>!e.hidden).map(e=>({id:e.id,...rect(e)})),nodes:['ai-panel','expand-ai','ai-form'].map(id=>({id,...rect(document.getElementById(id))})),focused,visible:aiVisible}})()`);
      const image=await send('Page.captureScreenshot',{format:'png'});
      const path=join(out,`${state}-${width}x${height}.png`);writeFileSync(path,Buffer.from(image.data,'base64'));
      evidence.screenshots.push(path); evidence.stages.push({state,size:[width,height],metrics});
    }
    // The browser parses the entire final CSS cascade, including long minified lines.
    evidence.focusedRules = await evaluate("[...document.styleSheets].flatMap(s=>[...s.cssRules]).filter(r=>r.cssText.includes('ai-focused')).map(r=>r.cssText)");
  }
  await send('Browser.close');
} catch(error) {evidence.errors.push(error.message);} finally {
  writeFileSync(join(out,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2)); socket?.close(); process.kill(); server.close();
}
