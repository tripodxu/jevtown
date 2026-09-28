# modules/worker-api · Worker、API 与 D1

> 适合：改 API、D1、限额、记账、BYOK 的 agent。
> 路径：`worker/index.js`（单文件约 550 行）+ `migrations/` + `wrangler.jsonc`。

## 路由表

| 方法 | 路径 | 函数 | 说明 |
|---|---|---|---|
| POST | `/api/check` | `runCheck` | 开局：打分 + 审核 + 文本解读；写 posts/versions |
| POST | `/api/version` | `runVersion` | 同帖新版本（版本对比）；同样受限额 |
| GET | `/api/batch` | `runBatch` | 每批 100 人一道 Choice 题；前端可并发多批 |
| POST | `/api/wave` | `closeWave` | 收波：算情绪、决定是否传下一波、写 batches |
| GET | `/api/post/:id` | `showPost` | 报告数据源（reactions + versions + 调用报告 + 决策样本） |
| GET | `/api/feed` | `listFeed` | 公共流列表 |

非 `/api/*` 请求直接 `env.ASSETS.fetch`——页面/样式/脚本走边缘 assets，**不计 Worker 请求**。

## 横切关注点（改任何路由前先读）

1. **限额**：`spentToday(db, day)` 按 `batches` 汇总当日花费；`CROWD_DAILY_LIMIT`
   每 IP 计数（`idx_posts_day_ip`）。限额对 `/api/check` 与 `/api/version` **双路生效**，
   一致性有集成测试守护——改一路必须同步改另一路并补用例。
2. **记账**：每个 Jev 调用落 `batches(stage,n,usd,tokens,ms,day)`；`versions.usd/tokens`
   累加。stage 取值：`opening` / `wave<n>` / `ask`。
   ⚠️ 历史坑：收尾提问花费曾漏记进 `versions.usd`（已修复，见 [MEMORY.md](../MEMORY.md)）。
3. **BYOK**：`providerOf(env, request)` 按请求头 `x-je-*`（页面 key）优先于 env；
   key 只透传，不落库不打日志。
4. **人群缓存**：`crowdOf(pool)` isolate 级缓存 10,000 人格，避免每次检查重建。

## D1 schema（migrations 只增不改）

| 表 | 主键 | 要点 |
|---|---|---|
| `posts` | `id` | state: running/done/blocked；`day`+`ip` 供限额索引 |
| `versions` | `(post, number)` | scores/checks/unlisted/blocked/plan/said/follow_up/prices/decisions 均为 JSON 列；`usd`/`tokens`/`provider` |
| `reactions` | `(post, number, id)` | `wave` 是人格所在波次；`reaction` 为预设反应 id |
| `batches` | `(post, number, stage, n)` | 花费流水；`ms` 为模型耗时（报告分阶段耗时条） |

迁移序列：0001 建表 → 0002 follow_up/prices → 0003 batches.ms + versions.provider →
0004 versions.decisions（决策样本）。

## 契约边界（多 agent 场景）

以下属于**跨 agent 共享契约**，变更必须走任务卡并记录 [MEMORY.md](../MEMORY.md)：

- API 请求/响应 JSON 形状（前端 `render.js` 与终端 `scripts/check.js` 都消费）；
- `versions`/`batches` 列语义；
- 限额变量名与双路行为。

## 本地调试

```bash
npm run dev     # 本地 D1 + Worker，http://localhost:5191
# 查看本地库：npx wrangler d1 execute jevtown --local --command "SELECT * FROM posts LIMIT 5"
```
