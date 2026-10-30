import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\main.mjs'
s = io.open(path, encoding='utf-8').read()

old = """  api.patch(Preview.prototype, 'drawScene', previous => function (...args) {
    this.__milthmSeconds = args[3];
    return previous.apply(this, args);
  });"""
new = """  api.patch(Preview.prototype, 'drawScene', previous => function (...args) {
    this.__milthmSeconds = args[3];
    const chart = args[0];
    if (!isMilthmChart(chart) || settings()['preview-tracks'] === false) return previous.apply(this, args);
    // RPEN culls lines by the bounds of the default line texture before drawLine is called.
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
    finally { this.images = images; }
  });"""
assert old in s, 'drawScene wrapper not found'
s = s.replace(old, new, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('offscreen culling patch applied')
