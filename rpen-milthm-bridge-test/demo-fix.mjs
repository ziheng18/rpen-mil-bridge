// Put the visible demo window into a good v0.4 state: close dialogs, import Class Memories, preview.
import fs from 'node:fs';
import path from 'node:path';
const CDP = 9334;
const WORK = 'E:\\File\\deepseek harness\\mil';
const CHART = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find(item => item.type === 'page' && String(item.url).includes('127.0.0.1:4173'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map(); let id = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
const evaluate = async (expression, awaitPromise = true) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; };
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); } throw new Error('timeout ' + label); };
// close dialogs / mod overlays
await evaluate(`(() => {
  for (const dialog of document.querySelectorAll('dialog[open]')) { try { dialog.close(); } catch {} }
  document.querySelector('#milthm-new-chart-dialog')?.remove();
  return true;
})()`);
await sleep(300);
const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART] });
await waitFor(`(() => window.rpenMods.editor?.chart?.['x-milthm']?.columns && window.rpenMods.editor?.chart?.judgeLineList?.length > 10)()`, 90000, 'chart');
await waitFor(`(() => window.rpenMods.editor?.audio?.buffer?.duration > 1)()`, 60000, 'audio');
await evaluate(`(async () => { const editor = window.rpenMods.editor; editor.selectLine(1); editor.setPreview(true, { stay: true }); editor.seek(2.2, { pause: true }); await new Promise(resolve => setTimeout(resolve, 1000)); return true; })()`);
console.log(JSON.stringify(await evaluate(`(() => { const editor = window.rpenMods.editor; return { chartName: editor.chartName, columns: editor.chart['x-milthm'].columns, audio: editor.audio.buffer.duration, overlay: !!document.querySelector('.milthm-column-bar'), panelRemoved: document.querySelectorAll('.milthm-panel').length === 0, preview: editor.preview.visible }; })()`)));
ws.close();
