// Offline test: imported Milthm text / picture storyboards become editable RPEN special lines
// (extended.textEvents lines and custom-Texture lines) and are converted back to storyboards on
// export, keeping the original layer.
import assert from 'node:assert';
import {
  importMilthmChart, exportMilthmChart,
} from '../rpen-milthm-bridge/convert.mjs';
import {
  ensureChartColumns, syncMilthmColumns,
} from '../rpen-milthm-bridge/columns.mjs';

const SCALE = 0.703125;
const BEAT = (beat) => [beat, 0, 1];
const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
const animation = (sbIndex, type, startBeat, endBeat, start, end) => ({
  startTime: BEAT(startBeat), endTime: BEAT(endBeat), type, start, end,
  bearer_type: 2, bearer: sbIndex, ease,
});
const white = ((255 << 24) | (255 << 16) | (255 << 8) | 255) >>> 0;
const chartSource = () => ({
  fmt: 2,
  meta: { background_dim: 0.6, name: 'SB test', background_artist: '', music_artist: '', charter: '', difficulty_name: 'Cloudburst', difficulty: 8, offset: 0 },
  bpms: [{ time: [0, 0, 1], bpm: 120 }],
  lines: [{
    index: 0,
    notes: [{ index: 0, time: [0, 4, 1], endTime: [0, 4, 1], type: 0, isFake: false, isAlwaysPerfect: false }],
    animations: [
      { type: 0, startTime: [0, 0, 1], endTime: [16, 0, 1], start: 0, end: 0, bearer_type: 0, bearer: 0, ease },
      { type: 5, startTime: [0, 0, 1], endTime: [16, 0, 1], start: 1, end: 1, bearer_type: 0, bearer: 0, ease },
    ],
  }],
  storyboards: [
    {
      index: 0, type: 1, layer: 0, data: 'HELLO',
      animations: [
        animation(0, 0, 4, 8, 100, 100),
        animation(0, 1, 4, 8, 200, 200),
        animation(0, 4, 4, 8, 30, 30),
        animation(0, 10, 4, 8, 1.5, 1.5),
        animation(0, 11, 4, 8, 1.5, 1.5),
        animation(0, 2, 4, 8, 1, 1),
        animation(0, 22, 4, 8, white, white),
      ],
    },
    {
      index: 1, type: 0, layer: 2, data: 'res/tex.png',
      animations: [
        animation(1, 0, 4, 8, -200, -200),
        animation(1, 1, 4, 8, 120, 120),
        animation(1, 4, 4, 8, 0, 0),
        animation(1, 10, 4, 8, 2, 2),
        animation(1, 11, 4, 8, 2, 2),
      ],
    },
    { index: 2, type: 2, layer: 1, data: 'mesh', animations: [] },
  ],
});

// ---- 1) import: storyboards become special lines ----
const { chart, warnings } = importMilthmChart(chartSource(), {});
const lines = chart.judgeLineList ?? [];
assert.equal(lines.length, 3, 'one track + text line + picture line');
assert.ok(warnings.some(text => text.includes('文字/图片故事板已转换为')), 'conversion warning');
assert.ok(warnings.some(text => text.includes('未支持的故事板')), 'leftover mesh warning');

const textLine = lines[1];
assert.equal(textLine['x-milthm']?.storyboardKind, 'text');
assert.equal(textLine.Texture, 'line.png');
assert.equal(textLine.extended?.textEvents?.length, 1, 'text event created');
assert.equal(textLine.extended.textEvents[0].start, 'HELLO');
assert.equal(textLine.extended.textEvents[0].end, 'HELLO');
const near = (actual, expected, label) => assert.ok(Math.abs(Number(actual) - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
const firstStart = (events) => Number((events ?? [])[0]?.start);
near(firstStart(textLine.eventLayers[0].moveXEvents), 100 * SCALE, 'text PositionX inverse');
near(firstStart(textLine.eventLayers[0].moveYEvents), 200 * SCALE, 'text PositionY inverse');
near(firstStart(textLine.eventLayers[0].rotateEvents), 30, 'text rotation inverse (90 - 30)');
near(firstStart(textLine.extended.scaleXEvents), 1.5 * (60.75 * SCALE / 52), 'text SBWidth inverse');
near(firstStart(textLine.eventLayers[0].alphaEvents), 255, 'text transparency inverse');
assert.deepEqual(textLine.extended.colorEvents[0]?.start, [255, 255, 255], 'text color inverse');

const pictureLine = lines[2];
assert.equal(pictureLine['x-milthm']?.storyboardKind, 'picture');
assert.equal(pictureLine.Texture, 'tex.png', 'picture texture uses the image basename');
assert.equal(pictureLine['x-milthm']?.storyboardLayer, 2, 'layer kept for export');
near(firstStart(pictureLine.eventLayers[0].moveXEvents), -200 * SCALE, 'picture PositionX inverse');
near(firstStart(pictureLine.extended.scaleXEvents), 2 * SCALE, 'picture SBWidth inverse');
assert.equal((chart['x-milthm']?.storyboards ?? []).length, 1, 'only the mesh storyboard is stashed');
console.log('[import] storyboards -> special lines ok');

// ---- 2) export: special lines become storyboards again, layer preserved ----
const ensured = ensureChartColumns(chart) ?? chart;
const synced = syncMilthmColumns(ensured);
const exported = exportMilthmChart(synced, {});
const storyboards = exported.chart.storyboards ?? [];
assert.equal(storyboards.length, 3, 'mesh + text + picture storyboards');
const textStoryboard = storyboards.find(storyboard => Number(storyboard.type) === 1);
const pictureStoryboard = storyboards.find(storyboard => Number(storyboard.type) === 0);
const meshStoryboard = storyboards.find(storyboard => Number(storyboard.type) === 2);
assert.ok(textStoryboard && pictureStoryboard && meshStoryboard, 'all storyboard kinds present');
assert.equal(textStoryboard.data, 'HELLO');
assert.equal(Number(textStoryboard.layer), 0, 'text storyboard layer preserved');
assert.equal(pictureStoryboard.data, 'tex.png');
assert.equal(Number(pictureStoryboard.layer), 2, 'picture storyboard layer preserved');
const positionX = (textStoryboard.animations ?? []).find(animation => Number(animation.type) === 0);
near(Number(positionX.start), 100, 'exported text PositionX returned');
const picturePosition = (pictureStoryboard.animations ?? []).find(animation => Number(animation.type) === 0);
near(Number(picturePosition.start), -200, 'exported picture PositionX returned');
console.log('[export] special lines -> storyboards ok');

console.log('=== STORYBOARD IMPORT TESTS PASSED ===');
