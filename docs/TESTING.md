# TESTING · 测试体系

## 运行

```bash
npm test    # node --test "test/*.test.js"
```

当前 **75 个用例**（README 里若写旧数以本文件为准；数量会随用例增加变化，
以 `npm test` 输出 `tests N` 行为准）。全部走 mock 通道，**不花真钱、不需要 key**。

```bash
npm run bench   # 实时监控增量统计的一次性对拍（旧全量重扫 vs 新增量折叠）
```

## 测试布局

| 文件 | 覆盖 |
|---|---|
| `test/rng.test.js` | 哈希随机的确定性与分布 |
| `test/vocab.test.js` | 中文词表完整性（列数、id 唯一、回退） |
| `test/personas.test.js` | 人格网格、人格行生成、pool 回退 |
| `test/feed.test.js` | 波次算法、情绪、收尾聚合 |
| `test/summary.test.js` | `segments()` 预编译版**与旧实现逐字段对拍**（4 种 reach × 2 预设、子集、重复调用、最小样本门） |
| `test/charts.test.js` | 图谱纯函数（漏斗/折线/需求曲线数据） |
| `test/grid.test.js` | 地图绘制：全量 `drawGrid`、增量 `paintDelta`、聚集地形描环，各画了几格（Node 里用 canvas 桩件记录 `fillRect` / `strokeRect`） |
| `test/tally.test.js` | 实时监控增量统计：幂等、改判、未知反应，以及与全量重扫的对拍 |
| `test/spatial.test.js` | 人群地形：成片/零散/无方差/判定不足/确定性/置换收缩/成片格不重叠 |
| `test/bytes.test.js` | base64 小件 |
| `test/pipeline.test.js` | 引擎编排（mock send 端到端） |
| `test/worker.test.js` | Worker 集成（`unstable_dev` 起真实本地 Worker）：全链路、版本、blocked、调用报告/决策样本、每日限额双路 429、**预算闸双路由 429 + 未花超放行**、**作者校验（无头/错令牌 403、带头放行）**、**收波 CAS 不变量**、**批次认领并发不变量** |
| `test/helper.js` | 共享夹具（非测试文件） |

## Worker 集成测试要点

- 用 wrangler 的 `unstable_dev` 在本地起真实 Worker（含 D1 本地库、assets）。
- 已验证的关键行为：每日限额对 `/api/check` **与** `/api/version` 双路 429 一致；
  检查→批次→收波→报告全链路；预算闸对 batch/wave 429；作者令牌 403/放行；
  收波与批次的并发不变量（无 500、波次/人数恰好）。
- 测试用本地 D1，不碰远程；`npm test` 前不需要 `npm run dev`（迁移由测试自行应用）。
- **环境注意**：wrangler dev server 可能把 `Promise.all` 的请求**串行化**——并发类
  用例因此一律断言**不变量**（状态码集合、waves.length = wins + 1、wave0 恰好 600），
  不断言具体哪个请求赢；串行/并发环境下都应通过。
- 造特殊状态的用例用 `execSync('npx wrangler d1 execute jevtown --local --command ...')`
  直接操纵本地库（如预算闸的探测行），必须在 `finally`/文件级 `after` 钩子里清理。

## 写新测试的规则

1. 引擎新函数 → 纯函数单测（同目录 `test/` 加文件或并入现有文件）。
2. Worker 新行为 → 进 `test/worker.test.js`，用 `unstable_dev`，断言状态码 + JSON 形状。
3. **不接真实 Jev**：任何测试不得调用 typesafe/openrouter；需要"真实概率形状"时用
   `shared/mock.js` 或手写夹具。
4. 限额/记账类改动必须带回归用例（这两类都出过只修一边的事故）。

## 未覆盖/已知缺口

- 无自动化浏览器 E2E（前端交互无自动化测试，改动 UI 靠人工核对）。地图绘制的「画了多少格」
  已用 canvas 桩件在 Node 里兜住（`test/grid.test.js`），但端到端点一次「让小镇来读」仍靠人工。
- 无 lint/格式化工具链（约定靠 [CONVENTIONS.md](CONVENTIONS.md) 自律）。
