// Offline test for the Milthm event-column semantic layer.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { importMilthmChart, exportMilthmChart, normalizeLaneChart } from '../rpen-milthm-bridge/convert.mjs';
import { ensureChartColumns, syncMilthmColumns, remapColumns, buildMilthmExportChart, semanticEvents } from '../rpen-milthm-bridge/columns.mjs';

const WORK = 'E:\\File\\deepseek harness\\mil';
const beatOf = time => Number(time[0]) + Number(time[1]) / Number(time[2]);
const canon = value => Array.isArray(value) ? value.map(canon)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canon(value[key])]))
    : value;
const sameJson = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
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

const zipName = fs.readdirSync(WORK).find(name => /^Class.Memories\.zip$/i.test(name));
const original = readZipChart(path.join(WORK, zipName));
const { chart: imported } = importMilthmChart(original, {});
const ensured = ensureChartColumns(imported);
console.log('ensureChartColumns ->', Boolean(ensured), 'columns', ensured?.['x-milthm']?.columns);
const synced = syncMilthmColumns(ensured ?? imported);
const failures = [];

function semanticDiff(exported, label) {
  const diffs = [];
  const originalLines = [...original.lines].sort((a, b) => a.index - b.index);
  if (originalLines.length !== exported.lines.length) diffs.push(`${label}: line count ${originalLines.length} -> ${exported.lines.length}`);
  for (let i = 0; i < Math.min(originalLines.length, exported.lines.length); i++) {
    const a = originalLines[i], b = exported.lines[i];
    if (a.notes.length !== b.notes.length) diffs.push(`${label}: line ${i} note count`);
    const noteKey = note => JSON.stringify([beatOf(note.time), beatOf(note.endTime), note.type, Boolean(note.isFake), Boolean(note.isAlwaysPerfect)]);
    const aNotes = a.notes.map(noteKey).sort(), bNotes = b.notes.map(noteKey).sort();
    if (!sameJson(aNotes, bNotes)) diffs.push(`${label}: line ${i} notes differ`);
    if (a.animations.length !== b.animations.length) diffs.push(`${label}: line ${i} animation count ${a.animations.length} -> ${b.animations.length}`);
    const animKey = animation => JSON.stringify(canon({ startTime: animation.startTime, endTime: animation.endTime, type: animation.type,
      start: animation.start, end: animation.end, bearer_type: animation.bearer_type, bearer: animation.bearer, ease: animation.ease }));
    const aAnims = a.animations.map(animKey).sort(), bAnims = b.animations.map(animKey).sort();
    if (!sameJson(aAnims, bAnims)) {
      diffs.push(`${label}: line ${i} animations differ; missing=${aAnims.filter(x => !bAnims.includes(x)).length} extra=${bAnims.filter(x => !aAnims.includes(x)).length} firstExtra=${bAnims.filter(x => !aAnims.includes(x)).slice(0,1)}`);
    }
  }
  return diffs;
}

// 1) unedited chart through the semantic layer
{
  const exported = exportMilthmChart(buildMilthmExportChart(synced), {}).chart;
  const diffs = semanticDiff(exported, 'base');
  failures.push(...diffs);
  console.log('base export diffs:', diffs.length, diffs.slice(0, 4));
}

// 2) remap a column, then export: must stay byte-semantically identical
{
  const remapped = remapColumns(synced, 3, 'headAlpha');
  if (!remapped || remapped.error) failures.push('remap slot3 failed');
  else {
    const syncedRemap = syncMilthmColumns(remapped);
    const exported = exportMilthmChart(buildMilthmExportChart(syncedRemap), {}).chart;
    const diffs = semanticDiff(exported, 'remap');
    failures.push(...diffs);
    console.log('remap slot3 -> headAlpha export diffs:', diffs.length, diffs.slice(0, 2));
    console.log('columns after remap:', syncedRemap['x-milthm'].columns.join(','));
  }
}

