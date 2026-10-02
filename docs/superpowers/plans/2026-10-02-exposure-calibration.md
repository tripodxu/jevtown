# R37「Jev 押得准吗」· 实施计划

设计：`docs/superpowers/specs/2026-10-02-exposure-calibration-design.md`

## 步骤

- [ ] **1. `feed.js` 开批量入口** — 加 `exposureAll(personas, scores, presetId) → Float64Array`（`cubeTable` 折一次 + `flatOf` 的 CSR 行）；`firstWave` 内部改成读它。**先跑 `node --test test/feed.test.js` 确认 `test/golden-waves.txt` 原样通过** —— 波次名单存在 `versions.plan` 里，一丁点不同就是一次不同的检查。
- [ ] **2. `feed.js` 加 `exposureBands`** — 全城 exposure 九个分位切十档（2048 桶直方图，不排序）；每档数 `people/reached/stopped/glad/sorry`；`lift` 分母取全城；`readable = 至少两档到达 ≥ 25`；`flat = 第 1 档不比末档强`；`first.stoppedRatio/gladRatio` 只在两边都有命中时给。
- [ ] **3. `labels.js` 加 `CALIBRATE_ZH` + `calibrateSayZh`** — 表头结论句、`flat` 的押平文案、`!readable` 的降级文案。中文不进 `feed.js`。
- [ ] **4. 接线** — `worker/index.js` 的 `base` 加 `scores`、返回体加 `bands`；`public/shared/replay.js` 同构（`saved.scores` 缺 → `null`）；`scripts/check.js` 存档补 `scores`。
- [ ] **5. `render.js` 加 `bandsView`** — 紧跟 `baselineView` 之后；`result.bands` 为 null 或 `!readable` 时不渲染/退化成一句。
- [ ] **6. 补一个带 `scores` 的 fixture 存档** — `public/examples/` 里现有的两份都没有 `scores` 字段。`MOCK=1 node scripts/check.js` 生成，不花钱。
- [ ] **7. 断言** — `test/feed.test.js`：① golden-waves 原样；② 口径自洽（Σpeople === 全城、Σreached === counters().reached、第 1 档 high ≥ 第 10 档 low、每档 reached ≤ people、10 档）；③ 真存档「第 1 档停下率 ≥ 末档 10 倍」；④ `flat` 分支（全城 exposure 相同时 `flat === true` 且十档人数仍各约 1/10）。`test/labels.test.js`：`CALIBRATE_ZH` 每个键都被引用。`test/theme.test.js`：中文单点 + 负号字形。
- [ ] **8. 验证** — `npm test` 全量（188 → ≥ 198）、`npm run lint`、DOM 桩渲染探针跑两条分支（十档有斜率 / `flat` 押平）。
- [ ] **9. `docs/MEMORY.md` 加 R37 条目** — 三条 probe 结论、CPU 数字、三个探针坑（假 id / 直方图死循环 / `exposure()` 是「每人一次」的形状）。
- [ ] **10. 一次中文 commit。**

## 护栏

不改 `GLAD_ENOUGH` 与 `nextWave` 的排名式；不动 `WAVES` 的随机尾巴；零新增 Jev 调用、零新增迁移、零新增 devDependency。commit 标题里不写 `$` 金额（PowerShell 会吃掉 `\$0`）。GPG 签名阻塞 → `run_in_background` + `job_output(wait: true)`。