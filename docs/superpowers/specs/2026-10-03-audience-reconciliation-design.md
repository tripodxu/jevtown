# 这段话是给谁的 · 设计

日期：2026-10-03 · 轮次：R35（创意轮）

## 为什么做这个

上游作者留了整套「受众」能力，这个项目从没用过：

- `public/shared/check.js:98` `runCheck` 的 `audience` 参数 —— 传一句描述进去，它并行问 Jev（`public/shared/requests.js:206` `audienceRequest`），再调 `public/shared/feed.js:446` `partsOf` 定「谁算这段话的人」，然后**只让那群人读文本**。
- `feed.js:457` `audienceOf` / `feed.js:463` `audienceMask` —— 把结论落成字节位图。
- `check.js:72` `rateAudience` —— 已经能跑。

而 `worker/index.js` grep `audience` **零命中**，`test/` grep `audience` 零命中，`docs/ARCHITECTURE.md:109-112` 把它列成「上游有、这里没接」。

这条路没接，不是忘了，是三个闸门从没量过。`feed.js:423-430`：

```js
export const PART_FROM = 0.5;     // Not measured yet (scripts/probe.js audience)
export const PASS_SHARE = 0.7;    // Not measured yet
export const MIN_AUDIENCE = 50;   // Not measured yet
```

`scripts/` 下**根本没有 `probe.js`**。这三个数是拍脑袋的，直接当产品闸门会让「给年轻人」砍掉三千人，也可能只剩三十人。

## 实测取证

本轮三个探针，全部真实 Jev（`.env.local` 有 key）。

### 一、`scripts/probe-audience.js`：三个闸门量出来是什么样

12 条中文受众描述，每条一次 `audienceRequest`（83 组 FIT 分 + 5 道 `part:*` noul，$0.0003/条）。每条配一个「它真正说的是谁」的真判据（本地数镇子里符合条件的人数 ÷ 该组总人数），看 Jev 的分和真比例对不对得上。

| 描述 | 现闸门 `partsOf(0.5, 0.7)` 的后果 |
|---|---|
| 给刚生孩子的年轻父母 | **`null` —— 描述作废** |
| 给正在攒钱买第一台笔记本电脑的上班族 | 留下 **21 人（0.2%）** |
| 给 25 到 34 岁 | 2,079 人，100% 准 |
| 给爱打游戏的人看 | 731 人 |
| 给做设计与摄影的人看 | 317 人 |
| 给在中小厂上班、担心裁员的人看 | 1,513 人，但只有 55.2% 准 |

三个数：

- **秩相关 rho = 0.264**（996 个「组 × 描述」配对）。Jev 说得出「描述点了哪个维度」，说不太准「这组人里有多少真是那种人」。
- **噪声底**（同请求复读）平均绝对差 0.007–0.013、中位 0.005–0.010、最大 0.040–0.0425。而 `PART_FROM = 0.5` 与读数的间距在同一量级 —— 阈值定得再准，跨不过噪声。
- **`part:*` 五道 noul 的实测读数**：「给刚生孩子的年轻父母」给出 field 0.24 / age 0.20 / interest 0.14 / budget 0.08 / shopping 0.17，**全在 `NAMED_FROM = 0.5` 之下** → 一个维度都没点名 → `partsOf` 返回 `null` → 描述作废。一句明显点名了年龄和兴趣的描述，被这套闸门判成「什么都没说」。

**结论：`partsOf` / `PART_FROM` / `PASS_SHARE` / `MIN_AUDIENCE` 整条路不能当产品闸门。** 让 Jev 解析中文描述这条路，本轮放弃。

### 二、`scripts/probe-match.js`：对账表的另一半有多少料

拿真实存档 `public/examples/iphone-listing-v1.json` 里 Jev 真的判出来的 10,000 个反应字节（非零 2,100，即两波到达），跑一遍 `segments()` + `topSegments(all,'stopped',8)`。

floor = `minSegment(2100)` = **15**，段总数 115，显著停下组 **8 个**：

| 组 | 停下 / 全组 | lift |
|---|---|---|
| 想买：手机 | 249 / 287（87%） | **16.81×** |
| 想买：礼物 | 124 / 441（28%） | 5.45× |
| 兴趣：摄影 | 154 / 719（21%） | 4.15× |
| 职业：设计文案传媒 | 95 / 941（10%） | 1.96× |
| 兴趣：流行音乐 | 81 / 813（10%） | 1.93× |
| 年龄段：25–34 岁 | 189 / 2079（9%） | 1.76× |
| 城市：昆明 | 18 / 223（8%） | 1.56× |
| 兴趣：设计 | 58 / 728（8%） | 1.54× |

**对账表有料：8 行够填。** 且最大的两块（手机 16.81×、礼物 5.45×）都落在 `shopping` 维度 —— 这是作者最会写、也最容易挑准的维度。

### 三、`scripts/probe-mention.js`：作者的话怎么变成「组」

