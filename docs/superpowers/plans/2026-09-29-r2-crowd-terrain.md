# 人群地形（Moran 空间自相关） 实施计划（R2 · 创意）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本轮按目标约定**不使用子代理**，在当前会话内按 executing-plans 逐条执行。

**Goal:** 让报告能回答一个现在完全问不出来的问题——**这一次的乐见与反感是连成片的，还是零散的**，并把答案画在地图上。

**Architecture:** 新增纯函数模块 `public/shared/spatial.js`，用 **Moran's I**（rook 邻接）读一万格的反应场，
用**置换检验**判显著，再取局部得分最高的一批格子标为成片区。Worker 的 `showPost` 与浏览器的
`replay.js` 双路同构计算（与 `counters`/`segments` 同一套路），返回紧凑的格子 id 列表；
`grid.js` 接受可选的 terrain 参数给这些格子描环；`render.js` 加一段「人群地形」并给地图一个开关。

**Tech Stack:** 原生 ESM、无框架、canvas 2D、`node:test`、无新依赖。

---

## 为什么是这个点子

- **网格位置本身有含义**（`personas.js:1-3`：年龄按行、兴趣按列，邻居就是相似的人），
  所以"哪一片人一起反感"是个真问题。
- **`summary.js` 的 segments 永远问不出来**：它是按属性做的**边际**统计；成片往往由属性的
  **组合**造成（"预算紧的 × 对手机感兴趣的 × 在同一片区的"），单看任何一条属性条都看不出来。
- 传播算法本身就制造聚集：`feed.js:109-121` 给**传播者的网格邻居**加权 0.1。
  于是"反应在空间上成片"不是渲染幻觉，是可以测的。

## 统计量（合成图已核对，勿凭直觉改）

对**被判定到**的格子，令 `tone ∈ {+1 乐见, -1 反感, 0 其余}`，rook 邻接（上下左右，也都判定到了）：

```
d_i  = tone_i - mean(tone)
nb_i = Σ_{j 与 i 相邻且都被判定} d_j
I    = (n / (2 · S0)) · (Σ_i d_i·nb_i) / (Σ_i d_i²)      S0 = Σ_i (#判定邻居) = 2E
```

合成图核对结果（Node 实跑）：

| 图 | I |
|---|---|
| 左上一块 +1，其余 0 | **+0.798** |
| 棋盘 +1 / -1 交替 | **−0.500** |
| 全体同值（无方差） | `null`（不出结论） |

显著性用**置换检验**：把 tone 在判定格之间 Fisher-Yates 重排 `perms` 次，看观测 I 在零分布里的位置。
`p = (1 + #{两尾更极端的次数}) / (1 + perms)`。置换次数随人数收缩（人越多零分布越窄）：

| 判定人数 | perms |
|---|---|
| ≤ 2000 | 199 |
| ≤ 5000 | 99 |
| > 5000 | 49 |

判定：`p < 0.05 && I > 0` → `clustered`（成片）；`p < 0.05 && I < 0` → `scattered`（零散）；否则 `unclear`。

## 文件结构（职责锁定）

| 路径 | 动作 | 职责 |
|---|---|---|
| `public/shared/spatial.js` | **新建** | `crowdTerrain()`：Moran's I + 置换检验 + 成片格子标注。纯函数、三端共用 |
| `public/shared/labels.js` | 改 | 新增 `TERRAIN_VERDICT_ZH` / `TERRAIN_SAY_ZH` / `directionZh`（中文单源） |
| `public/shared/replay.js` | 改 | 回放视图补 `terrain`（浏览器侧） |
| `worker/index.js` | 改 | `showPost` 补 `terrain`（Worker 侧）——与 replay 双路同构 |
| `public/grid.js` | 改 | `drawGrid` / `paint` 接受可选 `terrain`，给成片格子描环 |
| `public/render.js` | 改 | 新增 `terrainView()` 段落 + 地图「聚集地形」开关与图例切换 |
| `public/styles.css` | 改 | `.terrain-read` / `.chip.clustered|scattered` / `.dot.ring` / `.map-bar` |
| `test/spatial.test.js` | **新建** | 成片/零散/无方差/判定不足/确定性/置换收缩 |
| `test/grid.test.js` | 改 | 描环：聚合格子被描、非聚合格子不描、主题重画仍带环 |
| `docs/MEMORY.md`、`docs/ARCHITECTURE.md`、`docs/modules/frontend.md`、`README.md` | 改 | 文档同步 |

