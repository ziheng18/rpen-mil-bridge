// Live probe: editing the Milthm 流速倍率 (FlowSpeed(5)) channel of a Speed(12)-primary line must
// change the preview speed and the exported chart.
// Uses D:\fzh00\下载\エゴイスト.zip (line 4: line FlowSpeed(5)=8, Speed(12)=1 then 80 at the end).
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'flow-channel');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = 'D:\\fzh00\\下载\\エゴイスト.zip';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fetchJson = async (url, options) => JSON.parse(await (await fetch(url, options)).text());
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
const exceptions = [];
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); return; }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push((message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? '').slice(0, 500));
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const waitFor = async (expression, timeout = 120000, label = 'wait') => { const s = Date.now(); while (Date.now() - s < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1800)); };
const READ = `(() => {
  const editor = window.rpenMods.editor;
  const preview = editor.preview;
  preview.draw(editor.chart, editor.tempo, 60, 4);
  const runtime = preview.scene.lines[4];
  const state = runtime.state(60);
  const line = editor.chart.judgeLineList[4];
  const stash = line['x-milthm'] ?? {};
  const semantics = window.rpenMods.manager.runtime.loaded.get('milthm-fmt2-bridge')?.api?.editor?.chart ? null : null;
  return {
    floor60: runtime.floor(60),
    scaleX: state.scaleX,
    primarySpeedType: stash.primarySpeedType,
    lineFlowRaw: (stash.channels?.flowSpeed ?? []).map(event => ({ start: event.start, end: event.end, startTime: event.startTime, endTime: event.endTime })),
    speedEvents: (line.eventLayers?.[0]?.speedEvents ?? []).map(event => ({ start: event.start, end: event.end, startTime: event.startTime, endTime: event.endTime })),
    noteCount: (line.notes ?? []).length,
    firstNoteBeat: (line.notes ?? []).length ? (line.notes[0].startTime?.[0] ?? 0) : null,
    lastNoteBeat: (line.notes ?? []).length ? (line.notes[line.notes.length - 1].startTime?.[0] ?? 0) : null,
  };
})()`;

try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`);
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  step('mod', await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true; manager.review = async () => true;
    if (manager.runtime.loaded.has('milthm-fmt2-bridge')) await manager.disable('milthm-fmt2-bridge');
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 1500));
    return { loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status, version: manager.records.get('milthm-fmt2-bridge')?.manifest?.version };
  })()`));

  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.judgeLineList?.length === 16 && chart['x-milthm']?.columns ? true : null; })()`, 120000, 'import');
  await evaluate(`(() => { const editor = window.rpenMods.editor; editor.pause?.(); editor.selectLine(4); editor.setPreview(true); return true; })()`);
  await waitFor(`(() => { const preview = window.rpenMods.editor.preview; return preview?.visible && preview.canvas?.clientWidth > 100 && preview.scene?.lines?.length === 16; })()`, 30000, 'preview');
  await sleep(600);
  const before = await evaluate(READ);
  step('before', before);

  step('edit-flow-channel', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const next = structuredClone(editor.chart);
    const line = next.judgeLineList[4];
    line['x-milthm'] = line['x-milthm'] ?? {};
    line['x-milthm'].channels = line['x-milthm'].channels ?? { bodyAlpha: [], headAlpha: [], wholeAlpha: [], flowSpeed: [] };
    line['x-milthm'].channels.flowSpeed = [{
      type: 5, startTime: [0, 0, 1], endTime: [16, 0, 1], start: 4, end: 4, bearer_type: 0, bearer: 4,
      ease: { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 },
    }];
    editor.commit('probe flow channel edit', next);
    return { lineFlowRaw: (editor.chart.judgeLineList[4]['x-milthm']?.channels?.flowSpeed ?? []).map(event => event.start) };
  })()`));
  await sleep(800);
  const after = await evaluate(READ);
  step('after', after);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'flow-channel.png'), Buffer.from(shot.data, 'base64'));

  const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null);
  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    primarySpeedType: before.primarySpeedType,
    lineFlowRawBefore: before.lineFlowRaw.map(event => event.start),
    lineFlowRawAfter: after.lineFlowRaw.map(event => event.start),
    speedEvents: before.speedEvents,
    notes: before.noteCount,
    lastNoteBeat: before.lastNoteBeat,
    floor60Before: before.floor60,
    floor60After: after.floor60,
    floorRatio: ratio(after.floor60, before.floor60),
    speedPrimaryOk: Number(before.primarySpeedType) === 12,
    lineFlowWas8: JSON.stringify(before.lineFlowRaw.map(event => Number(event.start))) === JSON.stringify([8]),
    lineFlowNow4: JSON.stringify(after.lineFlowRaw.map(event => Number(event.start))) === JSON.stringify([4]),
    previewResponds: Math.abs(Number(ratio(after.floor60, before.floor60)) - 0.5) < 0.001,
    exceptions: exceptions.length,
  };
  result.ok = Boolean(result.version) && result.speedPrimaryOk && result.lineFlowWas8 && result.lineFlowNow4
    && result.previewResponds && result.exceptions === 0;
  report.result = result;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', JSON.stringify(result, null, 1));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  report.error = String(error?.stack ?? error);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PROBE ERROR', report.error);
  process.exitCode = 1;
} finally {
  ws.close();
}