作者写的是「年轻人」「刚生孩子的年轻父母」，词表里是 `age:a18`、`age:a25`、`shopping:kids`。12 句真实作者话术逐句撞词表（中文子串匹配）：

| 撞上了 | 撞不上 |
|---|---|
| 想找真正想买手机的人 → `shopping:phone` | **想找年轻人** |
| 想找爱摄影的人 → `interest:photography` | 想找做创意的人（词表叫「设计文案传媒」） |
| 给爱喝茶的中老年人 → `interest:tea` | 给刚生孩子的年轻父母 |
| 给手头紧的人 → `budget:tight` | 给在中小厂上班、担心裁员的人 |
| 给准备买自行车代步的人 → `shopping:bicycle` | 给所有二十多岁的人 |
| 给爱打游戏的人 → `interest:games` | 给爱养花种菜的人 |

**6 / 12 = 50%。** 中文没有词边界，「年轻人」「二十多岁」这种最普通的写法一个都撞不上，而它恰好是作者最会写的说法。

同时量到两个数决定形态：

- 六维度取值数：兴趣 40 / 职业 15 / 年龄 5 / 预算 4 / 想买 20 = **84 项**。全展出来没人勾得完。
- **≥400 人的取值 61 个**（兴趣 40 / 职业 13 / 年龄 1 / 预算 3 / 想买 4）。400 是「勾了也等得到反应」的下限 —— 只 200 人的组勾了也只能等到 200 人的反应。

## 设计

### 一、算什么

作者在发帖时写一句「这段话是给谁的」，再从词表里挑出他说的那几组。报告给他一张对账表：**你想找的人 vs 实际走过来的人。**

- **全部读数来自报告已有的 `segments()` 真实停下分布** —— 不是新的推断，是把已有的数摆成一张能读的表。
- **新增花费 = $0。** 一行 Jev 请求都不加。（本轮最初的设计是「随开局多问一次 `audienceRequest`」，被上面第一份实测推翻了 —— 花了钱还得到一个作废的描述。）

### 二、作者的话怎么变成「组」

不猜。一句自述下面挂一个即时过滤的输入框，滤那 84 项词表，作者挑中。

- 挑的是词表 id，**永不猜错** —— 直接消掉 probe-match 量到的 50% 误判。
- 过滤是本地字符串匹配（输入「年轻」→ 5 个年龄段 + 若干相关兴趣），**零花费、零延迟**。
- 作者写的那句话**仍然存下**，作为这一节的头。他原话是「我想找刚生孩子的年轻父母」，他挑的是 `age:a25` + `shopping:kids` —— 两者的落差本身就是信息，报告里要显出来。
- 允许一项不挑（= 想写给所有人看）。那也是一个合法答案：对账表全落在「没说的」栏，这本身是结论。

### 三、存哪、怎么传

**存哪** —— 一列 TEXT，与 `away`（R32）同形：

```sql
-- migrations/0009_audience.sql
ALTER TABLE versions ADD COLUMN audience TEXT;
```

存 `{ said: "想找刚生孩子的年轻父母", picked: ["age:a25","shopping:kids"] }`。放 `versions` 不放 `posts` —— 改一版再发时「给谁看」是连同文本一起改的，跟文本同生共死。

**怎么传** —— 三处：

| 位置 | 改动 |
|---|---|
| `worker/index.js` `runCheck` / `runVersion` | `body.audience` 收 `{said, picked}`；`picked` 逐个查词表，不认识的 id 直接丢；空数组也存（= 想写给所有人看，报告要显出来） |
| `public/app.js` 表单 | textarea 下面加一行：一句自述 + 一个即时过滤的输入框（滤 84 项）+ 已选标签 |
| `showPost` 的 `base` | 多带 `audience: JSON.parse(version.audience ?? 'null')` |

CLI（`scripts/check.js`）同步：`--audience "自述" --picked age:a25,shopping:kids`。

### 四、报告里长什么样

新增一节，位置在 `segmentsView`（谁停下了）**之前**：

```
你说的是：给刚生孩子的年轻父母              ← 作者原话（.source-text 灰底）
你挑的 2 组：25–34 岁 · 婴儿用品           ← 词表 id → 中文

对账    停下 / 全组 · lift
──────────────────────────────────────────
对上了    想买：手机        249 / 287（87%）· 16.81×
对上了    年龄段：25–34 岁   189 / 2079（9%）· 1.76×
没等到    想买：礼物          3 / 441（1%）· 0.21×
没说的    兴趣：摄影         154 / 719（21%）· 4.15×
没说的    职业：设计文案传媒  95 / 941（10%）· 1.96×
两边都冷  兴趣：养花           9 / 612（1%）· 0.30×
```

三种口径每行都要标，因为 probe-match 量到的：**18 个停下的组里只有 1 个显著**（作者挑的 2 组里只有手机显著）。三种口径：

