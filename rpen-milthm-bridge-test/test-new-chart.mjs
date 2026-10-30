// Test the new "create Milthm chart" option in the already-open demo window (CDP 9334).
import fs from 'node:fs';
import path from 'node:path';
const CDP = 9334;
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'newchart-test');
const DL = path.join(OUT, 'downloads');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
fs.mkdirSync(DL, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }
const targets = await fetchJson(`http://127.0.0.1:${CDP}/json/list`);
const target = targets.find(item => item.type === 'page' && String(item.url).includes('127.0.0.1:4173'));
if (!target) { console.log('NO PAGE'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0; const errors = [];
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); return; } if (message.method === 'Runtime.exceptionThrown') errors.push((message.params.exceptionDetails?.exception?.description ?? '').slice(0, 400)); };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
const evaluate = async (expression, awaitPromise = true) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; };
const waitFor = async (expression, timeout = 30000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout ' + label); };
const shot = async name => { const data = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data.data, 'base64')); };
const report = {};
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`, 60000, 'boot');
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  report.mod = await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true;
    manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 700));
    return { loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status, version: manager.records.get('milthm-fmt2-bridge')?.manifest?.version };
  })()`);
  // click 新建 -> our dialog must appear
  await evaluate(`(() => { document.querySelector('#new')?.click(); return true; })()`);
  await waitFor(`(() => !!document.querySelector('#milthm-new-chart-dialog'))()`, 10000, 'new chart dialog');
  report.dialog = await evaluate(`(() => {
    const dialog = document.querySelector('#milthm-new-chart-dialog');
    return { text: dialog.textContent.replace(/\\s+/g, ' ').slice(0, 200), buttons: [...dialog.querySelectorAll('button')].map(button => button.textContent) };
  })()`);
  await shot('new-chart-dialog.png');
  // choose Milthm
  await evaluate(`(() => { const buttons = [...document.querySelectorAll('#milthm-new-chart-dialog button')]; buttons.find(button => button.textContent.includes('Milthm'))?.click(); return true; })()`);
  report.milthmChart = await waitFor(`(() => {
    const editor = window.rpenMods.editor;
    const chart = editor?.chart;
    if (!chart?.['x-milthm']) return null;
    return {
      marker: chart['x-milthm'].kind, lines: chart.judgeLineList.length,
      name: chart.META.name, bpm: chart.BPMList?.[0]?.bpm,
      panel: !!document.querySelector('.milthm-panel'),
      panelVisible: document.querySelector('.milthm-panel')?.style.display !== 'none',
      timelineSelect: !!document.querySelector('#milthm-timeline-select'),
    };
  })()`, 20000, 'milthm chart');
  await sleep(800);
  await shot('new-chart-milthm.png');
  // export the empty Milthm chart
  report.export = await evaluate(`(async () => {
    const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:export-json');
    return await command.run();
  })()`);
  await sleep(2500);
  const files = fs.readdirSync(DL).filter(name => name.endsWith('.json'));
  report.exported = files.map(name => {
    const json = JSON.parse(fs.readFileSync(path.join(DL, name), 'utf-8'));
    return { file: name, fmt: json.fmt, lines: json.lines.length, notes: json.lines.reduce((sum, line) => sum + line.notes.length, 0), meta: json.meta, animations: json.lines.reduce((sum, line) => sum + line.animations.length, 0) };
  });
  // now create a plain RPE chart via the same dialog
  await evaluate(`(() => { document.querySelector('#new')?.click(); return true; })()`);
  await waitFor(`(() => !!document.querySelector('#milthm-new-chart-dialog'))()`, 10000, 'dialog again');
  await evaluate(`(() => { const buttons = [...document.querySelectorAll('#milthm-new-chart-dialog button')]; buttons.find(button => button.textContent.includes('普通'))?.click(); return true; })()`);
  report.rpeChart = await waitFor(`(() => {
    const editor = window.rpenMods.editor;
    const chart = editor?.chart;
    if (!chart || chart['x-milthm']) return null;
    return { marker: null, lines: chart.judgeLineList.length, name: chart.META?.name, panelVisible: document.querySelector('.milthm-panel')?.style.display !== 'none' };
  })()`, 20000, 'rpe chart');
  // leave the demo window on a Milthm chart for the user
  await evaluate(`(() => { const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:new-milthm-chart'); command?.run(); return true; })()`);
  await sleep(1000);
  await shot('final-demo.png');
  console.log(JSON.stringify(report, null, 2));
  console.log('ERRORS', JSON.stringify(errors.slice(0, 5)));
} catch (error) {
  console.log('FAILED', String(error?.stack ?? error));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  ws.close();
}
