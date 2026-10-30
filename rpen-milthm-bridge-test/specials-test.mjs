// Offline tests: RPEN special lines (text lines / judgement-line textures) -> Milthm storyboards.
import assert from 'node:assert';
import { importMilthmChart, exportMilthmChart, normalizeLaneChart, beatOf, MIL_ANIM } from '../rpen-milthm-bridge/convert.mjs';
import { ensureChartColumns, buildMilthmExportChart, deriveSemantics } from '../rpen-milthm-bridge/columns.mjs';

const rpeEvent = (startBeat, endBeat, start, end) => ({
  startTime: [startBeat, 0, 1], endTime: [endBeat, 0, 1], start, end,
  easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0,
});
const emptySemantics = () => ({
  x: [], y: [], rotate: [], flowSpeed: [], speed: [], flowRaw: [], size: [],
  lineAlpha: [], bodyAlpha: [], headAlpha: [], wholeAlpha: [], legacy: [],
});
const sourceChart = () => ({
  fmt: 2,
  meta: { name: 'specials test', background_dim: 0.6, background_artist: '', music_artist: '', charter: '', difficulty_name: '', difficulty: 0, offset: 0 },
  bpms: [{ time: [0, 0, 1], bpm: 120 }],
  lines: [
    { index: 0, notes: [{ index: 0, time: [0, 4, 1], endTime: [0, 4, 1], type: 0, isFake: false, isAlwaysPerfect: false }], animations: [] },
    { index: 1, notes: [], animations: [] },
    { index: 2, notes: [], animations: [] },
  ],
  storyboards: [],
});
const prepareChart = (mutate = () => {}) => {
  const { chart } = importMilthmChart(sourceChart(), {});
  const ensured = ensureChartColumns(chart) ?? chart;
  mutate(ensured);
  return ensured;
};
const specialsOf = (line) => {
  const semantics = deriveSemantics(line);
  line['x-milthm'].events = semantics;
  return semantics;
};
const findAnimations = (storyboard, type) => (storyboard?.animations ?? []).filter(animation => Number(animation.type) === type);
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(Number(actual) - expected) <= tolerance, `${actual} != ${expected}`);

// ---- 1) text line -> text storyboard(s) ----
{
  const chart = prepareChart(chart => {
    const line = chart.judgeLineList[1];
    const semantics = emptySemantics();
    semantics.x = [rpeEvent(0, 8, 100, 100)];
    semantics.rotate = [rpeEvent(0, 8, 20, 20)];
    semantics.size = [rpeEvent(0, 8, 2, 2)];
    semantics.lineAlpha = [{ type: 2, startTime: [0, 0, 1], endTime: [8, 0, 1], start: 0.5, end: 0.5, ease: { type: 0, press: 0 } }];
    specialsOf(line);
    line['x-milthm'].events = semantics;
    line.extended = {
      ...(line.extended ?? {}),
      scaleXEvents: [rpeEvent(0, 8, 2, 2)],
      scaleYEvents: [rpeEvent(0, 8, 2, 2)],
      colorEvents: [rpeEvent(0, 8, [50, 100, 150], [50, 100, 150])],
      textEvents: [
        { ...rpeEvent(0, 4, 'HELLO', 'HELLO') },
        { ...rpeEvent(4, 8, '', '') },
      ],
    };
  });
  const { chart: exported, warnings } = exportMilthmChart(buildMilthmExportChart(chart), {});
  // the text line is not a Milthm track any more (no notes) -> 2 lines left, renumbered
  assert.equal(exported.lines.length, 2, 'text line must be dropped from Milthm lines');
  assert.deepEqual(exported.lines.map(line => line.index), [0, 1]);
  assert.equal(exported.lines[0].notes.length, 1, 'normal track keeps its note');
  // one text storyboard for the HELLO run
  const textStoryboards = exported.storyboards.filter(storyboard => Number(storyboard.type) === 1);
  assert.equal(textStoryboards.length, 1, `expected 1 text storyboard, got ${textStoryboards.length}`);
  const text = textStoryboards[0];
  assert.equal(text.data, 'HELLO');
  assert.equal(Number(text.layer), 1);
  assert.ok(text.animations.every(animation => Number(animation.bearer_type) === 2 && Number(animation.bearer) === Number(text.index)));
  const positionX = findAnimations(text, MIL_ANIM.POSITION_X);
  assert.equal(positionX.length, 1);
  near(positionX[0].start, 100 / 0.703125);
  const rotation = findAnimations(text, MIL_ANIM.ROTATION);
  assert.equal(rotation.length, 1);
  near(rotation[0].start, 20);
  const widths = findAnimations(text, MIL_ANIM.STORYBOARD_WIDTH);
  assert.equal(widths.length, 1);
  near(widths[0].start, 2 * (52 / 0.703125) / 60.75);
  const colors = findAnimations(text, MIL_ANIM.COLOR);
  assert.equal(colors.length, 1);
  assert.equal(Number(colors[0].start) >>> 0, ((50 << 24) | (100 << 16) | (150 << 8) | 255) >>> 0);
  const transparency = findAnimations(text, MIL_ANIM.TRANSPARENCY);
  const first = transparency.find(animation => beatOf(animation.startTime) === 0);
  assert.ok(first, 'transparency gate must start at beat 0');
  near(first.start, 0.5);
  const gated = transparency.find(animation => beatOf(animation.startTime) === 4);
  assert.ok(gated, 'transparency must be 0 from the run end (beat 4)');
  near(gated.start, 0);
  assert.ok(warnings.some(warning => warning.includes('文字已导出为 1 个文字故事板')), warnings.join('\n'));

  // untouched export stays a 0-diff style pass-through for charts without special lines
  const plain = prepareChart();
  const plainExport = exportMilthmChart(buildMilthmExportChart(plain), {});
  assert.equal(plainExport.chart.storyboards.length, 0);
  assert.equal(plainExport.chart.lines.length, 3);
}

