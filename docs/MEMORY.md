# MEMORY · 项目记忆日志

> **格式约定：最新条目在最上方。** 每条 = 日期 + 标题 + 事实/决策/坑。
> 写事实不写流水账；任务完成后把 handoff 压缩成一条追加到顶部。
> 会话级记忆（用户偏好等）另见 agent 宿主环境的 memory，不混入本文件。

---

## 2026-10-03 · R37 创意轮：Jev 开局那份预测到底兑现没有——三条真实文本三臂对照，报告新增「押得准吗」十档对账表

**本轮问的问题**：`exposure()`（`feed.js:130`）= Jev 开局给 83 组人群打的 CARE 分数的折立方和
（`WEIGHT_OF_PART = { interest: 1, field: 1, age: 0.6, shopping: 1.5, budget: 0.6 }`）。
**它是整个产品里唯一一个在任何人有反应之前就做好的预测**——第 1 波那 600 个人就是照它挑的，
而报告把 Jev 说的每句话和之后发生的每件事都摆出来了，唯独这份预测从没拿去和结果对账。

**先量，再写设计**。四条文本各跑一次三臂（每臂 200 人，`scripts/probe-openpick.js`，真 Jev）：
`A 尖` = exposure 最高 200 人、`C 随机` = 去掉尖和底之后洗牌抽 200 人、`B 底` = 最低 200 人。
| 文本 | A 尖 停下率 | C 随机 | B 底 | A/C |
|---|---|---|---|---|
| 出 iPhone 13…1400 元 | **83%** | 10% | 3% | **8.25×**（乐见 78 对 8） |
| 降噪耳机，两种颜色 | 68% | 39% | 29% | 1.74×（乐见 5.40×、转传 3.50×） |
| 每周例会砍到 15 分钟 | 56% | 31% | 10% | 1.82× |
| **周三下午三点停电** | 69% | 71% | 60% | **0.97×**（押平了） |
最后一条是**坏消息也是真消息**：B 臂 mood 同样是正的 +0.070，不是末档人讨厌它，是末档人也无所谓
——「谁都在意的文本」本来就该押平。**所以新东西必须能报坏消息，否则一上线就变成了自我表扬。**

**mock 完全不能用**：`probe-openpick.js` 在 mock 上跑出 A−B 情绪 0.000、B 臂停下率反而最高（49%）——
mock 的反应模型不看人格，任何人格分层在 mock 上都测不出东西。这是 mock 不可作证据的第三次实证。

**CPU 预算是先算的，不是写完再看的**：`scripts/probe-bandcost.js` 量出逐人调 `exposure()`（每个人重建
一次 83 列折立方表）= **22.0ms**，免费档 10ms/请求直接撞死；「折一次、万人折一次」（`cubeTable`
+ CSR 行）= **0.11ms**。据此才决定给 `cubeTable` 开批量入口 `exposureAll()`。

**产物**（零新增 Jev 调用，打分是开局那一次算的，这里只对账）：
- `feed.js` 新增 `exposureAll(personas, scores, presetId)` 与 `exposureBands(presetId, keys, scores, reactions, people, {bands=10})`。
  十档按**全城一万格**的 exposure 九分位切（不按到达的人切，否则「谁该先看到」会被筛过的样本定义掉）。
- `labels.js` 新增 `CALIBRATE_ZH` / `CALIBRATE_SAY_ZH = { good: 2, mild: 0.8 }` / `calibrateSayZh()`：
  good 说「押中了」、mild 说「押得偏弱」、flat 说「押平了」、两端不足说「读不出来」。
  **2 倍这个界是量出来的**：落在 iPhone 实测 28.9 倍与停电实测 0.97 倍之间。
- `worker/index.js showPost` 与 `public/shared/replay.js` 都接上，返回体加 `bands`（旧版本无 scores → null，
  沿用 replay.js 既有的「回放旧存档不该凭空长出一节」做法）；`render.js` 新增 `bandsView`，插在 jevReading 之后。
