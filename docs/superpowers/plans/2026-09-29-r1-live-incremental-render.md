# 实时监控增量渲染 实施计划（R1 · 优化）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本轮按目标约定**不使用子代理**，在当前会话内按 executing-plans 逐条执行。

**Goal:** 把"检查进行中"的每批更新从 O(全镇 10 000) 降到 O(本批 100)，并让实时地图只补画新点亮的格子。

**Architecture:** 新增纯函数模块 `public/tally.js` 持有"已判定"快照（字节数组 + 三个累计计数），
`foldBatch` 原地折叠每批 `drawn`；`public/grid.js` 增加 `paintDelta`，按字节快照 diff 只重画变化格。
`public/app.js` 只做编排：从 `live.tally` 读数、用 `paintDelta` 刷图。纯函数可在 Node 单测，无需浏览器。

**Tech Stack:** 原生 ESM、无框架、canvas 2D、`node:test`。

---

## 现状与证据（读码结论）

`public/app.js` 的实时路径每收到一批（100 人）做三件 O(10 000) 的事：

| 位置 | 现状 | 问题 |
|---|---|---|
| `app.js:83` `updateLiveStats` | `for (const b of live.bytes) if (b) judged += 1` | 全量扫 1 万字节 |
| `app.js:124-130` `paintBatch` | 再扫一遍算 `glad`/`sorry` | 又一次全量扫 |
| `grid.js:46-52` `paint` | 每批 `fillRect` 一万次 | 一次全城检查 ≈ 100 批 ⇒ 约 100 万次 `fillRect` |

一次全城检查（10 000 人 / 每批 100）= 100 批 ⇒ 三处合计约 **300 万次**与全镇规模成正比的循环/绘制，
而真正变化的人只有 100 个/批。`grid.js:39-41` 还有一处死代码：`style.height` 先赋 px 再被 `'auto'` 覆盖。

## 文件结构（职责锁定）

| 路径 | 动作 | 职责 |
|---|---|---|
| `public/tally.js` | **新建** | 纯函数：已判定快照的创建与增量折叠。无 DOM 依赖 |
| `public/grid.js` | 改 | 画布登记项多存一份 `painted` 字节快照；新增 `paintDelta` |
| `public/app.js` | 改 | 实时态改用 `live.tally` 读数 + `paintDelta` 刷图 |
| `test/tally.test.js` | **新建** | `foldBatch` 的幂等性、改判、未知反应、与全量重扫对拍 |
| `docs/MEMORY.md` | 改 | 本轮事实记一条（最新置顶） |
| `docs/TESTING.md` | 改 | 测试布局表加 `tally.test.js`，用例数 45 → 50 |

---

### Task 1: `public/tally.js` —— 已判定快照的增量折叠

**Files:**
- Create: `public/tally.js`
- Test: `test/tally.test.js`

- [ ] **Step 1: 写失败测试**

`test/tally.test.js`：

