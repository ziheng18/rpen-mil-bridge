import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\main.mjs'
s = io.open(path, encoding='utf-8').read()

# 1) settings keys
old = "      'preview-tracks', 'preview-dim', 'dim-migrate'];"
new = "      'preview-tracks', 'preview-dim', 'dim-migrate', 'new-chart-mode'];"
assert old in s, 'settings keys not found'
s = s.replace(old, new, 1)

# 2) insert new-chart creation support before media binding section
anchor = "  /* ---------------- bind imported media into META ---------------- */"
assert anchor in s, 'media binding anchor not found'
block = r'''  /* ---------------- new chart: offer a Milthm track chart ---------------- */
  const NEW_CHART_STYLE = `
.milthm-dialog-backdrop{position:fixed;inset:0;z-index:2147483010;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.milthm-dialog{width:min(420px,calc(100vw - 40px));background:#191c25;color:#e8ecf5;border:1px solid rgba(255,255,255,.18);
  border-radius:12px;padding:16px 18px;font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif;box-shadow:0 16px 48px rgba(0,0,0,.5)}
.milthm-dialog h3{margin:0 0 8px;color:#9ed0ff;font-size:15px}
.milthm-dialog .m-row{display:flex;gap:8px;margin:8px 0}
.milthm-dialog button{cursor:pointer;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:rgba(255,255,255,.08);
  color:#e8ecf5;padding:6px 10px;font:inherit;white-space:nowrap;flex:1}
.milthm-dialog button:hover{background:rgba(120,180,255,.22)}
.milthm-dialog .milthm-hint{color:#a9b4c7;font-size:11px;margin-top:8px;white-space:pre-wrap}
`;
  api.style(NEW_CHART_STYLE);
  const buildMilthmChart = () => {
    const source = {
      fmt: 2,
      meta: { background_dim: 0.6, name: '未命名 Milthm 谱面', background_artist: '', music_artist: '', charter: '', difficulty_name: '', difficulty: 0, offset: 0 },
      bpms: [{ time: [0, 0, 1], bpm: 120 }],
      lines: [{ index: 0, notes: [], animations: [] }],
      storyboards: [],
    };
    const { chart } = importMilthmChart(source, settings());
    return chart;
  };
  const createMilthmChart = () => {
    try {
      editor.replace(buildMilthmChart(), 'milthm-chart.json');
      api.notify('已新建 Milthm 轨道谱面：可直接用右下角面板/时间轴下拉编辑 Milthm 事件并导出', 'success');
    } catch (error) {
      api.notify('新建 Milthm 谱面失败：' + (error?.message ?? error), 'error');
      api.log(error);
    }
  };
  let bypassNewChart = false;
  const openNewChartDialog = () => {
    document.querySelector('#milthm-new-chart-dialog')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'milthm-new-chart-dialog';
    overlay.className = 'milthm-dialog-backdrop';
    overlay.dataset.modInteractive = 'true';
    const dialog = document.createElement('div');
    dialog.className = 'milthm-dialog';
    dialog.innerHTML = '<h3>新建谱面</h3><div>选择要创建的谱面类型：</div>';
    const actions = document.createElement('div');
    actions.className = 'm-row';
    const rpeButton = document.createElement('button');
    rpeButton.textContent = '普通 RPE 谱面';
    rpeButton.addEventListener('click', () => {
      overlay.remove();
      bypassNewChart = true;
      try { document.querySelector('#new')?.click(); }
      finally { setTimeout(() => { bypassNewChart = false; }, 0); }
    });
    const milthmButton = document.createElement('button');
    milthmButton.textContent = 'Milthm 轨道谱面（fmt=2）';
    milthmButton.addEventListener('click', () => { overlay.remove(); createMilthmChart(); });
    const cancelButton = document.createElement('button');
    cancelButton.textContent = '取消';
    cancelButton.addEventListener('click', () => overlay.remove());
    actions.append(rpeButton, milthmButton, cancelButton);
    const hint = document.createElement('div');
    hint.className = 'milthm-hint';
    hint.textContent = 'Milthm 轨道谱面：每条判定线 = 一条轨道，音符 X 锁定为 0，可直接导出 Milthm 自制谱（fmt=2）。\n普通 RPE 谱面则保持原版行为。';
    dialog.append(actions, hint);
    overlay.append(dialog);
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    api.mount(overlay);
  };
  const interceptNewChart = event => {
    if (bypassNewChart) return;
    const target = event.target?.closest?.('#new, #home-new');
    if (!target) return;
    const mode = settings()['new-chart-mode'] ?? 'ask';
    if (mode === 'rpe') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (mode === 'milthm') { createMilthmChart(); return; }
    openNewChartDialog();
  };
  document.addEventListener('click', interceptNewChart, true);
  api.dispose(() => document.removeEventListener('click', interceptNewChart, true));

''' + anchor
s = s.replace(anchor, block, 1)

# 3) register new-chart command next to export commands
old2 = "  api.commands.register({ id: 'export-json', title: '导出 Milthm 自制谱 chart.json', run: exportJson });"
new2 = "  api.commands.register({ id: 'new-milthm-chart', title: '新建 Milthm 轨道谱面', run: createMilthmChart });\n" + old2
assert old2 in s, 'export command registration not found'
s = s.replace(old2, new2, 1)

io.open(path, 'w', encoding='utf-8').write(s)
print('new-chart support inserted')