- `scripts/check.js` 终端也打这一节；**存档 JSON 从此写 `scores`**。
- `public/examples/iphone-listing-v{1,2}.json` 补上 `scores`（`probe-fixarchive.js` 真 Jev 重问，各 $0.0003）——
  **两份示例存档原本都没有 scores**，首页示例的 exposure 根本重算不出来。这是本轮顺手挖出的第二条发现。

**报告上的数（真实存档，两份互相独立）**：v1 到达 2100/停下 516（24.6%），档 1（exposure 0.348–2.594）
614 人停下 **62.9%**（7.50×），档 10（0.000–0.044）92 人停下 **2.2%**（0.04×）→ **首末停下率比 28.92 倍**；
v2 档 1 65.9% / 档 10 4.5% = **14.49 倍**（乐见率比 25.20 倍）。第 1 波 600 人里 505 人在档 1（前 3 档 88%）。

**开局打分本身稳不稳也量了**（`probe-opening.js`，复读两遍取差）：listing 极差 0.850，
复读噪声平均绝对差 **0.0042**（极差的 0%）、最大 0.0275；post 极差 0.643，噪声 0.0092（极差的 1%）。

**坑（都写进代码注释和断言了）**：
1. **假打分必须用真实组 id**（`requests.js groupsOf(true)` 给 83 个）——自造 `interest:v0` 时查表全 undefined、
   exposure 恒 0，第一版量出「区间 0.000–0.000」的废数。
2. **随机臂必须显式 Fisher–Yates 洗牌 + 断言三臂互斥**，否则 `random()` 有放回，重复抽到同一个人，
   「随机」和「有偏」根本分不开（探针自己撞出 `两臂撞上同一个人 8554`）。
3. **直方图数切点时 `while` 必须允许一个桶里出多条切线**（分数量化后全城堆在少数桶），否则十档不均；
   同时不能写成 `while (seen < want) seen += hist[cuts.length]`（桶不连续时 cuts.length 卡住 → 死循环）。
4. **忘了 `rows.reverse()`**：档 1 本该是曝光最高，探针立刻抓到 505/600 的人落在档 10。
5. **`stoppedRatio` 可能是 null**（v1 末档一个乐见的都没有）。第一版 `bands.first.stoppedRatio ?? 0` 会把
   「读不出来」说成「押得偏弱」，而 `calibrateSayZh` 里 null 必须走 thin。
6. **`const town = {...}` 声明在一次编辑里被删掉**，两个分支都引用它 → ReferenceError。
7. 我自己先写错了一条断言：以为「押平」时 `stoppedRatio` 该是 null。实际 `flat` 是结论位、倍数仍是量出来的
   读数（实测 0.9575）。**改断言不改代码**——结论位与读数位要分开，否则会把「没差别」误报成「读不出来」。

**顺手发现，没接**：`WAVES` 每条自带随机尾巴 `[{600,100},{1500,150},{3000,300},{全城,0}]`——
第 1 波 600 人里有 100 人是**随机塞进来的**，也就是每次检查都自带一个随机对照组，从来没报过它。
名单在 `versions.plan.history`（`worker/index.js:501`），`waveBytes` 可按波还原（`:653`）。
这轮只攒 100 人、噪声太大（`probe-randomtail.js` 量过），留作下一轮的原料。

**验证**：`npm test` **196/196 pass / 0 fail**（R36 是 188，+8）；`npm run lint` ✓ 47 个文件；
`node scripts/golden-waves.js --check` → `GOLDEN IDENTICAL —— 16 行波次名单一字未变`
（波次名单存在 `versions.plan` 里，`firstWave` 改成走 `exposureAll` 后必须一字不变）。
CPU：`exposureAll` 冷 1.35ms、`exposureBands` 进程内第一次 5.4ms / 热 2.0ms；
对照今天已有的 `segments()` 单是 27.6ms——**报告路径本来就已超 10ms 多，新增这 5.4ms 只是把既有超标再抬高，
不是新增超标**。设计文档 `docs/superpowers/specs/2026-10-02-exposure-calibration-design.md`，
实施计划 `docs/superpowers/plans/2026-10-02-exposure-calibration.md`。


---

---