// ---- 2) custom judgement-line texture -> picture storyboard ----
{
  const chart = prepareChart(chart => {
    const line = chart.judgeLineList[2];
    line.Texture = 'texture.png';
    const semantics = emptySemantics();
    semantics.x = [rpeEvent(0, 8, 200, 200)];
    semantics.size = [rpeEvent(0, 8, 3, 3)];
    semantics.lineAlpha = [];
    line['x-milthm'].events = semantics;
    line.extended = {
      ...(line.extended ?? {}),
      scaleXEvents: [rpeEvent(0, 8, 3, 3)],
      scaleYEvents: [rpeEvent(0, 8, 3, 3)],
      colorEvents: [],
    };
  });
  const { chart: exported, warnings } = exportMilthmChart(buildMilthmExportChart(chart), {});
  assert.equal(exported.lines.length, 2);
  const pictures = exported.storyboards.filter(storyboard => Number(storyboard.type) === 0);
  assert.equal(pictures.length, 1, `expected 1 picture storyboard, got ${pictures.length}`);
  const picture = pictures[0];
  assert.equal(picture.data, 'texture.png');
  assert.equal(Number(picture.layer), 1);
  assert.ok(picture.animations.every(animation => Number(animation.bearer_type) === 2));
  const widths = findAnimations(picture, MIL_ANIM.STORYBOARD_WIDTH);
  assert.equal(widths.length, 1);
  near(widths[0].start, 3 / 0.703125);
  const positionX = findAnimations(picture, MIL_ANIM.POSITION_X);
  near(positionX[0].start, 200 / 0.703125);
  assert.ok(warnings.some(warning => warning.includes('图片故事板')));
  // no colour animation when the line has no colour events (default white stays)
  assert.equal(findAnimations(picture, MIL_ANIM.COLOR).length, 0);
}

// ---- 3) special line that still has notes: keep the line, add the storyboard, warn ----
{
  const chart = prepareChart(chart => {
    const line = chart.judgeLineList[0];
    const semantics = deriveSemantics(line);
    line['x-milthm'].events = semantics;
    line.extended = { ...(line.extended ?? {}), textEvents: [{ ...rpeEvent(0, 8, 'NOTE LINE', 'NOTE LINE') }] };
  });
  const { chart: exported, warnings } = exportMilthmChart(buildMilthmExportChart(chart), {});
  assert.equal(exported.lines.length, 3, 'line with notes must stay');
  assert.equal(exported.lines[0].notes.length, 1);
  assert.equal(exported.storyboards.filter(storyboard => Number(storyboard.type) === 1).length, 1);
  assert.ok(warnings.some(warning => warning.includes('带有 1 个音符')), warnings.join('\n'));
}

// ---- 4) lane lock keeps a custom texture only on note-less lines ----
{
  const chart = prepareChart(chart => {
    chart.judgeLineList[0].Texture = 'track.png'; // has a note -> track line
    chart.judgeLineList[1].Texture = 'picture.png'; // no notes -> storyboard line
  });
  const locked = normalizeLaneChart(chart, {});
  assert.equal(locked.judgeLineList[0].Texture, 'line.png', 'track line texture must stay locked to line.png');
  assert.equal(locked.judgeLineList[1].Texture, 'picture.png', 'storyboard line texture must be preserved');
}

console.log('=== SPECIALS TESTS PASSED ===');
