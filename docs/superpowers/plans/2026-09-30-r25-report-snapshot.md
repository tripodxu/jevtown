# R25 · 优化轮：报告快照列——showPost 从 1 万行读降到 1 行

> 轮换位置：R24 前端 ⇒ **R25 优化** ⇒ R26 创意。writing-plans 规范，inline 执行。

**取证（代码级）**：`showPost` 每次执行 `SELECT id, wave, reaction FROM reactions WHERE post = ? AND number = ?`——
全城检查 = **10,000 行**的读与传，而这是最热的读路径（每次查看/刷新/对比区回拉）。
D1 按 rows_read 计费，免费档 5M 行/天 ≈ 500 次报告查看就见底。
关键事实：报告冻结后 `looks`/`reach` 两份字节**永不变化**（R7 地形缓存同一洞察）。

## 设计

- **迁移 0007**：`versions` 加 `looks TEXT` / `reach TEXT`（只增不改）。
- **settleWave 收尾**：用 `reached`（pid → reaction）与 `plan.history`（波次 → 名单）就地
  组装两份字节 + base64，与"置 done"同一批写入 versions。
- **showPost 分支**：`version.looks` 存在 → 解码两包 + 由 `bytes×waveBytes` 重建
  `byWave`（每波反应名单——waves 的 mood/travels 需要它，可无损重建）；
  running 中（无快照）走既有 rows 路径——实时语义不变。
- **一致性**：两条路径产出的 bytes/waveBytes/byWave 必须相同——既有 worker 测试
  （传播层逐波计数、地形口径、调用报告）全部经由 showPost，即回归网。

## 任务

1. 迁移 0007；settleWave 组装快照（与置 done 同 batch）。
2. showPost 分支（快照解码 / rows 回退），byWave 重建。
3. worker.test.js +1 用例：跑完后 `decodeBytes(detail.looks)` 非零格数 === counters.reach、
   `decodeBytes(detail.reach)` 逐波计数 === waves[].size（快照路径）；
   既有用例全绿即回归网。
4. 文档：worker-api.md 迁移序列 + 记账条目；MEMORY 记一轮。

## 验收

- [ ] `npm run lint` ✓；`npm test` ≥ 119
- [ ] 迁移后本地 dev 报告页行为不变（E2E 抽查一张报告：地图/传播层/构成数字与旧路径一致）
- [ ] 收益口径：结构论证（快照命中 = 0 行 reactions 读），如实记录
