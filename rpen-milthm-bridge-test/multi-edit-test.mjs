// Offline tests: 多线编辑 adaptations for Milthm charts.
// - milthmEventTypeLabels(): the event-type dropdown options follow the current column mapping;
// - syncMilthmColumns(): extended scaleX/scaleY edits (multi-line edit / extended event view) are
//   adopted into Milthm's single Size(3) channel and mirrored back;
// - Size mapped into a native slot keeps working (speed column carries size).
import assert from 'node:assert';
import {
  importMilthmChart, exportMilthmChart, MIL_ANIM,
} from '../rpen-milthm-bridge/convert.mjs';
import {
  ensureChartColumns, syncMilthmColumns, remapColumns, buildMilthmExportChart,
  milthmEventTypeLabels, semanticEvents, chartColumns, deriveSemantics,
  semanticColumnKey, semanticColumnEvents, SEMANTIC_COLUMN_PREFIX,
} from '../rpen-milthm-bridge/columns.mjs';

const rpeEvent = (startBeat, endBeat, start, end) => ({
  startTime: [startBeat, 0, 1], endTime: [endBeat, 0, 1], start, end,
  easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0,
});
const sourceChart = () => ({
  fmt: 2,
  meta: { name: 'multi edit test', background_dim: 0.6, background_artist: '', music_artist: '', charter: '', difficulty_name: '', difficulty: 0, offset: 0 },
  bpms: [{ time: [0, 0, 1], bpm: 120 }],
  lines: [
    {
      index: 0,
      notes: [{ index: 0, time: [0, 4, 1], endTime: [0, 4, 1], type: 0, isFake: false, isAlwaysPerfect: false }],
      animations: [
        { type: 0, startTime: [0, 0, 1], endTime: [16, 0, 1], start: 100, end: 100, bearer_type: 0, bearer: 0, ease: { type: 0, press: 0 } },
        { type: 3, startTime: [0, 0, 1], endTime: [16, 0, 1], start: 1, end: 1, bearer_type: 0, bearer: 0, ease: { type: 0, press: 0 } },
      ],
    },
    { index: 1, notes: [], animations: [] },
  ],
  storyboards: [],
});
const prepare = () => {
  const { chart } = importMilthmChart(sourceChart(), {});
  const ensured = ensureChartColumns(chart) ?? chart;
  return syncMilthmColumns(ensured);
};
const sizeValues = line => semanticEvents(line).size.map(event => [Number(event.start), Number(event.end)]);

// ---- 1) dropdown option labels follow the column mapping ----
{
  const labels = milthmEventTypeLabels(['x', 'y', 'rotate', 'bodyAlpha', 'flowSpeed']);
  assert.deepEqual(labels.map(([value]) => value), ['all', 'moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents', 'scaleXEvents', 'scaleYEvents', 'colorEvents', 'textEvents']);
  assert.equal(labels[1][1], 'X 坐标');
  assert.equal(labels[4][1], '线体不透明度（LineBodyTransparency 8）');
  assert.equal(labels[5][1], '流速倍率');
  assert.ok(!labels.some(([value]) => value === 'paintEvents'), 'shader column must be hidden for Milthm charts');
  const remapped = milthmEventTypeLabels(['x', 'y', 'rotate', 'lineAlpha', 'size']);
  assert.equal(remapped[4][1], '轨道整体不透明度（线头+线身，Transparency 2）');
  assert.equal(remapped[5][1], '轨道大小');
  console.log('[labels] ok');
}

// ---- 2) scaleX / scaleY edits are adopted into Milthm Size(3) ----
{
  const chart = prepare();
  assert.deepEqual(sizeValues(chart.judgeLineList[0]), [[1, 1]], 'imported Size(3) should start in the semantic size list');
  // unchanged chart must stay idempotent (no accidental adoption of the mirrored arrays)
  assert.equal(sizeValues(syncMilthmColumns(chart).judgeLineList[0]).length, 1);

  const scaleXEdited = structuredClone(chart);
  scaleXEdited.judgeLineList[0].extended.scaleXEvents = [rpeEvent(0, 8, 2.5, 2.5)];
  const adoptedX = syncMilthmColumns(scaleXEdited);
  assert.deepEqual(sizeValues(adoptedX.judgeLineList[0]), [[2.5, 2.5]], 'scaleX edit must become the Size(3) list');
  assert.deepEqual(adoptedX.judgeLineList[0].extended.scaleXEvents.map(event => event.start), [2.5]);
  assert.deepEqual(adoptedX.judgeLineList[0].extended.scaleYEvents.map(event => event.start), [2.5], 'scaleY is mirrored from the single Size channel');

  const scaleYEdited = structuredClone(adoptedX);
  scaleYEdited.judgeLineList[0].extended.scaleYEvents = [rpeEvent(0, 8, 0.75, 0.75)];
  const adoptedY = syncMilthmColumns(scaleYEdited);
  assert.deepEqual(sizeValues(adoptedY.judgeLineList[0]), [[0.75, 0.75]], 'scaleY edit must be adopted when scaleX is unchanged');
  assert.deepEqual(adoptedY.judgeLineList[0].extended.scaleXEvents.map(event => event.start), [0.75]);

  // the adopted value must reach the exported Milthm Size(3) animation
  const exported = exportMilthmChart(buildMilthmExportChart(adoptedY), {});
  const sizes = (exported.chart.lines[0].animations ?? []).filter(animation => Number(animation.type) === MIL_ANIM.SIZE);
  assert.ok(sizes.length >= 1, 'export must contain a Size(3) animation');
  assert.equal(Number(sizes[0].start), 0.75);
  console.log('[scale adoption] ok');
}