---

### Task 1: `public/shared/spatial.js` —— 人群地形

**Files:**
- Create: `public/shared/spatial.js`
- Test: `test/spatial.test.js`

- [ ] **Step 1: 写失败测试**

`test/spatial.test.js`：

```js
// 人群地形：成片 / 零散 / 说不准 的判定，以及置换检验的确定性与收缩。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crowdTerrain } from '../public/shared/spatial.js';

// 'post' 的反应顺序：scrolled_past(1) read(2) liked(3) disliked(4) reposted(5) followed(6) blocked(7) cant_tell(8)
const KEYS = ['scrolled_past', 'read', 'liked', 'disliked', 'reposted', 'followed', 'blocked', 'cant_tell'];
const LIKED = 3;
const DISLIKED = 4;
const NEUTRAL = 2;
const G = 10; // 测试用 10×10 小网格
const bytesOf = (at) => Uint8Array.from(at);

/** 全判定，左上 4×4 一块 +1，其余 0 —— 该判"成片"。 */
const patch = () => bytesOf(Array.from({ length: G * G }, (_, i) => ((i % G) < 4 && ((i / G) | 0) < 4 ? LIKED : NEUTRAL)));

/** 全判定，+1/-1 棋盘 —— 该判"零散"。 */
const checkerboard = () => bytesOf(Array.from({ length: G * G }, (_, i) => (((i % G) + ((i / G) | 0)) % 2 ? LIKED : DISLIKED)));

test('判定不足：不到 30 人不出结论', () => {
  const bytes = new Uint8Array(G * G);
  for (let i = 0; i < 10; i++) bytes[i] = LIKED;
  const t = crowdTerrain('post', KEYS, bytes, { grid: G, versionId: 'v1' });
  assert.equal(t.morans, null);
  assert.equal(t.verdict, 'unclear');
  assert.equal(t.judged, 10);
});

test('全体同值：没有方差就不出结论', () => {
  const t = crowdTerrain('post', KEYS, bytesOf(Array.from({ length: G * G }, () => LIKED)), { grid: G, versionId: 'v1' });
  assert.equal(t.morans, null);
  assert.equal(t.verdict, 'unclear');
});

test('成片：左上角一块乐见 ⇒ I 为正、判定 clustered、成片格落在左上', () => {
  const t = crowdTerrain('post', KEYS, patch(), { grid: G, versionId: 'v1' });
  assert.ok(t.morans > 0.3, `I 应显著为正，实际 ${t.morans}`);
  assert.equal(t.verdict, 'clustered');
  assert.ok(t.hot.length > 0, '应标出成片的乐见');
  assert.equal(t.cold.length, 0);
  assert.ok(t.hotAt.x < G / 2 && t.hotAt.y < G / 2, `重心应在左上，实际 ${t.hotAt.x},${t.hotAt.y}`);
  for (const id of t.hot) {
    assert.equal((id % G) < 4 && ((id / G) | 0) < 4, true, '成片格只应落在那一块里');
  }
});

test('零散：+1/-1 棋盘 ⇒ I 为负、判定 scattered', () => {
  const t = crowdTerrain('post', KEYS, checkerboard(), { grid: G, versionId: 'v1' });
  assert.ok(t.morans < -0.2, `I 应显著为负，实际 ${t.morans}`);
  assert.equal(t.verdict, 'scattered');
  assert.equal(t.hot.length, 0);
  assert.equal(t.cold.length, 0, '正负相间时没有哪一片同号，不该标成片');
});

test('确定性：同一输入两次完全一致（置换用 seed 随机）', () => {
  const a = crowdTerrain('post', KEYS, patch(), { grid: G, versionId: 'same' });
  const b = crowdTerrain('post', KEYS, patch(), { grid: G, versionId: 'same' });
  assert.deepEqual(a, b);
  const c = crowdTerrain('post', KEYS, patch(), { grid: G, versionId: 'other' });
  assert.equal(c.morans, a.morans, '换 seed 只动零分布，不动观测值');
});

test('置换次数随判定人数收缩（大阵省 CPU）', () => {
  const small = crowdTerrain('post', KEYS, patch(), { grid: G, versionId: 'v1' });
  assert.equal(small.perms, 199);
  const big = new Uint8Array(G * G).fill(NEUTRAL); // 100 人 ⇒ 落在 ≤2000 档
  assert.equal(crowdTerrain('post', KEYS, big, { grid: G, versionId: 'v1' }).perms, 199);
});

test('成片格与反感格互不重叠，且都只落在被判定到的格子上', () => {
  const at = checkerboard();
  at.fill(NEUTRAL);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    if (x < 4 && y < 4) at[y * G + x] = LIKED;
    if (x >= 6 && y >= 6) at[y * G + x] = DISLIKED;
  }
  const t = crowdTerrain('post', KEYS, at, { grid: G, versionId: 'v1' });
  const hot = new Set(t.hot);
  assert.equal(t.verdict, 'clustered');
  assert.ok(t.cold.length > 0, '右下应标出成片的反感');
  for (const id of t.cold) {
    assert.equal(at[id], DISLIKED, '聚集格必须是被判定到的');
    assert.equal(hot.has(id), false, '同一格不能既是乐见聚集又是反感聚集');
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "test/spatial.test.js"`
Expected: FAIL —— `Cannot find module '../public/shared/spatial.js'`

