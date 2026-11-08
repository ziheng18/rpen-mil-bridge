// Live probe (RPEN 0.14.0): Milthm HUD in the new 渲染 (video render) feature.
//   - the mod must patch AutoplayScene (render-studio) paintHud, because that class replaces the
//     instance's Preview.drawUi with its own HUD painter;
//   - a Milthm chart painted through the patched paintHud must produce the Milthm HUD
//     (pause circle / title / score / combo) on the scratch canvas;
//   - a non-Milthm chart must fall through to the stock autoplay HUD;
//   - opening the real render panel must not throw.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'render-hud');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1400)); };
const result = { ok: false };
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`);
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  step('mod', await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true; manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 1200));
    return { loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status, version: manager.records.get('milthm-fmt2-bridge')?.manifest?.version };
  })()`));

  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const fileInput = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: fileInput.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.length > 0 ? true : null; })()`, 120000, 'import');
  await evaluate(`(() => { window.rpenMods.editor.pause?.(); return true; })()`);

  // 1) the render-studio class is patched
  step('patch', await evaluate(`(async () => {
    const { AutoplayScene } = await import('/src/ui/render-studio/renderer.mjs');
    return { hasClass: Boolean(AutoplayScene?.prototype?.paintHud), patched: String(AutoplayScene?.prototype?.paintHud ?? '').includes('Milthm') };
  })()`));

  // 2) Milthm chart through the patched paintHud -> Milthm HUD on the scratch canvas
  step('milthm-hud', await evaluate(`(async () => {
    const { AutoplayScene } = await import('/src/ui/render-studio/renderer.mjs');
    const editor = window.rpenMods.editor;
    const scene = Object.create(AutoplayScene.prototype);
    scene.chart = editor.chart;
    scene.hudEnabled = true;
    scene.project = { duration: 100 };
    scene.preview = { completionTimes: [1, 2, 3, 4, 5], duration: 100 };
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
    const context = canvas.getContext('2d');
    context.fillStyle = '#000'; context.fillRect(0, 0, 960, 540);
    const frame = { width: 960, height: 540, viewport: { left: 0, top: 0, width: 960, height: 540 }, scale: 960 / 1350, states: [{}] };
    let error = null;
    try { scene.paintHud(context, frame, 10); } catch (thrown) { error = String(thrown?.stack ?? thrown); }
    const data = context.getImageData(0, 0, 960, 540).data;
    let lit = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] > 200 || data[index + 1] > 200 || data[index + 2] > 200) lit += 1;
    return { error, litPixels: lit, hud: scene.preview.__milthmHud ?? null };
  })()`));

  // 3) non-Milthm chart -> stock autoplay HUD path (states empty -> stock returns early)
  step('rpe-passthrough', await evaluate(`(async () => {
    const { AutoplayScene } = await import('/src/ui/render-studio/renderer.mjs');
    const editor = window.rpenMods.editor;
    const chart = structuredClone(editor.chart);
    delete chart['x-milthm'];
    const scene = Object.create(AutoplayScene.prototype);
    scene.chart = chart;
    scene.hudEnabled = true;
    scene.project = { duration: 100 };
    scene.preview = { completionTimes: [1, 2, 3], duration: 100 };
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
    const context = canvas.getContext('2d');
    const frame = { width: 960, height: 540, viewport: { left: 0, top: 0, width: 960, height: 540 }, scale: 960 / 1350, states: [] };
    let error = null;
    try { scene.paintHud(context, frame, 10); } catch (thrown) { error = String(thrown?.stack ?? thrown); }
    return { error, stockHudCalled: scene.preview.__milthmHud === undefined };
  })()`));

  // 4) the real render panel opens and draws without exceptions
  await evaluate(`(() => { const button = document.querySelector('#render-video'); if (button) button.click(); return Boolean(button); })()`);
  await sleep(2500);
  step('render-panel', await evaluate(`(() => {
    const root = document.querySelector('#rpen-render-studio');
    const canvases = root ? [...root.querySelectorAll('canvas')].map(canvas => ({ width: canvas.width, height: canvas.height })) : [];
    return { open: Boolean(root), canvases };
  })()`));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'render-panel.png'), Buffer.from(shot.data, 'base64'));

  const patchStep = report.steps.find(item => item.name === 'patch')?.data ?? {};
  const hudStep = report.steps.find(item => item.name === 'milthm-hud')?.data ?? {};
  const passStep = report.steps.find(item => item.name === 'rpe-passthrough')?.data ?? {};
  const panelStep = report.steps.find(item => item.name === 'render-panel')?.data ?? {};
  result.patchInstalled = Boolean(patchStep.patched);
  result.hudError = hudStep.error ?? null;
  result.hudLitPixels = Number(hudStep.litPixels ?? 0);
  result.hudTitle = hudStep.hud?.title ?? null;
  result.hudCombo = hudStep.hud?.combo ?? null;
  result.stockHudForRpe = Boolean(passStep.stockHudCalled) && !passStep.error;
  result.renderPanelOpened = Boolean(panelStep.open);
  const normalizedTitle = String(result.hudTitle ?? '').replace(/\s+/g, ' ').trim(); // the chart title uses a NBSP
  result.ok = result.patchInstalled && !result.hudError && result.hudLitPixels > 1000
    && normalizedTitle === 'Class Memories' && result.hudCombo === 5
    && result.stockHudForRpe && exceptions.length === 0;
  result.steps = report.steps;
} catch (error) {
  console.log('FAILED', String(error?.stack ?? error));
  result.error = String(error?.stack ?? error);
} finally {
  report.result = result;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', JSON.stringify({ ok: result.ok, exceptions: exceptions.length, result: { ...result, steps: undefined } }, null, 1));
  try { await send('Page.close'); } catch { }
  ws.close();
}
if (!result.ok) process.exitCode = 1;
