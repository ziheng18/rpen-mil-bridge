import io

readme = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\README.md'
s = io.open(readme, encoding='utf-8').read()
s = s.replace('# Milthm fmt=2 Bridge · RPEN 模组（v0.6.1）', '# Milthm fmt=2 Bridge · RPEN 模组（v0.6.2）', 1)
start = s.find('### v0.6.1：透明度初始化 + 新建谱面按 RPEN 默认')
end = s.find('### Milthm 透明度事件对照（v0.5）', start)
assert start >= 0 and end > start
section = '''### v0.6.2：透明度初始化（0 起 1 拍 + 事件开始拍 255）

导入谱面时，缺失的**线视觉透明度**轨道（轨道整体 2 / 线体 8 / 线头 9）会补两条初始化事件：

1. **从 0 拍开始、持续 1 拍、值 0（完全透明）**；
2. **在其他透明度类型的事件开始拍**，补一条 **值 255（完全不透明）、持续 1 拍** 的事件。

补哪些轨道：

- `轨道整体(2)` 缺失，而 `线体(8)` 或 `线头(9)` 有事件 → 补 type2；
- `轨道整体(2)` 有事件，而 `线体(8)` 和 `线头(9)` **都**没有事件 → 补 type8、type9；
- `线体/线头` 是平级轨道：一个有一个没有时，**不**给缺失的那个补；
- 目标轨道本来已有 0 初始化事件时不重复补；
- 音符整体 `WholeTransparency(13)` 不处理；
- 事件时长均为 1 拍（非零时长），带 `syntheticInit`，**导出时过滤**，源谱导出仍是 0 diff。

新建 Milthm 谱面参照原 RPEN `createChart()/createLine()`：每条基础轨道一条 **1 拍长**默认事件
（X=0、Y=0、旋转=0、不透明度=255、速度=10），不写长度为 0 的事件，也不写 synthetic 透明度初始化。

'''
s = s[:start] + section + s[end:]
io.open(readme, 'w', encoding='utf-8').write(s)
print('README v0.6.2 updated')

doc = r'E:\File\deepseek harness\mil\RPEN-Milthm桥接-v0.4-事件列与导出集成.md'
s = io.open(doc, encoding='utf-8').read()
start = s.find('## 11. v0.6.1：')
assert start >= 0
section = '''## 11. v0.6.2：透明度初始化（0 起 1 拍 + 事件开始拍 255）+ 新建谱按原 RPEN

### 导入谱的缺失线透明度轨道

只处理 `Transparency(2)` / `LineBody(8)` / `LineHead(9)`；`WholeTransparency(13)` 不处理。规则：

| 情况 | 补什么 |
|---|---|
| 2 缺失，8 或 9 有事件 | 补 type2 |
| 2 有事件，8 和 9 都缺失 | 补 type8 + type9 |
| 8 有事件、9 缺失（或反之） | **不补**（平级轨道不互相补） |
| 目标轨道已有 0 初始化 | 不重复补 |

每条目标轨道补两条事件：

1. `[0:0/1] → [0:1/1]`，值 **0**（完全透明），1 拍长；
2. 在已有透明度事件里**最早的开始拍**（如 `2:2/8`），补 `[该拍] → [该拍+1拍]`，值 **255**（完全不透明），1 拍长。

两条都非零时长、带 `syntheticInit` 标记，导出时过滤，源谱导出仍 **0 diff**。

实测 Class Memories 7 号线（只有 type2 事件）：

| 轨道 | 初始化事件 |
|---|---|
| bodyAlpha | `[0:0/1→0:1/1] = 0`、`[2:2/8→3:2/8] = 255` |
| headAlpha | 同上 |
| wholeAlpha | 保持为空 |

### 新建谱面（参照原 RPEN）

`buildMilthmChart()` 直接构造 RPEN `createChart()/createLine()` 风格谱面：5 条基础轨道各一条 1 拍长常值事件
（X=0、Y=0、旋转=0、不透明度=255、速度=10）；不写长度为 0 的事件，也不写 synthetic 透明度初始化。
实测新建谱 5 条基础事件全部 `[0:0/1] → [0:1/1]`、`zeroLength=false`。

'''
s = s[:start] + section
io.open(doc, 'w', encoding='utf-8').write(s)
print('doc v0.6.2 updated')
