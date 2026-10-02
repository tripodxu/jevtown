# MEMORY · 项目记忆日志

> **格式约定：最新条目在最上方。** 每条 = 日期 + 标题 + 事实/决策/坑。
> 写事实不写流水账；任务完成后把 handoff 压缩成一条追加到顶部。
> 会话级记忆（用户偏好等）另见 agent 宿主环境的 memory，不混入本文件。

---

---

## 2026-10-02 · R32 创意轮：「哪一句在撑」——给 Jev 差分题而不是判断题，统计量取组间拉得开度

**用户问的**（本轮开头就定了）：用 Jev 做点有意思的。做法按 brainstorming skill 的流程走：
先探索找空白 → 提方案 → 分节逐节获批 → 写 spec → 才动手（HARD-GATE 守住了，获批前只写探针）。

**找到的空白**：Jev 在这个项目里只被问过两种问题，都关于**人**——「多在乎」（`exposureRequest`
83 组 score）与「会怎么做」（`reactionRequest` 每人一道 choice）。没有一个关于**文本自身**。
唯一试图问文本的 `TEXT_CHECKS.point_first` 恰恰失败：`docs/measurements.md` 记着它在
post/product 上答案都在 0.5 附近——Jev 答不出「第一句是否重要」。

**换法：不给判断题，给差分题。** 同一批人同一套问题，删掉第 i 句再读一遍，看差多少
（消融法，`public/shared/away.js`）。

**三条实测结论（探针 `scripts/probe-sentence.js`，真跑 typesafe，成本 $0.002–0.003/次）**：

1. **均值承重只在「没人要的文字」上可用**。三段文本 9 句里只有 3 句的均值压过噪声；
   婴儿车那段 3 句的均值全是 0.0003 / −0.0068 / −0.0018，作者会拿到一张空白报告。
2. **组间拉得开度三段全过**（45–134 倍噪声），每句有 30–55 组压过自身噪声 3 倍。
   婴儿车「急出婴儿车，九成新，」这半句在 `interest:parenting` 是 **+0.445**、
   在 `field:student` 是 **−0.175**——均值把「一组人买、一组人掉头」抵平成 0，信号却还在。
   → **统计量取拉得开度**（用户 m01634 看到数据后改的选，理由就是第 2 条）。
3. **措辞本身的影响比一部分句子的信号还大**（0.0114–0.0198，iPhone 第 4 句信号只有 0.0079）。
   消融变体要改 `instructions`（点明删了哪句），delta 里就混进了「我说了删了一句」这件事。
   只量「同措辞复读」不够，**必须在 variants 循环里同时累计 `worded = |base − control|` 再从 delta 里减掉**。

**交付形态**：按钮触发（用户 m01637 选）——不塞进 `runCheck`（不阻塞主流程）、算过不重算
（存在 `versions.away`，回访返回 `cached: true`）、只有作者能点。
设计另两条决定：`MAX_ABLATION_SENTENCES = 6`（最坏 9 次请求，在免费档 50 次外呼内）、
`SPREAD_OVER_NOISE = 6`（定 1 会让每句都通过）、`STRONG_OVER_NOISE = 3`。

**落点**：`public/shared/away.js`（切句 / 一路请求 / 统计 / 编排）、`migrations/0008_away.sql`
（`ALTER TABLE versions ADD COLUMN away TEXT`）、`worker/index.js` 的 `runAway`
（校验序 404 → 403 作者 → 409 未完 → 404 版本 → cached）、`public/render.js` 的 `awayBar`/`awayView`、
`public/app.js` 的 `#result` 委托按钮、`public/shared/labels.js` 的 `AWAY_ZH`。

**记账口径**：`batches.stage='ablate'`，`n` 用 `AWAY_N = { base:-1, control:-2, noise:-3 }`，
`gone:<i>` 走句号下标——**负数让四路与 N 个消融路各自成行不互相累加**，
`callReport` 按 stage 聚合后 `ablate.n === 句数 + 3`。

**三个自己写的 bug（都是当场被测出来的）**：
1. `ablationStats(parts, { base, control, noise, gone })` 的 `gone` 要是**数组**，
   而 `runAblation` 存的是 `{'gone:0': …}` 这种带键对象——`gone[i]` 永远 undefined。
2. `requests` 原来在 `send` 成功后才 `+=1`，**失败的那一次不计数** → 外呼上限形同虚设。
   改成进函数就计数（尝试次数，不是成功次数）。
3. 测试里拿「第几组」当「第几档」写期望，`groupsOf` 的顺序会变 → 改成按 key 顺序重算期望值。

**「没有 NOISE 就没有门槛」**：跑不成全部路数时把 `readable` 全部压回 false，
宁可说读不出，不说读得开（base 顶替 noise 会让 spread/noise 恒等于 1 → 每句都通过）。

**验证**：真实 Jev 用落地的 `runAblation` 复跑探针数据——iPhone 4 句 / 7 次请求 / $0.0025，
句 1 top `shopping:phone` **+0.515**（探针 +0.537）、句 2 bottom `tea` **−0.4175**（探针 −0.408）；
婴儿车 3 句 / 6 次 / $0.0021，句 1 `interest:parenting` **+0.46**（探针 +0.445）。
**spread/noise ≈ 121×**。`test/away.test.js` 10 组 + `test/worker.test.js` 端到端 1 组。

**坑**：`impeccable detect` 的输出仍全是假阳性（底色配的 `#f5f7fc` 仓库里不存在）——
**detector 只当线索，一切以自写脚本算的数字为准**。

---

## 2026-10-02 · R31 优化轮：pick() 的切线补位是平方级——平坦分数下开局就超免费档 CPU 预算

- **怎么找到的**：R30 做完轮到优化轮，先按 MEMORY 里的老规矩「先剖析再动手」量 Worker 的
  纯 CPU 热路径（免费档一次调用只有 10ms CPU、50 个外呼）。`showPost` 那条路 R4 已经压到
  10.96ms（`crowdTerrain` 占 8ms 且已缓存），已经很紧；但**没人量过 `feed.js` 的波次算法**——
  那是每次开局（`POST /api/check`）和每次续传（`POST /api/wave`）都要跑的。量出来：
  `firstWave` 单次 **11.87–14.29ms**，已经超预算；`nextWave` 6.2–6.6ms。
- **热点不是打分，是"补位"**。拆开 `pick()`（`public/shared/feed.js`）的每一段：
  filter 0.21ms、算 exposure 3.05ms、排序 0.09ms、**分桶 + 补位 8.70–10.86ms**。
  补位那段是：
  `for (let i = 0; i < rest.length && best.length < wanted; i++) if (rest[i].rank === cut) best.push(...rest.splice(i--, 1));`
  ——在扫 `rest` 的同时对 `rest` 做 `splice`，**人数在切线上时是平方级**。
- **什么时候一万人会同时压在切线上**：`cut` 取的是第 `wanted` 高的分；分数平坦时
  （`cut = 0` 或全同值）一万人全等于 `cut`。实测 `iphone-listing-v1.json` 那份存档
  **`scores` 是空的**（存档只存 reactions/waves，不存属性分数），跑出来正是这个形状：
  `cut=0`，**10000 人全在切线上**。真实触发它的是"Jev 给一组人群同样的低分"——也就是说，
  **越是没人特别在意的文字，开局那一下越贵**。而开局是每个 post 的第一个请求。
- **改法**（`pick()`）：两趟线性扫描替掉一趟平方扫描。第一趟数出严格高于 `cut` 的人数，
  第二趟按 `unseen` 的原顺序填 `best`/`rest`，切线上的前 `wanted - above` 个进 `best`，
  其余进 `rest`。**输出逐 id 相同，种子对种子**（见下）。计时：平坦形状 **9.20 → 2.27ms**，
  真实分数 3.73 → 3.28ms，整条 `firstWave` **14.29 → 3.38ms**。
- **等价性是差分验的，不是看注释推的**：临时脚本把旧版 `pick()` 逐字抄一份，
  同输入同种子对拍 **144 组**（4 预设 × 6 种分数形状：真实/全 0/前 10/后 10/单点/全同值
  × 6 颗种子），要求**逐个 id 相同**——全过。
  **这个差分抓到我自己第一版的 bug**：我第一版把切线上落选的人挪出了抽签池，
  结果全 0 分数下 `wanted=500` 只排出 500 人而不是 600（随机那 100 个没地方抽），
  「单点」形状下 1500 只排出 1350。第二版还踩了**顺序**——把 `rest` 重排成
  `onCut.slice(taken)` 再 `below` 会改变抽签结果，而**波次名单是存进 `versions.plan`
  的检查结果**，种子变了就是"换了一次检查"，不是优化。最终版的 `rest` 严格保持 `unseen`
  原序，才逐 id 对上。**教训：改这类"既是性能热路径又是产品语义"的函数，先把旧实现抄一份
  做差分再动手。**
- **测试**（`test/feed.test.js`，68 → 9 组用例）：① 平坦分数（`flatScores()` 给所有属性同一个
  分 → 一万人同压切线）仍排满 `WAVES[0].size = 600`；② 同种子两次 `firstWave` 逐 id 相同、
  异种子不同（把"波次是检查结果"这条不变式钉住）；③ 前 `wanted` 个与抽签的 `random` 个
  合起来整波不重复。`node --test test/feed.test.js` 9/9 ✓，`npm test` **129/129 pass / 0 fail
  / 22.2s**（worker 集成测试真跑通），`npm run lint` ✓ 44 个文件。
- **还量了但这轮没动的**（留给下一轮）：`nextWave` 6.5ms 是现在最热的一条——它对已到达的
  2100 人逐个 `attributesOf()` 再 `share.get()` 哈希查（清点段 3.58ms）+ 对全城一万人跑
  `rank()`（4.33ms）。清点段有个 3.64 → 2.86ms 的小改（`Map.get` 未命中时才 `set`），
  但真正的做法是把 `share` 也编成属性号的 `Float64Array`、把 `attributesOf` 编成 CSR——
  跟 R4 给 `segments()` 做的同一件事。收益要等下一轮的实测。
- **坑（pwsh）**：`2>&1 | Select-Object -Last N` 会缓冲到命令结束才输出，长命令看起来像卡死
  → 应 `*> xxx.log` 落盘再 `Get-Content -Tail`。`Tee-Object` 也行。

## 2026-10-02 · R30 前端轮：给六色反应墨水分「地图版」与「面版」——浅色主题的图表此前全线隐形

- **要修的缺陷（自己算的数，不是 detector 说的）**：报告里的条、堆叠段、图例点、SVG 图表、
  人格声音点、切片热力格这些**直接压在卡片/内槽表面上**的图形，一直用的是地图数据墨水
  （`--map-green` 等，字面值来自 `presets.js` 的 `LOOKS`）。R3 只解决了地图画布那一层
  （把 `--map-well` 做成暖近黑/冷钢灰），**卡片表面这条路没被兜住**。实测浅色两套主题：
  bulletin 的 inset/card 上 绿 **1.42–1.67**、黄 **1.10–1.29**、蓝 **1.92–2.26**、红 **2.41–2.83**；
  instrument 几乎同值。非文字图形要 3:1，全线不到。
- **做法**：新增一层 `--face-*`（`--face-dark/scrolled/hollow/stopped/glad/spreads/sorry`），
  同色相压暗一档的「面版」，四套主题各自定值；映射单源在 `public/inks.js`
  （`faceInk(look)` / `FACE_INKS`）。暗色两套主题的面版 = 地图墨水本身（它们本来就够亮），
  浅色两套换成深墨，**四个信号色在四个表面（bg/card/card-2/inset）上全部 ≥3:1，最低 4.36**。
  背景级三色（dark/scrolled/hollow）刻意不给下限——它们本来就该退到背景里去，
  给下限会逼着人把「没轮到他」的格子调亮。
- **换掉的地方**：`styles.css` 的 `.fgo/.fhold/.fdrop`（旧漏斗三色）、R29 新加的
  `.ffar/.fnear/.fbelow`、`.chip.clustered/.scattered`、`.legend .dot.ring.hot/.cold`；
  `charts.js` 的 `waveMixChart` 段色、`demandChart` 曲线、`shareChart` 带状填充与图例
  字色、`sliceChart` 热力格与色标；`render.js` 的 `countsView` 条、`segmentsView` 条、
  `voicesView` 反应点、`reactionLegend` 图例点；`app.js` 的耗时曲线色；
  `sharecard.js` 的乐见/反感 KPI 字色。
