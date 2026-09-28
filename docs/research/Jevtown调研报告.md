# Jevtown 调研报告

> 调研时间：2026-09-28 · 工具：AnySearch（实时检索 + 页面抓取）· 原始抓取件见 `_research_raw/`
> 目标：为本项目做一个**部署在 Cloudflare Pages 上的静态页面**，参考 GitHub 上的 jevtown 项目。
> 结论先行：GitHub 上名为 `jevtown` 的项目是 **gaborishka/jevtown**（万人 AI 人格受众模拟，部署于 jevtown.ivanhabor.com）。它的前端本身就是"无框架、无构建"的纯静态 JS，其首页示例就是一份**纯客户端回放**——这证明"静态页面复刻"完全可行；需要 Jev 实时交互的部分才需要 Worker/Functions。**推荐起步方案：纯静态回放展示站（方案 A）**，详见第四章。

---

## 一、先厘清：有三个叫 "Jevtown" 的东西

调研发现 "Jevtown / jevtown" 名下有三个**互相独立**的项目，动手前必须分清：

| | ① gaborishka/jevtown ⭐ 主参考 | ② NevaMind-AI/JevTown | ③ jevtown.com（elberacasa） |
|---|---|---|---|
| 一句话 | 人们发帖，1 万个 AI 人格来读 | Jev 驱动的像素小镇游戏引擎（《余时遗物》） | "Beat the AI" 猜拳对决网页游戏 |
| GitHub | [gaborishka/jevtown](https://github.com/gaborishka/jevtown)（11★，MIT） | [NevaMind-AI/JevTown](https://github.com/NevaMind-AI/JevTown)（40★，MIT） | 未见公开仓库 |
| 线上 | [jevtown.ivanhabor.com](https://jevtown.ivanhabor.com) | 引擎代码；配套游戏文档站 afterglow.xnnehang.top | [jevtown.com](https://jevtown.com) → [play.jevtown.com](https://play.jevtown.com) |
| 作者 | Ivan Habor（乌克兰） | NevaMind-AI（中文团队，AGENTS.md/ROADMAP 为中文） | @elberacasa |
| Jev 的角色 | 给每个格子的反应打分/出概率 | 给每个 NPC 选下一个动作（System One 决策器） | 前身"千人小镇"由 Jev 决策每个市民行为（9/19–21），后改用开源模型 Laya 微调 |
| 架构 | Cloudflare Worker + D1 + 无框架静态前端 | React+PixiJS+Vite，浏览器内模拟 + 本地代理持密钥 | 网页游戏（Layatown / Laya 微调模型） |
| 创建时间 | 2026-09-20 | 2026-09 前后（19 commits） | 实验始于 2026-09-19 |

**名字完全匹配 GitHub 仓库 "jevtown" 的是 ①**，且它被 yibie/awesome-jev 与 cobanov/awesome-jev 两个策展列表同时收录（检索到的唯一 "jevtown" GitHub 项目），产品页在 Product Hunt 上线（评分 4.0）。**本报告以 ① 为主参考**，② ③ 作为同名项目附于本章，其可借鉴点在文中标注。

---

## 二、主参考：gaborishka/jevtown 深度拆解

### 2.1 产品形态

"一个人们写、1 万个 AI 人格读的社交网络"：发一段文字 / 商品帖 / 招聘 / 标题，几秒内小镇给出反应——多数划走、一些点赞、转发、拉黑、联系卖家、下单。所有反应都来自 Jev（TypeSafe 的 System One 模型）对**类型化问题**返回的概率，Jev 不写任何文字。

核心功能（README 全录）：
- **受众地图**：100×100 个点、一点一人格、邻居是相似的人。文字先推给 Jev 认为合适的 600 人，只有人群"乐见"才继续扩散。好帖子在地图上可见地蔓延；垃圾/引战/骗局帖死在第一波。
- **自定义受众**：用自然语言描述人群（"IT 从业者、关注创业"），只有符合每一段描述的人会读。
- **分组统计**：按兴趣、职业、年龄、脾气、预算、城市、正在想买什么分组，看谁停下、谁点赞、谁反感。
- **问小镇**：检查结束后，最多 3 个问题、每题最多问 100 个到达过的人（划走/反感的说原因，喜欢的说是什么让他们停下，帖子则问会评论什么）。
- **Jev 的文本解读**：随首请求带最多 3 个关于文本本身的是非题（首句是否说明卖什么、是否告诉读者该做什么、是否有具体数字/名字/例子）。
- **商品帖价格阶梯**：在你设的价格点上各有多少人买、哪个价赚最多。
- **居民系统 /me**：访客捏一个人搬进小镇（id 从 10000 续起），读后续新帖并用 Jev 作答；还有 8 帖小测验对比"Jev 猜你"vs"描述猜你"。
- **分享卡片**：浏览器内把帖子+地图+到达数画成 PNG。
- **版本对比**：改文案再发给同一批受众，两版并排看差异。
- 双语：乌克兰语/英语各 1 万人格池（`crowd-uk.bin` / `crowd-en.bin`），按文本所用文字自动分流。

### 2.2 技术架构（对复刻最重要的部分）

仓库只有 84 个文件，**零运行时依赖**（devDependencies 仅 wrangler 和一个 SVG 转 PNG 库），Node ≥ 22：

```
public/            纯静态界面：app.js(页面) grid.js(地图) card.js(卡片) showcase.js(首页示例) i18n.js
public/shared/     ★核心引擎，Worker / 浏览器 / 终端三端共用：
                   jev.js(调 Jev) personas.js(算人格) rng.js(种子随机) vocab.js(词表)
                   feed.js(波次算法) summary.js(统计) presets.js requests.js(Jev 问题原文)
                   pack.js(人格属性二进制包) resident.js quiz.js check.js
public/examples/   首页回放用的两份已保存检查结果(iphone.json)
worker/            一个 Cloudflare Worker：API + OG 链接预览图 + 页面头
worker/crowd-*.bin 全部 1 万人格属性的打包文件（scripts/build-crowd.js 重建）
mcp/               stdio MCP 服务器：check_text / compare_texts 两个工具（给 Claude 等 agent 用）
migrations/        D1 建表 SQL（0001~0004：init/traces/residents/audience）
wrangler.jsonc     部署配置（见 2.5）
```

三条关键设计，直接决定了静态化可行性：

1. **人格是"算"出来的，不是存出来也不是 LLM 生成的**。`persona(pool, id)` 只由池名 + id（0~9999，即 100×100 网格坐标）决定：纵轴定年龄、网格分块定主兴趣（邻居相似）、职业/脾气/预算/消费/想买什么都由种子哈希加权抽取。同一 id 永远是同一个人。Jev 读到的是一行英文：`Oksana, 34, accountant, Lviv; into gardening, movies, travel; skeptical, distrusts ads; careful with money`。
2. **一切随机都来自种子哈希**（`rng.js`：FNV-1a + mulberry32）。反应是从 Jev 返回的概率里、以"人格 id + 版本号"为种子抽样的——**刷新页面人群一模一样**，也意味着结果可以离线回放。
3. **无框架、无构建**。`public/` 下的 JS 直接以 ES Module 被 HTML 引用即可运行，静态托管零适配。

### 2.3 Jev 的接入方式（`public/shared/jev.js`）

双通道、同一请求形状，各端点与模型 id：

| Provider | 端点 | 模型 ID | 计价 |
|---|---|---|---|
| TypeSafe 官方 | `POST https://api.typesafe.ai/v1/systemone` | `jev-1.13.0`（固定版本号，不用别名，保证可复现） | 输入 $0.042/百万 token，输出免费 |
| OpenRouter | `POST https://openrouter.ai/api/alpha/decisions`（Decisions API） | `typesafe/jev-1.13` | 按 usage.cost 实报 |

请求体：`{ model, state, questions }` → 响应 `{ answers, usage }`。工程细节：30s 超时、最多 5 次重试、429/5xx 指数退避加抖动、所有批次共享重试配额（Worker 免费档一次调用只能发 50 个外呼）、`eachLimit` 并发闸。

**问题设计**（这是整个产品的灵魂）：
1. 第一波前的"定调"请求：把文本对约 **60 类人群打 Score 题**（商品帖 83 类），同请求带 **7 个 Noul 审核是非题**（仇恨/露骨/威胁/隐私/违法/辱骂/乱码）。审核分 ≥0.5 不进公共 feed（链接仍可看），≥0.85 直接拒发。
2. 传播：**每请求带文本一次 + 100 个人格、每人一道 Choice 题**（反应枚举：划走/停下/喜欢/反感/转发/关注/拉黑；商品帖另有追问），100 人一批并发发。
3. 波次推进：600 → 1,500 → 3,000 → 其余全部。**只有当"乐见"比"抱歉"多出至少 0.1 个波次占比**，代码才把文本送进下一波；第二波起按同类人真实行为排序。
4. 收尾"问小镇"：每题最多 100 人一个请求，共最多 4 题（worker/town.js），带 CAS 锁防止并发重复付费，预算花完自动跳过。

### 2.4 成本与性能（README/measurements.md 实测口径）

- 一次完整检查：**约 1 美分**（死在第一波）到 **10 美分**（到达全部 1 万人），耗时 3 秒 ~ 1 分钟。
- "问小镇"附加最多 3 个请求（每个 ≤100 人），约 $0.003/帖；居民 8 帖测验约 $0.0005。
- 单个 TypeSafe key 吞吐 **200~460 人格/秒**：每分钟 1~3 条全文传播的文本，或 20~45 条只发第一波的。
- 免费档 Worker 限制：每次调用 50 个外呼、10ms CPU。应对：**由浏览器驱动分步检查**——`POST /api/check`（打分+排第一波）→ 多次 `GET /api/batch`（每批 100 人问 Jev）→ `GET /api/wave`（收波并决定是否续传）。关闭一波约 5ms CPU。
- measurements.md 结论摘录：人格构成能把答案移动数倍；一请求 200 人格与 1 人格答案一致（批量无衰减）；feed 算法前 500 人保住最优 500 人的 83~97%；居民 6 条邻近回答把 Jev 对其猜测从 0.49 提到 0.72。

### 2.5 部署配置解析（wrangler.jsonc）

```jsonc
{
  "name": "jev-crowd",
  "main": "worker/index.js",
  "compatibility_date": "2026-06-01",
  "assets": {
    "directory": "./public", "binding": "ASSETS",
    "html_handling": "none", "not_found_handling": "none",
    // 关键：只有页面路由和 API 走 Worker；样式脚本直接从边缘出，不计 Worker 请求
    "run_worker_first": ["/", "/crowd", "/me", "/p/*", "/u/*", "/api/*", "/og/*"]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "jev-crowd", ... }],
  "vars": {
    "CROWD_DAILY_LIMIT": "10",      // 每 IP 每天可发起的检查数
    "CROWD_DAILY_BUDGET_USD": "5",  // 全站每天总花费上限
    "CROWD_MAX_WAVES": "4",         // 文本最多传几波
    "JEV_PROVIDER": ""              // typesafe / openrouter，空 = 有哪个 key 用哪个
  },
  "routes": [{ "pattern": "jevtown.ivanhabor.com", "custom_domain": true }]
}
```

部署三步：`npx wrangler d1 create jev-crowd`（回填 database_id）→ `npx wrangler secret put TYPESAFE_API_KEY`（或 OPENROUTER_API_KEY）→ `npm run deploy`。**注意：原仓库用的是 Cloudflare "Workers + static assets" 形态（assets 绑定），不是 Pages 产品线**——这是 2026 年 Cloudflare 的推荐做法，见 4.1。

### 2.6 Agent 入口（MCP）

`mcp/server.js` 走 stdio，给 Claude Code / Claude Desktop 两个工具：`check_text`（完整跑一遍小镇）与 `compare_texts`（2~5 个变体只发第一波并按小镇规则排序）。自带预算护栏：默认每日 $1 / 单次 45s / 同时 1 调用、在途 8 请求、内存缓存重复答案。密钥只在本机，HTTP 模式被刻意排除（防止别人烧你的 key）。

---

## 三、两个同名项目的可借鉴点（简）

**② NevaMind-AI/JevTown（游戏引擎，《余时遗物》）**
- 技术栈 React 18 + PixiJS 7（@pixi/react、pixi-viewport）+ Tailwind + Vite 4，上游是 a16z-infra/ai-town，MIT。
- 精华在 `feat/jev-demo-solarium` 分支：`agent/decideJev.ts` 把"下一步做什么"拆成**一次并行 5 问**——`seek`(Noul 要不要找人) / `target`(Choice 找谁) / `roam`(Noul 要不要散步) / `place`(Choice 去哪) / `idle_length`(Choice 停 5s 还是 30s)，state 字段为 `you / how_this_world_works / what_everyone_here_knows / your_state_right_now`。
- 策略阈值全在代码里不在 prompt 里：SEEK≥0.5、ROAM≥0.5、Choice 置信度地板 0.2，逐级 fall through 而非直接 idle；`SUPPRESS_IDLE_AFTER` 用 e^(-Δ/x) 衰减压制连续发呆。Jev 决策实测 425 input tokens ≈ **$0.00002/次**，约为聊天模型完成同任务的 1/500。
- 明确分工：Jev 只做动作选择，**对话/记忆/状态文档仍由 LLM 写**（Jev 不产文本）；引擎先给合法选项清单（manifest），Jev 只能在清单内选——"非法着法不可表示"。
- 密钥走本地代理（浏览器永远拿不到 key），演示模式每次运行 2000 次调用熔断。
- 对我们的启示：若静态页想展示"小镇里 NPC 怎么想"，这五个问题 + 概率分布是现成的提问模板；它的 `docs/12-system-one-decider.md` 是把 LLM 决策改造成 System One 决策的完整方法论。

**③ jevtown.com（Beat the AI）**
- 已从"千人 Jev 小镇"转型为对决游戏：对手在玩家出手**前**亮出预测（"你 Strike 之后 5 次里 4 次 Block"），着法先行封存、可验证，Reader 是纯代码的习惯统计器——**今天游戏里所有预测都不花模型钱**。
- 值得抄的产品手法：预注册实验设计（2026-09-26 公开）、"不分享数据玩法完全一致"的 opting 设计、人类 vs AI 每日计分板、每日一 boss 全网同题。
- 对我们的启示：**"AI 猜你 → 你证明它猜错"的对抗框架**是零成本静态可做的玩法（纯统计无需 API），适合作为静态页的互动模块。

---

## 四、落到目标：部署在 CF Pages 的静态页面

### 4.1 平台现状（2026-09）

- Cloudflare **Pages 仍完全可用**：Git 集成或 `npx wrangler pages deploy <目录>`，免费档**无限站点、无限带宽、每月 500 次构建**、自动 SSL、`_headers`/`_redirects`、自定义域名。本次检索未发现 Pages 停服迹象，但官方文档已把新特性集中在 **Workers + static assets**，并明确"新静态/SPA/全栈项目建议用 Workers"。
- 判断：**目标字面是"cf page 上的静态页面"→ 用 Cloudflare Pages 部署没有问题**；若将来要加 API（Jev 代理），可走 Pages Functions 原地升级，或按参考仓库迁移到 Workers assets。两者配置高度相似（wrangler 同族）。

### 4.2 关键洞察：参考仓库自己就示范了"纯静态"玩法

jevtown 首页的开场示例（"一条 iPhone 帖子两种写法"）就是**从 `public/examples/iphone.json` 回放两份已保存的检查结果**——不调任何 API，全部在浏览器里用 `shared/` 引擎渲染出地图、计数、人群声音。这直接给出静态页的可行路径：

> **用 `npm run check`（本地、自己的 key）预先跑若干次检查 → 结果存成 JSON → 静态站点浏览器端回放。**

### 4.3 三档方案

| 方案 | 内容 | 依赖 | 成本 |
|---|---|---|---|
| **A. 纯静态回放展示站（推荐起步）** | 预跑 N 份检查（不同文本类型：帖子/商品/标题、好文案 vs 翻车文案），JSON 进仓库；浏览器端渲染：100×100 传播地图、波次漏斗、分组统计、人格引语、版本对比 | 只需 Cloudflare Pages + 一次性少量 Jev 费用（一份全文传播检查约 $0.1） | 托管 $0，运行 $0 |
| **B. 静态 + BYOK 互动** | 在 A 基础上加"输入你的文本"：浏览器直连 OpenRouter Decisions API（用户自填 key，`shared/jev.js` 本身可跑在浏览器）；或加一个 Pages Functions 代理（平台 key，服务端持有） | Pages + Functions（仍可同一项目部署） | 谁的 key 谁付钱；一次检查 $0.01~0.10 |
| **C. 完整复刻（Worker + D1）** | 按参考仓库原样部署：API、波次、居民、MCP | Worker + D1 + secret（超出"静态页面"范围，列为后续可选） | 免费档内限额可控（vars 里改） |

Cloudflare 原生加分项：Workers AI 上有 `@cf/typesafe/jev`（见本工作区 `jev_model_memory.md` §五），方案 B 若用 Pages Functions + Workers AI 绑定，可以完全不依赖 TypeSafe/OpenRouter 账号。

### 4.4 可直接复用的代码清单（均为 MIT）

| 文件 | 作用 | 静态页用法 |
|---|---|---|
| `public/shared/rng.js` | FNV-1a + mulberry32 种子随机 | 原样复用 |
| `public/shared/personas.js` | `persona(pool,id)` 确定性人格 + `personaLine()` | 原样复用；中文站可仿造 `personaLine` 输出中文行 + 中文词表（仿 `vocab.js`/`build-crowd.js` 做自己的 `crowd-zh.bin`） |
| `public/shared/feed.js` `summary.js` | 波次规则、按字节统计 | 回放渲染直接用 |
| `public/shared/presets.js` `requests.js` | 对 Jev 的问题原文（60 Score + 7 Noul + Choice 模板） | 自跑检查 / 方案 B 直接引用 |
| `public/shared/jev.js` | 双 provider 客户端（重试/退避/并发闸） | 方案 B 浏览器侧或 Functions 侧复用 |
| `public/grid.js` | 100×100 地图渲染（无框架 canvas） | 原样复用 |
| `public/examples/iphone.json` | 回放数据样例 | 数据格式模板 |
| `scripts/check.js` | 终端跑检查（产出回放数据） | 本地生产数据的工具 |

### 4.5 注意点

- **审核七问必须带上**：复刻任何"公开发布文本→人群反应"的功能时，0.5/0.85 两道阈值是原站的内容安全设计，应保留。
- **预算护栏**：任何真实调用路径都要有日限额/波次上限（抄 `CROWD_*` vars + MCP 的双护栏设计）。
- **密钥永不进前端**：原仓库为此把所有 Jev 调用放在 Worker，MCP 只走 stdio；方案 A 天然无此问题，方案 B 的 BYOK 要明示用户 key 由浏览器直发。
- **确定性即卖点**：种子抽样（人格 id + 版本号）让回放可复现，也让"同一受众看两个版本"公平——这是这套设计里最值得保持的工程纪律。
- 数字口径：上文成本/性能数字来自作者 README 与 measurements.md 的自测，非第三方复核。

---

## 五、建议的 MVP 范围（下一步）

1. **定主题**：建议做"中文小镇版受众模拟回放"——沿用 100×100 网格与确定性人格，把词表换成中文职业/城市/兴趣（`build-crowd.js` 管线现成）。
2. **生产数据**：用 `scripts/check.js` + 自己的 OpenRouter key（`typesafe/jev-1.13`）预跑 3~5 份对比性强的检查（例如同一商品帖"诚恳版 vs 夸张版"），JSON 存 `public/examples/`。
3. **静态站骨架**：单页 `index.html` + `app.js` + `grid.js`（复用），展示：传播地图动画、波次漏斗（600/1500/3000/10000）、分组反应条、代表性人格引语、两版本并排对比。
4. **部署**：GitHub 仓库 → Cloudflare Pages Git 集成（构建命令留空、输出目录 `/`（或 `public`）），或 `npx wrangler pages deploy public`。自定义域名可选。
5. **二期可选**：BYOK 互动框（OpenRouter 直连）或 Pages Functions + `@cf/typesafe/jev`；再往后才是完整 Worker+D1 复刻。

---

## 六、附录

### 6.1 原始抓取材料（本文件夹 `_research_raw/`）

| 文件 | 内容 |
|---|---|
| `gj_README.md` 等 `gj_*` | gaborishka/jevtown：README、wrangler.jsonc、package.json、.env.example、worker/index.js、worker/town.js、public/shared/jev.js、personas.js、rng.js、measurements.md、index.html、app.js |
| `demo_*` | NevaMind-AI/JevTown 演示分支：docs/12-system-one-decider.md、docs/09-agent-loop.md、agent/decideJev.ts、server/model/jev.ts、llm.ts、.env.demo |
| `AGENTS.md` `ROADMAP.md` `vite.config.ts` `vercel.json` `tree.json` | NevaMind-AI/JevTown 主分支（中文协作约定、余时遗物路线图） |
| `awesome_jev_yibie.md` `awesome_jev_cobanov.md` | 两个 awesome-jev 策展列表全文（Jevtown 条目见文中引用） |

### 6.2 在线来源

- 主参考仓库：https://github.com/gaborishka/jevtown · 线上：https://jevtown.ivanhabor.com · 30 秒视频：https://www.youtube.com/watch?v=Ktm2qwW7JAo · Product Hunt：https://www.producthunt.com/products/jevtown
- 同名项目②：https://github.com/NevaMind-AI/JevTown · 游戏文档站：https://afterglow.xnnehang.top/
- 同名项目③：https://jevtown.com/ · https://play.jevtown.com · 实验室档案：https://jevtown.com/lab
- 策展列表：https://github.com/yibie/awesome-jev · https://github.com/cobanov/awesome-jev
- Jev 模型背景：https://typesafe.ai · 文档 https://docs.typesafe.ai/ · OpenRouter Decisions API https://openrouter.ai
- Cloudflare Pages：https://developers.cloudflare.com/pages/ · Workers 静态资产与迁移指南：https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
- 本工作区背景：《JEV 模型调研记忆》`../jev_model_memory.md`（含 Workers AI `@cf/typesafe/jev` 接入、定价与决策范式）
