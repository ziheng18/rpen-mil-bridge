// Live probe: RPEN-only structure must flatten correctly through the *real* export command.
//
// Setup on a real imported chart (《エゴイスト》, 16 tracks):
//  1. line 4 gets an extra event layer with constant PositionX = +1000 (RPE units).
//     RPEN preview adds layers, so the exported chart must shift line 4's X by +1000/0.703125.
//  2. a fresh zeroed track is appended as a child of line 4 (father = 4, rotateWithFather).
//     Milthm has no line hierarchy, so export must bake the parent transform: the child's
//     exported PositionX/PositionY/Rotation must equal line 4's absolute values.
// Both must be reported in the export warnings.
//
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'export-flatten');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = 'D:\\fzh00\\下载\\エゴイスト.zip';
const DL = path.join(OUT, 'downloads');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });

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
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const waitFor = async (expression, timeout = 120000, label = 'wait') => { const s = Date.now(); while (Date.now() - s < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1500)); };

const SCALE = 0.703125;                        // default coord-scale; fromRpeX(x) = x / scale
const LAYER_OFFSET_RPE = 1000;
const LAYER_OFFSET_MILTHM = LAYER_OFFSET_RPE / SCALE;

// Milthm-side helpers (exported chart is Milthm fmt=2).
const beatOfTime = time => Array.isArray(time) ? Number(time[0]) + Number(time[1]) / Number(time[2]) : Number(time);
const animationsOfType = (line, type) => (line?.animations ?? []).filter(animation => Number(animation.type) === Number(type));
const boundaryValues = animations => {
  const map = new Map();
  for (const animation of animations) {
    map.set(beatOfTime(animation.startTime), Number(animation.start));
    map.set(beatOfTime(animation.endTime), Number(animation.end));
  }
  return map;
};
const compareCommon = (left, right) => {
  const pairs = [];
  for (const [beat, value] of left) if (right.has(beat)) pairs.push([beat, value, right.get(beat)]);
  return pairs;
};

const newestJson = () => fs.readdirSync(DL)
  .filter(name => name.endsWith('.json'))
  .map(name => ({ name, time: fs.statSync(path.join(DL, name)).mtimeMs }))
  .sort((left, right) => left.time - right.time)
  .at(-1)?.name;

