# R8 · 创意轮：传播层与重播——把"文字怎么在小镇传开"画在地图上

> 轮换位置：R7 优化 ⇒ **R8 创意** ⇒ R9 前端。writing-plans 规范；按用户要求 inline 执行，不用子代理。

**Goal:** 报告地图新增第三个视图「传播」：每格显示这个人是在**第几波**看到这段文字的
（顺序用单色渐满的量表编码，不用反应色板），配一个「重播传播」按钮按波次逐步点亮——
检查的传播过程可视化，全部来自既有判定数据，**零新增 Jev 调用**。

**Architecture:** 波次归属在两端都已有或补一行即可拿到——引擎 `runCheck` 循环里本来就
知道 index（补一个 `waveOf` Uint8Array）；Worker 的 `reactions` 表本来就有 `wave` 列
（showPost 拼成字节 → base64）。前端 `grid.js` 的画布登记项加 `mode`（reaction/reach），
`redrawMaps` 按 mode 重画；`render.js` 的单按钮地形开关升级为三视图分段控件。
**存档示例是真实 API 生成的（usd≈$0.032），不重生成**：旧档没有 `waveOf` → 传播按钮
优雅隐藏，功能对新检查与未来存档全量可用。

**颜色口径（关键决定）:** 传播是**有序量表**，用 `--map-blue` 对底板 mixHex 渐满
（t = 0.45 / 0.65 / 0.85 / 1）——刻意不用 LOOKS（那是"做了什么反应"的色板），也刻意
不用多色（多色暗示类别，波次是顺序）。墨水与底板都取主题令牌，四主题自成立；
t 的下限 0.45 按非文字图形 3:1 复算过（mix 后最低 ≈3.5:1，执行时数值验证）。

---

### Task 1: 引擎记录 waveOf（`public/shared/check.js` + `scripts/check.js` 存档）

**Files:** Modify `public/shared/check.js`（约 4 行）、`scripts/check.js`（存档 +1 行）、`test/pipeline.test.js`

- [ ] 引擎：`runCheck` 里 `const reactions = new Uint8Array(...)` 旁加
  `const waveOf = new Uint8Array(people.length)`；answer 回调里 `reached.set(...)` 旁加
  `waveOf[persona.id] = index + 1`；返回对象加 `waveOf`。
- [ ] 存档：`scripts/check.js` 的 JSON 加 `waveOf: Array.from(result.waveOf)`。
- [ ] 测试（`pipeline.test.js` 的 post 全流程用例内追加）：

```js
// 传播层的数据源：每个人格记着自己在第几波看到（0 = 没看到）
assert.ok(result.waveOf, 'waveOf 缺失');
assert.equal(result.waveOf.length, CROWD);
for (let i = 0; i < CROWD; i++) {
  if (result.reactions[i]) assert.ok(result.waveOf[i] >= 1 && result.waveOf[i] <= result.waves.length, `格子 ${i} 判定了却没记波次`);
  else assert.equal(result.waveOf[i], 0, `格子 ${i} 没判定却有波次`);
}
assert.equal([...result.waveOf].filter((w) => w === 1).length, 600, '第 1 波恒 600 人');
```

### Task 2: Worker 返回 reach 字节（`worker/index.js` showPost）

**Files:** Modify `worker/index.js`、`test/worker.test.js`

- [ ] showPost：rows 循环里同时填 `waveBytes[row.id] = row.wave + 1`；响应加
  `reach: encodeBytes(waveBytes)`。
- [ ] 测试（新用例）：跑完一次检查后 GET，断言 `decodeBytes(detail.reach)` 长度 10000、
  非零数 === counters.reach、逐波计数 === waves[].size。

### Task 3: grid.js 传播层（mode 化 + drawReach + 重播档位）

**Files:** Modify `public/grid.js`、`test/grid.test.js`

- [ ] 登记项加 `mode`（'reaction' 默认 / 'reach'）；`paint(entry)` 按 mode 分支；
  `paintDelta` 对非 reaction 画布直接返回 0（那是实时地图专用路径）。
- [ ] 新增 `reachInk(wave)`（导出，图例同源）与 `drawReach(canvas, waveBytes, upto = Infinity)`：
  铺底板后画 wave ∈ 1..upto 的格子，ink = mixHex(well, blue, t[wave-1])。
- [ ] 测试：drawReach 逐波异色且都不是底板；upto 截断；主题切换后 redrawMaps 仍画传播层；
  paintDelta 碰传播层画布不动手。

### Task 4: 前端三视图 + 重播（`render.js` / `styles.css`）

**Files:** Modify `public/render.js`、`public/styles.css`

- [ ] map-bar 换成三视图分段控件（反应图 / 传播 / 聚集地形；terrain 无成片、reach 缺失时
  各自隐藏该按钮），`wireTerrain` 改为 `wireMapModes`：切 mode 时重画地图 + 换图例 + 换提示语。
- [ ] 「重播传播」ghost 按钮只在传播视图出现：按 1..maxWave 每步 ~650ms 调
  `drawReach(canvas, waveBytes, w)`；`prefers-reduced-motion: reduce` 时跳过动画直接铺满。
- [ ] `reachLegend`：逐波 `第 N 波 · size 人` + 「没看到」，点色与 `reachInk` 同源。
- [ ] styles.css：`.mapswitch` 与 `.themeswitch` 共用分段样式（选择器并列，不复制规则）。

### Task 5: 回放链路与文档

**Files:** Modify `public/shared/replay.js`（`reach: saved.waveOf ? encodeBytes(Uint8Array.from(saved.waveOf)) : null`）、
`docs/modules/worker-api.md`、`docs/modules/frontend.md`、`docs/MEMORY.md`

- [ ] replay.js 一行接线；旧档（无 waveOf）得 null → 前端隐藏传播按钮。
- [ ] 文档：API 形状 +reach 字段；前端地图三视图约定；MEMORY 记一轮。

### 验收

- [ ] `npm run lint` ✓；`npm test` ≥ 97（engine 1 + worker 1 + grid 4 新用例）
- [ ] E2E（本地 mock 检查一次）：传播视图逐波计数与 waves 一致；重播动画工作；
      四主题重绘不丢层；375px 无溢出；控制台零错误；旧存档示例无传播按钮（优雅降级）
- [ ] 传播墨水 t=0.45..1 对四主题底板的对比度数值复算（≥3:1）附进 MEMORY
