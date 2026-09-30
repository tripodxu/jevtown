# modules/shared-engine · 三端共用引擎

> 适合：改波次算法、概率处理、摘要/图谱数据、mock 行为的 agent。
> 路径：`public/shared/`。只读本文件 + 目标源码，不要顺带读整个 `public/`。

## 运行模型

引擎不直接 import 平台 API，通信靠**注入的 `send`**：

```
send(provider, { state, questions }) → answers   // 形状见 jev.js
```

三个运行时各提供自己的 `send`：Worker（记账+限额+BYOK 头）、Node 终端（scripts/check.js
直连）、测试/mock（`mock.js` 的 `createMockAsk`）。

## 主编排：`check.js` 的 `runCheck`

```
runCheck({ send, presetId, pool, text, versionId, prices, maxWaves, onWave, blocking,
           mayGoOn, mayFollowUp, mayAsk, audience })
```

- 开局打分（约 55 类人群）→ 审核（0.5 不进公共流 / 0.85 拒发）→ 逐波传播。
- `mayGoOn` / `mayFollowUp` / `mayAsk` 是**回调闸门**：Worker 用它们落实限额与预算，
  引擎本身不感知平台。改传播逻辑时不要绕过闸门直接扩批。
- 波次队列：`feed.js` 的 `WAVES`（600 → 1500 → 3000 → 其余），`GLAD_ENOUGH = 0.1`
  是净情绪阈值；`waveReach` 决定每波到达人数。

## 概率 → 反应：`draw.js`

- `drawReaction(probabilities, pool, personaId, versionId)`：确定性抽样（seed 由人格/版本
  哈希而来），同一输入永远同一输出——回放与测试依赖此性质。
- `CONFIDENT_FROM = 0.35`：概率低于它视为"拿不准"，走 `DRAIN` 路径（`presets.js`）。
- `expectedTone`：按概率分布的期望值给情绪（不抽样），用于跨波折线。

## 传播：`feed.js`

- `firstWave` / `nextWave`：谁进入下一波（曝光分 × 随机）。
- `mood` / `travels`：净情绪 ≥ 0.1 才继续传播。
- `gatherAsked` / `asking` / `whoIsAsked`：收尾提问的加权聚合
  （`ASK_WEIGHT=100`、`SORRY_WHY=40`、`MIN_ASKED=10`）。

## 摘要与图谱数据：`summary.js`

- `counters` / `segments` / `topSegments` / `biggestSegments`：计数与分组提升倍数（1.6× 显著线）。
- `demandCurve`：价格需求曲线（追问阶段，商品预设）。
- `voicesOf`：反应者卡片数据；`minSegment`：分组最小样本量（随规模浮动）。
- **`segments()` 走预编译分组表**（`groupTable`，WeakMap 按 `people` 数组身份缓存）：
  分组名与"这一维取哪些值"的形状是人群的常量，与一次检查无关，所以只编一次。
  实测 19.13ms → 0.98ms。**两条不变式**：分组号按首次出现分配（输出顺序与旧 Map
  插入顺序一致）；`people` 视为不可变——若将来有人就地改人群，这张表会过期，
  要连 `crowd()` 一起改。传进来的子集各自成表，随数组被 WeakMap 回收。
- **`crowd()` 按 pool 备忘**（R13）：首算 ~130ms，二次同数组（0ms）。首页原本要算 3 次
  （两张回放卡 + 切片热力图），现在一次。Worker 的 `crowdOf` 自动搭车；调用方必须把
  返回数组视为不可变——就地改人会毒化备忘（与 `groupTable`/`crowdCache` 同一约定）。

## 空间读数：`spatial.js`（人群地形 + 两版之差）

`segments` 是按属性做的**边际**统计，答不了"哪一片人一起反感"——成片往往由属性的组合
造成。`spatial.js` 把反应图当**空间场**读一次：

- `crowdTerrain(presetId, keys, bytes, { versionId, grid, maxCluster })` → Moran's I
  （rook 邻接，只连都被判定到的上下左右）、置换检验的 `z` / `p`、判定
  `clustered` / `scattered` / `unclear`，以及成片格子的 id 列表 `hot` / `cold` 与重心。
- **`terrainOf(values, judged, opts)` 是 `crowdTerrain` 的真身**（值已给定，只做统计）：
  `crowdTerrain` 只是把字节翻成态度场的薄封装。任何"已给值"的场都能复用它——
  `crowdDelta` 就是这么把 Moran's I 套到态度差场上的，统计代码一行没重写。
- **显著水平** α = 0.05；**置换次数**随判定人数收缩（199 / 99 / 49，`permsFor` 导出可测）。
- 局部象限用**原始态度**判（态度 0 的中性格不参与）——离均值看的话，中性多数派会整体
  落在均值下方，造出一块假"成片的反感"。改这段前先读 `test/spatial.test.js`。
- 确定性：置换用 `hash32('spatial', versionId)` 播种，同 versionId 必得同结果；
  `crowdDelta` 的置换种子是 `delta:${versionId}`，与检查地形互不串扰。
- 与 `counters` / `segments` 同构：Worker 的 `showPost` 与浏览器 `replay.js` 都调它。

### `crowdDelta(presetId, keys, before, after, opts)`：两版之差

把两版字节折成一张"态度差"场（`tone_新 - tone_旧 ∈ {-2..2}`）与它的空间统计。
**只统计两版都判定到的人**：只被一版排到的人不是"变中立了"，而是"这次没轮到"，
混进来会得出"改完稿子几千人不看了"这种结论错误的话；覆盖差异另计 `onlyBefore` /
`onlyAfter`，由界面单独一句话说明。`codes` 打包给界面：`code = delta + 3`
（delta ∈ {-2..2} ⇒ 1..5，0 = 不可比），于是"差值为 0"与"不可比"分得开。
**这个函数只在浏览器里跑**（对比区），Worker/API/D1 一行不动，不新增 Jev 调用。

## mock：`mock.js`

- `createMockAsk()` 返回与真实 `ask` 同形状的假实现：按文本特征（长度、数字、价格词…）
  + 人格属性算**确定性概率**。
- 用途：无 key 全流程可玩、测试通道、前端演示。**不适合成本/传播预估**（真实模型更挑剔，
  实测 mock 会让文字传遍全城而真实 Jev 第二波就停，见 `research/real-api-report.md`）。

## 改引擎的自检清单

- [ ] 确定性未破坏（同 seed 同结果）——`test/rng.test.js` / `test/feed.test.js` 守护
- [ ] 中英文边界未混（问句英文、界面中文）
- [ ] 新常量是否有对应中文标签入口（`labels.js`）
- [ ] 颜色是否仍走 `LOOKS` 单源
- [ ] `npm test` 全绿
