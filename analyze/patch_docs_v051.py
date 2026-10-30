import io

readme = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\README.md'
s = io.open(readme, encoding='utf-8').read()
s = s.replace('# Milthm fmt=2 Bridge · RPEN 模组（v0.5）', '# Milthm fmt=2 Bridge · RPEN 模组（v0.5.1）', 1)
anchor = '### Milthm 透明度事件对照（v0.5）'
add = '''### v0.5.1：同拍新事件优先

导入的谱面常在某个拍点带一个**零时长（start=end）的 `0→1` 重置事件**。RPEN 的 EventTrack 对同拍事件按数组顺序取最后一个生效；如果它排在你新加的事件后面，就会在那一刻把不透明度拉回 255（看起来像“结束后恢复”）。v0.5.1 在提交时把**新加/编辑的同拍事件稳定排到导入事件之后**，所以你的 0 值事件会覆盖导入的重置事件。

'''
assert anchor in s
s = s.replace(anchor, add + anchor, 1)
io.open(readme, 'w', encoding='utf-8').write(s)
print('README updated')

doc = r'E:\File\deepseek harness\mil\RPEN-Milthm桥接-v0.4-事件列与导出集成.md'
s = io.open(doc, encoding='utf-8').read()
s = s.replace('- v0.5.0，117,988 字节，SHA256 `855EF51CF579D35426FB78C78DE20078F998B75299D5701418266F239D89C53B`',
              '- v0.5.1，120,022 字节，SHA256 `C30317C04E21C70BFFB6E06784959EB21D72AC8A457927266A02A8D59D486007`')
add = '''

---

## 9. v0.5.1：同拍零时长事件的顺序修复

Class Memories 的 7 号线在 8.75 拍有一个**零时长（start=end）`0 → 1` Transparency 事件**（`[8:6/8] → [8:3/4]`）。RPEN 的 EventTrack 对同拍事件按数组顺序取最后一个：若导入的零时长事件排在你新加的 0 事件之后，它就会在 8.75 拍把 alpha 瞬间拉回 255 —— 看起来就是“轨道整体不透明度结束后又恢复”。

v0.5.1 修复：提交同步时按开始拍稳定排序，并且**新加/编辑的事件排在旧的导入事件之后**（旧事件之间相对顺序不变），同拍时用户事件生效。

验证：

- 离线 `tie-order-test.mjs`：模拟时间轴把 0 事件插到导入零时长事件**之前**，修复后 beat 8.75 的 alpha = **0**（修复前会被导入的 0→1 事件覆盖成 255）；
- 无头 RPEN：同样场景下单线（7 号线）在 beat 8.75 的 `state.alpha = 0`；
- 未编辑谱面语义导出仍 **0 diff**；`integration-test3.mjs` 全绿。

> 另外提醒：7 号线的 rotation 是 -90°、头在屏幕左侧外，所以画面里只看到它横穿顶部的一段轨道——这是 v0.4 起“屏幕外轨道也绘制”的正常表现，不是隐身失败。
'''
s = s + add
io.open(doc, 'w', encoding='utf-8').write(s)
print('doc updated')
