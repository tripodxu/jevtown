# Jevtown 中文小镇 · 优化实施计划（2026-09-28）

> 本计划只做**规划**，不改代码。所有发现均附代码证据（`文件:行号`）。
> 执行时按「建议执行顺序」逐任务派发（任务卡模板见 `docs/agent/templates/task-card.md`）。

## 一、发现汇总（带证据）

| # | 问题 | 证据 | 影响 | 归属 |
|---|---|---|---|---|
| F1 | 无 CI | 仓库无 `.github/`（`git ls-files .github` 为空） | 41 个测试全靠人肉；agent 推分支无自动验证 | Task 1 |
| F2 | 无 PR 模板 | 同上 | 多 agent 评审无统一抓手 | Task 2 |
| F3 | 任务卡/handoff 落盘目录未定 | `docs/agent/RELAY.md` 只写"任务卡同目录" | 接力协议有歧义，多 agent 实操会乱放 | Task 3 |
| F4 | `/api/batch` 无身份校验、无预算闸 | `worker/index.js:250-299`：仅查 post 存在与 `state='running'`；限额只在 `runCheck`/`runVersion`（`:137`、`:211`） | 知道 post id 即可反复调 batch，每次 100 人真实调用烧钱 | Task 4 |
| F5 | 收波无 CAS 锁 | `worker/index.js:303-339`：先读 `state='running'` 再推进，无原子占位 | 并发 `/api/wave` 双推波次、重复重置 `plan.answered` | Task 5 |
| F6 | `plan.answered` 读-改-写非原子 | `worker/index.js:258-296`：读 start → 写 `answered = start + n`，无版本校验 | 并发 batch 错位；reactions 主键碰撞使整个 D1 batch 报错 | Task 6 |
| F7 | README 偏长、产品向与开发向混排 | `README.md` 100 行，"目录结构/与上游的差异"可被 docs/ 覆盖 | 入口文档负重，违背"最小阅读"原则 | Task 7 |
| F8 | observability 关闭 | `wrangler.jsonc:23` `"enabled": false` | 上线后限额/错误无观测 | Task 8 |
| F9 | `database_id` 为占位符 | `wrangler.jsonc:13` 全零 UUID | 上线必须替换（DEPLOYMENT.md 已列，需设前置门） | Task 8 |
| F10 | 无 lint | `package.json` 无 lint script，仓库无 eslint 配置 | 多 agent 并行风格漂移 | Task 9 |
| F11 | 前端零自动化覆盖 | `public/` 24 个文件，无浏览器测试 | UI 回归靠人工 | Task 10（可选） |
| F12 | 本地限额误伤 | `worker/index.js:133` 本地 IP 恒为 `'local'` | 多人本地联调共享 20 次/日 | Task 11（可选） |

## 二、里程碑

- **M1 工作流地基**（Task 1-3）：不碰运行时，纯增量，可立即合入。
- **M2 安全与正确性**（Task 4-6）：触及 API 主路径，测试驱动，逐任务合入。
- **M3 工程质量**（Task 7-9）：文档与配置。
- **M4 可选增强**（Task 10-11）：按需启动。

---

## Task 1 · CI：push/PR 自动跑测试

- **目标**：任何 push/PR 自动执行 `npm test`，结果可见。
- **步骤**：
  1. 新建 `.github/workflows/test.yml`：`on: [push, pull_request]`，`runs-on: ubuntu-latest`，
     `actions/checkout@v4` + `actions/setup-node@v4`（node 22）+ `npm ci` + `npm test`。
  2. 本地先跑一次 `npm test` 确认基线（当前 41 用例全绿，mock 通道不需要 key）。
- **验收**：push 后 Actions 出现绿色 check；PR 页显示测试 job。
- **注意**：wrangler 的 workerd 二进制随 npm 包分发，`npm ci` 即就绪，无需额外下载步骤。

## Task 2 · PR 模板

- **目标**：多 agent 评审有统一信息结构。
- **步骤**：新建 `.github/pull_request_template.md`，字段与任务卡对齐：
  任务卡 id / 目标一句话 / 拥有文件 / 验收标准逐条对照（含证据）/ 测试结果（tests·pass·fail）/
  遗留与风险 / 是否触碰共享契约（API 形状、D1 列、labels.js、限额双路）。
