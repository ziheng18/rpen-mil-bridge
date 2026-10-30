// Quick probe: exercise the remaining Milthm channel editors (line-size / note-alpha / head / whole / flow).
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
const evaluate = async (expression, awaitPromise = true) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
};
const waitFor = async (expression, timeout = 60000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); } throw new Error('timeout ' + label); };
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return window.rpenMods.manager.runtime.loaded.has('milthm-fmt2-bridge'); })()`, 60000, 'mod');
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => window.rpenMods.editor?.chart?.['x-milthm'])()`, 90000, 'import');
  await sleep(1200);
  const result = await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const panel = document.querySelector('.milthm-panel');
    const typeSelect = panel.querySelector('[data-m-role="type"]');
    const choose = async type => { typeSelect.value = type; typeSelect.dispatchEvent(new Event('change')); await new Promise(resolve => setTimeout(resolve, 250)); };
    editor.selectLine(1);
    await new Promise(resolve => setTimeout(resolve, 300));
    const line = editor.chart.judgeLineList[1];
    const before = {
      scaleX: line.extended?.scaleXEvents?.length ?? 0,
      scaleY: line.extended?.scaleYEvents?.length ?? 0,
      bodyAlpha: line['x-milthm']?.channels?.bodyAlpha?.length ?? 0,
      headAlpha: line['x-milthm']?.channels?.headAlpha?.length ?? 0,
      wholeAlpha: line['x-milthm']?.channels?.wholeAlpha?.length ?? 0,
      flowSpeed: line['x-milthm']?.channels?.flowSpeed?.length ?? 0,
    };
    await choose('line-size');
    panel.querySelector('[data-m-action="add-event"]').click();
    await new Promise(resolve => setTimeout(resolve, 600));
    const lineAfter = editor.chart.judgeLineList[1];
    const size = { scaleX: lineAfter.extended?.scaleXEvents?.length ?? 0, scaleY: lineAfter.extended?.scaleYEvents?.length ?? 0, synced: JSON.stringify(lineAfter.extended?.scaleXEvents) === JSON.stringify(lineAfter.extended?.scaleYEvents) };
    // note-level transparency
    editor.session.selection = new Set([0]);
    editor.session.focus = 'notes';
    await new Promise(resolve => setTimeout(resolve, 400));
    await choose('note-alpha');
    panel.querySelector('[data-m-action="add-event"]').click();
    await new Promise(resolve => setTimeout(resolve, 600));
    const note = editor.chart.judgeLineList[1].notes[0];
    const noteAlpha = (note['x-milthm']?.animations ?? []).filter(animation => Number(animation.type) === 2).length;
    return { before, size, noteAlpha };
  })()`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.log('FAILED', String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  try { await send('Page.close'); } catch { }
  ws.close();
}
