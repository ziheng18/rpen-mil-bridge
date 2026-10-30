import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\main.mjs'
s = io.open(path, encoding='utf-8').read()

def replace(old, new, count=1):
    global s
    assert old in s, 'missing anchor: ' + old[:80]
    s = s.replace(old, new, count)

# 1) imports
old_import = """import {
  importMilthmChart, exportMilthmChart, normalizeLaneChart,
  milEaseToRpe, rpeEaseToMil, beatOf, MIL_ANIM, MIL_BEARER,
} from './convert.mjs';"""
new_import = old_import + """
import {
  DEFAULT_COLUMNS, COLUMN_LABELS, SLOT_CANDIDATES, semanticEvents, chartColumns,
  ensureChartColumns, syncMilthmColumns, remapColumns, buildMilthmExportChart, sceneSemanticArrays,
} from './columns.mjs';"""
replace(old_import, new_import)

# 2) preview tracks from semantic events
old_tracks = """  const lineTracks = (chart, line) => {
    const cache = cacheFor(chart);
    let tracks = cache.lines.get(line);
    if (tracks) return tracks;
    const channels = line?.['x-milthm']?.channels ?? {};
    tracks = {
      bodyAlpha: milEventTrack(channels.bodyAlpha, cache.tempo, 1),
      headAlpha: milEventTrack(channels.headAlpha, cache.tempo, 1),
      wholeAlpha: milEventTrack(channels.wholeAlpha, cache.tempo, 1),
      flowSpeed: milEventTrack(channels.flowSpeed, cache.tempo, 1),
      noteAlpha: new Map(),
    };
    cache.lines.set(line, tracks);
    return tracks;
  };"""
new_tracks = """  const lineTracks = (chart, line) => {
    const cache = cacheFor(chart);
    let tracks = cache.lines.get(line);
    if (tracks) return tracks;
    const semantics = semanticEvents(line);
    tracks = {
      bodyAlpha: milEventTrack(semantics.bodyAlpha, cache.tempo, 1),
      headAlpha: milEventTrack(semantics.headAlpha, cache.tempo, 1),
      wholeAlpha: milEventTrack(semantics.wholeAlpha, cache.tempo, 1),
      noteAlpha: new Map(),
    };
    cache.lines.set(line, tracks);
    return tracks;
  };"""
replace(old_tracks, new_tracks)

# 3) scene compile: inject semantic arrays before LineRuntimes are built
old_compile = """  api.patch(SceneRuntime.prototype, 'compile', previous => function (chart, tempo) {
    const result = previous.call(this, chart, tempo);
    const milthm = isMilthmChart(chart);
    for (const runtime of this.lines) runtime.__milthmChart = milthm ? chart : null;
    return result;
  });"""
new_compile = """  api.patch(SceneRuntime.prototype, 'compile', previous => function (chart, tempo) {
    if (!isMilthmChart(chart)) {
      const result = previous.call(this, chart, tempo);
      for (const runtime of this.lines) runtime.__milthmChart = null;
      return result;
    }
    // The native arrays mirror the *displayed* columns; the scene must always see the
    // semantic X/Y/rotation/speed/size lists. Swap them in just for the compile call so
    // LineRuntime builds its tracks from the semantic data, then restore the display arrays.
    const restores = [];
    for (const line of (chart.judgeLineList ?? [])) {
      const layer = line?.eventLayers?.[0];
      if (!layer) continue;
      const injected = sceneSemanticArrays(line);
      restores.push({ line, layer, extended: line.extended,
        arrays: { moveXEvents: layer.moveXEvents, moveYEvents: layer.moveYEvents, rotateEvents: layer.rotateEvents, alphaEvents: layer.alphaEvents, speedEvents: layer.speedEvents } });
      layer.moveXEvents = injected.moveXEvents;
      layer.moveYEvents = injected.moveYEvents;
      layer.rotateEvents = injected.rotateEvents;
      layer.alphaEvents = injected.alphaEvents;
      layer.speedEvents = injected.speedEvents;
      line.extended = { ...(line.extended ?? {}), scaleXEvents: injected.scaleXEvents, scaleYEvents: injected.scaleYEvents };
    }
    let result;
    try { result = previous.call(this, chart, tempo); }
    finally {
      for (const restore of restores) {
        Object.assign(restore.layer, restore.arrays);
        restore.line.extended = restore.extended;
      }
    }
    for (const runtime of this.lines) runtime.__milthmChart = chart;
    return result;
  });"""
replace(old_compile, new_compile)

# 4) commit hook: persist column edits into semantics before lane normalization
old_hook = """  api.hook('session:before-commit', change => {
    if (!change || !change.chart) return;
    change.chart = normalizeLaneChart(change.chart, settings());
  });"""
new_hook = """  api.hook('session:before-commit', change => {
    if (!change || !change.chart) return;
    change.chart = normalizeLaneChart(syncMilthmColumns(change.chart), settings());
  });"""
replace(old_hook, new_hook)

