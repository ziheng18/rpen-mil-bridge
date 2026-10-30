import fs from 'node:fs';
import path from 'node:path';
const CDP = 9334;
const OUT = 'E:\\File\\deepseek harness\\mil\\rpen-milthm-bridge-test\\offscreen-test';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = await (async () => { const r = await fetch(`http://127.0.0.1:${CDP}/json/list`); return await r.json(); })();
const target = targets.find(item => item.type === 'page' && String(item.url).includes('127.0.0.1:4173'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let id = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable'); await send('Page.enable');
const evaluate = async (expression, awaitPromise = true) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) return { __error: result.exceptionDetails.exception?.description ?? result.exceptionDetails.text }; return result.result?.value; };
const state = await evaluate(`(() => {
  const p = window.rpenMods.editor.preview;
  const P = Object.getPrototypeOf(p);
  window.__lineCalls = 0;
  if (!window.__lineWrapped) { window.__lineWrapped = true; const d = P.drawLine; P.drawLine = function (...args) { window.__lineCalls++; return d.apply(this, args); }; }
  p.lineScale = 1e6;
  window.rpenMods.editor.invalidate();
  return { lineScale: p.lineScale };
})()`);
await sleep(1500);
console.log('forced lineScale', JSON.stringify(await evaluate(`(() => ({ lineScale: window.rpenMods.editor.preview.lineScale, lineCalls: window.__lineCalls, y: window.rpenMods.editor.chart.judgeLineList[0].eventLayers[0].moveYEvents[0]?.start }))()`)));
const data = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(OUT, 'forced-linescale.png'), Buffer.from(data.data, 'base64'));
// restore
await evaluate(`(() => { window.rpenMods.editor.preview.lineScale = 1.5; window.rpenMods.editor.invalidate(); return true; })()`);
ws.close();
