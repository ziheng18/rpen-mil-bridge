// Conversion between the Milthm fan-chart format (fmt=2) and the RPE chart model used by RPEN.
//
// Design notes
// - Milthm is track based: every Milthm "line" is one track; notes live on the track centre,
//   therefore imported RPEN notes are locked to positionX = 0 (the lane lock is enforced again
//   on every commit).  Notes of one track never need different X coordinates.
// - Data that RPE cannot model (storyboards, FlowSpeed/line-body/visible-area anims, note level
//   animations, isAlwaysPerfect, expressions...) is stashed in namespaced `x-milthm` fields so
//   that export can re-emit it unchanged.
// - Every converted event keeps a value snapshot.  On export, hand-edited events are
//   inverse-transformed; untouched events are written back bit-exactly from the stash.
//
// This module is pure (no DOM / editor access) and unit-testable in Node.

export const MIL_ANIM = {
  POSITION_X: 0, POSITION_Y: 1, TRANSPARENCY: 2, SIZE: 3, ROTATION: 4, FLOW_SPEED: 5,
  RELATIVE_X: 6, RELATIVE_Y: 7, LINE_BODY_TRANSPARENCY: 8, LINE_HEAD_TRANSPARENCY: 9,
  STORYBOARD_WIDTH: 10, STORYBOARD_HEIGHT: 11, SPEED: 12, WHOLE_TRANSPARENCY: 13,
  COLOR: 22, VISIBLE_AREA: 23,
};
export const MIL_BEARER = { LINE: 0, NOTE: 1, STORYBOARD: 2 };
export const MIL_NOTE = { HIT: 0, DRAG: 1 };

export const beatOf = time => Array.isArray(time)
  ? Number(time[0]) + Number(time[1]) / Number(time[2])
  : Number(time);
const clone = value => value === undefined ? value : structuredClone(value);
const timeEq = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === 3 && b.length === 3 && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const isNum = value => typeof value === 'number' && Number.isFinite(value);
const numEq = (a, b) => Math.abs(Number(a) - Number(b)) <= 1e-9;
const valueEq = (a, b) => Array.isArray(a) && Array.isArray(b)
  ? a.length === b.length && a.every((value, index) => numEq(value, b[index]))
  : numEq(a, b);

/* ------------------------------------------------------------------ *
 * Easing: Milthm ease {type: 0 In / 1 Out / 2 InOut, press: 0..10}
 *         RPE easingType 1..29  (official RPE table)
 * ------------------------------------------------------------------ */
const MIL_TO_RPE_EASE = {
  '0,0': 1, '1,0': 1, '2,0': 1,
  '0,1': 3, '1,1': 2, '2,1': 6,
  '0,2': 5, '1,2': 4, '2,2': 7,
  '0,3': 9, '1,3': 8, '2,3': 12,
  '0,4': 11, '1,4': 10, '2,4': 13,
  '0,5': 15, '1,5': 14, '2,5': 13,  // InOutQuint: RPE lacks it -> nearest
  '0,6': 17, '1,6': 16, '2,6': 12,  // InOutExpo : RPE lacks it -> nearest
  '0,7': 19, '1,7': 18, '2,7': 22,
  '0,8': 21, '1,8': 20, '2,8': 23,
  '0,9': 25, '1,9': 24, '2,9': 29,
  '0,10': 27, '1,10': 26, '2,10': 28,
};
const RPE_TO_MIL_EASE = {
  1: [0, 0], 2: [1, 1], 3: [0, 1], 4: [1, 2], 5: [0, 2], 6: [2, 1], 7: [2, 2],
  8: [1, 3], 9: [0, 3], 10: [1, 4], 11: [0, 4], 12: [2, 3], 13: [2, 4],
  14: [1, 5], 15: [0, 5], 16: [1, 6], 17: [0, 6], 18: [1, 7], 19: [0, 7],
  20: [1, 8], 21: [0, 8], 22: [2, 7], 23: [2, 8], 24: [1, 9], 25: [0, 9],
  26: [1, 10], 27: [0, 10], 28: [2, 10], 29: [2, 9],
};
export function milEaseToRpe(ease) {
  const key = `${Number(ease?.type ?? 0)},${Number(ease?.press ?? 0)}`;
  return MIL_TO_RPE_EASE[key] ?? 1;
}
export function rpeEaseToMil(easingType) {
  const pair = RPE_TO_MIL_EASE[Number(easingType) || 1] ?? [0, 0];
  return { type: pair[0], press: pair[1] };
}

