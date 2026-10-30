import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\main.mjs'
s = io.open(path, encoding='utf-8').read()

old = """  api.patch(Preview.prototype, 'drawScene', previous => function (...args) {
    this.__milthmSeconds = args[3];
    const chart = args[0];"""
new = """  api.patch(Preview.prototype, 'drawScene', previous => function (...args) {
    this.__milthmSeconds = args[3];
    const chart = args[1]; // drawScene(context, chart, tempo, seconds, ...)
"""
assert old in s, 'drawScene wrapper not found'
s = s.replace(old, new, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('drawScene chart argument fixed (args[1])')
