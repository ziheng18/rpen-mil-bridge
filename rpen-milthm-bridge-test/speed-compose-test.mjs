// Offline regression test: the preview speed track is the product of Milthm Speed(12) and
// line FlowSpeed(5). RPEN's EventTrack sampling is right-continuous, so a segment that ends on an
// event boundary must take the value from *before* the boundary — otherwise every event jump
// smears into a ramp over the whole preceding interval (v0.7.12 fix).
//
// Shape from 《エゴイスト》Track 4: Speed(12) 1→1 all song + one 1/4-beat 80 at beat 635.5,
// FlowSpeed(5) constant 8. Before the fix the composed track ramped 9.34 → 747 from beat 318 on,
// so the last notes fell ~80× too fast in the preview.
import { composePreviewSpeedEvents } from '../rpen-milthm-bridge/columns.mjs';

const BPM = 180;
const SPEED_SCALE = 1.1671875;                 // 1.66 × 675/960, bridge default
const be = time => Array.isArray(time) ? Number(time[0]) + Number(time[1]) / Number(time[2]) : Number(time);
const toTime = beat => {
  const total = Math.round(beat * 19200);
  const whole = Math.floor(total / 19200);
  const numerator = total - whole * 19200;
  let divisor = 19200, remainder = numerator;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  return [whole, numerator / divisor, divisor === 0 ? 19200 : 19200 / divisor];
};
const secondsOf = time => be(time) * 60 / BPM;
// Linear sampler, same contract as RPEN's EventTrack (right-continuous, last start <= t wins,
// zero-duration events are exact). The converted events are all linear, so this is faithful.
const sampler = events => {
  const list = (events ?? []).map(event => ({
    start: secondsOf(event.startTime), end: secondsOf(event.endTime),
    from: Number(event.start), to: Number(event.end),
  })).sort((left, right) => left.start - right.start);
  return seconds => {
    if (!list.length) return 1;
    let index = -1;
    for (let i = 0; i < list.length; i++) { if (list[i].start <= seconds) index = i; else break; }
    const entry = list[Math.max(0, index)];
    if (entry.end <= entry.start) return entry.from;
    const progress = Math.max(0, Math.min(1, (seconds - entry.start) / (entry.end - entry.start)));
    return entry.from + (entry.to - entry.from) * progress;
  };
};
const compose = (speedEvents, flowEvents) => composePreviewSpeedEvents(speedEvents, flowEvents, {
  beatOf: be, toTime, secondsOf, sampler,
});
const beatOfEvent = event => be(event.startTime);
const valueAtBeat = (composed, beat) => {
  const seconds = beat * 60 / BPM;
  const entry = composed.find(item => {
    const start = endOf(item.startTime), end = endOf(item.endTime);
    return seconds >= start - 1e-9 && seconds <= end + 1e-9;
  }) ?? composed.at(-1);
  const start = endOf(entry.startTime), end = endOf(entry.endTime);
  const progress = end <= start ? 1 : Math.max(0, Math.min(1, (seconds - start) / (end - start)));
  return entry.start + (entry.end - entry.start) * progress;
};
const endOf = time => secondsOf(time);
// trapezoid integral of the composed track between two beats (units: speed × seconds)
const integrate = (composed, fromBeat, toBeat) => {
  const from = fromBeat * 60 / BPM, to = toBeat * 60 / BPM;
  let sum = 0;
  for (const entry of composed) {
    const start = secondsOf(entry.startTime), end = secondsOf(entry.endTime);
    const left = Math.max(start, from), right = Math.min(end, to);
    if (!(right > left)) continue;
    const valueLeft = entry.start + (entry.end - entry.start) * ((left - start) / (end - start || 1));
    const valueRight = entry.start + (entry.end - entry.start) * ((right - start) / (end - start || 1));
    sum += (valueLeft + valueRight) / 2 * (right - left);
  }
  return sum;
};

const failures = [];
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!condition) failures.push(name);
};
const near = (actual, expected, tolerance = 1e-6) => Math.abs(actual - expected) <= tolerance;

const SPEED_EVENTS = [
  { startTime: [0, 0, 4], endTime: [1, 0, 4], start: 1 * SPEED_SCALE, end: 1 * SPEED_SCALE },
  { startTime: [635, 2, 4], endTime: [635, 3, 4], start: 80 * SPEED_SCALE, end: 80 * SPEED_SCALE },
];
const FLOW_EVENTS = [
  { type: 5, startTime: [0, 0, 4], endTime: [1, 0, 4], start: 8, end: 8 },
];
const BASE = 1 * SPEED_SCALE * 8;               // 9.3375
const BOOST = 80 * SPEED_SCALE * 8;             // 747

