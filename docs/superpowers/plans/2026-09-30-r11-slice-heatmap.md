# R11 · 创意轮：人群切片热力图——把反应场聚合到小镇的 40 个「兴趣街区」

> 轮换位置：R10 优化 ⇒ **R11 创意** ⇒ R12 前端。writing-plans 规范，inline 执行（不用子代理）。

**Goal:** 报告新增「谁在哪儿扎堆」视图：人格网格固有的 40 个街区（**5 个年龄段 × 8 列兴趣**，
每格 ≈200 个同兴趣同龄段的邻居）各自显示**乐见占比**——segments 的边际统计答不了的
"年龄 × 兴趣组合效应"，一张矩阵看穿。零 Worker 改动、零新增 Jev 调用。

**Architecture:** 反应场（`looks` 字节）× 人群属性（`interests[0]` 主兴趣）→ 纯函数
`sliceHeatmap()`（进 `shared/summary.js`，遵循"图表数据一律经 summary 纯函数"约定）
→ `charts.js` 的 `sliceChart()` 画 SVG → `render.js` 接在分组分析之后。
颜色是**乐见占比的顺序量表**：`color-mix(var(--map-green) N%, var(--map-well))`
（CSS 变量进 SVG fill，四主题自动跟随，无需重绘）；样本 < 25 人的格子不给颜色
（虚线框 + "判定少"），沿用 segments 的最小样本门思想。

**人口语义（关键口径）:** 每个判定过的人按**主兴趣**（`interests[0]` = 离它最近的兴趣家）
归入唯一街区；边界毛边人群（主兴趣是邻区的）按真实属性算，不按网格坐标硬切。
行标签用 vocab 的五个年龄段（18–27 / 24–36 / 33–46 / 43–58 / 52–80）。

---

### Task 1: 词表补行标签 + summary.js 纯函数

**Files:** Modify `public/shared/vocab.js`（+1 导出）、`public/shared/summary.js`、`test/summary.test.js`

- [ ] vocab.js 追加（注释级联，不改既有 id）：
```js
/** 兴趣网格 5 行的年龄段标签（与 INTERESTS 的行注释同一口径），报告的切片热力图用。 */
export const INTEREST_ROW_ZH = ['18–27 岁', '24–36 岁', '33–46 岁', '43–58 岁', '52–80 岁'];
```
- [ ] summary.js 新增 `sliceHeatmap(presetId, keys, reactions, people)`：
  每人按 `interests[0]` 归入 40 街区之一，累计 judged/glad（`tone === 1`）；
  `share = judged >= 25 ? glad/judged : null`；返回
  `{ rows: [{ zh, cells: [{ id, zh, judged, glad, share }] × 8 } × 5], cityShare, judged, minSample }`。
- [ ] 测试（`test/summary.test.js` 追加，复用顶部已 import 的 crowd）：
  1. 形状：5 行 × 8 格，行标签与 `INTEREST_ROW_ZH` 一致；
  2. 聚合正确性：给真实人群某街区的前 30 人上 glad 字节、其余留 0 → 该格 judged=30、share=1，
     且 `Σ cell.judged === data.judged`、`cityShare` 与手算一致；
  3. 最小样本门：某格只判 10 人 → share 为 null（不下结论）。

### Task 2: charts.js 画 sliceChart + render.js 接线

**Files:** Modify `public/charts.js`、`public/render.js`

- [ ] `sliceChart(data, { width })`：8 列 × 5 行 SVG；格 fill =
  `share == null ? 'var(--map-well)' : color-mix(in srgb, var(--map-green) N%, var(--map-well))`，
  null 格加虚线描边；格下两行小字（街区名 / 乐见 X% 或 判定少）；左侧行标签；
  底部图例（渐变条 0→100% + 全城乐见 + 虚线说明）。每格 `<title>` 给 hover 档案
  （街区名 · 判定 N 人 · 乐见 X% · 全城 Y%）。
- [ ] render.js：模块级 `townOf` 备忘（`crowd()` ~155ms，页面只算一次）；
  `heatmapView(result)` 接在 `segmentsView` 之后，`chartWidth` 传入。
- [ ] 无数据（reach 0）返回空串，不渲染空段。

### Task 3: 验证与文档

- [ ] `npm run lint` ✓；`npm test` ≥ 104（summary +4）
- [ ] E2E（CDP，本地 mock 报告）：热力段渲染 40 格、hover title 就位、
      四主题切换颜色跟随（color-mix 吃变量，无需重绘）、375px 无溢出、控制台零错误
- [ ] `docs/modules/frontend.md`（charts.js 职责 + 新小节）、`docs/MEMORY.md` 记一轮

## 不做（范围纪律）

- 反感占比双量表、点击下钻到人格列表、Worker 侧复用——记后续候选。