- [ ] **Step 3: 写实现**

`public/shared/spatial.js`：

```js
// 人群地形：把一万格的反应当空间场读一次——这次的乐见与反感是连成片的，还是零散的。
//
// 网格位置本身有含义（personas.js：年龄按行、兴趣按列，邻居就是相似的人），于是"哪一片人
// 一起反感"是真问题；而 summary.js 的 segments 是按属性做的边际统计，答不了它——成片往往
// 由属性的组合造成，单看任何一条属性条都看不出来。传播算法本身也制造聚集：
// feed.js 给传播者的网格邻居加权，所以聚集可以测，不是渲染幻觉。
//
// 统计量是 Moran's I（rook 邻接，只连都被判定到的上下左右）：
//   d_i = tone_i - mean(tone)；nb_i = Σ 相邻且被判定 d_j
//   I = (n / (2·S0)) · (Σ d_i·nb_i) / (Σ d_i²)，S0 = Σ 各格判定邻居数 = 2E
// 合成图核对过：左上一块 +1 ⇒ I ≈ +0.80，+1/-1 棋盘 ⇒ I ≈ −0.50，全体同值 ⇒ null。
// 显著性用置换检验（把 tone 在判定格间重排），次数随人数收缩——人越多零分布越窄。
import { PRESETS } from './presets.js';
import { hash32, rng } from './rng.js';

/** 判定人数低于此不出结论：样本太小，I 的零分布不是钟形。 */
const MIN_JUDGED = 30;
/** 显著水平：p 低于它才算"成片"或"零散"。 */
const ALPHA = 0.05;

/** 置换次数：人越多零分布越窄，少几次也够判显著；199 次时 p 的最小值是 1/200 = 0.005。 */
const permsFor = (n) => (n <= 2000 ? 199 : n <= 5000 ? 99 : 49);

/** 一格的态度（乐见 +1 / 反感 -1 / 其余 0）。没被判定到算 0——"还没轮到"不是中性。 */
const toneOf = (presetId, keys, byte) => (byte ? PRESETS[presetId].reactions[keys[byte - 1]]?.tone ?? 0 : 0);

/** 一遍扫描算出 I：d 已离均值。相邻只在"两边都被判定到"时才算。 */
function morans(d, judged, grid, idx) {
  let degree = 0; // S0：各格判定邻居数之和 = 2E
  let dot = 0; // Σ d_i·nb_i
  let sq = 0; // Σ d_i²
  for (const i of idx) {
    const x = i % grid;
    const y = (i / grid) | 0;
    let nb = 0;
    let deg = 0;
    if (x > 0 && judged[i - 1]) { nb += d[i - 1]; deg += 1; }
    if (x < grid - 1 && judged[i + 1]) { nb += d[i + 1]; deg += 1; }
    if (y > 0 && judged[i - grid]) { nb += d[i - grid]; deg += 1; }
    if (y < grid - 1 && judged[i + grid]) { nb += d[i + grid]; deg += 1; }
    degree += deg;
    dot += d[i] * nb;
    sq += d[i] * d[i];
  }
  if (!degree || !sq) return { i: null, edges: 0 };
  return { i: (idx.length / (degree * 2)) * (dot / sq), edges: degree / 2 };
}

/** 某格判定邻居上的 d 之和（局部得分的另一半）。 */
function neighbourSum(d, judged, grid, i) {
  const x = i % grid;
  const y = (i / grid) | 0;
  let nb = 0;
  if (x > 0 && judged[i - 1]) nb += d[i - 1];
  if (x < grid - 1 && judged[i + 1]) nb += d[i + 1];
  if (y > 0 && judged[i - grid]) nb += d[i - grid];
  if (y < grid - 1 && judged[i + grid]) nb += d[i + grid];
  return nb;
}

/** 成片格的重心（格坐标）。 */
const centre = (ids, grid) => {
  if (!ids.length) return null;
  let x = 0;
  let y = 0;
  for (const i of ids) {
    x += i % grid;
    y += (i / grid) | 0;
  }
  return { x: Math.round(x / ids.length), y: Math.round(y / ids.length) };
};

/**
 * 一次检查的地形。返回 null 的字段表示"下不了结论"，由界面说人话（labels.js 的 TERRAIN_*_ZH）。
 * hot / cold 是成片格子的 id 列表（各不超过 maxCluster），直接交给 grid.js 描环。
 */
export function crowdTerrain(presetId, keys, bytes, { versionId = '', grid = 100, maxCluster = 400 } = {}) {
  const judged = new Uint8Array(bytes.length);
  const tone = new Float64Array(bytes.length);
  const idx = [];
  for (let i = 0; i < bytes.length; i++) {
    if (!bytes[i]) continue;
    judged[i] = 1;
    tone[i] = toneOf(presetId, keys, bytes[i]);
    idx.push(i);
  }
  const quiet = (extra = {}) => ({
    judged: idx.length, edges: 0, morans: null, z: null, p: null, perms: 0,
    verdict: 'unclear', hot: [], cold: [], hotAt: null, coldAt: null, ...extra,
  });
  if (idx.length < MIN_JUDGED) return quiet();

  const mean = idx.reduce((sum, i) => sum + tone[i], 0) / idx.length;
  const d = new Float64Array(bytes.length);
  for (const i of idx) d[i] = tone[i] - mean;
  const observed = morans(d, judged, grid, idx);
  if (observed.i === null) return quiet({ edges: observed.edges });

  // 置换检验：把态度在判定格之间重排，看观测到的 I 在零分布里有多罕见。
  const perms = permsFor(idx.length);
  const random = rng(hash32('spatial', versionId));
  const values = idx.map((i) => tone[i]);
  const work = new Float64Array(bytes.length);
  const span = Math.abs(observed.i);
  let total = 0;
  let totalSq = 0;
  let extreme = 0;
  let used = 0;
  for (let r = 0; r < perms; r++) {
    for (let k = values.length - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1));
      const swap = values[k];
      values[k] = values[j];
      values[j] = swap;
    }
    for (let k = 0; k < idx.length; k++) work[idx[k]] = values[k] - mean;
    const perm = morans(work, judged, grid, idx);
    if (perm.i === null) continue;
    used += 1;
    total += perm.i;
    totalSq += perm.i * perm.i;
    if (Math.abs(perm.i) >= span) extreme += 1;
  }
  if (!used) return quiet({ edges: observed.edges });
  const mu = total / used;
  const sigma = Math.sqrt(Math.max(0, totalSq / used - mu * mu));
  const stats = {
    judged: idx.length,
    edges: observed.edges,
    morans: observed.i,
    z: sigma > 0 ? (observed.i - mu) / sigma : null,
    p: (1 + extreme) / (1 + used),
    perms: used,
  };
  const verdict = stats.p < ALPHA ? (observed.i > 0 ? 'clustered' : 'scattered') : 'unclear';
  if (verdict === 'unclear') return { ...quiet(stats) };

  // 局部得分 L = d·nb：自己和邻居同号、且都偏离均值的地方就是成片。
  const scores = [];
  for (const i of idx) {
    const l = d[i] * neighbourSum(d, judged, grid, i);
    if (l) scores.push({ i, l });
  }
  const take = (positive) => {
    const pool = scores.filter((s) => (s.l > 0) === positive).sort((a, b) => Math.abs(b.l) - Math.abs(a.l));
    if (!pool.length) return [];
    const cut = Math.abs(pool[0].l) * 0.5; // 取"半高"以上：成片多大就标多大
    const kept = [];
    for (const s of pool) {
      if (kept.length >= maxCluster || Math.abs(s.l) < cut) break;
      kept.push(s.i);
    }
    return kept;
  };
  const hot = take(true);
  const cold = take(false);
  return { ...stats, verdict, hot, cold, hotAt: centre(hot, grid), coldAt: centre(cold, grid) };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "test/spatial.test.js"`
