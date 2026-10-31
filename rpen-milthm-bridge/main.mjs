// RPEN mod: Milthm fan-chart (fmt=2) bridge.
// - import: native Open dialog converts fmt=2 charts through the chart:parse hook
// - edit: track-based lane lock; Milthm-only event channels panel; ExNote (isAlwaysPerfect)
// - preview: Milthm-style tracks, note transparency / line size / background dim
// - export: own chart.json / package zip commands incl. synthesized background-dim storyboard
import {
  importMilthmChart, exportMilthmChart, normalizeLaneChart,
  milEaseToRpe, rpeEaseToMil, beatOf, MIL_ANIM, MIL_BEARER,
} from './convert.mjs';
import {
  DEFAULT_COLUMNS, COLUMN_LABELS, COLUMN_LABELS_FULL, SLOT_CANDIDATES, semanticEvents, chartColumns,
  ensureChartColumns, syncMilthmColumns, remapColumns, buildMilthmExportChart, sceneSemanticArrays,
  milthmEventTypeLabels, SEMANTIC_COLUMNS, SEMANTIC_COLUMN_LABELS, semanticColumnKey, semanticColumnKind,
  semanticColumnEvents, composePreviewSpeedEvents,
} from './columns.mjs';

const MOD_ID = 'milthm-fmt2-bridge';
const DIM_TYPE = 'background-dim';
const DIM_TYPE_ID = `${MOD_ID}/${DIM_TYPE}`;
const EASE_PRESS_NAMES = ['线性', 'Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Back', 'Elastic', 'Bounce'];
const EASE_TYPE_NAMES = ['In', 'Out', 'InOut'];
const CHANNEL_DEFS = {
  'line-body-alpha': { label: '线体不透明度', hint: 'Milthm LineBodyTransparency(8)：只影响轨道线身' },
  'line-head-alpha': { label: '线头不透明度', hint: 'Milthm LineHeadTransparency(9)：只影响轨道线头/判定圈（可分开控制）' },
  'line-whole-alpha': { label: '整体不透明度', hint: 'Milthm WholeTransparency(13)：只影响该轨道上的音符' },
  'line-flow-speed': { label: '流速倍率', hint: 'Milthm FlowSpeed(5)：视觉流速倍率' },
  'line-size': { label: '轨道大小', hint: 'Milthm Size(3)：同时作用于线体与音符（对应 RPEN 缩放X/缩放Y，两者保持同步）' },
  'note-alpha': { label: '音符不透明度', hint: 'Milthm 音符级 Transparency(2)：作用于当前选中的音符' },
  'background-dim': { label: '背景明暗（全局事件）', hint: 'Milthm 纯黑立绘的不透明度：0=原图，1=纯黑；用全局事件时间轴编辑' },
};
const CHANNEL_KEYS = { 'line-body-alpha': 'bodyAlpha', 'line-head-alpha': 'headAlpha', 'line-whole-alpha': 'wholeAlpha', 'line-flow-speed': 'flowSpeed' };
const PANEL_STYLE = `
.milthm-panel{position:fixed;right:14px;bottom:14px;z-index:2147483000;width:350px;max-height:calc(100vh - 120px);
  display:flex;flex-direction:column;background:rgba(18,20,28,.94);color:#e8ecf5;border:1px solid rgba(255,255,255,.16);
  border-radius:10px;padding:10px 12px;font:12px/1.5 system-ui,"Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.milthm-panel .m-title{font-weight:600;color:#9ed0ff;margin-bottom:6px}
.milthm-panel .m-row{display:flex;gap:8px;align-items:center;margin:4px 0}
.milthm-panel button{cursor:pointer;border:1px solid rgba(255,255,255,.2);border-radius:6px;background:rgba(255,255,255,.08);
  color:#e8ecf5;padding:4px 8px;font:inherit;white-space:nowrap;flex:1}
.milthm-panel button:hover{background:rgba(120,180,255,.22)}
.milthm-panel select,.milthm-panel input{background:#20242f;color:#e8ecf5;border:1px solid rgba(255,255,255,.2);border-radius:5px;
  padding:1px 4px;font:inherit;min-width:0}
.milthm-panel .m-select{flex:1;width:100%}
.milthm-panel .m-hint{color:#a9b4c7;font-size:11px;white-space:pre-wrap;margin:4px 0}
.milthm-panel .m-list{overflow:auto;max-height:190px;border-top:1px solid rgba(255,255,255,.12);padding-top:4px}
.milthm-panel .m-ev{display:grid;grid-template-columns:1fr 1fr 60px 60px;gap:4px;align-items:center;margin:3px 0}
.milthm-panel .m-ev .m-ease{grid-column:1 / span 4;display:flex;gap:4px;align-items:center}
.milthm-panel .m-ev .m-del{flex:none;padding:1px 6px;color:#ffb3b3}
.milthm-panel .m-status{color:#8f9bb0;font-size:11px;margin-top:4px;white-space:pre-wrap}
.milthm-panel .m-badge{font-size:10px;border:1px solid #4d7fb8;border-radius:4px;padding:0 4px;color:#9ed0ff;margin-left:4px}
.milthm-timeline-select{background:#20242f;color:#e8ecf5;border:1px solid rgba(255,255,255,.2);border-radius:5px;
  padding:1px 4px;font:inherit;font-size:12px;margin-left:6px;max-width:150px}
`;

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
function sanitizeFileName(name, fallback = 'chart') {
  const text = String(name ?? '').replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').trim();
  return text || fallback;
}
const isAudioName = name => /\.(mp3|ogg|oga|wav|flac|m4a|aac|opus|webm|weba|aif|aiff)$/i.test(name);
const isImageName = name => /\.(png|jpe?g|webp|gif|bmp|avif|apng|heic|heif|svg)$/i.test(name);

/** Minimal store-only ZIP writer fallback. */
function makeStoreZip(entries) {
  const encoder = new TextEncoder();
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    return table;
  })();
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true);
    view.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30);
    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dir.set(local.subarray(4, 30), 6);
    dv.setUint32(42, offset, true); dir.set(nameBytes, 46);
    chunks.push(local, bytes); central.push(dir); offset += local.length + bytes.length;
  }
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const trailer = new Uint8Array(22);
  const tv = new DataView(trailer.buffer);
  tv.setUint32(0, 0x06054b50, true); tv.setUint16(8, entries.size, true); tv.setUint16(10, entries.size, true);
  tv.setUint32(12, centralSize, true); tv.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, trailer], { type: 'application/zip' });
}