// 2b) remap the alpha slot to the line-wide Transparency(2) track
{
  const remapped = remapColumns(synced, 3, 'lineAlpha');
  if (!remapped || remapped.error) failures.push('remap slot3 -> lineAlpha failed');
  else {
    const syncedRemap = syncMilthmColumns(remapped);
    const exported = exportMilthmChart(buildMilthmExportChart(syncedRemap), {}).chart;
    const diffs = semanticDiff(exported, 'lineAlpha remap');
    failures.push(...diffs);
    console.log('remap slot3 -> lineAlpha export diffs:', diffs.length, diffs.slice(0, 2));
  }
}

// 3) emulate a user editing the displayed column, ensure the semantic owner changes (and only it)
{
  const edited = structuredClone(synced);
  const line = edited.judgeLineList[1];
  const sizeBefore = JSON.stringify(semanticEvents(line).size);
  const xBefore = JSON.stringify(semanticEvents(line).x);
  // slot 0 is X; move the first displayed X event value by +1 (user drag)
  line.eventLayers[0].moveXEvents[0] = { ...line.eventLayers[0].moveXEvents[0], start: Number(line.eventLayers[0].moveXEvents[0].start) + 1, end: Number(line.eventLayers[0].moveXEvents[0].end) + 1 };
  const syncedEdit = syncMilthmColumns(edited);
  const semantics = semanticEvents(syncedEdit.judgeLineList[1]);
  const xChanged = JSON.stringify(semantics.x) !== xBefore;
  const sizeChanged = JSON.stringify(semantics.size) !== sizeBefore;
  if (!xChanged) failures.push('edit: semantic X not updated');
  if (sizeChanged) failures.push('edit: semantic size changed unexpectedly');
  console.log('edit via column -> X changed:', xChanged, 'size unchanged:', !sizeChanged);
}

// 4) semantic counts
{
  const lines = synced.judgeLineList;
  const totals = { x: 0, y: 0, rotate: 0, flow: 0, lineAlpha: 0, body: 0, size: 0 };
  for (const line of lines) {
    const semantics = semanticEvents(line);
    totals.x += semantics.x.length; totals.y += semantics.y.length; totals.rotate += semantics.rotate.length;
    totals.flow += semantics.flowSpeed.length; totals.lineAlpha += semantics.lineAlpha.length;
    totals.body += semantics.bodyAlpha.length; totals.size += semantics.size.length;
  }
  console.log('semantic totals:', JSON.stringify(totals));
  if (totals.lineAlpha !== 343) failures.push('lineAlpha count ' + totals.lineAlpha + ' != 343');
}