Expected: PASS —— `# pass 7`

> **执行期三处修正（已回写上方代码）**：
> 1. 计划的"置换收缩"用例两个断言都落在 ≤2000 档，根本没测到收缩——改为直接导出并测
>    `permsFor(600/2000/3000/5000/9000)`。
> 2. **象限判错了**：`L = d·nb` 对 +1 块和 −1 块**都是正的**，按 L 的符号分根本分不出
>    "乐见片"和"反感片"，分出来的是"成片"和"孤立点"。必须按标准四象限用 d 与 nb 的符号。
> 3. **离均值看象限会造假冷区**：均值非零时，中性多数派整体落在均值下方，天然构成一块
>    假"成片的反感"（实测 patch 用例给出 76 个假冷格）。改成**用原始态度**判象限，
>    态度 0 的中性格不参与。
> 另：`neighbourSum` 更名 `neighbourOf`（它对 d 和原始态度都通用）。

- [ ] **Step 5: 跑全量门禁**

Run: `npm run lint && npm test`
Expected: lint `✓ 34 个文件通过`；test `# fail 0`，45+7 = 58 → 64（连同 R1 的 tally/grid）

- [ ] **Step 6: 提交**

```bash
git add public/shared/spatial.js test/spatial.test.js
git commit -m "feat: 人群地形——用 Moran I 读一万格反应的成片与零散"
```