/* ------------------------------------------------------------------ *
 * Settings / coordinate transform
 * ------------------------------------------------------------------ */
export function normalizeSettings(settings = {}) {
  return {
    scale: isNum(settings['coord-scale']) ? settings['coord-scale'] : 0.703125,
    flipY: settings['flip-y'] === true,
    offsetX: isNum(settings['offset-x']) ? settings['offset-x'] : 0,
    offsetY: isNum(settings['offset-y']) ? settings['offset-y'] : 0,
    rotationOffset: isNum(settings['rotation-offset']) ? settings['rotation-offset'] : 90,
    speedScale: isNum(settings['speed-scale']) ? settings['speed-scale'] : 1.1671875,
    laneLock: settings['lane-lock'] !== false,
    keepExtra: settings['keep-extra'] !== false,
  };
}

function makeTransform(settings) {
  const cfg = normalizeSettings(settings);
  const toRpeX = x => (Number(x) - cfg.offsetX) * cfg.scale;
  const fromRpeX = x => Number(x) / cfg.scale + cfg.offsetX;
  const toRpeY = y => (cfg.flipY ? -1 : 1) * (Number(y) - cfg.offsetY) * cfg.scale;
  const fromRpeY = y => (cfg.flipY ? -1 : 1) * (Number(y) / cfg.scale) + cfg.offsetY;
  // Milthm: visual angle = (90 - rotation) CCW; RPEN positive rotation is clockwise on screen.
  // A = 90 - th  (th = 90 -> A = 0, th = 0 -> A = 90, th = 180 -> A = -90)
  const rotationSign = flip => flip ? 1 : -1;
  const toRpeRot = r => rotationSign(cfg.flipY) * Number(r) + cfg.rotationOffset;
  const fromRpeRot = r => rotationSign(cfg.flipY) * (Number(r) - cfg.rotationOffset);
  const toRpeAlpha = a => Math.round(Math.max(0, Math.min(1, Number(a))) * 255);
  const fromRpeAlpha = a => Math.max(0, Math.min(1, Number(a) / 255));
  const toRpeSpeed = s => Number(s) * cfg.speedScale;
  const fromRpeSpeed = s => Number(s) / cfg.speedScale;
  const toRpeColor = value => {
    // Milthm packs colors as (r << 24) | (g << 16) | (b << 8) | a  (ColorUtils.ToRGBA)
    const n = Number(value) >>> 0;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255];
  };
  const fromRpeColor = color => {
    const [r, g, b] = Array.isArray(color) ? color : [255, 255, 255];
    const clamp = v => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
    return ((clamp(r) << 24) | (clamp(g) << 16) | (clamp(b) << 8) | 255) >>> 0;
  };
  return { cfg, toRpeX, fromRpeX, toRpeY, fromRpeY, toRpeRot, fromRpeRot, toRpeAlpha, fromRpeAlpha, toRpeSpeed, fromRpeSpeed, toRpeColor, fromRpeColor };
}

/* ------------------------------------------------------------------ *
 * Event helpers
 * ------------------------------------------------------------------ */
const easeSnapshot = raw => ({
  type: Number(raw?.ease?.type ?? 0), press: Number(raw?.ease?.press ?? 0),
  isValueExp: Boolean(raw?.ease?.isValueExp), cusValueExp: String(raw?.ease?.cusValueExp ?? ''),
  clipLeft: Number(raw?.ease?.clipLeft ?? 0), clipRight: Number(raw?.ease?.clipRight ?? 1),
});
const rawAnimationSnapshot = raw => ({
  type: Number(raw.type),
  start: clone(raw.start), end: clone(raw.end),
  startTime: clone(raw.startTime), endTime: clone(raw.endTime),
  ease: easeSnapshot(raw),
});

