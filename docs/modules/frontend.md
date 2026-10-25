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
| `charts.js` | 漏斗 / 折线 / 堆叠 / 需求曲线 / 报告条形图 / 切片热力图（canvas→SVG 混合：折线面积用 SVG，漏斗条形用 DOM） |
| `grid.js` | 100×100 响应式地图（canvas，悬停档案）：`drawGrid` 全量重画、`paintDelta` 按字节快照增量补画、`drawReach` 传播层 |
| `tally.js` | 实时监控的「已判定」快照：每批增量折叠出 judged/glad/sorry（纯函数，Node 可单测） |
| `avatar.js` | 人格头像：hash32 驱动的 5×5 镜像 identicon，颜色只取主题令牌（R17，纯函数） |
| `sharecard.js` | 分享卡片：报告读数 + 地图快照合成 1200×630 PNG，命令式 canvas（R20） |
| `theme.js` | 主题切换（localStorage 持久化） |
| `showcase.js` | 首页示例回放（读 `public/examples/*.json`，经 `shared/replay.js`）；IntersectionObserver 懒渲染，滚到附近才建卡（R22） |

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

## 视觉打磨（R38）

- **设计方向「普查图纸 × 夜间航拍」**：页面留白铺 28px 间距的点阵（1px 点，文字色 6.5%
  透明度，`background-size` 分层叠加在两层氛围光之上）——留白处变成一张淡淡的坐标纸，
  呼应 100×100 的小镇网格。图纸语言向报告页深处的延伸：
  - `canvas.grid` 装**裱式画框**：box-shadow 两圈（5px 卡面衬边 + 1px 发丝线）叠在
    `var(--shadow)` 上，地图像标本册里压裱的一块墨版；差分地图同款（共用 .grid）。
  - `.legend` 是**坐标纸小图版**：点阵底（14px 间距、5%）+ 发丝框 + card-2 底。
  - `.decision` 是**标本卡**：更淡的点阵（16px 间距、4%）铺在 card-2 上。
  - 首屏三个新增件：
  - `.driver` kicker 前一段 24px 强调色引线（560px 以下收起——flex 引线会把窄屏的一行字
    挤成三行怪断，实测过）；
  - `.census` 规模数字条（dt 灰小字 / dd 等宽数字，顶上发丝线）：静态产品事实，来自引擎
    常量，不随版本漂；窄屏自然折行；
  - `.town-mark` 迷你小镇（≥1000px）：10×10 点阵 + 一格亮着强调色的「窗」，整个产品的
    隐喻缩成一枚印；absolute 定位在 `.hero` 右侧留白区（曾压到标题右缘，下移避开），
    mask 径向渐隐，窄屏 display:none。
- **字体栈**：夜巡/公报的 `--font-display` 补 "Source Han Serif SC" / "Noto Serif CJK SC"
  （Linux 宋体），Windows 仍落 SimSun、macOS 落 Songti SC。
- **吸附顶栏**：宽屏（≥721px）`.top` sticky + `backdrop-filter: blur`，半透明底让背景 glow
  透上来；窄屏不吸附（两行高吃纵 space）。配套 `html { scroll-padding-top: 72px }`——
  toc 锚点跳转不被顶栏盖住；`scroll-behavior: smooth` 只在 no-preference 媒体里。
- **层次**：`.plate` 卡面带一层 `linear-gradient(var(--card-2), var(--card) 130px)` 的纵向
  渐变（上缘略沉）；`h3::before` 一枚 7px 强调色小方块给长报告视觉节拍；徽章/chip 补
  `--card-2` 底色；印章 `.seal` 渐变 + 强调色软光。
- **CTA**：`#go`/`.primary` 加大（12×26、15px），脚下垫 `box-shadow: 0 6px 22px var(--accent-soft)`
  ——把印章的色彩关系带进按钮；进度条 `.bar-fill` 同理带一圈软光，跑起来自己会亮。
