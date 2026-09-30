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

## 两版对比区（改一版再发之后）

- `app.js` 的「载入第 1 版对比」：点按钮才拉第 1 版全量视图（懒加载，不自动翻倍负载）。
  第 1 版必须渲染进**子节点**——`renderCheck` 会清空整个容器，直接渲染进 `#compare`
  会把差分卡和按钮一起清掉。
- 差分卡 = `render.js` 的 `renderDelta(el, after, before)`：两版 `looks` 都在内存里，
  全部在浏览器里算，不新增 Jev 调用。只对**同预设**的两版渲染（预设不同则反应词表不同，
  差值没有可比性，直接留空）。中文走 `labels.js` 的 `DELTA_SAY_ZH`。
- 差分地图 = `grid.js` 的 `drawDelta(canvas, codes)`：发散配色（绿=变好、红=变差，
  半档 = 墨水与底板各半），墨水取主题数据墨水 `--map-green` / `--map-red`。
  **刻意不用 `LOOKS`**——那是"这个人做了什么反应"的色板，这里是"相对上一版变了多少"的
  量表，用同一套颜色会让读者把"变了"误读成"是哪种反应"。
- 差分画布**没有悬停档案**（差分格没有"这个人是谁"可看），但必须能被主题重绘：
  登记进 `grid.js` 的另册 `deltas`，`redrawMaps` 一并重画——曾因漏了这条，切主题后
  差分图留着上一个主题的墨水（回归用例在 `test/grid.test.js`）。

## 已知待修

- 暂无。上一轮记的「`.toc` 完全没有样式」已在 2026-09-29 的前端打磨轮修掉
  （目录改成 pill，窄屏单行横向滚动）。

- 三张动态图：吞吐心电图、模型耗时曲线、态度占比堆叠图。
- 波次收束单独成行；完成后自动切完整报告。

## 交互与性能约定

- 移动端优先：新布局在窄屏不得溢出（审计轮修过）。
- canvas 图表须可被主题重绘（注册/注销集中管理，防泄漏——审计轮修过画布泄漏）。
- voices 卡片默认折叠 24 条，可展开全部（防 DOM 过重）。
- BYOK key 只进 localStorage，弹窗在 `app.js`；请求头由 Worker 侧 `providerOf` 消费。

## 交互细节（R6 起）

- **地图悬停档案**（`grid.js` 的 `attachTooltip`）：悬停走 `pointermove`（`pointerType === 'touch'`
  的拖动不算悬停），触摸屏点按走 `pointerdown`——点一下出档案，同格再点收起。
- **tooltip 定位**必须过 `clampTip(x, y, w, h, vw, vh)`（纯函数，有单测）：默认光标右下，
  右缘放不下翻左、下缘放不下翻上，最后钳进视口留 12px。别改回裸 `clientY + 14`——
  画布在折叠线下时 tooltip 会被视口裁掉（R6 取证实测 tipBottom 3487 / vh 805）。
- **报告深链**：feed 链接是真 URL（`/?post=<id>`），点击在 `app.js` 委托拦截 +
  `pushState`，回退键收起报告；页面载入读 `?post=` 直开。**不要再写 `javascript:` URL**。
- 检查进度的 `#statusLine` 带 `role="status"`（屏幕阅读器播报）；voices「看全部」展开后
  焦点交给第一张新露出的卡。

## 窄屏约定（≤560px）

- 目录改单行横向滚动（右缘渐隐 + 细滚动条），不用换行——换行会占掉近 250px。
- `.seg` 分段条：标签独占一行，条与数字并排在下一行；否则 `label+num` 把宽度吃光，比例条消失。
- `.stats` 排成两列；`.frow` 漏斗同样上下排；`.map-wrap` 地图与图例改上下排（并排会把 400px 画布挤成细条）。
- 网格项要给 `min-width: 0`：`.examples .card` 的自动最小尺寸 = 内容 min-content，
  会被 nowrap 目录撑到 600+ 像素，整页跟着出横向滚动条（R5 的 E2E 抓出来的 R3 遗留）。
  同理 `.legend` 也有这条。**凡 grid/flex 里放可横滑内容的项，都记得这一条。**

## 图表宽度（重要，别改回固定值）

SVG 的 `viewBox` 宽度与渲染宽度成反比：viewBox 固定 + CSS `width:100%` 时，里面的字号
按 viewBox 单位等比缩小——容器 271px 而 viewBox 900，就把 11px 标注缩到 3.3px。
所以 `moodLine` / `demandChart` / `shareChart` / `rollingChart` 的 `width`
**必须由调用方按实测容器宽度传入**（`render.js` 的 `chartWidth`、`app.js` 的 `updateCharts`）。

## 地图底板与对比度

- `--map-well` 是地图底板，**必须用深色**。六色反应墨水（`presets.js` 的 `LOOKS`，跨主题不变）
  亮度跨度太大，浅底板上亮墨水会隐形：实测公报原米纸底 `spreads` 黄只有 **1.07:1**、
  `glad` 绿 1.38、`sorry` 红 2.34，达不到非文字图形 3:1。改深版后 5/6 过线。
  **验算过：不存在能让六色同时过 3:1 的底板**（亮度区间 L ∈ [2.23, −0.02] 是空集），
  达不到的那一色永远是 `scrolled`（灰）——而它本来就该退到背景里。改底板前先复算。
- 浅色主题的地图因此是"米纸上的一块印刷墨版"，不是纸底地图——这是取舍的结果。
- 正文令牌实测（四主题）：`text` 13.4–16.7、`muted` 5.1–6.8、`ok`/`bad` 5.0–9.7，全部过 4.5:1。
  夜巡的 `--accent` 曾是 4.34:1（差一点），已提到 `#e0604a` = 4.88:1。
- `footer` 里 "Jev" 这类行内文字链接宽 17px，低于 24px 触达目标——按 WCAG 2.2
  SC 2.5.8 的行内例外接受，不为它把行内文字撑成块。
- 浅色主题里的 `.toc` pill、`--muted` 等次级文字同样过 4.5:1（上表 `muted` 行）。

## 改动自检

- [ ] 四主题下都顺眼（令牌未硬编码颜色）
- [ ] 窄屏无横向溢出
- [ ] 无新增硬编码中文/颜色
- [ ] canvas 有对应的主题重绘与清理路径
- [ ] 图表宽度由调用方按容器传入（不是写死的默认值）
- [ ] `[hidden]` 仍然藏得住（别给带 `hidden` 的元素加 `display` 的类）