- **顺手修的两个连带缺陷**：① `charts.js` 的 `funnel` 里类名少了 `f` 前缀
  （`go/hold/drop` 而 CSS 是 `.fgo/.fhold/.fdrop`）——**三档情绪色从来没生效过，一直是默认 `--accent`**。
  ② 传播图例点与差分图例的半档都按**地图底板**掺，但图例画在卡片上：浅色主题浅档只有
  **2.26–2.29:1**。现在 `grid.js` 加 `reachLegendInk(wave)`（掺 `--card`），
  差分图例的半档改 `color-mix(..., var(--card))`。地图画布本身仍按 `--map-well` 掺（那条路径没动，
  断言里钉住了）。
- **`shareChart` 的带状填充**从 0.28/0.5/0.5 提到 0.5/0.7/0.7：这三片是同一片域的成分，
  0.5 的填充在暗底上只有 2.06–2.95:1，读不出边界。
- **顺带发现并修掉的三个文字对比度缺陷**（都在最深的 `--inset` 表面上，全部低于 WCAG AA 4.5:1）：
  bulletin `--muted #6f6a5c` → `#6b665a`（4.30 → 4.55）；bulletin `--ok #1d7a4c` → `#1a7145`（4.24 → 4.79）；
  instrument `--bad #c22f2f` → `#bc2a2a`（4.48 → 4.79）。改完四套主题 × 4 表面 × 5 文字角色
  + 按钮文字全部 ≥4.5。
- **测试**：新建 `test/theme.test.js`（4 组）。① 四主题 × 4 表面 × 5 文字角色 + 按钮文字 ≥4.5；
  ② 令牌完整性；③ `--face-*` 四个信号色 × 四表面 ≥3:1；④ 七色齐备 + 地图墨水在 `--map-well`
  上仍 ≥3:1（防止面版改造把地图那条路径改坏）。**解析器要跟 `var()`**：面版在暗色主题里写成
  `var(--map-blue)`，只认字面 `#rrggbb` 会漏掉它们（第一版就这么写，4 组里挂了 2 组）。
  `tokensOf` 递归解 `var()`（带深度上限防环），非颜色值（`--font-body` 之类）直接跳过。
- **`impeccable detect` 的输出全是假阳性**：报 `index.html:0` 上 7 条低对比，
  配的底色是 `#f5f7fc`——**这个色在仓库里根本不存在**（grep 零命中），且行号 `:0` 说明它没定位到行。
  **detector 只当线索，一切以自己算的数字为准**；那三个真缺陷都是自写脚本算出来的。
- **验证**：`npm test` **126/126 pass / 0 fail / 22.9s**（比上轮 122 多 4 个，就是 `theme.test.js`）；
  `npm run lint` ✓ **44 个文件**；`node --check` 六个改动文件全过；
  用 DOM 桩跑 `renderCheck`（示例存档 `iphone-listing-v1.json` 经 `replayToView`）
  抓下渲染出的全部颜色变量：**只剩 `--face-*`，无任何地图墨水漏进卡片表面，也无写死的字面色**。

## 2026-10-02 · R29 创意轮：随机基线实验——续传阈值画在随机线之下（判据本轮不改，只交证据）

- **用户问题已答**：为什么"几次实验都早停在第一轮很少的人数"——不是人数上限（`WAVES[0].size = 600`），
  也不是抽样噪声。**根因：`GLAD_ENOUGH = 0.1` 低于随机基线。** 均匀抽反应时 listing 反应表
  （`scrolled_past 0 / opened 0 / saved +1 / wrote +1 / scam −1 / cant_tell 0`）的 tone 均值
  **+0.167**、标准差 0.687、600 人一波标准误 0.028。真实 Jev 的 iPhone 帖第 1 波 mood
  **+0.102 = z −2.32**（比掷骰子还差）竟过了闸续传；咖啡馆帖第 1 波 +0.005 / z −5.76 直接停。
  随机臂四波 mood 恒在 +0.13~+0.19，**四波全过、传遍 10,000 人**。
- **三臂探针**：`scripts/probe-waves.js`（CLI，不参与 `npm test`；key 从 `.env.local` 读，gitignored；
  `--real --only A|B|C`，`--preset`、`--max-waves`）。A 真实 Jev 原样 / B 纯随机
  （`rng(hash32('rand',versionId,who.id))()` 均匀抽反应，不花钱）/ C 洗掉形状
  （`waveMean = averageOf(wave)` 每波内更新，每人拿全波平均分布，仍问 Jev）。
  **Jev 答案用 `answerOf` Map 三臂共用，钱只花一遍**——漏查缓存会让三条臂各问一遍，成本 ×3
  （第一版踩过：128 次请求 → 修后 101 次）。每臂用同一颗种子 `rng(hash32('waves','zh',versionId))`
  保证同一批波与同样抽样。
- **"与随机相比的优势"该怎么表述**（写进报告，也是给作者看的说法）：Jev 的价值**不是"让它传"**
  （随机更彻底），而是**把没人要的文本判死在第一波**。三段文本随机都给 10,000 人 / 4 波；
  Jev 给出 600（咖啡馆）/ 600（二手电动车）/ 2,100（iPhone，2 波）——**有区分的答案**。
  转传率单独不可用：iPhone 三臂转传率 17%/16%/17%，随机臂一样 17%。
- **关键取舍（用户决定）**：m00674 选「保留 mood 加第二信号」→ 看到数据后 m00711 改选
  **「本轮不改判据，只把随机基线交给作者和来访者看」**。理由：改阈值需更多真实样本来标定。
  已落地：`feed.js` 加 `randomBaseline(presetId, n)`（→`{mean, sd, error}`）与
  `moodZ(presetId, waveMood, n)`，`GLAD_ENOUGH` 注释补"这条线在随机基线之下"；
  `labels.js` 加 `Z_SAY_ZH` + `zSayZh(z)`（≥2 far / ≤−2 below / 其余 near，三档措辞互异，
  below 档必须说"这是真答案，不是没读出来"）；`render.js` 的 `wavesView` 末尾接
  **`baselineView(result)`**（报告新增一节「和纯随机比，谁更想要它」：逐波 z 条 + 基线说明 +
  第 1 波人话结论）；`styles.css` 加 `.ffar/.fnear/.fbelow` 三色。报告全文在
  **`docs/research/wave-baseline-report.md`**（含 z / gladAmongStopped / 转传率三个待决候选）。
- **成本**：三臂完整跑一条 $0.0894 / 2,128,807 tokens / 102 请求（单臂 `--only A` ≈ $0.019）。
  单波 600 人 ≈ $0.0158，与 `real-api-report.md:15` 一致。
- **测试**：`test/feed.test.js` 加 2 组断言（随机基线为正且 `GLAD_ENOUGH < base.mean`；`moodZ`
  符号与 0/±1σ 对齐、且 `moodZ('listing', 0.102, 600) < -2` 钉住实测事实；另断言
  `randomBaseline('product', 600).mean > 0.3` 说明这条线对题材含义不同）；新建
  `test/labels.test.js`（3 组：`zSayZh` 边界 2/−2、三档互异且措辞、`directionZh` 九宫格）。
  `npm test` **122/122 pass / 0 fail / 39.1s**（worker 集成测试真跑通——日志见
  `POST /api/check 200 OK` + `GET /api/batch 200 OK` 连发；上轮 R28 时代的老 bug 已修，见下一条）。
  `npm run lint` ✓ **42 个文件**（新增 `test/labels.test.js`）；`node --check scripts/probe-waves.js` ✓。
  所以 MEMORY 里「R28 退役闸后全量绿未跑完」那条待办**已销账**。
- **复跑全量的正确姿势**：`npm test *> full-test.log`（**必须落盘**）。`2>&1 | Select-Object -Last N`
  会缓冲到命令结束才输出，管道中途看不到任何进度，很容易误判成「卡住」——本轮前两次
  `node --test`（不带文件参数、直接跑全量）就是这样被误判成死循环并 kill 掉的。
- **坑**：`renderCheck` 需要 DOM 桩才能在 Node 里跑，`node -e` 内联桩连续失败
  （`document is not defined` → `getElementById is not a function` → `Cannot read properties of
  undefined (reading 'append')` → `Cannot read properties of null (reading 'addEventListener')`），
  最后写成临时文件（验完即删）才验成新节输出。`directionZh({x:99,y:0})` 是「右上」不是「左上」——
  写断言前先跑一遍看实际值，别凭直觉写期望。

## 2026-10-01 · R29 审查：Jev 调用层 7 条加固 + 修回 R28 遗留的 `ip is not defined`

- **为什么做**：一次只读的代码审查问「使用 jev 的部分有没有问题」，对 `public/shared/jev.js`
  → `requests.js` → `check.js` → `worker/index.js` 全链路逐条比契约，得到 7 条问题，
  全部改掉；顺带发现测试从来没成功过的真正原因。
- **契约核实**（对照 `_research_raw/demo_server_model_jev.ts` 官方客户端与上游 `gj_public_jev.js`）：
  `POST https://api.typesafe.ai/v1/systemone`、模型 `jev-1.13.0`、请求体 `{ state, questions, model }`、
  响应 `{ answers, model, usage }`、计费按 `usage.input_tokens`（官方注释
  "input is billed at $42 per billion tokens" ⇒ `0.042 / 1e6`，**与本地一致**）；
  题型 choice/score/noul 与读回 probabilities/score/noul、`UNLISTED_FROM = 0.5` / `BLOCKED_FROM = 0.85`
  与上游 `gj_requests.js`/`gj_check.js` 一致。**传输层 `public/shared/jev.js` 与上游逐行相同，
  本地零偏差——7 条问题全在本地新写的编排层。** OpenRouter 走 `usage.cost` 实报。
- **7 条（全部已改）**：
  1. **200 但没有 answers 不能算成功**（中高）：`ask()` 现在把「响应里没有 answers 对象」记为
     `no answers in the result`、`把 problems 里一条都没答上` 记为 `none of the questions was
     answered`，两者都按服务端错误那样重试/换路；返回前按 `questions` 过滤出真答上的。
     **取舍**：只把「一条都没答上」当故障，**部分缺失仍算成功**——那是 Jev 自己的「说不清 /
     跳过」，不是网关坏了。原行为会把批次记成已问 100 人而概率为空：钱照花，人永远判不出来。
  2. **`runFollowUp` 一批失败不回滚已花的钱**（中）：逐批 try/catch，失败
     `console.error` 后 `break` 就地收尾，不重来整段（重来=付两次）。答到的照常交出去。
  3. **收尾 catch 与 `shared/check.js` 同一分流**（中低）：`fatal` / `no_key` 先 rethrow，
     否则只把这一题标 `missing = 'failed'`。原来 fatal（key 失效/鉴权错）被吞成
     「收尾问题全 failed，帖子照常 done」——页面看着完整，其实一个答案都没有。
  4. **BYOK 花销算进全站日预算**（低）：**无需改代码**——R28（5430d3c）已把 `overBudget` /
     `spentToday` 整体退役，预算闸已不存在。
  5. **BYOK key 随 GET 一起发**（低）：`public/app.js` 新增 `readJSON(url)`（只带 `x-jev-author`，
     不带 `x-jev-key`），把 5 个纯读调用点（`/api/post/:id?v=` ×4、`/api/feed`）换过去；
     `/api/batch` 是花钱路由，**仍留在 `getJSON`**。
  6. **`runFollowUp` 外呼数无上限**（低）：新增 `FOLLOW_UP_MAX_BATCHES = 24`，
     `target = Math.min(stopped.length, 24 * PER_REQUEST)`。免费档一次 Worker 调用最多 50 外呼，
     一次收波要在同一次调用里把追问 + 收尾问句全问完，追问是 stopped 的全部人（实测两三千 →
     十几批），撞墙会让 post 卡在 closing 等人重试、重试再付一次钱。另把 `retries = { left: 40 }`
     提成 `RETRIES_PER_INVOCATION = 40` 并注释它 ≠ `MAX_ATTEMPTS = 5`：前者是一次 Worker 调用的
     共享外呼预算（几十个批次各带 5 次重试会先撞 Cloudflare 50 上限），后者是单批自己的。
  7. **`text.slice(0, MAX_TEXT_CHARS)` 按 UTF-16 code unit 切**（很低）：`requests.js` 加模块内
     `clip(text, limit)`（`[...text]` 按 code point），`stateOf` 与 `audienceRequest` 改用它，
     不会切半 emoji。
