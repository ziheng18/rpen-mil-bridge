// Offline regression test for export flattening (flatten.mjs):
// - extra RPEN event layers are numerically added (RPEN preview sums them) -> merged exactly;
// - parent lines (father / rotateWithFather) are baked into absolute X/Y/rotation keyframes.
// The sampler is injected, so this runs without a browser and without RPEN internals.
import { flattenChartForMilthm } from '../rpen-milthm-bridge/flatten.mjs';

const BPM = 180;
const SPEED_SCALE = 1.1671875;
const beatsOf = time => Array.isArray(time) ? Number(time[0]) + Number(time[1]) / Number(time[2]) : Number(time);
const toTime = beat => [0, beat, 1];
const secondsOf = time => beatsOf(time) * 60 / BPM;
// Linear (easingType 1) sampler matching RPEN's EventTrack contract: right-continuous, last
// event whose start <= t wins, empty track returns `fallback`, zero-duration events are exact.
const sampler = (events, fallback = 0) => {
  const list = (events ?? []).map(event => ({
    start: secondsOf(event.startTime), end: secondsOf(event.endTime),
    from: Number(event.start), to: Number(event.end),
  })).sort((left, right) => left.start - right.start);
  return seconds => {
    if (!list.length) return fallback;
    let index = -1;
    for (let position = 0; position < list.length; position++) { if (list[position].start <= seconds) index = position; else break; }
    const entry = list[Math.max(0, index)];
    if (entry.end <= entry.start) return entry.from;
    const progress = Math.max(0, Math.min(1, (seconds - entry.start) / (entry.end - entry.start)));
    return entry.from + (entry.to - entry.from) * progress;
  };
};
const os = { beatOf: beatsOf, toTime, secondsOf, sampler };

const event = (startBeat, endBeat, start, end = start) => ({
  startTime: toTime(startBeat), endTime: toTime(endBeat),
  start, end, easingType: 1, easingLeft: 0, easingRight: 1,
  bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0,
});
const line = (extra = {}) => ({
  father: -1, rotateWithFather: true, notes: [],
  eventLayers: [{ moveXEvents: [], moveYEvents: [], rotateEvents: [], alphaEvents: [], speedEvents: [] }],
  extended: {}, ...extra,
});
const chart = lines => ({ judgeLineList: lines, META: { RPEVersion: 163 } });
// Sample a flattened/flat track exactly like the game would.
const valueAt = (events, beat) => sampler(events, 0)(secondsOf(toTime(beat)));

const failures = [];
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!condition) failures.push(name);
};
const near = (actual, expected, tolerance = 1e-6) => Math.abs(actual - expected) <= tolerance;

/* 1) extra event layers are added ------------------------------------------------------- */
{
  const merged = line();
  merged.eventLayers = [{ moveXEvents: [event(0, 4, 0, 100)] }, { moveXEvents: [event(0, 4, 0, 50)] }];
  const result = flattenChartForMilthm(chart([merged]), os);
  const x = result.chart.judgeLineList[0].eventLayers[0].moveXEvents;
  check('事件层合并：X 两层相加（2 拍 = 75、4 拍 = 150）',
    near(valueAt(x, 2), 75, 1e-6) && near(valueAt(x, 4), 150, 1e-6),
    `2 拍 ${valueAt(x, 2).toFixed(3)} / 4 拍 ${valueAt(x, 4).toFixed(3)}`);
  check('事件层合并：多余的层被移除（导出视图只剩单层）',
    result.chart.judgeLineList[0].eventLayers.length === 1);
  check('事件层合并：给出警告', result.warnings.some(text => text.includes('事件层已按数值叠加合并')), result.warnings.join(' | '));
  check('事件层合并：flattened 统计', result.flattened.mergedLines === 1 && result.flattened.mergedTypes === 1);
}

/* 2) merging must not smear a jump backwards ------------------------------------------- */
{
  const merged = line();
  merged.eventLayers = [
    { moveYEvents: [event(0, 4, 10, 10)] },
    { moveYEvents: [event(0, 4, 100, 100), event(4, 4, 50, 50)] },   // zero-length jump at beat 4
  ];
  const result = flattenChartForMilthm(chart([merged]), os);
  const y = result.chart.judgeLineList[0].eventLayers[0].moveYEvents;
  check('事件层合并：跳变前保持常量（3.999 拍 = 110）', near(valueAt(y, 3.999), 110, 1e-6), valueAt(y, 3.999).toFixed(4));
  // Same-track events replace each other (last start wins), so after beat 4 layer1 is 50, not 150.
  check('事件层合并：跳变后立即生效（4.001 拍 = 10 + 50 = 60）', near(valueAt(y, 4.001), 60, 1e-6), valueAt(y, 4.001).toFixed(4));
  check('事件层合并：4 拍处仍为跳变前的值', near(valueAt(y, 4 - 1e-9), 110, 1e-3));
}

/* 3) speed layers are summed (equivalent to summing the integrals) ---------------------- */
{
  const merged = line();
  merged.eventLayers = [
    { speedEvents: [event(0, 2, 1, 1)] },
    { speedEvents: [event(0, 2, 2, 2)] },
  ];
  const result = flattenChartForMilthm(chart([merged]), os);
  const speed = result.chart.judgeLineList[0].eventLayers[0].speedEvents;
  check('事件层合并：speed 相加（1 + 2 = 3）', near(valueAt(speed, 1), 3, 1e-6), valueAt(speed, 1).toFixed(4));
}

