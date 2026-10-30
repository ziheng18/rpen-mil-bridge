// v0.6 checks: non-zero-length synthetic init events + RPEN-style new chart.
import fs from 'node:fs';
import path from 'node:path';
const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
const evaluate = async (expression, awaitPromise = true) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; };
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); } throw new Error('timeout ' + label); };
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`, 90000, 'boot');
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  await evaluate(`(async () => {
    const manager = window.rpenMods.manager; window.confirm = () => true; manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 700));
    return true;
  })()`);
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => window.rpenMods.editor?.chart?.['x-milthm']?.columns && window.rpenMods.editor?.chart?.judgeLineList?.[7]?.['x-milthm']?.events)()`, 90000, 'chart');
  const imported = await evaluate(`(() => {
    const chart = window.rpenMods.editor.chart;
    const line = chart.judgeLineList[7];
    const semantics = line['x-milthm'].events;
    const beat = time => Number(time[0]) + Number(time[1]) / Number(time[2]);
    const summary = events => events.map(event => ({ startTime: event.startTime, endTime: event.endTime, start: event.start, end: event.end, syntheticInit: Boolean(event.syntheticInit), zeroLength: Math.abs(beat(event.startTime) - beat(event.endTime)) < 1e-9 }));
    return { columns: chart['x-milthm'].columns, bodyAlpha: summary(semantics.bodyAlpha), headAlpha: summary(semantics.headAlpha), wholeAlpha: summary(semantics.wholeAlpha) };
  })()`);
  console.log('imported line7:', JSON.stringify(imported, null, 2));
  // create a new Milthm chart and inspect RPEN-style initialization
  await evaluate(`(async () => { window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:new-milthm-chart')?.run(); await new Promise(resolve => setTimeout(resolve, 1200)); return true; })()`);
  const created = await evaluate(`(() => {
    const chart = window.rpenMods.editor.chart;
    const line = chart.judgeLineList[0];
    const beat = time => Number(time[0]) + Number(time[1]) / Number(time[2]);
    const eventSummary = event => ({ startTime: event.startTime, endTime: event.endTime, start: event.start, end: event.end, zeroLength: Math.abs(beat(event.startTime) - beat(event.endTime)) < 1e-9 });
    const layer = line.eventLayers[0];
    const semantics = line['x-milthm']?.events;
    const synthetic = semantics ? Object.entries(semantics).flatMap(([key, events]) => (events ?? []).filter(event => event?.syntheticInit).map(event => ({ key, ...eventSummary(event) }))) : [];
    return {
      columns: chart['x-milthm']?.columns,
      marker: chart['x-milthm']?.kind,
      baseEvents: Object.fromEntries(['moveXEvents','moveYEvents','rotateEvents','alphaEvents','speedEvents'].map(key => [key, (layer[key] ?? []).map(eventSummary)])),
      synthetic,
      overlay: Boolean(document.querySelector('.milthm-column-bar')),
      panelRemoved: document.querySelectorAll('.milthm-panel').length === 0,
    };
  })()`);
  console.log('new chart:', JSON.stringify(created, null, 2));
} catch (error) { console.log('FAILED', String(error?.stack ?? error)); process.exitCode = 1; }
finally { try { await send('Page.close'); } catch { } ws.close(); }
