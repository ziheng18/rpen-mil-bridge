// Live probe: preview-only "global flow speed" must use the renderer's FLOW_SPEED number meaning.
// Setting 1.66 == renderer default 1.66 fall speed; setting X scales the preview speed by X/1.66.
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'renderer-flow');
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
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const s = Date.now(); while (Date.now() - s < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1200)); };

const setFlow = speed => evaluate(`(async () => {
  const state = window.rpenMods.manager.runtime.loaded.get('milthm-fmt2-bridge');
  await state.api.settings.set('renderer-flow-speed', ${speed});
  return state.settings['renderer-flow-speed'];
})()`);
const readFloor = () => evaluate(`(() => {
  const preview = window.rpenMods.editor.preview;
  const line = preview?.scene?.lines?.[0];
  if (!line || typeof line.floor !== 'function') return null;
  return { floor1: line.floor(1), speeds: preview.scene.lines[0].speeds?.length ?? 0, visible: preview.visible };
})()`);

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
    const record = manager.records.get('milthm-fmt2-bridge');
    const state = manager.runtime.loaded.get('milthm-fmt2-bridge');
    return { loaded: state?.status, version: record?.manifest?.version,
      setting: record?.manifest?.settings?.['renderer-flow-speed'] ?? null,
      current: state?.settings?.['renderer-flow-speed'] ?? null };
  })()`));

  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.length === 19 ? true : null; })()`, 90000, 'import');
  await waitFor(`(() => window.rpenMods.editor?.audio?.buffer?.duration > 1)()`, 30000, 'audio');

  const semanticBefore = await evaluate(`(() => { const chart = window.rpenMods.editor.chart; return chart.judgeLineList.map(line => line['x-milthm']?.events?.flowSpeed ?? []); })()`);

  // open the preview pane so Preview.draw() compiles the scene from the injected arrays
  await evaluate(`window.rpenMods.editor.setPreview(true)`);
  await waitFor(`(() => { const preview = window.rpenMods.editor.preview; return preview?.visible && preview.canvas.getBoundingClientRect().width > 100; })()`, 30000, 'preview visible');
  await waitFor(`(() => window.rpenMods.editor.preview?.scene?.lines?.length === 19)()`, 30000, 'scene compiled');

  // 1) default 1.66 = renderer default -> baseline
  await setFlow(1.66);
  await sleep(1200);
  const baseline = await readFloor();
  step('baseline 1.66', baseline);

  // 2) renderer value 2.4 (player slider max) -> preview speed x(2.4 / 1.66)
  await setFlow(2.4);
  await sleep(1200);
  const doubled = await readFloor();
  step('2.4 (x1.4458)', doubled);

  // 3) renderer value 0.83 -> preview speed x0.5
  await setFlow(0.83);
  await sleep(1200);
  const halved = await readFloor();
  step('0.83 (x0.5)', halved);

  // 4) back to default -> baseline again
  await setFlow(1.66);
  await sleep(1200);
  const restored = await readFloor();
  step('restore 1.66', restored);

  const semanticAfter = await evaluate(`(() => { const chart = window.rpenMods.editor.chart; return chart.judgeLineList.map(line => line['x-milthm']?.events?.flowSpeed ?? []); })()`);
  const semanticUnchanged = JSON.stringify(semanticBefore) === JSON.stringify(semanticAfter);
  step('chart data unchanged', semanticUnchanged);

  const ratio = (value, base) => (base && base.floor1 ? value?.floor1 / base.floor1 : null);
  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    defaultSetting: report.steps.find(entry => entry.name === 'mod')?.data?.setting?.default ?? null,
    settingRange: (() => { const definition = report.steps.find(entry => entry.name === 'mod')?.data?.setting; return definition ? [definition.min, definition.max, definition.step] : null; })(),
    sceneFloors: { baseline: baseline?.floor1 ?? null, doubled: doubled?.floor1 ?? null, halved: halved?.floor1 ?? null, restored: restored?.floor1 ?? null },
    ratioFor2_4: ratio(doubled, baseline),
    ratioFor0_83: ratio(halved, baseline),
    restoredMatchesBaseline: Math.abs((restored?.floor1 ?? 0) - (baseline?.floor1 ?? -1)) < 1e-6,
    chartDataUnchanged: semanticUnchanged,
    previewVisible: Boolean(baseline?.visible),
    exceptions: exceptions.length,
  };
  result.ok = result.defaultSetting === 1.66 && JSON.stringify(result.settingRange) === JSON.stringify([0.8, 2.4, 0.01])
    && Math.abs(result.ratioFor2_4 - (2.4 / 1.66)) < 1e-6 && Math.abs(result.ratioFor0_83 - 0.5) < 1e-6
    && result.restoredMatchesBaseline && result.chartDataUnchanged && result.previewVisible && result.exceptions === 0;
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'preview-renderer-flow.png'), Buffer.from(screenshot.data, 'base64'));
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
