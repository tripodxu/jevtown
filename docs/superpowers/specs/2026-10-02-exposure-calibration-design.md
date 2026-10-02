# Jev 开局押得准吗 · 设计

日期：2026-10-02 · 轮次：R37（创意轮）

## 为什么做这个

`public/shared/feed.js:130` 的 `exposure(who, scores, presetId)` = Σ `(权重 × 该人格某一维的 CARE 分)³`（`feed.js:69` `WEIGHT_OF_PART = { interest: 1, field: 1, age: 0.6, shopping: 1.5, budget: 0.6 }`）。它决定第 1 波 600 人怎么挑（`feed.js:241` `firstWave`），也就是**「Jev 说谁该先看到这段话」**。

这份预测有个别处没有的性质：**它在任何人有反应之前就已经做完了**。第 1 波问的那道题（`requests.js` `reactionRequest`）问的是「你看到它会怎样」，而 exposure 是上一道题（`openingRequest` 的 83 组打分）的读数换了个算法。报告把 Jev 说的每句话、之后发生的每一件事都摆出来了，唯独**这份预测从没被拿去和结果对账**。

`worker/index.js:634` 的 `base` 里没有 `scores` —— 打分存进了 `versions.scores`（`:223/:251/:309` 都在写），只是从来没到过报告。

## 实测取证

本轮四个探针，全部真实 TypeSafe API（key 在 `.env.local`，gitignored）。

### 一、`scripts/probe-calibration.js`：全城分十档，读真实存档

拿 `public/examples/iphone-listing-v1.json` 里 Jev 真的判出来的 10,000 个反应字节（非零 2,100 = 两波到达），重问一次 `openingRequest` 拿 `scores`，把一万格按 exposure 从高到低分十档，看每档的实际停下率与乐见率。

全城：到达 2,100 人 · 停下率 24.6% · 乐见率 7.2%

| 档 | exposure 区间 | 到达 | 停下率 | 乐见率 |
|---|---|---|---|---|
| 1 | 2.584–0.345 | 614 | **62.7%**（2.55×） | 23.8%（3.29×） |
| 2–9 | — | — | 5–12% | — |
| 10 | 0.044–0.012 | 92 | **2.2%** | — |

停下率 **档 1 / 档 10 = 28.84 倍**。第 1 波 600 人里 **505 人落在档 1**（前三档 527 人 = 88%）。

→ 这份预测兑现了。

### 二、`scripts/probe-openpick.js`：三臂对照，只有「挑谁」不同

三条 arm 各 n 人，问 Jev 完全相同的一道题；臂间互斥、臂内不放回（`scores` 复读 2 遍取均值压噪声）。

- **A 尖**：exposure 最高的 n 人（`feed.js:215` `kthSmallest` 的同一套排序）
- **C 随机**：从**去掉尖和底之后**的人里洗牌抽 n 人
- **B 底**：exposure 最低的 n 人

| 文本 | 预设 | A 情绪/停下 | C 情绪/停下 | B 情绪/停下 | A/C |
|---|---|---|---|---|---|
| 出 iPhone 13，128G，电池 86%，1400 元 | listing | **+0.375 / 83%** | +0.035 / 10% | −0.005 / 3% | 停下 **8.25×** |
| 降噪耳机，两种颜色，明天发货 | product | +0.135 / 68% | +0.025 / 39% | +0.015 / 29% | 乐见 **5.40×** |
| 把每周例会砍到 15 分钟之后 | post | +0.150 / 56% | +0.040 / 31% | +0.005 / 10% | 停下 1.82× |
| 周三下午三点停电 | headline | +0.105 / 69% | +0.085 / 71% | +0.070 / 60% | **0.97×（押平了）** |

每臂 200 人，$0.0048–0.0066/臂组。

**最后一行是这一节必须能报的那一条**：一段「谁都会关心、所以谁差别不大」的文字（本地停电通知），这份预测在上面一文不值 —— A 臂停下率 69%、C 臂 71%，比值 0.97。B 臂的 mood 也是正的（+0.070），说明**不是「末档人讨厌它」，是「末档人也无所谓」**。

