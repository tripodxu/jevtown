# MEMORY · 项目记忆日志

> **格式约定：最新条目在最上方。** 每条 = 日期 + 标题 + 事实/决策/坑。
> 写事实不写流水账；任务完成后把 handoff 压缩成一条追加到顶部。
> 会话级记忆（用户偏好等）另见 agent 宿主环境的 memory，不混入本文件。

---

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
  引擎 9 文件为上游最小改动，`vocab/labels/mock/bytes/replay` 5 个文件为本项目新写。
- **测试**：`node --test`，41 用例；Worker 集成用 `unstable_dev`；全程 mock 不花钱；
  无浏览器 E2E、无 lint 工具链（靠 CONVENTIONS.md 自律）。
- **已知待办**（README 路线图 Step 4）：`/api/batch` 无身份校验、收波 CAS 锁、
  人格打包管线省 CPU、observability 开启、真实 `database_id` + secret 部署。
