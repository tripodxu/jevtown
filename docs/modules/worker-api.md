# modules/worker-api · Worker、API 与 D1

> 适合：改 API、D1、限额、记账、BYOK 的 agent。
> 路径：`worker/index.js`（单文件约 800 行）+ `migrations/` + `wrangler.jsonc`。

## 路由表

| 方法 | 路径 | 函数 | 说明 |
|---|---|---|---|
| POST | `/api/check` | `runCheck` | 开局：打分 + 审核 + 文本解读；写 posts/versions；签发作者令牌；受每 IP 日闸约束 |
| POST | `/api/version` | `runVersion` | 同帖新版本（版本对比）；受每 IP 日闸 + 作者校验 |
| GET | `/api/batch` | `runBatch` | 每批 100 人一道 Choice 题；原子认领制，并发只有一个成功 |
| POST | `/api/wave` | `closeWave` | 收波：CAS 占位 + 空波门 → `settleWave` 算情绪定去留 |
| POST | `/api/away` | `runAway` | 逐句承重（消融读数，要花钱）：作者按钮触发，只对 done 的版本算，算过缓存进 versions.away |
| GET | `/api/post/:id` | `showPost` | 报告数据源（reactions + versions + 调用报告 + 决策样本）；**公开读，无身份**。`looks`/`reach` 为逐人反应/波次字节（base64，0 = 没看到）；终笔收波后走快照路径（门槛 `said != null`），running 版逐行现读 |
| GET | `/api/feed` | `listFeed` | 公共流列表；**公开读，无身份** |

非 `/api/*` 请求直接 `env.ASSETS.fetch`——页面/样式/脚本走边缘 assets，**不计 Worker 请求**。

## 横切关注点（改任何路由前先读）

1. **每 IP 日闸（`CHECK_DAILY_LIMIT`）**：`overDailyLimit(env, ip)` 对 `/api/check` 与
   `/api/version` **双路生效**（校验顺序 404 → 409 → 限额 → 作者），按 `posts` 的
   `(ip, day)` 计数（`idx_posts_day_ip`），达到上限 429。它保护的是 **D1 每日写入配额**
   （免费档 10 万行/天，一次全城检查 ≈1 万行 reactions，mock 检查同样落库），不是站方
   钱包——钱包随 R28 退役（BYOK-only，访客花自己的钱）；旧闸两样都护，拆闸时配额那半
   没了保护，2026-10-06 由这道轻闸接管。键是 `CF-Connecting-IP`（边缘注入，伪造不了），
   **环回豁免**：本地 workerd 给无头请求注入 `127.0.0.1`（测试假头原样透传），生产边缘的
   IP 来自真实对端不可能是环回——本地 mock 零门槛与测试不受限由此而来。代码默认 20，
   `CHECK_DAILY_LIMIT` 可覆盖（0 = 不限）。**限额类改动必须双路同步改并补用例**
   （TESTING.md 规则 4，出过只修一边的事故）。
2. **身份（作者令牌）**：`/api/check` 开局生成 `author`（`crypto.randomUUID()`，迁移 0005
   的 `posts.author` 列）并随开局响应返回；`runBatch`/`closeWave`/`runVersion`/
   `runAway` 用 `authorOk(request, post)` 校验请求头 `x-jev-author`，不一致 403。旧帖
   author 为 NULL 一律拒绝（升级瞬间在进行中的检查需重开）。前端：`authHeaders()` 带头；
   `openPost` 从 `localStorage['jevtown.author.<post>']` 读回，feed 点开自己的帖仍能改一版。
3. **CAS 与原子性**：
   - `closeWave` 入口原子占位 `posts.state: running → closing`（`meta.changes` 判赢），
     并发收波只有一个进；claim **之后**做空波门（当前波次零 reactions → 409，防
     `travels([])` 直接收尾跳过整个波次）；推进路径在同一 `env.DB.batch` 内把状态还回
     `running`；失败走 `release()` 回滚（自身失败只记日志）。
   - `runBatch` 用 `json_set(plan,'$.answered', …+N)` 条件递增认领批次，并发只有一个成功、
     其余 409 重试；Jev 失败的条件回滚带 `AND json_extract(...) = start + N`（他人接着认领过
     就放弃回滚，本批跳过，绝不擦掉他人认领复现主键 500）。
   - 已知窗口（罕见、有界）：claim 后进程被杀 ⇒ 该批 100 人跳过（报告 size<asked 可见）；
     空波 order 不可能（`firstWave` 恒 600 人）。
