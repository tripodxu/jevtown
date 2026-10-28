# DEPLOYMENT · 部署指南

> 当前状态：**已上线（2026-09-30）** → https://jevtown-cn.xd04040212.workers.dev
> 最新部署：**2026-10-28**，worker 版本 `afecbe7e`（提交 `41bf2ea`，C 方案新精密仪器）。
> 自定义域：**https://jevtown.logicc.top**（2026-10-28 起可用，线上验证一律走它——
> 本机网络对 `*.workers.dev` 不通，见下文冒烟记录）。
> 本文记录已执行的步骤与后续运维清单。

## 已执行（2026-09-30）

```bash
npx wrangler d1 create jevtown        # database_id adccbaa8-… 已写入 wrangler.jsonc
npx wrangler d1 migrations apply jevtown --remote   # 0001–0007 全部应用
npx wrangler secret put TYPESAFE_API_KEY            # 站方兜底 key（正常流量不走它）
npx wrangler deploy                   # → https://jevtown-cn.xd04040212.workers.dev
```

- **计费模型（R28 决策 + 2026-10-07 两次更新）**：**站方零 secret**——真实通道的 key 全部
  由访客自带（BYOK，三条通道任选、只存访客自己的浏览器）；访客不填 key 时兜底走
  OpenCode Zen 匿名免费档（`jev-1.13-free`，匿名可用、零花费，**不需要站方任何配置**）。
  mock 是显式选择的离线演示。R28 拆闸拆的是付费 key 的钱包风险；滥用面由每 IP 日闸
  （`CHECK_DAILY_LIMIT`，2026-10-06 回归）接管。请求一律从 Worker 侧发——Zen 不开 CORS
  （实测），Worker 出口是 Cloudflare 共享 IP 池。

⚠️ **出口限流约束（2026-10-07 上线实测，改架构前先读）**：Zen 对 Cloudflare Worker 的
**共享出口 IP 段持续 429**（Worker 侧 5 连重试 + 客户端 6 轮退避都打不穿），而同一时刻
本机/住宅 IP 带 key、不带 key 都是 200——限流按来源 IP/网段判，与 key 无关（BYOK opencode
经 Worker 同被拦）。当前真实可用性：**免费默认通道 = 尽力而为**（时段好时能通，失败时
前端退避 90s 后给出「填自己的 key」出路提示）；**终端 CLI 无 key 可用**（`npm run check`
走本机网络，畅通）；**BYOK TypeSafe/OpenRouter 未测**（它们是独立限流方，可能不受此影响，
访客自助验证）；BYOK opencode 经 Worker 与匿名通道同命运。根治需要干净出口（独立小代理/
VPS 中转），未实施。
- `TYPESAFE_API_KEY` secret 仅作兜底（`JEV_PROVIDER=mock` 时实际不消费）；撤销它
  不影响 BYOK 用户。

## 后续待办（按优先级）

- [x] **线上冒烟测试（2026-10-28 走 jevtown.logicc.top）**：首页 200、`/api/feed` 200
      （返回 `{"posts":[]}`）；首页 HTML 引用本次部署新上传的 `charts.js`，确认跑到最新
      版本 `8d16c629`。**注意：本机对 `*.workers.dev` 不可用**——代理 CONNECT 返回 502、
      绕代理直连也超时，属本机网络路径问题，线上验证一律走 jevtown.logicc.top。
      仍未验证：不填 key 的默认通道检查跑通（`provider` 应为 `opencode`、花费 $0）、
      BYOK 真实检查跑通全流程。
- [x] **闸退役后的 `npm test` 全量绿**（2026-10-28 实跑 217/217 绿）。
- [x] 自定义域 **jevtown.logicc.top**（2026-10-28 验证可用）。
- [x] **前端现代化第二轮上线验证（2026-10-28，版本 `3664b921`）**：首页 200、
      `/api/feed` 200（返回 `{"posts":[]}`）；新拆出的三个模块 `/dom.js`、`/monitor.js`、
      `/tokens.js` 均 200 且首页 HTML 已引用；线上 `styles.css` 含 9 处 `:where(` 与
      新增的 `--fs-hero` 令牌，确认跑到本次部署。