/* 4) parent line with a static transform ----------------------------------------------- */
{
  const parent = line();
  parent.eventLayers[0].moveXEvents = [event(0, 4, 0, 0)];
  const child = line({ father: 0 });
  child.eventLayers[0].moveXEvents = [event(0, 4, 100, 100)];
  const result = flattenChartForMilthm(chart([parent, child]), os);
  const baked = result.chart.judgeLineList[1];
  check('父线烘焙：父级无旋转时位置直接相加（x = 100）', near(valueAt(baked.eventLayers[0].moveXEvents, 2), 100, 1e-6),
    valueAt(baked.eventLayers[0].moveXEvents, 2).toFixed(3));
  check('父线烘焙：导出后 father 被清除', baked.father === -1);
  check('父线烘焙：给出警告', result.warnings.some(text => text.includes('父子线已烘焙导出')));
}

/* 5) parent rotation is applied with RPEN's -rotation convention ------------------------ */
{
  const parent = line();
  parent.eventLayers[0].rotateEvents = [event(0, 4, 90, 90)];
  const child = line({ father: 0 });
  child.eventLayers[0].moveXEvents = [event(0, 4, 100, 100)];
  child.eventLayers[0].moveYEvents = [event(0, 4, 0, 0)];
  const result = flattenChartForMilthm(chart([parent, child]), os);
  const baked = result.chart.judgeLineList[1];
  const x = valueAt(baked.eventLayers[0].moveXEvents, 2);
  const y = valueAt(baked.eventLayers[0].moveYEvents, 2);
  check('父线烘焙：父级旋转 90° 时局部 X 变成世界 -Y（x=0, y=-100）', near(x, 0, 1e-2) && near(y, -100, 1e-2),
    `x=${x.toFixed(3)} y=${y.toFixed(3)}`);
}

/* 6) rotateWithFather = false ---------------------------------------------------------- */
{
  const parent = line();
  parent.eventLayers[0].rotateEvents = [event(0, 4, 90, 90)];
  const child = line({ father: 0, rotateWithFather: false });
  child.eventLayers[0].rotateEvents = [event(0, 4, 10, 10)];
  const result = flattenChartForMilthm(chart([parent, child]), os);
  check('父线烘焙：rotateWithFather=false 时不继承旋转（仍为 10°）',
    near(valueAt(result.chart.judgeLineList[1].eventLayers[0].rotateEvents, 2), 10, 1e-6));
}

/* 7) nested chain ---------------------------------------------------------------------- */
{
  const grand = line();
  grand.eventLayers[0].moveXEvents = [event(0, 4, 1000, 1000)];
  const parent = line({ father: 0 });
  parent.eventLayers[0].moveXEvents = [event(0, 4, 10, 10)];
  const child = line({ father: 1 });
  child.eventLayers[0].moveXEvents = [event(0, 4, 1, 1)];
  const result = flattenChartForMilthm(chart([grand, parent, child]), os);
  const lines = result.chart.judgeLineList;
  check('父线烘焙：嵌套链（1000 + 10 + 1 = 1011）',
    near(valueAt(lines[2].eventLayers[0].moveXEvents, 2), 1011, 1e-3),
    valueAt(lines[2].eventLayers[0].moveXEvents, 2).toFixed(3));
  check('父线烘焙：中间层也被烘焙（1010）', near(valueAt(lines[1].eventLayers[0].moveXEvents, 2), 1010, 1e-3));
}

/* 8) moving parent rotation needs adaptive keys, and stays within tolerance ------------ */
{
  const parent = line();
  parent.eventLayers[0].rotateEvents = [event(0, 8, 0, 180)];       // 22.5°/beat
  const child = line({ father: 0 });
  child.eventLayers[0].moveXEvents = [event(0, 8, 500, 500)];
  const result = flattenChartForMilthm(chart([parent, child]), os);
  const baked = result.chart.judgeLineList[1].eventLayers[0].moveXEvents;
  // Exact curve: x = 500*cos(-rot), rot = 22.5*beat  =>  x(2) = 500*cos(45°)
  const exact = 500 * Math.cos(-2 * 22.5 * Math.PI / 180);
  check('父线烘焙：旋转运动时位置曲线自适应细分（2 拍误差 < 0.5）', Math.abs(valueAt(baked, 2) - exact) < 0.5,
    `近似 ${valueAt(baked, 2).toFixed(2)} vs 精确 ${exact.toFixed(2)}，关键帧 ${baked.length}`);
  check('父线烘焙：细分后关键帧数量合理（< 200）', baked.length < 200, String(baked.length));
}

/* 9) no-op when no feature is used ------------------------------------------------------ */
{
  const plain = line();
  plain.eventLayers[0].moveXEvents = [event(0, 4, 0, 100)];
  const before = plain.eventLayers[0].moveXEvents;
  const result = flattenChartForMilthm(chart([plain]), os);
  check('未使用多层/父线：事件数组保持原样（0 diff 前提）',
    result.chart.judgeLineList[0].eventLayers[0].moveXEvents === before && result.warnings.length === 0,
    result.warnings.join(' | '));
}

/* 10) father cycle is reported, not fatal ---------------------------------------------- */
{
  const a = line({ father: 1 });
  const b = line({ father: 0 });
  let threw = false;
  let result;
  try { result = flattenChartForMilthm(chart([a, b]), os); } catch { threw = true; }
  check('父线循环：不抛异常并给出警告', !threw && result.warnings.some(text => text.includes('循环或无效父级')),
    threw ? 'threw' : result.warnings.join(' | '));
}

console.log(`\n${failures.length ? 'FAILED: ' + failures.join(' | ') : '=== FLATTEN TESTS PASSED ==='}`);
if (failures.length) process.exitCode = 1;
