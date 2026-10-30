// Live probe: 钩定 (inst) on Milthm opacity events (v0.6.3 fix).
// Installs the packaged mod in a headless RPEN page, imports Class Memories, then
// checks the alpha-column hook state and toggles it through real editor commits.
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'hook-alpha');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fetchJson = async (url, options) => JSON.parse(await (await fetch(url, options)).text());
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0; const exceptions = [];
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); return; }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push((message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? '').slice(0, 500));
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1400)); };

try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`);
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  step('mod', await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true; manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 900));
    return { loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status, version: manager.records.get('milthm-fmt2-bridge')?.manifest?.version };
  })()`));

  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.[1]?.['x-milthm']?.events ? true : null; })()`, 90000, 'import');
  await waitFor(`(() => window.rpenMods.editor?.audio?.buffer?.duration > 1)()`, 30000, 'audio');

  // 1) census after import: zero-duration opacity events must be hooked like the control columns
  step('census', await evaluate(`(() => {
    const chart = window.rpenMods.editor.chart;
    const isZero = event => JSON.stringify(event.startTime) === JSON.stringify(event.endTime);
    const isInst = event => event.inst === 1 || event.inst === true;
    const count = events => ({ total: events.length, zero: events.filter(isZero).length, hooked: events.filter(isInst).length, zeroHooked: events.filter(event => isZero(event) && isInst(event)).length });
    return {
      columns: chart['x-milthm'].columns,
      alpha: count(chart.judgeLineList.flatMap(line => line.eventLayers[0].alphaEvents ?? [])),
      controlX: count(chart.judgeLineList.flatMap(line => line.eventLayers[0].moveXEvents ?? [])),
    };
  })()`));

  // 2) toggle 钩定 ON a duration bodyAlpha event (the change RPEN's Q / inspector make)
  step('hook on', await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const chart = editor.chart;
    const isZero = event => JSON.stringify(event.startTime) === JSON.stringify(event.endTime);
    const key = JSON.stringify;
    let lineIndex = -1, target = null;
    for (let li = 0; li < chart.judgeLineList.length && lineIndex < 0; li++) {
      const events = chart.judgeLineList[li].eventLayers[0].alphaEvents ?? [];
      const counts = new Map();
      for (const event of events) counts.set(key(event.startTime), (counts.get(key(event.startTime)) ?? 0) + 1);
      target = events.find(event => !isZero(event) && Number(event.start) !== Number(event.end) && counts.get(key(event.startTime)) === 1) ?? null;
      if (target) lineIndex = li;
    }
    if (lineIndex < 0) return { error: 'no unique duration opacity event' };
    const before = JSON.parse(JSON.stringify(target));
    const next = structuredClone(chart);
    const index = next.judgeLineList[lineIndex].eventLayers[0].alphaEvents.findIndex(event => key(event.startTime) === key(target.startTime));
    next.judgeLineList[lineIndex].eventLayers[0].alphaEvents[index] = { ...structuredClone(target), inst: 1, end: structuredClone(target.start) };
    editor.commit('切换事件钩定', next);
    await new Promise(resolve => setTimeout(resolve, 700));
    const after = editor.chart.judgeLineList[lineIndex].eventLayers[0].alphaEvents.find(event => key(event.startTime) === key(target.startTime));
    return { lineIndex, before: { start: before.start, end: before.end, inst: before.inst ?? 0 }, after: after ? { start: after.start, end: after.end, inst: after.inst ?? 0 } : null };
  })()`));

  // 3) second commit that edits another alpha event of the same line (re-converts the column)
  step('second commit', await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const chart = editor.chart;
    const isInst = event => event.inst === 1 || event.inst === true;
    const key = JSON.stringify;
    let lineIndex = -1, hooked = null;
    for (let li = 0; li < chart.judgeLineList.length && lineIndex < 0; li++) {
      hooked = (chart.judgeLineList[li].eventLayers[0].alphaEvents ?? []).find(event => isInst(event)) ?? null;
      if (hooked) lineIndex = li;
    }
    if (!hooked) return { error: 'no hooked alpha event' };
    const next = structuredClone(chart);
    const events = next.judgeLineList[lineIndex].eventLayers[0].alphaEvents;
    const index = events.findIndex(event => !isInst(event));
    if (index < 0) return { error: 'no other alpha event to edit' };
    events[index] = { ...events[index], end: Number(events[index].end) === 255 ? 254 : Number(events[index].end) + 1 };
    editor.commit('编辑 Milthm 不透明度', next);
    await new Promise(resolve => setTimeout(resolve, 700));
    const after = editor.chart.judgeLineList[lineIndex].eventLayers[0].alphaEvents.find(event => key(event.startTime) === key(hooked.startTime));
    return { lineIndex, hookedStartTime: hooked.startTime, instAfterSecondCommit: after?.inst ?? 0 };
  })()`));

  // 4) toggle 钩定 OFF an imported zero-duration bodyAlpha event
  step('hook off', await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const chart = editor.chart;
    const isZero = event => JSON.stringify(event.startTime) === JSON.stringify(event.endTime);
    const isInst = event => event.inst === 1 || event.inst === true;
    const key = JSON.stringify;
    let lineIndex = -1, target = null;
    for (let li = 0; li < chart.judgeLineList.length && lineIndex < 0; li++) {
      const events = chart.judgeLineList[li].eventLayers[0].alphaEvents ?? [];
      const counts = new Map();
      for (const event of events) counts.set(key(event.startTime), (counts.get(key(event.startTime)) ?? 0) + 1);
      target = events.find(event => isZero(event) && isInst(event) && counts.get(key(event.startTime)) === 1) ?? null;
      if (target) lineIndex = li;
    }
    if (lineIndex < 0) return { error: 'no unique zero-duration hooked event' };
    const next = structuredClone(chart);
    const index = next.judgeLineList[lineIndex].eventLayers[0].alphaEvents.findIndex(event => key(event.startTime) === key(target.startTime));
    next.judgeLineList[lineIndex].eventLayers[0].alphaEvents[index] = { ...structuredClone(target), inst: 0 };
    editor.commit('切换事件钩定', next);
    await new Promise(resolve => setTimeout(resolve, 700));
    const after = editor.chart.judgeLineList[lineIndex].eventLayers[0].alphaEvents.find(event => key(event.startTime) === key(target.startTime));
    return { lineIndex, before: { inst: target.inst ?? 0 }, after: after ? { inst: after.inst ?? 0 } : null };
  })()`));

  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'editor-alpha-hook.png'), Buffer.from(screenshot.data, 'base64'));
  step('exceptions', exceptions.slice(0, 5));
  const data = name => report.steps.find(entry => entry.name === name)?.data ?? {};
  const result = {
    version: data('mod').version,
    zeroDurationOpacityHooked: data('census').alpha?.zeroHooked === data('census').alpha?.zero && (data('census').alpha?.zero ?? 0) > 0,
    controlZeroDurationHooked: data('census').controlX?.zeroHooked === data('census').controlX?.zero,
    hookOnPersisted: (data('hook on').after?.inst ?? 0) === 1,
    hookOnEndSynced: Number(data('hook on').after?.end) === Number(data('hook on').before?.start),
    hookOnSurvivesSecondCommit: (data('second commit').instAfterSecondCommit ?? 0) === 1,
    hookOffPersisted: (data('hook off').after?.inst ?? 0) === 0,
    exceptions: exceptions.length,
  };
  result.ok = Boolean(result.version) && result.zeroDurationOpacityHooked && result.controlZeroDurationHooked
    && result.hookOnPersisted && result.hookOnEndSynced && result.hookOnSurvivesSecondCommit && result.hookOffPersisted && result.exceptions === 0;
  report.result = result;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', JSON.stringify(result, null, 1));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  report.error = String(error?.stack ?? error);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PROBE ERROR', report.error);
  process.exitCode = 1;
} finally {
  ws.close();
}
