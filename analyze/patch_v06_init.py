import io

# ---------------- columns.mjs ----------------
path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\columns.mjs'
s = io.open(path, encoding='utf-8').read()

old = """function makeSyntheticAlphaInit(type, startTime) {
  const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
  return { type, startTime: clone(startTime), endTime: clone(startTime), start: 1, end: 1, ease, syntheticInit: true };
}

// Rain Editor initialises missing transparency tracks to fully opaque (1.0). Mirror that
// explicitly at the start beat of the existing transparency events, so RPEN's timeline shows
// the initial 255 and the event multipliers are never left implicit.
function addTransparencyInitializers(semantics) {
  const tracks = [
    { key: 'lineAlpha', type: MIL_ANIM.TRANSPARENCY },
    { key: 'bodyAlpha', type: MIL_ANIM.LINE_BODY_TRANSPARENCY },
    { key: 'headAlpha', type: MIL_ANIM.LINE_HEAD_TRANSPARENCY },
    { key: 'wholeAlpha', type: MIL_ANIM.WHOLE_TRANSPARENCY },
  ];
  const present = tracks.filter(track => (semantics[track.key] ?? []).length > 0);
  if (!present.length) return;
  let earliestBeat = null;
  let earliestTime = null;
  for (const track of present) for (const event of semantics[track.key]) {
    const beat = eventBeat(event.startTime);
    if (earliestBeat === null || beat < earliestBeat) { earliestBeat = beat; earliestTime = event.startTime; }
  }
  const initBeat = earliestTime ?? [0, 0, 1];
  for (const track of tracks) {
    if ((semantics[track.key] ?? []).length) continue;
    semantics[track.key] = [makeSyntheticAlphaInit(track.type, initBeat)];
  }
}"""
new = """function makeSyntheticAlphaInit(type, startTime, endTime, value) {
  const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
  return { type, startTime: clone(startTime), endTime: clone(endTime), start: value, end: value, ease, syntheticInit: true };
}

const plusBeats = (time, amount = 1) => [Number(time?.[0] ?? 0) + amount, Number(time?.[1] ?? 0), Number(time?.[2] ?? 1)];

// Rain Editor resolves missing transparency tracks as fully transparent before the first real
// transparency event (and the first event's start value afterwards). Mirror that explicitly:
//  - start fully transparent (0) until the earliest existing transparency event;
//  - from that beat on, fully opaque (255) so the missing track does not dim the others.
// Events use a non-zero length (like RPEN's createLine) instead of zero-length keyframes.
function addTransparencyInitializers(semantics) {
  // Line visual transparency only; WholeTransparency(13) affects notes and keeps its default.
  const tracks = [
    { key: 'lineAlpha', type: MIL_ANIM.TRANSPARENCY },
    { key: 'bodyAlpha', type: MIL_ANIM.LINE_BODY_TRANSPARENCY },
    { key: 'headAlpha', type: MIL_ANIM.LINE_HEAD_TRANSPARENCY },
  ];
  const present = tracks.filter(track => (semantics[track.key] ?? []).length > 0);
  if (!present.length) return;
  let earliestBeat = null;
  let earliestTime = null;
  for (const track of present) for (const event of semantics[track.key]) {
    const beat = eventBeat(event.startTime);
    if (earliestBeat === null || beat < earliestBeat) { earliestBeat = beat; earliestTime = event.startTime; }
  }
  const switchTime = earliestTime ?? [0, 0, 1];
  for (const track of tracks) {
    if ((semantics[track.key] ?? []).length) continue;
    if ((earliestBeat ?? 0) <= 1e-9) {
      semantics[track.key] = [makeSyntheticAlphaInit(track.type, [0, 0, 1], plusBeats([0, 0, 1], 1), 1)];
    } else {
      semantics[track.key] = [
        makeSyntheticAlphaInit(track.type, [0, 0, 1], clone(switchTime), 0),
        makeSyntheticAlphaInit(track.type, clone(switchTime), plusBeats(switchTime, 1), 1),
      ];
    }
  }
}"""
assert old in s
s = s.replace(old, new, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('columns.mjs transparent-init + non-zero-length patch applied')

# ---------------- main.mjs: RPEN-style new chart ----------------
path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\main.mjs'
s = io.open(path, encoding='utf-8').read()
old = """  const buildMilthmChart = () => {
    const source = {
      fmt: 2,
      meta: { background_dim: 0.6, name: '未命名 Milthm 谱面', background_artist: '', music_artist: '', charter: '', difficulty_name: '', difficulty: 0, offset: 0 },
      bpms: [{ time: [0, 0, 1], bpm: 120 }],
      lines: [{ index: 0, notes: [], animations: [] }],
      storyboards: [],
    };
    const { chart } = importMilthmChart(source, settings());
    return chart;
  };"""
new = """  const buildMilthmChart = () => {
    // Start from RPEN's createChart()/createLine() defaults: one line, one 1-beat-long event
    // per base track (X=0, Y=0, rotation=0, alpha=255, speed=10). No zero-length events.
    const rpeEvent = value => ({ startTime: [0, 0, 1], endTime: [0, 1, 1], start: value, end: value,
      easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 });
    const line = {
      Group: 0, Name: 'Track 0', Texture: 'line.png', anchor: [0.5, 0.5],
      bpmfactor: 1, father: -1, rotateWithFather: true, isCover: 1, isGif: false, zOrder: 0,
      eventLayers: [{
        moveXEvents: [rpeEvent(0)], moveYEvents: [rpeEvent(0)], rotateEvents: [rpeEvent(0)],
        alphaEvents: [rpeEvent(255)], speedEvents: [rpeEvent(10)],
      }],
      extended: {}, notes: [], numOfNotes: 0,
      'x-milthm': {
        sourceIndex: 0, rawExtras: [],
        channels: { bodyAlpha: [], headAlpha: [], wholeAlpha: [], flowSpeed: [] },
        primaryAlphaType: MIL_ANIM.LINE_BODY_TRANSPARENCY,
        primarySpeedType: MIL_ANIM.FLOW_SPEED,
      },
    };
    return {
      META: { RPEVersion: 240, name: '未命名 Milthm 谱面', composer: '', charter: '', illustration: '', level: '', offset: 0 },
      judgeLineGroup: ['Default'],
      BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
      judgeLineList: [line],
      blockAreaList: [],
      'x-milthm': {
        kind: 'milthm-fmt2', version: 1, fmt: 2,
        meta: { background_dim: 0.6, name: '未命名 Milthm 谱面', background_artist: '', music_artist: '', charter: '', difficulty_name: '', difficulty: 0, offset: 0 },
        importedOffsetMs: 0, storyboards: [], columns: DEFAULT_COLUMNS.slice(),
      },
    };
  };"""
assert old in s
s = s.replace(old, new, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('main.mjs RPEN-style new chart patch applied')
