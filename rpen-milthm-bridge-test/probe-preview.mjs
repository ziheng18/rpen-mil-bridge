// Visual probe: capture preview with/without the mod's Milthm track + background dim rendering.
import fs from 'node:fs';
import path from 'node:path';
const CDP_PORT = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'integration2');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }
const target = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expression, awaitPromise = true) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
};
const waitFor = async (expression, timeout = 60000, label = 'wait') => {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); }
  throw new Error('timeout ' + label);
};
const shot = async name => { const data = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data.data, 'base64')); };
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return window.rpenMods.manager.runtime.loaded.has('milthm-fmt2-bridge'); })()`, 60000, 'mod');
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => window.rpenMods.editor?.chart?.['x-milthm'] && window.rpenMods.editor?.audio?.buffer?.duration > 1)()`, 90000, 'import');
  await sleep(1500);
  // hide the mod panel for a clean screenshot
  await evaluate(`(() => { const panel = document.querySelector('.milthm-panel'); if (panel) panel.style.display = 'none'; document.querySelector('#milthm-timeline-select')?.parentElement?.remove(); return true; })()`);
  // seek to a moment with notes visible on line 1
  const seekInfo = await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const line = editor.chart.judgeLineList[1];
    const beat = line.notes.length ? (line.notes[0].startTime[0] + line.notes[0].startTime[1] / line.notes[0].startTime[2]) : 4;
    editor.selectLine(1);
    editor.setPreview(true, { stay: true });
    editor.seekBeat(Math.max(0, beat - 2), true);
    return { beat, notes: line.notes.length };
  })()`);
  console.log('seek', JSON.stringify(seekInfo));
  await sleep(1500);
  await shot('preview-tracks-clean.png');
  // disable track rendering and capture the same frame for comparison
  await evaluate(`(async () => { await window.rpenMods.manager.setSetting('milthm-fmt2-bridge', 'preview-tracks', false); return true; })()`);
  await sleep(1200);
  await shot('preview-native.png');
  await evaluate(`(async () => { await window.rpenMods.manager.setSetting('milthm-fmt2-bridge', 'preview-tracks', true); return true; })()`);
  // background dim check: add dim event then compare
  await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const next = structuredClone(editor.chart);
    next.globalEvents = { version: 1, types: { ...(next.globalEvents?.types ?? {}), 'milthm-fmt2-bridge/background-dim': {
      name: 'Milthm 背景明暗', source: { kind: 'mod', id: 'milthm-fmt2-bridge', name: 'Milthm fmt2 Bridge', author: 'prototype', version: '0.1.0' },
      columns: { dim: { name: '明暗', valueType: 'number', events: [{ startTime: [0, 0, 1], endTime: [8, 0, 1], start: 1, end: 1, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], inst: 0 }] } },
    } } };
    editor.commit('dim test', next);
    editor.seek(2, { pause: true });
    return true;
  })()`);
  await sleep(1500);
  await shot('preview-dim-clean.png');
  console.log('done');
} catch (error) {
  console.log('FAILED', String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  try { await send('Page.close'); } catch { }
  ws.close();
}
