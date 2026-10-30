import io

readme = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\README.md'
s = io.open(readme, encoding='utf-8').read()
s = s.replace('# Milthm fmt=2 Bridge · RPEN 模组（v0.5.2）', '# Milthm fmt=2 Bridge · RPEN 模组（v0.6.0）', 1)

old_start = s.find('### v0.5.2：透明度初始化补 255')
old_end = s.find('### Milthm 透明度事件对照（v0.5）', old_start)
assert old_start >= 0 and old_end > old_start
new_section = '''### v0.6.0：透明度初始化 + 新建谱面按 RPEN 默认

导入谱面时，如果某条线**部分**透明度轨道（轨道整体 2 / 线体 8 / 线头 9）有事件、其它轨道没有：

- 缺失的轨道从 0 拍开始先给一条 **完全透明（0）** 的事件，持续到已有事件的最早开始拍；
- 到那个开始拍再给一条 **完全不透明（255）** 的事件（非零时长，一条 1 拍长的常值事件）；
- 之后缺失轨道保持 255，不再把其他轨道的透明度乘暗。

只处理**线的视觉透明度**（2/8/9）；音符整体透明度（13）保持 RPEN/Milthm 的默认不透明，避免音符提前消失。
这些初始化事件带 `syntheticInit` 标记，**导出时过滤**，所以源谱导出仍是 0 diff。

新建 Milthm 谱面改为参照原 RPEN `createChart()/createLine()` 的初始化：每条基础轨道一条 **1 拍长** 的默认事件
（X=0、Y=0、旋转=0、透明度=255、速度=10），不再写长度为 0 的事件；缺失的线透明度轨道同样补非零时长的初始化事件。

'''
s = s[:old_start] + new_section + s[old_end:]
io.open(readme, 'w', encoding='utf-8').write(s)
print('README v0.6.0 updated')

doc = r'E:\File\deepseek harness\mil\RPEN-Milthm桥接-v0.4-事件列与导出集成.md'
s = io.open(doc, encoding='utf-8').read()
s = s.replace('- v0.5.2，123,277 字节，SHA256 `D843DF99340F0756B10084D187AF154C1851EF847D98067710453F960A6156AD`', '- v0.6.0，待打包，SHA256 待定')
s += '''

---

## 11. v0.6.0：透明度初始化修正 + 新建谱面按原 RPEN

### 透明度初始化（导入谱）

上一版（v0.5.2）把缺失轨道初始化成了 255；正确行为应为：**默认完全透明（0）**，直到已有透明度事件开始的拍才变成完全不透明（255），之后不再乘暗。v0.6.0 改为（只处理线视觉透明度 2/8/9，Whole13 保持默认）：

- 缺失轨道从 0 拍开始：一条 `0 → 0` 的**非零时长**事件，持续到已有事件的最早开始拍；
- 到该拍：一条 `1 → 1`（RPEN 255）的 **1 拍长**常值事件；
- 两条都带 `syntheticInit`，导出时过滤，源谱导出仍是 0 diff。

实测 Class Memories 7 号线（只有 type2 事件，最早在 `2:2/8`）：bodyAlpha / headAlpha 各得到
`[0:0/1 → 2:2/8] = 0` 与 `[2:2/8 → 3:2/8] = 1` 两条非零时长初始化事件；wholeAlpha 保持为空。

### 新建谱面初始化（参照原 RPEN）

`buildMilthmChart()` 不再用最小 Milthm 源经转换生成零时长 synthetic 事件，而是按 RPEN `createChart()/createLine()`：

- 一条判定线，5 条基础轨道各一条 **1 拍长**的常值事件：X=0、Y=0、旋转=0、透明度=255、速度=10；
- 加上 `x-milthm` 标记（fmt=2、columns 默认、primaryAlphaType=LineBody、primarySpeedType=FlowSpeed）；
- 缺失的线透明度轨道按上面的规则补**非零时长**初始化事件；
- 不再写任何长度为 0 的事件。

实测新建谱：5 条基础事件全部 `[0:0/1] → [0:1/1]`（`zeroLength=false`），lineAlpha/headAlpha 初始化为 1 拍长事件，列下拉和导出正常。

'''
io.open(doc, 'w', encoding='utf-8').write(s)
print('doc v0.6.0 appended')
