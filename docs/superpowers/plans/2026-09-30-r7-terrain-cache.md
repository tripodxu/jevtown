# R7 · 优化轮：Worker 侧按 post.v 缓存地形结果

> **For agentic workers:** 本轮按用户要求不使用子代理，inline 执行（executing-plans 路数，单会话顺序做）。
> 轮换位置：R6 前端 ⇒ **R7 优化** ⇒ R8 创意。候选来自 R4 复盘（MEMORY）：
> `crowdTerrain()` 8.01ms/请求，占 showPost 纯计算 73%；正确省法是缓存，不砍置换次数。

**Goal:** 同一份报告重复查看（刷新/多人看/对比区回拉 v1）不再重算 Moran 置换检验。

**Architecture:** Worker isolate 内存里加一张 `post.v → terrain` 的模块级 Map（与既有
`crowdCache` 同一家族）。关键口径：反应只在 `running` 期间增长，`closing/done` 后冻结——
所以**只对非 running 的版本写缓存**，running 中的报告每请求照算（喂旧缓存是本轮唯一
可能造出的正确性事故，必须有测试兜住）。版本号只增不复用 ⇒ 不需要失效路径，只做容量上限。

**Tech Stack:** 无新依赖；`worker/index.js` 单文件内加函数（保持"Worker 单文件"约定）。

---

### Task 1: 缓存函数与接线（TDD）

**Files:**
- Modify: `worker/index.js`（模块级缓存 + `terrainFor`，`showPost` 接线一行）
- Test: `test/worker.test.js`（新增 1 个用例）

- [ ] **Step 1: 写失败测试**（`test/worker.test.js` 末尾追加）

```js
test('地形缓存：running 时逐批更新（不得喂旧缓存），冻结后重复读取一致', { timeout: 120_000 }, async () => {
  const opening = await (await postJSON(worker, '/api/check', { preset: 'post', text: '地形缓存验证：一条普通帖子' })).json();
  const author = { 'x-jev-author': authorOf(opening) };
  const getTerrain = async () => (await (await worker.fetch(`/api/post/${opening.post}?v=1`)).json()).terrain;

  // running 中：先判 100 人，读一次；再判 200 人，读一次——地形必须跟着涨（stale 缓存会露馅）
  await worker.fetch(`/api/batch?post=${opening.post}&v=1`, { headers: author });
  const t1 = await getTerrain();
  await worker.fetch(`/api/batch?post=${opening.post}&v=1`, { headers: author });
  await worker.fetch(`/api/batch?post=${opening.post}&v=1`, { headers: author });
  const t2 = await getTerrain();
  assert.ok(t2.judged > t1.judged, `running 中地形没更新：${t1.judged} → ${t2.judged}`);
  assert.equal(t2.judged, 300);

  // 冻结后：重复读取逐字段一致（缓存命中不得改变结果形状）
  await runToDone(worker, opening.post, opening.version, authorOf(opening));
  const t3 = await getTerrain();
  const t4 = await getTerrain();
  assert.deepEqual(t4, t3);
  assert.ok(t3.judged >= 600, `冻结后判定数应 ≥ 600，得 ${t3.judged}`);
  assert.deepEqual(t3.hot, t4.hot);
  assert.deepEqual(t3.cold, t4.cold);
});
```

- [ ] **Step 2: 跑测试确认现状**（此刻无缓存，t2>t1 天然成立、两次 GET 也天然一致——
  本用例是**回归防护**：缓存写错时机（把 running 也缓存）时 `t2>t1` 必红。先确认它绿）

Run: `node --test test/worker.test.js`
Expected: 全绿（新用例 pass）

- [ ] **Step 3: 最小实现**（`worker/index.js`，放在 `crowdOf` 之后）

```js
/**
 * 地形结果按 post.v 缓存（isolate 内存）：crowdTerrain 每请求约 8ms，是 showPost 纯计算的
 * 大头（R4 剖析）。反应只在 running 期间增长，closing/done 后冻结——只对非 running 的版本
 * 写缓存，同一份报告重复查看不再重算置换检验。版本号只增不复用 ⇒ 无失效路径，仅限容量。
 */
const terrainCache = new Map();
const TERRAIN_CACHE_MAX = 200;

function terrainFor(presetId, keys, bytes, versionId, frozen) {
  if (!frozen) return crowdTerrain(presetId, keys, bytes, { versionId });
  let terrain = terrainCache.get(versionId);
  if (!terrain) {
    terrain = crowdTerrain(presetId, keys, bytes, { versionId });
    if (terrainCache.size >= TERRAIN_CACHE_MAX) terrainCache.delete(terrainCache.keys().next().value);
    terrainCache.set(versionId, terrain);
  }
  return terrain;
}
```

`showPost` 里一行接线（`terrain:` 字段）：

```js
terrain: terrainFor(presetId, keys, bytes, `${id}.${v}`, post.state !== 'running'),
```

- [ ] **Step 4: 跑全量测试**

Run: `npm run lint && npm test`
Expected: lint ✓；全部用例 pass（原 93 + 新 1 = 94）

- [ ] **Step 5: 提交**

```bash
git add worker/index.js test/worker.test.js docs/superpowers/plans/2026-09-30-r7-terrain-cache.md
git commit -m "perf: Worker 侧按 post.v 缓存地形结果——冻结版报告重复查看不重算置换检验"
```

## 验收与口径

- [ ] running 中的报告地形逐批更新（测试兜住，防止把旧缓存喂给正在进行的检查）
- [ ] 冻结后重复读取结果一致；缓存上限 200 条，超出淘汰最早一条
- [ ] 收益口径=**结构论证**（命中路径不进 `crowdTerrain`），不是实测毫秒数——
      R4 已实测该函数 8.01ms/请求，此轮不再另测墙钟（D1 IO 噪声大，测了也不可信）
- [ ] `docs/MEMORY.md` 记一条；`docs/modules/worker-api.md` 若提及 showPost 计算路径则补一句