- **验收**：新建 PR 时模板自动填充；与 `docs/agent/templates/task-card.md` 字段一致。

## Task 3 · 任务卡与 handoff 落盘约定

- **目标**：消除 RELAY.md 的歧义，接力文件有固定家。
- **步骤**：
  1. 约定目录 `docs/agent/tasks/`：
     - 进行中：`docs/agent/tasks/<任务id>-task.md`、`<任务id>-handoff.md`（入库，接力 agent 可读）。
     - 完成后：要点压缩进 `docs/MEMORY.md`（最新置顶），handoff 删除；
       需要审计轨迹的任务由主控显式移入 `docs/agent/tasks/done/`。
  2. 同步修订 `docs/agent/RELAY.md`、`docs/agent/templates/task-card.md`、
     `docs/agent/templates/handoff.md`、`AGENTS.md` 中的路径表述。
- **验收**：四份文档路径表述一致；`docs/agent/tasks/` 目录存在（可放 `.gitkeep`）。

## Task 4 · `/api/batch`（与 `/api/wave`）身份校验 + 预算闸

- **目标**：未授权者无法通过 batch/wave 消耗真实花费；全站日预算对所有计费路由生效。
- **证据**：F4（`worker/index.js:250-299`；限额仅在 `:137`/`:211`）。
- **方案**（二选一，推荐 A）：
  - **A 作者 cookie**：迁移 `0005_author.sql` 给 posts 加 `author TEXT` 列；
    `runCheck` 生成随机 token 写库并 `Set-Cookie: jev_author=<token>; HttpOnly; SameSite=Lax; Path=/`；
    `runBatch`/`closeWave` 校验 cookie 与 `posts.author` 一致，不一致 403。
  - **B 复用 day+ip**：batch/wave 记录发起 IP，仅允许与 check 同一 IP（ NAT/移动网络误伤风险，作备选）。
  - **预算闸（两种方案都做）**：batch/wave 入口调用现成的 `spentToday(db, day)`，
    超过 `CROWD_DAILY_BUDGET_USD` 返回 429（与 check/version 口径一致）。
- **步骤**：
  1. `migrations/0005_author.sql`（只增不改）。
  2. `worker/index.js`：check 写 author + Set-Cookie；batch/wave 校验 + 预算闸。
  3. `test/worker.test.js` 补用例：无 cookie → 403；错误 cookie → 403；作者本人放行；
     超预算 → 429（夹具调低 `CROWD_DAILY_BUDGET_USD` 或直接造 batches 数据）。
  4. `scripts/check.js` 走的是共享引擎直连，不受影响；确认无误。
- **验收**：新用例全绿；本地用真实 key 手动验证"换浏览器打不开别人的检查"。
- **风险**：cookie 校验会让"分享链接给朋友看"失效——若想保留围观，可对 `GET /api/post/:id`
  保持公开，仅写操作（batch/wave）需身份。**建议采用此折中**。

## Task 5 · 收波 CAS 锁

- **目标**：并发 `/api/wave` 只有一个能推进，杜绝双推波次。
- **证据**：F5（`worker/index.js:303-339`）。
- **方案**：函数入口先原子占位——
  `UPDATE posts SET state='closing' WHERE id=? AND state='running'`，用 `meta.changes === 1`
  作为准入，否则 409；函数内所有 plan 更新与最终 state 落库放进同一个 `env.DB.batch(...)`
  （D1 batch 为隐式事务），结束态统一为 `done` 或回到 `running`（下一波）。
- **步骤**：改 `closeWave`；`test/worker.test.js` 增加用例：并发两次 closeWave，
  一次 200、一次 409，且波次只前进一次。
- **验收**：新用例全绿；人工双开标签页同时收波：一次 200、一次 409，波次只前进一次。
- **注意**：`'closing'` 是新 state 值，`showPost`/前端对未知 state 的展示需确认（running/done/blocked 之外的分支）。

## Task 6 · `plan.answered` 原子化