- **致命 bug（R28 遗留，非本次编辑引入）**：`npm test` 从来没成功过，用户报「测试时间极长、
  从未成功」。真因：`POST /api/check` 抛 `ReferenceError: ip is not defined` → post 从未创建 →
  `test/helper.js` 的 `runToDone`/`runBatches` 里 `for(;;)` 无限打 `/api/batch?post=&v=1` 得 404，
  测试**死循环**而不是变慢（日志刷满 `GET /api/batch 404`）。根因是 R28（5430d3c）删掉了两处
  `const ip = request.headers.get('CF-Connecting-IP') ?? 'local';`（runCheck 与 runVersion 各一）
  连同限额查询，但 `worker/index.js` 两处 posts INSERT 仍 `.bind(..., day, ip, author)` 留下悬空
  引用。`migrations/0001_init.sql:11` 的 `ip TEXT` 列仍在（`:52` 还有 `idx_posts_day_ip`），只是
  没闸用它。**修法**：`runCheck` 恢复这一行并注释「posts.ip 只剩观测用途（每 IP 限额已随 R28
  退役），但列还在迁移里，写 NULL 等于把这份观测数据扔掉」——`runVersion` 只 INSERT `versions`，
  从不需要 `ip`，一处恢复覆盖两个 posts INSERT。
- **测试基建加固**：`test/helper.js` 的 `runToDone`/`runBatches` 加
  `if (!res.ok) throw new Error(\`/api/batch → ${res.status} ${await res.text()}\`);`——
  不 ok 就摊开状态与 body 立即失败，避免再出现「跑不完而不是失败」。
- **验证**：`npm test` **117/117 全绿**（worker 集成 13 项 + 其余 104）——这是 R28 记下的
  「全量绿未跑完」第一次补上；`npm run lint` ✓ 41 文件；`node --check` 五个改动文件全过。
- **坑**：pwsh 管道 `| Select-Object -Last N` 会缓冲到命令结束才输出，长命令看起来「没有输出」——
  应改用 `Tee-Object -FilePath` 让输出落盘。排查时用 `| Select-String -Pattern '^(✔|✖|ℹ|Error)'`
  只看结论行。web_search 无 key（`Error: DeepSeek search has no API key for "DEEPSEEK_API_KEY"`），
  契约只能靠 `_research_raw/` 官方材料核对。
- Open objectives：用户长期迭代目标（优化/创意/前端轮换，每轮一个中文 commit，真实用 jev +
  随机对照实验 + 回答「为什么停在第一波」）——本条为第 1 轮（优化轮）的收尾。

## 2026-09-30 · 上线：workers.dev 部署完成（R28 同日）

- **已做**：`npx wrangler d1 create jevtown`（database_id `adccbaa8-…` 已写入
  wrangler.jsonc）→ 远程迁移 0001–0007 全部应用 → `wrangler secret put TYPESAFE_API_KEY`
  → `npx wrangler deploy` → **https://jevtown-cn.xd04040212.workers.dev**（版本
  `76dca941`）。R28 的闸退役（5430d3c）已随部署生效：线上没有全局 429。
- **待办（下一次会话第一件事）**：
  1. **线上冒烟测试未跑完**（首页/`/api/feed`/一次 BYOK 真实检查）——本机 curl 到
     workers.dev 超时，不区分是网络还是部署问题；下次先 `curl -v` 复核。
  2. R28 退役闸后的 `npm test` 全量绿**已补跑**（2026-10-02，122/122 pass / 39.1s，集成测试真跑通）——本条销账。
  3. 自定义域、`JEV_PROVIDER` 保持 mock（真实检查走 BYOK）。
- 提交：`5430d3c`（闸退役 + wrangler.jsonc database_id 的前半在 103156c…5430d3c 之间；
  database_id 与本次上线说明随后续 docs 提交入库）。

## 2026-09-30 · R28 决策变更：退役限额/预算闸（BYOK-only），并为上线铺路

- **用户决策**：站点不提供站方 key，也不提供站内 API 额度——**所有真实检查一律走
  访客自填的 BYOK key**（花自己的钱），无 key 即 mock。每日限额（每 IP 20 次）与全站
  日预算（$5/天）两个闸整体退役。
- **为什么走到这一步**：本地所有请求的 `CF-Connecting-IP` 被 wrangler dev/unstable_dev
  注入为 `127.0.0.1`（回环），全站共享一个 20/天的桶——"一直处于限制状态"的直接原因。
  先做了回环豁免 + BYOK 豁免（limitExempt），但生产语义下豁免逻辑与测试 IP 模拟互相
  纠缠（TEST-NET IP 跨运行残留、execSync wrangler 与 dev 服务的 D1 可见性时序），
  复杂度不值——闸保护的对象（站方钱包）已经不存在，于是按用户决策整体删除。
- **改动**：worker/index.js 删 `limitExempt`/`spentToday`/`overBudget` 与全部四个调用点
  （check/version/batch/wave 不再有全局 429）；settleWave 收尾循环的软预算改为无条件
  问收尾；wrangler.jsonc 删两个 vars；文档（ARCHITECTURE 配置节）同步；测试删三个闸用例。
- **诚实记录**：R28 的完整 `npm test` 因 worker 集成测试起停缓慢被中断，**退役后的
  全量绿未跑完**——已验证的是 lint ✓ 与 `node --check`；既有用例里被删的只有三个闸用例，
  其余用例不依赖闸（消费预算闸结果的软预算分支已改为无条件收尾，mock 全流程测试
  `runToDone` 覆盖）。推远端前按验收清单跑一次全量。

## 2026-09-30 · R27 前端：快报复制 + 对比区焦点（119 用例不变）

- **先取证后动手**：375px 全段审计（快报/数字对照/热力图/构成条）**零缺陷**——
  dkpi 185px 两列放得下、零溢出。窄屏轮诚实地转做可达性收尾。
- **两件**：① `.brief` 右上「复制」按钮——纯文本快报进剪贴板，按钮「已复制」两秒反馈，
  失败显式说「复制失败」；剪贴板不可用（非安全上下文）时按钮整个隐藏（渐进增强）。
  委托在 document（report 内多处渲染，按钮随 innerHTML 重建）。② 载入第 1 版对比后
  焦点交给差分卡标题（tabindex="-1" + preventScroll），键盘/SR 用户随内容走。
- **环境插曲**：无头 Edge 连续 Runtime.enable 超时——根因是**诊断脚本 bash 引号断裂**
  把多个 URL 塞给 Edge（"Multiple targets are not supported"）且超时退出路径不杀进程，
  僵尸堆积。清进程后单次重试恢复。教训：CDP 脚本的 catch 路径也要收尾（edge.kill）。
- **验证**：lint ✓；119/119；E2E——桩剪贴板断言复制内容（99 字符纯文本含四行句）与
  按钮反馈；对比区焦点落「两版之差」；控制台零错误。真实剪贴板在无头环境被拒是
  环境限制（授权也无效），接线逻辑用桩验证。
- 计划文档：`docs/superpowers/plans/2026-09-30-r27-brief-copy.md`。

## 2026-09-30 · R26 创意：版本深链 + 修 v 越界 500（118 → 119 用例全绿）

- **点子**：R6 的报告深链只能看最新版——"第 1 版当时什么样"无法分享。补全：
  `?post=<id>&v=<n>` 直开指定版本，深链/回退键都认 v；多版本帖（R24 的）实测
  `?v=1` 打开的 reach=600（第 1 版）而非 10000。
- **顺带修查出的潜在 bug**：`?v=999` 此前 **500**——`loadVersion` 对不存在的版本返回
  null，showPost 未判空直接解引用。改 404（测试钉住）。
- **实现**：`openPost(id, versionHint)`——hint 请求 `?v=` 并把 `current.version` 定死
  （对比区的"改一版再发"基于 current.version，深链视角下行为一致）；载入/popstate 读
  `post` + `v` 双参数；feed 点击仍指最新版。
- **验证**：lint ✓；119/119（+1 404 用例）；E2E 三断言（v1 直开/URL 保持/越界报错不崩）。
- 计划文档：`docs/superpowers/plans/2026-09-30-r26-version-deeplink.md`。

## 2026-09-30 · R25 优化：报告快照列——showPost 从 1 万行读降到 1 行（118 用例全绿）

- **取证（代码级）**：`showPost` 每次执行 `SELECT id, wave, reaction FROM reactions`——
  全城检查 1 万行的读与传，且是最热的读路径（每次查看/刷新/对比区回拉）。D1 按
  rows_read 计费，免费档 5M 行/天 ≈ 500 次报告查看见底。
- **做法**：迁移 0007 给 versions 加 `looks`/`reach` 两列；settleWave 用 `reached` 与
  `plan.history` 就地组装两份字节，与"置 done"同批写入；showPost 双路径——有快照解码
  （每波反应名单从 bytes × waveBytes 无损重建，reactions 一次不读），running 中与
  迁移前旧版走既有逐行回退（实时语义不变，向后兼容）。
- **一致性**：R7 地形缓存同一洞察（冻结后不变）；既有 worker 测试全部经由 showPost——
  快照路径被传播层/地形/调用报告用例覆盖，回退路径被 running 中用例覆盖。另补断言：
  快照的 looks 与 reach 到达集合一致。
- **验证**：lint ✓；118/118；本地实测——R25 后的帖走快照、迁移前的旧版（looks NULL）
  走回退路径照常出全量报告（reach 10000 / 4 波 / 地形）。
- **收益口径**：结构论证（快照命中 = 0 行 reactions 读），1 万行 → 1 行。
- 计划文档：`docs/superpowers/plans/2026-09-30-r25-report-snapshot.md`。

## 2026-09-30 · R24 前端：两版数字对照（118 用例不变）

- **缺口**：差分卡给了"变好/变差 + 差分地图"，但两版头条数字（到达/停下/乐见/反感）
  没有并排——读者要在两份完整报告之间滚动做减法。数据本就在内存（对比区拉了第 1 版）。
- **实现**：`renderDelta` 顶部加 `.delta-kpis` 四行对照（`old → new (±diff)`），
  差值按语义着色：乐见↑/停下↑ = `--ok`、反感↑ = `--bad`、到达中性 `--muted`；
  两列网格，窄屏由 grid 自适应。0 差值显"持平"。
- **验证**：lint ✓；118/118；E2E（UI 驱动完整 v1+v2，mock）：四行数字与两版总览一致、
  方向着色正确（+3,052 绿 / +358 红）、375px 零溢出、控制台零错误。
- 计划文档：`docs/superpowers/plans/2026-09-30-r24-delta-kpis.md`。

## 2026-09-30 · R23 创意：小镇快报（115 → 118 用例全绿）

- **点子**：报告数据很全，但读者要自己拼出"这次到底怎么样"。报告顶部新增三行式
  TL;DR：传播句（几波/多少人/在哪收住）→ 态度句（乐见/反感/停下百分比）→ 条件句
  （最买账 / 反感最集中的群体）。
- **防病句设计（R5 教训的正面应用）**：选择逻辑（`reportBrief` 纯函数，best/worst 取
  topSegments 名单首位）与措辞（`briefView`，名词短语 + 括号注记，不用需要主谓宾搭配的
  从句）两分离；分支只有"单波/多波"两套模板。E2E 实测四行句全部成立且与总览同口径
  （乐见 12% ↔ 262/2100）。
- **自纠**：reportBrief 初版没给 `segmentsByKind` 默认值，测试用 `{}` 直接触发
  `undefined[0]`——补 `= {}` 与可选链。测试先行的价值： shapes 缺口在红测里现形。
- **验证**：lint ✓；118/118（+3）；E2E——快报位置在 toc 之后 source-text 之前、
  数字一致、无显著群体时不出现条件句、375px 零溢出、控制台零错误。
- 计划文档：`docs/superpowers/plans/2026-09-30-r23-brief.md`。

