# TESTING · 测试体系

## 运行

```bash
npm test    # node --test "test/*.test.js"
```

当前 **41 个用例**（README 里若写 39 以本文件为准；数量会随用例增加变化，
以 `npm test` 输出 `tests N` 行为准）。全部走 mock 通道，**不花真钱、不需要 key**。

## 测试布局

| 文件 | 覆盖 |
|---|---|
| `test/rng.test.js` | 哈希随机的确定性与分布 |
| `test/vocab.test.js` | 中文词表完整性（列数、id 唯一、回退） |
| `test/personas.test.js` | 人格网格、人格行生成、pool 回退 |
| `test/feed.test.js` | 波次算法、情绪、收尾聚合 |
| `test/charts.test.js` | 图谱纯函数（漏斗/折线/需求曲线数据） |
| `test/bytes.test.js` | base64 小件 |
| `test/pipeline.test.js` | 引擎编排（mock send 端到端） |
| `test/worker.test.js` | Worker 集成（`unstable_dev` 起真实本地 Worker） |
| `test/helper.js` | 共享夹具（非测试文件） |

## Worker 集成测试要点

- 用 wrangler 的 `unstable_dev` 在本地起真实 Worker（含 D1 本地库、assets）。
- 已验证的关键行为：每日限额对 `/api/check` **与** `/api/version` 双路 429 一致；
  检查→批次→收波→报告全链路。
- 测试用本地 D1，不碰远程；`npm test` 前不需要 `npm run dev`（迁移由测试自行应用）。

## 写新测试的规则

1. 引擎新函数 → 纯函数单测（同目录 `test/` 加文件或并入现有文件）。
2. Worker 新行为 → 进 `test/worker.test.js`，用 `unstable_dev`，断言状态码 + JSON 形状。
3. **不接真实 Jev**：任何测试不得调用 typesafe/openrouter；需要"真实概率形状"时用
   `shared/mock.js` 或手写夹具。
4. 限额/记账类改动必须带回归用例（这两类都出过只修一边的事故）。

## 未覆盖/已知缺口

- 无浏览器端 E2E（前端交互无自动化测试，改动 UI 靠人工核对）。
- 无 lint/格式化工具链（约定靠 [CONVENTIONS.md](CONVENTIONS.md) 自律）。