// ---- 3) Size(3) carried by a native slot (speed column) ----
{
  const chart = prepare();
  const remapped = remapColumns(chart, 4, 'size');
  assert.ok(remapped && !remapped.error, 'slot 5 must allow 轨道大小');
  assert.deepEqual(chartColumns(remapped), ['x', 'y', 'rotate', 'bodyAlpha', 'size']);
  const synced = syncMilthmColumns(remapped);
  const carrierSize = semanticEvents(synced.judgeLineList[0]).size.map(event => Number(event.start));
  assert.deepEqual(carrierSize, [1]);
  // simulate a multi-line edit on the native speed column (the carrier of Size here)
  const edited = structuredClone(synced);
  edited.judgeLineList[0].eventLayers[0].speedEvents = [rpeEvent(0, 8, 0.5, 0.5)];
  const adopted = syncMilthmColumns(edited);
  assert.deepEqual(sizeValues(adopted.judgeLineList[0]), [[0.5, 0.5]]);
  assert.deepEqual(adopted.judgeLineList[0].extended.scaleXEvents.map(event => event.start), [0.5]);
  console.log('[size column] ok');
}

// ---- 4) v0.7.4: beat-0 transparency initialisers for imported lines ----
{
  const beatOf = time => Number(time[0]) + Number(time[1]) / Number(time[2]);
  const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
  const raw = (startBeat, endBeat, start, end = start) => ({ startTime: [startBeat, 0, 1], endTime: [endBeat, 0, 1], start, end, ease });
  // lineAlpha: first event at beat 4 with start 0.5 -> init at beat 0 worth 0.5 for at most 1 beat
  // bodyAlpha: no events -> 1-beat opacity-1 init (Rain Editor default)
  // headAlpha: first event at beat 0.25 -> init [0, 0.25] with its start value
  const line = {
    eventLayers: [{ moveXEvents: [], moveYEvents: [], rotateEvents: [], alphaEvents: [], speedEvents: [] }],
    'x-milthm': {
      primaryAlphaType: 2,
      channels: { bodyAlpha: [], headAlpha: [raw(0.25, 2, 0.75)], wholeAlpha: [], flowSpeed: [] },
      rawExtras: [],
    },
    extended: {}, notes: [],
  };
  const carrier = value => ({ startTime: [0, 0, 1], endTime: [1, 0, 1], start: value, end: value, easingType: 1, easingLeft: 0, easingRight: 1 });
  line.eventLayers[0].alphaEvents = [carrier(128)];
  // lineAlpha raw comes from the carrier: [0,1] value 128/255; put the interesting first event in
  // extended... simpler: check the rule on a derived semantics where lineAlpha has a beat-4 event.
  const semantics = deriveSemantics(line);
  const initOf = (events) => (events ?? []).find(event => event.syntheticInit);
  const lineInit = initOf(semantics.lineAlpha);
  const bodyInit = initOf(semantics.bodyAlpha);
  const headInit = initOf(semantics.headAlpha);
  assert.ok(bodyInit, 'empty bodyAlpha must get an initialiser');
  // Rain Editor's default for a missing transparency track is 1 (fully opaque)
  assert.equal(Number(bodyInit.start), 1);
  assert.equal(beatOf(bodyInit.startTime), 0);
  assert.equal(beatOf(bodyInit.endTime), 1);
  assert.ok(headInit, 'headAlpha must get an initialiser');
  assert.equal(beatOf(headInit.startTime), 0);
  assert.ok(Math.abs(beatOf(headInit.endTime) - 0.25) < 1e-9, 'head init must end where its first event starts');
  assert.equal(Number(headInit.start), 0.75, 'head init value = first event start value');
  // a carrier starting at beat 0 has no initialiser
  const zero = {
    eventLayers: [{ moveXEvents: [], moveYEvents: [], rotateEvents: [], alphaEvents: [carrier(255)], speedEvents: [] }],
    'x-milthm': { primaryAlphaType: 2, channels: { bodyAlpha: [], headAlpha: [], wholeAlpha: [], flowSpeed: [] }, rawExtras: [] },
    extended: {}, notes: [],
  };
  const zeroInit = initOf(deriveSemantics(zero).lineAlpha);
  assert.equal(zeroInit, undefined, 'lineAlpha starting at beat 0 must not add an initialiser');
  void lineInit;
  console.log('[alpha init] ok');
}