let baselineExport = null;
let flattenedExport = null;
let exportWarnings = null;

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
  await evaluate(`(() => { window.rpenMods.editor.pause?.(); return true; })()`);

  /* ---- 1) baseline export ---- */
  step('baseline export', await evaluate(`(async () => {
    const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:export-json');
    return await command.run();
  })()`));
  await sleep(2500);
  const baselineFile = newestJson();
  baselineExport = JSON.parse(fs.readFileSync(path.join(DL, baselineFile), 'utf-8'));
  step('baseline file', { file: baselineFile, lines: baselineExport.lines.length });

  /* ---- 2) add an extra event layer to line 4 + append a zeroed child track ---- */
  step('modify', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const next = structuredClone(editor.chart);
    const constant = (start, end = start) => ({ startTime: [0, 0, 1], endTime: [1000, 0, 1], start, end,
      easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 });
    const line4 = next.judgeLineList[4];
    line4.eventLayers = line4.eventLayers ?? [{ moveXEvents: [], moveYEvents: [], rotateEvents: [], alphaEvents: [], speedEvents: [] }];
    line4.eventLayers.push({ moveXEvents: [constant(${LAYER_OFFSET_RPE})], moveYEvents: [], rotateEvents: [], alphaEvents: [], speedEvents: [] });
    next.judgeLineList.push({
      Group: 0, Name: 'Child track', Texture: 'line.png', anchor: [0.5, 0.5], bpmfactor: 1, father: -1,
      rotateWithFather: true, isCover: 1, isGif: false, zOrder: 0,
      eventLayers: [{
        moveXEvents: [constant(0)], moveYEvents: [constant(0)], rotateEvents: [constant(0)],
        alphaEvents: [constant(255)], speedEvents: [constant(10)],
      }],
      extended: {}, notes: [], numOfNotes: 0,
    });
    editor.commit('probe: extra event layer + child track', next);
    return { lines: next.judgeLineList.length, line4Layers: next.judgeLineList[4].eventLayers.length };
  })()`));
  await sleep(1500);
  step('wait columns', await waitFor(`(() => {
    const chart = window.rpenMods.editor?.chart;
    if (chart?.judgeLineList?.length !== 17) return null;
    return { lines: chart.judgeLineList.length, layers: chart.judgeLineList[4].eventLayers.length,
      stash: Boolean(chart.judgeLineList[16]?.['x-milthm']) };
  })()`, 60000, 'columns init'));

  /* ---- 3) set father = 4 on the new track and zero its local transform ---- */
  step('father', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const next = structuredClone(editor.chart);
    const child = next.judgeLineList[16];
    const zero = value => ({ startTime: [0, 0, 1], endTime: [1000, 0, 1], start: value, end: value,
      easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 });
    child.father = 4;
    child.rotateWithFather = true;
    child.eventLayers[0].moveXEvents = [zero(0)];
    child.eventLayers[0].moveYEvents = [zero(0)];
    child.eventLayers[0].rotateEvents = [zero(0)];
    if (child['x-milthm']) {
      child['x-milthm'].events = child['x-milthm'].events ?? {};
      child['x-milthm'].events.x = [zero(0)];
      child['x-milthm'].events.y = [zero(0)];
      child['x-milthm'].events.rotate = [zero(0)];
    }
    editor.commit('probe: father = 4', next);
    const current = window.rpenMods.editor.chart.judgeLineList[16];
    return { father: current.father, hasStash: Boolean(current['x-milthm']) };
  })()`));
  await sleep(1200);

  /* ---- 4) export again ---- */
  const exportResult = await evaluate(`(async () => {
    const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:export-json');
    return await command.run();
  })()`);
  exportWarnings = exportResult?.warnings ?? [];
  step('flattened export', exportResult);
  await sleep(2500);
  const flattenedFile = newestJson();
  flattenedExport = JSON.parse(fs.readFileSync(path.join(DL, flattenedFile), 'utf-8'));
  step('flattened file', { file: flattenedFile, lines: flattenedExport.lines.length });
  fs.writeFileSync(path.join(OUT, 'baseline-chart.json'), JSON.stringify(baselineExport));
  fs.writeFileSync(path.join(OUT, 'flattened-chart.json'), JSON.stringify(flattenedExport));

  /* ---- assertions ---- */
  const line4Base = baselineExport.lines[4];
  const line4Flat = flattenedExport.lines[4];
  const child = flattenedExport.lines[flattenedExport.lines.length - 1];
  const shiftPairs = compareCommon(boundaryValues(animationsOfType(line4Flat, 0)), boundaryValues(animationsOfType(line4Base, 0)))
    .map(([beat, flat, base]) => [beat, flat - base]);
  const shiftOk = shiftPairs.length > 10 && shiftPairs.every(([, shift]) => Math.abs(shift - LAYER_OFFSET_MILTHM) < 0.01);
  const positionPairsX = compareCommon(boundaryValues(animationsOfType(child, 0)), boundaryValues(animationsOfType(line4Flat, 0)));
  const positionPairsY = compareCommon(boundaryValues(animationsOfType(child, 1)), boundaryValues(animationsOfType(line4Flat, 1)));
  const rotationPairs = compareCommon(boundaryValues(animationsOfType(child, 4)), boundaryValues(animationsOfType(line4Flat, 4)));
  const maxDiff = pairs => pairs.reduce((max, [, left, right]) => Math.max(max, Math.abs(left - right)), 0);
  const positionOk = positionPairsX.length > 10 && positionPairsY.length > 10 && maxDiff(positionPairsX) < 0.5 && maxDiff(positionPairsY) < 0.5;
  const rotationOk = rotationPairs.length > 10 && maxDiff(rotationPairs) < 0.5;

  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    warnings: exportWarnings,
    warningLayerMerge: exportWarnings.some(text => text.includes('事件层已按数值叠加合并导出')),
    warningFatherBake: exportWarnings.some(text => text.includes('父子线已烘焙导出')),
    layerShiftSamples: shiftPairs.length,
    layerShift: shiftPairs.length ? shiftPairs[shiftPairs.length - 1][1] : null,
    layerShiftExpected: LAYER_OFFSET_MILTHM,
    layerMergeOk: shiftOk,
    childSamples: { x: positionPairsX.length, y: positionPairsY.length, rotate: rotationPairs.length },
    childMaxDiff: { x: maxDiff(positionPairsX), y: maxDiff(positionPairsY), rotate: maxDiff(rotationPairs) },
    fatherBakeOk: positionOk && rotationOk,
    exportedLines: flattenedExport.lines.length,
    exceptions: exceptions.length,
  };
  result.ok = Boolean(result.version) && result.warningLayerMerge && result.warningFatherBake
    && result.layerMergeOk && result.fatherBakeOk && result.exceptions === 0;
  report.result = result;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', JSON.stringify(result, null, 1));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'export-flatten.png'), Buffer.from(shot.data, 'base64'));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  report.error = String(error?.stack ?? error);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PROBE ERROR', report.error);
  process.exitCode = 1;
} finally {
  try { await send('Page.close'); } catch { }
  ws.close();
}