- **feed 行**：整行 flex（摘要左、读数右、放不下折行），hover 出 `--card-2` 面 + 链接转
  强调色；替代原「链接自己画下划线」的弱样式。
- 动效只做入场（dialog 轻）落/既有 rise），`prefers-reduced-motion` 全局压到 0.01ms 的
  既有规则兜底；所有颜色均来自令牌（`color-mix` 混合），四主题自动跟随、零硬编码色。

## 主题系统

- 主题 = `styles.css` 里一组 CSS 变量；现有四套：**夜巡**（默认）/ **公报** / **仪器** / **经典**。
- 新增主题 = 加一组令牌 + `theme.js` 顶栏加一个按钮，组件代码零改动。
- 主题切换后地图与图表需重绘（`theme.js` 已处理，监听变更即可）。

## 检查进行中的实时态

- 地图随每批判定 progressively 点亮；监控表滚动追加（时刻/阶段/进度/耗时/tokens/累计花费）。
- 实时地图走 `paintDelta` 增量补画，统计走 `tally.js` 增量折叠——**每批不要全量重扫一万格**。
  要全量重画（换一次检查、换主题）才调 `drawGrid` / `redrawMaps`。

## 报告里的「传播层」（R8 起）

- 地图是**三视图**分段控件（反应图 / 传播 / 聚集地形），`render.js` 的 `wireMapModes`
  统一管理：切换 = 重画 + 换图例 + 换提示语；数据不在就摘按钮（旧存档无 `waveOf`
  → 传播按钮缺席；无成片格子 → 地形按钮缺席）。
- 传播层数据 = `result.reach`（逐人"第几波看到"，0 = 没看到），`grid.js` 的
  `drawReach(canvas, waveBytes, upto)` 绘制，`upto` 供重播逐档点亮（每档 650ms，
  reduced-motion 直接铺满；重播先清旧定时器，连点不叠）。
- **颜色是单色渐满的顺序量表**（`reachInk`：`--map-blue` 对底板 mixHex，t = 0.58/0.72/0.86/1），
  刻意不用 LOOKS——那是"做了什么反应"的类别色，这里是"多晚看到"的顺序色。
  t 下限 0.58 是复算出来的：四主题深底板全部 ≥3:1（0.55 只有 2.99），别调回去。
- 传播层**关悬停档案**（格子的语义是波次不是反应，档案里没有"第几波"可说）：
  `attachTooltip` 认 `canvas.dataset.tipOff === '1'`；`paintDelta` 碰传播层画布直接不动。

## 人格头像（R17 起）

- `avatar.js` 的 `avatarSvg(pool, id, { size })`：hash32(pool, id) 作 LCG 种子走出位流，
  左 3 列生成、右 2 列**镜像**（对称才像脸）；格子 = `--accent` 浓淡（opacity 0.35–0.89），
  底 = `--card-2`，**没有任何硬编码色**，四主题自动跟随。确定性：同一 id 永远同一张脸。
- 消费方：人格声音卡（flex 布局 + .v-body）与地图悬停档案（tooltip 首行，inline）。
- `pool` 随 `base.post.pool` 下发（R17 的加法契约变更：Worker showPost 与 replay.js 都带）。

## 报告顶部的小镇快报（R23 起）

- 数据 = `summary.js` 的 `reportBrief(counters, waves, segments)`：只做选择与百分比
  （best/worst 取 topSegments 名单首位，无显著群体为 null），**措辞在 render.js 的
  briefView**——句式全部是名词短语 + 括号注记（`最买账：编织手工（兴趣 · 11% · 4.3×全城）`），
  分支只有"单波/多波"两套模板，防病句（R5 教训）。
- 每句的数字都来自 payload 既有字段，与总览 KPI 同口径；Jev 不写一个字。

## 报告里的「每一波的人都是什么反应」（R14 起 · 每波构成）

