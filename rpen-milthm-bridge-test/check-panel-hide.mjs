import fs from 'node:fs';
const CDP = 9334;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = await (async () => { const r = await fetch(`http://127.0.0.1:${CDP}/json/list`); return await r.json(); })();
const target = targets.find(item => item.type === 'page' && String(item.url).includes('127.0.0.1:4173'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let id = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable');
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
// create a plain RPE chart through the dialog and check the panel hides after a tick
await evaluate(`(() => { document.querySelector('#new')?.click(); return true; })()`);
await sleep(400);
await evaluate(`(() => { const buttons = [...document.querySelectorAll('#milthm-new-chart-dialog button')]; buttons.find(button => button.textContent.includes('普通'))?.click(); return true; })()`);
await sleep(1200);
const state = await evaluate(`(() => {
  const panel = document.querySelector('.milthm-panel');
  return { marker: window.rpenMods.editor.chart?.['x-milthm'] ?? null, panelDisplay: panel ? panel.style.display : 'missing', chartName: window.rpenMods.editor.chartName };
})()`);
console.log(JSON.stringify(state));
// leave the demo on a Milthm chart again
await evaluate(`(() => { window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:new-milthm-chart')?.run(); return true; })()`);
await sleep(800);
ws.close();