# 5) export via semantic chart builder
old_export_json = "    const { chart: milthm, warnings } = exportMilthmChart(chart, settings());"
new_export_json = "    const { chart: milthm, warnings } = exportMilthmChart(buildMilthmExportChart(chart), settings());"
count = s.count(old_export_json)
assert count == 2, f'export call count {count}'
s = s.replace(old_export_json, new_export_json)

# 6) remove the floating panel from the UI
replace("  api.mount(panel);\n", "  // v0.4: the floating panel is removed; event columns are edited in the native timeline header.\n")
replace("""  const insertTimelineSelect = () => {
    const layer = document.querySelector('#layer');
    if (!layer) return;
    if (document.querySelector('#milthm-timeline-select')) return;
    const wrapper = document.createElement('span');
    wrapper.style.marginLeft = '6px';
    const select = document.createElement('select');
    select.id = 'milthm-timeline-select';
    select.className = 'milthm-timeline-select';
    select.title = 'Milthm 独占事件类型（在 Milthm 模式面板中编辑）';
    for (const [value, definition] of Object.entries(CHANNEL_DEFS)) select.append(new Option(`Milthm · ${definition.label}`, value));
    select.value = activeType;
    select.addEventListener('change', () => setActiveType(select.value));
    wrapper.append(select);
    layer.after(wrapper);
    allSelects.push(select);
    syncSelects();
  };""", """  const insertTimelineSelect = () => {}; // replaced by the per-column dropdown overlay""")

# 7) new-column UI, semantics init and export-dialog hook, inserted after the ExNote setup
anchor = "  const renderExCheckbox = setupExCheckbox();\n"
assert anchor in s
block = r'''  const renderExCheckbox = setupExCheckbox();

  /* ---------------- Milthm event columns: dropdowns on the native header ---------------- */
  const COLUMN_STYLE = `
.milthm-column-bar{position:fixed;z-index:2147482999;display:flex;height:23px;background:#303030;box-shadow:0 1px 0 #1b2330}
.milthm-column-select{flex:1;min-width:0;height:23px;box-sizing:border-box;background:#303030;color:#f5f5f5;
  border:0;border-right:1px solid #1b2330;border-radius:0;font:12px/1 system-ui,"Microsoft YaHei",sans-serif;
  padding:0 2px;outline:none;cursor:pointer}
.milthm-column-select:hover{background:#3a3f4a}
.milthm-column-select:focus{background:#3a3f4a;box-shadow:inset 0 0 0 1px #4d7fb8}
`;
  api.style(COLUMN_STYLE);
  const columnSelects = [];
  const columnShown = [];
  let columnOverlay = null;
  let columnPoll = null;
  const updateColumnOverlay = () => {
    if (!columnOverlay) return;
    const chart = editor.chart;
    const timeline = editor.timeline;
    const canvas = timeline?.eventsCanvas;
    const session = editor.session;
    const active = isMilthmChart(chart) && canvas && !timeline.extended && !session?.multiLineActive && !editor.home;
    if (!active) { columnOverlay.style.display = 'none'; return; }
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 80 && rect.height > 22)) { columnOverlay.style.display = 'none'; return; }
    columnOverlay.style.display = 'flex';
    columnOverlay.style.left = `${rect.left}px`;
    columnOverlay.style.top = `${rect.top}px`;
    columnOverlay.style.width = `${rect.width}px`;
    const columns = chartColumns(chart);
    columnSelects.forEach((select, slot) => {
      if (columnShown[slot] !== columns[slot]) {
        columnShown[slot] = columns[slot];
        select.replaceChildren(...SLOT_CANDIDATES[slot].map(key => new Option(COLUMN_LABELS[key], key)));
        select.value = columns[slot];
      }
      select.title = `第 ${slot + 1} 列：${COLUMN_LABELS[columns[slot]]}（点开可换成本列支持的其它 Milthm 事件）`;
    });
  };
  const applyColumnChange = (slot, key) => {
    const chart = editor.chart;
    if (!isMilthmChart(chart)) return;
    const next = remapColumns(chart, slot, key);
    if (!next) { updateColumnOverlay(); return; }
    if (next.error) { api.notify(next.error, 'warning'); updateColumnOverlay(); return; }
    try {
      editor.commit(`Milthm 第 ${slot + 1} 列 → ${COLUMN_LABELS[key]}`, next);
      api.notify(`第 ${slot + 1} 列已切换为「${COLUMN_LABELS[key]}」`, 'success');
    } catch (error) {
      api.notify('切换 Milthm 事件列失败：' + (error?.message ?? error), 'error');
    }
    updateColumnOverlay();
  };
  const installColumnOverlay = () => {
    if (columnOverlay) return;
    columnOverlay = document.createElement('div');
    columnOverlay.className = 'milthm-column-bar';
    columnOverlay.dataset.modInteractive = 'true';
    for (let slot = 0; slot < 5; slot++) {
      const select = document.createElement('select');
      select.className = 'milthm-column-select';
      select.addEventListener('change', () => applyColumnChange(slot, select.value));
      columnSelects.push(select);
      columnOverlay.append(select);
    }
    document.body.append(columnOverlay);
    updateColumnOverlay();
  };
  const resizeColumnOverlay = () => updateColumnOverlay();
  window.addEventListener('resize', resizeColumnOverlay);
  columnPoll = setInterval(updateColumnOverlay, 350);
  api.dispose(() => {
    window.removeEventListener('resize', resizeColumnOverlay);
    if (columnPoll) clearInterval(columnPoll);
    columnOverlay?.remove();
  });

  /* ---------------- semantic columns: initialise once per chart ---------------- */
  const ensuredCharts = new WeakSet();
  const maybeEnsureColumns = async () => {
    const chart = editor.chart;
    if (!isMilthmChart(chart) || ensuredCharts.has(chart)) return;
    ensuredCharts.add(chart);
    try {
      const next = ensureChartColumns(chart);
      if (!next || editor.chart !== chart) return;
      editor.commit('初始化 Milthm 事件列', next);
    } catch (error) {
      api.log('初始化 Milthm 事件列失败', error);
    }
  };

  /* ---------------- native export dialog: add Milthm formats ---------------- */
  const injectMilthmExportOptions = () => {
    const dialog = document.querySelector('dialog[open]');
    if (!dialog || dialog.dataset.milthmExport) return;
    const format = [...dialog.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'next:pez'));
    const apply = dialog.querySelector('#modal-apply');
    if (!format || !apply) return;
    dialog.dataset.milthmExport = '1';
    format.append(new Option('Milthm · chart.json', 'milthm:json'), new Option('Milthm · 谱面包 zip', 'milthm:zip'));
    const original = apply.onclick;
    apply.onclick = event => {
      if (!format.value.startsWith('milthm:')) return original?.call(apply, event);
      const zip = format.value === 'milthm:zip';
      try {
        dialog.close();
        Promise.resolve(zip ? exportZip() : exportJson()).catch(error => api.notify('Milthm 导出失败：' + (error?.message ?? error), 'error'));
      } catch (error) { api.notify('Milthm 导出失败：' + (error?.message ?? error), 'error'); }
    };
  };
  const exportDialogClick = event => {
    if (event.target?.closest?.('#export')) setTimeout(injectMilthmExportOptions, 0);
  };
  document.addEventListener('click', exportDialogClick, true);
  api.dispose(() => document.removeEventListener('click', exportDialogClick, true));
'''
s = s.replace(anchor, block, 1)

