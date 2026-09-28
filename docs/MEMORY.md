# MEMORY · 项目记忆日志

> **格式约定：最新条目在最上方。** 每条 = 日期 + 标题 + 事实/决策/坑。
> 写事实不写流水账；任务完成后把 handoff 压缩成一条追加到顶部。
> 会话级记忆（用户偏好等）另见 agent 宿主环境的 memory，不混入本文件。

---

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
  引擎 9 文件为上游最小改动，`vocab/labels/mock/bytes/replay` 5 个文件为本项目新写。
- **测试**：`node --test`，41 用例；Worker 集成用 `unstable_dev`；全程 mock 不花钱；
  无浏览器 E2E、无 lint 工具链（靠 CONVENTIONS.md 自律）。
- **已知待办**（README 路线图 Step 4）：`/api/batch` 无身份校验、收波 CAS 锁、
  人格打包管线省 CPU、observability 开启、真实 `database_id` + secret 部署。
