# 真实 Jev API 验证报告（Task 9）

> 时间：2026-09-28 · 通道：TypeSafe 官方 API（https://api.typesafe.ai/v1/systemone，模型 jev-1.13.0）
> key 存于 .env.local（已被 .gitignore 忽略，不入库）

## 结论

真实 Jev 全链路可用：CLI（runCheck）与 Worker（check/batch/wave 分步）两条路径都已用真实 key 端到端跑通，
回答是真实的概率分布（非 mock 启发式），成本与延迟量级与上游 README 的口径一致。

## 实测记录（同一条 iPhone 转让帖，中文小镇 1 万人）

| # | 路径 | 范围 | 到达 | 停下 | 乐见 | 反感 | 真实花费 | 耗时 |
|---|---|---|---|---|---|---|---|---|
| 1 | CLI runCheck | 只跑第 1 波（600 人） | 600 | 366 | 150 | 8 | $0.0158 | 5.0s |
| 2 | CLI runCheck | 全程（4 波上限） | 2,100 | 512 | 168 | 7 | $0.0323 | 6.3s |
| 3 | Worker 分步 | 全程（23 个批次请求） | 2,100 | 536 | 180 | 15 | $0.0100* | 20.7s |

*Worker 口径：versions.usd 累加（opening + 批次 + 追问）；本次实测后已修复"收尾提问花费未计入 versions.usd"的缺口，
修复后口径与 CLI 一致。表内第 3 行是修复前的读数，真实总花费与 #2 同量级（约 $0.02-0.03）。

## 观察与发现

1. **波次判定与上游口径吻合**：第 1 波情绪 +0.22~0.24（上游记录的强文本区间 0.12~0.33），第 2 波 +0.02
   （弱文本区间 -0.39~0.02）——这条帖子被真实 Jev 判定"值得第一波传播、不值得第二波"，最终到达 2,100 人。
2. **真实模型比 mock 挑剔**：同一条帖子的 mock 版让文字传遍全城 10,000 人；真实 Jev 在第 2 波就停了。
   mock 只适合功能演示，成本/传播预估必须用真实模型。
3. **Jev 的文本解读跨调用稳定**：point_first 0.94/0.95、ask 0.51/0.52、concrete 0.99（CLI 与 Worker 两次独立运行几乎一致）。
4. **收尾提问答案合理**：为什么划走 = 没新意 40% / 价格 35% / 不信任 15%；什么让他们停下 = 价格公道 / 交易条款 / 细节清楚；
   买家最常问 = 还在吗(92) / 能便宜点吗(83) / 能发图吗(71)（概率和，536 人被追问）。
5. **成本量级**：单波 600 人 ≈ $0.01-0.02；到 2,100 人 ≈ $0.02-0.03；全城 10,000 估计 $0.10-0.15（上游 README 口径 1-10 美分/检查，
   本次实测略高于其下限，主要在追问与收尾请求）。

## 本次发现并修复的问题

- versions.usd 漏记收尾提问（stage 'ask'）的花费 → closeWave 现在把 askUsd/askTokens 一并累加进 versions
  （commit: fix: closing-question spend accrues to versions.usd as well as batches）。

## 当前密钥配置

- `.env.local`：TYPESAFE_API_KEY（真实，gitignored）→ `npm run check` 默认走真实模型
- `.dev.vars`：JEV_PROVIDER=mock（已恢复）→ `npm run dev` 与 `npm test` 不花钱
- 要让本地站点也用真实模型：把 .dev.vars 的 JEV_PROVIDER 改为 typesafe 并贴入 key（见 .dev.vars 内注释）
