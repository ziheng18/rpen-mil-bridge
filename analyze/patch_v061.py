import io

# ---------------- columns.mjs: single 1-beat 0 initialization, cross-category only ----------------
path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\columns.mjs'
s = io.open(path, encoding='utf-8').read()

start = s.index('function makeSyntheticAlphaInit')
end = s.index('export function deriveSemantics')
new_block = '''function makeSyntheticAlphaInit(type) {
  const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
  // One beat long, starting at beat 0, fully transparent (0). Never zero-length.
  return { type, startTime: [0, 0, 1], endTime: [0, 1, 1], start: 0, end: 0, ease, syntheticInit: true };
}

// Missing line-transparency tracks are initialised with a single 1-beat fully transparent (0)
// event, starting at beat 0:
//  - lineAlpha missing, body/head present  -> initialise lineAlpha;
//  - lineAlpha present, body AND head both missing -> initialise body and head;
//  - body/head are peers: never auto-fill one from the other.
// WholeTransparency(13) affects notes and is left alone.
function addTransparencyInitializers(semantics) {
  const has = key => (semantics[key] ?? []).length > 0;
  const lineAlpha = has('lineAlpha');
  const bodyAlpha = has('bodyAlpha');
  const headAlpha = has('headAlpha');
  if (!lineAlpha && !bodyAlpha && !headAlpha) return;
  const targets = [];
  if (!lineAlpha && (bodyAlpha || headAlpha)) targets.push({ key: 'lineAlpha', type: MIL_ANIM.TRANSPARENCY });
  if (lineAlpha && !bodyAlpha && !headAlpha) {
    targets.push({ key: 'bodyAlpha', type: MIL_ANIM.LINE_BODY_TRANSPARENCY });
    targets.push({ key: 'headAlpha', type: MIL_ANIM.LINE_HEAD_TRANSPARENCY });
  }
  for (const target of targets) {
    if ((semantics[target.key] ?? []).length) continue;
    semantics[target.key] = [makeSyntheticAlphaInit(target.type)];
  }
}

'''
s = s[:start] + new_block + s[end:]
io.open(path, 'w', encoding='utf-8').write(s)
print('columns.mjs v0.6.1 init rule applied')

# ---------------- main.mjs: new chart semantics explicitly, no synthetic 255 init ----------------
path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\main.mjs'
s = io.open(path, encoding='utf-8').read()
old = """      extended: {}, notes: [], numOfNotes: 0,
      'x-milthm': {
        sourceIndex: 0, rawExtras: [],
        channels: { bodyAlpha: [], headAlpha: [], wholeAlpha: [], flowSpeed: [] },
        primaryAlphaType: MIL_ANIM.LINE_BODY_TRANSPARENCY,
        primarySpeedType: MIL_ANIM.FLOW_SPEED,
      },"""
new = """      extended: {}, notes: [], numOfNotes: 0,
      'x-milthm': {
        sourceIndex: 0, rawExtras: [], applied: null,
        channels: { bodyAlpha: [], headAlpha: [], wholeAlpha: [], flowSpeed: [] },
        primaryAlphaType: MIL_ANIM.LINE_BODY_TRANSPARENCY,
        primarySpeedType: MIL_ANIM.FLOW_SPEED,
        // RPEN-style semantics: the line's alpha is opaque (255). Milthm's extra head/whole
        // tracks stay empty here (preview keeps their Rain Editor defaults) and no synthetic
        // zero-length events are written for a new chart.
        events: {
          x: [rpeEvent(0)], y: [rpeEvent(0)], rotate: [rpeEvent(0)],
          flowSpeed: [rpeEvent(10)], speed: [], flowRaw: [], size: [],
          lineAlpha: [], bodyAlpha: [{ type: MIL_ANIM.LINE_BODY_TRANSPARENCY, startTime: [0, 0, 1], endTime: [0, 1, 1], start: 1, end: 1,
            ease: { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 } }],
          headAlpha: [], wholeAlpha: [], legacy: [],
        },
      },"""
assert old in s
s = s.replace(old, new, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('main.mjs new chart semantics patched')