function rpeEventFromMil(raw, transformedStart, transformedEnd) {
  const inst = timeEq(raw.startTime, raw.endTime);
  const event = {
    startTime: clone(raw.startTime),
    endTime: clone(raw.endTime),
    start: transformedStart,
    end: transformedEnd,
    easingType: milEaseToRpe(raw.ease),
    easingLeft: Number(raw.ease?.clipLeft ?? 0),
    easingRight: Number(raw.ease?.clipRight ?? 1),
    bezier: 0,
    bezierPoints: [0, 0, 1, 1],
    linkgroup: 0,
    ...(inst ? { inst: 1 } : {}),
    'x-milthm': {
      raw: rawAnimationSnapshot(raw),
      mapped: {
        start: transformedStart, end: transformedEnd,
        startTime: clone(raw.startTime), endTime: clone(raw.endTime),
        easingType: milEaseToRpe(raw.ease),
        easingLeft: Number(raw.ease?.clipLeft ?? 0),
        easingRight: Number(raw.ease?.clipRight ?? 1),
      },
    },
  };
  return event;
}

function syntheticEvent(beat, value) {
  return {
    startTime: clone(beat), endTime: clone(beat), start: value, end: value,
    easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1],
    linkgroup: 0, inst: 1,
    'x-milthm': {
      synthetic: true,
      mapped: { start: value, end: value, startTime: clone(beat), endTime: clone(beat), easingType: 1, easingLeft: 0, easingRight: 1 },
    },
  };
}

function eventMatchesSnapshot(event, snapshot) {
  if (!snapshot) return false;
  if (!timeEq(event?.startTime, snapshot.startTime) || !timeEq(event?.endTime, snapshot.endTime)) return false;
  if (!valueEq(event?.start, snapshot.start) || !valueEq(event?.end, snapshot.end)) return false;
  if (Number(event?.easingType ?? 1) !== Number(snapshot.easingType ?? 1)) return false;
  if (!numEq(event?.easingLeft ?? 0, snapshot.easingLeft ?? 0)) return false;
  if (!numEq(event?.easingRight ?? 1, snapshot.easingRight ?? 1)) return false;
  return true;
}

const MIL_ALPHA_SOURCES = [MIL_ANIM.TRANSPARENCY, MIL_ANIM.LINE_BODY_TRANSPARENCY, MIL_ANIM.WHOLE_TRANSPARENCY];
const MIL_SPEED_SOURCES = [MIL_ANIM.SPEED, MIL_ANIM.FLOW_SPEED];

/* ------------------------------------------------------------------ *
 * Import: Milthm fmt=2 -> RPE chart
 * ------------------------------------------------------------------ */
