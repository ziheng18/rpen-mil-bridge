// Open a visible Edge demo window with RPEN, install the v0.2 mod, import the Milthm chart,
// seek to a beat with notes and leave the window open for the user to inspect.
import fs from 'node:fs';
import path from 'node:path';
const CDP = 9334;
const WORK = 'E:\\File\\deepseek harness\\mil';
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }
let targets = [];
for (let i = 0; i < 40; i++) {
  try { targets = await fetchJson(`http://127.0.0.1:${CDP}/json/list`); if (targets.some(target => String(target.url).includes('127.0.0.1:4173'))) break; } catch { }
  await sleep(500);
}
const target = targets.find(item => item.type === 'page' && String(item.url).includes('127.0.0.1:4173'));
if (!target) { console.log('NO TARGET', JSON.stringify(targets.map(item => item.url).slice(0, 5))); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
const evaluate = async (expression, awaitPromise = true) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
};
const waitFor = async (expression, timeout = 90000, label = 'wait') => {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); }
  throw new Error('timeout ' + label);
};
await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`, 90000, 'boot');
const modBase64 = fs.readFileSync(MOD).toString('base64');
const installed = await evaluate(`(async () => {
  const manager = window.rpenMods.manager;
  window.confirm = () => true;
  manager.review = async () => true;
  const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
  await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
  await manager.enable('milthm-fmt2-bridge');
  await new Promise(resolve => setTimeout(resolve, 800));
  return { loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status, version: manager.records.get('milthm-fmt2-bridge')?.manifest?.version };
})()`);
console.log('mod:', JSON.stringify(installed));
const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART] });
await waitFor(`(() => window.rpenMods.editor?.chart?.['x-milthm'])()`, 90000, 'import');
await waitFor(`(() => window.rpenMods.editor?.audio?.buffer?.duration > 1)()`, 60000, 'audio');
const state = await evaluate(`(async () => {
  const editor = window.rpenMods.editor;
  editor.selectLine(1);
  editor.setPreview(true, { stay: true });
  editor.seek(2.2, { pause: true });
  await new Promise(resolve => setTimeout(resolve, 900));
  return {
    chart: editor.chartName,
    lines: editor.chart.judgeLineList.length,
    notes: editor.chart.judgeLineList.reduce((sum, line) => sum + (line.notes?.length ?? 0), 0),
    timelineSelect: !!document.querySelector('#milthm-timeline-select'),
    panel: !!document.querySelector('.milthm-panel'),
    seconds: editor.chartSeconds(),
  };
})()`);
console.log('demo state:', JSON.stringify(state));
console.log('demo window left open on port', CDP);
ws.close();