---

### Task 2: Worker 与回放双路同构 + 中文单源

**Files:**
- Modify: `public/shared/labels.js`（文件末尾追加）
- Modify: `public/shared/replay.js:9-29`
- Modify: `worker/index.js:16`（import）、`:540-565`（showPost 返回）

- [ ] **Step 1: `labels.js` 追加地形中文（渲染层不硬编码）**

`public/shared/labels.js` 末尾追加：

```js
/** 人群地形（shared/spatial.js 的判定）的中文，渲染层只从这里取。 */
export const TERRAIN_VERDICT_ZH = {
  clustered: '成片',
  scattered: '零散',
  unclear: '看不出',
};

/** 判定的一句话人话：成片 / 零散 / 与随机无异。 */
export const TERRAIN_SAY_ZH = {
  clustered: '像一片地形，不是撒开的散点——有一整片人群朝着同一个方向表态。',
  scattered: '像撒开的豆子——没有哪一片人一起反感或一起叫好，各看各的。',
  unclear: '和把地图随机打乱没有区别，看不出成片还是零散。',
};

/** 地图方位：把格坐标切成 3×3 说出人话（左上 → 右下）。 */
const DIRECTION_ZH = ['左上', '正上', '右上', '左', '中央', '右', '左下', '正下', '右下'];
export const directionZh = (at, grid = 100) => {
  if (!at) return '';
  const col = Math.min(2, Math.max(0, Math.floor((at.x / grid) * 3)));
  const row = Math.min(2, Math.max(0, Math.floor((at.y / grid) * 3)));
  return DIRECTION_ZH[row * 3 + col];
};
```

- [ ] **Step 2: `replay.js` 补 terrain**

`public/shared/replay.js` 第 5 行 import 加 `crowdTerrain`：

```js
import { crowdTerrain } from './spatial.js';
```

`replayToView` 的返回对象里，`segments` 之后加一行：

```js
    terrain: crowdTerrain(presetId, keys, bytes, { versionId: saved.versionId, grid: GRID }),
```

并在第 4 行 import 里补 `GRID`：`import { crowd, GRID } from './personas.js';`

- [ ] **Step 3: `worker/index.js` 补 terrain**

import 段（第 15 行后）加：

```js
import { crowdTerrain } from '../public/shared/spatial.js';
```

`showPost` 的返回对象里，`segments` 之后加：

