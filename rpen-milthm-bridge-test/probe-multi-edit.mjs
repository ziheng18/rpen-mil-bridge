// Live probe: 多线编辑 adaptations for Milthm charts (v0.7.2 → v0.7.9).
// - the batch-edit event-type dropdown follows the current mode:
//     single-line: only the normal-layer native kinds; multi-line: every semantic kind
//     (values are the semantic pseudo-column keys);
// - the 「编辑事件列」 checkbox group lists all kinds editable in RPEN's normal (non-special)
//   event columns (X/Y/旋转/流速倍率/轨道大小 + 4 transparency variants); checked kinds are shown
//   as the left multi-line timeline columns (semantic pseudo columns) and are editable there;
// - the timeline header strip shows the semantic column names;
// - RPEN's special event layer (timeline 特殊) stays native.
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
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 2400)); };
const FIND_FILTER = `[...(document.querySelector('#multi-editor')?.querySelectorAll('select') ?? [])].find(select => select.dataset.milthmEventFilter === '1' || [...select.options].some(option => option.value === 'paintEvents'))`;
const READ_OPTIONS = `(() => {
  const filter = ${FIND_FILTER};
  if (!filter) return null;
  return { value: filter.value, title: filter.title, options: [...filter.options].map(option => ({ value: option.value, label: option.textContent })) };
})()`;
const READ_CHECKBOXES = `(() => {
  const list = document.querySelector('#multi-line-editor [data-milthm-multiline-columns] .milthm-edit-columns-list');
  if (!list) return null;
  return [...list.querySelectorAll('label')].map(label => ({ value: label.querySelector('input')?.value, label: label.textContent, checked: Boolean(label.querySelector('input')?.checked) }));
})()`;
const PSEUDO = kind => `milthmCol_${kind}`;
const BASE_LABELS = ['X 坐标', 'Y 坐标', '旋转', '线体不透明度（LineBodyTransparency 8）', '流速倍率'];
const REMAPPED_LABELS = ['X 坐标', 'Y 坐标', '旋转', '轨道整体不透明度（线头+线身，Transparency 2）', '流速倍率'];
const SINGLE_HEADER_LABELS = ['X 坐标', 'Y 坐标', '旋转', '轨道整体不透明度', '流速倍率'];
const DEFAULT_HEADER_LABELS = ['X 坐标', 'Y 坐标', '旋转', '流速倍率', '轨道整体不透明度'];
const NORMAL_LAYER_KINDS = ['x', 'y', 'rotate', 'flowSpeed', 'size', 'lineAlpha', 'bodyAlpha', 'headAlpha', 'wholeAlpha'];
const CHECKBOX_LABELS = ['X 坐标', 'Y 坐标', '旋转', '流速倍率', '轨道大小', '轨道整体不透明度', '线体不透明度', '线头不透明度', '音符整体不透明度'];
const DEFAULT_COLUMN_KINDS = ['x', 'y', 'rotate', 'flowSpeed', 'lineAlpha'];
const CHECKED_KINDS = ['x', 'rotate', 'flowSpeed', 'size', 'lineAlpha'];
const CHECKED_COLUMNS = ['x', 'rotate', 'flowSpeed', 'size', 'lineAlpha'].map(PSEUDO);
const CHECKED_LABELS = ['X 坐标', '旋转', '流速倍率', '轨道大小', '轨道整体不透明度'];
const SINGLE_LINE_EXPECTED = ['全部', ...BASE_LABELS];
const MULTI_LINE_EXPECTED = ['全部', ...NORMAL_LAYER_KINDS.map(kind => CHECKBOX_LABELS[NORMAL_LAYER_KINDS.indexOf(kind)])];
const hasPaint = options => options.some(option => option.value === 'paintEvents');
const labelsOf = options => options.map(option => option.label);
const keysOf = options => options.map(option => option.value);
const readTimeline = () => evaluate(`(() => {
  const timeline = window.rpenMods.editor.timeline;
  return { eventTypes: [...(timeline?.eventTypes ?? [])], header: timeline?.__milthmHeaderLabels ?? null };
})()`);

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

  // ---- single-line mode: multi-edit event-type dropdown lists the normal-layer native kinds ----
  step('open-panel', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    editor.multiEdit.open('events');
    return { kind: editor.multiEdit.kind, columns: editor.chart['x-milthm'].columns.slice() };
  })()`));
  await waitFor(`(() => Boolean(${FIND_FILTER}))()`, 10000, 'panel dropdown');
  const initial = await evaluate(READ_OPTIONS);
  step('dropdown-single-line', initial);

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

  // ---- header labels (single line) ----
  await sleep(600);
  const single = await readTimeline();
  step('header-single-line', single);

  // ---- enter multi-line events mode ----
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
  await sleep(1200);
  const defaultMulti = await readTimeline();
  step('header-multi-line-default', defaultMulti);
  await waitFor(`(() => {
    const filter = ${FIND_FILTER};
    return filter && [...filter.options].some(option => option.value === '${PSEUDO('size')}') ? true : null;
  })()`, 10000, 'multi-line dropdown');
  const multiOptions = await evaluate(READ_OPTIONS);
  step('dropdown-multi-line', multiOptions);

  // ---- 多线编辑 pane: checkbox group lists all normal-layer kinds ----
  await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    editor.activatePane('multi-line');
    editor.session.notify();
    editor.invalidate?.();
    return true;
  })()`);
  await waitFor(`(() => Boolean(${READ_CHECKBOXES}))()`, 10000, 'multi-line pane checkbox group');
  const checkboxes = await evaluate(READ_CHECKBOXES);
  step('edit-columns-list', checkboxes);

  // select a subset incl. size and the alpha variant: x/rotate/flowSpeed/size/lineAlpha (drop y)
  step('check-columns', await evaluate(`(() => {
    const list = document.querySelector('#multi-line-editor [data-milthm-multiline-columns] .milthm-edit-columns-list');
    const wanted = new Set(${JSON.stringify(CHECKED_COLUMNS)});
    for (const input of list.querySelectorAll('input')) input.checked = wanted.has(input.value);
    list.dispatchEvent(new Event('change', { bubbles: true }));
    return { checked: [...list.querySelectorAll('input:checked')].map(input => input.value) };
  })()`));
  await waitFor(`(() => { const types = window.rpenMods.editor.timeline?.eventTypes ?? []; return types.length === 5 && types.includes('${PSEUDO('size')}') ? true : null; })()`, 8000, 'selected semantic columns become timeline columns');
  await sleep(800);
  const selectedColumns = await readTimeline();
  step('timeline-selected-columns', selectedColumns);

  // hidden kinds are locked: a manually selected Y pseudo event is dropped on the next frame
  step('restriction-blocks-hidden', await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const session = editor.session;
    session.multiEventSelection.set(0, new Set(['${PSEUDO('y')}:0']));
    editor.invalidate?.();
    await new Promise(resolve => setTimeout(resolve, 900));
    return { yRemoved: !session.multiEventSelection.get(0)?.has('${PSEUDO('y')}:0') };
  })()`));

  // visible semantic columns are selectable (events exist in the injected pseudo arrays)
  step('select-visible', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const session = editor.session;
    const chart = editor.chart;
    session.multiEventSelection.clear();
    for (const lineIndex of session.targetLineIndices) {
      const line = chart.judgeLineList?.[lineIndex];
      const keys = new Set();
      for (const kind of ${JSON.stringify(CHECKED_KINDS)}) {
        const key = 'milthmCol_' + kind;
        (line?.extended?.[key] ?? []).forEach((_event, index) => keys.add(key + ':' + index));
      }
      session.multiEventSelection.set(lineIndex, keys);
    }
    session.eventSelection = new Set(session.multiEventSelection.get(session.lineIndex) ?? []);
    editor.invalidate?.();
    return {
      line0: session.multiEventSelection.get(0)?.size ?? 0,
      line1: session.multiEventSelection.get(1)?.size ?? 0,
      line2: session.multiEventSelection.get(2)?.size ?? 0,
      injected: Object.fromEntries(${JSON.stringify(CHECKED_KINDS)}.map(kind => [kind, (editor.chart.judgeLineList?.[0]?.extended?.['milthmCol_' + kind] ?? []).length])),
    };
  })()`));
  await sleep(800);

  // commit an edit made in a semantic pseudo column: syncMilthmColumns() must adopt it into the
  // semantic lists and strip the pseudo keys from the committed chart
  step('edit-pseudo-commit', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const chart = structuredClone(editor.chart);
    const line = chart.judgeLineList[0];
    const events = line.extended?.['milthmCol_x'];
    if (!events?.length) return { error: 'no pseudo x events' };
    events[0] = { ...events[0], start: 123, end: 123 };
    editor.commit('probe pseudo column edit', chart);
    const after = editor.chart.judgeLineList[0];
    const semantics = after?.['x-milthm']?.events;
    return {
      xStart: semantics?.x?.[0]?.start ?? null,
      pseudoInExtended: Object.keys(after?.extended ?? {}).filter(key => key.startsWith('milthmCol_')),
      pseudoInLayer: Object.keys(after?.eventLayers?.[0] ?? {}).filter(key => key.startsWith('milthmCol_')),
    };
  })()`));

  // RPEN's special event layer must stay native
  step('special-layer-native', await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    editor.timeline.extended = true;
    editor.invalidate?.();
    await new Promise(resolve => setTimeout(resolve, 900));
    const nativeTypes = [...(editor.timeline.eventTypes ?? [])];
    editor.timeline.extended = false;
    editor.invalidate?.();
    await new Promise(resolve => setTimeout(resolve, 900));
    return { extendedTypes: nativeTypes, restoredTypes: [...(editor.timeline.eventTypes ?? [])] };
  })()`));

  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    singleLineOptions: labelsOf(initial?.options ?? []),
    singleLineOk: JSON.stringify(keysOf(initial?.options ?? [])) === JSON.stringify(['all', 'moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents'])
      && JSON.stringify(labelsOf(initial?.options ?? [])) === JSON.stringify(SINGLE_LINE_EXPECTED),
    paintHiddenInitially: !hasPaint(initial?.options ?? []),
    remappedLabelOk: (remapped?.options ?? []).find(option => option.value === 'alphaEvents')?.label === REMAPPED_LABELS[3],
    multiLineOptions: keysOf(multiOptions?.options ?? []),
    multiLineLabels: labelsOf(multiOptions?.options ?? []),
    multiLineOk: JSON.stringify(keysOf(multiOptions?.options ?? [])) === JSON.stringify(['all', ...NORMAL_LAYER_KINDS.map(PSEUDO)])
      && JSON.stringify(labelsOf(multiOptions?.options ?? [])) === JSON.stringify(MULTI_LINE_EXPECTED),
    singleHeaderOk: JSON.stringify(single.header) === JSON.stringify(SINGLE_HEADER_LABELS),
    checkboxLabels: (checkboxes ?? []).map(item => item.label),
    checkboxLabelsOk: JSON.stringify((checkboxes ?? []).map(item => item.label)) === JSON.stringify(CHECKBOX_LABELS),
    defaultChecked: (checkboxes ?? []).filter(item => item.checked).map(item => item.value),
    defaultCheckedOk: JSON.stringify((checkboxes ?? []).filter(item => item.checked).map(item => item.value)) === JSON.stringify(DEFAULT_COLUMN_KINDS.map(PSEUDO)),
    defaultColumnsOk: JSON.stringify(defaultMulti.eventTypes) === JSON.stringify(DEFAULT_COLUMN_KINDS.map(PSEUDO)),
    defaultHeaderOk: JSON.stringify(defaultMulti.header) === JSON.stringify(DEFAULT_HEADER_LABELS),
    selectedColumns: selectedColumns.eventTypes,
    selectedHeader: selectedColumns.header,
    selectedColumnsOk: JSON.stringify(selectedColumns.eventTypes) === JSON.stringify(CHECKED_COLUMNS),
    selectedHeaderOk: JSON.stringify(selectedColumns.header) === JSON.stringify(CHECKED_LABELS),
    hiddenLocked: Boolean(report.steps.find(entry => entry.name === 'restriction-blocks-hidden')?.data?.yRemoved),
    pseudoCommit: report.steps.find(entry => entry.name === 'edit-pseudo-commit')?.data ?? null,
    visibleSelection: report.steps.find(entry => entry.name === 'select-visible')?.data ?? null,
    specialLayer: report.steps.find(entry => entry.name === 'special-layer-native')?.data ?? null,
    exceptions: exceptions.length,
  };
  const visible = result.visibleSelection;
  result.visibleSelectionOk = Boolean(visible) && [visible.line0, visible.line1, visible.line2].every(count => count > 0);
  result.specialLayerOk = JSON.stringify(result.specialLayer?.extendedTypes ?? []) === JSON.stringify(['scaleXEvents', 'scaleYEvents', 'colorEvents', 'paintEvents', 'textEvents'])
    && JSON.stringify(result.specialLayer?.restoredTypes ?? []) === JSON.stringify(CHECKED_COLUMNS);
  result.ok = Boolean(result.version) && result.singleLineOk && result.paintHiddenInitially && result.remappedLabelOk
    && result.multiLineOk && result.singleHeaderOk && result.checkboxLabelsOk && result.defaultCheckedOk
    && result.defaultColumnsOk && result.defaultHeaderOk && result.selectedColumnsOk && result.selectedHeaderOk
    && result.hiddenLocked && result.visibleSelectionOk && result.specialLayerOk
    && Number(result.pseudoCommit?.xStart) === 123
    && (result.pseudoCommit?.pseudoInExtended ?? []).length === 0
    && (result.pseudoCommit?.pseudoInLayer ?? []).length === 0
    && result.exceptions === 0;

  await evaluate(`(() => { try { window.rpenMods.editor.activatePane('multi-line'); } catch (error) { /* ignore */ } return true; })()`);
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
