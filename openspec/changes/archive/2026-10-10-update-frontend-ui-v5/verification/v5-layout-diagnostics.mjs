// Geometry only: no document bodies, input values, or configuration are extracted.
const targets = await fetch('http://127.0.0.1:9223/json/list').then(r => r.json());
const target = targets.find(t => t.type === 'page' && t.title.includes('Next Story'));
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data);
  if (response.id !== 1) return;
  console.log(JSON.stringify(response.result?.result?.value ?? response, null, 2));
  socket.close();
});
socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, awaitPromise: true, expression: `(async () => {
  document.getElementById('tab-writing').click();
  await new Promise(resolve=>setTimeout(resolve,300));
  const root = document.getElementById('module-writing');
  const describe = e => { const r=e.getBoundingClientRect(), s=getComputedStyle(e); return {id:e.id, class:e.className, x:r.x, width:r.width, right:r.right, client:e.clientWidth, scroll:e.scrollWidth, display:s.display, visibility:s.visibility, overflowX:s.overflowX, position:s.position, minWidth:s.minWidth}; };
  return { location:location.href, viewport:[innerWidth,innerHeight], root:describe(root), overflow:[...root.querySelectorAll('*')].filter(e=>e.getClientRects().length && (e.scrollWidth>e.clientWidth+1 || e.getBoundingClientRect().right>innerWidth+1)).map(describe), icon:getComputedStyle(document.getElementById('ai-dock-maximize'),'::before').maskImage };
})()` } }));