- 数据 = `summary.js` 的 `waveMix()`：`looks`（每人什么反应）× `reach`（每人第几波看到）
  交叉计数，只数到达过的人；**各波共用全城次数降序的反应序**，跨波才可比。
- 渲染 = `charts.js` 的 `waveMixChart()`：一根堆叠条 = 一波，段色用 **LOOKS 类别色**
  （语义正确——它就是"什么反应"；与传播层的单色渐满量表刻意区分）。精确计数进
  `title` 悬停；窄屏由 .seg 家族既有规则兜底。
- 旧存档无 `reach` → 段落优雅缺席（与传播层同规则）。

## 报告里的「谁在哪儿扎堆」（R11 起 · 切片热力图）

- 数据 = `summary.js` 的 `sliceHeatmap()`：把反应场按**主兴趣**（`interests[0]`）聚合到
  人格网格固有的 40 个兴趣街区（5 个年龄段 × 8 列，vocab.js 的 INTERESTS 布局），
  每格给乐见占比；判定不足 `MIN_SLICE`（25）人的格子 share 为 null（不下结论）。
- 渲染 = `charts.js` 的 `sliceChart()`：占比是**顺序量表**，fill 用
  `color-mix(var(--map-green) N%, var(--map-well))`——CSS 变量进 SVG，**四主题自动跟随、
  无需重绘**（与地图 canvas 不同，别给它加 redrawMaps 登记）。一页多卡时渐变 defs 的 id
  必须逐图唯一（`sliceSeq`）。窄屏格子 < 56px 时格下文字隐藏，细节交给 `<title>` 悬停。
- `render.js` 的 `townOf()` 是 `crowd()`（~155ms）的浏览器侧备忘；Worker 侧本就有
  `crowdOf` 缓存，两处别混。

## 报告里的「人群地形」

- 判定与成片格子来自 `shared/spatial.js`，中文全部走 `labels.js` 的
  `TERRAIN_VERDICT_ZH` / `TERRAIN_SAY_ZH` / `directionZh`。
- 地图上方「看聚集地形」开关：`wireTerrain` 给 `drawGrid` 多传一个 `terrain`，
  `grid.js` 的 `ringTerrain` 给成片格子描环（绿=乐见、红=反感，取主题数据墨水）。
  图例随之在 `reactionLegend` / `terrainLegend` 之间切换。
- 整张地图的判定（成片/零散）与局部成片是两回事，文案上要分开说，别让"零散"那句
  否认同一张卡片里报出来的局部小簇。

## 两版对比区（改一版再发之后）

- **对比对象可选**：只有两版时按钮就是「对比第 1 版」；三版起给「对比第 1 版 / 对比第
  上一版」两个按钮——改到第三版的人通常想看这版相对上一版改了什么，不是相对初版。
  `finishCheck` 的自动对比（作者自己跑完版本 ≥2）选**上一版**；深链/他人打开只出按钮
  不自动装载（那是读动作，多拉一版报告是翻倍负载）。第 1 版必须渲染进**子节点**——
  `renderCheck` 会清空整个容器，直接渲染进 `#compare` 会把差分卡和按钮一起清掉。
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

## 改版模式与「发一条新帖」

- 做完一次检查后 `current.post` 挂着，下一次提交**默认是同一帖的新版本**（两版可对比）——
  表单下方 `#nextPostRow` 把这件事说穿（引用上一条摘要，文案在 `COMPOSE_ZH`），
  并给「发一条新帖」出口：清 `current.post`/令牌/文本/受众挑组，回到全新一帖。
- **提交守卫**：只有本机持有该帖作者令牌才走 `/api/version`；看过别人的帖子后
  `current.post` 也挂着，那种时候提交走 `/api/check` 发新帖（走 version 只会 403）。

## 续跑（running 的检查刷新后不废）

