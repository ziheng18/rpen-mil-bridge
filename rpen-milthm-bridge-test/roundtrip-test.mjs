// Offline tests for the Milthm fmt=2 bridge converter:
// 1) import -> export round-trip must be semantically identical for several transform settings
// 2) lane lock normalization
// 3) editing: hand-edited notes/events must export with inverse transforms
// Usage: node roundtrip-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { importMilthmChart, exportMilthmChart, normalizeLaneChart, beatOf, milEaseToRpe, rpeEaseToMil } from '../rpen-milthm-bridge/convert.mjs';

const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT_DIR = path.join(WORK, 'rpen-milthm-bridge-test', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---------- minimal zip reader ---------- */
async function readZipEntries(input) {
  const buffer = input.buffer ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : input;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('no EOCD');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    let data = bytes.slice(dataStart, dataStart + compressedSize);
    if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (method !== 0) throw new Error('unsupported method ' + method);
    entries.set(name, data.subarray(0, size));
  }
  return entries;
}

/* ---------- semantic comparison ---------- */
const canon = value => Array.isArray(value) ? value.map(canon)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canon(value[key])]))
    : value;
const sameJson = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function compare(original, exported) {
  const diffs = [];
  const push = message => diffs.push(message);
  for (const key of ['background_dim', 'name', 'background_artist', 'music_artist', 'charter', 'difficulty_name', 'difficulty', 'offset']) {
    if (!sameJson(original.meta?.[key], exported.meta?.[key])) push(`meta.${key}: ${JSON.stringify(original.meta?.[key])} -> ${JSON.stringify(exported.meta?.[key])}`);
  }
  if (!sameJson(original.bpms, exported.bpms)) push('bpms differ');
  if (!sameJson(original.storyboards, exported.storyboards)) push('storyboards differ');
  const originalLines = [...original.lines].sort((a, b) => a.index - b.index);
  if (originalLines.length !== exported.lines.length) push(`line count ${originalLines.length} -> ${exported.lines.length}`);
  for (let i = 0; i < Math.min(originalLines.length, exported.lines.length); i++) {
    const a = originalLines[i], b = exported.lines[i];
    if (a.index !== b.index) push(`line ${i}: index ${a.index} -> ${b.index}`);
    if (a.notes.length !== b.notes.length) push(`line ${i}: note count ${a.notes.length} -> ${b.notes.length}`);
    const noteKey = note => JSON.stringify([beatOf(note.time), beatOf(note.endTime), note.type, Boolean(note.isFake), Boolean(note.isAlwaysPerfect)]);
    const aNotes = a.notes.map(noteKey).sort(), bNotes = b.notes.map(noteKey).sort();
    if (!sameJson(aNotes, bNotes)) push(`line ${i}: notes differ missing=${JSON.stringify(aNotes.filter(x => !bNotes.includes(x)).slice(0, 2))} extra=${JSON.stringify(bNotes.filter(x => !aNotes.includes(x)).slice(0, 2))}`);
    if (a.animations.length !== b.animations.length) push(`line ${i}: animation count ${a.animations.length} -> ${b.animations.length}`);
    const animKey = animation => JSON.stringify(canon({
      startTime: animation.startTime, endTime: animation.endTime, type: animation.type,
      start: animation.start, end: animation.end, bearer_type: animation.bearer_type, bearer: animation.bearer, ease: animation.ease,
    }));
    const aAnims = a.animations.map(animKey).sort(), bAnims = b.animations.map(animKey).sort();
    if (!sameJson(aAnims, bAnims)) push(`line ${i}: animations differ missing=${JSON.stringify(aAnims.filter(x => !bAnims.includes(x)).slice(0, 2))} extra=${JSON.stringify(bAnims.filter(x => !aAnims.includes(x)).slice(0, 2))}`);
  }
  return diffs;
}

/* ---------- load source chart ---------- */
const zipName = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name))[0];
const original = JSON.parse(new TextDecoder().decode((await readZipEntries(fs.readFileSync(path.join(WORK, zipName)))).get('chart.json')));
console.log('source chart:', zipName, 'fmt', original.fmt, 'lines', original.lines.length,
  'notes', original.lines.reduce((sum, line) => sum + line.notes.length, 0),
  'animations', original.lines.reduce((sum, line) => sum + line.animations.length, 0));

/* ---------- 1) round-trip with several transform settings ---------- */
const variants = [
  ['defaults', {}],
  ['coords: scale=1, y-flip, rotation=0', { 'coord-scale': 1, 'flip-y': true, 'rotation-offset': 0, 'speed-scale': 1 }],
  ['coords: scale=1.3, rotation=+30', { 'coord-scale': 1.3, 'flip-y': false, 'rotation-offset': 30, 'speed-scale': 2 }],
];
let failed = 0;
for (const [label, settings] of variants) {
  const { chart: rpe, warnings: importWarnings } = importMilthmChart(original, settings);
  const { chart: exported, warnings: exportWarnings } = exportMilthmChart(rpe, settings);
  const diffs = compare(original, exported);
  console.log(`\n[${label}] import warnings=${importWarnings.length} export warnings=${exportWarnings.length} round-trip diffs=${diffs.length}`);
  for (const diff of diffs.slice(0, 6)) console.log('  !', diff);
  for (const warning of importWarnings.slice(0, 2)) console.log('  import:', warning);
  if (diffs.length) failed++;
  if (label === 'defaults') {
    fs.writeFileSync(path.join(OUT_DIR, 'imported-rpe-chart.json'), JSON.stringify(rpe, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'roundtrip-milthm.json'), JSON.stringify(exported, null, 4));
  }
}

