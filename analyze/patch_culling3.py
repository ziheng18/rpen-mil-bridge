import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\main.mjs'
s = io.open(path, encoding='utf-8').read()

old = """    // RPEN culls a line by the bounds of the default line texture (a thin horizontal strip)
    // before drawLine is called. A Milthm track is a long ribbon along the note direction, so
    // its visible geometry can cross the viewport while the head (and the default texture) is
    // off-screen. Temporarily explode the default line texture height so the culling always
    // lets our track through; the draw itself is replaced by drawTrack and ignores lineScale.
    const lineScale = this.lineScale;
    this.lineScale = 1e6;
    try { return previous.apply(this, args); }
    finally { this.lineScale = lineScale; }"""
new = """    // RPEN culls a line by the bounds of the default line texture (a thin horizontal strip)
    // before drawLine is called. A Milthm track is a long ribbon along the note direction, so
    // its visible geometry can cross the viewport while the head is off-screen. During this
    // drawScene only, give every line a huge virtual texture descriptor / texture name so the
    // native culling cannot drop our track; drawLine is replaced by drawTrack and ignores them.
    const images = this.images;
    const runtimes = this.scene?.lines ?? [];
    if (!images || !runtimes.length) return previous.apply(this, args);
    const originalDescribe = images.describe;
    const textureRestores = runtimes.map(runtime => [runtime.line, runtime.line.Texture]);
    images.describe = () => ({ naturalWidth: 1e6, naturalHeight: 1e6 });
    for (const runtime of runtimes) runtime.line.Texture = '__milthm_track__';
    try { return previous.apply(this, args); }
    finally {
      images.describe = originalDescribe;
      for (const [line, texture] of textureRestores) line.Texture = texture;
    }"""
assert old in s, 'lineScale culling patch not found'
s = s.replace(old, new, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('texture-based culling bypass applied')