# 8) poll and event wiring: keep the overlay / semantics in sync
replace("""    lastChartRef = chart;
    insertTimelineSelect();
    renderPanel();
    renderExCheckbox?.();
  }, 400);""", """    lastChartRef = chart;
    updateColumnOverlay();
    renderExCheckbox?.();
    maybeEnsureColumns().catch(() => {});
  }, 400);""")
replace("""  api.on('editor:chart', () => {
    insertTimelineSelect();
    renderPanel();
    renderExCheckbox?.();
    maybeBindMedia().catch(error => api.log('Milthm 媒体绑定失败', error));
    maybeMigrateDim().catch(error => api.log('背景明暗迁移失败', error));
  });""", """  api.on('editor:chart', () => {
    installColumnOverlay();
    updateColumnOverlay();
    renderExCheckbox?.();
    maybeEnsureColumns().catch(() => {});
    maybeBindMedia().catch(error => api.log('Milthm 媒体绑定失败', error));
    maybeMigrateDim().catch(error => api.log('背景明暗迁移失败', error));
  });""")
replace("""  api.on('editor:state', () => {
    insertTimelineSelect();
    renderPanel();
    renderExCheckbox?.();
  });""", """  api.on('editor:state', () => {
    updateColumnOverlay();
    renderExCheckbox?.();
  });""")
replace("  setTimeout(() => { insertTimelineSelect(); renderPanel(); renderExCheckbox?.(); maybeBindMedia().catch(() => {}); }, 0);",
        "  setTimeout(() => { installColumnOverlay(); updateColumnOverlay(); renderExCheckbox?.(); maybeEnsureColumns().catch(() => {}); maybeBindMedia().catch(() => {}); }, 0);")

# 9) new chart notification text (panel is gone)
replace("api.notify('已新建 Milthm 轨道谱面：可直接用右下角面板/时间轴下拉编辑 Milthm 事件并导出', 'success');",
        "api.notify('已新建 Milthm 轨道谱面：时间轴上方五列的下拉框可直接选择要编辑的 Milthm 事件，导出在「导出」对话框里', 'success');")

# 10) dispose: remove column overlay too (handled by api.dispose above) and the old select
replace("""  return {
    dispose() {
      panel.remove();
      document.querySelector('#milthm-timeline-select')?.parentElement?.remove();
    },
  };""", """  return {
    dispose() {
      panel.remove();
      columnOverlay?.remove();
      document.querySelector('#milthm-timeline-select')?.parentElement?.remove();
    },
  };""")

io.open(path, 'w', encoding='utf-8').write(s)
print('main.mjs v0.4 patch applied')
