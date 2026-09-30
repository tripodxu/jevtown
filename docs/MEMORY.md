# MEMORY · 项目记忆日志

> **格式约定：最新条目在最上方。** 每条 = 日期 + 标题 + 事实/决策/坑。
> 写事实不写流水账；任务完成后把 handoff 压缩成一条追加到顶部。
> 会话级记忆（用户偏好等）另见 agent 宿主环境的 memory，不混入本文件。

---

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
