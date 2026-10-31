// Live probe: 多线编辑 adaptations for Milthm charts (v0.7.2 + v0.7.3).
// - event-type dropdown labels follow the current column mapping (着色器 hidden);
// - the timeline header strip shows the semantic column names (single- and multi-line mode);
// - the panel's "编辑事件列" checkbox group selects the matching events on the left target lines.
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'multi-edit');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fetchJson = async (url, options) => JSON.parse(await (await fetch(url, options)).text());
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
const exceptions = [];
const consoleMessages = [];
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); return; }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push((message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? '').slice(0, 500));
  if (message.method === 'Runtime.consoleAPICalled') consoleMessages.push((message.params.args ?? []).map(arg => arg.value ?? arg.description ?? '').join(' ').slice(0, 400));
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const waitFor = async (expression, timeout = 120000, label = 'wait') => { const s = Date.now(); while (Date.now() - s < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions, console: consoleMessages };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 2000)); };
const FIND_FILTER = `[...(document.querySelector('#multi-editor')?.querySelectorAll('select') ?? [])].find(select => select.dataset.milthmEventFilter === '1' || [...select.options].some(option => option.value === 'paintEvents'))`;
const READ_OPTIONS = `(() => {
  const filter = ${FIND_FILTER};
  if (!filter) return null;
  return { value: filter.value, title: filter.title, options: [...filter.options].map(option => ({ value: option.value, label: option.textContent })) };
})()`;
const READ_CHECKBOXES = `(() => {
  const list = document.querySelector('#multi-editor [data-milthm-edit-columns] .milthm-edit-columns-list');
  if (!list) return null;
  return [...list.querySelectorAll('label')].map(label => ({ value: label.querySelector('input')?.value, label: label.textContent, checked: Boolean(label.querySelector('input')?.checked) }));
})()`;
const BASE_LABELS = ['X 坐标', 'Y 坐标', '旋转', '线体不透明度（LineBodyTransparency 8）', '流速倍率'];
const REMAPPED_LABELS = ['X 坐标', 'Y 坐标', '旋转', '轨道整体不透明度（线头+线身，Transparency 2）', '流速倍率'];
// the timeline header strip uses the short semantic names (narrow columns)
const HEADER_LABELS = ['X 坐标', 'Y 坐标', '旋转', '轨道整体不透明度', '流速倍率'];
const EXPECTED = ['全部', ...BASE_LABELS, '轨道大小·X（Size 3）', '轨道大小·Y（Size 3）', '轨道颜色（Color 22）', '轨道文字（文本事件）'];
const hasPaint = options => options.some(option => option.value === 'paintEvents');
const labelsOf = options => options.map(option => option.label);
const keysOf = options => options.map(option => option.value);
const headerLabels = () => evaluate(`window.rpenMods.editor.timeline?.__milthmHeaderLabels ?? null`);

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
    const state = manager.runtime.loaded.get('milthm-fmt2-bridge');
    return { loaded: state?.status, version: record?.manifest?.version };
  })()`));

  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.length === 19 ? true : null; })()`, 120000, 'import');

  // ---- v0.7.2: event-type dropdown ----
  step('open-panel', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    editor.multiEdit.open('events');
    return { kind: editor.multiEdit.kind, columns: editor.chart['x-milthm'].columns.slice() };
  })()`));
  await waitFor(`(() => Boolean(${FIND_FILTER}))()`, 10000, 'panel dropdown');
  const initial = await evaluate(READ_OPTIONS);
  step('dropdown-default-columns', initial);

  step('remap', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const next = structuredClone(editor.chart);
    next['x-milthm'].columns = ['x', 'y', 'rotate', 'lineAlpha', 'flowSpeed'];
    editor.commit('probe multi-edit columns', next);
    return { sentColumns: next['x-milthm'].columns.slice() };
  })()`));
  await waitFor(`(() => {
    const filter = ${FIND_FILTER};
    const alpha = [...(filter?.options ?? [])].find(option => option.value === 'alphaEvents');
    return alpha && alpha.textContent.includes('轨道整体不透明度') ? true : null;
  })()`, 10000, 'alpha label follows remap');
  const remapped = await evaluate(READ_OPTIONS);
  step('dropdown-remapped-columns', remapped);

  // ---- v0.7.3: timeline header labels (single-line) ----
  await sleep(600);
  const singleHeader = await headerLabels();
  step('header-single-line', { labels: singleHeader, expected: HEADER_LABELS });

  // ---- v0.7.3: enter multi-line events mode and check the repainted header ----
  step('enter-multiline', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const session = editor.session;
    session.setMultiLineEnabled(true, 'events');
    session.multiLineIndices = [0, 1, 2];
    session.normalizeMultiLine();
    session.notify();
    editor.invalidate?.();
    return { active: session.multiLineActive, mode: session.multiLineMode, lines: session.targetLineIndices.slice() };
  })()`));
  await waitFor(`(() => { const session = window.rpenMods.editor.session; return session.multiLineActive && session.multiLineMode === 'events' && session.targetLineIndices.length === 3; })()`, 5000, 'multi-line mode');
  await sleep(900);
  const multiHeader = await headerLabels();
  const panels = await evaluate(`(() => {
    const timeline = window.rpenMods.editor.timeline;
    return { count: timeline.panelCount('events'), width: timeline.eventsCanvas?.clientWidth ?? 0 };
  })()`);
  step('header-multi-line', { labels: multiHeader, expected: HEADER_LABELS, panels });

  // ---- v0.7.3: "编辑事件列" checkbox group ----
  await evaluate(`(() => { window.rpenMods.editor.multiEdit.open('events'); return true; })()`);
  await waitFor(`(() => { const list = document.querySelector('#multi-editor [data-milthm-edit-columns] .milthm-edit-columns-list'); return Boolean(list && [...list.querySelectorAll('input')].length); })()`, 10000, 'edit-columns checkbox group');
  const checkboxes = await evaluate(READ_CHECKBOXES);
  step('edit-columns-list', checkboxes);
  step('check-columns', await evaluate(`(() => {
    const list = document.querySelector('#multi-editor [data-milthm-edit-columns] .milthm-edit-columns-list');
    const inputs = [...list.querySelectorAll('input')];
    const wanted = new Set(['moveXEvents', 'alphaEvents']);
    for (const input of inputs) input.checked = wanted.has(input.value);
    list.dispatchEvent(new Event('change', { bubbles: true }));
    const session = window.rpenMods.editor.session;
    const chart = window.rpenMods.editor.chart;
    const expected = {};
    for (const lineIndex of session.targetLineIndices) {
      const line = chart.judgeLineList?.[lineIndex];
      expected[lineIndex] = (line?.eventLayers?.[0]?.moveXEvents ?? []).length + (line?.eventLayers?.[0]?.alphaEvents ?? []).length;
    }
    const actual = {};
    for (const lineIndex of session.targetLineIndices) actual[lineIndex] = session.multiEventSelection.get(lineIndex)?.size ?? 0;
    return { expected, actual, filterValue: ${FIND_FILTER}?.value ?? null, currentLineSelection: session.eventSelection.size };
  })()`));

  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    defaultLabels: labelsOf(initial?.options ?? []),
    defaultMatches: JSON.stringify(labelsOf(initial?.options ?? [])) === JSON.stringify(EXPECTED),
    paintHiddenInitially: !hasPaint(initial?.options ?? []),
    remappedLabelOk: (remapped?.options ?? []).find(option => option.value === 'alphaEvents')?.label === REMAPPED_LABELS[3],
    paintHiddenAfterRemap: !hasPaint(remapped?.options ?? []),
    singleHeaderLabels: singleHeader,
    singleHeaderOk: JSON.stringify(singleHeader) === JSON.stringify(HEADER_LABELS),
    multiHeaderLabels: multiHeader,
    multiHeaderOk: JSON.stringify(multiHeader) === JSON.stringify(HEADER_LABELS),
    checkboxLabels: (checkboxes ?? []).map(item => item.label),
    checkboxLabelsOk: JSON.stringify((checkboxes ?? []).map(item => item.label)) === JSON.stringify(REMAPPED_LABELS),
    checkboxSelection: report.steps.find(entry => entry.name === 'check-columns')?.data ?? null,
    exceptions: exceptions.length,
  };
  const selection = result.checkboxSelection;
  result.checkboxSelectionOk = Boolean(selection) && Object.keys(selection.expected ?? {}).every(lineIndex => selection.expected[lineIndex] > 0 && selection.expected[lineIndex] === selection.actual[lineIndex]);
  result.ok = Boolean(result.version) && result.defaultMatches && result.paintHiddenInitially && result.remappedLabelOk
    && result.paintHiddenAfterRemap && result.singleHeaderOk && result.multiHeaderOk && result.checkboxLabelsOk
    && result.checkboxSelectionOk && result.exceptions === 0;

  // show the multi-edit panel on the right for the screenshot
  await evaluate(`(() => { try { window.rpenMods.editor.activatePane('multi'); } catch (error) { /* ignore */ } return true; })()`);
  await sleep(700);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'multi-edit-panel.png'), Buffer.from(screenshot.data, 'base64'));
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