export async function activate(api) {
  const editor = api.editor;
  const internals = {
    tempo: await api.importInternal('core/tempo.mjs'),
    events: await api.importInternal('core/events.mjs'),
    preview: await api.importInternal('ui/preview.mjs'),
    scene: await api.importInternal('core/scene.mjs'),
    beat: await api.importInternal('core/beat.mjs'),
    archive: await api.importInternal('platform/archive.mjs').catch(() => null),
    files: await api.importInternal('platform/files.mjs').catch(() => null),
    multiEdit: await api.importInternal('application/multi-edit.mjs').catch(() => null),
    multiLine: await api.importInternal('ui/multi-line.mjs').catch(() => null),
  };
  const { TempoMap } = internals.tempo;
  const { EventTrack } = internals.events;
  const { Preview } = internals.preview;
  const { SceneRuntime, LineRuntime } = internals.scene;
  const { formatBeat, parseBeat, fromNumber } = internals.beat;

  let lastWarnings = [];
  const settings = () => {
    const keys = ['coord-scale', 'flip-y', 'offset-x', 'offset-y', 'rotation-offset', 'speed-scale', 'lane-lock', 'keep-extra',
      'preview-tracks', 'preview-dim', 'dim-migrate', 'new-chart-mode', 'renderer-flow-speed', 'editor-font'];
    const result = {};
    for (const key of keys) { try { result[key] = api.settings.get(key); } catch { /* ignore */ } }
    return result;
  };
  // Global flow speed of the renderer (RainPlayerUnity `GameMain.FLOW_SPEED`, default 1.66,
  // settings slider range 0.8..2.4, also settable via ?flowSpeed=). The bridge bakes 1.66 into
  // the default `speed-scale` (1.1671875 = 1.66 × 675/960), so the preview multiplier that makes
  // "same number as the renderer" mean "same falling speed" is value / 1.66.
  const RENDERER_FLOW_SPEED = 1.66;
  const rendererFlowSpeed = () => {
    const value = Number(settings()['renderer-flow-speed']);
    return Number.isFinite(value) && value > 0 ? value : RENDERER_FLOW_SPEED;
  };
  const previewFlowMultiplier = () => rendererFlowSpeed() / RENDERER_FLOW_SPEED;
  const isMilthmChart = chart => chart?.['x-milthm']?.kind === 'milthm-fmt2';
  const reportWarnings = (label, warnings) => {
    const unique = [...new Set(warnings ?? [])];
    if (!unique.length) return;
    api.notify(`${label}：${unique.length} 条提示（详见控制台）`, 'warning');
    for (const warning of unique) api.log(`[${label}] ${warning}`);
  };

  /* ---------------- global event type: background dim ---------------- */
  // Global-events protocol: mod-persistent types should be named "mod name + author" so charts
  // that don't have the mod loaded can still show a meaningful source; the host stamps the source
  // metadata (id/name/author/version) automatically and keeps data after unload.
  const dimTypeName = () => `${api.manifest.name} · ${api.manifest.author}`;
  try {
    api.globalEvents.register({
      id: DIM_TYPE,
      name: dimTypeName(),
      description: 'Milthm 背景明暗（由 Milthm 纯黑立绘 storyboard 实现）：0=背景原样，1=纯黑。',
      persistent: true,
      columns: [{ id: 'dim', name: '明暗', timelineLabel: '明暗', valueType: 'number', defaultValue: 0, min: 0, max: 1, step: 0.01, width: 120 }],
    });
  } catch (error) { api.log('注册背景明暗全局事件失败', error); }

  /* ---------------- Milthm value tracks (preview / export) ---------------- */
  const milCache = new WeakMap();
  const cacheFor = chart => {
    let cache = milCache.get(chart);
    if (cache) return cache;
    const tempo = new TempoMap(chart.BPMList);
    cache = { tempo, lines: new WeakMap(), dim: undefined };
    milCache.set(chart, cache);
    return cache;
  };
  const milEventTrack = (events, tempo, fallback) => new EventTrack(
    (events ?? []).map(event => ({
      startTime: event.startTime, endTime: event.endTime,
      start: Number(event.start), end: Number(event.end),
      easingType: milEaseToRpe(event.ease),
      easingLeft: Number(event.ease?.clipLeft ?? 0), easingRight: Number(event.ease?.clipRight ?? 1),
      bezier: 0, bezierPoints: [0, 0, 1, 1],
    })), tempo, 1, fallback,
  );
  const globalEventTrack = (events, tempo, fallback) => new EventTrack(
    (events ?? []).map(event => ({
      startTime: event.startTime, endTime: event.endTime,
      start: Number(event.start), end: Number(event.end),
      easingType: Number(event.easingType ?? 1),
      easingLeft: Number(event.easingLeft ?? 0), easingRight: Number(event.easingRight ?? 1),
      bezier: 0, bezierPoints: [0, 0, 1, 1],
    })), tempo, 1, fallback,
  );
  const lineTracks = (chart, line) => {
    const cache = cacheFor(chart);
    let tracks = cache.lines.get(line);
    if (tracks) return tracks;
    const semantics = semanticEvents(line);
    tracks = {
      bodyAlpha: milEventTrack(semantics.bodyAlpha, cache.tempo, 1),
      headAlpha: milEventTrack(semantics.headAlpha, cache.tempo, 1),
      wholeAlpha: milEventTrack(semantics.wholeAlpha, cache.tempo, 1),
      noteAlpha: new Map(),
      noteFlow: new Map(),
    };
    cache.lines.set(line, tracks);
    return tracks;
  };
  const noteAlphaTrack = (chart, line, note) => {
    const tracks = lineTracks(chart, line);
    if (tracks.noteAlpha.has(note)) return tracks.noteAlpha.get(note);
    const events = (note?.['x-milthm']?.animations ?? []).filter(animation => Number(animation.type) === MIL_ANIM.TRANSPARENCY);
    const track = events.length ? milEventTrack(events, cacheFor(chart).tempo, 1) : null;
    tracks.noteAlpha.set(note, track);
    return track;
  };
  const noteFlowTrack = (chart, line, note) => {
    const tracks = lineTracks(chart, line);
    if (tracks.noteFlow.has(note)) return tracks.noteFlow.get(note);
    const events = (note?.['x-milthm']?.animations ?? []).filter(animation => Number(animation.type) === MIL_ANIM.FLOW_SPEED);
    const track = events.length ? milEventTrack(events, cacheFor(chart).tempo, 1) : null;
    tracks.noteFlow.set(note, track);
    return track;
  };

  /* ---------------- preview flow speed: Milthm Speed(12) × FlowSpeed(5) ---------------- */
  // RPU: note distance = Speed(12) 积分 × 120 × FLOW_SPEED(1.66) × 线FlowSpeed(5) × 音符FlowSpeed(5) × (675/960).
  // The bridge stores Speed / FlowSpeed as separate tracks; for the preview we bake the product of the
  // line tracks (Speed × 线FlowSpeed) into one speed track so RPEN's SpeedIntegral follows Milthm.
  // Note-level FlowSpeed is applied per note in the noteState patch. Export is untouched.
  // v0.7.12: the composition samples each segment END one epsilon before the boundary; sampling the
  // right value made the segment before any jump ramp towards the post-jump value (see columns.mjs).
  const speedScaleValue = () => {
    const value = Number(settings()['speed-scale']);
    return Number.isFinite(value) && value > 0 ? value : 1.1671875;
  };
  const rawMilExtras = (line, type) => (line?.['x-milthm']?.rawExtras ?? []).filter(event => Number(event?.type) === Number(type));
  const beatNumberOf = time => Number(time?.[0] ?? 0) + Number(time?.[1] ?? 0) / (Number(time?.[2]) || 1);
  const previewTrack = (events, tempo, fallback = 1) => new EventTrack((events ?? []).map(event => ({
    startTime: event.startTime, endTime: event.endTime, start: Number(event.start), end: Number(event.end),
    easingType: Number(event.easingType ?? 1), easingLeft: Number(event.easingLeft ?? 0), easingRight: Number(event.easingRight ?? 1),
    bezier: 0, bezierPoints: [0, 0, 1, 1],
  })), tempo, 1, fallback);
  const speedEventsRpe = (line, semantics) => {
    if (semantics.speed?.length) return semantics.speed;
    const raw = rawMilExtras(line, MIL_ANIM.SPEED);
    if (!raw.length) return null;
    const scale = speedScaleValue();
    return raw.map(event => ({ startTime: event.startTime, endTime: event.endTime,
      start: Number(event.start) * scale, end: Number(event.end) * scale,
      easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 }));
  };
  const flowMultiplierEvents = (line, semantics) => {
    // events whose sampled value is the raw (dimensionless) FlowSpeed(5) multiplier
    if (semantics.speed?.length) return semantics.flowRaw?.length ? semantics.flowRaw : null;
    const scale = speedScaleValue();
    return (semantics.flowSpeed ?? []).map(event => ({ startTime: event.startTime, endTime: event.endTime,
      start: Number(event.start) / scale, end: Number(event.end) / scale,
      easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 }));
  };
  // Bake Speed(12) × line FlowSpeed(5) into one RPE speed track. The pure composition lives in
  // columns.mjs (offline unit test `speed-compose-test.mjs`); this wires RPEN's EventTrack in so
  // the first event's easing/easingLeft/Right are honoured when sampling.
  const composeSpeedTracks = (speedEvents, flowEvents, tempo) => composePreviewSpeedEvents(speedEvents, flowEvents, {
    beatOf: beatNumberOf,
    toTime: fromNumber,
    secondsOf: time => tempo.seconds(time),
    sampler: events => {
      const track = previewTrack(events, tempo, 1);
      return seconds => track.value(seconds);
    },
  });
  const previewSpeedEvents = (line, semantics, tempo) => {
    const base = speedEventsRpe(line, semantics);
    const flowEvents = flowMultiplierEvents(line, semantics);
    if (base && flowEvents?.length) return composeSpeedTracks(base, flowEvents, tempo);
    if (base) return base;
    return semantics.flowSpeed ?? [];
  };
  // convert.mjs keeps RPE rotation = 90 - Milthm rotation (the counterclockwise angle RPU uses),
  // but RPEN's positive rotation is clockwise on screen. The scene needs the on-screen angle,
  // i.e. Milthm theta - 90 = -stored (or stored - 180 when Y is flipped). Preview only.
  const previewRotateEvents = (events, currentSettings) => {
    const flipY = currentSettings['flip-y'] === true;
    return (events ?? []).map(event => ({
      ...event,
      start: flipY ? Number(event.start) - 180 : -Number(event.start),
      end: flipY ? Number(event.end) - 180 : -Number(event.end),
    }));
  };
  const dimTrack = chart => {
    const cache = cacheFor(chart);
    if (cache.dim !== undefined) return cache.dim;
    const events = chart.globalEvents?.types?.[DIM_TYPE_ID]?.columns?.dim?.events ?? [];
    cache.dim = events.length ? globalEventTrack(events, cache.tempo, 0) : null;
    return cache.dim;
  };
  const evaluateDim = (chart, seconds) => {
    const track = dimTrack(chart);
    return track ? clamp01(track.value(seconds)) : 0;
  };

  /* ---------------- preview: Milthm-style tracks ---------------- */
  const roundRect = (context, x, y, width, height, radius) => {
    const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y); context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r); context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height); context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r); context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  };
  const drawTrack = (context, line, state, scale, chart, seconds) => {
    const tracks = lineTracks(chart, line);
    const hasColor = (line.extended?.colorEvents ?? []).length > 0;
    const color = hasColor && Array.isArray(state.color)
      ? state.color.map(value => Math.round(Math.max(0, Math.min(255, value))))
      : [255, 255, 255];
    const lineAlpha = clamp01((state.alpha ?? 255) / 255);
    const bodyAlpha = clamp01(tracks.bodyAlpha.value(seconds)) * lineAlpha;
    const headAlpha = clamp01(tracks.headAlpha.value(seconds)) * lineAlpha;
    const size = Math.max(0.02, Math.abs(state.scaleX ?? 1));
    const thickness = Math.max(2, 9 * scale * size);
    const length = 3600 * scale;
    const rgb = color.join(',');
    context.save();
    const gradient = context.createLinearGradient(0, 0, 0, -length);
    gradient.addColorStop(0, `rgba(${rgb},${0.55 * bodyAlpha})`);
    gradient.addColorStop(0.45, `rgba(${rgb},${0.26 * bodyAlpha})`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    context.fillStyle = gradient;
    roundRect(context, -thickness / 2, -length, thickness, length, thickness / 2);
    context.fill();
    context.globalAlpha = 0.5 * bodyAlpha;
    context.strokeStyle = `rgba(${rgb},0.9)`;
    context.lineWidth = Math.max(1, 1.1 * scale * size);
    context.beginPath(); context.moveTo(0, -length); context.lineTo(0, 0); context.stroke();
    // Judgement head is sized like a note (reference: the renderer's note texture).
    // RPU prefabs: note ≈ 46.30 canvas units, line head ≈ 25.57 canvas units. The old radius 15
    // matched the line-head size (≈32 world units diameter), so a note-sized head is
    // 15 × 46.30 / 25.57 ≈ 27.2 -> use 29 (≈58 world units diameter, matching the note).
    // v0.6.7: radius 15 -> 29, ring/dot scale proportionally, style unchanged.
    const radius = Math.max(5, 29 * scale * size);
    context.globalAlpha = headAlpha;
    context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fillStyle = `rgba(${rgb},0.18)`; context.fill();
    context.lineWidth = Math.max(1.5, radius * 0.16); context.strokeStyle = `rgba(${rgb},0.95)`; context.stroke();
    context.beginPath(); context.arc(0, 0, radius * 0.34, 0, Math.PI * 2);
    context.fillStyle = `rgba(${rgb},0.92)`; context.fill();
    context.restore();
  };

  api.patch(Preview.prototype, 'drawScene', previous => function (...args) {
    this.__milthmSeconds = args[3];
    const chart = args[1]; // drawScene(context, chart, tempo, seconds, ...)

    if (!isMilthmChart(chart) || settings()['preview-tracks'] === false) return previous.apply(this, args);
    // RPEN culls a line by the bounds of the default line texture (a thin horizontal strip)
    // before drawLine is called. A Milthm track is a long ribbon along the note direction, so
    // its visible geometry can cross the viewport while the head is off-screen. During this
    // drawScene only, give every line a huge virtual texture descriptor / texture name so the
    // native culling cannot drop our track; drawLine is replaced by drawTrack and ignores them.
    const images = this.images;
    const runtimes = this.scene?.lines ?? [];
    if (!images || !runtimes.length) return previous.apply(this, args);
    const originalDescribe = images.describe;
    const textureRestores = runtimes.map(runtime => [runtime.line, runtime.line.Texture]);
    images.describe = () => ({ naturalWidth: 80, naturalHeight: 7200 }); // vertical track bounds (world units)
    for (const runtime of runtimes) runtime.line.Texture = '__milthm_track__';
    try { return previous.apply(this, args); }
    finally {
      images.describe = originalDescribe;
      for (const [line, texture] of textureRestores) line.Texture = texture;
    }
  });
  api.patch(Preview.prototype, 'drawLine', previous => function (context, line, state, scale) {
    const chart = this.scene?.chart;
    if (!isMilthmChart(chart) || settings()['preview-tracks'] === false) return previous.call(this, context, line, state, scale);
    if (line.extended?.textEvents?.length) return previous.call(this, context, line, state, scale);
    drawTrack(context, line, state, scale, chart, Number(this.__milthmSeconds ?? 0));
  });
  api.patch(Preview.prototype, 'drawBackground', previous => function (context, chart, tempo, seconds, ...rest) {
    if (!isMilthmChart(chart) || settings()['preview-dim'] === false) return previous.call(this, context, chart, tempo, seconds, ...rest);
    const dim = evaluateDim(chart, seconds);
    const alpha = this.backgroundAlpha;
    this.backgroundAlpha = alpha * (1 - dim);
    try { return previous.call(this, context, chart, tempo, seconds, ...rest); }
    finally { this.backgroundAlpha = alpha; }
  });
  api.patch(SceneRuntime.prototype, 'compile', previous => function (chart, tempo) {
    if (!isMilthmChart(chart)) {
      this.__milthmFlow = undefined;
      const result = previous.call(this, chart, tempo);
      for (const runtime of this.lines) runtime.__milthmChart = null;
      return result;
    }
    // Preview-only global flow speed: the renderer applies FLOW_SPEED as a display multiplier
    // (same number = same falling speed). When the value changes, rebuild the cached line
    // runtimes so the injected speed events pick up the new multiplier immediately.
    const flow = previewFlowMultiplier();
    if (this.__milthmFlow !== flow) {
      this.cache = new WeakMap();
      this.chart = null;
      this.__milthmFlow = flow;
    }
    // The native arrays mirror the *displayed* columns; the scene must always see the
    // semantic X/Y/rotation/speed/size lists. Swap them in just for the compile call so
    // LineRuntime builds its tracks from the semantic data, then restore the display arrays.
    const restores = [];
    const currentSettings = settings();
    for (const line of (chart.judgeLineList ?? [])) {
      const layer = line?.eventLayers?.[0];
      if (!layer) continue;
      const injected = sceneSemanticArrays(line);
      // Preview speed follows Milthm's formula: bake Speed(12) × 线FlowSpeed(5) into one track
      // (plus the preview-only global flow speed multiplier).
      const previewSpeed = previewSpeedEvents(line, semanticEvents(line), tempo);
      injected.speedEvents = flow === 1
        ? previewSpeed
        : previewSpeed.map(event => ({ ...event, start: Number(event.start) * flow, end: Number(event.end) * flow }));
      injected.rotateEvents = previewRotateEvents(injected.rotateEvents, currentSettings);
      restores.push({ line, layer, extended: line.extended,
        arrays: { moveXEvents: layer.moveXEvents, moveYEvents: layer.moveYEvents, rotateEvents: layer.rotateEvents, alphaEvents: layer.alphaEvents, speedEvents: layer.speedEvents } });
      layer.moveXEvents = injected.moveXEvents;
      layer.moveYEvents = injected.moveYEvents;
      layer.rotateEvents = injected.rotateEvents;
      layer.alphaEvents = injected.alphaEvents;
      layer.speedEvents = injected.speedEvents;
      line.extended = { ...(line.extended ?? {}), scaleXEvents: injected.scaleXEvents, scaleYEvents: injected.scaleYEvents };
    }
    let result;
    try { result = previous.call(this, chart, tempo); }
    finally {
      for (const restore of restores) {
        Object.assign(restore.layer, restore.arrays);
        restore.line.extended = restore.extended;
      }
    }
    for (const runtime of this.lines) runtime.__milthmChart = chart;
    return result;
  });
  // SceneRuntime.compile() only runs when the chart/tempo change; make the preview recompile when
  // the global flow speed setting changes so the value takes effect immediately.
  api.patch(Preview.prototype, 'draw', previous => function (...args) {
    const chart = args[0];
    if (isMilthmChart(chart) && this.scene && this.scene.__milthmFlow !== previewFlowMultiplier()) this.scene.chart = null;
    return previous.apply(this, args);
  });
  /* ---------------- 预览框 UI：Milthm 风格 HUD ---------------- */
  // RPEN's preview draws a Phigros-like HUD (ui/game-ui.mjs): skin Pause image, score top-right,
  // combo number + "combo" caption, name/level at the bottom, progress bar. For Milthm charts we
  // replace that pass with Milthm's layout (v0.7.6):
  //  - pause: a slightly transparent white circle with two vertical bars knocked out (even-odd);
  //  - song title right of the pause button, difficulty underneath (smaller and dimmer);
  //  - score in the top-right, a faint "100%" under it;
  //  - the centred combo block shows "All Perfect" above and the combo number below.
  // Reference proportions (from Milthm's in-game UI): pause circle diameter ≈ 7.1% of the preview
  // height, song title ≈ 3.8%, difficulty ≈ 2.7%, score ≈ 4.2%, "100%" ≈ 2.7%, combo ≈ 4.9%.
  const drawMilthmPreviewUi = (preview, context, chart, seconds, frame) => {
    const viewport = frame?.viewport ?? { left: 0, top: 0, width: 0, height: 0 };
    const scale = frame?.scale ?? 1;
    if (!(viewport.width > 0) || !(scale > 0)) return;
    const left = viewport.left;
    const top = viewport.top;
    const width = viewport.width;
    const height = viewport.height;
    if (!(height > 40)) return;
    const atX = fraction => left + width * fraction;
    const atY = fraction => top + height * fraction;
    const size = fraction => Math.max(7, fraction * height);
    const font = fraction => `${Math.round(size(fraction))}px RPEGame, sans-serif`;
    const duration = Math.max(0.001, Number(preview.duration) || 600);
    const progress = Math.max(0, Math.min(1, (seconds + (Number(chart.META?.offset) || 0) / 1000) / duration));
    const times = preview.completionTimes ?? [];
    let combo = 0;
    while (combo < times.length && times[combo] < seconds) combo += 1;
    const score = times.length ? Math.round(1000000 * combo / times.length) : 0;
    const scoreText = String(score).padStart(7, '0');
    const title = String(chart.META?.name ?? '').trim() || '未命名';
    const level = String(chart.META?.level ?? '').trim();
    context.save();
    // progress bar (kept from RPEN's HUD, at the very top edge)
    context.globalAlpha = 1;
    context.fillStyle = 'rgb(125,125,125)';
    context.fillRect(left, atY(0.004), width * progress, Math.max(2, size(0.009)));
    // pause: translucent white circle with two vertical bars knocked out
    const centerX = atX(0.050);
    const centerY = atY(0.082);
    const radius = size(0.0405);
    const barWidth = size(0.0062);
    const barHeight = size(0.0305);
    const gap = size(0.007);
    context.globalAlpha = 0.55;
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2, false);
    if (typeof context.roundRect === 'function') {
      context.roundRect(centerX - gap / 2 - barWidth, centerY - barHeight / 2, barWidth, barHeight, barWidth / 2);
      context.roundRect(centerX + gap / 2, centerY - barHeight / 2, barWidth, barHeight, barWidth / 2);
    } else {
      context.rect(centerX - gap / 2 - barWidth, centerY - barHeight / 2, barWidth, barHeight);
      context.rect(centerX + gap / 2, centerY - barHeight / 2, barWidth, barHeight);
    }
    context.fill('evenodd');
    // song title and difficulty, to the right of the pause button
    const textLeft = atX(0.1004);
    const textMaxWidth = Math.max(60, left + width - textLeft - size(0.02));
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.globalAlpha = 0.92;
    context.fillStyle = '#ffffff';
    context.font = font(0.0377);
    context.fillText(title, textLeft, atY(0.0735), textMaxWidth);
    if (level) {
      context.globalAlpha = 0.55;
      context.font = font(0.0266);
      context.fillText(level, textLeft, atY(0.108), textMaxWidth);
    }
    // score in the top-right corner, faint 100% below it
    const scoreRight = atX(0.9711);
    context.textAlign = 'right';
    context.textBaseline = 'top';
    context.globalAlpha = 1;
    context.fillStyle = '#ffffff';
    context.font = font(0.0422);
    context.fillText(scoreText, scoreRight, atY(0.0555));
    context.globalAlpha = 0.55;
    context.font = font(0.0266);
    context.fillText('100.00%', scoreRight, atY(0.1075));
    // "All Perfect" above the centred combo number
    if (combo >= 3) {
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = '#ffffff';
      context.globalAlpha = 0.9;
      context.font = font(0.034);
      context.fillText('All Perfect', atX(0.5), atY(0.070));
      context.globalAlpha = 1;
      context.font = font(0.042);
      context.fillText(String(combo), atX(0.5), atY(0.122));
    }
    context.restore();
    preview.__milthmHud = {
      title, level, score: scoreText, accuracy: '100.00%', combo,
      allPerfect: combo >= 3 ? 'All Perfect' : null,
      seconds,
      firstCompletion: times[0] ?? null,
      lastCompletion: times[times.length - 1] ?? null,
      pause: { x: centerX, y: centerY, radius, barWidth, barHeight, gap },
      scorePosition: { x: scoreRight, y: atY(0.0555) },
      referenceHeight: height,
    };
  };
  api.patch(Preview.prototype, 'drawUi', previous => function (context, chart, tempo, seconds, selectedLine, frame) {
    if (!isMilthmChart(chart)) return previous.apply(this, arguments);
    try {
      drawMilthmPreviewUi(this, context, chart, seconds, frame ?? {});
    } catch (error) { api.log('Milthm 预览 UI 绘制失败', error); }
    return undefined;
  });

  /* ---------------- text font: bundled ChillRoundF replaces RPEN's RPE/RPEGame faces ---------------- */
  // RPEN draws UI / editor / timeline / preview text with its bundled families RPE and RPEGame
  // (styles.css @font-face -> assets/rpe/fonts/cmdysj.ttf). A later @font-face rule with the same
  // family name wins over the bundled one, so injecting these two rules switches every RPEN text
  // using those families to the third-party ChillRoundF font (SIL OFL-1.1) shipped in this package.
  // Uses the API-1 documented pieces: api.package.url() for package assets, api.style() for CSS,
  // api.settings.onChange() for live setting changes, api.signal for teardown.
  const EDITOR_FONT_PATH = 'fonts/ChillRoundF.ttf';
  let editorFontUrl = null;
  let editorFontSheet = null;
  let editorFontApplied = false;
  const editorFontEnabled = () => settings()['editor-font'] !== false;
  const editorFontCss = url => [
    `@font-face { font-family: 'ChillRoundF'; src: url("${url}") format('truetype'); font-display: swap; }`,
    `@font-face { font-family: RPE; src: url("${url}") format('truetype'); font-display: swap; }`,
    `@font-face { font-family: RPEGame; src: url("${url}") format('truetype'); font-display: swap; }`,
    // DOM text: everything inherits ChillRoundF, including controls that normally pick
    // 'Microsoft YaHei' / Consolas / monospace explicitly (selects, textareas, kbd, code boxes).
    // Canvas text keeps its own context.font strings, which use the RPE / RPEGame faces above.
    `:root, body { font-family: 'ChillRoundF', RPE, 'Microsoft YaHei', sans-serif !important; }`,
    `body *:not(canvas) { font-family: inherit !important; }`,
  ].join('\n');
  const refreshEditorText = () => {
    try { editor.preview?.lineTextLayouts?.clear?.(); } catch { /* ignore */ }
    try { editor.invalidate?.(); } catch { /* ignore */ }
  };
  const applyEditorFont = async () => {
    if (!editorFontEnabled()) return;
    try {
      if (!api.package?.url) throw new Error('当前 RPEN 不支持模组包资源 URL（api.package.url）');
      editorFontUrl = editorFontUrl ?? api.package.url(EDITOR_FONT_PATH, 'font/ttf');
      if (!editorFontSheet) editorFontSheet = api.style(editorFontCss(editorFontUrl));
      editorFontApplied = true;
      await Promise.all(['13px RPE', '16px RPE', '52px RPE', '30px RPEGame', '13px ChillRoundF'].map(font => document.fonts.load(font))).catch(() => {});
      if (api.signal?.aborted || !editorFontEnabled()) return; // module disabled or setting turned off while loading
      refreshEditorText();
    } catch (error) {
      notifyFontFailure(error);
    }
  };
  const notifyFontFailure = error => {
    if (api.signal?.aborted) return;
    api.notify(`RPEN 字体加载失败（${EDITOR_FONT_PATH}）：${error?.message ?? error}`, 'error');
  };
  const removeEditorFont = () => {
    try { editorFontSheet?.remove?.(); } catch { /* ignore */ }
    editorFontSheet = null;
    editorFontApplied = false;
    refreshEditorText();
  };
  applyEditorFont();
  // API 1 documents api.settings.onChange({key,value}) for live setting updates (api.on does not
  // publish 'settings:<id>' as a stable event).
  api.settings.onChange(change => {
    if (!change) return;
    if (change.key === 'renderer-flow-speed') { try { editor.invalidate?.(); } catch { /* ignore */ } return; }
    if (change.key === 'editor-font') { if (editorFontEnabled()) applyEditorFont(); else removeEditorFont(); }
  });
  api.patch(LineRuntime.prototype, 'noteState', previous => function (entry, state, seconds) {
    const result = previous.call(this, entry, state, seconds);
    const chart = this.__milthmChart;
    if (!isMilthmChart(chart)) return result;
    const tracks = lineTracks(chart, this.line);
    const whole = clamp01(tracks.wholeAlpha.value(seconds));
    const size = Math.max(0.01, Math.abs(state.scaleX ?? 1));
    if (size !== 1) {
      result.size *= size; result.sizeY *= size;
      result.y *= size;
      if (Number.isFinite(result.tail)) result.tail *= size;
    }
    const track = noteAlphaTrack(chart, this.line, entry.note);
    result.alpha *= whole * (track ? clamp01(track.value(seconds)) : 1);
    // Milthm also multiplies each note's distance/length by its note-level FlowSpeed(5).
    const flowTrack = noteFlowTrack(chart, this.line, entry.note);
    if (flowTrack) {
      const multiplier = Number(flowTrack.value(seconds));
      if (Number.isFinite(multiplier)) {
        result.y *= multiplier;
        if (Number.isFinite(result.tail)) result.tail *= multiplier;
      }
    }
    return result;
  });

  /* ---------------- import hook ---------------- */
  api.hook('chart:parse', input => {
    const text = typeof input?.text === 'string' ? input.text.trimStart() : '';
    if (!text.startsWith('{')) return;
    let candidate;
    try { candidate = JSON.parse(text); } catch { return; }
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
    if (!('fmt' in candidate) || !candidate.meta || !Array.isArray(candidate.lines) || !Array.isArray(candidate.bpms)) return;
    if (Number(candidate.fmt) !== 2) { api.notify(`Milthm fmt=${candidate.fmt} 暂不支持（本原型仅支持 fmt=2）`, 'warning'); return; }
    try {
      const { chart, warnings } = importMilthmChart(candidate, settings());
      input.chart = chart;
      lastWarnings = warnings;
      reportWarnings('Milthm 导入', warnings);
    } catch (error) {
      api.notify(`Milthm 谱面转换失败：${error?.message ?? error}`, 'error');
      api.log(error);
    }
  });

  /* ---------------- lane lock on every commit ---------------- */
  api.hook('session:before-commit', change => {
    if (!change || !change.chart) return;
    // Lines added to a Milthm chart arrive as plain RPE lines. Give them the Milthm stash in
    // the same commit; otherwise ensureChartColumns() would keep reporting "needs init" after
    // every commit and the auto-initialise commit would loop forever.
    const chart = ensureChartColumns(change.chart) ?? change.chart;
    change.chart = normalizeLaneChart(syncMilthmColumns(chart), settings());
  });

  /* ---------------- helpers for loading/saving ---------------- */
  const downloadBlob = (blob, name) => {
    if (internals.files?.download) { internals.files.download(blob, name); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const zipBlob = entries => internals.archive?.writeZip ? internals.archive.writeZip(entries) : makeStoreZip(entries);
  const findAsset = (predicate, explicitName) => {
    const assets = editor.assets ?? new Map();
    if (explicitName && assets.has(explicitName)) return { name: explicitName, bytes: assets.get(explicitName) };
    const candidates = [...assets.entries()].filter(([name]) => predicate(name));
    const root = candidates.filter(([name]) => !name.replaceAll('\\', '/').includes('/'));
    const pool = root.length ? root : candidates;
    return pool.length === 1 ? { name: pool[0][0], bytes: pool[0][1] } : null;
  };
  const imageToPng = async (bytes, name) => {
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return bytes;
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error(`图片转 PNG 失败：${name}`);
    return new Uint8Array(await png.arrayBuffer());
  };
  const blackPng = async (width = 1920, height = 1080) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await png.arrayBuffer());
  };

  /* ---------------- background dim helpers ---------------- */
  const dimEvents = chart => chart.globalEvents?.types?.[DIM_TYPE_ID]?.columns?.dim?.events ?? [];
  const attachDimStoryboard = (chart, exported) => {
    const events = dimEvents(chart);
    if (!events.length) return null;
    exported.storyboards = Array.isArray(exported.storyboards) ? exported.storyboards : [];
    const index = exported.storyboards.reduce((max, storyboard) => Math.max(max, Number(storyboard.index ?? 0) + 1), 0);
    let animationIndex = exported.lines.reduce((max, line) => Math.max(max, ...(line.animations ?? []).map(animation => Number(animation.index ?? 0) + 1)), 0);
    for (const storyboard of exported.storyboards) for (const animation of (storyboard.animations ?? [])) animationIndex = Math.max(animationIndex, Number(animation.index ?? 0) + 1);
    const storyboard = { index, type: 0, layer: 1, data: 'black.png', animations: [] };
    for (const event of events) {
      const ease = rpeEaseToMil(event.easingType ?? 1);
      storyboard.animations.push({
        startTime: [...event.startTime], endTime: [...event.endTime], type: MIL_ANIM.TRANSPARENCY,
        start: Number(event.start), end: Number(event.end), bearer_type: MIL_BEARER.STORYBOARD, bearer: index,
        ease: { type: ease.type, press: ease.press, isValueExp: false, cusValueExp: '', clipLeft: Number(event.easingLeft ?? 0), clipRight: Number(event.easingRight ?? 1) },
        index: animationIndex++,
      });
    }
    exported.storyboards.push(storyboard);
    return storyboard;
  };

  /* ---------------- dim migration: black storyboards -> global events ---------------- */
  const migratedCharts = new WeakSet();
  const inspectBlackAsset = async name => {
    try {
      const assets = editor.assets ?? new Map();
      const basename = String(name ?? '').replaceAll('\\', '/').split('/').at(-1);
      const entry = [...assets.entries()].find(([path]) => path.replaceAll('\\', '/').split('/').at(-1) === basename);
      if (!entry) return null;
      const bitmap = await createImageBitmap(new Blob([entry[1]]));
      const canvas = document.createElement('canvas');
      canvas.width = 8; canvas.height = 8;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0, 8, 8);
      const data = context.getImageData(0, 0, 8, 8).data;
      let black = true;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 24 || data[i + 1] > 24 || data[i + 2] > 24 || data[i + 3] < 200) { black = false; break; }
      return { black, width: bitmap.width, height: bitmap.height };
    } catch { return null; }
  };
  const maybeMigrateDim = async () => {
    if (settings()['dim-migrate'] === false) return;
    const chart = editor.chart;
    if (!isMilthmChart(chart) || migratedCharts.has(chart)) return;
    migratedCharts.add(chart);
    const storyboards = chart['x-milthm']?.storyboards ?? [];
    const candidates = storyboards.filter(storyboard => Number(storyboard.type) === 0
      && typeof storyboard.data === 'string'
      && Array.isArray(storyboard.animations)
      && storyboard.animations.some(animation => Number(animation.type) === MIL_ANIM.TRANSPARENCY));
    if (!candidates.length) return;
    const found = [];
    for (const storyboard of candidates) {
      const info = await inspectBlackAsset(storyboard.data);
      if (!info?.black) continue;
      const hasScale = storyboard.animations.some(animation => [10, 11].includes(Number(animation.type)));
      if (!hasScale && (info.width < 480 || info.height < 270)) continue;
      found.push(storyboard);
    }
    if (!found.length) return;
    const events = [];
    for (const storyboard of found) {
      for (const animation of storyboard.animations) {
        if (Number(animation.type) !== MIL_ANIM.TRANSPARENCY) continue;
        events.push({
          startTime: animation.startTime, endTime: animation.endTime,
          start: Number(animation.start), end: Number(animation.end),
          easingType: milEaseToRpe(animation.ease), easingLeft: Number(animation.ease?.clipLeft ?? 0), easingRight: Number(animation.ease?.clipRight ?? 1),
          bezier: 0, bezierPoints: [0, 0, 1, 1], inst: 0,
        });
      }
    }
    if (!events.length) return;
    events.sort((left, right) => beatOf(left.startTime) - beatOf(right.startTime));
    const removedKeys = new Set(found.map(storyboard => `${Number(storyboard.index ?? -1)}|${storyboard.data}`));
    const next = structuredClone(chart);
    next['x-milthm'].storyboards = (next['x-milthm'].storyboards ?? []).filter(storyboard => !removedKeys.has(`${Number(storyboard.index ?? -1)}|${storyboard.data}`));
    next.META = { ...next.META, RPEVersion: Math.max(Number(next.META.RPEVersion) || 0, 240) };
    next.globalEvents = {
      version: 1,
      types: {
        ...(next.globalEvents?.types ?? {}),
        [DIM_TYPE_ID]: {
          name: dimTypeName(),
          source: { kind: 'mod', id: MOD_ID, name: api.manifest.name, author: api.manifest.author, version: api.manifest.version },
          columns: { dim: { name: '明暗', valueType: 'number', events } },
        },
      },
    };
    editor.commit('迁移 Milthm 背景明暗为全局事件', next);
    api.notify('已把纯黑立绘的背景明暗迁移为全局事件（可在“全局事件”时间轴编辑）', 'success');
  };

  /* ---------------- export ---------------- */
  const currentMilthmChart = () => {
    const chart = editor.chart;
    if (!chart || !Array.isArray(chart.judgeLineList)) throw new Error('当前没有可导出的谱面');
    return chart;
  };
  const exportJson = async () => {
    const chart = currentMilthmChart();
    const { chart: milthm, warnings } = exportMilthmChart(buildMilthmExportChart(chart), settings());
    const dimStoryboard = attachDimStoryboard(chart, milthm);
    if (dimStoryboard) warnings.push('背景明暗已导出为纯黑立绘 storyboard（chart.json 不含 res/black.png，需要谱面包 zip 或自行提供该图片）');
    await downloadBlob(new Blob([JSON.stringify(milthm, null, 4)], { type: 'application/json' }), `${sanitizeFileName(milthm.meta.name)}.json`);
    reportWarnings('Milthm 导出', warnings);
    api.notify('已导出 Milthm 自制谱 chart.json', 'success');
    return { name: milthm.meta.name, warnings: [...new Set(warnings)] };
  };
  const exportZip = async () => {
    const chart = currentMilthmChart();
    const { chart: milthm, warnings } = exportMilthmChart(buildMilthmExportChart(chart), settings());
    const entries = new Map();
    const encoder = new TextEncoder();
    const dimStoryboard = attachDimStoryboard(chart, milthm);
    entries.set('chart.json', encoder.encode(JSON.stringify(milthm, null, 4)));
    const meta = { chart_file: 'chart.json', audio_file: '', image_file: 'image.png' };
    const audio = findAsset(isAudioName, chart.META?.song || undefined);
    if (audio) {
      const extension = (audio.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'mp3').toLowerCase();
      entries.set(`audio.${extension}`, new Uint8Array(audio.bytes));
      meta.audio_file = `audio.${extension}`;
    } else warnings.push('未找到唯一音频：谱面包内没有音频文件');
    const cover = findAsset(isImageName, chart.META?.background || undefined);
    if (cover) { entries.set('image.png', await imageToPng(new Uint8Array(cover.bytes), cover.name)); meta.image_file = 'image.png'; }
    else warnings.push('未找到唯一曲绘：谱面包内没有 image.png');
    if (dimStoryboard) entries.set('res/black.png', await blackPng());
    entries.set('meta.json', encoder.encode(JSON.stringify(meta)));
    for (const storyboard of (milthm.storyboards ?? [])) {
      if (Number(storyboard.type) !== 0 || typeof storyboard.data !== 'string' || !storyboard.data) continue;
      if (storyboard === dimStoryboard) continue;
      const data = storyboard.data.replaceAll('\\', '/');
      const basename = data.split('/').at(-1);
      const hasExtension = /\.[a-z0-9]+$/i.test(basename);
      const asset = findAsset(name => {
        const assetName = name.replaceAll('\\', '/').split('/').at(-1);
        return assetName === basename || (!hasExtension && assetName.replace(/\.[a-z0-9]+$/i, '') === basename);
      });
      if (!asset) { warnings.push(`图片故事板「${storyboard.data}」在谱面包资源里找不到同名图片，zip 中缺少这张图`); continue; }
      const entryName = hasExtension ? data : `${data}.${asset.name.split('.').at(-1) ?? 'png'}`;
      entries.set(`res/${entryName}`, new Uint8Array(asset.bytes));
    }
    await downloadBlob(await zipBlob(entries), `${sanitizeFileName(milthm.meta.name)}.zip`);
    reportWarnings('Milthm 导出', warnings);
    api.notify('已导出 Milthm 自制谱谱面包 zip', 'success');
    return { name: milthm.meta.name, entries: [...entries.keys()], warnings: [...new Set(warnings)] };
  };

  /* ---------------- channel / event editor ---------------- */
  let activeType = 'line-body-alpha';
  const allSelects = [];
  const currentLine = () => editor.chart?.judgeLineList?.[editor.session?.lineIndex ?? 0];
  const currentLineIndex = () => editor.session?.lineIndex ?? 0;
  const selectedNoteEntries = () => {
    const line = currentLine();
    const indexes = [...(editor.session?.selection ?? [])].filter(index => line?.notes?.[index]);
    return indexes.map(index => ({ line, index, note: line.notes[index] }));
  };
  const channelContext = type => {
    const chart = currentMilthmChart();
    const lineIndex = currentLineIndex();
    const line = chart.judgeLineList[lineIndex];
    // 流速倍率: Speed(12)-primary lines keep FlowSpeed(5) raw values in the Milthm channel store;
    // FlowSpeed(5)-primary lines keep them in the semantic list (RPE-scaled), so edit both the
    // semantic list and the native speed carrier when that column shows flowSpeed.
    if (type === 'line-flow-speed') {
      const stash = line?.['x-milthm'] ?? {};
      const speedPrimary = Number(stash.primarySpeedType) === MIL_ANIM.SPEED;
      const scale = speedScaleValue();
      const semantics = semanticEvents(line);
      const events = speedPrimary
        ? (stash.channels?.flowSpeed ?? [])
        : (semantics.flowSpeed ?? []).map(event => ({ ...event, start: Number(event.start) / scale, end: Number(event.end) / scale }));
      return {
        kind: 'milthm', format: 'milthm', valueKind: 'number', events,
        hint: speedPrimary
          ? 'Milthm FlowSpeed(5)：与 Speed(12) 相乘的线级流速倍率（原始值，默认 1）'
          : 'Milthm FlowSpeed(5)：线级视觉流速倍率（显示为原始倍率，内部按 RPE 速度折算）',
        set: nextEvents => {
          const next = structuredClone(chart);
          const target = next.judgeLineList[lineIndex];
          if (!target) return;
          if (speedPrimary) {
            target['x-milthm'] = target['x-milthm'] ?? {};
            target['x-milthm'].channels = target['x-milthm'].channels ?? { bodyAlpha: [], headAlpha: [], wholeAlpha: [], flowSpeed: [] };
            target['x-milthm'].channels.flowSpeed = structuredClone(nextEvents);
          } else {
            const scaled = nextEvents.map(event => ({ ...event, start: Number(event.start) * scale, end: Number(event.end) * scale }));
            target['x-milthm'] = target['x-milthm'] ?? {};
            target['x-milthm'].events = target['x-milthm'].events ?? {};
            target['x-milthm'].events.flowSpeed = structuredClone(scaled);
            const columns = chart['x-milthm']?.columns ?? [];
            if (columns[4] === 'flowSpeed') {
              target.eventLayers = target.eventLayers ?? [{}];
              target.eventLayers[0] = target.eventLayers[0] ?? {};
              target.eventLayers[0].speedEvents = structuredClone(scaled);
            }
          }
          editor.commit('编辑 Milthm 流速倍率', next);
        },
      };
    }
    if (CHANNEL_KEYS[type]) {
      const key = CHANNEL_KEYS[type];
      const events = line?.['x-milthm']?.channels?.[key] ?? [];
      return {
        kind: 'milthm', format: 'milthm', valueKind: 'alpha', events,
        hint: CHANNEL_DEFS[type].hint,
        set: nextEvents => {
          const next = structuredClone(chart);
          const target = next.judgeLineList[lineIndex];
          if (!target) return;
          target['x-milthm'] = target['x-milthm'] ?? {};
          target['x-milthm'].channels = target['x-milthm'].channels ?? { bodyAlpha: [], headAlpha: [], wholeAlpha: [], flowSpeed: [] };
          target['x-milthm'].channels[key] = nextEvents;
          editor.commit(`编辑 Milthm ${CHANNEL_DEFS[type].label}`, next);
        },
      };
    }
    if (type === 'line-size') {
      const events = line?.extended?.scaleXEvents ?? [];
      return {
        kind: 'milthm', format: 'native', valueKind: 'number', events,
        hint: CHANNEL_DEFS['line-size'].hint,
        set: nextEvents => {
          const next = structuredClone(chart);
          const target = next.judgeLineList[lineIndex];
          if (!target) return;
          target.extended = target.extended ?? {};
          target.extended.scaleXEvents = nextEvents;
          target.extended.scaleYEvents = structuredClone(nextEvents);
          editor.commit('编辑 Milthm 轨道大小', next);
        },
      };
    }
    if (type === 'note-alpha') {
      const entries = selectedNoteEntries();
      if (!entries.length) return { kind: 'milthm', format: 'milthm', valueKind: 'alpha', events: [], hint: '请先在时间轴选中音符（同一轨道），再编辑其不透明度事件。', set: () => {} };
      const animations = (entries[0].note['x-milthm']?.animations ?? []).filter(animation => Number(animation.type) === MIL_ANIM.TRANSPARENCY);
      return {
        kind: 'milthm', format: 'milthm', valueKind: 'alpha', events: animations,
        hint: `作用于选中的 ${entries.length} 个音符（音符级 Transparency(2) 事件）。`,
        set: nextEvents => {
          const next = structuredClone(chart);
          for (const { index } of entries) {
            const target = next.judgeLineList[lineIndex]?.notes?.[index];
            if (!target) continue;
            const stash = { ...(target['x-milthm'] ?? {}) };
            const others = (stash.animations ?? []).filter(animation => Number(animation.type) !== MIL_ANIM.TRANSPARENCY);
            const all = [...others, ...structuredClone(nextEvents)];
            if (all.length) stash.animations = all; else delete stash.animations;
            if (Object.keys(stash).length) target['x-milthm'] = stash; else delete target['x-milthm'];
          }
          editor.commit('编辑 Milthm 音符不透明度', next);
        },
      };
    }
    if (type === 'background-dim') {
      return { kind: 'global', events: dimEvents(chart), hint: CHANNEL_DEFS['background-dim'].hint, set: () => {} };
    }
    return { kind: 'milthm', format: 'milthm', valueKind: 'number', events: [], hint: '未知事件类型', set: () => {} };
  };

  /* ---------------- UI ---------------- */
  api.style(PANEL_STYLE);
  const panel = document.createElement('div');
  panel.className = 'milthm-panel';
  panel.dataset.modInteractive = 'true';
  panel.innerHTML = `
    <div class="m-title">Milthm fmt=2 模式<span class="m-badge">轨道制</span></div>
    <div class="m-row"><button data-m-action="export-json">导出 chart.json</button><button data-m-action="export-zip">导出谱面包</button></div>
    <div class="m-row"><span>Milthm 事件</span><select class="m-select" data-m-role="type"></select></div>
    <div class="m-hint" data-m-role="hint"></div>
    <div class="m-list" data-m-role="list"></div>
    <div class="m-row" data-m-role="actions">
      <button data-m-action="add-event">+ 添加关键帧</button>
      <button data-m-action="open-global" hidden>打开全局事件时间轴</button>
    </div>
    <div class="m-status" data-m-role="status"></div>`;
  // v0.4: the floating panel is removed; event columns are edited in the native timeline header.
  const listElement = panel.querySelector('[data-m-role="list"]');
  const hintElement = panel.querySelector('[data-m-role="hint"]');
  const statusElement = panel.querySelector('[data-m-role="status"]');
  const panelSelect = panel.querySelector('[data-m-role="type"]');
  for (const [value, definition] of Object.entries(CHANNEL_DEFS)) panelSelect.append(new Option(definition.label, value));
  panelSelect.value = activeType;
  allSelects.push(panelSelect);
  panelSelect.addEventListener('change', () => setActiveType(panelSelect.value));
  const syncSelects = () => { for (const select of allSelects) select.value = activeType; };

  const setActiveType = type => {
    if (!CHANNEL_DEFS[type]) return;
    activeType = type;
    if (type === 'background-dim') { try { api.globalEvents.open(); } catch { /* ignore */ } }
    renderPanel();
  };
  const applyChannelEdit = context => {
    try {
      const rows = [...(listElement?.querySelectorAll('.m-ev') ?? [])];
      const events = rows.map(row => {
        const inputs = [...row.querySelectorAll('input[data-field]')];
        const [startTimeInput, endTimeInput, startInput, endInput] = inputs;
        const easeType = Number(row.querySelector('select[data-ease-type]').value);
        const press = Number(row.querySelector('select[data-ease-press]').value);
        const startTime = parseBeat(startTimeInput.value);
        const endTime = parseBeat(endTimeInput.value);
        if (context.format === 'native') {
          return {
            startTime, endTime, start: Number(startInput.value), end: Number(endInput.value),
            easingType: milEaseToRpe({ type: easeType, press }), easingLeft: 0, easingRight: 1,
            bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0,
          };
        }
        return {
          startTime, endTime, start: Number(startInput.value), end: Number(endInput.value),
          ease: { type: easeType, press, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 },
        };
      });
      context.set(events);
      renderPanel();
    } catch (error) {
      api.notify(`Milthm 事件编辑失败：${error?.message ?? error}`, 'error');
    }
  };
  const makeEventRow = (event, index, context) => {
    const row = document.createElement('div');
    row.className = 'm-ev';
    const valueStep = context.valueKind === 'alpha' ? 0.01 : 1;
    const mkInput = (field, value, extra = {}) => {
      const input = document.createElement('input');
      input.dataset.field = field; input.value = value; input.title = extra.title ?? field;
      if (extra.type) input.type = extra.type;
      if (extra.step) input.step = extra.step;
      return input;
    };
    row.append(
      mkInput('startTime', formatBeat(event.startTime), { title: '开始拍（如 0:1/4）' }),
      mkInput('endTime', formatBeat(event.endTime), { title: '结束拍' }),
      mkInput('start', Number(event.start ?? 0), { type: 'number', step: valueStep, title: '开始值' }),
      mkInput('end', Number(event.end ?? 0), { type: 'number', step: valueStep, title: '结束值' }),
    );
    const ease = context.format === 'native' ? rpeEaseToMil(event.easingType ?? 1) : { type: Number(event.ease?.type ?? 0), press: Number(event.ease?.press ?? 0) };
    const easeLine = document.createElement('div');
    easeLine.className = 'm-ease';
    const typeSelect = document.createElement('select');
    typeSelect.dataset.easeType = '';
    for (const [value, label] of EASE_TYPE_NAMES.entries()) typeSelect.append(new Option(label, String(value)));
    typeSelect.value = String(ease.type);
    const pressSelect = document.createElement('select');
    pressSelect.dataset.easePress = '';
    for (const [value, label] of EASE_PRESS_NAMES.entries()) pressSelect.append(new Option(label, String(value)));
    pressSelect.value = String(ease.press);
    const deleteButton = document.createElement('button');
    deleteButton.className = 'm-del'; deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => {
      context.set(structuredClone(context.events.filter((_, current) => current !== index)));
      renderPanel();
    });
    const applyButton = document.createElement('button');
    applyButton.textContent = '应用';
    applyButton.addEventListener('click', () => applyChannelEdit(context));
    easeLine.append(typeSelect, pressSelect, deleteButton, applyButton);
    row.append(easeLine);
    return row;
  };
  const renderPanel = () => {
    const chart = editor.chart;
    const visible = isMilthmChart(chart);
    panel.style.display = visible ? '' : 'none';
    if (!visible) return;
    syncSelects();
    const context = channelContext(activeType);
    hintElement.textContent = context.hint ?? CHANNEL_DEFS[activeType]?.hint ?? '';
    const actions = panel.querySelector('[data-m-role="actions"]');
    const openGlobal = actions?.querySelector('[data-m-action="open-global"]');
    const addButton = actions?.querySelector('[data-m-action="add-event"]');
    if (openGlobal) openGlobal.hidden = context.kind !== 'global';
    if (addButton) addButton.hidden = context.kind === 'global';
    listElement.replaceChildren();
    if (context.kind === 'global') {
      const note = document.createElement('div');
      note.className = 'm-hint';
      note.textContent = `当前 ${context.events.length} 条明暗事件（点击下方按钮打开全局事件时间轴编辑）。`;
      listElement.append(note);
      for (const event of context.events) {
        const row = document.createElement('div');
        row.className = 'm-ev';
        row.textContent = `${formatBeat(event.startTime)} → ${formatBeat(event.endTime)}  明暗 ${Number(event.start)}→${Number(event.end)}`;
        listElement.append(row);
      }
    } else {
      const events = context.events ?? [];
      if (!events.length) {
        const empty = document.createElement('div');
        empty.className = 'm-hint'; empty.textContent = '该事件类型还没有关键帧。';
        listElement.append(empty);
      }
      events.forEach((event, index) => listElement.append(makeEventRow(event, index, context)));
    }
    const lines = chart.judgeLineList?.length ?? 0;
    const notes = (chart.judgeLineList ?? []).reduce((sum, line) => sum + (line.notes?.length ?? 0), 0);
    const dimCount = dimEvents(chart).length;
    statusElement.textContent = `${lines} 轨道 / ${notes} 音符 · 当前轨道 ${currentLineIndex()}${dimCount ? ` · 背景明暗 ${dimCount} 条全局事件` : ''}${lastWarnings.length ? `\n最近导入提示 ${[...new Set(lastWarnings)].length} 条（见控制台）` : ''}`;
  };
  const insertTimelineSelect = () => {}; // replaced by the per-column dropdown overlay

  api.commands.register({ id: 'new-milthm-chart', title: '新建 Milthm 轨道谱面', run: () => createMilthmChart() });
  api.commands.register({ id: 'export-json', title: '导出 Milthm 自制谱 chart.json', run: exportJson });
  api.commands.register({ id: 'export-zip', title: '导出 Milthm 自制谱谱面包 zip', run: exportZip });
  panel.querySelector('[data-m-action="export-json"]').addEventListener('click', () => exportJson().catch(error => api.notify(String(error?.message ?? error), 'error')));
  panel.querySelector('[data-m-action="export-zip"]').addEventListener('click', () => exportZip().catch(error => api.notify(String(error?.message ?? error), 'error')));
  panel.querySelector('[data-m-action="open-global"]').addEventListener('click', () => api.globalEvents.open());
  panel.querySelector('[data-m-action="add-event"]').addEventListener('click', () => {
    try {
      const context = channelContext(activeType);
      if (context.kind === 'global') { api.globalEvents.open(); return; }
      const beat = fromNumber(Number(editor.currentBeat?.() ?? 0));
      const value = context.valueKind === 'alpha' ? 1 : 1;
      context.set([...(context.events ?? []), {
        startTime: beat, endTime: beat, start: value, end: value,
        ease: { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 },
      }]);
      renderPanel();
    } catch (error) {
      api.notify(`添加关键帧失败：${error?.message ?? error}`, 'error');
    }
  });

  /* ---------------- note inspector: ExNote checkbox ---------------- */
  let exCheckboxField = null;
  const noteForInspector = () => {
    const line = currentLine();
    const index = [...(editor.session?.selection ?? [])][0];
    return line?.notes?.[index] ? { note: line.notes[index], index } : null;
  };
  const setExNote = value => {
    const session = editor.session;
    if (!session?.transformSelection) return;
    try {
      session.transformSelection('设置 ExNote(isAlwaysPerfect)', note => {
        const stash = { ...(note['x-milthm'] ?? {}) };
        if (value) stash.isAlwaysPerfect = true; else delete stash.isAlwaysPerfect;
        const next = { ...note };
        if (Object.keys(stash).length) next['x-milthm'] = stash; else delete next['x-milthm'];
        return next;
      });
    } catch (error) { api.notify(`设置 ExNote 失败：${error?.message ?? error}`, 'error'); }
  };
  const setupExCheckbox = () => {
    const form = document.querySelector('#properties');
    if (!form) return null;
    const render = () => {
      if (!isMilthmChart(editor.chart)) { exCheckboxField?.remove(); exCheckboxField = null; return; }
      const entry = noteForInspector();
      if (!entry) { exCheckboxField?.remove(); exCheckboxField = null; return; }
      if (!form.contains(exCheckboxField)) {
        exCheckboxField = document.createElement('label');
        exCheckboxField.className = 'field';
        exCheckboxField.dataset.milthmField = 'exnote';
        exCheckboxField.append('ExNote (isAlwaysPerfect)');
        const select = document.createElement('select');
        select.append(new Option('否', '0'), new Option('是', '1'));
        select.addEventListener('change', () => setExNote(select.value === '1'));
        exCheckboxField.append(select);
        form.append(exCheckboxField);
      }
      const select = exCheckboxField.querySelector('select');
      if (select) select.value = entry.note['x-milthm']?.isAlwaysPerfect ? '1' : '0';
    };
    const observer = new MutationObserver(() => queueMicrotask(render));
    observer.observe(form, { childList: true });
    api.dispose(() => observer.disconnect());
    render();
    return render;
  };
  const renderExCheckbox = setupExCheckbox();

  /* ---------------- Milthm event columns: dropdowns on the native header ---------------- */
  const COLUMN_STYLE = `
.milthm-column-bar{position:fixed;z-index:2147482999;display:flex;height:23px;background:#303030;box-shadow:0 1px 0 #1b2330}
.milthm-column-select{flex:1;min-width:0;height:23px;box-sizing:border-box;background:#303030;color:#f5f5f5;
  border:0;border-right:1px solid #1b2330;border-radius:0;font:11px/1 system-ui,"Microsoft YaHei",sans-serif;
  padding:0 1px;outline:none;cursor:pointer}
.milthm-column-select:hover{background:#3a3f4a}
.milthm-column-select:focus{background:#3a3f4a;box-shadow:inset 0 0 0 1px #4d7fb8}
`;
  api.style(COLUMN_STYLE);
  const columnSelects = [];
  const columnShown = [];
  let columnOverlay = null;
  let columnPoll = null;
  const updateColumnOverlay = () => {
    if (!columnOverlay) return;
    const chart = editor.chart;
    const timeline = editor.timeline;
    const canvas = timeline?.eventsCanvas;
    const session = editor.session;
    const active = isMilthmChart(chart) && canvas && !timeline.extended && !session?.multiLineActive && !editor.home;
    if (!active) { columnOverlay.style.display = 'none'; return; }
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 80 && rect.height > 22)) { columnOverlay.style.display = 'none'; return; }
    columnOverlay.style.display = 'flex';
    columnOverlay.style.left = `${rect.left}px`;
    columnOverlay.style.top = `${rect.top}px`;
    columnOverlay.style.width = `${rect.width}px`;
    const columns = chartColumns(chart);
    columnSelects.forEach((select, slot) => {
      if (columnShown[slot] !== columns[slot]) {
        columnShown[slot] = columns[slot];
        select.replaceChildren(...SLOT_CANDIDATES[slot].map(key => new Option(COLUMN_LABELS[key], key)));
        select.value = columns[slot];
      }
      select.title = `第 ${slot + 1} 列：${COLUMN_LABELS_FULL[columns[slot]] ?? COLUMN_LABELS[columns[slot]]}（点开可换成本列支持的其它 Milthm 事件）`;
    });
  };
  const applyColumnChange = (slot, key) => {
    const chart = editor.chart;
    if (!isMilthmChart(chart)) return;
    const next = remapColumns(chart, slot, key);
    if (!next) { updateColumnOverlay(); return; }
    if (next.error) { api.notify(next.error, 'warning'); updateColumnOverlay(); return; }
    try {
      editor.commit(`Milthm 第 ${slot + 1} 列 → ${COLUMN_LABELS[key]}`, next);
      api.notify(`第 ${slot + 1} 列已切换为「${COLUMN_LABELS[key]}」`, 'success');
    } catch (error) {
      api.notify('切换 Milthm 事件列失败：' + (error?.message ?? error), 'error');
    }
    updateColumnOverlay();
  };
  const installColumnOverlay = () => {
    if (columnOverlay) return;
    columnOverlay = document.createElement('div');
    columnOverlay.className = 'milthm-column-bar';
    columnOverlay.dataset.modInteractive = 'true';
    for (let slot = 0; slot < 5; slot++) {
      const select = document.createElement('select');
      select.className = 'milthm-column-select';
      select.addEventListener('change', () => applyColumnChange(slot, select.value));
      columnSelects.push(select);
      columnOverlay.append(select);
    }
    document.body.append(columnOverlay);
    updateColumnOverlay();
  };
  const resizeColumnOverlay = () => updateColumnOverlay();
  window.addEventListener('resize', resizeColumnOverlay);
  columnPoll = setInterval(updateColumnOverlay, 350);
  api.dispose(() => {
    window.removeEventListener('resize', resizeColumnOverlay);
    if (columnPoll) clearInterval(columnPoll);
    columnOverlay?.remove();
  });

  /* ---------------- Milthm 语义表头：时间轴顶部显示“该列编辑什么” ---------------- */
  // RPEN draws the native event names (X / Y / 旋转 / 不透明度 / 速度 / 缩放X / …) in the timeline
  // header. On a Milthm chart each column maps to a semantic channel, so after RPEN draws we
  // repaint the 23px header strip with semantic names (single-line and 多线编辑 panels).
  const EXTENDED_TYPE_LABELS = {
    scaleXEvents: '轨道大小·X', scaleYEvents: '轨道大小·Y',
    colorEvents: '轨道颜色', paintEvents: '着色器', textEvents: '轨道文字',
  };
  const headerLabelMap = () => {
    const chart = editor.chart;
    if (!isMilthmChart(chart)) return null;
    const columns = chartColumns(chart);
    const map = new Map([
      ['moveXEvents', COLUMN_LABELS[columns[0]] ?? 'X 坐标'],
      ['moveYEvents', COLUMN_LABELS[columns[1]] ?? 'Y 坐标'],
      ['rotateEvents', COLUMN_LABELS[columns[2]] ?? '旋转'],
      ['alphaEvents', COLUMN_LABELS[columns[3]] ?? '不透明度'],
      ['speedEvents', COLUMN_LABELS[columns[4]] ?? '速度'],
      ...Object.entries(EXTENDED_TYPE_LABELS),
    ]);
    for (const kind of SEMANTIC_COLUMNS) map.set(semanticColumnKey(kind), SEMANTIC_COLUMN_LABELS[kind] ?? kind);
    return map;
  };
  const headerLabels = () => {
    if (editor.timeline?.extended) return null;
    const map = headerLabelMap();
    if (!map) return null;
    const types = editor.timeline?.eventTypes ?? [];
    return types.map(type => map.get(type) ?? type);
  };
  const paintHeaderLabels = (timeline, mode) => {
    const labels = headerLabels();
    if (!labels?.length) return;
    const canvas = timeline?.eventsCanvas;
    if (!canvas || !(canvas.clientWidth > 0)) return;
    const width = canvas.clientWidth;
    const context = canvas.getContext('2d');
    context.save();
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    const rows = [];
    if (mode === 'multi') {
      const count = timeline.panelCount('events');
      if (count <= 1) rows.push({ left: 0, width });
      else {
        const panelWidth = timeline.panelWidth(width, 'events');
        const stride = timeline.panelStride(width, 'events');
        const offset = timeline.multiLineViewportOffset(width, 'events');
        for (let panel = 0; panel < count; panel++) {
          const left = panel * stride - offset;
          if (left + panelWidth < 0 || left > width) continue;
          rows.push({ left, width: panelWidth });
        }
      }
    } else rows.push({ left: 0, width });
    for (const row of rows) {
      const channelWidth = row.width / labels.length;
      labels.forEach((label, channel) => {
        const left = row.left + channel * channelWidth;
        if (channelWidth < 20) return;
        context.fillStyle = '#303030';
        context.fillRect(left, 0, channelWidth, 23);
        context.fillStyle = '#f5f5f5';
        context.font = `${channelWidth >= 54 ? 12 : 10}px RPE, sans-serif`;
        context.fillText(label, left + 5, channelWidth >= 54 ? 16 : 15, Math.max(8, channelWidth - 7));
      });
    }
    context.restore();
    timeline.__milthmHeaderLabels = labels; // probe/test hook: which labels were painted last
  };
  let timelineHeaderPatched = false;
  const patchTimelineHeaders = () => {
    const timeline = editor.timeline;
    if (!timeline || timelineHeaderPatched) return;
    timelineHeaderPatched = true;
    api.patch(timeline, 'drawEvents', previous => function (...args) {
      const result = previous.apply(this, args);
      try {
        restrictEditableEvents();
        const session = this.getSession();
        if (!(session?.multiLineActive && session.multiLineMode === 'events')) paintHeaderLabels(this, 'single');
      } catch (error) { api.log('Milthm 表头文字绘制失败', error); }
      return result;
    });
    api.patch(timeline, 'drawMultiLineEvents', previous => function (...args) {
      const result = previous.apply(this, args);
      try { restrictEditableEvents(); paintHeaderLabels(this, 'multi'); } catch (error) { api.log('Milthm 多线表头文字绘制失败', error); }
      return result;
    });
  };
  patchTimelineHeaders();

  /* ---------------- 多线编辑：编辑事件列（全部普通层语义种类） + 事件类型下拉 ---------------- */
  // v0.7.9: the checkbox group lists every kind editable in RPEN's normal (non-special) event
  // columns — the same entries as the timeline column dropdowns: X / Y / 旋转 / 流速倍率 /
  // 轨道大小 / 轨道整体不透明度 / 线体不透明度 / 线头不透明度 / 音符整体不透明度. Checked kinds are
  // rendered as the left multi-line timeline columns: each kind's semantic events are projected
  // into RPEN event arrays under `extended.milthmCol_<kind>` (and the draw layer) while editing,
  // and syncMilthmColumns() adopts the edited arrays back into the semantic lists and strips the
  // pseudo keys on every commit. RPEN's special event layer stays completely native.
  const EDIT_COLUMNS_STYLE = `
.milthm-edit-columns{display:flex;flex-direction:column;gap:5px;margin:2px 0 6px;padding:7px 8px;border:1px solid #3c434f;border-radius:3px;background:#282c34}
.milthm-edit-columns-title{font-size:11px;color:#aab3c0}
.milthm-edit-columns-list{display:flex;flex-wrap:wrap;gap:3px 12px}
.milthm-edit-columns-list label{display:flex;align-items:center;gap:4px;font-size:12px;color:#e8ecf5;white-space:nowrap;cursor:pointer}
.milthm-edit-columns-list input{margin:0;pointer-events:auto}
`;
  api.style(EDIT_COLUMNS_STYLE);
  const semanticKindLabel = kind => SEMANTIC_COLUMN_LABELS[kind] ?? kind;
  let editColumnTypes = null;
  let editColumnsSignature = null;
  const ensureColumnDefaults = () => {
    const chart = editor.chart;
    if (!isMilthmChart(chart)) return;
    const signature = chartColumns(chart).join(',');
    if (editColumnsSignature === signature && editColumnTypes?.size) return;
    editColumnsSignature = signature;
    editColumnTypes = new Set(chartColumns(chart).filter(kind => SEMANTIC_COLUMNS.includes(kind)));
    if (!editColumnTypes.size) editColumnTypes = new Set(['x', 'y', 'rotate', 'flowSpeed']);
  };
  const multiEditTypeOptions = () => {
    if (!isMilthmChart(editor.chart)) return internals.multiEdit?.EVENT_BATCH_TYPES ?? null;
    const session = editor.session;
    if (session?.multiLineActive && session.multiLineMode === 'events' && !editor.timeline?.extended) {
      return [['all', '全部'], ...SEMANTIC_COLUMNS.map(kind => [semanticColumnKey(kind), semanticKindLabel(kind)])];
    }
    return [['all', '全部'], ...milthmEventTypeLabels(chartColumns(editor.chart)).slice(1, 6)];
  };
  const columnEventTypes = () => {
    const chart = editor.chart;
    if (!isMilthmChart(chart)) return null;
    if (editor.timeline?.extended) return null;
    const session = editor.session;
    if (!(session?.multiLineActive && session.multiLineMode === 'events')) return null;
    ensureColumnDefaults();
    if (!editColumnTypes?.size) return null;
    return SEMANTIC_COLUMNS.filter(kind => editColumnTypes.has(kind)).map(semanticColumnKey);
  };
  // The selected semantic columns become the timeline's eventTypes (only while multi-line events
  // editing is active). The original getter is restored on unload.
  const timeline = editor.timeline;
  const timelinePrototype = timeline ? Object.getPrototypeOf(timeline) : null;
  const originalEventTypes = timelinePrototype ? Object.getOwnPropertyDescriptor(timelinePrototype, 'eventTypes') : null;
  if (timeline && originalEventTypes?.get) {
    Object.defineProperty(timeline, 'eventTypes', {
      configurable: true,
      enumerable: false,
      get() {
        const types = columnEventTypes();
        if (types?.length) return types;
        return originalEventTypes.get.call(this);
      },
    });
    api.dispose(() => { try { delete timeline.eventTypes; } catch { /* ignore */ } });
  }
  // Project the selected semantic kinds into the chart line data used by the drawing/interaction
  // pipeline. The keys are removed again by syncMilthmColumns() on commit.
  const patchMultiLineColumns = () => {
    const target = editor.timeline;
    if (!target) return;
    api.patch(target, 'drawMultiLineEvents', previous => function (...args) {
      const keys = columnEventTypes();
      const session = this.getSession?.() ?? editor.session;
      if (keys?.length && session?.chart) {
        const chart = session.chart;
        const layerIndex = this.layer ?? 0;
        for (const lineIndex of session.targetLineIndices ?? []) {
          const line = chart.judgeLineList?.[lineIndex];
          if (!line) continue;
          const semantics = semanticEvents(line);
          const layer = line.eventLayers?.[layerIndex] ?? line.eventLayers?.[0];
          line.extended = line.extended ?? {};
          for (const key of keys) {
            const kind = semanticColumnKind(key);
            if (!kind) continue;
            const events = semanticColumnEvents(semantics, kind);
            line.extended[key] = events;
            if (layer) layer[key] = events;
          }
        }
      }
      return previous.apply(this, args);
    });
  };
  patchMultiLineColumns();
  // Drop events of columns that are not shown (they cannot be edited from the left timeline).
  const restrictEditableEvents = () => {
    // the event-type dropdown depends on the editing mode; refresh it here because entering
    // multi-line mode does not emit an editor:state event
    try { adaptMultiEditTypes(); } catch { /* ignore */ }
    const chart = editor.chart;
    const session = editor.session;
    if (!session || !isMilthmChart(chart)) return;
    if (editor.timeline?.extended) return;
    if (!(session.multiLineActive && session.multiLineMode === 'events')) return;
    const allowed = new Set(columnEventTypes() ?? []);
    if (!allowed.size) return;
    let changed = false;
    for (const [lineIndex, keys] of [...(session.multiEventSelection ?? new Map())]) {
      const next = new Set([...keys].filter(key => allowed.has(String(key).split(':')[0])));
      if (next.size === keys.size) continue;
      changed = true;
      if (next.size) session.multiEventSelection.set(lineIndex, next);
      else session.multiEventSelection.delete(lineIndex);
    }
    const current = new Set([...(session.eventSelection ?? [])].filter(key => allowed.has(String(key).split(':')[0])));
    if (current.size !== (session.eventSelection?.size ?? 0)) { session.eventSelection = current; changed = true; }
    if (changed) { try { editor.invalidate?.(); } catch { /* ignore */ } }
  };
  const applyEditColumnTypes = (kinds = []) => {
    const next = new Set(kinds.filter(kind => SEMANTIC_COLUMNS.includes(kind)));
    if (next.size) editColumnTypes = next;
    else { editColumnsSignature = null; ensureColumnDefaults(); }
    restrictEditableEvents();
    try { editor.invalidate?.(); } catch { /* ignore */ }
  };
  const fillColumnCheckboxes = (list, types) => {
    const signature = types.map(([value, label]) => `${value}=${label}`).join('|');
    const checked = new Set([...editColumnTypes ?? []].map(semanticColumnKey));
    if (list.dataset.milthmSignature === signature) {
      list.querySelectorAll('input').forEach(input => { input.checked = checked.has(input.value); });
      return;
    }
    list.replaceChildren(...types.map(([value, label]) => {
      const item = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = value;
      input.checked = checked.has(value);
      const text = document.createElement('span');
      text.textContent = label;
      item.append(input, text);
      return item;
    }));
    list.dataset.milthmSignature = signature;
  };
  // Injected into MultiLinePanel.render() (ui/multi-line.mjs) every time the panel is rebuilt.
  const injectMultiLineColumnControls = panel => {
    const host = panel?.host;
    if (!host) return;
    const existing = host.querySelector('[data-milthm-multiline-columns]');
    if (!isMilthmChart(editor.chart)) { existing?.remove(); return; }
    ensureColumnDefaults();
    let box = existing;
    if (!box) {
      box = document.createElement('div');
      box.className = 'milthm-edit-columns';
      box.dataset.milthmMultilineColumns = '1';
      const title = document.createElement('div');
      title.className = 'milthm-edit-columns-title';
      title.textContent = '编辑事件列（勾选的列显示在左侧；特殊事件层保持 RPEN 原生）';
      const list = document.createElement('div');
      list.className = 'milthm-edit-columns-list';
      list.addEventListener('change', () => applyEditColumnTypes(
        [...list.querySelectorAll('input:checked')].map(input => semanticColumnKind(input.value)).filter(Boolean),
      ));
      box.append(title, list);
      const expression = host.querySelector('.multi-line-expression-field');
      const listNode = host.querySelector('.multi-line-list');
      if (expression?.parentElement) expression.after(box);
      else if (listNode?.parentElement) listNode.before(box);
      else host.append(box);
    }
    const list = box.querySelector('.milthm-edit-columns-list');
    if (list) fillColumnCheckboxes(list, SEMANTIC_COLUMNS.map(kind => [semanticColumnKey(kind), semanticKindLabel(kind)]));
  };
  let multiLinePanelPatched = false;
  const patchMultiLinePanel = () => {
    const MultiLinePanel = internals.multiLine?.MultiLinePanel;
    if (!MultiLinePanel?.prototype || multiLinePanelPatched) return;
    multiLinePanelPatched = true;
    api.patch(MultiLinePanel.prototype, 'render', previous => function (...args) {
      const result = previous.apply(this, args);
      try { injectMultiLineColumnControls(this); } catch (error) { api.log('多线编辑面板：编辑事件列勾选注入失败', error); }
      return result;
    });
  };
  patchMultiLinePanel();
  // The 事件类型 dropdown of the batch-edit (多事件编辑) panel follows the same kinds: the
  // normal layer lists the 5 native columns, while multi-line events editing lists every semantic
  // kind (values are the pseudo-column keys so the filter matches the selected events).
  const adaptMultiEditTypes = () => {
    const panel = editor.multiEdit;
    const root = panel?.root;
    if (!root || panel.kind !== 'events') return;
    // The first adaptation removes the native 着色器 option, so remember the filter select itself
    // (the panel rebuilds it on every open()).
    const filter = root.querySelector('select[data-milthm-event-filter]')
      ?? [...root.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'paintEvents'));
    if (!filter) return;
    const options = multiEditTypeOptions();
    if (!options?.length) return;
    const signature = options.map(([value, label]) => `${value}=${label}`).join('|');
    if (filter.dataset.milthmEventTypes === signature) return;
    const previous = filter.value;
    filter.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    filter.value = options.some(([value]) => value === previous) ? previous : 'all';
    filter.dataset.milthmEventTypes = signature;
    filter.dataset.milthmEventFilter = '1';
    filter.title = isMilthmChart(editor.chart) ? 'Milthm 事件类型：标签对应当前事件列映射' : '';
  };
  // NOTE: keep the "already patched" flag in this activation scope, not on the panel object:
  // the panel instance is shared across disable/enable cycles of the mod, and a stale marker on it
  // would make a re-enabled mod skip patching (api.patch disposals are already restored on unload).
  let multiEditPatched = false;
  const patchMultiEditPanel = () => {
    const panel = editor.multiEdit;
    if (!panel || multiEditPatched) return;
    multiEditPatched = true;
    for (const method of ['open', 'sync']) {
      api.patch(panel, method, previous => function (...args) {
        const result = previous.apply(this, args);
        try { adaptMultiEditTypes(); } catch (error) { api.log('适配多线编辑面板失败', error); }
        return result;
      });
    }
  };
  patchMultiEditPanel();

  /* ---------------- semantic columns: initialise once per chart ---------------- */
  const ensuredCharts = new WeakSet();
  const maybeEnsureColumns = async () => {
    const chart = editor.chart;
    if (!isMilthmChart(chart) || ensuredCharts.has(chart)) return;
    ensuredCharts.add(chart);
    try {
      const next = ensureChartColumns(chart);
      if (!next || editor.chart !== chart) return;
      // Safety net against commit loops: only commit when a second pass is already converged.
      // (v0.6.3 looped here when a plain RPE line was added to a Milthm chart.)
      if (ensureChartColumns(next)) { api.log('Milthm 事件列初始化未收敛，跳过自动提交'); return; }
      editor.commit('初始化 Milthm 事件列', next);
    } catch (error) {
      api.log('初始化 Milthm 事件列失败', error);
    }
  };

  /* ---------------- native export dialog: add Milthm formats ---------------- */
  const injectMilthmExportOptions = () => {
    const dialog = document.querySelector('dialog[open]');
    if (!dialog || dialog.dataset.milthmExport) return;
    const format = [...dialog.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'next:pez'));
    const apply = dialog.querySelector('#modal-apply');
    if (!format || !apply) return;
    dialog.dataset.milthmExport = '1';
    format.append(new Option('Milthm · chart.json', 'milthm:json'), new Option('Milthm · 谱面包 zip', 'milthm:zip'));
    const original = apply.onclick;
    apply.onclick = event => {
      if (!format.value.startsWith('milthm:')) return original?.call(apply, event);
      const zip = format.value === 'milthm:zip';
      try {
        dialog.close();
        Promise.resolve(zip ? exportZip() : exportJson()).catch(error => api.notify('Milthm 导出失败：' + (error?.message ?? error), 'error'));
      } catch (error) { api.notify('Milthm 导出失败：' + (error?.message ?? error), 'error'); }
    };
  };
  const exportDialogClick = event => {
    if (event.target?.closest?.('#export')) setTimeout(injectMilthmExportOptions, 0);
  };
  document.addEventListener('click', exportDialogClick, true);
  api.dispose(() => document.removeEventListener('click', exportDialogClick, true));

  /* ---------------- new chart: offer a Milthm track chart ---------------- */
  const NEW_CHART_STYLE = `
.milthm-dialog-backdrop{position:fixed;inset:0;z-index:2147483010;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.milthm-dialog{width:min(420px,calc(100vw - 40px));background:#191c25;color:#e8ecf5;border:1px solid rgba(255,255,255,.18);
  border-radius:12px;padding:16px 18px;font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif;box-shadow:0 16px 48px rgba(0,0,0,.5)}
.milthm-dialog h3{margin:0 0 8px;color:#9ed0ff;font-size:15px}
.milthm-dialog .m-row{display:flex;gap:8px;margin:8px 0}
.milthm-dialog button{cursor:pointer;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:rgba(255,255,255,.08);
  color:#e8ecf5;padding:6px 10px;font:inherit;white-space:nowrap;flex:1}
.milthm-dialog button:hover{background:rgba(120,180,255,.22)}
.milthm-dialog .milthm-hint{color:#a9b4c7;font-size:11px;margin-top:8px;white-space:pre-wrap}
`;
  api.style(NEW_CHART_STYLE);
  const buildMilthmChart = () => {
    // Start from RPEN's createChart()/createLine() defaults: one line, one 1-beat-long event
    // per base track (X=0, Y=0, rotation=0, alpha=255, speed=10). No zero-length events.
    const rpeEvent = value => ({ startTime: [0, 0, 1], endTime: [0, 1, 1], start: value, end: value,
      easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 });
    // v0.6.5: Track 0 opacity is explicitly initialised to 255 on all three Milthm line-alpha
    // channels (整体 Transparency 2 / 线身 LineBody 8 / 线头 LineHead 9), 1 beat from beat 0.
    // Lines added later are initialised to 0 (transparent) the same way (see columns.mjs).
    const alphaInit = type => ({ type, startTime: [0, 0, 1], endTime: [0, 1, 1], start: 1, end: 1,
      ease: { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 } });
    const line = {
      Group: 0, Name: 'Track 0', Texture: 'line.png', anchor: [0.5, 0.5],
      bpmfactor: 1, father: -1, rotateWithFather: true, isCover: 1, isGif: false, zOrder: 0,
      eventLayers: [{
        moveXEvents: [rpeEvent(0)], moveYEvents: [rpeEvent(0)], rotateEvents: [rpeEvent(0)],
        alphaEvents: [rpeEvent(255)], speedEvents: [rpeEvent(10)],
      }],
      extended: {}, notes: [], numOfNotes: 0,
      'x-milthm': {
        sourceIndex: 0, rawExtras: [], applied: null,
        channels: { bodyAlpha: [], headAlpha: [], wholeAlpha: [], flowSpeed: [] },
        primaryAlphaType: MIL_ANIM.LINE_BODY_TRANSPARENCY,
        primarySpeedType: MIL_ANIM.FLOW_SPEED,
        events: {
          x: [rpeEvent(0)], y: [rpeEvent(0)], rotate: [rpeEvent(0)],
          flowSpeed: [rpeEvent(10)], speed: [], flowRaw: [], size: [],
          lineAlpha: [alphaInit(MIL_ANIM.TRANSPARENCY)],
          bodyAlpha: [alphaInit(MIL_ANIM.LINE_BODY_TRANSPARENCY)],
          headAlpha: [alphaInit(MIL_ANIM.LINE_HEAD_TRANSPARENCY)],
          wholeAlpha: [], legacy: [],
        },
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
  };
  const createMilthmChart = () => {
    try {
      editor.replace(buildMilthmChart(), 'milthm-chart.json');
      api.notify('已新建 Milthm 轨道谱面：时间轴上方五列的下拉框可直接选择要编辑的 Milthm 事件，导出在「导出」对话框里', 'success');
    } catch (error) {
      api.notify('新建 Milthm 谱面失败：' + (error?.message ?? error), 'error');
      api.log(error);
    }
  };
  let bypassNewChart = false;
  const openNewChartDialog = () => {
    document.querySelector('#milthm-new-chart-dialog')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'milthm-new-chart-dialog';
    overlay.className = 'milthm-dialog-backdrop';
    overlay.dataset.modInteractive = 'true';
    const dialog = document.createElement('div');
    dialog.className = 'milthm-dialog';
    dialog.innerHTML = '<h3>新建谱面</h3><div>选择要创建的谱面类型：</div>';
    const actions = document.createElement('div');
    actions.className = 'm-row';
    const rpeButton = document.createElement('button');
    rpeButton.textContent = '普通 RPE 谱面';
    rpeButton.addEventListener('click', () => {
      overlay.remove();
      bypassNewChart = true;
      try { document.querySelector('#new')?.click(); }
      finally { setTimeout(() => { bypassNewChart = false; }, 0); }
    });
    const milthmButton = document.createElement('button');
    milthmButton.textContent = 'Milthm 轨道谱面（fmt=2）';
    milthmButton.addEventListener('click', () => { overlay.remove(); createMilthmChart(); });
    const cancelButton = document.createElement('button');
    cancelButton.textContent = '取消';
    cancelButton.addEventListener('click', () => overlay.remove());
    actions.append(rpeButton, milthmButton, cancelButton);
    const hint = document.createElement('div');
    hint.className = 'milthm-hint';
    hint.textContent = 'Milthm 轨道谱面：每条判定线 = 一条轨道，音符 X 锁定为 0，可直接导出 Milthm 自制谱（fmt=2）。\n普通 RPE 谱面则保持原版行为。';
    dialog.append(actions, hint);
    overlay.append(dialog);
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    api.mount(overlay);
  };
  const interceptNewChart = event => {
    if (bypassNewChart) return;
    const target = event.target?.closest?.('#new, #home-new');
    if (!target) return;
    const mode = settings()['new-chart-mode'] ?? 'ask';
    if (mode === 'rpe') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (mode === 'milthm') { createMilthmChart(); return; }
    openNewChartDialog();
  };
  document.addEventListener('click', interceptNewChart, true);
  api.dispose(() => document.removeEventListener('click', interceptNewChart, true));

  /* ---------------- bind imported media into META ---------------- */
  const boundCharts = new WeakSet();
  const maybeBindMedia = async () => {
    const chart = editor.chart;
    if (!isMilthmChart(chart) || boundCharts.has(chart)) return;
    if (chart.META?.song && chart.META?.background) { boundCharts.add(chart); return; }
    boundCharts.add(chart);
    try {
      const files = internals.files;
      if (!files?.resourceReferences) return;
      const references = files.resourceReferences(chart, editor.assets ?? new Map(), editor.chartName ?? 'chart.json');
      const metaPatch = {};
      if (!chart.META?.song && references?.song) metaPatch.song = references.song;
      if (!chart.META?.background && references?.background) metaPatch.background = references.background;
      if (!Object.keys(metaPatch).length) return;
      if (editor.chart !== chart) return;
      const next = structuredClone(chart);
      next.META = { ...next.META, ...metaPatch };
      editor.commit('绑定 Milthm 媒体', next);
    } catch (error) {
      api.log('Milthm 媒体绑定失败', error);
    }
  };

  // Fallback poll: keep the panel/ExNote visibility in sync even if requestAnimationFrame
  // is throttled (background/occluded windows) and editor events do not arrive.
  let lastChartRef;
  const chartPoll = setInterval(() => {
    const chart = editor.chart;
    if (chart === lastChartRef) return;
    lastChartRef = chart;
    updateColumnOverlay();
    renderExCheckbox?.();
    maybeEnsureColumns().catch(() => {});
    try { adaptMultiEditTypes(); } catch (error) { api.log('适配多线编辑事件类型下拉失败', error); }
  }, 400);
  api.dispose(() => clearInterval(chartPoll));

  api.on('editor:chart', () => {
    installColumnOverlay();
    updateColumnOverlay();
    renderExCheckbox?.();
    maybeEnsureColumns().catch(() => {});
    maybeBindMedia().catch(error => api.log('Milthm 媒体绑定失败', error));
    maybeMigrateDim().catch(error => api.log('背景明暗迁移失败', error));
    try { adaptMultiEditTypes(); } catch (error) { api.log('适配多线编辑事件类型下拉失败', error); }
  });
  api.on('editor:state', () => {
    updateColumnOverlay();
    renderExCheckbox?.();
    try { adaptMultiEditTypes(); } catch (error) { api.log('适配多线编辑面板失败', error); }
    try { restrictEditableEvents(); } catch (error) { api.log('限制可编辑事件列失败', error); }
  });
  setTimeout(() => { installColumnOverlay(); updateColumnOverlay(); renderExCheckbox?.(); maybeEnsureColumns().catch(() => {}); maybeBindMedia().catch(() => {}); }, 0);
  editor.invalidate?.();

  return {
    dispose() {
      panel.remove();
      columnOverlay?.remove();
      document.querySelector('#milthm-timeline-select')?.parentElement?.remove();
    },
  };
}
