// End-to-end RPEN test: install the Milthm bridge mod, import a Milthm zip,
// exercise the lane lock, export chart.json / zip and capture artifacts.
// Usage: node integration-test.mjs
import fs from 'node:fs';
import path from 'node:path';

const CDP_PORT = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'integration');
const DL = path.join(OUT, 'downloads');
const MOD_FILE = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_FILE = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
fs.mkdirSync(DL, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  return JSON.parse(await response.text());
}

const target = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const events = [];
let messageId = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = event => {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.id && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    return;
  }
  const method = message.method, params = message.params;
  if (method === 'Runtime.consoleAPICalled') events.push({ kind: 'console', level: params.type, text: (params.args ?? []).map(arg => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 600) });
  else if (method === 'Runtime.exceptionThrown') { const details = params.exceptionDetails ?? {}; events.push({ kind: 'exception', text: (details.exception?.description ?? details.text ?? '').slice(0, 1200) }); }
  else if (method === 'Log.entryAdded') { const entry = params.entry ?? {}; if (entry.level !== 'info') events.push({ kind: 'log', level: entry.level, text: (entry.text ?? '').slice(0, 600) }); }
  else if (method === 'Network.loadingFailed') events.push({ kind: 'netfail', error: params.errorText, type: params.type });
  else if (method === 'Page.downloadWillBegin') events.push({ kind: 'download', suggested: params.suggestedFilename });
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Network.enable');
await send('DOM.enable');
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
await send('Runtime.evaluate', { expression: 'window.__dshTest = {};' });

const evaluate = async (expression, awaitPromise = true) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
};
async function waitFor(expression, timeoutMs = 30000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const value = await evaluate(expression); if (value) return value; } catch { /* keep waiting */ }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

const report = { steps: [], events };
const step = (name, data) => { report.steps.push({ name, ...(data === undefined ? {} : { data }) }); console.log('STEP', name, data === undefined ? '' : JSON.stringify(data).slice(0, 800)); };