export function importMilthmChart(source, settings = {}) {
  if (!source || typeof source !== 'object') throw new Error('Milthm 谱面不是对象');
  if (!Array.isArray(source.lines)) throw new Error('Milthm 谱面缺少 lines');
  const fmt = Number(source.fmt);
  if (fmt !== 2) throw new Error(`本原型只支持 Milthm fmt=2（当前 fmt=${source.fmt}）`);
  const tr = makeTransform(settings);
  const warnings = [];
  const meta = source.meta && typeof source.meta === 'object' ? source.meta : {};
  const importedOffsetMs = Number.isFinite(Number(meta.offset)) ? Number(meta.offset) * 1000 : 0;
  const chartMeta = {
    RPEVersion: 240,
    name: typeof meta.name === 'string' ? meta.name : '',
    composer: typeof meta.music_artist === 'string' ? meta.music_artist : '',
    charter: typeof meta.charter === 'string' ? meta.charter : '',
    illustration: typeof meta.background_artist === 'string' ? meta.background_artist : '',
    level: typeof meta.difficulty_name === 'string' && meta.difficulty_name
      ? `${meta.difficulty_name}${Number.isFinite(Number(meta.difficulty)) ? ' ' + meta.difficulty : ''}`
      : String(meta.difficulty ?? ''),
    offset: importedOffsetMs,
  };

  const bpms = (Array.isArray(source.bpms) ? source.bpms : [])
    .map(entry => ({ bpm: Number(entry.bpm), startTime: clone(entry.time) }))
    .filter(entry => Number.isFinite(entry.bpm));
  if (!bpms.length) bpms.push({ bpm: 120, startTime: [0, 0, 1] });

  const rawStoryboards = Array.isArray(source.storyboards) ? clone(source.storyboards) : [];
  const lineArray = [...source.lines].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));

  const lines = lineArray.map((sourceLine, position) => {
    const sourceIndex = Number(sourceLine.index ?? position);
    const rawAnimations = Array.isArray(sourceLine.animations) ? sourceLine.animations : [];
    const rawNotes = Array.isArray(sourceLine.notes) ? sourceLine.notes : [];

    const lineAnims = [];
    const noteAnims = new Map();
    const strayAnims = [];
    for (const raw of rawAnimations) {
      const bearerType = Number(raw.bearer_type ?? MIL_BEARER.LINE);
      const bearer = Number(raw.bearer ?? sourceIndex);
      if (bearerType === MIL_BEARER.LINE && bearer === sourceIndex) lineAnims.push(raw);
      else if (bearerType === MIL_BEARER.NOTE) {
        const list = noteAnims.get(bearer) ?? [];
        list.push(raw);
        noteAnims.set(bearer, list);
      } else strayAnims.push(raw);
    }
    const noteAnimCount = [...noteAnims.values()].reduce((sum, list) => sum + list.length, 0);
    if (noteAnimCount) warnings.push(`轨道 ${sourceIndex}：${noteAnimCount} 条音符级动画（bearer_type=1）无法在 RPEN 预览/编辑，已暂存（导出时还原）`);
    if (strayAnims.length) warnings.push(`轨道 ${sourceIndex}：${strayAnims.length} 条非本线动画已原样暂存（导出时还原）`);

    const byType = new Map();
    for (const raw of lineAnims) {
      const type = Number(raw.type);
      const list = byType.get(type) ?? [];
      list.push(raw);
      byType.set(type, list);
    }
    const primaryAlphaType = MIL_ALPHA_SOURCES.find(type => byType.has(type));
    const primarySpeedType = MIL_SPEED_SOURCES.find(type => byType.has(type));

    const tracks = { moveXEvents: [], moveYEvents: [], rotateEvents: [], alphaEvents: [], speedEvents: [] };
    const extended = { scaleXEvents: [], scaleYEvents: [], colorEvents: [] };
    const rawExtras = [];
    // Milthm-only line channels that have no RPE event track; they stay editable via the mod panel
    const channels = { bodyAlpha: [], headAlpha: [], wholeAlpha: [], flowSpeed: [] };
    for (const raw of lineAnims) {
      const type = Number(raw.type);
      if (type === MIL_ANIM.POSITION_X) {
        tracks.moveXEvents.push(rpeEventFromMil(raw, tr.toRpeX(raw.start), tr.toRpeX(raw.end)));
      } else if (type === MIL_ANIM.POSITION_Y) {
        tracks.moveYEvents.push(rpeEventFromMil(raw, tr.toRpeY(raw.start), tr.toRpeY(raw.end)));
      } else if (type === MIL_ANIM.ROTATION) {
        tracks.rotateEvents.push(rpeEventFromMil(raw, tr.toRpeRot(raw.start), tr.toRpeRot(raw.end)));
      } else if (type === primaryAlphaType) {
        tracks.alphaEvents.push(rpeEventFromMil(raw, tr.toRpeAlpha(raw.start), tr.toRpeAlpha(raw.end)));
      } else if (type === primarySpeedType) {
        tracks.speedEvents.push(rpeEventFromMil(raw, tr.toRpeSpeed(raw.start), tr.toRpeSpeed(raw.end)));
      } else if (type === MIL_ANIM.SIZE) {
        extended.scaleXEvents.push(rpeEventFromMil(raw, Number(raw.start), Number(raw.end)));
        extended.scaleYEvents.push(rpeEventFromMil(raw, Number(raw.start), Number(raw.end)));
      } else if (type === MIL_ANIM.COLOR) {
        extended.colorEvents.push(rpeEventFromMil(raw, tr.toRpeColor(raw.start), tr.toRpeColor(raw.end)));
      } else if (type === MIL_ANIM.LINE_BODY_TRANSPARENCY) {
        channels.bodyAlpha.push(clone(raw));
      } else if (type === MIL_ANIM.LINE_HEAD_TRANSPARENCY) {
        channels.headAlpha.push(clone(raw));
      } else if (type === MIL_ANIM.WHOLE_TRANSPARENCY) {
        channels.wholeAlpha.push(clone(raw));
      } else if (type === MIL_ANIM.FLOW_SPEED) {
        channels.flowSpeed.push(clone(raw));
      } else {
        rawExtras.push(clone(raw));
      }
    }

    // Baseline helpers so the RPEN preview starts from Milthm defaults.
    const beat0 = [0, 0, 1];
    if (!tracks.moveXEvents.length) tracks.moveXEvents.push(syntheticEvent(beat0, 0));
    if (!tracks.moveYEvents.length) tracks.moveYEvents.push(syntheticEvent(beat0, tr.toRpeY(-350)));
    if (!tracks.rotateEvents.length) tracks.rotateEvents.push(syntheticEvent(beat0, tr.toRpeRot(90)));
    if (!tracks.alphaEvents.length) tracks.alphaEvents.push(syntheticEvent(beat0, 255));
    if (!tracks.speedEvents.length) tracks.speedEvents.push(syntheticEvent(beat0, tr.toRpeSpeed(1)));
    for (const list of Object.values(tracks)) list.sort((a, b) => beatOf(a.startTime) - beatOf(b.startTime));

    const notes = rawNotes.map(rawNote => {
      const time = clone(rawNote.time ?? [0, 0, 1]);
      const endTime = clone(rawNote.endTime ?? time);
      const isHold = beatOf(endTime) > beatOf(time);
      const sourceType = Number(rawNote.type ?? 0);
      let type;
      if (sourceType === MIL_NOTE.HIT) type = isHold ? 2 : 1;
      else if (sourceType === MIL_NOTE.DRAG) type = 4;
      else { type = 1; warnings.push(`未知 Milthm 音符类型 ${sourceType}，按 Tap 处理`); }
      const note = {
        type, startTime: time, endTime,
        positionX: 0, above: 1, isFake: rawNote.isFake ? 1 : 0,
        speed: 1, size: 1, yOffset: 0, visibleTime: 999999, alpha: 255,
      };
      const stash = {};
      if (rawNote.isAlwaysPerfect) stash.isAlwaysPerfect = true;
      const animations = noteAnims.get(Number(rawNote.index ?? -1));
      if (animations?.length) stash.animations = clone(animations);
      if (Object.keys(stash).length) note['x-milthm'] = stash;
      return note;
    });
    if (noteAnims.size) {
      const known = new Set(rawNotes.map(note => Number(note.index ?? -1)));
      for (const [bearer, animations] of noteAnims) {
        if (!known.has(bearer)) rawExtras.push(...clone(animations));
      }
    }

    const line = {
      Group: 0, Name: `Track ${sourceIndex}`, Texture: 'line.png',
      anchor: [0.5, 0.5], bpmfactor: 1, father: -1, rotateWithFather: true,
      isCover: 1, isGif: false, zOrder: sourceIndex,
      eventLayers: [tracks], extended, notes, numOfNotes: notes.length,
    };
    const hasChannels = Object.values(channels).some(list => list.length > 0);
    if (rawExtras.length || hasChannels || primaryAlphaType !== MIL_ANIM.TRANSPARENCY || primarySpeedType !== MIL_ANIM.SPEED) {
      line['x-milthm'] = { sourceIndex, rawExtras, channels, primaryAlphaType, primarySpeedType };
    }
    return line;
  });

  if (rawStoryboards.length) warnings.push(`${rawStoryboards.length} 个 Milthm 立绘（storyboard）无法在 RPEN 预览/编辑，已暂存（导出时原样还原）`);

  const chart = {
    META: chartMeta,
    judgeLineGroup: ['Default'],
    BPMList: bpms,
    judgeLineList: lines,
    'x-milthm': {
      kind: 'milthm-fmt2',
      version: 1,
      fmt,
      meta: clone(meta),
      importedOffsetMs,
      storyboards: rawStoryboards,
    },
  };
  return { chart, warnings };
}

