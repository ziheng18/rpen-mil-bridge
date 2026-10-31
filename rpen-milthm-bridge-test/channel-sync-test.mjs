// Offline test: Milthm channel edits (线体/线头/整体不透明度 + 流速倍率) reach the semantic lists,
// the preview and the export.
// - Speed(12)-primary line: FlowSpeed(5) lives in channels.flowSpeed -> semantics.flowRaw
// - FlowSpeed(5)-primary line: line flow lives in semantics.flowSpeed (RPE-scaled) / speed carrier
// - non-primary alpha channels (body/head/whole) live in channels.* -> semantics.*
import assert from 'node:assert';
import { importMilthmChart, exportMilthmChart, MIL_ANIM } from '../rpen-milthm-bridge/convert.mjs';
import {
  ensureChartColumns, syncMilthmColumns, buildMilthmExportChart, semanticEvents,
} from '../rpen-milthm-bridge/columns.mjs';

const near = (actual, expected, label) => assert.ok(Math.abs(Number(actual) - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
const animation = (type, start, end, bearer = 0) => ({ type, startTime: [0, 0, 1], endTime: [16, 0, 1], start, end, bearer_type: 0, bearer, ease });
const SPEED_SCALE = 1.1671875;
const source = {
  fmt: 2,
  meta: { background_dim: 0.6, name: 'channel sync', background_artist: '', music_artist: '', charter: '', difficulty_name: '', difficulty: 0, offset: 0 },
  bpms: [{ time: [0, 0, 1], bpm: 120 }],
  lines: [
    { index: 0, notes: [], animations: [animation(12, 1, 1), animation(5, 8, 8)] }, // Speed(12) primary + line FlowSpeed(5)
    { index: 1, notes: [], animations: [animation(5, 8, 8, 1)] }, // FlowSpeed(5) primary
    { index: 2, notes: [], animations: [animation(2, 1, 1, 2), animation(8, 1, 1, 2)] }, // Transparency(2) primary + LineBody(8) channel
  ],
  storyboards: [],
};
const { chart } = importMilthmChart(source, {});
const ensured = ensureChartColumns(chart) ?? chart;
const synced = syncMilthmColumns(ensured);
const [line0, line1, line2] = synced.judgeLineList;

// baseline semantics
assert.deepEqual(semanticEvents(line0).flowRaw.map(event => [Number(event.start), Number(event.end)]), [[8, 8]], 'Speed-primary line keeps the raw FlowSpeed(5) in flowRaw');
near(semanticEvents(line1).flowSpeed[0]?.start, 8 * SPEED_SCALE, 'FlowSpeed-primary line stores the RPE-scaled flow');
near(semanticEvents(line2).bodyAlpha[0]?.start, 1, 'LineBody(8) channel becomes bodyAlpha semantics');

// simulate editing the Milthm channel panel
const edited = structuredClone(synced);
edited.judgeLineList[0]['x-milthm'].channels.flowSpeed = [{ type: 5, startTime: [0, 0, 1], endTime: [16, 0, 1], start: 4, end: 4, ease }];
edited.judgeLineList[2]['x-milthm'].channels.bodyAlpha = [{ type: 8, startTime: [0, 0, 1], endTime: [16, 0, 1], start: 0.25, end: 0.25, ease }];
const adopted = syncMilthmColumns(edited);
const [adopted0, , adopted2] = adopted.judgeLineList;
assert.deepEqual(semanticEvents(adopted0).flowRaw.map(event => [Number(event.start), Number(event.end)]), [[4, 4]], 'edited line FlowSpeed(5) adopted into flowRaw');
assert.deepEqual(adopted0['x-milthm'].channels.flowSpeed.map(event => [Number(event.start), Number(event.end)]), [[4, 4]], 'channel store mirrored from semantics');
const adoptedBody = semanticEvents(adopted2).bodyAlpha.filter(event => !event.syntheticInit);
assert.ok(adoptedBody.length >= 1, 'bodyAlpha real events kept');
near(adoptedBody[0].start, 0.25, 'edited LineBody(8) channel adopted into bodyAlpha');
console.log('[channel adoption] ok');

// FlowSpeed-primary path: the channel panel writes the semantic list + native speed carrier
const allEdited = structuredClone(edited);
const scaled = 4 * SPEED_SCALE;
allEdited.judgeLineList[1]['x-milthm'].events.flowSpeed = [{ startTime: [0, 0, 1], endTime: [16, 0, 1], start: scaled, end: scaled, easingType: 1, easingLeft: 0, easingRight: 1 }];
allEdited.judgeLineList[1].eventLayers[0].speedEvents = [{ startTime: [0, 0, 1], endTime: [16, 0, 1], start: scaled, end: scaled, easingType: 1, easingLeft: 0, easingRight: 1 }];
const flowAdopted = syncMilthmColumns(allEdited);
near(semanticEvents(flowAdopted.judgeLineList[1]).flowSpeed[0]?.start, scaled, 'FlowSpeed-primary edited value adopted');
assert.deepEqual(semanticEvents(flowAdopted.judgeLineList[1]).flowSpeed.map(event => [Number(event.start)]), [[scaled]], 'no stale carrier copied back');
console.log('[flowSpeed primary] ok');

// multi-line semantic pseudo column flowSpeed: Speed-primary edits flowRaw, FlowSpeed-primary
// edits the semantic list (both then reach preview/export)
const pseudoEdited = structuredClone(synced);
const pseudoFlowX = 5;
const pseudoFlowY = 3 * SPEED_SCALE;
pseudoEdited.judgeLineList[0].extended = pseudoEdited.judgeLineList[0].extended ?? {};
pseudoEdited.judgeLineList[0].extended['milthmCol_flowSpeed'] = [{ startTime: [0, 0, 1], endTime: [16, 0, 1], start: pseudoFlowX, end: pseudoFlowX, easingType: 1, easingLeft: 0, easingRight: 1 }];
pseudoEdited.judgeLineList[1].extended = pseudoEdited.judgeLineList[1].extended ?? {};
pseudoEdited.judgeLineList[1].extended['milthmCol_flowSpeed'] = [{ startTime: [0, 0, 1], endTime: [16, 0, 1], start: pseudoFlowY, end: pseudoFlowY, easingType: 1, easingLeft: 0, easingRight: 1 }];
const pseudoAdopted = syncMilthmColumns(pseudoEdited);
assert.deepEqual(semanticEvents(pseudoAdopted.judgeLineList[0]).flowRaw.map(event => [Number(event.start), Number(event.end)]), [[pseudoFlowX, pseudoFlowX]], 'Speed-primary pseudo flowSpeed column writes flowRaw');
assert.deepEqual(semanticEvents(pseudoAdopted.judgeLineList[1]).flowSpeed.map(event => [Number(event.start), Number(event.end)]), [[pseudoFlowY, pseudoFlowY]], 'FlowSpeed-primary pseudo flowSpeed column writes the semantic list');
console.log('[pseudo flowSpeed column] ok');

// export: both channel edits and the FlowSpeed-primary edit reach the Milthm animations
const exported = exportMilthmChart(buildMilthmExportChart(flowAdopted), {}).chart;
const animationsOf = index => exported.lines.find(line => Number(line.index) === index)?.animations ?? [];
const flow5 = animationsOf(0).filter(item => Number(item.type) === MIL_ANIM.FLOW_SPEED);
assert.ok(flow5.length >= 1, 'Speed-primary line exports FlowSpeed(5)');
near(Number(flow5[0].start), 4, 'exported FlowSpeed(5) value follows the channel edit');
const flow1 = animationsOf(1).filter(item => Number(item.type) === MIL_ANIM.FLOW_SPEED);
assert.ok(flow1.length >= 1, 'FlowSpeed-primary line exports FlowSpeed(5)');
near(Number(flow1[0].start), 4, 'exported FlowSpeed(5) value follows the semantic edit');
const body = animationsOf(2).filter(item => Number(item.type) === MIL_ANIM.LINE_BODY_TRANSPARENCY);
assert.ok(body.length >= 1, 'LineBody(8) animation exported');
near(Number(body[0].start), 0.25, 'exported LineBody(8) value follows the channel edit');
console.log('[export] ok');

console.log('=== CHANNEL SYNC TESTS PASSED ===');
