import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\main.mjs'
s = io.open(path, encoding='utf-8').read()

old = """    // RPEN culls lines by the bounds of the default line texture before drawLine is called.
    // A Milthm track is a long ribbon along the note direction, so its visible geometry can
    // cross the viewport even when the line head (and the default texture) is off-screen.
    // Temporarily expose an unbounded texture descriptor so the culling never drops our track.
    const images = this.images;
    if (!images) return previous.apply(this, args);
    const proxy = new Proxy(images, {
      get(target, property, receiver) {
        if (property === 'describe') return () => ({ naturalWidth: 1e6, naturalHeight: 1e6 });
        if (property === 'images') return new Map();
        return Reflect.get(target, property, receiver);
      },
    });
    this.images = proxy;
    try { return previous.apply(this, args); }
    finally { this.images = images; }"""
new = """    // RPEN culls a line by the bounds of the default line texture (a thin horizontal strip)
    // before drawLine is called. A Milthm track is a long ribbon along the note direction, so
    // its visible geometry can cross the viewport while the head (and the default texture) is
    // off-screen. Temporarily explode the default line texture height so the culling always
    // lets our track through; the draw itself is replaced by drawTrack and ignores lineScale.
    const lineScale = this.lineScale;
    this.lineScale = 1e6;
    try { return previous.apply(this, args); }
    finally { this.lineScale = lineScale; }"""
assert old in s, 'old culling patch not found'
s = s.replace(old, new, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('culling patch v2 applied')