/* ------------------------------------------------------------------ *
 * Export: RPE chart -> Milthm fmt=2
 * ------------------------------------------------------------------ */
export function exportMilthmChart(chart, settings = {}) {
  if (!chart || typeof chart !== 'object') throw new Error('没有可导出的谱面');
  const tr = makeTransform(settings);
  const warnings = [];
  const root = chart['x-milthm'] && typeof chart['x-milthm'] === 'object' ? chart['x-milthm'] : {};
  const sourceMeta = root.meta && typeof root.meta === 'object' ? root.meta : {};
  const sourceOffset = Number.isFinite(Number(sourceMeta.offset)) ? Number(sourceMeta.offset) : 0;
  const offsetUnchanged = Number.isFinite(Number(root.importedOffsetMs))
    ? numEq(chart.META?.offset ?? 0, root.importedOffsetMs)
    : false;
  const meta = {
    background_dim: Number.isFinite(Number(sourceMeta.background_dim)) ? Number(sourceMeta.background_dim) : 0.6,
    name: String(chart.META?.name ?? sourceMeta.name ?? ''),
    background_artist: String(chart.META?.illustration ?? sourceMeta.background_artist ?? ''),
    music_artist: String(chart.META?.composer ?? sourceMeta.music_artist ?? ''),
    charter: String(chart.META?.charter ?? sourceMeta.charter ?? ''),
    difficulty_name: String(sourceMeta.difficulty_name ?? chart.META?.level ?? ''),
    difficulty: Number.isFinite(Number(sourceMeta.difficulty)) ? Number(sourceMeta.difficulty) : (Number(chart.META?.level) || 0),
    offset: offsetUnchanged ? sourceOffset : Number(chart.META?.offset ?? 0) / 1000,
  };
  const bpms = (Array.isArray(chart.BPMList) ? chart.BPMList : [])
    .map(entry => ({ time: clone(entry.startTime), bpm: Number(entry.bpm) }))
    .filter(entry => Number.isFinite(entry.bpm));
  if (!bpms.length) bpms.push({ time: [0, 0, 1], bpm: 120 });

  let animationIndex = 0;
  let noteIndex = 0;
  const nextIndex = obj => ({ ...obj, index: animationIndex++ });

  const rawToMil = (raw, bearerType, bearer) => nextIndex({
    startTime: clone(raw.startTime), endTime: clone(raw.endTime),
    type: Number(raw.type), start: clone(raw.start), end: clone(raw.end),
    bearer_type: Number(raw.bearer_type ?? bearerType), bearer: Number(raw.bearer ?? bearer),
    ease: clone(raw.ease),
  });

  const convertEvent = (event, milType, sourceType, mapper, bearer) => {
    const stash = event?.['x-milthm'];
    // untouched imported event -> write original Milthm values back
    if (stash?.raw && Number(stash.raw.type) === sourceType && eventMatchesSnapshot(event, stash.mapped)) {
      return rawToMil(stash.raw, MIL_BEARER.LINE, bearer);
    }
    // untouched synthetic baseline -> omit
    if (stash?.synthetic && eventMatchesSnapshot(event, stash.mapped)) return null;
    if (event?.trajectory) warnings.push('RPE 曲线轨迹（trajectory）无法导出为 Milthm 动画，已按关键帧导出');
    if (event?.bezier) warnings.push('RPE 贝塞尔缓动（bezier）无法导出，已降级为最接近的标准缓动');
    const ease = rpeEaseToMil(event?.easingType ?? 1);
    return nextIndex({
      startTime: clone(event.startTime), endTime: clone(event.endTime),
      type: milType, start: mapper(event.start), end: mapper(event.end),
      bearer_type: MIL_BEARER.LINE, bearer,
      ease: {
        type: ease.type, press: ease.press, isValueExp: false, cusValueExp: '',
        clipLeft: Number(event.easingLeft ?? 0), clipRight: Number(event.easingRight ?? 1),
      },
    });
  };

  const lines = [];
  const judgeLineList = Array.isArray(chart.judgeLineList) ? chart.judgeLineList : [];
  for (const [lineIndex, line] of judgeLineList.entries()) {
    const stash = line?.['x-milthm'] ?? {};
    const layers = Array.isArray(line?.eventLayers) && line.eventLayers.length ? line.eventLayers : [{}];
    if (layers.length > 1) warnings.push(`线 ${lineIndex} 有 ${layers.length} 个事件层：Milthm 单轨道无法表达叠加，已平铺导出（语义可能不同）`);
    const extended = line?.extended ?? {};

    const notes = [];
    const noteAnimations = [];
    for (const note of (line?.notes ?? [])) {
      const type = Number(note.type);
      let milType = MIL_NOTE.HIT;
      if (type === 4) milType = MIL_NOTE.DRAG;
      else if (type === 3) warnings.push('RPE Flick 音符在 Milthm 中没有对应类型，已导出为 Hit');
      else if (type !== 1 && type !== 2) { milType = MIL_NOTE.HIT; warnings.push(`未知 RPE 音符类型 ${type}，按 Hit 导出`); }
      if (Math.abs(Number(note.positionX) || 0) > 1e-9) warnings.push('Milthm 是轨道制：音符 X 坐标被忽略（导出到轨道中心）');
      if (Number(note.speed ?? 1) !== 1 || Number(note.size ?? 1) !== 1 || Number(note.alpha ?? 255) !== 255
        || Number(note.yOffset ?? 0) !== 0 || Number(note.visibleTime ?? 999999) !== 999999) {
        warnings.push('Milthm 音符没有 speed/size/alpha/yOffset/visibleTime 字段，这些 RPEN 属性未导出');
      }
      notes.push({
        time: clone(note.startTime), endTime: clone(note.endTime), type: milType,
        isFake: Number(note.isFake) === 1 || note.isFake === true,
        isAlwaysPerfect: Boolean(note['x-milthm']?.isAlwaysPerfect),
        index: noteIndex,
      });
      for (const raw of (note['x-milthm']?.animations ?? [])) noteAnimations.push({ raw, bearer: noteIndex });
      noteIndex += 1;
    }

    const animations = [];
    for (const layer of layers) {
      if (!layer) continue;
      const push = (sourceType, milType, mapper) => {
        for (const event of (layer[sourceType] ?? [])) {
          const converted = convertEvent(event, milType, milType, mapper, lineIndex);
          if (converted) animations.push(converted);
        }
      };
      push('moveXEvents', MIL_ANIM.POSITION_X, tr.fromRpeX);
      push('moveYEvents', MIL_ANIM.POSITION_Y, tr.fromRpeY);
      push('rotateEvents', MIL_ANIM.ROTATION, tr.fromRpeRot);
      // alpha may have been imported from Transparency(2), LineBody(8) or Whole(13)
      const alphaSourceType = [MIL_ANIM.TRANSPARENCY, MIL_ANIM.LINE_BODY_TRANSPARENCY, MIL_ANIM.WHOLE_TRANSPARENCY]
        .includes(Number(stash.primaryAlphaType)) ? Number(stash.primaryAlphaType) : MIL_ANIM.TRANSPARENCY;
      for (const event of (layer.alphaEvents ?? [])) {
        const converted = convertEvent(event, alphaSourceType, alphaSourceType, tr.fromRpeAlpha, lineIndex);
        if (converted) animations.push(converted);
      }
      const speedSourceType = [MIL_ANIM.SPEED, MIL_ANIM.FLOW_SPEED].includes(Number(stash.primarySpeedType))
        ? Number(stash.primarySpeedType) : MIL_ANIM.SPEED;
      for (const event of (layer.speedEvents ?? [])) {
        const converted = convertEvent(event, speedSourceType, speedSourceType, tr.fromRpeSpeed, lineIndex);
        if (converted) animations.push(converted);
      }
      for (const event of (extended.scaleXEvents ?? [])) {
        const converted = convertEvent(event, MIL_ANIM.SIZE, MIL_ANIM.SIZE, value => Number(value), lineIndex);
        if (converted) animations.push(converted);
      }
      for (const event of (extended.colorEvents ?? [])) {
        const converted = convertEvent(event, MIL_ANIM.COLOR, MIL_ANIM.COLOR, tr.fromRpeColor, lineIndex);
        if (converted) animations.push(converted);
      }
      // scaleY cannot be expressed separately in Milthm (single Size track)
      const scaleXs = extended.scaleXEvents ?? [];
      const scaleYs = extended.scaleYEvents ?? [];
      const unpaired = scaleYs.filter(event => !scaleXs.some(other =>
        timeEq(other.startTime, event.startTime) && numEq(other.start, event.start) && numEq(other.end, event.end)));
      if (unpaired.length) warnings.push('RPE scaleX / scaleY 不一致：Milthm 只有一个统一 Size，scaleY 的差异未导出');
      for (const type of ['inclineEvents', 'textEvents', 'gifEvents', 'paintEvents']) {
        if ((extended[type] ?? []).length) warnings.push(`RPEN extended.${type} 在 Milthm 中没有对应动画，未导出`);
      }
    }
    const channels = stash.channels ?? {};
    for (const [key, type] of [['bodyAlpha', MIL_ANIM.LINE_BODY_TRANSPARENCY], ['headAlpha', MIL_ANIM.LINE_HEAD_TRANSPARENCY], ['wholeAlpha', MIL_ANIM.WHOLE_TRANSPARENCY], ['flowSpeed', MIL_ANIM.FLOW_SPEED]]) {
      for (const raw of (channels[key] ?? [])) animations.push(rawToMil({ ...raw, type }, MIL_BEARER.LINE, lineIndex));
    }
    for (const raw of (stash.rawExtras ?? [])) {
      animations.push(rawToMil(raw, MIL_BEARER.LINE, lineIndex));
    }
    for (const { raw, bearer } of noteAnimations) {
      animations.push(rawToMil(raw, MIL_BEARER.NOTE, bearer));
    }
    if (Number(line?.father ?? -1) !== -1) warnings.push('RPEN 父子线（father）在 Milthm 中不存在，已忽略');
    if (Number(line?.bpmfactor ?? 1) !== 1) warnings.push('RPEN 线的 bpmfactor 在 Milthm 中不存在，已忽略');
    if (line?.Texture && line.Texture !== 'line.png') warnings.push('RPEN 线贴图（Texture）在 Milthm 中不存在，已忽略');

    animations.sort((a, b) => beatOf(a.startTime) - beatOf(b.startTime));
    lines.push({ index: lineIndex, notes, animations });
  }

  if ((chart.blockAreaList ?? []).length) warnings.push('RPEN 噪域（blockAreaList）在 Milthm 中不存在，未导出');
  if ((chart.noiseAreaLayers ?? []).length) warnings.push('RPEN 噪域层（noiseAreaLayers）在 Milthm 中不存在，未导出');

  const storyboards = [];
  for (const raw of (root.storyboards ?? [])) {
    const storyboard = clone(raw);
    if (Array.isArray(storyboard.animations)) {
      storyboard.animations = storyboard.animations.map(animation =>
        rawToMil(animation, Number(animation.bearer_type ?? MIL_BEARER.STORYBOARD), Number(animation.bearer ?? storyboard.index ?? 0)));
    }
    storyboards.push(storyboard);
  }

  return {
    chart: { fmt: Number(root.fmt ?? 2), meta, bpms, lines, storyboards },
    warnings: [...new Set(warnings)],
  };
}

