// Live probe: the Milthm timeline-column dropdowns (`.milthm-column-bar`) must hide while the
// playback preview is open and come back when it closes.
//
// Regression for v0.7.14: the bar is `position:fixed` over the event-column header, so it used to
// float above the preview canvas (and its HUD) after clicking 预览. RPEN hides its own column
// labels in preview (`#multi-line-labels`), so the mod must do the same.
//
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'column-overlay');
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
const waitFor = async (expression, timeout = 120000, label = 'wait') => { const s = Date.now(); while (Date.now() - s < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(200); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 800)); };

const STATE = `(() => {
  const editor = window.rpenMods.editor;
  const bar = document.querySelector('.milthm-column-bar');
  return {
    previewVisible: Boolean(editor?.preview?.visible),
    previewPlaying: Boolean(editor?.preview?.playing),
    overlay: bar ? { display: bar.style.display, position: bar.getBoundingClientRect().toJSON?.() ?? null } : null,
    slotLabels: bar ? [...bar.querySelectorAll('select')].map(select => select.value) : [],
    multiLineLabelsHidden: document.querySelector('#multi-line-labels')?.hidden ?? null,
  };
})()`;
const screenshot = async name => {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, 'base64'));
};

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
  await waitFor(`(() => { const bar = document.querySelector('.milthm-column-bar'); return bar && bar.style.display === 'flex' && bar.querySelectorAll('select').length === 5; })()`, 20000, 'overlay visible');
  const editorState = await evaluate(STATE);
  step('editor', editorState);
  await screenshot('editor.png');

  /* open the preview and make sure the bar hides immediately (before the 350ms poll) */
  await evaluate(`(() => { window.rpenMods.editor.setPreview(true); return true; })()`);
  await sleep(180);
  const opened = await evaluate(STATE);
  step('preview-opened', opened);
  await waitFor(`(() => Boolean(window.rpenMods.editor?.preview?.visible))()`, 15000, 'preview visible');
  await sleep(900);
  const previewed = await evaluate(STATE);
  step('preview-running', previewed);
  await screenshot('preview.png');

  /* close it again */
  await evaluate(`(() => { window.rpenMods.editor.setPreview(false); return true; })()`);
  await sleep(350);
  const closed = await evaluate(STATE);
  step('preview-closed', closed);
  await screenshot('editor-restored.png');

  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    editorOverlayDisplay: editorState.overlay?.display,
    editorSlots: editorState.slotLabels,
    previewVisible: previewed.previewVisible,
    previewOverlayDisplay: previewed.overlay?.display,
    previewHidesOwnLabels: previewed.multiLineLabelsHidden,
    hiddenImmediately: opened.overlay?.display === 'none',
    restoredDisplay: closed.overlay?.display,
    restoredPreviewVisible: closed.previewVisible,
    exceptions: exceptions.length,
  };
  result.ok = Boolean(result.version)
    && result.editorOverlayDisplay === 'flex'
    && result.previewVisible === true
    && result.previewOverlayDisplay === 'none'
    && result.hiddenImmediately === true
    && result.restoredDisplay === 'flex'
    && result.restoredPreviewVisible === false
    && result.exceptions === 0;
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
  try { await send('Page.close'); } catch { }
  ws.close();
}