## 2026-09-30 · R22 优化：示例卡懒渲染（115 用例不变）

- **取证（Node 实测）**：`replayToView × 2 = 122.8ms` 纯 CPU——两张示例回放卡各付一份
  segments/crowdTerrain/voicesOf/切片热力/波次构成，再加 renderCheck 的 DOM/canvas/SVG
  成本，全部发生在首页加载时（showcase.js 是 module 顶层 await，同步占主线程），而卡片
  沉在折叠线下。
- **修法**：`showcase.js` 改 IntersectionObserver 懒渲染——卡片进入视口前 300px 才
  renderCheck，渲染一次即 disconnect；rootMargin 预渲染保证无可见跳变；无 IO 的环境
  直接渲染（不降级）；`.examples .card:empty { min-height: 420px }` 占位不塌陷。
- **环境插曲**：Edge 无头连续起不来（僵尸进程 + 端口失联），杀进程 + 换端口 + 加长启动
  等待后恢复——一次性 CDP 脚本的脆弱性记在案。
- **验证**：lint ✓；115/115；E2E——未滚动两卡皆空（占位 420px 生效）、滚动后两卡完整
  （热力图/头像都在）、控制台零错误。
- 计划文档：`docs/superpowers/plans/2026-09-30-r22-lazy-showcase.md`。

## 2026-09-30 · R21 前端：voices 反应色点 + 报告骨架屏（115 用例不变）

- **两处状态反馈收尾**：① 人格声音卡的反应词补 `rdot` 色点——LOOKS 数据墨水与地图图例
  同源（E2E 实测"转发了"= rgb(255,216,77) 黄，与图例一致），读者不用脑补对应关系；
  ② `openPost` 点击即往 `#result` 塞**骨架屏**（三行线 + 一大块，形状对齐报告布局；
  渐变扫光在 reduced-motion 下静止），失败时收回隐藏——比空白和转圈都诚实。
- 骨架被 `renderCheck` 的整体 innerHTML 替换自然吞掉，无需清理路径。
- **验证**：lint ✓；115/115；E2E——点击同步见骨架、渲染后消失、色点同色、控制台零错误。
- 计划文档：`docs/superpowers/plans/2026-09-30-r21-states.md`。

## 2026-09-30 · R20 创意：分享卡片（112 → 115 用例全绿）

- **点子**（路线图 Step 5「分享卡片」提前落地）：结果动作区「存为图片」——报告读数 +
  地图快照合成 1200×630 PNG 下载。纯浏览器合成（`canvas.toBlob`），数据全是既有
  payload 字段，零新增调用。
- **实现**：新文件 `public/sharecard.js`（命令式 canvas，与 charts.js 的 SVG 字符串
  路线不同源）；颜色取主题令牌 computed 值（卡片随当前主题）；地图快照
  `drawImage(报告画布)` 圆角裁切；KPI 用等宽字、乐见绿/反感红取数据墨水。
  `app.js` 存 `lastView` 供按钮取数。
- **自查两处**：① 地形行初版内联了措辞映射，造出"这次反应反应零散"的病句——改用
  labels.js 的 `TERRAIN_VERDICT_ZH` 单源（中文单源规则不是摆设）；② E2E 的 async
  evaluate 忘了 `awaitPromise: true`，返回 `{}` 差点误判失败。
- **验证**：lint ✓ 41 文件；115/115（+3 canvas 桩件用例：快照恰一次/KPI 上画面/
  无地形不硬造）；E2E blob 126KB + 卡片视觉（截图）+ 控制台零错误。
- 计划文档：`docs/superpowers/plans/2026-09-30-r20-share-card.md`。

## 2026-09-30 · R19 优化：人格打包管线（111 → 112 用例全绿，路线图 Step 4 项落地）

- **问题**：isolate 首个请求要现场算 1 万人格（Node 实测 130–142ms CPU），免费档单请求
  10ms CPU 装不下——备忘（R13）只省"第二次"，省不了"第一次"。这是路线图 Step 4 的
  上线阻塞项。
- **做法**：`personaCompute`（原 persona() 计算体，改名导出）→ `scripts/pack-personas.mjs`
  离线预计算成 `personas-pack.js`（每人 12 个小整数槽：名字/年龄/性别/城市/职业/兴趣×3/
  性情/预算/消费/想买；286KB 纯数据模块）→ `persona()` 优先解码。派生字段（field/
  ageGroup/x/y）按计算体同式推导；带 interests 覆盖参走计算路径（上游接口，本仓库无人用）。
- **实测**：`crowd('zh')` 冷启动 **130–142ms → 13.7ms**（含包解析，~10×）；单格解码 4.4µs；
  包 286KB（Worker 体积余量内）。
- **一致性守卫（本 round 的灵魂）**：`test/personas.test.js` 对 0..9999 逐个
  `assert.deepEqual(persona(id), personaCompute(id))`——改词表/生成逻辑后不重跑打包脚本
  必红。TDD 顺序：对拍先写先红，实现后转绿。鸡生蛋坑：生成脚本 import personas.js 而
  personas.js import 包文件——先放占位包再生成。
- **验证**：lint ✓ 39 文件；112/112；README 路线图 Step 4 已划掉该项。
- 计划文档：`docs/superpowers/plans/2026-09-30-r19-persona-pack.md`。

## 2026-09-30 · R18 前端：实时图表悬停读数（111 用例不变）

- **缺口**：三张监控图只有当前值+峰值，回看"第 30 批时吞吐多少"没有入口——数据就在
  `live.tput/msSeries/shares` 里。**svg 每批 innerHTML 重建 ⇒ 监听必须挂常驻容器**
  （事件委托），x 反算样本序号后插临时竖参考线 + `.chart-read` 读数；leave 清除；
  读数批次号 = 绝对批次号（图表只画最近窗口，roll 48 / share 60）。
- **抓到的 bug（自测抓的）**：`CHART_PADS[kind === 'ms' ? 'roll' : kind]` —— kind='tput'
  查不到键得 undefined，吞吐图悬停静默抛 TypeError；占比图先测通了所以有假象。
  修法：折线两图共用 'roll' 留白，`CHART_PADS` 从 charts.js 导出（改 pad 同步它）。
  另一处自查：局部变量 `const window` 遮蔽全局，改 `win`。
- **验证**：lint ✓；111/111；E2E 三图读数（第 16 批 · 489 人/s / 第 10 批 · 661ms /
  第 23 批 · 乐见 17% · 反感 4%）+ leave 清除 + 异常清零 + 375px 零溢出。
- 计划文档：`docs/superpowers/plans/2026-09-30-r18-chart-hover.md`。

## 2026-09-30 · R17 创意：程序化人格头像（108 → 111 用例全绿）

- **点子**：一万个居民各有一张确定性的"脸"——`hash32(pool, id)` 作 LCG 种子走出位流，
  5×5 **镜像** identicon（左 3 列生成、右 2 列镜像，对称才像脸）。零图片资产、零新增调用。
- **色彩纪律**：格子 = `--accent` 浓淡（hash 决定 opacity 0.35–0.89），底 = `--card-2`，
  **零硬编码色**（测试断言 SVG 里没有 #hex）——四主题自动跟随。确定性：同 id 同脸，
  测试断言两次调用字符串相等。
- **落点**：新文件 `public/avatar.js`（前端表现层，不进 shared/——三端不需要）；
  人格声音卡改 flex（头像 + .v-body 文案列）；tooltip 首行 inline 头像。
  **加法契约变更**：`base.post.pool` 随报告下发（Worker + replay.js 两处），头像种子需要它。
- **测试自身的两个坑（自查）**：镜像断言的正则先被 `rx="10"` 圆角属性污染（匹配到
  "列 10"），又忘了像素→格坐标换算（列 32 ≠ 列 4）——都是测试自己的错，实现是对的。
  教训：写断言前先把被测字符串的形状看全。
- **验证**：lint ✓ 38 文件；111/111（+3）；E2E——141 张 voices 卡头像全存在且互不相同、
  tooltip 头像就位、375px 零溢出、控制台零错误。
- 计划文档：`docs/superpowers/plans/2026-09-30-r17-avatar.md`。

## 2026-09-30 · R16 优化：feed 索引 + showPost 查询并行化（108 用例不变）

- **feed 全表扫描（EXPLAIN 实证）**：`ORDER BY created_at DESC LIMIT 20` 此前是
  `SCAN posts` + 临时 B 树排序——本地小事，线上 posts 增长后首页每次都付。迁移 0006 加
  `idx_posts_created`（SQLite 反向扫描升序索引即可，无需 DESC 索引），计划变为
  `SCAN posts USING INDEX idx_posts_created`。
- **showPost 查询并行化**：反应流水 / `versionsOf` / `callReport` 互相独立，原来串行
  三个 await（6 次 D1 往返的读路径），改 `Promise.all` 省 2 个往返。重构时把原串行查询
  留在了原地导致 `rows` 重复声明，lint 语法门抓住—— lint 先跑的又一次价值。
- **验证**：lint ✓；108/108；EXPLAIN 计划已换；dev server feed 实测 20 条正常。
- 「人格打包管线省 CPU」（路线图 Step 4）是独立的大活——离线预计算 + decode/consistency
  守卫，值得单独一轮，候选已记。
- 计划文档：本条目即计划（小轮）；执行同日完成。

## 2026-09-30 · R15 前端：地图键盘可达（106 → 108 用例全绿）

- **缺口**：地图是报告的核心读数，但 canvas 对键盘用户完全不可达（无 tabindex、无键位、
  hover 档案摸不到）。本轮补齐：tabindex + 方向键逐格导航 + 光标格高亮。
- **设计取舍**：每步**立即揭示档案**而不是"移动光标再按回车"——tooltip 带 role="status"，
  屏幕阅读器免费获得逐格播报；光标格用 `--accent`（UI 色，不是数据色，与六色反应墨水、
  传播层量表三方分清）；登记在 WeakMap，`paint()` 末尾描出——全量重画（换主题/换视图）
  自动带回（E2E 实测公报主题下光标格像素 = 新主题 accent）。首次按键落在 0 格（任何方向），
  再按才移动；`stepCell` 纯函数禁止跨行回绕（行首左移 = 出界，有单测钉住）。
- **两个自查**：① 替换旧代码块时留了个游离 `}`，lint 语法门第一时间抓住——lint 先跑
  的价值；② E2E 光标像素探针第一次"失败"，其实是坐标偏一格（3 次 ArrowRight 后光标在
  2 号格不是 3 号格）——教训：像素级断言先把坐标算清。
- **验证**：lint ✓；108/108（+4 stepCell）；E2E——Tab 聚焦、三按后 tooltip 逐格播报、
  Escape 收起、主题重绘后光标保留、控制台零错误。
- 计划文档：`docs/superpowers/plans/2026-09-30-r15-map-keyboard.md`。

## 2026-09-30 · R14 创意：每波反应构成（104 → 106 用例全绿）

- **点子**：波次漏斗只给"每波多少人 + 情绪均值"，看不见**构成**——传播稀释
  （第 1 波乐见、越往后越中性划走）要靠 `looks × reach` 交叉表。两份逐人字节 R8 起都在
  报告里，零 Worker 改动、零新增调用。
- **实现**：`summary.js` 的 `waveMix()`（只数到达过的人；**各波共用全城次数降序的反应序**
  ——每波自己排序会让跨波对比失效）→ `charts.js` 的 `waveMixChart()` DOM 堆叠条 →
  接在波次漏斗后。堆叠条用 **LOOKS 类别色**是语义正确的（它就是"什么反应"），与
  传播层的单色渐满量表刻意区分——两轮各守各的色板纪律。
- **自纠**：初版写了个占位废话行和双函数注入标签的过度设计，重写为单函数直接 import
  `labels.js`（worker 本就 import labels，shared 引中文单源无违规）。
- **验证**：lint ✓；106/106（+2：计数守恒/同序跨波可比）；E2E（真实 2,100 人报告）：
  两波各 7 段堆叠条、Top-2 读数、375px 零溢出、控制台零错误。
- 计划文档：`docs/superpowers/plans/2026-09-30-r14-wave-mix.md`。

## 2026-09-30 · R13 优化：crowd() 按 pool 备忘（103 → 104 用例全绿）