- [x] **前端现代化第三轮 C 方案上线验证（2026-10-28，版本 `afecbe7e`，提交 `41bf2ea`）**：
      自定义域逐项核对 14 项全过——首页 200 且含首帧 `data-theme="instrument"`、
      `#advancedOptions`、`.live-observation`；`/styles.css` 含第 12 节 Instrument 现代层、
      `[data-report-mode="quick"] [data-report-detail]` 折叠规则与 `--btn-bg: #255bd6`；
      `/render.js` 含 `report-toolbar` 与 `REPORT_VIEW_ZH`；`/shared/labels.js` 含
      `REPORT_VIEW_ZH`；`/theme.js` 兜底 `instrument`；`/app.js` 已含 `placeholder` 修复行；
      `/api/feed` 200（`{"posts":[]}`）；首屏 26 个 `modulepreload` 全部 200。
      **仍未验证**：真实检查全流程（默认通道 `opencode` 是否 200、花费 $0）与浏览器目视。
- [ ] 定期 `npx wrangler d1 export`（D1 无自动备份）。

## 密钥（按场景）

| 方式 | 位置 | 适用 |
|---|---|---|
| 访客 BYOK | 浏览器 localStorage（页面 Key… 弹窗） | **全部真实通道的唯一 key 来源（三条通道任选，含 opencode）** |
| 本地 CLI | `.env.local` 放 `TYPESAFE_API_KEY` / `OPENROUTER_API_KEY` / `OPENCODE_API_KEY`（gitignored） | `npm run check` |
| ~~站方 secret~~ | — | **零 secret**：TYPESAFE_API_KEY 已于 2026-10-07 删除（`wrangler secret list` = []），站方不再持有任何 key |

- BYOK key 只存浏览器 localStorage，随请求头发给本 Worker，不落库不打日志；站方零 secret，
  没有任何 key 需要在 Cloudflare 侧配置。

## 上线后检查清单（每次重大变更后）

- [x] `npm run lint` ✓ 且 `npm test` 全绿（mock 通道，不花钱）。（2026-10-28 ✓，219/219，
      lint 58 文件 + 预载 26 项）
- [x] 线上首页与 `/api/feed` 200（走 jevtown.logicc.top，2026-10-28）。
- [ ] 用真实 BYOK key 跑一次检查抽查成本口径（预期单波 600 人 $0.01–0.02）；
      默认通道（Zen 免费档）抽查花费应为 $0。（未做）

## 成本口径（实测，2026-09-28）

| 范围 | 花费 | 耗时 |
|---|---|---|
| 单波 600 人 | ≈ $0.0158 | ≈ 5s |
| 2,100 人（2 波） | ≈ $0.0323 | ≈ 6.3s |
| 全城 10,000 人（估） | ≈ $0.10–0.15 | — |

明细与观察见 [research/real-api-report.md](research/real-api-report.md)。
`batches` 表按 day 汇总即当日真实花费（R10 起账面精度 4 位小数）。

## 部署纪律（2026-10-28 实测教训）

`wrangler deploy` 的静态资源是**按内容哈希增量上传**的：第三轮这次部署只报了 2 个新资产
（`theme.js`、`shared/labels.js`），而 `index.html` / `styles.css` / `render.js` / `app.js`
明明都改过——它们的新内容此前已进过资产桶。**从上传输出无法判断具体时点**：可能是有人部署过
未提交的工作区状态，也可能是资产桶的增量判定与本地预期不一致（本地 `.wrangler/` 缓存）。
两种情况下结论一样——**上传计数不能当"线上是不是这一版"的证据**。

因此部署前一律：

1. `git status` 必须干净（除 `.workbuddy/`），**只在已提交的工作区上部署**；
2. 部署后按**内容**核对线上（页面里的关键标记串、CSS 里的规则、JS 里的函数名），
   不要只看 worker 版本 ID——资产是增量的，版本号变了不代表你要的那份内容变了。

## 回滚

- 代码回滚：重新部署上一个 commit（`wrangler deploy`）。
- 数据：D1 无自动备份配置，重要数据定期 `npx wrangler d1 export`。
