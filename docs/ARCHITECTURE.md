# ARCHITECTURE · 系统架构

## 一句话形态

一个 Cloudflare Worker 同时干三件事：**API**（`/api/*`）、**静态资源**（`public/` 直接由
边缘 assets 出，不计 Worker 请求）、**D1 存储**。引擎代码在 Worker、浏览器、Node 终端
三个运行时共用同一份源码（`public/shared/`）。

```
浏览器（public/ 无框架前端）
  │  POST /api/check · POST /api/version · GET /api/batch · POST /api/wave · GET /api/post/:id
  ▼
Cloudflare Worker（worker/index.js）── 调用 ──► Jev（TypeSafe System One / OpenRouter / mock）
  │  读写
  ▼
D1（posts / versions / reactions / batches）
```

## 目录职责

| 路径 | 职责 | 备注 |
|---|---|---|
| `public/shared/` | ★ 三端共用引擎 | 上游 9 文件（MIT 最小改动）+ 本项目 6 个新文件 |
| `public/` | 界面：发帖框首屏、四主题、报告渲染、图表、地图 | 无框架，原生 ESM |
| `worker/index.js` | API + D1 + 记账 + BYOK | 单文件，按路由函数组织 |
| `migrations/` | D1 结构，0001–0009 | 只增不改 |
| `scripts/check.js` | 终端检查，复用同一引擎 | 产出存 `output/checks/` |
| `test/` | node:test，mock 通道 | 含 Worker 集成（unstable_dev） |
| `docs/` | 全部项目文档 | 索引见 [README.md](README.md) |
| `_research_raw/` | 上游调研原始材料 | **已 gitignore，仅本地查阅** |

## 引擎：三端一份源码

`public/shared/` 不 import 任何平台 API，靠注入的 `send`（或 `ask`）与决策模型通信，
因此同一份代码可跑在：

- **Worker**：`worker/index.js` 提供 `send`（带 BYOK 头、记账）
- **浏览器**：`app.js` 通过本站 API 间接驱动，不直连 Jev
- **Node 终端**：`scripts/check.js` 直连 provider，跑完整 `runCheck`

### 引擎文件清单

| 文件 | 来源 | 职责 |
|---|---|---|
| `rng.js` | 上游 | 确定性哈希随机（seed → 可复现抽样） |
| `draw.js` | 上游 | 概率 → 反应/答案的抽样；`expectedTone` |
| `presets.js` | 上游 | 四预设（post/listing/product/headline）、反应判据、颜色 `LOOKS` |
| `requests.js` | 上游 | 全部问句构造（反应/追问/审核/受众） |
| `feed.js` | 上游 | 波次传播算法、情绪、收尾提问聚合 |
| `summary.js` | 上游 | 计数、分组分析、提升倍数、需求曲线 |
| `check.js` | 上游 | `runCheck` 主编排（引擎侧） |
| `personas.js` | 上游 | 100×100=10,000 人格网格、人格行生成 |
| `jev.js` | 上游 | provider 定义与 `ask`（typesafe / openrouter） |
| `vocab.js` | **新写** | 中文词表（兴趣/职业/年龄/性情/预算…） |
| `labels.js` | **新写** | 全部中文标签单源（界面文案的中枢） |
| `mock.js` | **新写** | 假 Jev：按文本特征 + 人格属性算确定性概率 |
| `bytes.js` | **新写** | base64 编解码小件 |
| `replay.js` | **新写** | 存档 JSON → 报告视图（首页示例回放） |
| `spatial.js` | **新写** | 人群地形：Moran's I + 置换检验，读"成片还是零散"；`terrainOf` 为真身，`crowdDelta` 把同一套统计套在两版态度差场上（只在浏览器跑，Worker 不参与） |

## 一次检查的完整数据流