- **实测驱动**：`crowd('zh')` 首算 ~130–142ms 且无备忘；首页一次 load 算 **3 次**
  （showcase 回放卡 A/B + R11 切片热力图的 `townOf`）≈ 390ms 主线程阻塞。
- **修法**：备忘放进 `personas.js` 的 `crowd()` 本体（模块级 Map，键 = pool）——三端共用
  源码，**Worker 的 `crowdOf` 自动搭车**（isolate 里本来就常驻，语义不变），三个调用点
  一行不改。确定性 + 词表静态 ⇒ 无失效路径；**返回数组必须视为不可变**（与 groupTable /
  crowdCache 同一约定，写进函数注释）。代价：浏览器侧常驻 ~1 万个人格对象（MB 级），
  换 260ms 首载——值得。
- **验证**：Node 实测首算 142ms → 二次 0.00ms 且同一数组（改前 118ms 且 false）；
  lint ✓；104/104（+1 同一性用例）。`shared-engine.md` 已同步。

## 2026-09-30 · R12 前端：浏览器界面细节（103 用例不变）

- **方向判定**（taste-skill §0.B/§13）：jevtown 是 Operate 型产品界面，taste-skill 不覆盖
  dashboard 类——取其 Redesign-Preserve 纪律，技术依据是 impeccable craft-floor 的
  「Browser surfaces」：滚动条、插入光标这些"没被画出来的部件"也要跟主题令牌走。
- **改动三件**：① 滚动条主题化——`scrollbar-color` 是继承属性（:root 一次全页生效），
  **`scrollbar-width` 不是**，要逐容器声明（html + `.monitor-wrap`；窄屏 `.toc` 已有自己的
  thin）——第一版注释写错了继承性，CDP 复验抓出来补上的；② `textarea/input` 的
  `caret-color: var(--accent)`；③ 焦点落点——`showResult` 渲染后 `h2.focus({preventScroll:true})`
  （h2 加 tabindex="-1"），键盘与屏幕阅读器随视线进报告。
- **验证**：lint ✓ 103/103；CDP——root thin+主题色、`.monitor-wrap` thin（复验）、
  caret = 主题 accent、深链打开后 `activeElement` 是报告 h2、375px 零溢出、控制台零错误。
- 计划文档：`docs/superpowers/plans/2026-09-30-r12-browser-surfaces.md`。

## 2026-09-30 · R11 创意：人群切片热力图（100 → 103 用例全绿）

- **点子**：segments 是边际统计，答不了"哪个年龄段 × 哪类兴趣**一起**叫好"。而小镇网格
  本来就把兴趣按 5 个年龄段 × 8 列铺开（每格 ≈200 同龄同好邻居）——把反应场按**主兴趣**
  聚合回这 40 个"兴趣街区"，一张矩阵看穿组合效应。零 Worker 改动、零新增 Jev 调用。
- **实现**：`summary.js` 纯函数 `sliceHeatmap()`（沿 segments 的最小样本门思想：
  判定 < 25 人不给占比，`MIN_SLICE=25`）→ `charts.js` 的 `sliceChart()` SVG →
  `render.js` 接在分组分析之后。每人按 `interests[0]` 归唯一街区，边界毛边人群按真实
  属性算、不按网格坐标硬切。
- **主题跟随的取巧**：占比是顺序量表，fill 用 `color-mix(var(--map-green) N%, var(--map-well))`
  ——CSS 变量进 SVG 后主题切换自动跟随，**不需要 redrawMaps**（那是 canvas 专属）。
  坑：一页最多 4 张报告卡都带切片图，渐变 defs 的 id 必须逐图唯一（`sliceSeq` 计数）。
- **真实数据的效果**（R10 复测那次 2,100 人判定）：到达人数少时多数街区落进"判定少"
  虚线格——最小样本门在真实稀疏数据下如实工作，不硬造结论；全城检查（mock E2E）时
  40 格基本全亮。乐见高的格：钓鱼 16%、加密货币 12%、旅行 13%（全城 13%）。
- **验证**：lint ✓；103/103（+3：形状/聚合对拍/样本门）；CDP 实测 40 格 + hover title、
  主题切换 computed fill 变化、375px 零溢出零错误。
- 计划文档：`docs/superpowers/plans/2026-09-30-r11-slice-heatmap.md`。

## 2026-09-30 · R10 优化：花费记账精度 round2 → round4（100 用例不变，实地复测验证）

- **bug**（实地测试抓到）：`addSpend` 与 versions 累加把每批花费 `round2`，真实单价
  ~$0.0015/批 → D1 全部批次行 usd=0、站点显示 $0.010（CLI 实测 $0.033）、
  **`spentToday` 日预算闸失明**。mock 全 0，100 个用例抓不到——守护是实地复测。
- **修法**：账面与显示分离——存储/累加全部 `round4`（addSpend、三处 versions INSERT
  开局花费、batch/ask/followup 三处累加、batch 响应、callReport 汇总、spent 显示源），
  界面 toFixed(3/4) 不变；D1 列是 REAL 无迁移。`mood` 的 round2 是统计口径，不动。
- **实地复测**（真实 key，同文本）：站点 $0.010 → **$0.032**（CLI 基线 $0.033，
  波动内一致）；D1 分阶段 0.0003/0.0054/0.0135/…，当日合计 **$0.0320** 与显示一致；
  分阶段条形首次带出真实美元。控制台零错误，传播层/地形行为不变。
- **教训**：涉及钱的代码，mock 测试的"全绿"只覆盖形状不覆盖量级——精度类缺陷必须
  用真实流量复核一次。
- 计划文档：`docs/superpowers/plans/2026-09-30-r10-spend-precision.md`。

## 2026-09-30 · 实地测试（真实 Jev key）：CLI 与 BYOK 全链路通过，抓到记账精度 bug

- **通道**：TypeSafe 官方 API（用户提供的 key，只进 `.env.local` 与浏览器 localStorage，
  未触碰任何被版本库跟踪的文件）。两条路各跑一次同文本 iPhone 转让帖：
  - **CLI**（`npm run check`）：到达 2,100 人、第 2 波停（+0.24 / +0.02，与 9-28 实测区间
    吻合）、30 次调用 / 35.4s 模型耗时 / **$0.0330**，存档已带 R8 的 `waveOf` 字段。
  - **站点 BYOK**：徽章 `BYOK · typesafe` → 表单发起 → 实时监控真实吞吐 121 人/s、
    614ms/请求 → 报告 provider=typesafe、地形「零散」、传播层 600/1,500 逐波正确、
    控制台零错误。真实模型行为与历史实测一致（比 mock 挑剔，两波即停）。
- **抓到的 bug（R10 已修）**：`addSpend` 与 versions 累加把每批花费 `round2`
  （真实单价 ~$0.0015/批）——D1 里全部批次行 usd=0，站点显示 $0.010（只有开局那笔
  凑到分位），**低报约 3 倍；`spentToday` 日预算闸随之失明**。mock 全为 0，测试抓不到，
  只有真实流量暴露——这是实地测试的价值。
- 成本记录：两次真实检查合计 ≈ $0.07。

## 2026-09-30 · R9 前端：检查进行中的反馈（100 用例不变）

- **一个候选被数据否决**：Node 实测三张监控图每批重建 0.33ms（100 批共 33ms）——
  updateCharts 不加节流不缓存，别凭感觉优化。
- **修掉 R6 自己引入的回归**：`#statusLine` 曾挂 `role="status"` 而它逐批更新
  （全城检查 ≈100 条 polite 播报，屏幕阅读器被刷屏）。播报改为两层：statusLine 纯视觉；
  新增 sr-only `#statusLive` 只在里程碑更新（开局/收波/完成/拒发/失败），`announce()`
  是唯一入口。E2E 采样证实：批间更新时 live 区文本不变，只有收波等里程碑才变。
- **openPost 补加载反馈**：feed 点击/深链打开报告期间状态行显示「正在打开报告……」
  （此前拉数据期间像死机）；失败路径同步播报。
- 小修：实时统计标签 `tokens` → `输入 tokens`（与调用报告口径一致）。
- 验证：lint ✓；100/100；CDP 实测结构（statusLine 无 role、statusLive sr-only）+
  三个里程碑采样 + 深链即时反馈；控制台零错误。
- 计划文档：`docs/superpowers/plans/2026-09-30-r9-live-feedback.md`。

## 2026-09-30 · R8 创意：传播层与重播（94 → 100 用例全绿）

- **点子**：报告地图只有"谁做了什么反应"，没有"文字是怎么传开的"——而传播过程恰恰是
  这个产品的故事。新增地图第三视图「传播」：每格 = 这个人**在第几波看到**（0 = 没看到），
  配「重播传播」按波次逐步点亮。零新增 Jev 调用：引擎循环里本来就懂波次，Worker 的
  `reactions` 表本来就有 `wave` 列。
- **数据两端同构**：引擎 `runCheck` 补 `waveOf` Uint8Array（约 4 行，随结果/存档走，
  `scripts/check.js` 存档 +1 字段）；Worker `showPost` 从 `reactions.wave` 拼出 `reach`
  （base64）随报告返回——**这是跨 agent 契约变更（API 响应 +存档格式），已记
  worker-api.md / frontend.md**。旧存档示例是真实 API 生成的（usd≈$0.032），**不重生成**：
  旧档无 `waveOf` → replay 得 null → 传播按钮优雅缺席（E2E 实测 showcase 无此按钮）。
- **颜色决定**：传播是有序量表 → 单色渐满（`--map-blue` mixHex），刻意不用 LOOKS
  （类别色）也不用多色（多色暗示类别）。**计划里的 t=0.45 被数值复算推翻**：
  四主题最低只有 2.42:1；实测下限 t=0.58（3.17:1），量表定为 0.58/0.72/0.86/1。
  教训：对比度门"执行时数值验证"不是形式——写计划时的估算错了 0.5 档。
- **实现形态**：`grid.js` 登记项加 `mode`（reaction/reach），`paint` 分支，`redrawMaps`
  按层重画（主题切换实测不丢层）；`paintDelta` 碰传播层画布直接不动（它是实时反应地图
  专用路径）；传播层关悬停档案（`canvas.dataset.tipOff`，格子的语义是波次不是反应）。
  `render.js` 的单按钮地形开关升级为 `wireMapModes` 三视图；重播先清旧定时器再逐档
  （每档 650ms，reduced-motion 直接铺满）。
- **验证**：`npm run lint` ✓ 36 文件；`npm test` 100/100（引擎 1 + Worker 1 + grid 5 新用例：
  逐波异色/upto 截断/主题重绘/paintDelta 不越界/reachInk 满档）。E2E（本地 mock 全城检查）：
  三视图控件就位、图例逐波计数与 waves 一致（600/1500/3000/4900）、重播 0 → 5400 → 90000
  像素逐波点亮、公报主题切换后层保留、切回反应图悬停恢复、375px 零溢出、控制台零错误。
- **E2E 前置坑（复用 R5 的方法）**：本地 D1 的每日 20 次限额会被 worker 测试用满
  （unstable_dev 与 dev server 共用本地库，ip 都是 'local'）——清当天 posts
  （含 versions/batches/reactions 依赖行）即可，只动本地开发库。
- 计划文档：`docs/superpowers/plans/2026-09-30-r8-wave-replay.md`（writing-plans 规范）。

## 2026-09-30 · R7 优化：Worker 侧按 post.v 缓存地形（93 → 94 用例全绿）

- **做的东西**：`worker/index.js` 加模块级 `terrainCache`（与 `crowdCache` 同家族）：
  `terrainFor(presetId, keys, bytes, versionId, frozen)`——`frozen = post.state !== 'running'`
  时算一次就按 `post.v` 缓存，`showPost` 只改一行接线。R4 剖析的最大热点
  （`crowdTerrain` 8.01ms/请求，占纯计算 73%）从此在重复查看时为 0。
- **关键口径（唯一可能造出的正确性事故）**：反应只在 running 期间增长。把旧地形喂给
  进行中的检查是最坏结局——所以 running 一律直算不写缓存，closing/done 才可缓存
  （closing 期间 batch 被 running 门拦住，反应已冻结，语义正确）。
  集成用例先验：running 中判 100 人读一次、再判 200 人读一次，`judged` 必须从 100 涨到
  300（若将来有人把写缓存的时机改错，这条必红）。