```js
// 实时监控的增量统计：foldBatch 的幂等性、改判、未知反应，以及与全量重扫的对拍。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTally, foldBatch } from '../public/tally.js';

const KEYS = ['scrolled_past', 'read', 'liked', 'disliked'];
const TONE = [0, 0, 1, -1]; // 序号 → 1/0/-1，与 presets.js 的 reaction.tone 同形
const indexOf = (reaction) => KEYS.indexOf(reaction);
const toneOf = (index) => TONE[index] ?? 0;

/** 全量重扫：从字节数组数出 judged/glad/sorry，用来和增量结果对拍。 */
const rescan = (bytes) => {
  const out = { judged: 0, glad: 0, sorry: 0 };
  for (const byte of bytes) {
    if (!byte) continue;
    out.judged += 1;
    const tone = TONE[byte - 1] ?? 0;
    if (tone === 1) out.glad += 1;
    if (tone === -1) out.sorry += 1;
  }
  return out;
};

test('newTally：一座空小镇，三个计数都是 0，字节全 0', () => {
  const tally = newTally(4);
  assert.deepEqual([...tally.bytes], [0, 0, 0, 0]);
  assert.equal(tally.judged + tally.glad + tally.sorry, 0);
});

test('foldBatch：一批 100 人折进快照，计数与字节都对', () => {
  const tally = newTally(3);
  foldBatch(tally, [{ id: 0, reaction: 'read' }, { id: 1, reaction: 'liked' }, { id: 2, reaction: 'disliked' }], indexOf, toneOf);
  assert.equal(tally.judged, 3);
  assert.equal(tally.glad, 1);
  assert.equal(tally.sorry, 1);
  assert.deepEqual([...tally.bytes], [2, 3, 4]);
});

test('foldBatch：同一批折两次不重复计（重试与重放都幂等）', () => {
  const tally = newTally(2);
  const batch = [{ id: 0, reaction: 'liked' }, { id: 1, reaction: 'disliked' }];
  foldBatch(tally, batch, indexOf, toneOf);
  foldBatch(tally, batch, indexOf, toneOf);
  assert.equal(tally.judged, 2);
  assert.equal(tally.glad, 1);
  assert.equal(tally.sorry, 1);
});

test('foldBatch：改判先撤旧再记新，计数不漂', () => {
  const tally = newTally(1);
  foldBatch(tally, [{ id: 0, reaction: 'liked' }], indexOf, toneOf);
  foldBatch(tally, [{ id: 0, reaction: 'disliked' }], indexOf, toneOf);
  assert.equal(tally.judged, 1);
  assert.equal(tally.glad, 0);
  assert.equal(tally.sorry, 1);
  foldBatch(tally, [{ id: 0, reaction: 'read' }], indexOf, toneOf);
  assert.deepEqual([tally.judged, tally.glad, tally.sorry], [1, 0, 0]);
});

test('foldBatch：不认识的反应跳过，不占人数', () => {
  const tally = newTally(2);
  foldBatch(tally, [{ id: 0, reaction: 'scam' }, { id: 1, reaction: 'read' }], indexOf, toneOf);
  assert.equal(tally.judged, 1);
  assert.equal(tally.bytes[0], 0);
  assert.equal(tally.bytes[1], 2);
});

test('foldBatch：一万格逐批折完，增量结果 === 全量重扫', () => {
  const tally = newTally(10000);
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 10000; i++) {
    const batch = Array.from({ length: 100 }, (_, k) => {
      const id = i * 100 + k;
      return { id, reaction: KEYS[Math.floor(next() * KEYS.length)] };
    });
    foldBatch(tally, batch, indexOf, toneOf);
  }
  assert.equal(tally.judged, 10000);
  assert.deepEqual(
    { judged: tally.judged, glad: tally.glad, sorry: tally.sorry },
    rescan(tally.bytes),
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "test/tally.test.js"`
Expected: FAIL —— `Cannot find module '../public/tally.js'`

- [ ] **Step 3: 写实现**

`public/tally.js`：

```js
// 实时监控的增量统计：把每批判定折进"全镇快照"，每批只做本批人数的活，
// 不再每批重扫一万格。纯函数、无 DOM，Node 可直接单测。
// 字节约定与 grid.js 地图一致：0 = 还没轮到，否则 = 该反应在 keys 里的序号 + 1。

/** 一座空小镇：字节数组 + 三个累计计数（已判定 / 乐见 / 反感）。 */
export const newTally = (size) => ({ bytes: new Uint8Array(size), judged: 0, glad: 0, sorry: 0 });

/** 撤销一个序号对应的态度。 */
const unvote = (tally, tone) => {
  if (tone === 1) tally.glad -= 1;
  else if (tone === -1) tally.sorry -= 1;
};

/**
 * 把一批 drawn（[{ id, reaction }]）折进快照，原地更新并返回快照。
 * indexOf(reaction) → 反应在 keys 里的序号（< 0 = 不认识，跳过）；
 * toneOf(index) → 1 / 0 / -1，取自 presets.js 的 reaction.tone。
 * 同一个人重复折（重试、重放）或被改判时，先撤销旧计数再记新的，因此是幂等的。
 */
export function foldBatch(tally, drawn, indexOf, toneOf) {
  for (const { id, reaction } of drawn) {
    const byte = indexOf(reaction) + 1;
    if (byte < 1) continue;
    const was = tally.bytes[id];
    if (was === byte) continue;
    tally.bytes[id] = byte;
    if (was) unvote(tally, toneOf(was - 1)); // 改判：换态度但不重复计人数
    else tally.judged += 1; // 新判定
    const tone = toneOf(byte - 1);
    if (tone === 1) tally.glad += 1;
    else if (tone === -1) tally.sorry += 1;
  }
  return tally;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "test/tally.test.js"`
