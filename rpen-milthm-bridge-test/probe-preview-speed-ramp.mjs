// Live probe: after importing 《エゴイスト》, the preview speed of a line must be
// Speed(12) × line FlowSpeed(5) *without* smearing event jumps into ramps.
//
// Regression for v0.7.12: the composed preview speed track used to sample segment ends with
// EventTrack's right-continuous value, so the Speed 1→80 jump at beat 635.5 turned beats
// 318→635.5 into a 9.34 → 747 linear ramp on Track 4 (and the same kind of ramp around every
// FlowSpeed jump on other lines). The renderer keeps the speed flat until the jump.
//
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'preview-speed-ramp');
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
const waitFor = async (expression, timeout = 120000, label = 'wait') => { const s = Date.now(); while (Date.now() - s < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1600)); };

// 180 BPM single-bpm chart: 1 beat = 1/3 s.
const READ = `(() => {
  const editor = window.rpenMods.editor;
  const preview = editor.preview;
  preview.draw(editor.chart, editor.tempo, 200, 4);
  const runtimes = preview.scene.lines;
  const seconds = beat => beat / 3;
  const floorAt = (index, beat) => runtimes[index].floor(seconds(beat));
  const line = editor.chart.judgeLineList[4];
  const notes = (runtimes[4].notes ?? []).map(entry => ({ start: entry.start, floor: entry.floor }));
  return {
    lineCount: runtimes.length,
    line4: {
      floor: [100, 300, 400, 500, 600, 634, 635.5, 636, 650, 660].map(beat => ({ beat, floor: floorAt(4, beat) })),
      notes: notes.length,
      lastNote: notes.at(-1) ?? null,
      noteAt634: notes.find(item => Math.abs(item.start - 634 / 3) < 1e-6)?.floor ?? null,
    },
    line0: {
      floor: [160, 200, 300, 330, 335, 336.1, 338, 340, 350, 400].map(beat => ({ beat, floor: floorAt(0, beat) })),
    },
    line7: {
      floor: [100, 300, 600, 634, 635.5].map(beat => ({ beat, floor: floorAt(7, beat) })),
    },
  };
})()`;

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
  await evaluate(`(() => { const editor = window.rpenMods.editor; editor.pause?.(); editor.selectLine(4); editor.setPreview(true); return true; })()`);
  await waitFor(`(() => { const preview = window.rpenMods.editor.preview; return preview?.visible && preview.canvas?.clientWidth > 100 && preview.scene?.lines?.length === 16; })()`, 30000, 'preview');
  await sleep(800);
  const data = await evaluate(READ);
  step('floors', data);

  // Frames near the end of the chart: with the bug the notes were pushed off-screen by the ramp.
  for (const [name, seconds] of [['near-end-200s', 200], ['near-end-211.5s', 211.5]]) {
    await evaluate(`(() => { const editor = window.rpenMods.editor; editor.preview.draw(editor.chart, editor.tempo, ${seconds}, 4); return true; })()`);
    await sleep(120);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'));
  }

  const WORLD_PER_FLOOR = 120;          // RPEN SpeedIntegral: distance = integral * 120
  const BASE_SPEED = 1.1671875 * 8;     // Speed(12)=1 × speed-scale × FlowSpeed(5)=8
  const BOOST_SPEED = 80 * 1.1671875 * 8;
  const expectedFloor = beat => BASE_SPEED * WORLD_PER_FLOOR * beat / 3;
  const tolerance = 0.001;
  const near = (actual, expected) => Number.isFinite(actual) && Math.abs(actual - expected) <= Math.abs(expected) * tolerance + 1e-6;
  const line4 = data.line4;
  const flatChecks = [300, 400, 500, 600, 634, 635.5].map(beat => ({
    beat, floor: line4.floor.find(entry => entry.beat === beat)?.floor, expected: expectedFloor(beat),
  }));
  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    speedPrimaryOk: true,
    flatBeforeJumpOk: flatChecks.every(entry => near(entry.floor, entry.expected)),
    flatBeforeJumpDetail: flatChecks.map(entry => `${entry.beat}:${Number(entry.floor).toFixed(0)}/${entry.expected.toFixed(0)}`),
    noRampRatio: (line4.floor.find(entry => entry.beat === 600)?.floor ?? 0) / expectedFloor(600),
    postJumpRatio: (() => {
      const a = line4.floor.find(entry => entry.beat === 650)?.floor ?? 0;
      const b = line4.floor.find(entry => entry.beat === 660)?.floor ?? 0;
      const slope = (b - a) / (10 / 3);            // world units per second
      return slope / (BOOST_SPEED * WORLD_PER_FLOOR);
    })(),
    // notes must stay at a sane distance: floor(634) - floor(600) = 34 beats at base speed
    noteDistanceOk: Number.isFinite(line4.noteAt634) && near(line4.noteAt634 - (line4.floor.find(entry => entry.beat === 600)?.floor ?? 0), expectedFloor(634) - expectedFloor(600)),
    noteDistance: (line4.noteAt634 - (line4.floor.find(entry => entry.beat === 600)?.floor ?? 0)),
    noteDistanceExpected: expectedFloor(634) - expectedFloor(600),
    // line 0: FlowSpeed jumps 8 → 1 at beat 336 (then ramps 1→8 until 340); before the fix the
    // whole 168→336 stretch ramped down towards 1.
    line0FlatOk: [330, 335].every(beat => {
      const floor = data.line0.floor.find(entry => entry.beat === beat)?.floor;
      return near(floor, expectedFloor(beat));
    }),
    line0Detail: [160, 200, 300, 330, 335].map(beat => `${beat}:${Number(data.line0.floor.find(entry => entry.beat === beat)?.floor).toFixed(0)}/${expectedFloor(beat).toFixed(0)}`),
    line7FlatOk: (() => {
      // line 7 starts at FlowSpeed(5)=4 and switches to 8 at beat 32, so its absolute floors sit
      // below the FlowSpeed-8 baseline; check the slope inside the constant-FlowSpeed-8 region.
      const pick = beat => data.line7.floor.find(entry => entry.beat === beat)?.floor;
      const slope = (toBeat, fromBeat) => (pick(toBeat) - pick(fromBeat)) / ((toBeat - fromBeat) / 3);
      return Math.abs(slope(600, 300) - BASE_SPEED * WORLD_PER_FLOOR) < 0.001 * BASE_SPEED * WORLD_PER_FLOOR
        && Math.abs(slope(635.5, 634) - BASE_SPEED * WORLD_PER_FLOOR) < 0.001 * BASE_SPEED * WORLD_PER_FLOOR;
    })(),
    line7Slopes: [['300→600', (data.line7.floor.find(entry => entry.beat === 600)?.floor - data.line7.floor.find(entry => entry.beat === 300)?.floor) / 100], ['634→635.5', (data.line7.floor.find(entry => entry.beat === 635.5)?.floor - data.line7.floor.find(entry => entry.beat === 634)?.floor) / 0.5]],
    exceptions: exceptions.length,
  };
  result.ok = Boolean(result.version) && result.flatBeforeJumpOk && result.noRampRatio > 0.999 && result.noRampRatio < 1.001
    && Math.abs(result.postJumpRatio - 1) < 0.001 && result.noteDistanceOk && result.line0FlatOk && result.line7FlatOk
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
  ws.close();
}
