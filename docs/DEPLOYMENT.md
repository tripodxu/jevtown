# DEPLOYMENT · 部署指南

> 当前状态：**本地开发，未上线**。本文是上线清单，按顺序执行。

## 前置

- Node.js 22+，`npm install` 完成。
- Cloudflare 账号已登录 wrangler（`npx wrangler login`）。

## 上线步骤

```bash
# 1. 建 D1（会打印 database_id，填回 wrangler.jsonc 的 d1_databases[0].database_id）
npx wrangler d1 create jevtown

# 2. 应用迁移到远程
npm run deploy    # = wrangler d1 migrations apply jevtown --remote && wrangler deploy
```

## 密钥（三选一，按场景）

| 方式 | 命令 | 适用 |
|---|---|---|
| 本地开发 | `.env.local` 放 `TYPESAFE_API_KEY`（已 gitignore） | `npm run check` |
| 本地站点 | `.dev.vars` 放 key 并设 `JEV_PROVIDER` | `npm run dev` |
| 生产 | `npx wrangler secret put TYPESAFE_API_KEY` | 部署后全站可用，用户无需填 key |

- 不配任何 key ⇒ 自动 mock，全流程可玩、零花费。
- BYOK（用户自带 key）只存浏览器 localStorage，随请求头发给本 Worker，不落库不打日志。

## 上线前检查清单

- [ ] `wrangler.jsonc`：`database_id` 已替换真实值（当前是占位 `00000000-…`）——**上线阻塞项**。
- [ ] 限额三变量按运营预期调整：`CROWD_DAILY_LIMIT` / `CROWD_DAILY_BUDGET_USD` /
      `CROWD_MAX_WAVES`（现值 20 / $5 / 4）。
- [ ] `observability.enabled` 建议改 `true`（当前 false）。
- [ ] `npm test` 全绿。
- [ ] 用真实 key 跑一次 `npm run check` 抽查成本口径（预期单波 600 人 $0.01–0.02）。
- [ ] 已知待办（来自 README 路线图 Step 4）：`/api/batch` 无身份校验（作者 cookie）、
      收波 CAS 锁、人格打包管线省 CPU——上线前至少评估前两项。
- [ ] observability 已开启（`wrangler.jsonc`，M3 已改 true，部署前确认未被回改）。

## 成本口径（实测，2026-09-28）

| 范围 | 花费 | 耗时 |
|---|---|---|
| 单波 600 人 | ≈ $0.0158 | ≈ 5s |
| 2,100 人（2 波） | ≈ $0.0323 | ≈ 6.3s |
| 全城 10,000 人（估） | ≈ $0.10–0.15 | — |

明细与观察见 [research/real-api-report.md](research/real-api-report.md)。
限额变量是全站熔断的第一道闸；`batches` 表按 day 汇总即当日真实花费。

## 回滚

- 代码回滚：重新部署上一个 commit（`wrangler deploy`）。
- 数据：D1 无自动备份配置，重要数据定期 `npx wrangler d1 export`。
