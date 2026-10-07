# DEPLOYMENT · 部署指南

> 当前状态：**已上线（2026-09-30）** → https://jevtown-cn.xd04040212.workers.dev
> （预览域；自定义域未配）。本文记录已执行的步骤与后续运维清单。

## 已执行（2026-09-30）

```bash
npx wrangler d1 create jevtown        # database_id adccbaa8-… 已写入 wrangler.jsonc
npx wrangler d1 migrations apply jevtown --remote   # 0001–0007 全部应用
npx wrangler secret put TYPESAFE_API_KEY            # 站方兜底 key（正常流量不走它）
npx wrangler deploy                   # → https://jevtown-cn.xd04040212.workers.dev
```

- **计费模型（R28 决策 + 2026-10-07 更新）**：默认通道 = OpenCode Zen 免费档
  （`jev-1.13-free`，**匿名可用、零花费**）——访客不填 key 就有真实 Jev；也可自填 BYOK key
  （TypeSafe / OpenRouter / Zen，只进浏览器）。站方 key 变为可选：
  `npx wrangler secret put OPENCODE_API_KEY` 把匿名流量升级为认证流量（限流更稳），不配也
  照常工作。R28 拆闸拆的是付费 key 的钱包风险，免费通道无钱包可烧；滥用面由每 IP 日闸
  （`CHECK_DAILY_LIMIT`，2026-10-06 回归）接管。请求一律从 Worker 侧发——Zen 不开 CORS，
  浏览器直发不可行（2026-10-07 实测）。
- `TYPESAFE_API_KEY` secret 仅作兜底（`JEV_PROVIDER=mock` 时实际不消费）；撤销它
  不影响 BYOK 用户。

## 后续待办（按优先级）

- [ ] **线上冒烟测试**：首页 200、`/api/feed` 200、**不填 key 的默认通道检查跑通**（开局
      响应 `provider` 应为 `opencode`、花费 $0）、一次 BYOK 真实检查跑通全流程
      （部署当日 curl 到 workers.dev 超时，未区分网络/部署问题，先 `curl -v` 复核）。
- [ ] **闸退役后的 `npm test` 全量绿**（部署当日集成测试起停缓慢被中断；已验证
      lint ✓ 与 `node --check`，被删的只有三个闸用例）。
- [ ] 自定义域（workers.dev 预览域够用但不易分享）。
- [ ] 定期 `npx wrangler d1 export`（D1 无自动备份）。

## 密钥（按场景）

| 方式 | 位置 | 适用 |
|---|---|---|
| 访客 BYOK | 浏览器 localStorage（页面 Key… 弹窗） | **线上真实检查的唯一路径** |
| 本地 CLI | `.env.local` 放 `TYPESAFE_API_KEY` / `OPENROUTER_API_KEY` / `OPENCODE_API_KEY`（gitignored） | `npm run check` |
| 站方免费档 secret（可选） | `npx wrangler secret put OPENCODE_API_KEY` | 把默认通道的匿名流量升级为认证流量，更稳；不配也照常工作 |
| 站方兜底 secret | `npx wrangler secret put TYPESAFE_API_KEY` | 已设置；仅 `JEV_PROVIDER=typesafe` 时消费 |

- BYOK key 只存浏览器 localStorage，随请求头发给本 Worker，不落库不打日志。

## 上线后检查清单（每次重大变更后）

- [ ] `npm run lint` ✓ 且 `npm test` 全绿（mock 通道，不花钱）。
- [ ] 线上首页与 `/api/feed` 200。
- [ ] 用真实 BYOK key 跑一次检查抽查成本口径（预期单波 600 人 $0.01–0.02）；
      默认通道（Zen 免费档）抽查花费应为 $0。

## 成本口径（实测，2026-09-28）

| 范围 | 花费 | 耗时 |
|---|---|---|
| 单波 600 人 | ≈ $0.0158 | ≈ 5s |
| 2,100 人（2 波） | ≈ $0.0323 | ≈ 6.3s |
| 全城 10,000 人（估） | ≈ $0.10–0.15 | — |

明细与观察见 [research/real-api-report.md](research/real-api-report.md)。
`batches` 表按 day 汇总即当日真实花费（R10 起账面精度 4 位小数）。

## 回滚

- 代码回滚：重新部署上一个 commit（`wrangler deploy`）。
- 数据：D1 无自动备份配置，重要数据定期 `npx wrangler d1 export`。
