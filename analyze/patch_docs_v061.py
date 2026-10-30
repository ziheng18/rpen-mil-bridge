import io

readme = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\README.md'
s = io.open(readme, encoding='utf-8').read()
s = s.replace('# Milthm fmt=2 Bridge · RPEN 模组（v0.6.0）', '# Milthm fmt=2 Bridge · RPEN 模组（v0.6.1）', 1)
start = s.find('### v0.6.0：透明度初始化 + 新建谱面按 RPEN 默认')
end = s.find('### Milthm 透明度事件对照（v0.5）', start)
assert start >= 0 and end > start
section = '''### v0.6.1：透明度初始化 + 新建谱面按 RPEN 默认

导入谱面时，缺失的**线视觉透明度**轨道（轨道整体 2 / 线体 8 / 线头 9）按下面规则补一条初始化事件：

- 只补一条：**从 0 拍开始、持续 1 拍、完全不透明 0（即完全透明）**，不写后面的 255 切换事件，也不再“持续到最早开始拍”；
- 补哪些轨道：
  - `轨道整体(2)` 缺失，而 `线体(8)` 或 `线头(9)` 有事件 → 补 type2；
  - `轨道整体(2)` 有事件，而 `线体(8)` 和 `线头(9)` **都**没有事件 → 补 type8、type9；
  - `线体/线头` 是平级轨道：一个有一个没有时，**不**给缺失的那个补事件；
- 缺失轨道如果本来已经有 0 不透明度初始化事件，就不重复补；
- 音符整体 `WholeTransparency(13)` 不处理（保持默认，避免音符提前消失）；
- 初始化事件带 `syntheticInit` 标记，**导出时过滤**，源谱导出仍是 0 diff。

新建 Milthm 谱面参照原 RPEN `createChart()/createLine()`：每条基础轨道一条 **1 拍长**的默认事件
（X=0、Y=0、旋转=0、不透明度=255、速度=10），不写长度为 0 的事件；线透明度额外轨道不写 synthetic 初始化。

'''
s = s[:start] + section + s[end:]
io.open(readme, 'w', encoding='utf-8').write(s)
print('README v0.6.1 updated')

doc = r'E:\File\deepseek harness\mil\RPEN-Milthm桥接-v0.4-事件列与导出集成.md'
s = io.open(doc, encoding='utf-8').read()
start = s.find('## 11. v0.6.0：透明度初始化修正 + 新建谱面按原 RPEN')
assert start >= 0
section = '''## 11. v0.6.1：透明度初始化（0 起 1 拍、完全透明）+ 新建谱按原 RPEN

### 导入谱的缺失透明度轨道

只处理线的视觉透明度 `Transparency(2)` / `LineBody(8)` / `LineHead(9)`；`WholeTransparency(13)` 不处理。规则：

| 情况 | 补什么 |
|---|---|
| 2 缺失，8 或 9 有事件 | 补一条 type2 |
| 2 有事件，8 和 9 都缺失 | 补 type8 + type9 |
| 8 有事件、9 缺失（或反之） | **不补**（线体/线头是平级轨道，不互相补） |
| 目标轨道本来已有 0 初始化 | 不重复补 |

每条初始化事件都是：**从 0 拍开始、持续 1 拍、start=end=0（完全透明）**；不再写 255 切换事件、不写“持续到最早开始拍”的长事件、不写零长度事件。带 `syntheticInit` 标记，导出时过滤，源谱导出仍 **0 diff**。

实测 Class Memories 7 号线（只有 type2 事件）：bodyAlpha / headAlpha 各得到一条
`[0:0/1] → [0:1/1]`、`start=end=0`、`syntheticInit=true`、`zeroLength=false` 的初始化事件；wholeAlpha 保持为空。

> 注意：按这套规则，只有 type2 事件的线（如 7 号线）body/head 会被初始化成 0，整条线保持完全透明 —— 这是“缺失轨道初始为完全透明”的直接结果。

### 新建谱面（参照原 RPEN）

`buildMilthmChart()` 直接构造 RPEN `createChart()/createLine()` 风格的一行谱：

- 5 条基础轨道各一条 **1 拍长**常值事件：X=0、Y=0、旋转=0、不透明度=255、速度=10；
- 语义层同步给出：X/Y/旋转/流速（RPE 事件）以及 bodyAlpha=1（raw Milthm，对应 255）；lineAlpha/headAlpha 不写 synthetic 事件；
- 不写任何长度为 0 的事件；
- 实测新建谱 5 条基础事件全部 `[0:0/1] → [0:1/1]`、`zeroLength=false`，列下拉/导出正常。

'''
s = s[:start] + section
io.open(doc, 'w', encoding='utf-8').write(s)
print('doc v0.6.1 updated')
