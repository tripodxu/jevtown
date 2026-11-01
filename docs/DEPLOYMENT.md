# DEPLOYMENT · 部署指南

> 当前状态：**已上线（2026-09-30）** → https://jevtown-cn.xd04040212.workers.dev
> 最新部署：**2026-11-01**，worker 版本 `99dfa4c7`（默认通道切站方中转 Logicc + 传播闸
> 强度门槛重标定）。自定义域：**https://jevtown.logicc.top**（2026-10-28 起可用，线上
> 验证一律走它——本机网络对 `*.workers.dev` 不通，见下文冒烟记录）。
> 本文记录已执行的步骤与后续运维清单。

## 已执行（2026-09-30）

```bash
npx wrangler d1 create jevtown        # database_id adccbaa8-… 已写入 wrangler.jsonc
npx wrangler d1 migrations apply jevtown --remote   # 0001–0007 全部应用
npx wrangler secret put TYPESAFE_API_KEY            # 站方兜底 key（正常流量不走它）
npx wrangler deploy                   # → https://jevtown-cn.xd04040212.workers.dev
```

- **计费模型（R28 决策 + 2026-11-01 更新）**：默认通道 = **站方自建中转 Logicc**
  （`jev.logicc.top/v1/systemone`，System One 形状与 TypeSafe 相同，`jev-1.13.0`，认证流量），
  key 由站方以 Worker secret **`LOGICC_API_KEY`** 持有——这是 R28「零 secret」政策的
  一次主动调整：2026-11-01 实测 **Zen 免费匿名档已死**（451 "Endpoint is unavailable"，
  端点消失，本机 IP 同样）、**TypeSafe 官方对本地区域封锁**（451 "not available in your
  region"），两条真实通道全断，访客自建了干净出口中转，站方持 key 是用户明确的决定。
  BYOK 三条官方通道照旧（访客自带、只存访客浏览器）；mock 是显式选择的离线演示。
  滥用面由每 IP 日闸（`CHECK_DAILY_LIMIT`）接管。请求一律从 Worker 侧发。
  中转记账暂按 TypeSafe 牌价（`$0.042/M input tokens`；本地实测 600 人 ≈ $0.0057，
  与牌价口径一致，若中转另有计费改 `jev.js` 的 `usd`）。

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
- [x] **Logicc 通道上线验证（2026-11-01，版本 `99dfa4c7`）**：`wrangler secret put
      LOGICC_API_KEY` ✓（`secret list` 可见）；本地直连 600 人实测 200（$0.0057）；
      线上内容核对——首页页脚含「默认通道为站方中转 Logicc」、`/shared/jev.js` 含
      `jev.logicc.top/v1/systemone`、设置面板含 `value="logicc"`；线上端到端——开局
      `provider = logicc`、600 人批次判定完成、平淡帖 `mood 0 → endedBy: gate`
      （强度闸区分度线上复验 ✓）。
- [x] **D1 写配额事故与护栏（2026-11-01，版本 `9ce73760` 起）**：当日 D1 写入 13.7 万行
      超免费档 10 万/日（`npx wrangler d1 insights` 实测），98% 来自 reactions 逐人行
      INSERT（含 `idx_reactions_wave` 索引，每人 ≈ 3 行计量），约 4.5 万人判定——其中
      ~4.3 万是当日在正式站跑的端到端验证（阶梯 6 帖 + 冒烟）。**验证纪律（由此立）**：
      真通道全流程验证一律跑本地——`.dev.vars` 临时改 `JEV_PROVIDER=logicc` 并加
      `LOGICC_API_KEY=<key>`，`npm run dev` 后照常驱动，判定走真实 Jev、落库在本地
      miniflare D1，零线上配额；用完改回 `mock`。正式站只做 ≤1 波的小冒烟。
      护栏：`CHECK_DAILY_LIMIT` 生产 20 → 10（wrangler.jsonc，注释含最坏情形算术）。
      结构性根治**同日落地**（reactions 逐人行 → 按批写字节进 versions.looks）：本地实测
      满城帖 reactions 行增量 = 0，读路径全面改 looks × plan.history 推导，旧行查询保留
      为旧帖兼容——详见 MEMORY 同日条目第 4 点。
- [ ] 定期 `npx wrangler d1 export`（D1 无自动备份）。

## 密钥（按场景）

| 方式 | 位置 | 适用 |
|---|---|---|
| 站方 secret | `LOGICC_API_KEY`（`wrangler secret put`，2026-11-01 起） | **站点默认通道（Logicc 中转）的 key，绝不入库** |
| 访客 BYOK | 浏览器 localStorage（页面 Key… 弹窗） | 三条官方通道任选（typesafe / openrouter / opencode），只存访客自己的浏览器 |
| 本地 CLI | `.env.local` 放 `TYPESAFE_API_KEY` / `OPENROUTER_API_KEY` / `OPENCODE_API_KEY` / `LOGICC_API_KEY`（gitignored） | `npm run check`、`scripts/probe-waves.js --provider logicc` |

- BYOK key 只存浏览器 localStorage，随请求头发给本 Worker，不落库不打日志；站方只持有
  默认中转这一把 key（撤销它 = 访客只能 BYOK 或 mock）。

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