对比 mock：`n=120 / product` 时三臂停下率 45% / 38% / 49%，A−B 情绪 0.000 —— mock 的反应模型不看人格，任何分层都测不出东西。这是「必须真实用 Jev」的实证。

### 三、能不能白拿：花多少 CPU

免费档 Worker 单请求 10ms CPU（`docs/MEMORY.md` R34 记 `nextWave` 1.2ms / 8× 余量）。

| 做法 | 耗时 |
|---|---|
| `exposure()` 逐人全城（每个人重建一次 83 列折立方表） | **22.0ms** ← 撞死预算 |
| 折一次、万人折一次（`cubeTable` + CSR 行） | **0.11ms** |
| 直方图数九个切点（不排序） | 0.06ms（排序是 1.85ms） |
| 十档分档全城 | 0.11ms（只切到达的 2,100 人是 0.015ms） |

合计 ≈ **0.3ms**。前提是 `feed.js:114 cubeTable` / `:136 exposureBy` 得开一个批量入口（现在都是模块私有，公开的 `exposure()` 是「每人一次」的形状，全城一趟就是 22ms）。

这一轮的探针自己踩了三个坑，都记在脚本头部：

1. **假打分必须用真实组 id**（`requests.js` `groupsOf(true)` 给 83 个）——用 `interest:v0` 这类自造 id 时 `columnsOf` 的 `at.get` 全 `undefined`、`scores[id]` 全 0、`exposure` 恒 0，第一版量出一段「区间 0.000–0.000」的废数。
2. **直方图数分位 `while (seen < want) seen += hist[cuts.length]` 死循环** —— 桶不连续时 `cuts.length` 卡住不动。第二版先线性扫一遍累加。
3. **`exposure()` 的形状是「每人一次」** —— 拿它当批量接口用，是 145 倍的差距。

### 四、产品里本来就藏着一条随机尾巴（这轮不接，留着）

`feed.js:10` 的 `WAVES` 每条都带一条随机尾巴：`[{size:600,random:100},{size:1500,random:150},{size:3000,random:300},{size:全城,random:0}]`。第 1 波 600 人里，**500 人是 exposure 最高的，100 人是从剩下的人里随机塞进来的** —— 每一条检查都自带一个随机对照组，只是从没报过它。名单在 `versions.plan.history` 里（`worker/index.js:501`），`waveBytes` 能按波还原（`:653`）。

没接的理由：第 1 波就结束的检查只攒到 100 人，噪声大；而它要的是「同一条尾巴上 Jev 挑的那半 vs 随机那半」，口径和本轮的分档表不是一回事。当原料留着。

## 设计

### 一、新增 `exposureBands`（`public/shared/feed.js`）

```js
exposureBands(presetId, keys, scores, reactions, people) → {
  bands: [{ band: 1..10, low, high, people, reached, stopped, glad, sorry, stoppedLift, gladLift }],
  town: { people, reached, stopped, glad },
  first: { stoppedRatio, gladRatio },   // 第 1 档 vs 第 10 档
  flat: boolean,
  readable: boolean,
  minSample: 25,
}
```

- **档 1 = 最该先看到，档 10 = 最不该看到。**
- **切点来自全城 exposure 的九个分位**，与到达多少人无关（`scripts/probe-bandcost.js` 用 2048 桶直方图数分位，0.06ms）。这样换一批到达者档位不换，读数能跨检查比 —— 若按「到达的人」分档，档位边界依赖实际到达了什么，人一换档位就换。
- **`people` = 该档全城人数（含没到达的）**，`reached/stopped/glad` 只在到达者里数；`lift` 的分母是全城（与 `summary.js:101 segments()` 同一个口径）。
- 全城无人到达的格子不动，不是 0 就不当 0（`summary.js:118` 的 `NOT_SHOWN` 口径）。
- **`readable` = 至少有两档到达 ≥ `MIN_SLICE`**（`summary.js:186` 的 25，与 `sliceHeatmap` 同一个下限）。不够就整节退化成一句话，不摆十行假读数。

### 二、`feed.js` 开批量入口（波次名单必须一字未变）

```js
export function exposureAll(personas, scores, presetId) → Float64Array
```