/* ---------- 2) lane lock ---------- */
{
  const settings = {};
  const { chart: rpe } = importMilthmChart(original, settings);
  const mutated = structuredClone(rpe);
  mutated.judgeLineList[1].notes[0].positionX = 321;
  mutated.judgeLineList[1].notes[0].size = 2;
  mutated.judgeLineList[1].bpmfactor = 2;
  mutated.judgeLineList[1].father = 0;
  const normalized = normalizeLaneChart(mutated, settings);
  // v0.7.13: `father` is no longer reset — the hierarchy stays editable/previewable and export
  // bakes it into absolute keyframes (flatten.mjs, covered by flatten-test.mjs).
  const ok = normalized.judgeLineList[1].notes[0].positionX === 0
    && normalized.judgeLineList[1].notes[0].size === 1
    && normalized.judgeLineList[1].bpmfactor === 1
    && normalized.judgeLineList[1].father === 0;
  console.log('\n[lane lock] normalized:', ok);
  if (!ok) failed++;
}

/* ---------- 3) editing -> export uses inverse transforms ---------- */
{
  const settings = {}; // default: scale 0.703125, no flip, rotation -90, speed 1.1671875
  const { chart: rpe } = importMilthmChart(original, settings);
  const edited = structuredClone(rpe);
  const line = edited.judgeLineList.find(item => (item.notes?.length ?? 0) > 0);
  const note = line.notes[0];
  note.startTime = [10, 0, 1];
  note.endTime = [10, 0, 1];
  note.positionX = 300; // must be ignored (track based) but warned
  const layer = line.eventLayers[0];
  layer.moveXEvents = [{
    startTime: [20, 0, 1], endTime: [21, 0, 1], start: 140.625, end: 281.25,
    easingType: 14, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0,
  }];
  const { chart: exported, warnings } = exportMilthmChart(edited, settings);
  const exportedNote = exported.lines.flatMap(item => item.notes).find(item => beatOf(item.time) === 10);
  const exportedEvent = exported.lines.flatMap(item => item.animations).find(animation => animation.type === 0 && beatOf(animation.startTime) === 20);
  const expectedStart = 140.625 / 0.703125;
  const expectedEnd = 281.25 / 0.703125;
  const eventOk = !!exportedEvent && Math.abs(exportedEvent.start - expectedStart) < 1e-6 && Math.abs(exportedEvent.end - expectedEnd) < 1e-6
    && exportedEvent.ease.type === 1 && exportedEvent.ease.press === 5; // RPE 14 = OutQuint
  const noteOk = !!exportedNote && beatOf(exportedNote.time) === 10;
  const laneWarned = warnings.some(warning => warning.includes('X 坐标'));
  console.log('\n[editing] note time exported:', noteOk, '| event inverse transform:', eventOk,
    '| exported start:', exportedEvent?.start, 'expected:', expectedStart, '| lane warning:', laneWarned);
  if (!noteOk || !eventOk || !laneWarned) failed++;
}

/* ---------- 4) easing mapping round-trip ---------- */
{
  let easingOk = true;
  for (let rpeEase = 1; rpeEase <= 29; rpeEase++) {
    const mil = rpeEaseToMil(rpeEase);
    const back = milEaseToRpe({ type: mil.type, press: mil.press });
    if (back !== rpeEase) { easingOk = false; console.log(`  easing mismatch rpe ${rpeEase} -> mil ${JSON.stringify(mil)} -> rpe ${back}`); }
  }
  console.log('[easing] RPE 1..29 <-> Milthm mapping round-trip:', easingOk);
  if (!easingOk) failed++;
}

{
  // rotation mapping: RPE A = 90 - Milthm theta (notes field consistent)
  const { chart: rpe } = importMilthmChart(original, {});
  const rotLine = rpe.judgeLineList.find(line => (line['x-milthm'] && line.eventLayers[0].rotateEvents.some(e => e['x-milthm']?.raw)));
  const mapped = rotLine?.eventLayers[0].rotateEvents.find(e => e['x-milthm']?.raw);
  const theta = mapped?.['x-milthm']?.raw?.start;
  const ok = theta === undefined || Math.abs((90 - theta) - mapped.start) < 1e-9;
  console.log('[rotation] milthm', theta, '-> rpe', mapped?.start, '(expected 90-theta):', ok);
  if (!ok) failed++;
}

console.log(`\n=== ${failed ? 'FAILED' : 'ALL TESTS PASSED'} (${failed} failures) ===`);
console.log('artifacts:', OUT_DIR);
process.exitCode = failed ? 1 : 0;

