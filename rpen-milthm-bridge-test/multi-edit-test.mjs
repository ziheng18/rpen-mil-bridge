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
  milthmEventTypeLabels, semanticEvents, chartColumns,
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

console.log('=== MULTI-EDIT TESTS PASSED ===');