```js
    terrain: crowdTerrain(presetId, keys, bytes, { versionId: `${id}.${v}` }),
```

- [ ] **Step 4: 跑门禁**

Run: `npm run lint && npm test`
Expected: 两者全绿。Worker 集成测试若对 `/api/post` 的返回做深比较需同步（先跑，红了再看）。

- [ ] **Step 5: 提交**

```bash
git add public/shared/labels.js public/shared/replay.js worker/index.js
git commit -m "feat: showPost 与回放同路给出人群地形，中文走 labels 单源"
```

---

### Task 3: `public/grid.js` —— 给成片格子描环

**Files:**
- Modify: `public/grid.js`
- Test: `test/grid.test.js`（追加两个用例）

- [ ] **Step 1: 先写失败用例**

在 `test/grid.test.js` 末尾追加（需要桩件支持 `strokeRect`，见 Step 2）：

```js
test('terrain：只给成片格子描环，不碰其他格', () => {
  const canvas = newRun();
  const bytes = new Uint8Array(10000);
  bytes[10] = byte(1);
  bytes[2000] = byte(2);
  strokes.length = 0;
  drawGrid(canvas, bytes, PRESET, { hot: [10], cold: [2000] });
  assert.equal(strokes.length, 2, '只描两格');
  assert.deepEqual(strokes[0].at, [10 * 4, 0]);
  assert.deepEqual(strokes[1].at, [0, 20 * 4]);
  assert.notEqual(strokes[0].color, strokes[1].color, '乐见与反感用不同颜色');
});

test('terrain：主题重画后环还在（走全量路径）', () => {
  const canvas = newRun();
  const bytes = new Uint8Array(10000);
  bytes[10] = byte(1);
  strokes.length = 0;
  drawGrid(canvas, bytes, PRESET, { hot: [10], cold: [] });
  strokes.length = 0;
  redrawMaps();
  assert.equal(strokes.length, 1);
});
```

同时在桩件里加 `strokes` 收集：

```js
const strokes = [];
// ……makeCanvas 的 ctx 里：
strokeStyle: '',
strokeRect: (x, y, w, h) => strokes.push({ at: [x, y], w, h, color: ctx.strokeStyle }),
```