// 5) a plain RPE line added to a Milthm chart (新增判定线/批量增加) must be initialised
//    exactly once: ensureChartColumns() has to converge, otherwise every commit reports
//    "needs init" again and the editor enters an endless commit loop (v0.6.3 bug that made
//    the 判定线 panel buttons unclickable).
{
  const rpeEvent = value => ({ startTime: [0, 0, 1], endTime: [0, 1, 1], start: value, end: value,
    easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 });
  const plainLine = {
    Group: 0, Name: 'Line 20', Texture: 'line.png', anchor: [0.5, 0.5], bpmfactor: 1, father: -1,
    rotateWithFather: true, isCover: 1, isGif: false, zOrder: 20,
    eventLayers: [{
      moveXEvents: [rpeEvent(0)], moveYEvents: [rpeEvent(0)], rotateEvents: [rpeEvent(0)],
      alphaEvents: [rpeEvent(255)], speedEvents: [rpeEvent(10)],
    }],
    extended: {}, notes: [], numOfNotes: 0,
  };
  const withLine = { ...synced, judgeLineList: [...synced.judgeLineList, plainLine] };
  const initialised = ensureChartColumns(withLine);
  const alphaInitOk = (events, value, label) => {
    if (!Array.isArray(events) || events.length !== 1) { failures.push(`ensure: ${label} init count ${events?.length} != 1`); return; }
    const [event] = events;
    if (Number(event.start) !== value || Number(event.end) !== value) failures.push(`ensure: ${label} init value ${event.start}/${event.end} != ${value}`);
    if (JSON.stringify(event.startTime) !== JSON.stringify([0, 0, 1]) || JSON.stringify(event.endTime) !== JSON.stringify([0, 1, 1])) {
      failures.push(`ensure: ${label} init time ${JSON.stringify(event.startTime)}->${JSON.stringify(event.endTime)} != 0:0/1->0:1/1`);
    }
  };
  if (!initialised) failures.push('ensure: plain line was not initialised');
  else {
    const added = initialised.judgeLineList[19];
    if (!added['x-milthm']?.events) failures.push('ensure: added line has no x-milthm stash/events');
    if (added['x-milthm']?.events?.x?.length !== 1) failures.push('ensure: added line X semantics missing');
    // v0.7.3: every line (including added lines, index >= 1) initialises 整体(2)/线身(8)/线头(9)
    // to 255 (fully opaque), 1 beat from beat 0.
    alphaInitOk(added['x-milthm']?.events?.lineAlpha, 1, 'added line lineAlpha');
    alphaInitOk(added['x-milthm']?.events?.bodyAlpha, 1, 'added line bodyAlpha');
    alphaInitOk(added['x-milthm']?.events?.headAlpha, 1, 'added line headAlpha');
    if (ensureChartColumns(initialised)) failures.push('ensure: not idempotent (second pass still reports changes) => commit loop risk');
    const committed = normalizeLaneChart(syncMilthmColumns(initialised), {});
    if (ensureChartColumns(committed)) failures.push('ensure: still needs init after the commit pipeline => commit loop risk');
    const exported = exportMilthmChart(buildMilthmExportChart(committed), {}).chart;
    if (exported.lines.length !== 20) failures.push('export: added line missing (lines ' + exported.lines.length + ')');
    else {
      const count = (exported.lines[19].animations ?? []).length;
      if (!count) failures.push('export: added line exported without animations');
      const alphaTypes = (exported.lines[19].animations ?? []).filter(animation => [2, 8, 9].includes(Number(animation.type)));
      if (alphaTypes.length !== 3) failures.push('export: added line should export 3 opacity animations (2/8/9), got ' + alphaTypes.length);
      for (const animation of alphaTypes) if (Number(animation.start) !== 1 || Number(animation.end) !== 1) failures.push(`export: added line type ${animation.type} init not 255 (1)`);
      console.log('plain line init -> stash ok, second pass null, exported animations:', count);
    }
  }
  // A plain line at index 0 (the chart default track) also initialises to 255 (v0.7.3: no more 0).
  {
    const defaultChart = { META: { RPEVersion: 240 }, BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
      'x-milthm': { kind: 'milthm-fmt2', columns: ['x', 'y', 'rotate', 'bodyAlpha', 'flowSpeed'] }, judgeLineList: [structuredClone(plainLine)] };
    const initialisedDefault = ensureChartColumns(defaultChart);
    if (!initialisedDefault) failures.push('ensure: default plain line was not initialised');
    else {
      const events = initialisedDefault.judgeLineList[0]['x-milthm']?.events;
      alphaInitOk(events?.lineAlpha, 1, 'line-0 lineAlpha');
      alphaInitOk(events?.bodyAlpha, 1, 'line-0 bodyAlpha');
      alphaInitOk(events?.headAlpha, 1, 'line-0 headAlpha');
      console.log('line-0 plain line -> 2/8/9 initialised to 255');
    }
  }
}

if (failures.length) { console.log('\n=== FAILURES ==='); for (const failure of failures.slice(0, 20)) console.log('-', failure); process.exitCode = 1; }
else console.log('\n=== COLUMNS TESTS PASSED ===');
