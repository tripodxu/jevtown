# modules/frontend · 无框架前端

> 适合：改界面、渲染、图表、地图、主题的 agent。
> 路径：`public/`（不含 `shared/`，引擎另见 [shared-engine.md](shared-engine.md)）。

## 文件职责

| 文件 | 职责 |
|---|---|
| `index.html` | 首屏 = 发帖框（选预设 + 写文字 + "让小镇来读"）；示例回放沉在底部 |
| `styles.css` | 四主题 CSS 变量令牌 + 全部样式 |
| `app.js` | 编排：发起检查、驱动 batch/wave 轮询、BYOK 设置弹窗 |
| `render.js` | 报告渲染 + 锚点目录 + 人群地形段落 + 地图的聚集地形开关 |
| `charts.js` | 漏斗 / 折线 / 堆叠 / 需求曲线 / 报告条形图（canvas） |
| `grid.js` | 100×100 响应式地图（canvas，悬停档案）：`drawGrid` 全量重画、`paintDelta` 按字节快照增量补画 |
| `tally.js` | 实时监控的「已判定」快照：每批增量折叠出 judged/glad/sorry（纯函数，Node 可单测） |
| `theme.js` | 主题切换（localStorage 持久化） |
| `showcase.js` | 首页示例回放（读 `public/examples/*.json`，经 `shared/replay.js`） |

## 渲染管线

```
app.js  fetch /api/post/:id
   ├─ render.js   报告骨架 + 目录
   ├─ charts.js   图表（数据来自 shared/summary.js 纯函数）
   └─ grid.js     地图（一人一格，悬停出档案 + "Jev 判定"）
```

- 图表数据一律经 `shared/summary.js` 的纯函数计算，**不在渲染层算指标**。
- 颜色一律取 `shared/presets.js` 的 `LOOKS`（地图图例与图表同源）。
- 中文一律取 `shared/labels.js`，渲染层不硬编码。

## 主题系统

- 主题 = `styles.css` 里一组 CSS 变量；现有四套：**夜巡**（默认）/ **公报** / **仪器** / **经典**。
- 新增主题 = 加一组令牌 + `theme.js` 顶栏加一个按钮，组件代码零改动。
- 主题切换后地图与图表需重绘（`theme.js` 已处理，监听变更即可）。

## 检查进行中的实时态

- 地图随每批判定 progressively 点亮；监控表滚动追加（时刻/阶段/进度/耗时/tokens/累计花费）。
- 实时地图走 `paintDelta` 增量补画，统计走 `tally.js` 增量折叠——**每批不要全量重扫一万格**。
  要全量重画（换一次检查、换主题）才调 `drawGrid` / `redrawMaps`。

## 报告里的「人群地形」

- 判定与成片格子来自 `shared/spatial.js`，中文全部走 `labels.js` 的
  `TERRAIN_VERDICT_ZH` / `TERRAIN_SAY_ZH` / `directionZh`。
- 地图上方「看聚集地形」开关：`wireTerrain` 给 `drawGrid` 多传一个 `terrain`，
  `grid.js` 的 `ringTerrain` 给成片格子描环（绿=乐见、红=反感，取主题数据墨水）。
  图例随之在 `reactionLegend` / `terrainLegend` 之间切换。
- 整张地图的判定（成片/零散）与局部成片是两回事，文案上要分开说，别让"零散"那句
  否认同一张卡片里报出来的局部小簇。

## 已知待修

- **`.toc` 完全没有样式**：`render.js` 的 `buildToc` 生成了锚点目录，但 `styles.css`
  里没有任何 `.toc` 规则，目录在一行里挤成连续文字（无间距、无 pill、无换行）。

- 三张动态图：吞吐心电图、模型耗时曲线、态度占比堆叠图。
- 波次收束单独成行；完成后自动切完整报告。

## 交互与性能约定

- 移动端优先：新布局在窄屏不得溢出（审计轮修过）。
- canvas 图表须可被主题重绘（注册/注销集中管理，防泄漏——审计轮修过画布泄漏）。
- voices 卡片默认折叠 24 条，可展开全部（防 DOM 过重）。
- BYOK key 只进 localStorage，弹窗在 `app.js`；请求头由 Worker 侧 `providerOf` 消费。

## 改动自检

- [ ] 四主题下都顺眼（令牌未硬编码颜色）
- [ ] 窄屏无横向溢出
- [ ] 无新增硬编码中文/颜色
- [ ] canvas 有对应的主题重绘与清理路径