1. **你挑的组**，不论显著与否，**永远列全**，标「未显著」或「未显著（太少人）」。
2. **实际停下的组**取 `topSegments(all,'stopped',8)`，超出你挑的也列，标「没说的」。
3. **两边都没碰**的归「两边都冷」，只列 `size ≥ 400` 的（probe-mention 量到 61 个 ≥400 人的取值，全列太长）。

**一句话结论**在表头，规则写死在代码里而不是让前端拼：

- 挑的组里有显著组 → 「你说的 N 组里有 M 组真停下来了」
- 挑的组零显著 → 「你挑的组一个都没显著停下来，实际停下来的是你没挑的」
- 一个都没挑 → 「你没挑组：这一节在说你写的话引来了谁」

### 五、四个状态

| 状态 | 条件 |
|---|---|
| 对上了 | 挑的 ∧ 显著 |
| 没等到 | 挑的 ∧ 不显著 |
| 没说的 | 不挑 ∧ 显著 |
| 两边都冷 | 不挑 ∧ 不显著 ∧ size ≥ 400 |

## 明确不做

- **不做「只给这群人看」。** 那要重新标定三个阈值，本轮已证明拍脑袋的数不能直接用，而真标定需要更多真实样本 —— 而且它会改变分发，正是这一轮明确不碰的。
- **不改传播判据。** `GLAD_ENOUGH = 0.1`、`WAVES` 一个不动。
- **不删 `partsOf` / `audienceOf` / `rateAudience` / `MIN_AUDIENCE`。** 它们是上游的代码，CLI 与存档端同构；本轮只是在站点与 Worker 侧不走这条路。删掉会让 `check.js` 的 `audience` 参数失去意义，也会让上游合并变难。
- **不给 CLI / 存档加新字段。** `runCheck` 不传 `audience` 时行为一字不变。
- **不改 `docs/ARCHITECTURE.md` 之外的文档口径。** `README` 里「自定义受众未引入」仍然成立 —— 本轮接的不是那条路。

## 测试

- `test/feed.test.js`（或新开 `test/audience.test.js`）：四状态分类的纯函数，对**真实存档 `public/examples/iphone-listing-v1.json` 的 8 个显著组**断言全部分类正确 —— 拿真数据当基准，不造假反应字节（假字节会让所有组 lift≈1，`topSegments` 恒空，见 probe-match 的教训）。
- 表头结论的三条规则各一条断言（命中显著 / 零显著 / 没挑组）。
- `picked` 清洗：认识的 id 保留、不认识的丢、重复去重、`said` 超长截断（上限与 `MAX_TEXT_CHARS` 对齐或更小）。
- 旧存档（无 `audience` 列）走 `?? 'null'` 路径 → 整节不渲染，既有报告一字不变。
- CLI 加 `--audience/--picked` 后 `node --check` 与 mock 全流程仍跑通。

## 落地清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `migrations/0009_audience.sql` | `ALTER TABLE versions ADD COLUMN audience TEXT;` |
| 2 | `public/shared/labels.js` | `AUDIENCE_ZH` 文案表 + `audienceSayZh` |
| 3 | `public/shared/summary.js` | `reconcileAudience(all, picked, presetId)` → 四状态数组 + 结论句 |
| 4 | `worker/index.js` | `runCheck`/`runVersion` 收 `body.audience` 清洗入库；`showPost` 回读 |
| 5 | `public/index.html` | 表单加一行：自述输入 + 词表过滤输入 + 已选标签容器 |
| 6 | `public/styles.css` | 该行的样式 |
| 7 | `public/app.js` | 词表过滤（本地匹配）、标签增删、提交时带上 |
| 8 | `public/render.js` | `audienceView(result)` + 接进 `renderCheck` |
| 9 | `scripts/check.js` | `--audience/--picked` |
| 11 | `test/audience.test.js` | 上面的断言 |
| 12 | `scripts/probe-audience.js` / `probe-match.js` / `probe-mention.js` | 三个探针定稿（决定设计的那三个数） |
| 13 | `docs/ARCHITECTURE.md:109-112` | 那段「上游有、这里没接」要改口：本轮量过了，结论是**不接**（附三个实测数），并写清 `summary.js` 的 `inAudience` 同理 |
| 14 | `docs/MEMORY.md` | R35 条目 |

## 风险

- **84 项词表在窄屏塞不下。** 表单那行在小屏（≤760px）下要能逐项落下，且未选时默认折叠，只显示输入框与「已选 N 组」。未选任何组的报告整节不渲染 —— 未使用特性未使用频次呈现。
- **作者会挑「看起来最准」的那组。** 表里的 lift 数字是真实读数，作者挑得准不准是他的判断，本设计不替他做。
- **这一节全在已有读数上重排。** 它不产生新信息量，只产生新的可读性。若日后要「该不该换受众」这类结论，需要重新标定阈值，那是另一轮的事。