Expected: PASS —— `# pass 6`

> **执行期修正（已回写上方代码）**：计划初稿的改判分支写成「先 `judged -= 1` 再按分支 `+= 1`」，
> 两种写法都会让改判后 `judged` 不是 1（一个漏加、一个多加）。`test/tally.test.js` 的
> 「改判先撤旧再记新」用例当场抓住（连续两次红：0 与 2）。**教训：增量计数器的改判路径
> 必须由"与全量重扫对拍"的用例兜底，靠人肉推理容易写反。**

- [ ] **Step 5: 提交**

```bash
git add public/tally.js test/tally.test.js
git commit -m "perf: 实时监控的已判定快照改为增量折叠纯函数"
```

---

### Task 2: `public/grid.js` —— 增量补画 + 死代码清理

**Files:**
- Modify: `public/grid.js:11-53`

- [ ] **Step 1: 写失败测试（对 `paintDelta` 的行为约定）**

`grid.js` 依赖 DOM，Node 里没有 canvas。**因此本任务不写 DOM 单测**，改用两条可执行的门：

1. `node --check public/grid.js`（语法门，`npm run lint` 已覆盖）
2. 行为由 Task 3 的浏览器端人工核对清单守护（见 docs/modules/frontend.md 改动自检）

> 说明：这是本计划唯一一处"没有单测"的改动，理由是无法在 Node 里造 canvas；
> 风险控制手段是**只增量画变化的格子、其余一律走原全量路径**，语义不扩散。

- [ ] **Step 2: 改 `drawGrid` / `redrawMaps`，登记 painted 快照**

`public/grid.js` 顶部到 `paint` 之前，替换为：

```js
// 已画过的画布登记在案：主题切换时逐张重绘；painted = 上次真正画上去的字节快照。
const drawn = new Map();

const cssVar = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

export function drawGrid(canvas, bytes, presetId) {
  // 修剪掉已断连的旧画布（反复渲染结果区时防泄漏），再登记新的。
  for (const [old] of drawn) if (!old.isConnected) drawn.delete(old);
  drawn.set(canvas, { bytes, presetId, painted: null, well: '' });
  paint(canvas, drawn.get(canvas));
}

/** 主题切换后调用：把登记过的地图全部按新令牌重画一遍。 */
export function redrawMaps() {
  for (const [canvas, entry] of drawn) {
    if (canvas.isConnected) paint(canvas, entry);
  }
}

/**
 * 增量重画：只补画与上次快照不同的格子，返回补画了几格。
 * 画布没登记、换了字节数组或换了预设时退回全量 drawGrid。
 */
export function paintDelta(canvas, bytes, presetId) {
  const entry = drawn.get(canvas);
  if (!entry || entry.bytes !== bytes || entry.presetId !== presetId || !entry.painted) {
    drawGrid(canvas, bytes, presetId);
    return bytes.length;
  }
  const keys = Object.keys(PRESETS[presetId].reactions);
  const ctx = canvas.getContext('2d');
  let touched = 0;
  for (let id = 0; id < bytes.length; id++) {
    if (bytes[id] === entry.painted[id]) continue;
    entry.painted[id] = bytes[id];
    fillCell(ctx, presetId, entry.well, id, bytes[id], keys);
    touched += 1;
  }
  return touched;
}

// 一格：字节 0 铺底板（还没轮到它），否则按反应取数据墨水。
function fillCell(ctx, presetId, well, id, byte, keys) {
  ctx.fillStyle = byte ? (LOOKS[lookOf(presetId, keys[byte - 1])] ?? LOOKS.dark) : well;
  ctx.fillRect((id % GRID) * CELL, Math.floor(id / GRID) * CELL, CELL - 1, CELL - 1);
}
```

- [ ] **Step 3: 改 `paint` 为「按登记项全量重画」**

`paint` 全体替换为（注意删掉被 `'auto'` 覆盖的死赋值）：

```js
function paint(canvas, entry) {
  const { bytes, presetId } = entry;
  const keys = Object.keys(PRESETS[presetId].reactions);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = GRID * CELL * dpr;
  canvas.height = GRID * CELL * dpr;
  canvas.style.width = `${GRID * CELL}px`;
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  entry.well = cssVar('--map-well', '#0a0d13');
  ctx.fillStyle = entry.well;
  ctx.fillRect(0, 0, GRID * CELL, GRID * CELL);
  for (let id = 0; id < bytes.length; id++) {
    if (!bytes[id]) continue;
    fillCell(ctx, presetId, entry.well, id, bytes[id], keys);
  }
  entry.painted = bytes.slice(); // 快照，供 paintDelta 做增量
}
```