// ---- 5) v0.7.9: multi-line semantic pseudo columns are adopted back on commit ----
{
  const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
  const raw = (type, startBeat, endBeat, start, end = start) => ({ type, startTime: [startBeat, 0, 1], endTime: [endBeat, 0, 1], start, end, bearer_type: 0, bearer: 0, ease });
  const source = {
    fmt: 2,
    meta: { background_dim: 0.6, name: 'semantic columns', background_artist: '', music_artist: '', charter: '', difficulty_name: '', difficulty: 0, offset: 0 },
    bpms: [{ time: [0, 0, 1], bpm: 120 }],
    lines: [{
      index: 0,
      notes: [{ index: 0, time: [0, 4, 1], endTime: [0, 4, 1], type: 0, isFake: false, isAlwaysPerfect: false }],
      animations: [raw(0, 0, 16, 0), raw(1, 0, 16, 0), raw(8, 2, 6, 1), raw(3, 0, 16, 1.5)],
    }],
    storyboards: [],
  };
  const { chart } = importMilthmChart(source, {});
  const ensured = ensureChartColumns(chart) ?? chart;
  const synced = syncMilthmColumns(ensured);
  const base = synced.judgeLineList[0];
  const semantics = semanticEvents(base);
  assert.ok((semantics.bodyAlpha ?? []).length > 0, 'bodyAlpha semantics present');
  assert.ok((semantics.size ?? []).length > 0, 'size semantics present');

  // simulate editing the "线体不透明度" and "轨道大小" pseudo columns
  const bodyKey = semanticColumnKey('bodyAlpha');
  const sizeKey = semanticColumnKey('size');
  const bodyDisplay = semanticColumnEvents(semantics, 'bodyAlpha');
  for (const event of bodyDisplay) { event.start = 200; event.end = 200; }
  const sizeDisplay = semanticColumnEvents(semantics, 'size');
  for (const event of sizeDisplay) { event.start = 2.5; event.end = 2.5; }
  const edited = structuredClone(synced);
  edited.judgeLineList[0].extended[bodyKey] = bodyDisplay;
  edited.judgeLineList[0].extended[sizeKey] = sizeDisplay;
  edited.judgeLineList[0].eventLayers[0][bodyKey] = bodyDisplay;
  edited.judgeLineList[0].eventLayers[0][sizeKey] = sizeDisplay;

  const adopted = syncMilthmColumns(edited);
  const adoptedLine = adopted.judgeLineList[0];
  const adoptedSemantics = semanticEvents(adoptedLine);
  const realBody = (adoptedSemantics.bodyAlpha ?? []).filter(event => !event.syntheticInit);
  assert.ok(realBody.length > 0, 'bodyAlpha real events kept');
  for (const event of realBody) {
    assert.ok(Math.abs(Number(event.start) - 200 / 255) < 1e-9, 'bodyAlpha adopted from the 0..255 pseudo column');
    assert.ok(Math.abs(Number(event.end) - 200 / 255) < 1e-9, 'bodyAlpha adopted from the 0..255 pseudo column');
  }
  assert.deepEqual(adoptedSemantics.size.map(event => [Number(event.start), Number(event.end)]).slice(-1), [[2.5, 2.5]], 'size adopted from the pseudo column');
  assert.ok(!Object.keys(adoptedLine.extended ?? {}).some(key => key.startsWith(SEMANTIC_COLUMN_PREFIX)), 'pseudo keys stripped from extended');
  assert.ok(!Object.keys(adoptedLine.eventLayers?.[0] ?? {}).some(key => key.startsWith(SEMANTIC_COLUMN_PREFIX)), 'pseudo keys stripped from the draw layer');
  console.log('[semantic columns] ok');
}

console.log('=== MULTI-EDIT TESTS PASSED ===');
