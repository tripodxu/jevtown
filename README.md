# Jevtown 中文小镇

**由 TypeSafe [Jev](https://typesafe.ai)（System One 决策模型）驱动**：人们写，一万个 AI 人格来读。发一段文字，小镇在几秒内给出反应——谁停下、谁点赞、谁反感、谁划走。每一个反应都是 Jev 对类型化问题返回的概率，模型不写一个字；本页所有数字都出自它的判定。

基于 [gaborishka/jevtown](https://github.com/gaborishka/jevtown)（MIT）的引擎与 Worker 架构改造的中文小镇版：**一个 Cloudflare Worker（API）+ D1（存储）+ 无框架静态前端（assets）**。产品调研见 [docs/research/Jevtown调研报告.md](./docs/research/Jevtown调研报告.md)，实施计划见 [docs/superpowers/plans/](./docs/superpowers/plans/)。

> 🤖 **给 agent**：先读 [AGENTS.md](./AGENTS.md)（入口 + 分层阅读协议），文档全集索引在 [docs/README.md](./docs/README.md)，项目记忆在 [docs/MEMORY.md](./docs/MEMORY.md)（最新在上）。不需要全量阅读仓库。

> **当前状态：本地开发，未上线。** 不填 key 全流程可玩（mock 模式，零花费）；填自己的 key 即刻切真实模型。

---

## 快速开始

需要 Node.js 22+。

```bash
npm install
npm run dev        # 应用本地 D1 迁移并启动 → http://localhost:5191
```

打开页面：**输入框就在首屏**——选类型（帖子/闲置转让/商品文案/标题）、写文字、点"让小镇来读"。下面紧挨着的两份存档示例只是回放演示，仅供参考。

### 填入你的 Jev key（可选）

页面右上角 **"Key…" 按钮**：

1. 通道选 `TypeSafe 官方 API` 或 `OpenRouter Decisions API`
2. 粘贴你的 key（TypeSafe 的 `apikey_…` 或 OpenRouter 的 `sk-or-…`）
3. 保存后顶栏出现 `BYOK · typesafe` 徽章，下一次检查就走真实模型

- key 只存在**本浏览器 localStorage**，随每个 API 请求头发给本 Worker 使用，不落库不打日志；不填或选 mock 时走离线假答案（按文本特征 + 人格属性算出的确定性概率，小镇样貌真实但不花钱）。
- 正式部署请改用 Worker secret（`npx wrangler secret put TYPESAFE_API_KEY`），页面上就不用填了。
- 真实花费量级：单波 600 人约 $0.01–0.02，全城 1 万人约 $0.10–0.15（实测记录见 [docs/research/real-api-report.md](./docs/research/real-api-report.md)）。

### 终端直跑（不经过站点）

```bash
npm run check -- --preset listing "出 iPhone 13，128G，电池 86%，无维修，1400 元，可小刀，包邮，联系我"
npm run check -- --preset post --max-waves 2 "我为什么把每周例会砍成了 15 分钟"
```

摘要打印 Jev 调用次数与模型耗时；完整结果（含决策样本）存到 `output/checks/`。密钥读 `.env.local`（模板 `.env.example`）；没有 key 或 `MOCK=1` 自动走 mock。

### 测试

```bash
npm test    # 57 个用例：引擎单测 + Worker 集成（unstable_dev）+ 图谱/地图/增量统计纯函数，mock 通道，不花钱
```

---

## 每次检查产出什么

结果页是一份带锚点目录的完整报告，全部由 Jev 的真实判定构成：

- **实时监控（检查进行中）**：地图随 Jev 每判完一批实时点亮；三张动态图——判定吞吐心电图（人/秒，CPU 监控风格滚动曲线）、模型耗时曲线（ms/请求）、态度占比堆叠图（乐见/中性/反感占已判定人数的比例随时间发展，覆盖人数实时读出）；监控表随时间滚动追加每次调用（时刻 / 阶段 / 进度 / 耗时 / tokens / 累计花费），波次收束单独成行；完成后自动交给完整报告。
- **总览**：Jev 逐格判定数、停下/乐见/反感计数。
- **Jev 调用报告**：分阶段的请求数 / tokens / 花费 / 模型耗时条形图（开局打分 → 各波次 → 追问 → 收尾提问）。
- **Jev 的决策现场**：抽样 10 例真实问句——Jev 读到的英文人格原句、被问的问题、它返回的概率分布，以及最终判定（高亮）。
- **传播波次与情绪轨迹**：波次漏斗（每波到达人数 + 情绪）+ 跨波情绪折线。
- **反应分布**：每种反应的人数与占比条形图，颜色与地图图例同源。
- **小镇地图**：100×100 格，一格一人格，悬停看档案与"Jev 判定"。
- **分组分析**：谁停下/谁乐见/谁反感，显著高于全城的分组 + 提升倍数（1.6×）。
- **小镇在说**：收尾提问的回答分布（为什么划走 / 什么让他们停下 / 会怎么评论）。
- **追问阶段**：闲置帖 = 买家最常问卖家的问题排行；商品帖 = 价格需求曲线（累计买家 + 收入最高定价）。
- **人格声音**：反应者卡片，默认折叠 24 条，可展开全部。

一次检查的内部流程：`POST /api/check`（一个请求同时完成约 55 类人群 Score 打分 + 7 道审核是非题 + 文本解读，0.5 不进公共流 / 0.85 拒发）→ `GET /api/batch`（每批 100 人、每人一道 Choice 题）→ `POST /api/wave`（收波算情绪，净情绪 ≥0.1 才传下一波：600 → 1500 → 3000 → 其余）→ 收尾提问 → `GET /api/post/:id`（报告与图谱的数据源）。限额是 `wrangler.jsonc` 明文变量：每 IP 每日检查数 / 全站日预算 / 最大波数，对 `/api/check` 与 `/api/version` 双路生效。

## 主题

顶栏四个分段按钮自由切换视觉世界：**夜巡**（默认，墨色夜城）、**公报**（米纸宋体）、**仪器**（冷灰精密）、**经典**（第一版配色）。选择存 localStorage，地图与图谱随主题重绘；全部由 `public/styles.css` 的 CSS 变量令牌驱动，新增主题 = 加一组令牌 + 顶栏一个按钮。

## 路线图

- [x] Step 1 · 核心闭环（引擎 + Worker + D1 + 前端 + mock 全流程）
- [x] Step 2 · 功能打磨（追问 / 版本对比 / 示例回放）
- [x] UI 全量打磨（四主题 + 图谱 + 调用报告 + 决策现场 + Jev 驱动身份）
- [x] 审计轮（人群缓存、画布泄漏、限额一致性、移动端溢出、常量单源、懒加载、voices 折叠）
- [ ] Step 3 · 真实模型联调扩展（measurements 风格成本报告、网关保真度复核）
- [ ] Step 4 · 上线准备（人格打包管线省 CPU、`wrangler d1 create` + secret 部署；收波 CAS 锁、`/api/batch` 作者令牌、observability 开启已于 M2/M3 落地，见 [docs/MEMORY.md](./docs/MEMORY.md)）
- [ ] Step 5 · 生态（可选）：MCP 服务器（check_text / compare_texts）、居民系统 /me、分享卡片

## 许可

MIT。引擎部分来自 [gaborishka/jevtown](https://github.com/gaborishka/jevtown)（MIT，© Ivan Habor 及上游贡献者），其思路谱系源于 [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town)；中文词表、mock、主题与图谱、Worker/前端改写部分版权归本项目。