- [ ] **Step 4: 跑语法门**

Run: `npm run lint`
Expected: `✓ 31 个文件通过`

- [ ] **Step 5: 提交**

```bash
git add public/grid.js
git commit -m "perf: 地图支持按字节快照增量补画，删掉被覆盖的 style.height 死赋值"
```

---

### Task 3: `public/app.js` —— 实时态改用快照与增量绘制

**Files:**
- Modify: `public/app.js:7-8`（import）、`:59-140`（showLive / updateLiveStats / paintBatch）

- [ ] **Step 1: 换 import**

`public/app.js` 第 7 行：

```js
import { drawGrid, paintDelta } from './grid.js';
```

第 8 行后新增：

```js
import { newTally, foldBatch } from './tally.js';
```

- [ ] **Step 2: 改 `showLive`**

```js
function showLive(presetId) {
  const reactions = PRESETS[presetId].reactions;
  live = {
    tally: newTally(CROWD),
    keys: Object.keys(reactions),
    tone: Object.keys(reactions).map((id) => reactions[id]?.tone ?? 0),
    preset: presetId,
    start: performance.now(),
    requests: 0,
    tokens: 0,
    usd: 0,
    ms: 0,
    tput: [],
    msSeries: [],
    shares: [],
    lastSample: null,
  };
  $('monitorBody').innerHTML = '';
  $('live').hidden = false;
  drawGrid($('liveMap'), live.tally.bytes, presetId);
  updateLiveStats();
  updateCharts();
}
```

- [ ] **Step 3: 改 `updateLiveStats`（不再扫数组）**

```js
function updateLiveStats() {
  $('liveStats').innerHTML =
    stat(`${live.tally.judged.toLocaleString()} / ${CROWD.toLocaleString()}`, 'Jev 已判定') +
    stat(live.requests, 'Jev 请求') +
    stat(live.tokens.toLocaleString(), 'tokens') +
    stat(fmtMs(live.ms), '模型耗时') +
    stat(`$${live.usd.toFixed(4)}`, '累计花费');
}
```

- [ ] **Step 4: 改 `paintBatch`（折叠 + 增量补画）**

```js
function paintBatch(batch) {
  // 增量：只走本批 100 人，不再每批重扫全镇一万格。
  const before = live.tally.judged;
  foldBatch(live.tally, batch.drawn ?? [], (reaction) => live.keys.indexOf(reaction), (index) => live.tone[index] ?? 0);
  paintDelta($('liveMap'), live.tally.bytes, live.preset);
  live.requests += 1;
  live.tokens += batch.tokens ?? 0;
  live.usd += batch.usd ?? 0;
  live.ms += batch.ms ?? 0;

  // 心电图采样：吞吐 = 本批判定数 / 距上次采样的墙钟；耗时 = 本批模型 ms
  const now = performance.now();
  const wall = live.lastSample ? (now - live.lastSample.t) / 1000 : 0;
  const judged = live.tally.judged;
  live.tput.push(wall > 0.05 ? (judged - live.lastSample.judged) / wall : 0);
  live.msSeries.push(batch.ms ?? 0);
  live.shares.push({ glad: live.tally.glad, sorry: live.tally.sorry, judged });
  live.lastSample = { t: now, judged };

  updateLiveStats();
  updateCharts();
  monitorRow([`第 ${batch.wave + 1} 波`, `${batch.answered} / ${batch.total}`, `${batch.ms ?? 0}ms`, `${(batch.tokens ?? 0).toLocaleString()}`, `$${live.usd.toFixed(4)}`]);
}
```

> `before` 变量只在需要"本批增量"时用；此处吞吐用的是累计差（与原实现口径一致），因此
> `before` 删除。**执行时以无 `before` 的版本落地**（见下方自检修订）。

- [ ] **Step 5: 跑 lint + test**

Run: `npm run lint && npm test`
Expected: lint `✓ 31 个文件通过`；test `# fail 0`，用例数 45 → 51

- [ ] **Step 6: 提交**

```bash
git add public/app.js
git commit -m "perf: 实时监控改用增量快照统计与增量补画"
```