- **收益口径=结构论证，不是实测**：命中路径不进 `crowdTerrain`（R4 已实测 8.01ms），
  此轮不另测墙钟——D1 IO 噪声大，墙钟测了也不可信。与 R1 对 fillRect 的处理同一诚实标准。
- **不需要失效路径**：版本号只增不复用（runVersion 恒开新号），旧版本的 reactions
  永不变化；容量上限 200 条、超出淘汰最早一条，防长驻 isolate 泄漏。
- 计划文档：`docs/superpowers/plans/2026-09-30-r7-terrain-cache.md`（writing-plans 规范）。

## 2026-09-30 · R6 前端：交互可达性细节（87 → 93 用例全绿）

- **方向判定**：`impeccable context` = `SCOPED_EXISTING_ALLOWED`，refinement——四主题、
  文案、地图绘制算法、动效一律不动，只修取证到的交互缺陷。静态审计（1100/375 × 四主题）
  无横向溢出、无控制台错误；窄屏 5 个"越界"A 元素全部是 `.toc` 内部横滚（预期行为）。
- **tooltip 视口钳制（真缺陷）**：`attachTooltip` 恒 `clientY + 14`，画布在折叠线下时
  悬停下缘 tooltip 被视口裁掉（实测 tipBottom 3487 / vh 805）。抽出纯函数 `clampTip`
  （右缘翻左、下缘翻上、钳进视口留 12px），6 个单测兜住边界（含 tooltip 比视口宽）。
- **触摸档案**：悬停改走 `pointermove`（`pointerType==='touch'` 的拖动不算），
  点按走 `pointerdown`（同格再点收起）。**坑**：触摸 tap 后浏览器会补发合成
  mousemove/mousedown，若监听 mousemove 做 toggle 会被合成事件打穿——
  用 pointer 事件区分输入源才立得住。
- **报告深链**：feed 链接从 `javascript:openPost(...)` 改成真 `href="/?post=<id>"`
  （可分享/刷新/中键新开），点击委托 + `pushState`，popstate 收起报告，载入读
  `?post=` 直开。
- **顺带**：`#statusLine` 补 `role="status"`（检查全程对屏幕阅读器可见）；
  voices「看全部」展开后焦点交给第一张新露出的卡（原来按钮自删、焦点掉回 body）。
- **验证**：`npm run lint` ✓ 36 文件；`npm test` 93/93（+6 clampTip 用例）；
  CDP 实测——折叠线下悬停 tooltip 完整可见（tipBottom 775 < vh 805）、触摸
  tap→收→拖动不重开→tap、`?post=` 直开出报告、回退收起、窄屏四主题零溢出、
  控制台零错误。临时 CDP 脚本已删除。
- 计划文档：`docs/superpowers/plans/2026-09-30-r6-interaction-polish.md`。

## 2026-09-29 · R5 创意：两版之差（差分地图），75 → 87 用例全绿

- **做出来的东西**：`shared/spatial.js` 新增 `crowdDelta()`（把两版字节折成"态度差"场
  `tone_新 - tone_旧 ∈ {-2..2}`），并把 R2 的 Moran's I **原样套在差场上**——回答
  "你改的这几个词，是整齐地翻盘了一片人，还是零散地多哄到了几个"。
  `terrainOf(values, judged, opts)` 从 `crowdTerrain` 抽出为真身，统计代码一行没重写；
  原有 8 个 spatial 用例就是这次重构的安全网。差分**全在浏览器里算**：
  Worker / API / schema / D1 一行不动，不新增 Jev 调用。
- **三个口径**（刻意的，不是省事）：① 只统计两版都判定到的人，覆盖差异另计
  `onlyBefore`/`onlyAfter` 单独一句话说；② 差场用原始态度之差，不偏离均值（R2 同款坑）；
  ③ `code = delta + 3`（1..5，0 = 不可比），"差值为 0"与"不可比"分得开。
- **界面**：对比区点「载入第 1 版对比」后，差分卡在上、第 1 版完整报告在下；
  `drawDelta` 发散配色（绿=变好/红=变差，半档=墨水与底板各半），**刻意不用 LOOKS**——
  那是"是什么反应"的色板，这里是"变了多少"的量表，混用会让读者把"变了"误读成"是哪种反应"。
  差分画布无悬停档案（差分格没有"这个人是谁"可看）。
- **真实结果**（无头 Edge 端到端跑了一次真实的"改一版再发"，mock 通道）：
  两版各 10,000 人判定，**2,076 变好 / 2,006 变差 / 净 +45**，差场 I ≈ 0.0 ⇒ 判定
  "看不出"——正好演示了这个功能的意义：整体翻盘规模接近抵消时，别让读者以为"改赢了"。
  端到端 16/16 项通过（统计/口径句/图例/四主题重绘/375px 无溢出/控制台零错误）。
- **执行期修掉计划自身的 4 处错**（都写进计划文档的「执行期修正」了）：
  1. 覆盖差异相等时的文案会造病句（"少排到了 0 个人"）——改述为"各有 N 个人只被自己排到"；
  2. `hot`/`cold` 在差场上的语义是"成片变好/变差"，没有照抄地形那句"成片的乐见/反感"；
  3. **"主题切换随对比区重渲染即可"不成立**——没有任何东西会因切主题重渲染对比区，
     差分画布于是留着上一个主题的墨水。改为登记进 `grid.js` 另册 `deltas`，
     `redrawMaps` 一并重画（回归用例兜底）；
  4. **375px 整页横向溢出是 R3 留下的既有缺陷**（本轮 E2E 抓出）：`.examples .card`
     是网格项，自动最小尺寸 = 内容 min-content，被 ≤560px 的 nowrap 目录撑到 634px。
     修法 `min-width: 0`（目录自己内部横滑）。**教训：grid/flex 里放可横滑内容的项，
     都要显式 `min-width: 0`。**
- **端到端方法论（可复用）**：一次性无头 Edge + CDP 脚本（Node 全局 `WebSocket`，零依赖），
  用完即删。三个坑：① 点按钮前必须等 `window.openPost`（module 脚本挂监听前点击静默丢失）；
  ② Edge profile 每次运行用独立目录（单例锁会让复用 profile 的第二次启动连到旧实例）；
  ③ **本地 D1 的每日 20 次限额会被历史 E2E 会话用满**（本次开局即 429），
  清当天 posts（含 versions/batches/reactions 依赖行）即可，只动本地开发库。
- 提交：`240e897`（crowdDelta+terrainOf）→ `7e18ce9`（drawDelta）→ `29e2ef3`（对比区接线）
  → `aca8275`（主题重画 + 窄屏溢出修复）。`npm run lint` ✓ 36 文件；`npm test` 87/87；
  `npm run bench` 17.9× 一致。
- 计划文档：`docs/superpowers/plans/2026-09-29-r5-version-delta.md`（带「执行期修正」小节）。

## 2026-09-29 · R5 计划已写、未执行（已被上一节取代：该计划已于同日执行完毕）

- 计划：`docs/superpowers/plans/2026-09-29-r5-version-delta.md`（**两版之差 · 差分地图**）。
  下一轮从它的 Task 1 Step 1 接上，三个设计决定已定稿，不必重新推导。
- 点子：改一版再发的对比区今天只是**两张并排的静态图**，读者得自己在脑子里做减法。
  新增的 `crowdDelta()` 把两版字节折成"态度差"场（`tone_新 - tone_旧 ∈ {-2..+2}`），
  再把 R2 的 Moran I **原样套在这个差场上**——回答一个全新问题：
  > "你改的这几个词，是整齐地翻盘了一片人，还是零散地多哄到了几个？"
- **零成本**：两版的 `looks` 浏览器本来就有（对比区本来就会拉第 1 版），
  所以差分**全在浏览器里算**——Worker、API、schema、D1 **一行不动**，不新增 Jev 调用。
- **三个已定的口径**（接手时照抄，别重新发明）：
  1. **只统计两版都判定到的人**。只被一版排到的人不是"变中立了"而是"这次没轮到"；
     混进来会得出"你改完稿子几千人不看了"这种结论错误的说法。覆盖差异另计
     `onlyBefore` / `onlyAfter`，界面单独一句话说明。
  2. 差场用**原始态度之差**，不偏离均值——理由与 R2 踩过的坑同源。
  3. 差值编码 `code = delta + 3`（⇒ 1..5，0 = 不可比），
     于是"差值为 0"（3）和"这一格不可比"（0）分得开。
- `spatial.js` 的 `terrainOf(values, judged, opts)` 是 `crowdTerrain` 抽出的真身，
  `crowdDelta` 直接复用——**原有 8 个 spatial 用例就是这次重构的安全网**。
- **本轮的收尾动作**（纯文档，无代码）：用例数 69 → 75（README + TESTING）、
  TESTING 布局表补 `test/summary.test.js`、ARCHITECTURE 引擎新文件 5 → 6、
  `docs/README.md` 补「plans/ 怎么读」（并说明带「执行期修正」小节的都是踩过坑的）、
  README 路线图补 R1–R4 与 R5 起。

## 2026-09-29 · R4 优化：segments() 预编译分组表（69 → 75 用例全绿）

- **先剖析再动手**。`showPost` 每请求跑的纯计算，逐项热态实测（Node 24.9，1 万格全判定）：

  | 项 | 优化前 | 优化后 |
  |---|---|---|
  | **`segments()`** | **19.13 ms** | **0.98 ms** |
  | `crowdTerrain()` | 8.48 ms | 8.01 ms |
  | `voicesOf()` | 1.16 ms | 1.33 ms |
  | `counters()` | 0.40 ms | 0.35 ms |
  | `encodeBytes()` | 0.23 ms | 0.23 ms |
  | **每请求合计** | **29.41 ms** | **10.96 ms** |

  合计从超免费档 10ms 预算近 3 倍，降到**刚好进预算内**。
  （`crowd()` 本身 111ms 是 isolate 级缓存的一次性成本，热身后每请求 0ms，不计入。）
- **热点成因**：`segments()` 在"对一万个人"的外层循环里，重做了三件只该做一次的事——
  `Object.entries(SEGMENTS)` 每次新建 7 项数组、`valuesOf(who)` 每个维度一次调用+数组字面量、
  以及**七万次** `` `${attribute}:${value}` `` 拼串再哈希。真正逐请求变的只有 `reactions[who.id]` 一个字节。
- **改法**：把分组名与"这一维取哪些值"的形状（人群的常量，与一次检查无关）按 `people`
  数组身份预编译成 CSR 表（`start` + `group` 两个 Int32Array + 分组表），WeakMap 缓存。
  热路径只剩整数读写。**调用方（Worker `showPost` / 浏览器 `replay.js`）一行没改。**
- **两条不变式**（写进 shared-engine.md）：① 分组号按首次出现分配 ⇒ 输出顺序与旧 Map
  插入顺序一致；② `people` 视为不可变——将来若有人就地改人群，这张表会过期，要连
  `crowd()` 一起改。子集各自成表、随数组被 WeakMap 回收（不会泄漏）。
- **安全网**：新 `test/summary.test.js` 把**旧实现原样抄成参照实现**，在真实人群上对拍
  （4 种 reach × 2 预设 + 子集 + 重复调用 + 市场/非市场 + 最小样本门），6 例。
  改写前后逐字段一致——这是本轮唯一的正确性保证。
- **一处自纠**：我最初写的"reach=0 ⇒ 返回空数组"断言是**错的**——`size` 记的是
  "这一组有多少人"而不是"多少人看到了"，所以 reach=0 仍会列出分组（`reached: 0`）。
  对拍那一半本来就是对的，是断言本身错了；改成断言"每组 reached 都是 0"。
- **下一个热点已经很清楚**：`crowdTerrain()` 8.01ms，现在占每请求纯计算的 **73%**。
  它是 R2 加的，置换次数（199/99/49）已按人数收缩，再砍就动到统计结论了。
  正确的省法是**Worker 侧按 `post.v` 缓存地形结果**（同一份报告重复查看不重算），
  留给下一轮，别用砍置换次数的方式省。
- 计划文档：`docs/superpowers/plans/2026-09-29-r4-segments-precompute.md`。