- 检查由浏览器分步驱动（batch/wave），刷新或离开**不会回滚服务端进度**，但没人驱动就永远
  停在 running。`openPost` 打开 running 帖且 localStorage 里有该帖作者令牌时显示
  `#resume` 横幅；没有令牌（别人的进行中检查）不显示——驱动不了，也不该驱动。
- 续跑走与新检查同一条 `driveCheck`——**post/version/author 全部显式传入**：驱动循环绝不
  读 current.*，检查中导航（openPost 改写全局）不会再劫持批次或换错令牌（曾两层实测踩坑）。
  种子 = 报告的 `looks` 字节合成的 drawn 列表（`foldBatch` 幂等），地图从当前进度亮起。
- 失败时横幅回来可再试；跑完走 `finishCheck`（含版本 ≥2 的自动对比）。
- **进行中报告 15s 自动刷新**（任何人可见）：地图随服务端进度点亮，done 自动换完整报告；
  hidden 跳过该轮；提交/续跑/导航/回首页先 `stopRunningPoll()`。内嵌后台窗格会节流
  interval——属 E2E 环境限制，生产前台标签不受影响。

## 等待体验

- 状态行带**本波 ETA**（`etaSay`）：最近 6 批墙钟吞吐估剩余，<5s 或未测出不说，5 秒一档
  取整；只估本波——下一波与追问的时长是未知数，总 ETA 是编数字。
- `showLive` 滚动到实时区；`pace` 第 1 波 180ms、之后 90ms。

## feed 的读数摘要

- `listFeed` 带回 `reading: { reach, glad, sorry }`（D1 里聚好），前端用 `labels.js` 的
  `FEED_ZH.reading` 拼成「N 人读到 · 乐见 x% · 反感 y%」——feed 不再是光秃秃的摘要行。
  口径与报告 `counters` 一致（worker 集成测试钉住）。

## 已知待修

- 暂无。上一轮记的「`.toc` 完全没有样式」已在 2026-09-29 的前端打磨轮修掉
  （目录改成 pill，窄屏单行横向滚动）。

- 三张动态图：吞吐心电图、模型耗时曲线、态度占比堆叠图。
- 波次收束单独成行；完成后自动切完整报告。

## 传播门槛与全城广播

- **门槛**（feed.js 的 `GLAD_ENOUGH` = +0.10）：一波净情绪（乐见 − 反感占比）过线才传下一波，
  初稿常止步第 1 波——这是产品要报的真答案，但页面必须把「为什么结束」说穿：
  收波响应的 `endedBy`（gate / capacity）驱动两套话术；报告波次段的门槛提示（`WAVE_ZH`）
  只说给门槛模式听，广播模式说了就像矛盾。
- **全城广播**（`plan.broadcast`，发帖框勾选）：不拿情绪当闸、四波跑满——「传不传得开」
  和「全镇怎么读」分开问。报告 h2 带徽标、brief 第一句换口径（不说「传了 N 波」）、
  funnel 中间波情绪不过线时标「广播继续」而非「停在这里」；`travels` 读数照实记录，推不推是另一回事。
- `test/labels.test.js` 钉住门槛文案里的数字与 `GLAD_ENOUGH` 对得上、广播措辞不含「传了」。

## 实时监控（检查进行中）的动线

- `showLive` 除了显区还会把视口**滚到实时区**：点「让小镇来读」之后最想看的是地图逐批判定
  点亮，实时区在首屏折叠线下，不滚过去整段监控都不可见。

## 发帖框的可玩性（试一句 / 定价阶梯 / 字数计）

- 「试一句」chips、四预设各三条的样例文本、按预设换的占位句、字数计格式、定价阶梯的
  报错文案——全部来自 `labels.js` 的 `COMPOSE_ZH`（中文单源）。chip 再点一次换下一条，
  轮换序固定（`app.js` 的 `sampleAt`，确定性）；点击后焦点与光标交给输入框尾部——
  样例是起点，作者接着改才算玩起来。
