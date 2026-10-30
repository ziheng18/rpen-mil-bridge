// Offline regression test: RPEN 钩定 (inst) must work on Milthm opacity channels.
//
// The Milthm bridge keeps the authoritative opacity events in `x-milthm.events`
// and mirrors them into the native RPEN alpha column (0..255).  Before v0.6.3 that
// mirror conversion dropped the editor-only `inst` (钩定) flag, so toggling 钩定 on a
// lineAlpha/bodyAlpha/headAlpha/wholeAlpha event was silently undone on the next commit,
// and imported Milthm zero-duration opacity events never showed as hooked (unlike the
// X/Y/rotation/speed columns).  This test locks the fixed behaviour down.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { importMilthmChart, exportMilthmChart, normalizeLaneChart } from '../rpen-milthm-bridge/convert.mjs';
import { ensureChartColumns, syncMilthmColumns, remapColumns, buildMilthmExportChart, semanticEvents } from '../rpen-milthm-bridge/columns.mjs';

const WORK = 'E:\\File\\deepseek harness\\mil';
const canon = value => Array.isArray(value) ? value.map(canon)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canon(value[key])]))
    : value;
const sameJson = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const sameTime = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const failures = [];
const fail = message => { failures.push(message); console.log('FAIL', message); };
const ok = message => console.log('PASS', message);

function readZipChart(file) {
  const buffer = fs.readFileSync(file);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  const count = view.getUint16(eocd + 10, true); let offset = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(offset + 10, true), compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(buffer.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    let data = buffer.subarray(dataStart, dataStart + compressed);
    if (method === 8) data = zlib.inflateRawSync(data);
    if (name === 'chart.json') return JSON.parse(data.toString('utf8'));
  }
  throw new Error('chart.json missing');
}

const commitPipeline = chart => normalizeLaneChart(syncMilthmColumns(chart), {});
const exportedChart = chart => exportMilthmChart(buildMilthmExportChart(chart), {}).chart;
const isHooked = event => event?.inst === 1 || event?.inst === true;
const isZeroLength = event => sameTime(event.startTime, event.endTime);
const alphaEvents = (chart, lineIndex) => chart.judgeLineList[lineIndex].eventLayers[0].alphaEvents ?? [];
const rawList = (chart, lineIndex, key) => semanticEvents(chart.judgeLineList[lineIndex])[key] ?? [];

// Semantic animation comparison (ignores the renumbered index, like columns-test).
const animKey = animation => JSON.stringify(canon({
  startTime: animation.startTime, endTime: animation.endTime, type: animation.type,
  start: animation.start, end: animation.end, bearer_type: animation.bearer_type,
  bearer: animation.bearer, ease: animation.ease,
}));
function semanticDiff(exported, source) {
  const diffs = [];
  const sourceLines = [...source.lines].sort((a, b) => a.index - b.index);
  if (sourceLines.length !== exported.lines.length) diffs.push(`line count ${sourceLines.length} -> ${exported.lines.length}`);
  for (let i = 0; i < Math.min(sourceLines.length, exported.lines.length); i++) {
    const before = sourceLines[i].animations.map(animKey).sort();
    const after = exported.lines[i].animations.map(animKey).sort();
    if (!sameJson(before, after)) {
      const missing = before.filter(key => !after.includes(key));
      const extra = after.filter(key => !before.includes(key));
      diffs.push(`line ${i}: ${missing.length} missing / ${extra.length} extra; firstExtra=${extra[0]}`);
    }
  }
  return diffs;
}