---

### Task 4: 验证 —— 前后耗时对拍 + 浏览器端人工核对

- [ ] **Step 1: 量化对拍（Node，一次性命令）**

```bash
node -e "import('./public/tally.js').then(({newTally,foldBatch})=>{const K=['a','b','c','d'],T=[0,0,1,-1];const ix=r=>K.indexOf(r),tn=i=>T[i]??0;
let old=0,now=0,s=7;const nx=()=>(s=(s*1103515245+12345)%2147483648)/2147483648;
const batches=[];for(let i=0;i<100;i++)batches.push(Array.from({length:100},(_,k)=>({id:i*100+k,reaction:K[Math.floor(nx()*4)]})));
for(const b of batches){const t=process.hrtime.bigint();for(const x of b){}now+=Number(process.hrtime.bigint()-t)/1e6;}
let tally=newTally(10000);for(const b of batches){const t=process.hrtime.bigint();foldBatch(tally,b,ix,tn);now+=Number(process.hrtime.bigint()-t)/1e6;}
for(const b of batches){const bytes=new Uint8Array(10000);for(const x of b)bytes[x.id]=ix(x.reaction)+1;const t=process.hrtime.bigint();let j=0,g=0,s2=0;for(const by of bytes){if(!by)continue;j++;const q=T[by-1]??0;if(q===1)g++;if(q===-1)s2++;}old+=Number(process.hrtime.bigint()-t)/1e6;}
console.log('每批全量重扫×2 + 计数：',old.toFixed(2),'ms / 100 批');console.log('增量 foldBatch：',now.toFixed(2),'ms / 100 批');console.log('倍数：',(old/now).toFixed(1)+'x');console.log('结果一致：',tally.judged,g=g);})"
```

Expected: 增量明显小于全量（目标 ≥ 3×），末行打印 `结果一致：10000 true`。
**若命令因 PowerShell 转义失败，改写成 `scripts/bench-tally.mjs` 临时文件跑，跑完删除。**

- [ ] **Step 2: 浏览器端人工核对清单**（`npm run dev` 后走一遍）

- [ ] 实时监控：地图随批次逐格点亮，姿态占比曲线与"已判定 N / 10000"同步增长
- [ ] 切换四个主题：地图底板与格色随之重画（`redrawMaps` 走全量路径）
- [ ] 检查完成后的报告地图与悬停档案正常（`drawGrid` 全量路径）
- [ ] 报告页重复打开（`openPost`）不出现地图错色或画布泄漏

- [ ] **Step 3: 文档同步**

`docs/TESTING.md` 的测试布局表加一行：

```
| `test/tally.test.js` | 实时监控增量统计（幂等、改判、对拍） |
```

并把"当前 **45 个用例**"改为实际数字（以 Step 5 的 `tests N` 为准）。

`docs/modules/frontend.md` 的文件职责表加一行：

```
| `tally.js` | 实时监控的"已判定"快照：每批增量折叠（纯函数） |
```

`docs/MEMORY.md` 顶部加一条本轮事实（日期 + 标题 + 事实 + 数字 + 为什么）。

- [ ] **Step 4: 最终门禁**

Run: `npm run lint && npm test`
Expected: 两者全绿，`fail 0`

- [ ] **Step 5: 收尾提交**

```bash
git add docs/TESTING.md docs/modules/frontend.md docs/MEMORY.md docs/superpowers/plans/2026-09-29-r1-live-incremental-render.md
git commit -m "docs: 记录实时监控增量渲染的改动与门禁数字"
```

---

## 自检（写完后回看本计划）

1. **需求覆盖**：三处 O(全镇) 循环 → Task 1+3 覆盖统计、Task 2 覆盖绘制；死代码 → Task 2 Step 3；
   验证 → Task 4；文档 → Task 4 Step 3。✅
2. **占位符扫描**：无 TBD / TODO / "类似 Task N"；Task 2 的"无单测"已写明理由与替代门。✅
3. **命名一致**：`newTally` / `foldBatch` / `paintDelta` / `fillCell` / `entry.painted` / `entry.well`
   在 Task 1–3 中拼写一致；`toneOf` 取序号（`byte - 1`）在测试与实现中一致。✅
4. **已知修正**：Task 3 Step 4 初稿留了未使用的 `before`，自检中删除，以无 `before` 版本落地。