- 商品的定价阶梯行只在 `preset=product` 出现；`app.js` 的 `parsePrices` 校验「至少两个
  正数」，读不对**停在表单不发**：用户看着报告以为是自己的价格，结果跑了默认档——
  这是最糟的静默错。**留空 = 不表态**：新帖落 `DEFAULT_PRICES`（presets.js 单源，Worker
  校验提示 / 引擎兜底 / CLI 默认同源），改版则由服务端**沿用上一版的阶梯**——改一版文字
  不该静默换价格。
- Ctrl/Cmd+Enter 在 textarea 里直接提交（Enter 仍换行）。
- `test/labels.test.js` 钉住：三张表（chips/placeholders/samples）键序与 `PRESETS` 一致、
  每预设 ≥2 条样例且不超 `MAX_TEXT_CHARS`、报错文案带可照抄的例子。

## 交互与性能约定

- 移动端优先：新布局在窄屏不得溢出（审计轮修过）。
- canvas 图表须可被主题重绘（注册/注销集中管理，防泄漏——审计轮修过画布泄漏）。
- voices 卡片默认折叠 24 条，可展开全部（防 DOM 过重）。
- BYOK key 只进 localStorage，弹窗在 `app.js`；请求头由 Worker 侧 `providerOf` 消费。
- 首屏模块闭包（22 个 ESM）在 `index.html` head 用 `<link rel="modulepreload">` 整排
  预载（最大的 `shared/personas-pack.js` ~290KB 最受益，无构建步骤压平不了模块瀑布）。
  **清单是手工同步的：新增静态 import 后记得补那一排。**

## 交互细节（R6 起）

- **实时图表悬停读数**（R18）：三张监控图支持 hover——容器级 pointermove 委托（**svg
  每批 innerHTML 重建，监听必须挂常驻容器**），x 反算样本序号后插临时竖参考线 +
  `.chart-read` 右上读数；换算参数 `CHART_PADS` 由 charts.js 导出（改 pad 同步它）。
  图表只画最近窗口（roll 48 / share 60），读数的批次号是绝对序号。
- **地图悬停档案**（`grid.js` 的 `attachTooltip`）：悬停走 `pointermove`（`pointerType === 'touch'`
  的拖动不算悬停），触摸屏点按走 `pointerdown`——点一下出档案，同格再点收起。
- **tooltip 定位**必须过 `clampTip(x, y, w, h, vw, vh)`（纯函数，有单测）：默认光标右下，
  右缘放不下翻左、下缘放不下翻上，最后钳进视口留 12px。别改回裸 `clientY + 14`——
  画布在折叠线下时 tooltip 会被视口裁掉（R6 取证实测 tipBottom 3487 / vh 805）。
- **报告深链**：feed 链接是真 URL（`/?post=<id>`），点击在 `app.js` 委托拦截 +
  `pushState`，回退键收起报告；页面载入读 `?post=` 直开。**不要再写 `javascript:` URL**。
- **地图键盘可达**（R15）：报告地图 canvas 带 `tabindex="0"`，方向键逐格移动
  （`stepCell` 纯函数，越界不动、不许跨行回绕）、每步揭示档案（tooltip 的 role="status"
  让 SR 逐格播报）；光标格是 **UI 色（--accent）**不是数据色，登记在 `cursorByCanvas`
  （WeakMap），`paint()` 末尾描出来——全量重画自动带回。传播层（tipOff）上键盘不动作。
- 检查进度的播报**分两层**（R9）：`#statusLine` 是纯视觉行（逐批更新，**不许挂
  `role="status"`**——一次全城检查会刷出约 100 条播报）；`#statusLive`（sr-only）
  才是屏幕阅读器听的，只在里程碑更新（开局/收波/完成/拒发/失败），`app.js` 的
  `announce()` 是唯一入口。
- voices「看全部」展开后焦点交给第一张新露出的卡。

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
