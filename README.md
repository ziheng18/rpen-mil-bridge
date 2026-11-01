[README.md](https://github.com/user-attachments/files/34220157/README.md)
# Milthm fmt=2 Bridge · RPEN 模组

在 **Re:PhiEdit Next（RPEN）** 里导入 / 编辑 / 导出 **Milthm 自制谱（fmt=2）**。

Milthm 是轨道式：`lines[]` 的每条就是一条轨道，同轨道音符没有不同 X 坐标。本模组把每条 Milthm
线映射成 RPEN 的一条判定线，并把音符 X 锁定为 0；未编辑的谱面导出时与源谱语义 **0 diff**。

## 安装

1. 打开RPEN
2. 右上角「模组」→「导入模组」→ 选择 `milthm-fmt2-bridge.rpenmod` → 勾选风险确认 → **启用**。
3. 更新模组：再次导入同 ID 包会替换旧版本（需确认），然后重新启用并**刷新页面**。

改动源码后重新打包（输出不要落在本目录，否则旧包会被一起打进去）：

```powershell
node "<rpe-next>\tools\pack-mod.mjs" "<本目录>" "%TEMP%\milthm-fmt2-bridge.rpenmod"
copy "%TEMP%\milthm-fmt2-bridge.rpenmod" "<本目录>\"
```

## 功能

- **导入**：首页「打开 JSON / PEZ」选 Milthm 谱面包 zip（`meta.json + chart.json + 资源`），自动转换并绑定
  音频/曲绘。
- **事件列下拉**：原生 5 个事件列变成 Milthm 语义槽位（X、Y、旋转、线体/线头/整体不透明度、流速倍率、
  轨道大小），表头可直接换列；第 4 列 alpha 轨只能放四种透明度。预览播放时这排下拉自动隐藏。
- **Milthm 通道面板**：线体/线头/整体不透明度、流速倍率、ExNote（`isAlwaysPerfect`）、音符级不透明度。
- **多线编辑**：事件类型下拉与「编辑事件列」勾选组按 Milthm 列映射/9 种普通层语义种类显示。
- **预览**：Milthm 轨道样式（程序绘制）、Milthm 风格 HUD；落速 = 全局流速 × Speed(12) × 线流速 × 音符流速
  × 轨道大小；旋转方向与渲染器一致；背景明暗走全局事件。
- **特殊事件**：线文本 / 判定线贴图导出为 Milthm 故事板；导入时故事板反向转成可编辑特殊线。
- **字体**：随包 ChillRoundF（OFL-1.1）覆盖 RPEN 画布与 DOM 文字，设置里可关。
- **导出压平**：父子线与多事件层在导出时按 RPEN 语义压平（多层数值相加合并、父级变换烘焙成子线绝对
  关键帧），并在导出提示里说明；Milthm 没有线层级，导出后不再有父子关系。

## 导入 / 导出

- 导入后自动绑定音频/曲绘；右下角面板或模组命令：**导出 chart.json** / **导出谱面包**
  （`meta.json + chart.json + audio + image.png`，有明暗事件时加 `res/black.png`，有贴图故事板时加 `res/`）。
  导出也并入了原生「导出」对话框（`Milthm · chart.json` / `Milthm · 谱面包 zip`）。
- **轨道锁**（设置里可关）：提交时强制 `positionX=0`、`above=1`、音符默认属性、`bpmfactor=1`、默认线贴图；
  `father` 会保留（预览走 RPEN 原生层级），只在导出时烘焙。
- 导出只读语义数据，**预览设置不写谱面**。

## 设置项

| 设置 | 默认 | 说明 |
|---|---|---|
| 坐标缩放 | `0.703125` | Milthm 1920×1080 → RPE ±675/±450（675/960） |
| Y 轴翻转 | 关 | 两边都是 Y 向上 |
| X/Y 偏移 | 0 | Milthm 单位 |
| 旋转偏移 | `90` | `RPE 角度 = 90 − Milthm rotation` |
| 流速缩放 | `1.1671875` | `1.66 × 675/960` |
| 全局流速（预览） | 1.66 | 与播放器 `FLOW_SPEED` 同值同义（0.8–2.4）；只影响预览落速 |
| 轨道锁定 | 开 | 强制轨道式编辑不变量 |
| 保留扩展数据 | 开 | 不可编辑的 Milthm 数据暂存并在导出还原 |
| 预览里画 Milthm 轨道样式 | 开 | 预览用程序绘制的轨道 |
| 预览背景明暗 | 开 | 预览按明暗全局事件压暗 |
| 导入时迁移纯黑立绘为明暗全局事件 | 开 | 启发式识别纯黑立绘 |
| 新建谱面时 | 询问 | 询问 / 总是普通 RPE / 总是 Milthm 轨道谱面 |
| 把 RPEN 全部文字换成 ChillRoundF | 开 | 随包字体（OFL-1.1） |

## 兼容性与测试

- **测试编辑器**：RPEN（rpe-next）**v0.13.0**，模组 API 1；清单按 `schemas/mod-v1.schema.json` 约束、
  由 `tools/pack-mod.mjs` 校验后打包。
- **使用了内部接口**：`Preview` / `LineRuntime` / `SceneRuntime` 原型补丁，`ui/preview.mjs`、`core/scene.mjs`、
  `core/events.mjs`、`core/tempo.mjs` 等内部导入。RPEN 升级可能破坏，升级后需回归
  `rpen-milthm-bridge-test/` 里的离线测试与无头探针（`node columns-test.mjs`、`probe-preview-speed-ramp.mjs`、
  `integration-test3.mjs` 等）。
- **停用/卸载**：样式、补丁、字体、命令、全局事件类型都通过 API 1 托管恢复；已提交的谱面修改不回滚；
  不含常驻定时器。
- **包大小**：含 9.17 MB 字体约 9.9 MB（协议上限：单文件 32 MiB、总量 128 MiB、单 JS 4 MiB）。

## 已知限制

- 线体为程序绘制的渐变长条+圆环，不是 Milthm/Rain Editor 原贴图，与实机可能仍有外观差异。
- 颜色只保留 RGB，源谱色透明度（alpha）导出会丢；音符级动画只有不透明度与 FlowSpeed 参与预览，其余只暂存，
  不能在 RPEN 里编辑。
- 立绘四角动画(14–21)、Mesh(2)、表达式缓动、噪域、倾斜(incline)、着色器(paint)、GIF 没有 Milthm 对应，
  只能暂存/忽略（导出会提示）。
- 特殊事件转故事板是近似（字号换算、打字机最多 8 段、非居中锚点会偏移）。
- RPEN「谱面检查」按 Phigros 规则，会把 Milthm 合法的同轨道同时刻多音符报错，不影响编辑/导出。
- 自动媒体绑定与明暗迁移各产生一次可撤销提交（谱面显示"未保存"，属预期）。

## 目录

- `mod.json` — 清单（14 个设置项）
- `main.mjs` — 导入/导出、事件列下拉、通道面板、ExNote、预览补丁、明暗全局事件、字体
- `columns.mjs` — 语义层（显示列 ↔ Milthm 语义数据）与预览速度合成
- `convert.mjs` — 纯转换层（Milthm fmt=2 ↔ RPE）
- `flatten.mjs` — 导出压平（多事件层相加合并、父子线烘焙）
- `milthm-fmt2-bridge.rpenmod` — 打包产物
- `fonts/ChillRoundF.ttf` + `fonts/OFL.txt` / `fonts/FONT-NOTICE.txt` — 随包字体与许可证