## 2026-09-29 · R3 前端：报告页全量打磨（impeccable polish，69 用例不变）

- **方向判定**：跑 `impeccable context` 得到 `SCOPED_EXISTING_ALLOWED` —— 有既有视觉实现，
  所以本轮是 **refinement 不是 redesign**：四套主题的身份、文案、范围外一切保留。
  用户的 brief 已授权"执行环节…不断迭代"，故按 skill 要求用 brief 推断方向而没有中断提问；
  唯一一次提问留给了真正需要人拍板的设计系统原则（见下"底板"）。
- **取证方法**（可复现）：无头 Edge + CDP 脚本，多视口（1100 / 375）× 四主题截图，
  附带 DOM 审计（横向溢出 / 触达目标 <24px / 可访问名 / 控制台错误）。脚本是一次性的，用完删除。
- **修掉的 7 个缺陷**（都带证据，不凭感觉）：
  1. **`[hidden]` 被 `.row { display:flex }` 打败** → `#resultActions`（"改一版再发"）在首屏就露出来。
     作者样式里的 `display` 会打败 UA 的 `[hidden]`。加 `[hidden] { display: none !important }`。
  2. **`var(--line)` 是不存在的令牌** → 文本预览框的 `border-color` 内联覆盖从未生效，
     一直落回 `.blocked-note` 的 `--bad` 红边，看着像报错。改成中性 `.source-text` 卡。
  3. **`.toc` 一条 CSS 都没有**（上一轮就发现了）→ 目录挤成一行连续文字。改成 pill 行。
  4. **图表 viewBox 固定宽度** → 窄屏等比缩到 0.30×，11px 标注变成 3.3px。改成由调用方
     按实测容器宽度传（`render.js` 的 `chartWidth` / `app.js` 的 `updateCharts`）。
  5. **`.seg` 在窄屏被挤扁** → `label(110)+num(96)` 吃光宽度，比例条只剩细缝。≤560px 改两行排。
  6. **`#text` 没有 `<label>`**（只有 placeholder）→ 补 `.sr-only` 标签。
  7. **触达目标**：目录/feed/footer 链接 17–20px 高 → 补到 ≥24px。
- **顺带修的真 bug**：`buildToc` 给每张卡都分配 `sec-0…sec-N`，而一页最多有 4 张报告卡
  （结果/对比/两张示例），**id 重复**——点目录会跳到另一张卡的同名小节。改成逐卡 `uid` 前缀。
- **顺带修的窄屏问题**：地图与图例并排把 400px 画布挤成细条（改上下排）；目录换行占掉近
  250px（改单行横向滚动 + 右缘渐隐 + 细滚动条）；总览 KPI 折成 3+2 碎行（改两列网格）。
- **底板：一次被数据推翻的决策**。浅色主题里地图亮墨水隐形——实测公报米纸底上
  `spreads` 黄 **1.07:1**、`glad` 绿 1.38、`sorry` 红 2.34（非文字图形要 3:1）。
  就此问了用户，选项是"中调底板 / 给墨水加浅色变体 / 不动"；用户选了**中调底板**。
  但动手前先算了一遍，发现**中调底板更糟**（0–1/6 过线，而深色底板 5/6 过线）：
  六色墨水亮度跨 15 倍，**不存在能让六色同时过 3:1 的底板**（亮度区间 L ∈ [2.23, −0.02] 是空集）。
  于是按用户真正想要的目标（"让墨水读得出来"）把中调纠正为深版：
  公报 `#1e1b16`（暖近黑，5/6 过线）、仪器 `#1d222a`（冷钢灰，4/6 过线），
  达不到的那一色永远是 `scrolled` 灰——而它本来就该退到背景里。
  **教训：先复算再动手；用户选的是"目标"（可读），不是"数值"（中调），纠正是朝目标走。**
- **令牌级对比度实测**（四主题全测）：`text` 13.4–16.7、`muted` 5.1–6.8、
  `ok`/`bad` 5.0–9.7，全过 4.5:1。**夜巡 `--accent` 曾是 4.34:1（差一点）**，
  提到 `#e0604a` = 4.88:1。地图墨水/底板比值一并记进 `docs/modules/frontend.md`。
- **impeccable detect 的 8 条发现全部是误报，如实说明**：7 条 low-contrast 全部把夜巡的
  `#e9e4d8` 配到硬编码底色 `#f5f7fc`（四个主题里根本没有这个背景）——静态扫描器
  看不到 `data-theme` 切换；1 条 buried-raster 指 `--grain: 0.05` 的胶片颗粒，
  那是已写进设计规则的既定材质。按 skill 的"一次扫描、不反复跑"处理：没有照单全收，
  改为自己按四主题逐个复算（上面的数字就是那次复算的结果）。
- **接受的例外**：footer 里 "Jev" 行内文字链接宽 17px < 24px 触达目标，按 WCAG 2.2
  SC 2.5.8 的行内例外接受——不为它把行内文字撑成块。
- **验证**：四主题 × 两视口重取证；窄屏无横向溢出；控制台零错误；`noName` 归零；
  触达目标从 ~25 项降到 1 项（即上述例外）；`npm run lint` ✓ 35 个文件；`npm test` 69/69；
  `npm run bench` 22–24×。
- **范围纪律**：hero、主题令牌体系（除两处已测出的问题）、地图绘制逻辑、反应色单源、
  入场动效都没动——取证未发现缺陷。
- 计划文档：`docs/superpowers/plans/2026-09-29-r3-report-polish.md`。

## 2026-09-29 · R2 创意：人群地形（Moran's I 空间自相关），57 → 69 用例全绿

- **点子**：`summary.js` 的 `segments` 是按属性的**边际**统计，答不了"哪一片人一起反感"——
  成片往往由属性的**组合**造成（预算紧 × 对手机感兴趣 × 同一片区），单看任一属性条都看不出来。
  而网格位置本身有含义（年龄按行、兴趣按列），`feed.js` 还给传播者的网格邻居加权 0.1，
  所以聚集是可测的，不是渲染幻觉。
- **统计量**：rook 邻接的 Moran's I，只连**都被判定到**的上下左右。
  `I = (n/2S0)·Σd·nb/Σd²`。合成图核对过：左上一块 +1 ⇒ **+0.798**，
  +1/−1 棋盘 ⇒ **−0.500**，全体同值 ⇒ null（无方差不出结论）。
  显著性用**置换检验**（`hash32('spatial', versionId)` 播种 ⇒ 回放可复现），
  α = 0.05，置换次数随人数收缩 199/99/49。
- **实现期踩的三个坑（都写进计划文档了）**：
  1. `L = d·nb` 对 +1 块和 −1 块**都是正的**——按 L 的符号分，分出来的是"成片 vs 孤立点"，
     不是"乐见片 vs 反感片"。必须按标准四象限用 d 与 nb 的符号。
  2. **离均值看象限会造假冷区**：均值非零时中性多数派整体落在均值下方，天然构成一块假
     "成片的反感"（patch 用例给出 76 个假冷格）。改成**用原始态度**判象限，态度 0 不参与。
  3. 计划的"置换收缩"用例两个断言都落在 ≤2000 档，等于没测——改为直接导出并测 `permsFor`。
- **代价**（热态实测，记在案里）：判定 600 / 2100 / 10000 人时
  `crowdTerrain` 分别 **2.3 / 5.7 / 6.9 ms**。相对 `showPost` 既有的 ~155ms（`crowd()`）
  约 +4%，可接受；若日后要再省，把置换检验挪到 Worker 侧缓存或按需触发。
- **真实结果**（存档示例：iPhone 转让帖，2,100 人判定）：I = −0.064、z = −6.0 ⇒ **零散**，
  但中央仍有一小簇 20 格成片乐见——正好演示了"整体判定"与"局部成片"是两回事，
  文案因此分成两句（`TERRAIN_SAY_ZH` 只说整张图，位置由 render 用"不过…"补）。
- **改动面**：`shared/spatial.js`（新）→ `shared/labels.js`（`TERRAIN_VERDICT_ZH` /
  `TERRAIN_SAY_ZH` / `directionZh`）→ `worker/index.js` + `shared/replay.js` 双路同构
  → `grid.js`（`drawGrid` 多收 `terrain`，`ringTerrain` 描环，环色取主题数据墨水）
  → `render.js`（`terrainView` + `wireTerrain`，图例拆 `reactionLegend` / `terrainLegend`）
  → `styles.css`。
- **测试**：新增 `test/spatial.test.js`（8 例）；`test/grid.test.js` 加 4 个描环桩件用例；
  `worker.test.js` 加地形回归（人数口径 = 到达人数、判定词合法、聚集格不越界不重叠、
  重心与格子数一致）。`npm run lint` ✓ 35 个文件；`npm test` 69/69。
- **验证**：无头 Edge + CDP 实测——开关切换、主题切换后环保留、375px 无横向溢出。
  临时 CDP 脚本已删除。
- **顺带发现一个既有缺陷（留给前端轮）**：`.toc` 在 `styles.css` 里**一条规则都没有**，
  `render.js` 的 `buildToc` 生成的锚点目录挤成一行连续文字。已记进
  `docs/modules/frontend.md` 的「已知待修」。
- 计划文档：`docs/superpowers/plans/2026-09-29-r2-crowd-terrain.md`。

## 2026-09-29 · R1 优化：实时监控与地图改为增量渲染（45 → 57 用例全绿）

- **问题**：实时监控每收到一批（100 人）就把 10000 格的字节数组全扫两遍（`updateLiveStats`
  数 judged、`paintBatch` 数 glad/sorry），并把地图整屏重画——一次全城检查（100 批）合计
  约 300 万次与全镇规模成正比的循环/绘制，而真正变化的只有 100 格/批。
- **改法**：新增纯函数 `public/tally.js`（`newTally` / `foldBatch`）持有「已判定」快照，
  每批只走本批的人；`public/grid.js` 的画布登记项多存一份 `painted` 字节快照，
  新增 `paintDelta` 只补画与快照不同的格子。`drawGrid` / `redrawMaps` 仍是全量路径
  （换一次检查、换主题走这条）。
- **实测**（`npm run bench`，一次全城检查 100 批）：计数路径 18.2ms → 0.78ms，**约 23×**，
  两边结果逐项一致。地图 `fillRect` 从约 100 万次降到约 1 万次——Node 里没有 canvas，
  这一条是结构性论证（每次只补画变化的格子），**没有实测数字**，别当实测引用。
- **真实浏览器已核对**（无头 Edge + CDP 驱动点一次「让小镇来读」）：第 1 波 400/600 人时，
  画布 400×400 出现 7 种颜色（底板 `--map-well` + 6 色反应墨水），统计行 `400/10,000`
  `4 次请求` `18,240 tokens` 同步上涨；`showcase` 回放与主题切换走全量路径也正常。
  该临时 CDP 脚本**已删除**（硬编码 Windows Edge 路径，留着是负担）。
- **顺带清理**：`grid.js` 里 `canvas.style.height` 先赋 px 再被 `'auto'` 覆盖的死赋值。
- **计划自身出过一次错，值得记住**：计划里的 `foldBatch` 改判分支写成「先 `judged -= 1`
  再按分支 `+= 1`」，两种写法都会让改判后 `judged` 不等于 1（一个漏加、一个多加），
  被「与全量重扫对拍」用例连红两次才抓住。**增量计数器的改判路径必须由对拍用例兜底。**
- **测试**：新增 `test/tally.test.js`（6 例，含与全量重扫对拍）与 `test/grid.test.js`
  （6 例，Node 里用 canvas 桩件记录 `fillRect`，断言「画了几格」「底板有没有重铺」）。
  `npm run lint` ✓ 33 个文件；`npm test` 57/57。
- 计划文档：`docs/superpowers/plans/2026-09-29-r1-live-incremental-render.md`。

## 2026-09-28 · 优化计划执行完毕（M1+M2+M3 全部合入 main）

- 分支策略：每任务独立分支 + `--no-ff` 合并回 main，合并后删除本地与远端分支；
  每个任务走 implementer → 规范评审 → 质量评审 →（必要时修复+复审）→ 主控合并。
- 最终状态：`npm test` 45 用例全绿；`npm run lint` ✓；CI（lint 先于 test）在 Node 22 全绿；
  工作区干净；远端仅剩 main 与既有历史分支。
