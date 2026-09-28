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
