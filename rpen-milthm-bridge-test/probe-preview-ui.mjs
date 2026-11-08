// Live probe: Milthm-style preview HUD (v0.7.6/v0.7.7).
// The HUD follows the reference proportions of Milthm's in-game UI (pause circle ≈ 7.1% of the
// preview height, title ≈ 3.8%, difficulty ≈ 2.7%, score ≈ 4.2%, "100%" ≈ 2.7%, combo ≈ 4.9%).
// The probe draws the preview at an explicit chart time inside a single evaluate (the editor
// playback clock is reset by the headless audio state, and the app render loop would overwrite
// the canvas otherwise), then reads __milthmHud + samples the pause-circle pixels.
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'preview-ui');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
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
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1600)); };
// draw at an explicit chart time and read the HUD + pause pixels in the same evaluate
const drawAt = seconds => `(() => {
  const editor = window.rpenMods.editor;
  const preview = editor.preview;
  preview.draw(editor.chart, editor.tempo, ${seconds}, editor.session?.lineIndex ?? 0);
  const hud = preview.__milthmHud ?? null;
  if (!hud) return null;
  const canvas = preview.canvas;
  const ratio = canvas.width / Math.max(1, canvas.clientWidth);
  const pixel = (x, y) => {
    const data = canvas.getContext('2d').getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  };
  const ring = pixel(hud.pause.x + hud.pause.radius * 0.55, hud.pause.y);
  const hole = pixel(hud.pause.x - hud.pause.gap / 2 - hud.pause.barWidth / 2, hud.pause.y);
  const sum = values => values[0] + values[1] + values[2];
  return { ...hud, ringPixel: ring, holePixel: hole, ringLum: sum(ring), holeLum: sum(hole),
    canvas: { width: canvas.width, height: canvas.height, ratio },
    canvasDataUrl: canvas.toDataURL('image/png') };
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
    const record = manager.records.get('milthm-fmt2-bridge');
    return { loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status, version: record?.manifest?.version };
  })()`));

  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.length === 19 ? true : null; })()`, 120000, 'import');

  step('open-preview', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    editor.pause?.();
    editor.setPreview(true);
    return { visible: editor.preview?.visible };
  })()`));
  await waitFor(`(() => { const preview = window.rpenMods.editor.preview; return preview?.visible && preview.canvas?.clientWidth > 100; })()`, 30000, 'preview visible');

  const late = await evaluate(drawAt(30));
  const lateShot = late?.canvasDataUrl;
  if (typeof lateShot === 'string' && lateShot.startsWith('data:image/png;base64,')) {
    fs.writeFileSync(path.join(OUT, 'hud-canvas.png'), Buffer.from(lateShot.split(',')[1], 'base64'));
  }
  if (late) delete late.canvasDataUrl;
  step('hud-late', late);
  const pageShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'hud.png'), Buffer.from(pageShot.data, 'base64'));

  const early = await evaluate(drawAt(0));
  if (early) delete early.canvasDataUrl;
  step('hud-early', early);

  const height = late?.referenceHeight ?? 0;
  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    title: late?.title ?? null,
    level: late?.level ?? null,
    score: late?.score ?? null,
    accuracy: late?.accuracy ?? null,
    combo: late?.combo ?? null,
    allPerfect: late?.allPerfect ?? null,
    hudSeconds: late?.seconds ?? null,
    referenceHeight: height,
    titleOk: Boolean(late?.title && late.title.length > 0),
    levelOk: Boolean(late?.level && late.level.length > 0),
    scoreOk: /^\d{7}$/.test(String(late?.score ?? '')) && Number(late?.score) > 0,
    accuracyOk: late?.accuracy === '100.00%',
    comboOk: Number(late?.combo ?? 0) >= 3,
    allPerfectOk: late?.allPerfect === 'All Perfect',
    earlyComboZero: Number(early?.combo ?? -1) === 0,
    earlyNoAllPerfect: early?.allPerfect === null,
    pauseRingLighterThanHoles: Number(late?.ringLum ?? 0) >= Number(late?.holeLum ?? 0) - 5,
    exceptions: exceptions.length,
  };
  // reference proportions: pause diameter ≈ 7.1% of the preview height, combo ≈ 4.9% font
  result.pauseRatio = height ? Number(((late?.pause?.radius * 2) / height).toFixed(4)) : null;
  result.pauseRatioOk = Math.abs(Number(result.pauseRatio ?? 0) - 0.081) <= 0.012;
  result.pauseBarWidthRatio = late?.pause?.radius ? Number((late.pause.barWidth / late.pause.radius).toFixed(3)) : null;
  result.pauseBarHeightRatio = late?.pause?.radius ? Number((late.pause.barHeight / late.pause.radius).toFixed(3)) : null;
  result.pauseGapRatio = late?.pause?.radius ? Number((late.pause.gap / late.pause.radius).toFixed(3)) : null;
  result.pauseShapeOk = Math.abs(Number(result.pauseBarWidthRatio ?? 0) - 0.19) <= 0.02
    && Math.abs(Number(result.pauseBarHeightRatio ?? 0) - 1.2) <= 0.06
    && Math.abs(Number(result.pauseGapRatio ?? 0) - 0.21) <= 0.02;
  result.ok = result.titleOk && result.levelOk && result.scoreOk && result.accuracyOk && result.comboOk
    && result.allPerfectOk && result.earlyComboZero && result.earlyNoAllPerfect
    && result.pauseRingLighterThanHoles && result.pauseRatioOk && result.pauseShapeOk && result.exceptions === 0;
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
