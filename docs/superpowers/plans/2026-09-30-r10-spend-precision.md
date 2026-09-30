# R10 · 优化轮：花费记账精度——round2 在真实单价下把每一批抹成 0

> 轮换位置：R9 前端 ⇒ **R10 优化** ⇒ R11 创意。writing-plans 规范，inline 执行。
> 来源：2026-09-30 实地测试（真实 Jev key）——mock 抓不到，测试也抓不到（测试不花钱），
> 只有真实流量暴露。**这正是日预算闸失明的根因，属于正确性修复。**

**Goal:** 真实 API 的每批花费（~$0.0015）不再被抹零；站点显示与 `spentToday` 预算闸
恢复与真实花费同量级（实测基线：同文本 CLI = $0.0330）。

**Architecture:** 账面精度与显示精度分开——`batches.usd`、`versions.usd` 的**存储与累加**
用 4 位小数（`round4`），界面显示口径不变（toFixed(3/4) 本来就带 3–4 位）。D1 列是 REAL，
无迁移；mock 全 0 不受影响，100 个既有用例不动。

## 改动（`worker/index.js` 单文件）

1. 加 `const round4 = (value) => Math.round(value * 10000) / 10000;`（放 `round2` 旁）。
2. `addSpend` 的 bind：`round2(usd)` → `round4(usd)`（流水行的精度源头）。
3. `runBatch`：versions 累加 `usd = usd + ?` 的 bind → `round4(usd)`；
   响应 `usd: round4(usd)`（前端实时累计花费用）。
4. `settleWave` 收尾提问累加：`round2(askUsd)` → `round4(askUsd)`。
5. `runFollowUp`：versions 累加 `round2(usd)` → `round4(usd)`。
6. `callReport` totals 与 `showPost` 的 `spent.usd`：`round2` → `round4`（显示端
   toFixed(3/4) 保持，等于显示口径不变、精度变真）。

**不修的**：`mood`/`expectedMood` 的 round2（统计口径，与钱无关）；每批响应的
`usd` 在监控表的显示（前端 toFixed(4) 已足够）。

## 验收

- [ ] `npm run lint` ✓；`npm test` 100/100（mock 全 0，不受影响——**说明测试够不到这条，
      守护是实地复测**，如实记录）
- [ ] **实地复测**（真实 key，1 次检查 ≈ $0.03）：D1 `SUM(usd)` 与 CLI 基线同量级
      （$0.03x，不再是 0）；报告「本次花费」≈ $0.03x
- [ ] MEMORY 记账口径条目更新（CONVENTIONS：改记账必查 versions.usd 与 batches 汇总一致）
