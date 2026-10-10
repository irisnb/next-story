import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const out=join(dirname(fileURLToPath(import.meta.url)),'v5-menu-screens');
mkdirSync(out,{recursive:true});
const target=(await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json())).find(t=>t.type==='page'&&t.title.includes('Next Story'));
const socket=new WebSocket(target.webSocketDebuggerUrl); const pending=new Map(); let sequence=0;
socket.addEventListener('message',event=>{const message=JSON.parse(event.data),entry=pending.get(message.id);if(entry){pending.delete(message.id);message.error?entry.reject(new Error(JSON.stringify(message.error))):entry.resolve(message.result);}});
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.text);return response.result.value;};
const settle=()=>evaluate('new Promise(resolve=>setTimeout(resolve,250))');
async function click(selector,button='left',clickCount=1) {
  const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
  if(!point)throw new Error('Not visible: '+selector);
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,button:type==='mouseMoved'?'none':button,clickCount});
  await settle();
}
const evidence={stages:[],errors:[],skips:[]};
async function capture(name,selector) {
  const geometry=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,viewport:[innerWidth,innerHeight],controls:[...e.querySelectorAll('input,select,button')].map(c=>({id:c.id,tag:c.tagName,disabled:c.disabled}))}})()`);
  if(geometry.width===0||geometry.x<0||geometry.x+geometry.width>geometry.viewport[0]+1||geometry.y+geometry.height>geometry.viewport[1]+1)throw new Error('Menu bounds failed: '+name);
  const image=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,name+'.png'),Buffer.from(image.data,'base64'));evidence.stages.push({name,geometry});
}
try {
  if(!await evaluate("/^UI-v5-(pages|toolbar-AI)-/.test(document.getElementById('current-project-name').textContent)"))throw new Error('Refuse unknown project');
  await click('#tab-files');
  await click('#fm-new-document');
  const fixtureId=await evaluate("[...document.querySelectorAll('.file-row')].filter(e=>e.querySelector('.file-document')).at(-1)?.dataset.nodeId");
  if(!fixtureId)throw new Error('No newly created isolated fixture document');
  await click(`.file-row[data-node-id="${fixtureId}"]`,'left',2);
  if(!await evaluate("!document.getElementById('module-writing').classList.contains('hidden')&&!!document.querySelector('.ProseMirror')"))throw new Error('Double-click did not enter writing');
  await click('.ProseMirror');
  await send('Input.insertText',{text:'UI 菜单验证用文本，非用户作品。'});
  await settle();
  if(await evaluate("document.getElementById('btn-save').disabled"))throw new Error('Fixture save unavailable');
  await click('#btn-save');
  for(let i=0;i<20;i++){if(await evaluate("document.getElementById('save-status').textContent==='已保存'"))break;await settle();}
  if(!await evaluate("document.getElementById('save-status').textContent==='已保存'"))throw new Error('Fixture save not confirmed');
  evidence.fixture={documentId:fixtureId,saved:true,source:'Mechanical input into a newly created document in the isolated UI-v5 project; no model request.'};
  evidence.native=[];
  await send('Emulation.clearDeviceMetricsOverride');
  for(const [width,height] of [[1024,670],[1280,720],[1440,900]]) {
    const native=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(dirname(fileURLToPath(import.meta.url)),'v5-parity-resize.ps1'),'-ClientWidth',String(width),'-ClientHeight',String(height)],{encoding:'utf8',timeout:10000}));
    await settle();
    evidence.native.push({requested:[width,height],native,viewport:await evaluate('[innerWidth,innerHeight]')});
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await click('#tab-writing');
    if(await evaluate("!!document.querySelector('.ProseMirror')"))await click('.ProseMirror');
    for(const tool of ['tool-size','tool-font','tool-style','tool-indent','tool-line','tool-color','tool-highlight','tool-link']) {
      await click('.ProseMirror');
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
      await settle();
      const available=await evaluate(`(()=>{const e=document.getElementById('${tool}');return{disabled:e?.disabled,visible:!!e?.getClientRects().length}})()`);
      if(available.disabled)throw new Error('Tool remains disabled with the saved fixture selected: '+tool);
      if(!available.visible)await click('.toolbar-overflow-trigger');
      await click('#'+tool);await capture(`${tool}-${width}x${height}`,'#writing-tool-options');
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await settle();
    }
    await click('#tab-files');
    if(await evaluate("!!document.querySelector('.file-row-more')")) {
      await click('.file-row-more');await capture(`file-menu-${width}x${height}`,'.file-row-menu:not(.hidden)');
      await click('.file-row-more');await click('.file-row','right');await capture(`file-context-${width}x${height}`,'.file-row-menu:not(.hidden)');
      await click('#tab-writing');
    }else evidence.skips.push({size:[width,height],reason:'Empty fixture has no file rows; file menu requires a populated isolated fixture.'});
    await send('Emulation.clearDeviceMetricsOverride');
  }
}catch(error){evidence.errors.push(error.message);process.exitCode=1;}finally{writeFileSync(join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));socket.close();}
