# R19 · 优化轮：人格打包管线——isolate 冷启动 ~130ms CPU 降到 ~20ms

> 轮换位置：R18 前端 ⇒ **R19 优化** ⇒ R20 创意。writing-plans 规范，inline 执行。
> 来源：README 路线图 Step 4 的「人格打包管线省 CPU」。**动机**：免费档 Worker 单请求
> 10ms CPU，而 isolate 首个请求要现场算 1 万人格（Node 实测 ~130–142ms）——这是上线
> 即触发的冷启动税。备忘（R13）只省"第二次"，省不了"第一次"。

**Goal:** 把全城人格**离线预计算**成打包文件随代码发布；`persona()` 走解码路径，
同一 id 产出**逐字段一致**的人格。一致性由全城 10,000 人对拍测试守护。

**Architecture:**
- `scripts/pack-personas.mjs`：调 `personaCompute`（现 persona() 的计算体，改名单独导出）
  生成 `public/shared/personas-pack.js`——每人 12 个小整数槽（名字下标/年龄/性别/城市/
  职业/3 兴趣/性情/预算/消费/想买），纯数据模块（无 import，三端同吃）。
- `personas.js`：`persona(pool, id)` = 有包解码、无包/带 interests 覆盖参时走计算体
  （上游的 pack.js:interestsAt 接口在本仓库无人使用，保留参数语义）。
  解码只重建字段：x/y/pool 由 id 推导，`field`/`ageGroup` 按计算体同式推导。
- **失效纪律：改词表或 personaCompute 必须重跑生成脚本**——对拍测试在 CI 里，
  不重跑 = 红。

## 任务

1. **对拍测试先行**（`test/personas.test.js`）：`persona('zh', id)` 与
   `personaCompute('zh', id)` 对 0..9999 逐个 deepEqual——此刻无包必红。
2. personas.js 拆分 `personaCompute` / `personaFromPack` / 公开 `persona()` 分派。
3. 生成脚本 + 生成包文件（提交入库，可再生）。
4. 对拍转绿 + 计时（目标：解码全城 ≤ 30ms，单格解码 µs 级）。

## 验收

- [ ] `npm run lint` ✓；`npm test` ≥ 112（对拍用例转绿）
- [ ] Node 实测：`crowd('zh')` 冷启动耗时（改前 ~130-142ms → 目标 ≤ 30ms），
      `persona('zh', 1234)` 单格 µs 级
- [ ] `docs/modules/shared-engine.md` 补打包管线小节；`MEMORY.md` 记一轮；
      `README.md` 路线图 Step 4 划掉「人格打包管线」