4. **记账**：每个 Jev 调用落 `batches(stage,n,usd,tokens,ms,day)`；`versions.usd/tokens`
   累加。stage 取值：`opening` / `wave<n>` / `followup` / `ask` / `ablate`。
   **usd 账面精度是 4 位小数（`round4`）**：真实单价 ~$0.0015/批，round2 会把每一批抹成
   0——站点低报花费约 3 倍、日预算闸失明（2026-09-30 实地测试抓到，mock 全 0 抓不到）。
   显示口径不受影响（toFixed(3/4)）。
   ⚠️ 历史坑：收尾提问花费曾漏记进 `versions.usd`（已修复，见 [MEMORY.md](../MEMORY.md)）。
5. **BYOK**：`providerOf(env, request)` 按请求头 `x-je-*`（页面 key）优先于 env；
   key 只透传，不落库不打日志。**所有计费路由（含收波的 follow-up/收尾提问）都透传
   request**——曾出现 settleWave 丢头导致收波段静默落 mock 的计费口径事故，已修复。
6. **人群缓存**：`crowdOf(pool)` isolate 级缓存 10,000 人格，避免每次检查重建。
7. **地形缓存**（R7）：`terrainFor(..., frozen)` 按 `post.v` 缓存 `crowdTerrain` 结果——
   反应只在 running 期间增长，**只对非 running（closing/done）的版本写缓存**；running 中的
   报告每请求照算（把旧地形喂给进行中的检查是正确性事故，有集成用例兜住）。版本号只增
   不复用 ⇒ 无失效路径，容量上限 200 条、超出淘汰最早一条。
8. **反应快照（R25 起 + 2026-10-06 写侧增量）**：终笔收波把 `looks`（逐人反应）/`reach`
   （逐人波次）两份字节随 `said` 同批写进 versions，冻结报告读路径从 1 万行降到 1 行。
   推进波次时 `looks` 也随 plan 同批增量落库，`settleWave` 的 `reached` 从上一波快照起步、
   只合并本波 reactions（原先每波全量读）；`looks` 为空才全量读兜底（第一波 = 全量，
   旧帖自愈）。showPost 的快照门槛因此是 `looks && said != null`：running 版的快照只是
   中间态（reach 未写），逐行现读才是实时语义；v2 进行中回看 v1 仍走快照。

## D1 schema（migrations 只增不改）

| 表 | 主键 | 要点 |
|---|---|---|
| `posts` | `id` | state: running / **closing** / done / blocked；`day`+`ip` 供每 IP 日闸计数（`idx_posts_day_ip`）；`author` 作者令牌（0005，旧帖 NULL） |
| `versions` | `(post, number)` | scores/checks/unlisted/blocked/plan/said/follow_up/prices/decisions/away/audience 均为 JSON 列；`usd`/`tokens`/`provider`；`looks`/`reach` 为反应/波次字节（终笔写入，推进期 looks 为增量中间态）；`plan.answered` 的推进全部走条件 UPDATE |
| `reactions` | `(post, number, id)` | `wave` 是人格所在波次；`reaction` 为预设反应 id；主键碰撞是并发错位的信号 |
| `batches` | `(post, number, stage, n)` | 花费流水；`ms` 为模型耗时（报告分阶段耗时条） |

迁移序列：0001 建表 → 0002 follow_up/prices → 0003 batches.ms + versions.provider →
0004 versions.decisions（决策样本）→ 0005 posts.author（作者令牌）→
0006 idx_posts_created（feed 列表索引：此前 ORDER BY created_at 是全表扫描 + 临时 B 树，
EXPLAIN QUERY PLAN 实证）→ 0007 versions.looks/reach（报告快照列，R25）→
0008 versions.away（逐句承重，R32）→ 0009 versions.audience（作者自述受众，R35）。

## 契约边界（多 agent 场景）

以下属于**跨 agent 共享契约**，变更必须走任务卡并记录 [MEMORY.md](../MEMORY.md)：

- API 请求/响应 JSON 形状（前端 `render.js` 与终端 `scripts/check.js` 都消费）——
  含开局响应的 `author` 字段与写路由的 `x-jev-author` 请求头；
- `versions`/`batches`/`posts` 列语义（含 `plan.answered` 的认领制与 `posts.state` 三态）；
- 限额变量名（`CHECK_DAILY_LIMIT`）与 check/version 双路一致行为。

## 本地调试

```bash
npm run dev     # 本地 D1 + Worker，http://localhost:5191
# 查看本地库：npx wrangler d1 execute jevtown --local --command "SELECT * FROM posts LIMIT 5"
```