/* ------------------------------------------------------------------ *
 * Lane lock: force track based invariants on every committed chart
 * ------------------------------------------------------------------ */
export function normalizeLaneChart(chart, settings = {}) {
  const cfg = normalizeSettings(settings);
  if (!cfg.laneLock || !chart || !Array.isArray(chart.judgeLineList)) return chart;
  let chartChanged = false;
  const judgeLineList = chart.judgeLineList.map(line => {
    if (!line || typeof line !== 'object') return line;
    let lineChanged = false;
    const linePatch = {};
    if (Number(line.bpmfactor ?? 1) !== 1) { linePatch.bpmfactor = 1; lineChanged = true; }
    if (Number(line.father ?? -1) !== -1) { linePatch.father = -1; lineChanged = true; }
    if (line.Texture && line.Texture !== 'line.png') { linePatch.Texture = 'line.png'; lineChanged = true; }
    let notes = line.notes;
    if (Array.isArray(line.notes)) {
      let notesChanged = false;
      notes = line.notes.map(note => {
        if (!note || typeof note !== 'object') return note;
        const patch = {};
        if (Number(note.positionX ?? 0) !== 0) patch.positionX = 0;
        if (Number(note.above ?? 1) !== 1) patch.above = 1;
        const defaults = [['speed', 1], ['size', 1], ['alpha', 255], ['yOffset', 0], ['visibleTime', 999999]];
        for (const [key, value] of defaults) if (Number(note[key] ?? value) !== value) patch[key] = value;
        if (!Object.keys(patch).length) return note;
        notesChanged = true;
        return { ...note, ...patch };
      });
      if (notesChanged) lineChanged = true;
    }
    if (!lineChanged) return line;
    chartChanged = true;
    return { ...line, ...linePatch, ...(notes ? { notes } : {}) };
  });
  return chartChanged ? { ...chart, judgeLineList } : chart;
}





