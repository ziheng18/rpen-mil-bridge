import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\columns.mjs'
s = io.open(path, encoding='utf-8').read()

def rep(old, new, count=1):
    global s
    assert old in s, 'missing anchor: ' + old[:90]
    s = s.replace(old, new, count)

rep("""export const COLUMN_LABELS = {
  x: 'X 坐标', y: 'Y 坐标', rotate: '旋转',
  bodyAlpha: '线体不透明度', headAlpha: '线头不透明度', wholeAlpha: '音符整体不透明度',
  flowSpeed: '流速倍率', size: '轨道大小',
};
export const ALPHA_KEYS = new Set(['bodyAlpha', 'headAlpha', 'wholeAlpha']);""",
"""export const COLUMN_LABELS = {
  x: 'X 坐标', y: 'Y 坐标', rotate: '旋转',
  lineAlpha: '轨道整体不透明度', bodyAlpha: '线体不透明度', headAlpha: '线头不透明度', wholeAlpha: '音符整体不透明度',
  flowSpeed: '流速倍率', size: '轨道大小',
};
export const COLUMN_LABELS_FULL = {
  lineAlpha: '轨道整体不透明度（线头+线身，Transparency 2）',
  bodyAlpha: '线体不透明度（LineBodyTransparency 8）',
  headAlpha: '线头不透明度（LineHeadTransparency 9）',
  wholeAlpha: '音符整体不透明度（WholeTransparency 13）',
};
export const ALPHA_KEYS = new Set(['lineAlpha', 'bodyAlpha', 'headAlpha', 'wholeAlpha']);""")

rep("const ALPHA_CANDIDATES = ['bodyAlpha', 'headAlpha', 'wholeAlpha'];",
    "const ALPHA_CANDIDATES = ['lineAlpha', 'bodyAlpha', 'headAlpha', 'wholeAlpha'];")

rep("""export const MIL_ANIM_TYPES = {
  bodyAlpha: MIL_ANIM.LINE_BODY_TRANSPARENCY,
  headAlpha: MIL_ANIM.LINE_HEAD_TRANSPARENCY,
  wholeAlpha: MIL_ANIM.WHOLE_TRANSPARENCY,
};""",
"""export const MIL_ANIM_TYPES = {
  lineAlpha: MIL_ANIM.TRANSPARENCY,
  bodyAlpha: MIL_ANIM.LINE_BODY_TRANSPARENCY,
  headAlpha: MIL_ANIM.LINE_HEAD_TRANSPARENCY,
  wholeAlpha: MIL_ANIM.WHOLE_TRANSPARENCY,
};

function rawSnapshot(event) {
  const raw = event?.['x-milthm']?.raw;
  return raw && Number.isFinite(Number(raw.type)) ? clone(raw) : null;
}

function carrierEventsToRaw(events, type) {
  return (events ?? []).filter(event => !event?.['x-milthm']?.synthetic).map(event => rawSnapshot(event) ?? carrierEventToRaw(event, type));
}""")

rep("""  const semantics = {
    x: cloneEvents(layer.moveXEvents),
    y: cloneEvents(layer.moveYEvents),
    rotate: cloneEvents(layer.rotateEvents),
    flowSpeed: [], speed: [], flowRaw: [],
    size: cloneEvents(extended.scaleXEvents),
    bodyAlpha: [], headAlpha: [], wholeAlpha: [], legacy: [],
  };""",
"""  const semantics = {
    x: cloneEvents(layer.moveXEvents),
    y: cloneEvents(layer.moveYEvents),
    rotate: cloneEvents(layer.rotateEvents),
    flowSpeed: [], speed: [], flowRaw: [],
    size: cloneEvents(extended.scaleXEvents),
    lineAlpha: [], bodyAlpha: [], headAlpha: [], wholeAlpha: [], legacy: [],
  };""")

