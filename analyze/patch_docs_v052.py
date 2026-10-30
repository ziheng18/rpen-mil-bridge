import io

readme = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\README.md'
s = io.open(readme, encoding='utf-8').read()
s = s.replace('# Milthm fmt=2 Bridge · RPEN 模组（v0.5.1）', '# Milthm fmt=2 Bridge · RPEN 模组（v0.5.2）', 1)
anchor = '### v0.5.1：同拍新事件优先'
add = '''### v0.5.2：透明度初始化补 255

按 Rain Editor 的语义（缺失的透明度轨道默认 1.0 = 完全不透明），导入谱面时如果某条线**部分**透明度轨道有事件、而其它透明度轨道没有事件，就在这些已有事件里**最早的开始拍**给缺失的轨道补一条 `255 → 255` 的初始化事件：

- 线体(8)/线头(9) 有事件但 轨道整体(2) 没有 → 给 type2 补 255；
- 轨道整体(2) 有事件但 线体/线头 没有 → 给 type8、type9 补 255；
- 音符整体(13) 与其他轨道之间同理（全部缺失时也补）。

这些初始化事件只用于 RPEN 的显示/编辑（时间轴上能看到 255），**导出时会被过滤掉**，所以源谱导出仍是 0 diff（Milthm 自己也会把缺失的透明度默认成 1）。

'''
assert anchor in s
s = s.replace(anchor, add + anchor, 1)
io.open(readme, 'w', encoding='utf-8').write(s)
print('README v0.5.2 updated')

doc = r'E:\File\deepseek harness\mil\RPEN-Milthm桥接-v0.4-事件列与导出集成.md'
s = io.open(doc, encoding='utf-8').read()
s = s.replace('- v0.5.1，120,508 字节，SHA256 `587619A088B8291E37275BE6B3E06B81E2FBB10D5560DB070A4E201A2995123D`', '- v0.5.2，待打包，SHA256 待定')
s += '''

---

## 10. v0.5.2：透明度初始化（对齐 Rain Editor）

Rain Editor 渲染时，缺失的透明度轨道默认为 **1.0（完全不透明）**；只有在对应 bearer 有动画时才用动画值。为了让 RPEN 里也显式体现这个初始状态，v0.5.2 在导入时做：

- 收集每条线的透明度轨道 `Transparency(2) / LineBody(8) / LineHead(9) / Whole(13)`；
- 只要其中**至少一条有事件**，就在这些事件里**最早的开始拍**给**所有没有事件**的透明度轨道补一条 `1 → 1`（RPEN 显示 255）的初始化事件；
- 初始化事件带 `syntheticInit` 标记，**导出时过滤掉**，因此未编辑谱面导出仍 **0 diff**（Milthm 侧缺失透明度本来就默认 1）。

实测（Class Memories 7 号线，只有 type2 事件）：

| 语义轨道 | 事件数 | 第一条事件 |
|---|---|---|
| lineAlpha(2) | 144 | 原始事件，最早 2:2/8 |
| bodyAlpha(8) | 1 | 2:2/8，`255 → 255`，syntheticInit |
| headAlpha(9) | 1 | 2:2/8，`255 → 255`，syntheticInit |
| wholeAlpha(13) | 1 | 2:2/8，`255 → 255`，syntheticInit |

时间轴第 4 列（默认线体不透明度）首条事件也显示为 `255 → 255`；命令导出 chart.json 与原始谱面语义仍是 **0 diff**。
'''
io.open(doc, 'w', encoding='utf-8').write(s)
print('doc v0.5.2 updated')
