import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),out=join(dir,'v5-native-graph-screens');
mkdirSync(out,{recursive:true});
const evidence={started:new Date().toISOString(),native:[],graphs:[],errors:[],limitations:[]};
const t=(await(await fetch('http://127.0.0.1:9223/json/list')).json()).find(t=>t.type==='page'&&t.title==='Next Story');
const ws=new WebSocket(t.webSocketDebuggerUrl),pending=new Map();let sequence=0;
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'));},8000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
const settle=()=>new Promise(r=>setTimeout(r,700));
async function click(selector){const p=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);if(!p)throw new Error('Not visible '+selector);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:type==='mouseMoved'?'none':'left',clickCount:1});await settle();}
const win=(action,width=0,height=0)=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(dir,'v5-parity-resize.ps1'),'-Action',action,'-ClientWidth',String(width),'-ClientHeight',String(height)],{encoding:'utf8',timeout:10000}));
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,name+'.png'),Buffer.from(r.data,'base64'));}
const metric=()=>ev(`({viewport:[innerWidth,innerHeight],outer:[outerWidth,outerHeight],screen:[screen.width,screen.height],dpr:devicePixelRatio,visual:[visualViewport.width,visualViewport.height]})`);
try{
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Page.reload');await settle();
  await ev(`window.__v5ResizeEvents=[];window.addEventListener('resize',()=>window.__v5ResizeEvents.push({viewport:[innerWidth,innerHeight],at:Date.now()}));`);
  evidence.native.push({action:'initial',window:win('Inspect'),page:await metric()});
  for(const [action,w,h] of [['Restore',0,0],['Resize',1024,670],['Resize',1280,720],['Maximize',0,0],['Restore',0,0],['Resize',1440,900]]){
    const before=win(action,w,h);await settle();const window=win('Inspect'),page=await metric();await shot(`native-${evidence.native.length}-${action}-${w}x${h}`);
    evidence.native.push({action,requested:[w,h],before,window,page,resizeEvents:await ev('window.__v5ResizeEvents')});
  }
  // Only create a blank temporary project when on the home screen; never open recent user projects.
  if(await ev(`!document.getElementById('welcome-page').classList.contains('hidden')`)){
    await click('#btn-new-project');await click('#project-name');const name='UI-v5-pages-graph-'+Date.now();
    await send('Input.insertText',{text:name});
    await ev(`(()=>{const e=document.getElementById('save-location');e.value='C:/Users/Administrator/AppData/Local/Temp/opencode';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('project-name').dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('#btn-create-project');evidence.projectName=name;
  }
  if(!await ev(`/^UI-v5-/.test(document.getElementById('current-project-name').textContent)`))throw new Error('Refuse unknown project');
  await click('#tab-making');
  const rows=await ev(`[...document.querySelectorAll('.making-chain-row')].map(e=>({id:e.dataset.chainId,status:e.querySelector('.making-chain-row-status')?.textContent}))`);
  evidence.existingLibrary={mode:'Authorized read-only existing global chains; no activation, mutation, conversation start or model request',rows};
  if(!rows.length){evidence.limitations.push('Existing global library is empty; no populated graph available without storage mutation.');}
  else{
    await click('.making-chain-row');
    for(const [width,height] of [[1024,670],[1280,720],[1440,900]]){
      await send('Emulation.clearDeviceMetricsOverride');win('Resize',width,height);await settle();
      const native=win('Inspect'),nativePage=await metric(),nativeMatches=nativePage.viewport[0]===width&&nativePage.viewport[1]===height;
      if(!nativeMatches||native.client[0]!==width||native.client[1]!==height)throw new Error('Native client/viewport mismatch '+width);
      if(await ev(`!document.getElementById('making-quick-panel').classList.contains('hidden')`))await click('#making-quick-panel .making-quick-head button');
      await settle();
      const geometry=await ev(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};const m=document.getElementById('module-making');return{viewport:[innerWidth,innerHeight],library:rect(document.getElementById('making-chain-library')),overflow:m.scrollWidth>m.clientWidth+1,rows:[...document.querySelectorAll('.making-chain-row')].map(e=>({id:e.dataset.chainId,status:e.querySelector('.making-chain-row-status')?.textContent})),active:document.getElementById('making-status-text').textContent,idle:document.getElementById('making-status-idle').textContent,view:document.getElementById('making-inspector-title').textContent,making:document.getElementById('making-conversation-object')?.textContent,wires:[...document.querySelectorAll('#making-graph svg path')].map(e=>e.getAttribute('d')),cards:document.querySelectorAll('.making-card-row').length}})()`);
      geometry.presentation=await ev(`(()=>{const title=document.querySelector('.making-library-title'),button=document.getElementById('making-new-chain-btn'),assembly=document.querySelector('.making-assembly-node'),quick=document.getElementById('making-quick-panel');return{title:{whiteSpace:getComputedStyle(title).whiteSpace,height:title.getBoundingClientRect().height},button:{whiteSpace:getComputedStyle(button).whiteSpace,overflow:button.scrollWidth>button.clientWidth+1},assembly:{background:getComputedStyle(assembly).backgroundColor,color:getComputedStyle(assembly).color,text:assembly.textContent},output:document.getElementById('making-output-node').textContent,quickVisible:!!quick.getBoundingClientRect().width&&!!quick.getBoundingClientRect().height}})()`);
      if(geometry.presentation.quickVisible||geometry.presentation.button.overflow||geometry.presentation.title.whiteSpace!=='nowrap'||geometry.presentation.assembly.background!=='rgb(37, 37, 37)')throw new Error('Graph presentation mismatch '+width);
      await shot(`graph-${width}x${height}`);evidence.graphs.push({size:[width,height],mode:'native',native,nativePage,geometry});
      if(process.argv.includes('--details')&&width!==1280&&await ev(`!!document.querySelector('.making-card-row')`)){
        await click('.making-card-row');await shot(`detail-${width}x${height}`);
        const detail=await ev(`(()=>{const e=document.getElementById('making-quick-panel'),r=e.getBoundingClientRect();return{visible:!!r.width&&!!r.height,x:r.x,y:r.y,width:r.width,height:r.height,viewport:[innerWidth,innerHeight]}})()`);
        evidence.graphs.at(-1).detail=detail;
        if(detail.x<0||detail.y<0||detail.x+detail.width>width+1||detail.y+detail.height>height+1)throw new Error('Detail exceeds viewport '+width);
        if(await ev(`!!document.querySelector('.making-quick-open')`)){
          await click('.making-quick-open');await shot(`full-detail-${width}x${height}`);
          evidence.graphs.at(-1).fullDetail=await ev(`(()=>{const e=document.getElementById('making-full-detail'),r=e.getBoundingClientRect();return{visible:!!r.width&&!!r.height,width:r.width,height:r.height}})()`);
          await click('#making-full-back');
        }
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await settle();
      }
    }
  }
  await click('#tab-settings');await shot('settings-native-1440x900');evidence.widthCopy=await ev(`document.getElementById('btn-column-width').textContent`);
  evidence.limitations.push('No secret read, no user body read, no global library writes. Existing activation state is observed, never changed.','No additional DPI or human click acceptance; screenshots require observer review.','Native child HWND rectangles expose hosting window bounds, not the COM CoreWebView2Controller.Bounds property.');
}catch(e){evidence.errors.push(e.message);process.exitCode=1;}
finally{await send('Emulation.clearDeviceMetricsOverride').catch(()=>{});writeFileSync(join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({native:evidence.native.map(e=>({action:e.action,client:e.window.client,viewport:e.page.viewport,zoomed:e.window.zoomedAfter})),graphs:evidence.graphs.map(e=>({size:e.size,mode:e.mode,geometry:e.geometry,detail:e.detail,fullDetail:e.fullDetail})),widthCopy:evidence.widthCopy,errors:evidence.errors,limitations:evidence.limitations},null,2));ws.close();}