// Pick an event whose start beat is unique inside the carrier column (Class Memories has
// same-beat zero-duration pairs, so beat-only lookup is not reliable for all events).
function eventsWithUniqueBeat(events) {
  const counts = new Map();
  for (const event of events) { const key = JSON.stringify(event.startTime); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return events.filter(event => counts.get(JSON.stringify(event.startTime)) === 1);
}
function toggleHook(chart, lineIndex, target, hooked) {
  const next = structuredClone(chart);
  const events = next.judgeLineList[lineIndex].eventLayers[0].alphaEvents;
  const index = events.findIndex(event => sameTime(event.startTime, target.startTime) && JSON.stringify(event.start) === JSON.stringify(target.start));
  if (index < 0) return null;
  events[index] = { ...events[index], inst: hooked ? 1 : 0, ...(hooked ? { end: structuredClone(events[index].start) } : {}) };
  return next;
}
function editAnotherEvent(chart, lineIndex, skipBeat) {
  const next = structuredClone(chart);
  const events = next.judgeLineList[lineIndex].eventLayers[0].alphaEvents;
  const index = events.findIndex(event => !sameTime(event.startTime, skipBeat));
  if (index < 0) return null;
  const editedBeat = structuredClone(events[index].startTime);
  events[index] = { ...events[index], end: Number(events[index].end) === 255 ? 254 : Number(events[index].end) + 1 };
  return { chart: next, editedBeat };
}
const findAtBeat = (events, time) => events.find(event => sameTime(event.startTime, time));

/* ================================================================ *
 * Part A: real chart — Class Memories (bodyAlpha/headAlpha/lineAlpha)
 * ================================================================ */
const zipName = fs.readdirSync(WORK).find(name => /^Class.Memories\.zip$/i.test(name));
const original = readZipChart(path.join(WORK, zipName));
const { chart: importedChart } = importMilthmChart(original, {});
const baseChart = ensureChartColumns(importedChart) ?? importedChart;
console.log('A. Class Memories columns:', baseChart['x-milthm'].columns.join(','));

// A1) imported zero-duration alpha events must be hooked, exactly like the X/Y/rotate columns
{
  const alphaKey = baseChart['x-milthm'].columns[3];
  let zero = 0, zeroHooked = 0, duration = 0, durationHooked = 0;
  for (const line of baseChart.judgeLineList) for (const event of (line.eventLayers[0].alphaEvents ?? [])) {
    if (isZeroLength(event)) { zero++; if (isHooked(event)) zeroHooked++; } else { duration++; if (isHooked(event)) durationHooked++; }
  }
  let xZero = 0, xZeroHooked = 0;
  for (const line of baseChart.judgeLineList) for (const event of (line.eventLayers[0].moveXEvents ?? [])) if (isZeroLength(event)) { xZero++; if (isHooked(event)) xZeroHooked++; }
  console.log(`A1. ${alphaKey}: zero-length ${zeroHooked}/${zero} hooked, duration ${durationHooked}/${duration} hooked; control X zero-length ${xZeroHooked}/${xZero}`);
  if (zero === 0) fail('A1: expected zero-duration opacity events in Class Memories');
  else if (zeroHooked !== zero) fail(`A1: imported zero-duration opacity events are not hooked (${zeroHooked}/${zero})`);
  else ok(`A1: all ${zero} imported zero-duration opacity events are hooked`);
  if (durationHooked !== 0) fail(`A1: duration opacity events should not be hooked by default (${durationHooked}/${duration})`);
  if (xZeroHooked !== xZero) fail('A1: control X column zero-duration events are not all hooked');
}

// A2) toggling 钩定 ON a duration opacity event must survive commits and repeated conversions
{
  let lineIndex = -1, target = null;
  for (let li = 0; li < baseChart.judgeLineList.length && lineIndex < 0; li++) {
    target = eventsWithUniqueBeat(alphaEvents(baseChart, li)).find(event => !isZeroLength(event) && Number(event.start) !== Number(event.end));
    if (target) lineIndex = li;
  }
  if (lineIndex < 0) fail('A2: no duration opacity event with start != end and a unique beat');
  else {
    const targetTime = target.startTime, targetStart = target.start;
    const toggled = toggleHook(baseChart, lineIndex, target, true);
    const committed = commitPipeline(toggled);
    const after = findAtBeat(alphaEvents(committed, lineIndex), targetTime);
    if (!after) fail('A2: toggled event disappeared from the carrier column');
    else if (!isHooked(after)) fail('A2: 钩定 lost after commit (the reported bug)');
    else ok('A2: 钩定 ON survives the commit hook');
    if (after && Number(after.end) !== Number(targetStart)) fail('A2: hooked event end value should equal start value');

    // second conversion: edit ANOTHER opacity event of the same line, re-converting the whole column
    const second = editAnotherEvent(committed, lineIndex, targetTime);
    const committed2 = second ? commitPipeline(second.chart) : committed;
    const editedBeat = second?.editedBeat ?? null;
    const after2 = findAtBeat(alphaEvents(committed2, lineIndex), targetTime);
    if (!after2 || !isHooked(after2)) fail('A2: 钩定 lost after a second same-column edit');
    else ok('A2: 钩定 ON survives a second commit that converts the whole column');

    const exported = exportedChart(committed2);
    const exportedTarget = findAtBeat(exported.lines[lineIndex].animations, targetTime);
    if (!exportedTarget) fail('A2: hooked event missing from export');
    else if (Number(exportedTarget.start) !== Number(exportedTarget.end) || Math.abs(Number(exportedTarget.start) - Number(targetStart) / 255) > 1e-9) {
      console.log('A2. exported target:', JSON.stringify(exportedTarget));
      fail('A2: hooked event should export as a constant Milthm event (start == end == hooked value)');
    } else ok('A2: hooked event exports as a constant Milthm event');

    let markerLeak = null;
    const json = JSON.stringify(exported);
    for (const marker of ['"inst"', '"syntheticInit"', '"x-milthm"', '"milthmRaw"', '"carrierValues"']) if (json.includes(marker)) markerLeak = marker;
    if (markerLeak) fail(`A2: internal marker ${markerLeak} leaked into the exported chart`);
    else ok('A2: no internal editor markers leaked into the export');

    // untouched events of the same line must stay byte-identical (skip the two edited beats)
    const touched = beat => sameTime(beat, targetTime) || (editedBeat && sameTime(beat, editedBeat));
    const exportedUntouched = exported.lines[lineIndex].animations.filter(animation => !touched(animation.startTime));
    const sourceLine = original.lines.find(line => line.index === exported.lines[lineIndex].index);
    const sourceUntouched = (sourceLine?.animations ?? []).filter(animation => !touched(animation.startTime));
    if (!sameJson(exportedUntouched.map(animKey).sort(), sourceUntouched.map(animKey).sort())) {
      fail('A2: other events of the same line were re-encoded by the opacity column conversion');
    } else ok('A2: untouched events of the same line stay byte-identical');
  }
}

// A3) toggling 钩定 OFF an imported zero-duration opacity event must stick and keep 0 diff
{
  let lineIndex = -1, target = null;
  for (let li = 0; li < baseChart.judgeLineList.length && lineIndex < 0; li++) {
    target = eventsWithUniqueBeat(alphaEvents(baseChart, li)).find(event => isZeroLength(event) && isHooked(event));
    if (target) lineIndex = li;
  }
  if (lineIndex < 0) fail('A3: no hooked zero-duration opacity event with a unique beat');
  else {
    const targetTime = target.startTime;
    const committed = commitPipeline(toggleHook(baseChart, lineIndex, target, false));
    const after = findAtBeat(alphaEvents(committed, lineIndex), targetTime);
    if (!after || isHooked(after)) fail('A3: 钩定 OFF on a zero-duration opacity event was undone');
    else ok('A3: 钩定 OFF on an imported zero-duration event sticks');
    const committed2 = commitPipeline(committed);
    const after2 = findAtBeat(alphaEvents(committed2, lineIndex), targetTime);
    if (!after2 || isHooked(after2)) fail('A3: 钩定 OFF flipped back on the next commit');
    const exported = exportedChart(committed2);
    const diffs = semanticDiff(exported, original);
    if (diffs.length) { console.log('A3. diffs:', diffs.slice(0, 3)); fail('A3: unhooking must not change the exported Milthm data (0 diff expected)'); }
    else ok('A3: unhook keeps source 0 diff');
  }
}

// A4) every opacity channel can be hooked when mapped to the alpha slot
for (const key of ['headAlpha', 'lineAlpha']) {
  const remapped = remapColumns(baseChart, 3, key);
  if (!remapped || remapped.error) { fail(`A4: remap to ${key} failed`); continue; }
  const committed = commitPipeline(remapped);
  let lineIndex = -1;
  for (let li = 0; li < committed.judgeLineList.length && lineIndex < 0; li++) if (alphaEvents(committed, li).length) lineIndex = li;
  if (lineIndex < 0) { fail(`A4: no ${key} events to hook`); continue; }
  const target = alphaEvents(committed, lineIndex)[0];
  const targetTime = target.startTime;
  const after = findAtBeat(alphaEvents(commitPipeline(toggleHook(committed, lineIndex, target, true)), lineIndex), targetTime);
  if (!after || !isHooked(after)) fail(`A4: 钩定 lost on ${key}`);
  else ok(`A4: 钩定 works on ${key} (mapped to the alpha column)`);
}

/* ================================================================ *
 * Part B: synthetic minimal chart — all four opacity channels
 * ================================================================ */
const ease = (type = 0, press = 0) => ({ type, press, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 });
const minimal = {
  fmt: 2,
  meta: { name: 'hook test', background_dim: 0.6, background_artist: '', music_artist: '', charter: '', difficulty_name: '', difficulty: 0, offset: 0 },
  bpms: [{ time: [0, 0, 1], bpm: 120 }],
  lines: [{
    index: 0,
    notes: [{ index: 0, time: [0, 1, 1], endTime: [0, 1, 1], type: 0, isFake: false, isAlwaysPerfect: false }],
    animations: [
      { type: 2, startTime: [0, 0, 1], endTime: [0, 0, 1], start: 0, end: 1, bearer_type: 0, bearer: 0, ease: ease() },
      { type: 2, startTime: [0, 2, 1], endTime: [0, 3, 1], start: 1, end: 0.25, bearer_type: 0, bearer: 0, ease: { ...ease(2, 5), isValueExp: true, cusValueExp: 'sin(t)' } },
      { type: 8, startTime: [0, 0, 1], endTime: [0, 0, 1], start: 1, end: 0, bearer_type: 0, bearer: 0, ease: ease() },
      { type: 8, startTime: [0, 4, 1], endTime: [0, 5, 1], start: 0.5, end: 1, bearer_type: 0, bearer: 0, ease: ease(1, 2) },
      { type: 9, startTime: [0, 6, 1], endTime: [0, 6, 1], start: 0.25, end: 0.75, bearer_type: 0, bearer: 0, ease: ease() },
      { type: 13, startTime: [0, 7, 1], endTime: [0, 8, 1], start: 0.75, end: 0.5, bearer_type: 0, bearer: 0, ease: ease() },
      { type: 3, startTime: [0, 0, 1], endTime: [0, 1, 1], start: 1, end: 1, bearer_type: 0, bearer: 0, ease: ease() },
      { type: 5, startTime: [0, 0, 1], endTime: [0, 1, 1], start: 1, end: 1, bearer_type: 0, bearer: 0, ease: ease() },
    ],
  }],
  storyboards: [],
};
const { chart: minimalImported } = importMilthmChart(minimal, {});
const minimalBase = ensureChartColumns(minimalImported) ?? minimalImported;
{
  const diffs = semanticDiff(exportedChart(commitPipeline(minimalBase)), minimal);
  if (diffs.length) { console.log('B0. diffs:', diffs); fail('B0: minimal chart does not round-trip with 0 diff'); }
  else ok('B0: minimal chart round-trips with 0 diff');
}

for (const key of ['lineAlpha', 'bodyAlpha', 'headAlpha', 'wholeAlpha']) {
  const current = minimalBase['x-milthm'].columns[3];
  const remapped = current === key ? structuredClone(minimalBase) : remapColumns(minimalBase, 3, key);
  if (!remapped || remapped.error) { fail(`B: remap to ${key} failed`); continue; }
  const committed = commitPipeline(remapped);
  const carriers = alphaEvents(committed, 0);
  if (!carriers.length) { fail(`B: no carrier events for ${key}`); continue; }
  const raw = rawList(committed, 0, key);
  const zeroCount = raw.filter(event => sameTime(event.startTime, event.endTime)).length;
  const zeroHooked = carriers.filter(event => isZeroLength(event) && isHooked(event)).length;
  if (zeroHooked !== zeroCount) fail(`B.${key}: zero-duration events hooked ${zeroHooked}/${zeroCount}`);
  const target = carriers.find(event => !isZeroLength(event)) ?? carriers[0];
  const targetTime = target.startTime;
  const next = commitPipeline(toggleHook(committed, 0, target, true));
  const after = findAtBeat(alphaEvents(next, 0), targetTime);
  if (!after || !isHooked(after)) fail(`B.${key}: 钩定 lost after commit`);
  else ok(`B.${key}: 钩定 works, zero-duration hooking ${zeroHooked}/${zeroCount}`);

  // expression easing must survive; all untouched events must round-trip
  const exported = exportedChart(next);
  const expectedUntouched = raw.filter(event => sameTime(event.startTime, event.endTime) && !sameTime(event.startTime, targetTime));
  for (const sourceEvent of expectedUntouched) {
    const match = exported.lines[0].animations.find(animation => sameTime(animation.startTime, sourceEvent.startTime) && Number(animation.type) === Number(sourceEvent.type));
    if (!match) fail(`B.${key}: zero-duration event at ${sourceEvent.startTime} missing from export`);
    else if (Number(match.start) !== Number(sourceEvent.start) || Number(match.end) !== Number(sourceEvent.end)) fail(`B.${key}: zero-duration event values changed by the hook conversion`);
  }
  const expressionSource = raw.find(event => event.ease?.isValueExp);
  if (expressionSource) {
    const match = exported.lines[0].animations.find(animation => sameTime(animation.startTime, expressionSource.startTime) && Number(animation.type) === Number(expressionSource.type));
    if (!match) fail(`B.${key}: expression-eased event missing from export`);
    else if (!match.ease?.isValueExp || match.ease.cusValueExp !== expressionSource.ease.cusValueExp) fail(`B.${key}: expression easing lost by a same-column conversion`);
  }
}

// B2) fractional alpha values must survive RPEN's integer truncation on commit
{
  const chart = commitPipeline(minimalBase);
  const key = chart['x-milthm'].columns[3];
  const edited = structuredClone(chart);
  const targetRaw = semanticEvents(edited.judgeLineList[0])[key][0];
  targetRaw.start = 0.1; targetRaw.end = 0.1;
  const other = key === 'headAlpha' ? 'wholeAlpha' : 'headAlpha';
  let rebuilt = remapColumns(edited, 3, other);
  rebuilt = rebuilt ? remapColumns(rebuilt, 3, key) : null;
  if (!rebuilt) fail('B2: remap rebuild failed');
  else {
    // simulate RPEN's integerChartAlpha truncation happening on commit
    const truncated = structuredClone(rebuilt);
    for (const event of (truncated.judgeLineList[0].eventLayers[0].alphaEvents ?? [])) { event.start = Math.trunc(event.start); event.end = Math.trunc(event.end); }
    const committed = commitPipeline(truncated);
    const raw = semanticEvents(committed.judgeLineList[0])[key].find(event => Math.abs(Number(event.start) - 0.1) < 1e-6);
    if (!raw) fail('B2: fractional raw event was not found after conversion');
    else ok('B2: fractional opacity values survive RPEN alpha truncation');
  }
}

console.log('');
if (failures.length) {
  console.log(`=== HOOK-ALPHA TESTS FAILED (${failures.length}) ===`);
  process.exitCode = 1;
} else {
  console.log('=== HOOK-ALPHA TESTS PASSED ===');
}