- **目标**：并发 batch 调用不错位、不撞主键。
- **证据**：F6（`worker/index.js:258-296`）。
- **方案**：先原子认领再计算——
  `UPDATE versions SET plan=json_set(plan,'$.answered',json_extract(plan,'$.answered')+100)
   WHERE post=? AND number=? AND json_extract(plan,'$.answered')=?`（D1/SQLite 支持
  `json_extract`/`json_set`），`meta.changes===1` 则用新 answered 作 start，否则 409 让前端重试。
  前端本就是串行调 batch（等返回再发下一批），CAS 只是兜底。
- **验收**：并发 batch 测试：最多一个成功，其余 409；串行流程行为不变（现有集成用例全绿）。

## Task 7 · README 瘦身

- **目标**：README 回到"产品 + 5 分钟上手"，开发细节全部下沉 docs/。
- **步骤**：
  1. 保留：项目是什么、快速开始、BYOK、每次检查产出什么、主题、路线图、许可。
  2. 删除或压缩为指针：「目录结构」表压成 5 行以内指向 `docs/README.md`；
     「与上游的差异」并入 `docs/ARCHITECTURE.md` 末尾（已存在，直接删 README 该节）。
  3. 保留 agent 入口提示框（指向 AGENTS.md）。
- **验收**：被删内容在 docs/ 均有对应落点（逐条核对，无信息丢失）。

## Task 8 · observability 与 database_id 上线门

- **目标**：上线前置项显式化。
- **步骤**：
  1. `wrangler.jsonc`：`observability.enabled` 改 `true`（上线合入，本地开发无感）。
  2. `docs/DEPLOYMENT.md` 检查清单已将两项列入；在 README 路线图 Step 4 标注"上线阻塞项"。
- **验收**：上线演练（`npm run deploy` 到测试账号或 dry-run）前两项打勾。

## Task 9 · 最小 lint

- **目标**：用最低成本拦住语法错误与明显风格问题，防多 agent 漂移。
- **方案**：不引入 eslint 全家桶，先做 `scripts/lint.mjs`：
  遍历 `public/ worker/ scripts/ test/` 的 `.js`，逐个 `node --check`（语法门）；
  另加两条轻规则：无 `console.log` 残留（worker 允许 `console.error`）、无 tab/空格混用。
- **步骤**：脚本 + `package.json` 加 `"lint": "node scripts/lint.mjs"`；CI workfile 追加一步。
- **验收**：`npm run lint` 对当前代码库零告警（或先修后门）。

## Task 10 · （可选）Playwright smoke E2E

- **目标**：前端主链路有最低自动化保障。
- **步骤**：devDependency 加 `playwright`；一个用例：起 `npm run dev` →
  打开首页 → 选预设输入文本 → 点检查 → 等待报告目录出现 → 断言地图 canvas 非空。
- **验收**：CI 中可跑（或标注为手动 job，避免拖慢每次 PR）。

## Task 11 · （可选）本地限额豁免

- **目标**：本地联调不被 20 次/日误伤。
- **方案**：IP 为 `'local'` 时跳过每日限额（或读 `env.CROWD_DAILY_LIMIT`，本地 wrangler 可覆盖为 0）。
- **验收**：本地连续第 21 次检查不再 429；线上行为不变（有测试守护双路一致）。

---

## 三、建议执行顺序

```
M1（Task 1→2→3，可一个 PR 合并，纯增量）
   ↓
M2（Task 4→5→6，每个任务独立分支 + 独立 PR，测试先行；
     Task 4 建议先落"预算闸"再落"身份 cookie"，缩小爆炸半径）
   ↓
M3（Task 7→8→9）
   ↓
M4（Task 10→11，按需）
```

## 四、风险与注意

- **迁移只增不改**：0005 加列不影响存量本地库；本地库需重跑 `npm run dev`（自动 apply）。
- **测试夹具同步**：Task 4/5 改动后，`test/worker.test.js` 与 `test/helper.js` 的现有请求
  需要带 author cookie，属于预期内修改量。
- **CAS 触及收波主路径**：Task 5/6 合入前必须新用例全绿 + 现有 41 用例不回归。
- **CI 首次运行时间**：unstable_dev 集成用例约 20s，整体 job 预计 1-2 分钟，可接受。
- **每个任务合入后**：按 `docs/agent/COLLABORATION.md` 更新 `docs/MEMORY.md`（最新置顶）。