```
POST /api/check         开局：约 55 类人群 Score 打分 + 7 道审核是非题 + 文本解读
                        （0.5 不进公共流 / 0.85 拒发）→ 写 posts + versions
GET  /api/batch         每批 100 人，每人一道 Choice 题（可并发多批）
POST /api/wave          收波：算情绪，净情绪 ≥0.1 才传下一波
                        （600 → 1500 → 3000 → 其余，上限 CROWD_MAX_WAVES）
   （listing/product）追问阶段：买家最常问 / 价格需求曲线
   收尾提问            为什么划走 / 什么让他们停下 / 会怎么评论
GET  /api/post/:id      报告与图谱的数据源（含调用报告与决策样本）
```

- 每次 Jev 调用记入 `batches`（stage/n/usd/tokens/ms），`versions.usd` 累加总花费；
  修复记录见 [MEMORY.md](MEMORY.md)（收尾提问花费曾漏记）。
- 决策样本（问句 + 概率分布）在 Worker 与共享引擎双路同构留存，供「Jev 的决策现场」展示。
- 人群按 isolate 级缓存，同一文本重复检查不重算。

## 配置（wrangler.jsonc 明文 vars）

| 变量 | 现值 | 含义 |
|---|---|---|
| `CROWD_MAX_WAVES` | 4 | 文本最多传几波（1=仅第一波 600 人） |
| `JEV_PROVIDER` | mock | mock / typesafe / openrouter；留空=有哪个 key 用哪个 |

站点不提供站方 key：**所有真实检查一律走访客自填的 BYOK key**（花自己的钱），无 key 即
mock。曾经的每 IP 每日限额与全站日预算闸（R28 前）已整体退役——它们保护的站方钱包
不存在了。

## 关键设计约束

1. **模型只判概率，不产文本**：所有展示文字来自 `labels.js` / `presets.js` 的固定文案池，
   Jev 返回的永远是概率分布。任何"让模型写字"的需求都违背项目前提。
2. **中文单源**：`labels.js` 是界面中文的唯一来源；`vocab.js` 是人格中文词表唯一来源。
   禁止在渲染层硬编码中文标签。
3. **确定性**：同一 seed + 同一概率 ⇒ 同一抽样（`rng.js` 哈希随机），测试与回放依赖此性质。
4. **零花费可玩**：无 key 全流程 mock；真实成本单波 600 人约 $0.01–0.02（实测见
   `research/real-api-report.md`）。

## 上游谱系与差异

引擎与 Worker 架构改造自 [gaborishka/jevtown](https://github.com/gaborishka/jevtown)（MIT），
其思路源于 [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town)。主要差异：中文词表
与人格、mock 供应器、四主题、BYOK、调用记账与分阶段报告、决策现场抽样、图谱模块，
以及本项目新增的**人群地形**（`spatial.js` 的 Moran 空间自相关，报告里的「人群地形」段与
地图的「聚集地形」层）。
上游的居民系统、自定义受众、MCP、OG 图未引入（路线图见 README）。

> 引擎里还留着两处**上游有、这里量过、结论是不接**的能力：`check.js` 的 `audience`（只给某类人看，
  含 `rateAudience` / `partsOf` / `audienceOf`）与 `feed.js` 的 `partsOf` / `audienceMask`。
  R35 用真实 Jev 量过这条路（`scripts/probe-audience.js`，12 条中文受众描述 × 83 组）：
  「哪组人真在乎这段话」的读数与真实比例**秩相关只有 rho = 0.264**，同请求复读的噪声底是平均绝对差
  0.007–0.013；而闸门本身那三个从没量过的阈值（`PART_FROM = 0.5` / `PASS_SHARE = 0.7` /
  `MIN_AUDIENCE = 50`）实测后果是「给刚生孩子的年轻父母」→ `partsOf` 返回 `null`（描述作废），
  「给正在攒钱买第一台笔记本电脑的上班族」→ 只剩 21 人（0.2%）。代码保留（CLI 与存档端同构、便于
  上游合并），但站点与 Worker 不走这条路；`summary.js` 的 `inAudience` 同理。本项目改为让作者从
  `summary.js` 的 `SEGMENTS` 七维导出的 115 项清单里**挑段 id**，报告拿它与真实停下分布对账
  （见 `2026-10-03-audience-reconciliation-design.md`），新增花费 $0。
  计划文档 `2026-09-29-r5-version-delta.md` 的两版之差会用到同一类「子集人群」思路。
