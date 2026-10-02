# 哪一句在撑 · 设计

日期：2026-10-02 · 轮次：R32（创意轮）

## 为什么做这个

Jev 在这个项目里只被问过两种问题，都关于**人**：

- 「这群人多在乎这段话」——`public/shared/requests.js:86` `exposureRequest`，60 组 / 83 组各一道 score，进传播算法。
- 「这个人会怎么做」——`reactionRequest`，每人一道 choice。

没有一个问题关于**文本自身的某一部分**。而唯一试图问文本本身的地方恰好失败：`public/shared/requests.js:128` `TEXT_CHECKS.point_first`（「第一句就说清了在卖什么」），`docs/measurements.md` 记着它在 post 和 product 上答案都在 0.5 附近。Jev 答不出「哪句最重要」。

所以不给它判断题，**给它差分题**：同一批人群、同一套问题，把第 i 句删掉再读一遍，看读数差多少。它不需要「理解重要性」就能算这个。

## 实测取证

`scripts/probe-sentence.js`（本轮新建，探针）跑真实 typesafe，三段文本：

| 文本 | 句数 | 组数 | 均值压过噪声的句 | 组间拉得开（噪声倍数） | 花费 |
|---|---|---|---|---|---|
| iPhone listing | 4 | 83 | 3 / 4 | 60.3 – 100.2× | $0.0025 |
| 婴儿车 listing | 3 | 83 | 1 / 3 | 101.3 – 133.7× | $0.0021 |
| 例会 post | 2 | 60 | 1 / 2 | 45.7 – 49.6× | $0.0013 |

三条结论决定了设计：

1. **均值不是可用的量。** 婴儿车那段三句均值全是 0.0003 / −0.0068 / −0.0018，噪声底 0.0046，几乎读不出来；但「急出婴儿车，九成新，」这半句在 `people who are into parenting` 上是 **+0.445**，在 `students` 上是 **−0.175**。一组人买、一组人掉头，均值抵平成 0，信号其实还在。
2. **组与组之间的差距非常稳。** 三段文本全部 45–134 倍噪声，每句有 30–49 组（60–83 组中）压过自身噪声 3 倍。这是本设计的主统计量。
3. **措辞本身的影响比一部分信号还大**（0.0114 – 0.0198，而 iPhone 第 4 句只有 0.0079）。所以必须跑对照路把它减掉，否则 delta 里混的是「我说了删了一句」这件事本身。

iPhone 那段的完整读数（83 组，噪声底 0.0064）：

| 句 | 均值 | 拉得开 | 最吃的组 | 最不在乎的组 |
|---|---|---|---|---|
| 出 iPhone 13，128G， | +0.0234 (3.7×) | 100.2× | 想买手机的人 +0.537 | 爱旅行的人 −0.103 |
| 电池 86%，无维修， | **−0.0498 (7.8×)** | 97.5× | 想买手机的人 +0.215 | 喝茶的人 **−0.408** |
| 带盒子和充电线， | −0.0232 (3.6×) | 69.7× | 想买手机的人 +0.245 | 做小生意的人 −0.200 |
| 1400 元，可小刀，包邮，联系我 | −0.0079 (1.2×) | 60.3× | 手头紧的人 +0.243 | 设计师摄影师 −0.142 |

Jev 把名词短语判为承重、把规格细节判为挡路。**这与传播算法的读数无关，是另一个维度**：传播算法回答「多少人传」，消融回答「哪句话在决定这个」。

## 设计

### 一、算什么

按句子切，逐句消融。每句 i 的读数 = 对照路 − 删掉第 i 句的路。

四路请求，N = 句数，共 N + 3 次：

1. **BASE** 原文，原始措辞。
2. **CONTROL** 原文，同样那句「假设刚写好，句子都在」的措辞。CONTROL − BASE = 措辞本身的影响。
3. **消融 i** 删掉第 i 句，措辞点明删的是哪句。CONTROL − 消融 i = 这句的承重（措辞影响已抵消，因为两路措辞句式相同）。
4. **NOISE** 原文 again，同样措辞。CONTROL − NOISE = 纯抖动。

输出每句：

```
{ i, part, mean, spread, strong, top: {groupId, delta}, bottom: {groupId, delta}, deltas }
```

- `mean` = 83 组 delta 的平均（保留，因为 iPhone 那类「没人要的文字」上它是唯一读数）。
- `spread` = top − bottom，主统计量。
- `strong` = |delta| > noise × 3 的组数。
- `deltas` 全部保留给前端画条。

**判定门槛**：`spread > noise × 6` 才算「拉得开」，否则这一句在报告里标「读不出来」。门槛 6 而不是 1，因为实测最小 45.7 倍——门槛定 1 会让所有句子都通过，这个信息就没有筛选力。

### 二、切句

复用探针的 `sentences()`：先按句末标点切；一段里逗号 ≥2 再按逗号切一刀；过短碎片并进上一句而不是放弃拆分（6 字以下并，末尾再收一遍 4 字以下）。

**切得太碎比切得太粗更糟**——每句一次请求，钱翻倍。加一道上限：`MAX_ABLATION_SENTENCES = 6`，超了把第 6 句之后全部并进第 6 句。这样最坏 9 次请求，还在免费档 50 次外呼内。

### 三、接口与存储

`POST /api/away?post=<id>&v=<n>`

校验顺序照 `runVersion`（`worker/index.js:233`）：