try {
  // 0) wait for editor
  const boot = await waitFor(`(async () => {
    if (!window.rpenMods?.manager) return null;
    await window.rpenMods.manager.ready;
    return { records: [...window.rpenMods.manager.records.keys()], home: window.rpenMods.editor?.home ?? null };
  })()`, 60000, 'editor boot');
  step('boot', boot);

  // 1) install + enable the mod (review dialog auto-accepted for the automated test)
  const modBase64 = fs.readFileSync(MOD_FILE).toString('base64');
  const installed = await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true;                      // test shortcut: replace package without a prompt
    manager.review = async () => true;                // test shortcut: skip the risk dialog
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    const file = new File([bytes], 'milthm-fmt2-bridge.rpenmod');
    await manager.importFiles([file]);
    await manager.enable('milthm-fmt2-bridge');
    const state = manager.runtime.loaded.get('milthm-fmt2-bridge');
    return {
      records: [...manager.records.keys()],
      loaded: state?.status ?? null,
      commands: [...manager.runtime.commands.keys()].filter(k => k.startsWith('milthm-fmt2-bridge')),
      panel: !!document.querySelector('.milthm-bridge-panel'),
    };
  })()`);
  step('mod installed', installed);

  // 2) import the Milthm chart zip through the native file input
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  if (!input.nodeId) throw new Error('#file-input not found');
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_FILE] });

  const imported = await waitFor(`(() => {
    const editor = window.rpenMods.editor;
    const chart = editor?.chart;
    if (!chart || !Array.isArray(chart.judgeLineList) || !chart.judgeLineList.length) return null;
    if (!chart['x-milthm']) return null;
    const notes = chart.judgeLineList.flatMap(line => line.notes ?? []);
    return {
      chartName: editor.chartName,
      lines: chart.judgeLineList.length,
      notes: notes.length,
      nonZeroX: notes.filter(note => Number(note.positionX) !== 0).length,
      noteTypes: notes.reduce((acc, note) => (acc[note.type] = (acc[note.type] ?? 0) + 1, acc), {}),
      marker: chart['x-milthm'].kind,
      meta: { name: chart.META.name, offset: chart.META.offset, level: chart.META.level },
      audioDuration: Number.isFinite(editor.audio?.buffer?.duration) ? editor.audio.buffer.duration : null,
      panelVisible: !!document.querySelector('.milthm-bridge-panel') && document.querySelector('.milthm-bridge-panel').style.display !== 'none',
      panelText: document.querySelector('.milthm-bridge-panel')?.innerText?.replace(/\s+/g, ' ').slice(0, 200) ?? null,
    };
  })()`, 60000, 'Milthm chart import');
  step('imported chart', imported);

  // the mod backfills META.song / META.background from the package assets
  let mediaBind = null;
  try {
    mediaBind = await waitFor(`(() => {
      const chart = window.rpenMods.editor?.chart;
      return chart?.META?.song && chart?.META?.background ? { song: chart.META.song, background: chart.META.background, dirty: window.rpenMods.editor.dirty } : null;
    })()`, 20000, 'media binding');
  } catch { mediaBind = null; }
  step('media bind', mediaBind);

  // audio / cover should be auto-inferred from the zip assets
  let audio = null;
  try {
    audio = await waitFor(`(() => {
      const duration = window.rpenMods.editor?.audio?.buffer?.duration;
      return Number.isFinite(duration) && duration > 1 ? { duration } : null;
    })()`, 15000, 'audio decode');
  } catch { audio = { duration: null }; }
  step('audio', audio);
  const status = await evaluate(`(() => {
    const text = document.body.innerText;
    return { hasMissingMediaHint: text.includes('缺少音乐') || text.includes('缺少封面'), tail: text.slice(-260) };
  })()`);
  step('status', status);

  // screenshot of the editor with the imported chart
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'editor-imported.png'), Buffer.from(shot1.data, 'base64'));

  // 3) lane lock: a commit with note positionX != 0 must be normalized back to 0
  const laneTest = await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const before = editor.chart.judgeLineList.map(line => line.notes?.length ?? 0);
    const chart = structuredClone(editor.chart);
    const lineIndex = chart.judgeLineList.findIndex(line => (line.notes?.length ?? 0) > 0);
    chart.judgeLineList[lineIndex].notes[0].positionX = 300;
    chart.judgeLineList[lineIndex].notes[0].size = 2;
    chart.judgeLineList[lineIndex].bpmfactor = 3;
    editor.commit('bridge lane test', chart);
    await new Promise(resolve => setTimeout(resolve, 300));
    const line = editor.chart.judgeLineList[lineIndex];
    return {
      lineIndex,
      noteCountsSame: before.length === editor.chart.judgeLineList.length,
      positionX: line.notes[0].positionX, size: line.notes[0].size, bpmfactor: line.bpmfactor,
      dirty: editor.dirty,
    };
  })()`);
  step('lane lock commit', laneTest);

  // 4) export Milthm chart.json through the registered mod command
  const runCommand = async commandId => evaluate(`(async () => {
    const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:${commandId}');
    if (!command) return { error: 'command missing' };
    const result = await command.run();
    return { ok: true, result };
  })()`);
  const exportJsonResult = await runCommand('export-json');
  await sleep(2500);
  step('export-json command', exportJsonResult);

  const exportZipResult = await runCommand('export-zip');
  await sleep(4000);
  step('export-zip command', exportZipResult);

  const downloads = fs.existsSync(DL) ? fs.readdirSync(DL).map(name => ({ name, size: fs.statSync(path.join(DL, name)).size })) : [];
  step('downloads', downloads);

  // 7) re-import the freshly exported package to prove the exported format is accepted again
  const exportedZip = downloads.find(file => file.name.toLowerCase().endsWith('.zip'));
  if (exportedZip) {
    const doc2 = await send('DOM.getDocument', { depth: -1, pierce: true });
    const input2 = await send('DOM.querySelector', { nodeId: doc2.root.nodeId, selector: '#file-input' });
    await send('DOM.setFileInputFiles', { nodeId: input2.nodeId, files: [path.join(DL, exportedZip.name)] });
    const reimported = await waitFor(`(() => {
      const chart = window.rpenMods.editor?.chart;
      if (!chart?.['x-milthm']) return null;
      const notes = chart.judgeLineList.flatMap(line => line.notes ?? []);
      return { lines: chart.judgeLineList.length, notes: notes.length, marker: chart['x-milthm'].kind, nonZeroX: notes.filter(n => Number(n.positionX) !== 0).length };
    })()`, 60000, 're-import exported zip');
    step('re-import exported zip', reimported);
  }

  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'editor-after-export.png'), Buffer.from(shot2.data, 'base64'));
} catch (error) {
  step('FAILED', { message: String(error?.message ?? error) });
  report.error = String(error?.stack ?? error);
} finally {
  report.eventCounts = events.reduce((acc, event) => (acc[event.kind] = (acc[event.kind] ?? 0) + 1, acc), {});
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== event counts ===', JSON.stringify(report.eventCounts));
  for (const event of events.filter(event => event.kind === 'exception').slice(0, 5)) console.log('EXCEPTION:', event.text.slice(0, 500));
  for (const event of events.filter(event => event.kind === 'log' && event.level === 'error').slice(0, 8)) console.log('LOG ERROR:', event.text.slice(0, 400));
  try { await send('Page.close'); } catch { }
  ws.close();
  process.exitCode = report.error ? 1 : 0;
}