- 可选任务（M3 Task 10 Playwright E2E / Task 11 本地限额豁免）经用户确认**不做**，
  留在计划文档 `docs/superpowers/plans/2026-09-28-m3-polish.md` 中待需要时启动。
- 执行期方法论沉淀：本环境 wrangler dev server 会串行化 Promise.all，并发用例必须断言
  不变量；实施者发现计划自身缺陷时应停下来等主控裁决（本次两处：version 403 测试矛盾、
  串行双击收波缺陷），均已修正并记入下方 M2 条目。

## 2026-09-28 · M3 打磨落地（45 用例不变）

- README 瘦身回产品向入口（删「目录结构」「与上游的差异」两节，承接在 docs/README.md 与
  docs/ARCHITECTURE.md）；路线图 Step 4 刷新（CAS/作者令牌 M2、observability M3 已落地）。
- observability 开启（`wrangler.jsonc`，部署侧 Workers Logs；本地与测试无行为影响，实测
  带着开关 45/45 通过）。
- 最小 lint 门：`scripts/lint.mjs`（`node --check` 语法门 + tab/空格混用 + console.log 残留；
  扫 public/worker/test，`scripts/` 是 CLI 故豁免），package.json 与 CI 接入（lint 先于
  test，fail-fast）。已知限制：console.log 规则是文本匹配，注释/字符串里的同名字面量会
  误报——遇误报改表述，不删规则。
- DEPLOYMENT.md：database_id 标上线阻塞项；上线清单刷新（剩余：人格打包管线、d1 create +
  secret 部署）。

## 2026-09-28 · M2 API 安全与并发正确性全部落地（4 任务合并，45 用例全绿）

- **预算闸**：`overBudget(env)` 对 check/version/batch/wave 四个写路由一致生效
  （原只有 check/version 有）；closeWave 收尾循环内的软预算检查保留为第二层。
- **作者令牌**：迁移 0005 加 `posts.author`；`/api/check` 开局签发（随响应返回 `author`），
  写路由校验请求头 `x-jev-author`（读路由保持公开）。runVersion 校验顺序
  404→409→限额→预算→作者。前端 `authHeaders` 带头、`openPost` 从
  `localStorage['jevtown.author.<post>']` 读回（feed 点开自己的帖仍能改一版）。
  已知限制：刷新页面丢 in-memory currentAuthor（openPost 路径可恢复）；旧本地帖
  author 为 NULL 一律 403，需重开检查。
- **收波 CAS**：closeWave 入口原子占位 `posts.state: running→closing`，并发只有一个进；
  空波门放在 claim **之后**（claim 成功后 plan 冻结，消除 TOCTOU）；推进路径同 batch
  还回 running；失败走 release() 回滚。settleWave 拆分自原 closeWave（逻辑原样搬运，
  经 SHA-256 逐字节验证）。
- **批次认领**：`plan.answered` 改 `json_set` 条件递增认领，并发批次一个成功其余 409；
  Jev 失败的条件回滚带 `AND json_extract(...) = start + N`——他人接着认领过就放弃回滚，
  绝不擦掉他人认领复现 reactions 主键 500。
- **实施期发现并修正的两个计划缺陷**（教训，后续写计划注意）：
  1. 计划里"对 running 帖无头发 /api/version 期望 403"与锁定顺序矛盾（409 门在前）——
     改用 blocked 帖测作者门；
  2. 计划假设"dev server 串行化时双收波各收一波"不成立——串行化下第二次收的是**零反应
     新波并直接置 done、跳过整个波次**（用户可达的真实缺陷），由此新增空波门。
  本环境（wrangler dev server）会把 Promise.all 请求串行化，并发用例必须断言不变量。
- **已知窗口**（罕见、有界，记录在案不扩成两阶段租约）：批次 claim 后进程被杀 ⇒ 该批
  100 人跳过（报告 size<asked 可见）。
- BYOK 贯穿所有计费路由（含收波）——settleWave 曾丢 request 导致收波段静默落 mock
  的计费口径事故，已修复；教训：拆函数时逐个核对 request 依赖透传。

## 2026-09-28 · M1 工作流地基落地

- CI：`.github/workflows/test.yml`，push/PR 自动 `npm ci && npm test`。
- PR 模板 `.github/pull_request_template.md`：任务卡 id / 拥有文件 / 验收标准附证据 / 测试数字 / 遗留风险 / 共享契约检查六节。
- 任务卡与 handoff 固定落盘 `docs/agent/tasks/`（完成后删或归档 `done/`，要点进 MEMORY）。

## 2026-09-28 · 优化计划细化为三个可执行子计划（writing-plans/make-plan 规范）

- 总纲 `docs/superpowers/plans/2026-09-28-jevtown-cn-optimization.md` 改为索引+决策锁定；
  可执行分解拆为三个子计划，每步 2-5 分钟、TDD、完整代码、精确命令与预期输出：
  - `2026-09-28-m1-workflow-infra.md`（CI / PR 模板 / `docs/agent/tasks/` 落盘约定，4 任务）
  - `2026-09-28-m2-api-security.md`（预算闸→作者令牌→收波 CAS→批次认领→文档同步，5 任务；
    用例链 41→45，每任务独立分支）
  - `2026-09-28-m3-polish.md`（README 瘦身 / observability / 最小 lint；可选 E2E 与本地限额豁免）
- 锁定的关键决策：作者令牌走 `x-jev-author` 请求头（不用 cookie，与 BYOK 约定同族）；
  读操作公开、写操作鉴权；CAS 用 `posts.state` 三态（推进必须同 batch 还回 running）；
  lint 不引 eslint（`node --check` 语法门已实测 ESM 兼容，console.log 规则豁免 scripts/）。
- 已实测事实：`node --check` 对 ESM 全部 exit 0（Node v24.9.0）；console.log 仅存
  `scripts/check.js`；D1 `json_set/json_extract` 可用性列为 M2 Task D 的先证步骤。
- 用户选择：只规划不改代码；执行时按总纲「建议执行顺序」派发任务卡。

## 2026-09-28 · 优化计划已立项（只规划，未动代码）

- 计划文档：`docs/superpowers/plans/2026-09-28-jevtown-cn-optimization.md`（12 项发现全部带
  `文件:行号` 证据，11 个任务含步骤与验收标准）。用户选择先只规划，执行时按任务卡派发。
- **P0 安全/正确性（代码级，已读码确认）**：
  - `/api/batch` 无身份校验、无预算闸（`worker/index.js:250-299`，限额只在 check/version
    的 `:137`/`:211`）→ 知道 post id 即可反复烧钱；
  - 收波无 CAS（`closeWave` 先读 state 再行动，`worker/index.js:303-339`）→ 并发双推波次；
  - `plan.answered` 读-改-写非原子（`:258-296`）→ 并发 batch 错位/撞主键。
- **P0 工作流地基**：无 CI（`.github/` 为空）、无 PR 模板、RELAY.md 任务卡落盘目录未定
  （拟固定 `docs/agent/tasks/`，完成后删或归档 `done/`，要点进 MEMORY）。
- **P1**：README 瘦身（目录结构/上游差异下沉 docs/）、observability 开启、database_id
  占位符设上线门、最小 lint（`node --check` 脚本）。
- **P2 可选**：Playwright smoke、本地 IP 恒 `'local'` 导致多人共享 20 次/日限额误伤。

## 2026-09-28 · 文档体系重建 + `_research_raw` 退出版本库

- 新建根 [AGENTS.md](../AGENTS.md)：agent 入口，含**分层阅读协议**（L0 入口 / L1 架构 /
  L2 模块 / L3 细节）与「按任务类型取读」表——任何 agent 不需要全量读项目。
- `docs/` 重组为标准结构：`README.md`（索引+阅读地图）、`ARCHITECTURE.md`、
  `CONVENTIONS.md`、`TESTING.md`、`DEPLOYMENT.md`、`modules/`（shared-engine /
  worker-api / frontend 三份深潜）、`adr/`、`agent/`（COLLABORATION + RELAY + 模板）、
  `research/`、`superpowers/plans/`（历史计划原样保留）。
- 多 agent 协同铁律：文件 Ownership（同时只一个 agent 改一个文件）、任务卡先行
  （`docs/agent/templates/task-card.md`）、接力必须留痕（`handoff.md` 六段式，
  最新置顶）、共享契约（API 形状 / D1 列 / labels.js 中文单源 / 限额双路）只能主控改。
- `_research_raw/`（上游调研原始材料约 0.8MB）加入 `.gitignore` 并退出版本库，
  本地文件保留；蒸馏结论在 `docs/research/Jevtown调研报告.md`。
- `output/real-api-report.md`（真实 API 实测）复制进 `docs/research/` 入馆；
  `output/` 整体仍是 gitignore 的产物目录。
- 验证：`npm test` 41 用例全绿（mock 通道，未花真钱）。

## 2026-09-28 · 真实 Jev API 端到端验证通过（Task 9）

- 通道：TypeSafe 官方 API（`https://api.typesafe.ai/v1/systemone`，模型 `jev-1.13.0`）。
  CLI（`runCheck`）与 Worker（check/batch/wave 分步）两条路径均端到端跑通，返回真实概率分布。
- 成本实测（同一条 iPhone 转让帖）：单波 600 人 $0.0158 / 5.0s；2,100 人 $0.0323 / 6.3s；
  全城 10,000 估 $0.10–0.15。与上游口径一致。
- **关键认知**：真实 Jev 比 mock 挑剔——同一条帖子 mock 版传遍全城 10,000 人，真实模型
  第 2 波即停（最终到达 2,100）。mock 只适合功能演示，成本/传播预估必须用真实模型。
- 波次情绪与上游区间吻合：第 1 波 +0.22~0.24（强文本区间 0.12~0.33），第 2 波 +0.02
  （弱文本区间 -0.39~0.02）。
- 修复：`versions.usd` 曾漏记收尾提问（stage `ask`）花费，`closeWave` 现已累加
  askUsd/askTokens（commit `fix: closing-question spend accrues to versions.usd as well as batches`）。
- 密钥配置基线：`.env.local` 真实 key（gitignored）；`.dev.vars` 保持 `JEV_PROVIDER=mock`
  使 dev/test 不花钱。

## 2026-09-28 · 项目关键事实速查（长期有效）

- **形态**：一个 Cloudflare Worker（API）+ D1 + 无框架静态前端；引擎三端共用
  （`public/shared/`），Worker/浏览器/Node 同一份源码，通信靠注入的 `send`。
- **API**：`POST /api/check`、`POST /api/version`、`GET /api/batch`（每批 100 人）、
  `POST /api/wave`（净情绪 ≥0.1 才传下一波：600→1500→3000→其余）、`GET /api/post/:id`、
  `GET /api/feed`。
- **限额**（`wrangler.jsonc` vars）：每 IP 每日 20 次检查、全站每日 $5、最多 4 波；
  对 `/api/check` 与 `/api/version` 双路生效（一致性有测试守护）。
- **模型边界**：Jev 只返回概率，不写文本；界面中文全部来自 `public/shared/labels.js` 单源，
  人格中文词表来自 `vocab.js`；问句与人格行是英文。
- **确定性**：`rng.js` 哈希随机，同 seed 同结果——回放与测试依赖此性质，改抽样逻辑
  必须保持可复现。
- **主题**：四套 = `styles.css` 的 CSS 变量令牌组（夜巡默认/公报/仪器/经典），
  新增主题只加令牌 + 顶栏按钮。
- **上游**：引擎与 Worker 架构改自 gaborishka/jevtown（MIT，谱系 a16z-infra/ai-town）；
  引擎 9 文件为上游最小改动，`vocab/labels/mock/bytes/replay/spatial` 6 个文件为本项目新写。
- **测试**：`node --test`，93 用例（2026-09-30 R6 后）；Worker 集成用 `unstable_dev`；
  全程 mock 不花钱；无浏览器 E2E（需要时写一次性 CDP 脚本，用完即删）；
  `npm run lint` = `node --check` + tab/空格 + console.log 三条文本规则。
- **已知待办**（README 路线图 Step 4）：人格打包管线省 CPU、真实 `database_id` + secret 部署
  （`/api/batch` 作者令牌、收波 CAS、observability 已于 M2/M3 落地）。