1. `404` post 不存在 → `404` version 不存在
2. **作者校验** `authorOk(request, post)` —— 旧帖 author 为 NULL 一律拒绝。这是花钱路由，`runVersion` 的序在这里照抄。
3. post 必须 `state === 'done'`。running 期间的文本传播还在变，没有稳定的「哪句在撑」。
4. **已有 `versions.away` 就直接返回**，不重算。回访不重复花钱。
5. `providerOf(env, request)` —— BYOK 走访客的 key，没 key 落 mock，mock 的读数对消融没有意义但接口形状不变（与 `/api/check` 同一套）。
6. `MOVE_UP_MAX = 50` 外呼上限保护（比 `RETRIES_PER_INVOCATION = 40` 松，因为这里只在作者点按钮时调用，且句数已限到 6）。

成功：`addSpend(..., stage: 'ablate', n: i)` 逐句记，money 口径与 `opening` / `wave<n>` / `followup` / `ask` 一致（`docs/CONVENTIONS.md`：改记账必须查 `versions.usd` 与 `batches` 按 day 汇总口径一致）。

存储：`migrations/0008_away.sql` 加 `versions.away TEXT`。存 JSON，形状同 `follow_up` / `said`（TEXT 存 JSON 是这库的既有做法）。

`GET /api/post/:id` 的 `base` 里加 `away: JSON.parse(version.away ?? 'null')`。**不给 away 就别给 null 之外的默认值**——`versionsOf` 那个 `'[]' 也是真值` 的坑不要复制第二遍。

失败：就地返回已算出的部分（`settled: false`），前面几句照样给作者看，比整段白跑好。

### 四、报告里长什么样

「哪一句在撑」一节，挨着现在的「和纯随机比，谁更想要它」。

每句一行：

```
第 1 句 │ 出 iPhone 13，128G，              │ [green →  ] 0.537  想买手机的人      │ 45/83 组
第 2 句 │ 电池 86%，无维修，                │ ←[red    ] −0.408 喝茶的人          │ 49/83 组
```

- 双向条，中心 0：绿向右 = 吃它的组，红向左 = 掉头的组。宽度 `|delta| / spread`，左右各占一半。
- 「拉得开」判过的句子才画条；读不出来的只给一句「这一句 83 组读不出差别」。
- 颜色用现成的 `--face-glad` / `--face-sorry`（R30 建的 `--face-*` 面版墨水），**不新增颜色令牌**——`test/theme.test.js` 第 3 组断言会把它们钉在 ≥3:1。
- 中文文案进 `public/shared/labels.js`（`CONVENTIONS.md`：界面中文单源）。

按钮在那一节的标题右侧：**看看哪一句在撑**，下面一行小字「会调用 Jev，约 $0.003」。点了 POST `/api/away`，有 `provider.name` 和 `作者` 两道校验的接口，**文案要说清要花钱**。

算完就地渲染，不刷新页面（`app.js` 已有 `postJSON` / `readJSON` 两个出口）。

## 明确不做

- **不改传播判据。** R29 已经发现 `GLAD_ENOUGH = 0.1` 画在随机基线之下；改它需要更多真实样本来标定，那是下一轮的事，不搭车。
- **不进 `runCheck`。** 消融阻塞主流程会让每个 post 都多花 $0.002–0.003，包括传播一看就停的。
- **不给站方 key。** 与 R28 一致：真实检查一律走访客 BYOK。

## 测试

`test/away.test.js`（全程 mock，不花钱）：

1. `sentences()`：短碎片并进上一句、逗号多的一段再切、6 句上限把余下的并进第 6 句、空文本回退成一个句子。
2. 门槛：`spread <= noise × 6` 的句子被标成读不出来。
3. mock 通道下 `runAblation` 跑完整四路，返回的句数 = 切句数，每句有 deltas。
4. 端到端（worker）：作者不对 → 403；post running → 409；已算过 → 不再发请求；第一次算完再 GET 同一 post 能读回。

`test/worker.test.js` 加一组，按 `test/helper.js` 的 `runToDone` 流程跑到 done 再触发。

## 落地清单

| 文件 | 动什么 |
|---|---|
| `public/shared/away.js`（新） | `sentences()`、`ablationRequest()`、`ablationStats()`、`runAblation(send, …)` |
| `public/shared/labels.js` | `AWAY_ZH` 节标题与文案 |
| `worker/index.js` | `POST /api/away` 路由 + `runAway()`；`showPost` 的 base 加 `away` |
| `migrations/0008_away.sql`（新） | `ALTER TABLE versions ADD COLUMN away TEXT` |
| `public/render.js` | `awayView(result)` + 挂到 `baselineView` 之后 |
| `public/app.js` | 按钮 + `postJSON` 调用 |
| `public/styles.css` | `.arow` 双条（复用 `--face-*`） |
| `test/away.test.js`（新） | 上面的四组 |
| `docs/MEMORY.md` | R32 条目 + 共享契约变更记一笔 |

## 风险

- **费用失控**：句数限 6（最坏 9 次请求），外呼上限 50，作者点才跑，算过不重算。三道闸。
- **mock 下的无意义读数**：没 key 时走 mock，作者会看到一份全是「读不出来」的报告。按钮文案已经说清要花钱，但 mock 结果照给不误——与 `/api/check` 无 key 即 mock 的既有行为一致。
- **切句对非中文文本**：探针的正则只认中英标点。目标语言是中文（`vocab.js` 整个词表是中文小镇），标题类预设一行一句走粗切路径，不受影响。