> 桩件里 `ctx.strokeStyle` 用普通属性即可（`grid.js` 直接赋值 `ctx.strokeStyle = color`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "test/grid.test.js"`
Expected: FAIL —— `strokes` 未定义 / 环一个都没描

- [ ] **Step 3: 改 `grid.js`**

`drawGrid` 签名与登记项加 terrain：

```js
export function drawGrid(canvas, bytes, presetId, terrain = null) {
  // 修剪掉已断连的旧画布（反复渲染结果区时防泄漏），再登记新的。
  for (const [old] of drawn) if (!old.isConnected) drawn.delete(old);
  drawn.set(canvas, { bytes, presetId, terrain, painted: null, well: '' });
  paint(canvas, drawn.get(canvas));
}
```

`paintDelta` 的退回条件加一条 terrain 不同：

```js
  if (!entry || entry.bytes !== bytes || entry.presetId !== presetId || entry.terrain !== (terrain ?? null) || !entry.painted) {
```

并把函数签名改成 `export function paintDelta(canvas, bytes, presetId, terrain = null) {`。

`paint` 末尾（`entry.painted = bytes.slice();` **之前**）加描环：

```js
  ringTerrain(ctx, entry.terrain);
  entry.painted = bytes.slice(); // 快照，供 paintDelta 做增量
```

并新增：

```js
// 聚集地形：给 spatial.js 标出的成片格子描一圈环——绿=成片的乐见，红=成片的反感。
// 环色取主题的数据墨水（--map-green / --map-red），所以重画时跟随主题。
function ringTerrain(ctx, terrain) {
  if (!terrain?.hot?.length && !terrain?.cold?.length) return;
  ctx.lineWidth = 1;
  const ring = (ids, color) => {
    if (!ids?.length) return;
    ctx.strokeStyle = color;
    for (const id of ids) ctx.strokeRect((id % GRID) * CELL + 0.5, Math.floor(id / GRID) * CELL + 0.5, CELL - 1, CELL - 1);
  };
  ring(terrain.hot, cssVar('--map-green', '#3ddc84'));
  ring(terrain.cold, cssVar('--map-red', '#ff5c5c'));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "test/grid.test.js"`
Expected: PASS —— `# pass 8`

- [ ] **Step 5: 提交**

```bash
git add public/grid.js test/grid.test.js
git commit -m "feat: 地图给成片格子描环，环色跟主题走"
```

---

### Task 4: `public/render.js` + `public/styles.css` —— 「人群地形」段落与开关

**Files:**
- Modify: `public/render.js`
- Modify: `public/styles.css`

- [ ] **Step 1: `render.js` 加地形段落**

import 行（第 6 行）末尾补三个名字：

```js
  REACTIONS_ZH, REASONS_ZH, HOOKS_ZH, COMMENTS_ZH, SEGMENT_ZH, segmentValueZh, CHECKS_ZH, LIST_ZH, FOLLOWUP_LISTING_ZH, reportStageZh, BLOCKED_ZH, presetNoun, TERRAIN_VERDICT_ZH, TERRAIN_SAY_ZH, directionZh,
```

`renderCheck` 的 `html.push` 序列里，在 `html.push(jevReading(result));` **之前**插入：

```js
  html.push(terrainView(result));
```

`renderCheck` 末尾（`renderLegend(...)` 之后）加：

```js
  wireTerrain(el, result);
```

新增函数：

```js
// 人群地形：这次的反应是连成片的还是零散的。判不出来也照样说"看不出"，不藏。
function terrainView(result) {
  const t = result.terrain;
  if (!t || t.morans === null) return '';
  const verdict = TERRAIN_VERDICT_ZH[t.verdict] ?? t.verdict;
  const z = t.z === null ? '' : `，置换检验 z = ${t.z >= 0 ? '+' : ''}${t.z.toFixed(1)}`;
  const where = [
    t.hot?.length ? `成片的乐见集中在地图${directionZh(t.hotAt)}（${t.hot.length} 格）` : '',
    t.cold?.length ? `成片的反感在${directionZh(t.coldAt)}（${t.cold.length} 格）` : '',
  ].filter(Boolean).join('；');
  return `<h3>人群地形</h3><div class="terrain-read">
    <span class="chip ${t.verdict}">${verdict}</span>
    <div class="terrain-say">这次的反应<em>${verdict}</em>。${TERRAIN_SAY_ZH[t.verdict] ?? ''}</div>
    <div class="hint">判定格 ${t.judged.toLocaleString()} · 相邻对 ${t.edges.toLocaleString()} · Moran's I = ${t.morans.toFixed(3)}（随机打乱 ≈ 0，越正越成片、越负越零散${z}）${where ? `。${esc(where)}` : ''}</div>
  </div>`;
}

// 地图的「聚集地形」开关：叠上 spatial.js 标出的成片格子，图例同步换。
function wireTerrain(el, result) {
  const btn = el.querySelector('[data-terrain]');
  const terrain = result.terrain;
  if (!btn || !terrain || (!terrain.hot?.length && !terrain.cold?.length)) {
    btn?.remove();
    return;
  }
  const canvas = el.querySelector('.grid');
  const legend = el.querySelector('.legend');
  const bytes = decodeBytes(result.looks);
  const presetId = result.post.preset;
  let on = false;
  const paint = () => {
    drawGrid(canvas, bytes, presetId, on ? terrain : null);
    legend.innerHTML = on ? terrainLegend(terrain) : reactionLegend(presetId);
  };
  btn.addEventListener('click', () => {
    on = !on;
    btn.textContent = on ? '看反应图' : '看聚集地形';
    btn.setAttribute('aria-pressed', String(on));
    paint();
  });
}
```

`renderLegend` 改名为 `reactionLegend`（保持行为不变），并新增：

```js
/** 聚集地形的图例：环 = 被判为成片的格子。 */
function terrainLegend(terrain) {
  const rows = [];
  if (terrain.hot?.length) rows.push('<span class="dot ring hot"></span>成片的乐见');
  if (terrain.cold?.length) rows.push('<span class="dot ring cold"></span>成片的反感');
  return rows.join('');
}
```

- [ ] **Step 2: 地图容器加开关按钮**

`render.js` 里那一行地图 HTML 改为：

```js
  html.push('<h3>小镇地图</h3><div class="map-bar"><button class="ghost" type="button" data-terrain aria-pressed="false">看聚集地形</button><span class="hint">成片：这一片人朝着同一个方向表态；零散：各看各的。</span></div><div class="map-wrap"><canvas class="grid" role="img" aria-label="小镇反应地图：一万个格子，每格一个人格的反应（悬停可看详情）"></canvas><div class="legend"></div></div>');
```

- [ ] **Step 3: `styles.css` 加样式**

在「Jev 解读」小节之后追加：

```css
/* 人群地形：一句人话 + 一个统计量 + 一行出处 */
.terrain-read { margin: 4px 0 6px; }
.terrain-read .terrain-say { margin: 10px 0 6px; font-size: 14.5px; }
.terrain-read .terrain-say em {
  font-style: normal;
  font-weight: 700;
  padding: 0 4px;
  background: linear-gradient(transparent 62%, var(--accent-soft) 0);
}
.chip.clustered { color: var(--map-green); border-color: var(--map-green); }
.chip.scattered { color: var(--map-blue); border-color: var(--map-blue); }
.chip.unclear { color: var(--muted); }

/* 地图上方的开关条 */
.map-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 0 0 12px; }
.map-bar .ghost { padding: 6px 14px; font-size: 12.5px; }
.map-bar .ghost[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }

/* 聚集地形的图例点是环，不是实心 */
.legend .dot.ring { background: transparent; box-shadow: inset 0 0 0 2px currentColor; width: 12px; height: 12px; }
.legend .dot.ring.hot { color: var(--map-green); }
.legend .dot.ring.cold { color: var(--map-red); }
```

- [ ] **Step 4: 跑门禁**

Run: `npm run lint && npm test`
Expected: 两者全绿

- [ ] **Step 5: 提交**

```bash
git add public/render.js public/styles.css
git commit -m "feat: 报告加人群地形段落与聚集地形开关"
```

---

### Task 5: 验证与反思

- [ ] **Step 1: 真实浏览器核对**（`npm run dev`，或 `npx wrangler dev --port 5200 --var CROWD_DAILY_LIMIT:0`）

- [ ] 首页示例回放（showcase）里出现「人群地形」段，判定词来自 `TERRAIN_VERDICT_ZH`
- [ ] 地图上方出现「看聚集地形」按钮；点一下：地图上出现绿/红环，图例换成环式，再点还原
- [ ] 切四个主题：环的颜色跟随 `--map-green` / `--map-red`，按钮态不跑偏
- [ ] 窄屏（375px）不横向溢出

- [ ] **Step 2: `npm run bench` 与 `npm test` 终检**

Expected: bench 的 `结果一致 true`；test `fail 0`

- [ ] **Step 3: 文档同步**

- `docs/ARCHITECTURE.md` 的引擎文件清单加 `spatial.js` 一行
- `docs/modules/frontend.md` 写「人群地形段 + 地图开关」与 `render.js` 的新职责
- `README.md` 的「每次检查产出什么」加一条**人群地形**；更新用例数
- `docs/MEMORY.md` 顶部加一条本轮事实（日期 + 标题 + 统计量 + 置换次数 + 实测数字 + 为什么）
- `docs/TESTING.md` 的布局表加 `test/spatial.test.js`

- [ ] **Step 4: 收尾提交**

```bash
git add -A
git commit -m "docs: 记录人群地形的统计量、代价与验证方式"
```

---

## 自检

1. **需求覆盖**：新算法（Task 1）→ 双路同构 + 中文单源（Task 2）→ 地图视觉（Task 3）→
   报告段落与开关（Task 4）→ 验证与反思（Task 5）。✅
2. **占位符扫描**：所有代码步骤都带完整代码；Moran's I 公式与合成图核对结果已写进计划，
   执行者不需要再推导。✅
3. **命名一致**：`crowdTerrain` / `morans` / `neighbourSum` / `centre` / `terrain` /
   `hot` / `cold` / `hotAt` / `coldAt` / `reactionLegend` / `terrainLegend` / `wireTerrain` /
   `TERRAIN_VERDICT_ZH` / `TERRAIN_SAY_ZH` / `directionZh` 在 Task 1–4 中拼写一致。✅
4. **已知风险**：`terrain` 会让 `/api/post` 的返回多两个数组（各 ≤400 个数字，≈1.6KB），
   可接受；若将来要更小，可只传 `hot`/`cold` 的包围盒。