把 `cubeTable` + `flatOf` 的行折一遍。`firstWave` 内部从 `exposureBy(who, cubes, market)` 改成读这个数组 —— 列号来自同一个 `columnsOfPersona`，加的顺序与加法完全一致（`feed.js:60-68` 注释里已经写明这条规矩），**但波次名单存在 `versions.plan` 里，一丁点不同就是一次不同的检查**，所以 `test/golden-waves.txt` 必须原样通过。这是 R34 立下的规矩，不是新加的洁癖。

### 三、接线（四处）

| 位置 | 改动 |
|---|---|
| `worker/index.js:634` `showPost` 的 `base` | 加 `scores: JSON.parse(version.scores ?? 'null')`（今天不过报告）；返回体加 `bands: scores ? exposureBands(presetId, keys, scores, bytes, people) : null` |
| `public/shared/replay.js` | 同上用 `saved.scores`；旧存档没这字段 → `null`，整节不渲染（R35 `audience` 的做法：回放旧存档不该凭空长出一节） |
| `scripts/check.js:143` | 存档补 `scores: result.scores`（`check.js:219` 的返回里已经有了）。否则新存档也回放不出这一节 |
| `public/render.js` | 新 `bandsView(result)`，**紧跟 `baselineView` 之后**（`:202`）—— 两节都答「和随机比」，上下相邻读起来是一条线 |

`public/examples/` 里现有的两个存档都没有 `scores` 字段 → 要补一个带 `scores` 的（`MOCK=1` 或真实跑都成，存档是 fixture 不是花费）。

### 四、中文全部落 `labels.js`

`CALIBRATE_ZH = { title, hint, band, town, flat, empty, ... }` + `calibrateSayZh(bands)`：

- 表头一句说清结论：`Jev 说最该先看到的那批人，停下率是末档的 %1 倍。`
- `flat` 时：**`Jev 的开局猜对了一半——最高那档并不比末档更想看。这段话谁都会关心，所以谁先看到都一样。`** 说完它仍然摆十档，让读的人自己看那条平线。
- `!readable` 时一句话说明「到达的人不够分十档」。

### 五、断言

1. **波次名单逐字节不变** —— `test/feed.test.js` 的 `test/golden-waves.txt` 原样通过。
2. **口径自洽** —— `Σ people === 全城人数`、`Σ reached === counters().reached`、第 1 档 `high ≥ 第 10 档 low`、`每档 reached ≤ people`、`bands.length === 10`。
3. **真数据钉基准** —— 用带 `scores` 的新存档断言「第 1 档停下率 ≥ 末档 10 倍」。真数据量到 28.84 倍，10 倍是给 mock/回归留的余量，不是把结论放松成「差不多」。
4. **`flat` 分支** —— 造一份全城 exposure 相同（mock 下 `openingRequest` 的打分量化后全 0）的 scores → 断言 `flat === true`、十档 `people` 仍各 1/10（切点全塌到 0 时也不能把一万人都塞进一档）。
5. **文案单点** —— `CALIBRATE_ZH` 的每个键都被渲染层引用（`test/labels.test.js` 现有契约测加强）。

## 不做的事

- **不改传播判据**：`GLAD_ENOUGH = 0.1`（`feed.js:25`）与 `nextWave` 的 `0.6*best + 0.4*avg + 0.05*guess + 0.1*neighbour`（`feed.js:312`）一个字不动。这一节只做证据与显示 —— 重新标定阈值需要更多真实样本；换成 z > 2 会把 iPhone 基线从 2 波压到 1 波，`docs/research/real-api-report.md` 与 `docs/research/wave-baseline-report.md` 都失效。
- 不动 `WAVES` 的随机尾巴（上面第四节的原料）。
- 零新增 Jev 调用、零新增迁移、零新增 devDependency。

## 验证

- `npm test` 全量（188 → 目标 ≥ 198）+ `npm run lint`。
- DOM 桩渲染探针跑两条分支（十档有斜率 / `flat` 押平），确认中文与数字都对。
- `docs/MEMORY.md` 加 R37 条目。
- 一次中文 commit。