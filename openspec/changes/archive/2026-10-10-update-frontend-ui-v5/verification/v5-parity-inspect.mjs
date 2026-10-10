// Read-only inspection: do not extract project text, form values or secrets.
const targets = await fetch('http://127.0.0.1:9223/json/list', { signal: AbortSignal.timeout(5000) }).then(r => r.json());
const target = targets.find(t => t.type === 'page' && t.title.includes('Next Story'));
if (!target) throw new Error('No real Next Story page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Inspection timed out')), 8000);
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timer);
    if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
    else resolve(message.result.result.value);
  });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
    returnByValue: true,
    expression: `(() => {
      const visible = e => !!e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden';
      const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const ids = ['welcome-page','new-project-page','editor-page','module-files','module-settings','module-making','ai-dock','ai-dock-maximize','making-chain-library'];
      return { viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
        nodes: ids.map(id => { const e = document.getElementById(id); return { id, visible: visible(e), rect: e ? rect(e) : null }; }),
        styles: [...document.querySelectorAll('link[rel=stylesheet]')].map(e => e.getAttribute('href')),
        visibilitySwitches: [...document.querySelectorAll('.file-ai-visibility-toggle')].map(e => ({ visible: visible(e), role: e.getAttribute('role'), checked: e.getAttribute('aria-checked'), track: !!e.querySelector('.switch-track'), thumb: !!e.querySelector('.switch-thumb') })) };
    })()`
  } }));
});
console.log(JSON.stringify(result, null, 2));
ws.close();
