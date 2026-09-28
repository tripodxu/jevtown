# Jevtown 中文小镇

人们写，一万个 AI 人格来读。发一段文字，小镇在几秒内给出反应：谁停下、谁点赞、谁反感、谁划走——每一次反应都是 [Jev](https://typesafe.ai)（TypeSafe 的 System One 模型）对类型化问题返回的概率，模型不写一个字。

基于 [gaborishka/jevtown](https://github.com/gaborishka/jevtown)（MIT）的引擎与 Worker 架构改造的**中文小镇版**，按参考仓库的同款形态部署：**一个 Cloudflare Worker（API）+ D1（存储）+ 无框架静态前端（assets）**。调研依据见 [Jevtown调研报告.md](./Jevtown调研报告.md)。

> **当前状态：本地开发阶段，未上线。** 全流程可在 mock 模式下离线跑通（无需任何 key、零花费）。

## 计划

- 调研报告：[Jevtown调研报告.md](./Jevtown调研报告.md)
- 实施计划：[docs/superpowers/plans/2026-09-28-jevtown-cn-step2-polish.md](./docs/superpowers/plans/2026-09-28-jevtown-cn-step2-polish.md)（Step 2 逐任务代码级计划；Step 3-5 为纲要，启动时各自细化）

## 本地运行

需要 Node.js 22+（本机 22.21 已验证）。

```bash
npm install                          # 安装 wrangler
npm run dev                          # 应用本地 D1 迁移并启动，http://localhost:5191
```

打开 http://localhost:5191 ，选类型、写文字、点"让小镇来读"。默认 mock 模式：答案是确定性的假答案（按文本特征 + 人格属性算出），小镇的样貌是真实的，但不调真实模型、不花钱。

**Jev 驱动的呈现**：首屏明示"由 TypeSafe Jev 驱动"；总览计数叫"Jev 逐格判定"；进度文案是"Jev 已判定 N 人"；地图悬停显示"Jev 判定"；结果页有"Jev 的决策现场"——抽样 10 例真实问句（Jev 读到的英文人格原句）、它返回的概率分布与最终判定，mock 与真实模型同构。

**结果页图谱**：每次检查自带一份"Jev 调用报告"（分阶段的请求数 / tokens / 花费 / 模型耗时，条形占比）和一组分析图谱：波次漏斗、情绪轨迹折线、反应分布条形图、分组提升倍数、商品价格需求曲线。数据来自 `batches` 流水表（含每次请求的耗时），mock 与真实模型同构。

**主题**：顶栏右侧四个分段按钮自由切换视觉世界——夜巡（默认，墨色夜城）、公报（米纸宋体）、仪器（冷灰精密）、经典（第一版配色）。选择存 localStorage，地图画布随主题重绘；全部由 `public/styles.css` 的 CSS 变量令牌驱动，新增主题 = 加一组令牌 + 顶栏一个按钮。

**接真实模型**：把 `.dev.vars.example` 复制为 `.dev.vars`，删掉 `JEV_PROVIDER=mock`，填入 `TYPESAFE_API_KEY` 或 `OPENROUTER_API_KEY`（OpenRouter 用模型 `typesafe/jev-1.13` 的 Decisions API）。重启 `npm run dev`。

**终端跑一次检查**（不经过站点）：

```bash
npm run check -- --preset listing "出 iPhone 13，128G，电池 86%，无维修，1400 元，可小刀，包邮，联系我"
npm run check -- --preset post --max-waves 2 "我为什么把每周例会砍成了 15 分钟"
```

结果摘要打印到终端，完整字节存到 `output/checks/`（之后给前端回放用）。密钥读 `.env.local`（模板 `.env.example`）；没有 key 或 `MOCK=1` 自动走 mock。

**测试**（不需要 key）：`npm test`

## 一次检查的流程（与上游一致，浏览器分步驱动）

1. `POST /api/check` —— 一个请求同时问 Jev：约 55 类人群对文本的 Score 打分（兴趣 40 + 职业领域 10 + 年龄段 5）、7 道审核是非题（0.5 不进公共流 / 0.85 直接拒发）、2~3 道文本解读是非题。随后传播算法按"属性得分立方和"排出第一波 600 人。
2. `GET /api/batch` —— 每批 100 个人格、每人一道 Choice 题（反应：划走/停下/点赞/反感/转发/关注/拉黑；闲置转让另有：点开/收藏/联系卖家/怀疑骗局）。反应从概率里按"人格 id + 版本号"做种子抽样，刷新页面人群不变。
3. `POST /api/wave` —— 收波算情绪（乐见 − 反感）。净情绪 ≥ 0.1 才把文字送进下一波（600 → 1500 → 3000 → 其余）；否则或到达全城后收尾，把收尾提问（为什么划走/什么让他们停下/会评论什么）发给最多 3 组 × 100 人。
4. `GET /api/post/:id` —— 汇总页面所需的一切：计数、波次、地图字节（base64）、分组、小镇在说、人格声音。

限额是 `wrangler.jsonc` 里的明文变量：每 IP 每天检查数（`CROWD_DAILY_LIMIT`）、全站日预算（`CROWD_DAILY_BUDGET_USD`）、最大波数（`CROWD_MAX_WAVES`）。

## 目录

| 路径 | 内容 |
|---|---|
| `public/shared/` | ★ 引擎，Worker / 浏览器 / 终端三端共用。`rng.js` `draw.js` `presets.js` `requests.js` `feed.js` `summary.js` `check.js` `personas.js` `jev.js` 九个文件来自上游（MIT，仅按本项目做了最小改动）；`vocab.js`（中文词表）、`labels.js`（界面中文标签）、`mock.js`（假 Jev）为本项目新写 |
| `public/` | 界面：`index.html` + `styles.css` + `app.js`（编排）+ `grid.js`（100×100 地图）。无框架、无构建 |
| `worker/index.js` | Cloudflare Worker：API + D1 存取 + 限额 |
| `migrations/` | D1 结构（posts / versions / reactions / batches） |
| `scripts/check.js` | 终端检查，产出回放 JSON |
| `test/` | node:test 单测 + mock 全链路集成测试 |

## 与上游的差异（本项目自有部分）

- **中文词表**：40 个兴趣（5 行 × 8 列网格布局，最年轻一行在前）、40 种职业、15 个职业领域、中国城市带权重、按年龄排的名字池。Jev 读英文字段（`personaLine` 是英文行），界面显示中文字段；人格的名字/城市键从上游的 `uk` 改为 `zh`，城市分段用中文名。
- **mock 供应器**：`shared/mock.js` 按文本特征（卖相、兴趣词命中、辱骂/乱码检测）+ 人格属性（性格、对口兴趣）计算确定性概率，让离线 demo 和集成测试不花钱也像真的。
- **Worker 简化**：本阶段只实现核心闭环（check/batch/wave/post/feed），不做 OG 图、页面头注入、作者 cookie、多版本、自定义受众、居民系统；`wrangler.jsonc` 未配 routes（不上线）。
- **波次随机数**：上游在整次检查里用一条连续随机流；Worker 跨请求改用 `hash32('waves', pool, post.number.waveIndex)` 逐波重播种，仍是确定性的。
- **人格即时计算**：上游用 `crowd-*.bin` 预打包人格属性以省 CPU；本阶段直接 `persona(pool, id)` 现算，本地无压力，上线免费档（10ms CPU）前需补打包管线。

## 步骤清单（一步一步完善）

- [x] **Step 1 · 核心闭环（本阶段）**：中文小镇引擎 + Worker API + D1 + 前端 + mock 全流程 + 单测/集成测试
- [x] **Step 2 · 打磨**：版本对比（改文案再发同一批受众，两版并排）、商品价格阶梯与需求曲线、闲置帖买家问题、收尾提问人头数展示、首页示例回放（`public/examples/*.json` 纯浏览器回放）
- [ ] **Step 3 · 真实模型联调**：TypeSafe / OpenRouter key 实测，记录真实成本与延迟（参照上游 measurements.md 的方法）
- [ ] **Step 4 · 上线准备**：人格打包管线（CPU 优化）、`wrangler d1 create` + secret、自定义域、并发收波 CAS 锁、`npm run deploy`
- [ ] **Step 5 · 生态（可选）**：MCP 服务器（check_text / compare_texts）、居民系统 /me、分享卡片

## 许可

MIT。引擎部分来自 [gaborishka/jevtown](https://github.com/gaborishka/jevtown)（MIT，© Ivan Habor 及上游贡献者），其引擎又源于 [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) 的思路谱系；中文词表、mock、Worker/前端改写部分版权归本项目。
