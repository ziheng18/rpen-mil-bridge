// Live probe: adding a judge line to a Milthm chart must not loop; 判定线 panel stays clickable.
// (v0.6.4 regression: v0.6.3 looped "初始化 Milthm 事件列" forever after ＋新增, so panel clicks were lost.)
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'line-panel');
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
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const s = Date.now(); while (Date.now() - s < timeout) { try { const v = await evaluate(expression); if (v) return v; } catch { } await sleep(300); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1200)); };

// click an inspector button with a real mouse event (pointer must land on the button itself)
async function clickInspectorButton(text) {
  const rect = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.inspector button')].find(b => (b.textContent || '').trim() === ${JSON.stringify(text)});
    if (!button) return null;
    button.scrollIntoView({ block: 'center', inline: 'nearest' });
    return { text: button.textContent.trim(), disabled: button.disabled };
  })()`);
  if (!rect || rect.disabled) return { clicked: false, rect };
  await sleep(250);
  const point = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.inspector button')].find(b => (b.textContent || '').trim() === ${JSON.stringify(text)});
    if (!button) return null;
    const r = button.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: top === button || button.contains(top) };
  })()`);
  if (!point) return { clicked: false, rect, reason: 'gone' };
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(550);
  return { clicked: true, hit: point.hit, ...rect };
}

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
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.length === 19 ? true : null; })()`, 90000, 'import');
  await waitFor(`(() => window.rpenMods.editor?.audio?.buffer?.duration > 1)()`, 30000, 'audio');
  await evaluate(`[...document.querySelectorAll('button')].find(el => (el.textContent || '').trim() === '判定线')?.click()`);
  await sleep(800);

  // instrument commit calls
  await evaluate(`(() => {
    const session = window.rpenMods.editor.session;
    window.__probeCommits = [];
    if (!session.__probeWrapped) {
      const original = session.commit.bind(session);
      session.commit = function(label, chart, beforeSelection) {
        try { return original(label, chart, beforeSelection); }
        finally { (window.__probeCommits ??= []).push({ label, lines: chart?.judgeLineList?.length ?? null, t: performance.now() }); }
      };
      session.__probeWrapped = true;
    }
    return true;
  })()`);

  // 1) click ＋ 新增 and let the ensure-loop bug (if any) show up for 2 seconds
  step('before add', await evaluate(`(() => ({ lines: window.rpenMods.editor.chart.judgeLineList.length, undo: window.rpenMods.editor.session.history.undoStack.length, commits: (window.__probeCommits = []).length }))()`));
  const addClick = await clickInspectorButton('＋ 新增');
  await sleep(2000);
  const alphaSummaryScript = `(line => {
    const events = line?.['x-milthm']?.events;
    const read = key => (events?.[key] ?? []).map(event => ({ startTime: event.startTime, endTime: event.endTime, start: event.start, end: event.end }));
    return { lineAlpha: read('lineAlpha'), bodyAlpha: read('bodyAlpha'), headAlpha: read('headAlpha'), x: (events?.x ?? []).length, flowSpeed: (events?.flowSpeed ?? []).length };
  })`;
  step('after add', await evaluate(`(() => {
    const chart = window.rpenMods.editor.chart;
    const added = chart.judgeLineList[chart.judgeLineList.length - 1];
    const commits = window.__probeCommits ?? [];
    const alphaSummary = ${alphaSummaryScript};
    return {
      lines: chart.judgeLineList.length,
      undo: window.rpenMods.editor.session.history.undoStack.length,
      commitCount2s: commits.length,
      commitLabels: commits.map(entry => entry.label),
      addedLineHasStash: Boolean(added?.['x-milthm']),
      addedLineHasEvents: Boolean(added?.['x-milthm']?.events),
      addedLineAlpha: alphaSummary(added),
    };
  })()`));
  step('add click', addClick);

  // 2) panel must be responsive: alternate 上移 / 下移 six times (the new line is the last one,
  //    so the first move must be 上移; otherwise the button is legitimately disabled).
  let moved = 0;
  const attempts = [];
  for (let i = 0; i < 6; i++) {
    const label = i % 2 === 0 ? '上移' : '下移';
    const before = await evaluate(`window.rpenMods.editor.session.lineIndex`);
    const click = await clickInspectorButton(label);
    const after = await evaluate(`window.rpenMods.editor.session.lineIndex`);
    if (before !== after) moved += 1;
    attempts.push({ label, before, after, clicked: click.clicked });
    await sleep(250);
  }
  step('responsiveness', { moved, attempts: attempts.length, details: attempts });

  // 3) opacity initialisation on a brand-new Milthm chart: Track 0 = 255, added lines = 0.
  step('new chart line 0', await evaluate(`(async () => {
    const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:new-milthm-chart');
    await command.run();
    await new Promise(resolve => setTimeout(resolve, 900));
    const chart = window.rpenMods.editor.chart;
    const alphaSummary = ${alphaSummaryScript};
    return { kind: chart?.['x-milthm']?.kind, lines: chart?.judgeLineList?.length, line0: alphaSummary(chart?.judgeLineList?.[0]) };
  })()`));
  await evaluate(`[...document.querySelectorAll('button')].find(el => (el.textContent || '').trim() === '判定线')?.click()`);
  await sleep(600);
  await clickInspectorButton('＋ 新增');
  await sleep(1200);
  step('new chart line 1', await evaluate(`(() => {
    const chart = window.rpenMods.editor.chart;
    const alphaSummary = ${alphaSummaryScript};
    return { lines: chart?.judgeLineList?.length, line1: alphaSummary(chart?.judgeLineList?.[1]) };
  })()`));

  const scroll = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'editor-line-panel.png'), Buffer.from(scroll.data, 'base64'));

  const data = name => report.steps.find(entry => entry.name === name)?.data ?? {};
  const oneBeatAtZero = events => Array.isArray(events) && events.length === 1
    && JSON.stringify(events[0].startTime) === JSON.stringify([0, 0, 1])
    && JSON.stringify(events[0].endTime) === JSON.stringify([0, 1, 1]);
  const isOpaqueInit = events => oneBeatAtZero(events) && Number(events[0].start) === 1;
  const isTransparentInit = events => oneBeatAtZero(events) && Number(events[0].start) === 0;
  const addedAlpha = data('after add').addedLineAlpha ?? {};
  const line0Alpha = data('new chart line 0').line0 ?? {};
  const line1Alpha = data('new chart line 1').line1 ?? {};
  const result = {
    version: data('mod').version,
    addedLines: data('after add').lines,
    commitCountAfterAdd: data('after add').commitCount2s,
    addedLineHasStash: data('after add').addedLineHasStash && data('after add').addedLineHasEvents,
    addedLineZeroInit: isTransparentInit(addedAlpha.lineAlpha) && isTransparentInit(addedAlpha.bodyAlpha) && isTransparentInit(addedAlpha.headAlpha),
    newChartTrack0OpaqueInit: isOpaqueInit(line0Alpha.lineAlpha) && isOpaqueInit(line0Alpha.bodyAlpha) && isOpaqueInit(line0Alpha.headAlpha),
    newChartAddedLineZeroInit: isTransparentInit(line1Alpha.lineAlpha) && isTransparentInit(line1Alpha.bodyAlpha) && isTransparentInit(line1Alpha.headAlpha),
    panelMoves: data('responsiveness').moved,
    exceptions: exceptions.length,
  };
  result.ok = result.addedLines === 20 && result.commitCountAfterAdd <= 3 && result.addedLineHasStash
    && result.addedLineZeroInit && result.newChartTrack0OpaqueInit && result.newChartAddedLineZeroInit
    && result.panelMoves === 6 && result.exceptions === 0;
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