/* 1) no ramp before the jump -------------------------------------------------------------- */
const t1 = compose(SPEED_EVENTS, FLOW_EVENTS);
const midBeats = [300, 400, 500, 600, 634, 635.4].map(beat => ({ beat, value: valueAtBeat(t1, beat) }));
check('打底段速度恒定（beat 300/400/500/600/634/635.4 = 9.3375）',
  midBeats.every(item => near(item.value, BASE, 1e-6)),
  midBeats.map(item => `${item.beat}:${item.value.toFixed(4)}`).join(' '));
check('跳变前无爬升（关键回归：旧实现 600 拍处已是 ~664）', valueAtBeat(t1, 600) < BASE + 1e-6,
  `600 拍处 ${valueAtBeat(t1, 600).toFixed(4)}，期望 ${BASE.toFixed(4)}`);
check('跳变后恒为 Speed80×Flow8', near(valueAtBeat(t1, 635.5 + 1e-6), BOOST, 1e-3) && near(valueAtBeat(t1, 700), BOOST, 1e-6),
  `${valueAtBeat(t1, 700).toFixed(3)}`);
const distance = integrate(t1, 318, 635.5);
const expectedDistance = BASE * (635.5 - 318) * 60 / BPM;
check('318→635.5 拍的距离 = 恒定速度 × 时长（±0.1%）', Math.abs(distance - expectedDistance) / expectedDistance < 0.001,
  `${distance.toFixed(1)} vs ${expectedDistance.toFixed(1)}`);
check('跳变段长度为 1/4 拍且为常量', t1.filter(item => beatOfEvent(item) >= 635.5 && endOf(item.endTime) <= secondsOf([635, 3, 4]) + 1e-9)
  .every(item => near(item.start, BOOST, 1e-6) && near(item.end, BOOST, 1e-6)));

/* 2) a FlowSpeed jump must not smear backwards -------------------------------------------- */
const speedConst = [{ startTime: [0, 0, 4], endTime: [1, 0, 4], start: SPEED_SCALE, end: SPEED_SCALE }];
const flowJump = [
  { startTime: [0, 0, 4], endTime: [1, 0, 4], start: 4, end: 4 },
  { startTime: [32, 0, 4], endTime: [32, 2, 4], start: 8, end: 8 },
];
const t2 = compose(speedConst, flowJump);
check('FlowSpeed 4→8 跳变前保持 4×', [2, 16, 31.99].every(beat => near(valueAtBeat(t2, beat), SPEED_SCALE * 4, 1e-6)),
  [2, 16, 31.99].map(beat => `${beat}:${valueAtBeat(t2, beat).toFixed(4)}`).join(' '));
check('FlowSpeed 跳变后为 8×', near(valueAtBeat(t2, 32.5), SPEED_SCALE * 8, 1e-6));
check('FlowSpeed 跳变前无爬升', valueAtBeat(t2, 31.99) < SPEED_SCALE * 4 + 1e-6);

/* 3) legitimate ramps survive (don't over-flatten) ---------------------------------------- */
const rampSpeed = [{ startTime: [0, 0, 4], endTime: [4, 0, 4], start: 1, end: 3 }];
const rampFlow = [{ startTime: [0, 0, 4], endTime: [4, 0, 4], start: 1, end: 1 }];
const t3 = compose(rampSpeed, rampFlow);
check('真实斜坡保留（1→3，2 拍处 ≈ 2）', near(valueAtBeat(t3, 2), 2, 1e-3), valueAtBeat(t3, 2).toFixed(4));
check('真实斜坡端点（0 拍 1，4 拍 3）', near(valueAtBeat(t3, 0), 1, 1e-6) && near(valueAtBeat(t3, 3.999), 3, 1e-3));

/* 4) product of two ramps stays quadratic-ish -------------------------------------------- */
const t4 = compose(
  [{ startTime: [0, 0, 4], endTime: [4, 0, 4], start: 1, end: 2 }],
  [{ startTime: [0, 0, 4], endTime: [4, 0, 4], start: 1, end: 2 }],
);
check('双斜坡乘积：中点 ≈ 2.25、末点 4', Math.abs(valueAtBeat(t4, 2) - 2.25) < 0.02 && near(valueAtBeat(t4, 3.999), 4, 1e-3),
  `mid=${valueAtBeat(t4, 2).toFixed(4)} end=${valueAtBeat(t4, 3.999).toFixed(4)}`);

/* 5) degenerate inputs ------------------------------------------------------------------- */
check('空输入返回空数组', compose([], []).length === 0);
check('只有 FlowSpeed 时按 FlowSpeed 采样', near(valueAtBeat(compose([], [FLOW_EVENTS[0]]), 100), 8, 1e-6));

console.log(`\n${failures.length ? 'FAILED: ' + failures.join(' | ') : '=== SPEED COMPOSE TESTS PASSED ==='}`);
if (failures.length) process.exitCode = 1;