rep("""  const primaryAlpha = Number(stash.primaryAlphaType);
  const alphaEvents = layer.alphaEvents ?? [];
  if (primaryAlpha === MIL_ANIM.LINE_BODY_TRANSPARENCY) semantics.bodyAlpha = alphaEvents.map(event => carrierEventToRaw(event, MIL_ANIM.LINE_BODY_TRANSPARENCY));
  else if (primaryAlpha === MIL_ANIM.WHOLE_TRANSPARENCY) semantics.wholeAlpha = alphaEvents.map(event => carrierEventToRaw(event, MIL_ANIM.WHOLE_TRANSPARENCY));
  else if (primaryAlpha === MIL_ANIM.TRANSPARENCY) semantics.legacy = cloneEvents(alphaEvents);
  else if (alphaEvents.length && !alphaEvents.every(event => event?.['x-milthm']?.synthetic)) semantics.legacy = cloneEvents(alphaEvents);""",
"""  const primaryAlpha = Number(stash.primaryAlphaType);
  const alphaEvents = layer.alphaEvents ?? [];
  if (primaryAlpha === MIL_ANIM.LINE_BODY_TRANSPARENCY) semantics.bodyAlpha = carrierEventsToRaw(alphaEvents, MIL_ANIM.LINE_BODY_TRANSPARENCY);
  else if (primaryAlpha === MIL_ANIM.WHOLE_TRANSPARENCY) semantics.wholeAlpha = carrierEventsToRaw(alphaEvents, MIL_ANIM.WHOLE_TRANSPARENCY);
  else if (primaryAlpha === MIL_ANIM.TRANSPARENCY) semantics.lineAlpha = carrierEventsToRaw(alphaEvents, MIL_ANIM.TRANSPARENCY);
  else if (alphaEvents.length && !alphaEvents.every(event => event?.['x-milthm']?.synthetic)) semantics.lineAlpha = carrierEventsToRaw(alphaEvents, MIL_ANIM.TRANSPARENCY);""")

rep("""    next[key] = ALPHA_KEYS.has(key) ? carrier.map(event => carrierEventToRaw(event, MIL_ANIM_TYPES[key])) : cloneEvents(carrier);""",
"""    next[key] = ALPHA_KEYS.has(key) ? carrierEventsToRaw(carrier, MIL_ANIM_TYPES[key]) : cloneEvents(carrier);""")

# export builder: include line-alpha raw animations in rawExtras
rep("""    stash.rawExtras = [...(stash.rawExtras ?? []), ...legacyRaw];""",
"""    const lineAlphaRaw = (semantics.lineAlpha ?? []).map(raw => ({ ...clone(raw), type: MIL_ANIM.TRANSPARENCY }));
    stash.rawExtras = [...(stash.rawExtras ?? []), ...lineAlphaRaw, ...legacyRaw];""")

# scene injection: native alpha track carries the line-wide transparency (type 2)
rep("""  return {
    moveXEvents: semantics.x,
    moveYEvents: semantics.y,
    rotateEvents: semantics.rotate,
    speedEvents: useSpeed ? semantics.speed : semantics.flowSpeed,
    alphaEvents: [constantEvent(255)],
    scaleXEvents: semantics.size,
    scaleYEvents: semantics.size,
  };""",
"""  const lineAlphaCarrier = (semantics.lineAlpha ?? []).length
    ? semantics.lineAlpha.map(raw => rawToCarrierEvent(raw))
    : [constantEvent(255)];
  return {
    moveXEvents: semantics.x,
    moveYEvents: semantics.y,
    rotateEvents: semantics.rotate,
    speedEvents: useSpeed ? semantics.speed : semantics.flowSpeed,
    alphaEvents: lineAlphaCarrier,
    scaleXEvents: semantics.size,
    scaleYEvents: semantics.size,
  };""")

io.open(path, 'w', encoding='utf-8').write(s)
print('columns.mjs v0.5 lineAlpha patch applied')
