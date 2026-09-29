# 两版之差 · 差分地图 实施计划（R5 · 创意）

> **状态：已执行完毕**（2026-09-29，提交 `240e897` → `7e18ce9` → `29e2ef3` → `aca8275`）。
> 结论与实测见 `docs/MEMORY.md` 顶部 R5 条目。执行期对计划做了 4 处修正，见文末
> 「执行期修正」——那几处比计划正文更值得读。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本轮按目标约定**不使用子代理**，在当前会话内按 executing-plans 逐条执行。

**Goal:** 让"改一版再发"真正回答那个问题——**你改的这几个词，让谁改了主意，是成片的还是零散的。**

**Architecture:** 两版的 `looks` 浏览器早就都有了（对比区本来就会拉第 1 版），
所以差分**完全在浏览器里算**，Worker、API、数据库一行不动：
`shared/spatial.js` 新增 `crowdDelta()`——把两版字节数组折成一张"态度差"场
（`tone_新 - tone_旧 ∈ {-2..+2}`），再把 R2 做的 Moran's I 空间自相关**原样套在这个差场上**。
`grid.js` 新增 `drawDelta()` 画发散配色（绿=变好 / 红=变差，按幅度两档），`render.js` 出段落。

**Tech Stack:** 原生 ESM、无框架、canvas 2D、`node:test`、无新依赖、无新模型调用。

---

## 为什么是这个点子

- 产品的核心循环就是**改一版再发**（`app.js` 的 `/api/version` + 对比区），但今天的对比是
  **两张并排的静态图**——读者要自己在脑子里做减法：谁变了、变了多少、变的是哪一片。
- `summary.js` 的 segments 只能回答"这一版里谁乐见"，回答不了"**相对上一版谁变了**"。
- 网格位置有含义（年龄按行、兴趣按列），所以差分也能做空间读数。
  **把 R2 的 Moran I 套到差场上**，问的是一个全新的问题：
  > "你改的这几个词，是**整齐地翻盘了一片人**，还是**零散地多哄到了几个**？"
  这正是改稿时最想知道、而现有界面完全答不了的一句。
- **零成本**：不新增 Jev 调用、不改 schema、不改 Worker。数据两版都已在浏览器内存里。

## 三个设计决定（都是刻意的，不是省事）

1. **只统计"两版都判定到"的人**。一版传到全城、另一版第 2 波就停时，
   只被一版看到的人不是"变得中立了"，而是"这次没被排到"。把两者混在一起会得出
   "你改完稿子，几千个人不看了"这种**结论错误**的说法。所以差场只取交集，
   覆盖差异另计为 `onlyBefore` / `onlyAfter`，在报告里单独一句话说明。
2. **差场用原始态度之差，不用离均值偏差**。理由与 R2 踩过的坑同源：离均值会让
   "原本一致偏正"的一大批人凭空产生假差。
3. **差值编码成 1..5**：`code = delta + 3`（delta ∈ −2..+2 ⇒ 1..5，0 = 不可比），
   于是**一格不可比**与**一格差值为 0**分得开，不会混。

## 文件结构

| 路径 | 动作 | 职责 |
|---|---|---|
| `public/shared/spatial.js` | 改 | 抽出 `terrainOf(values, judged, opts)`；新增 `crowdDelta()` |
| `public/grid.js` | 改 | 新增 `drawDelta(canvas, codes)`：发散配色的差分地图 |
| `public/render.js` | 改 | 新增 `renderDelta(el, after, before)` 段落 |
| `public/app.js` | 改 | 对比区：第 1 版渲染进子节点，差分卡不被 `renderCheck` 清掉 |
| `public/index.html` | 改 | 对比区标题从"第 1 版（对比）"改成"两版对比" |
| `public/shared/labels.js` | 改 | `DELTA_SAY_ZH`（差分判定的中文单源） |
| `public/styles.css` | 改 | `.delta-read` / 差分图例 / `.map-bar` 复用 |
| `test/spatial.test.js` | 改 | `crowdDelta` 的用例 + `terrainOf` 抽出后的回归 |
| `test/grid.test.js` | 改 | `drawDelta` 的桩件用例 |

---

### Task 1: 抽出 `terrainOf`，新增 `crowdDelta`

**Files:**
- Modify: `public/shared/spatial.js`
- Test: `test/spatial.test.js`

- [ ] **Step 1: 先写失败测试**

在 `test/spatial.test.js` 末尾追加：

```js
// -- 两版之差 ----------------------------------------------------------

const deltaOf = (before, after) => crowdDelta('post', KEYS, before, after, { grid: G, versionId: 'd1' });

test('crowdDelta：只统计两版都判定到的人，单版覆盖另计', () => {
  const before = new Uint8Array(G * G);
  const after = new Uint8Array(G * G);
  for (let i = 0; i < 50; i++) before[i] = NEUTRAL;      // 0..49 只有第 1 版看到
  for (let i = 25; i < 80; i++) after[i] = NEUTRAL;       // 25..79 第 2 版看到
  const d = deltaOf(before, after);
  assert.equal(d.both, 55, '交集 25..79 共 55 人');
  assert.equal(d.onlyBefore, 25, '0..24 只有第 1 版看到');
  assert.equal(d.onlyAfter, 25, '80..84 只有第 2 版看到');
});

test('crowdDelta：差值 = 新态度 - 旧态度，向上向下分别计数', () => {
  const before = new Uint8Array(G * G).fill(NEUTRAL);
  const after = new Uint8Array(G * G).fill(NEUTRAL);
  // 0..9 中性 → 乐见（+1）；10..19 乐见 → 中性（-1）；20..24 反感 → 乐见（+2）
  for (let i = 0; i < 10; i++) after[i] = LIKED;
  for (let i = 10; i < 20; i++) before[i] = LIKED;
  for (let i = 20; i < 25; i++) { before[i] = DISLIKED; after[i] = LIKED; }
  const d = deltaOf(before, after);
  assert.equal(d.up, 35, '0..24 全部变好（10 个 +1、5 个 +2、20 个不变）');
  assert.equal(d.down, 10);
  assert.equal(d.net, 35 - 10 + 5 * 1, '净变化 = Σ delta');
  assert.equal(d.codes[0], 4, 'delta=+1 ⇒ code 4');
  assert.equal(d.codes[20], 5, 'delta=+2 ⇒ code 5');
  assert.equal(d.codes[10], 2, 'delta=-1 ⇒ code 2');
  assert.equal(d.codes[30], 3, 'delta=0 ⇒ code 3（不是"不可比"的 0）');
});

test('crowdDelta：不可比的格子 code=0，与"差值为 0"分得开', () => {
  const before = new Uint8Array(G * G).fill(NEUTRAL);
  const after = new Uint8Array(G * G); // 第 2 版一个人都没判定到
  const d = deltaOf(before, after);
  assert.equal(d.both, 0);
  assert.equal(d.onlyBefore, G * G);
  assert.equal(d.terrain.morans, null, '交集为空 ⇒ 不出结论');
  for (const code of d.codes) assert.equal(code, 0);
});

test('crowdDelta：差场也能判成片/零散（把 Moran I 套在差场上）', () => {
  // 左上 4×4 那一块从"划走"翻成"点赞"，其余不变 ⇒ 差场正相关 ⇒ clustered
  const before = new Uint8Array(G * G).fill(NEUTRAL);
  const after = new Uint8Array(G * G).fill(NEUTRAL);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) after[y * G + x] = LIKED;
  const d = deltaOf(before, after);
  assert.equal(d.terrain.verdict, 'clustered');
  assert.ok(d.terrain.morans > 0, `差场的 I 应为正，实际 ${d.terrain.morans}`);
  assert.ok(d.terrain.hot.length > 0, '应标出成片变好的格子');
  assert.equal(d.terrain.cold.length, 0);
});

test('crowdDelta：逐格反号（+1/-1 棋盘）判零散', () => {
  const before = new Uint8Array(G * G).fill(NEUTRAL);
  const after = new Uint8Array(G * G).fill(NEUTRAL);
  for (let i = 0; i < G * G; i++) after[i] = i % 2 ? LIKED : DISLIKED;
  const d = deltaOf(before, after);
  assert.equal(d.terrain.verdict, 'scattered');
  assert.ok(d.terrain.morans < 0);
});

test('crowdDelta：确定性——同输入两次完全一致', () => {
  const before = new Uint8Array(G * G).fill(NEUTRAL);
  const after = new Uint8Array(G * G).fill(NEUTRAL);
  for (let i = 0; i < 40; i++) after[i] = LIKED;
  assert.deepEqual(deltaOf(before, after), deltaOf(before, after));
});

test('crowdDelta：真实默认网格（100×100）也能跑', () => {
  const n = 10000;
  const before = new Uint8Array(n);
  const after = new Uint8Array(n);
  for (let i = 0; i < 3000; i++) { before[i] = 2; after[i] = i < 900 ? 3 : 2; }
  const d = crowdDelta('post', KEYS, before, after, { versionId: 'real' });
  assert.equal(d.both, 3000);
  assert.equal(d.up, 900);
  assert.ok(['clustered', 'scattered', 'unclear'].includes(d.terrain.verdict));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "test/spatial.test.js"`
Expected: FAIL —— `crowdDelta` 未导出（`SyntaxError: The requested module ... does not provide an export named 'crowdDelta'`）

- [ ] **Step 3: 抽出 `terrainOf` 并新增 `crowdDelta`**

`public/shared/spatial.js` 把现有 `crowdTerrain` 的**函数体**改成委托，
真身挪到新导出的 `terrainOf`（值已给定，只做统计）：

```js
/**
 * 一个"已给值"的场做空间统计：terrainOf 是 crowdTerrain 的真身。
 * values[i] 是格子 i 的取值（未判定为 0），judged[i]=1 表示这一格被判定到。
 * crowdDelta 复用它——把"两版态度之差"当成场，统计代码一行都不用重写。
 */
export function terrainOf(values, judged, { versionId = '', grid = 100, maxCluster = 400 } = {}) {
  const idx = [];
  for (let i = 0; i < judged.length; i++) if (judged[i]) idx.push(i);
  const quiet = (extra = {}) => ({
    judged: idx.length, edges: 0, morans: null, z: null, p: null, perms: 0,
    verdict: 'unclear', hot: [], cold: [], hotAt: null, coldAt: null, ...extra,
  });
  if (idx.length < MIN_JUDGED) return quiet();

  const mean = idx.reduce((sum, i) => sum + values[i], 0) / idx.length;
  const d = new Float64Array(judged.length);
  for (const i of idx) d[i] = values[i] - mean;
  const observed = morans(d, judged, grid, idx);
  if (observed.i === null) return quiet({ edges: observed.edges });

  // ……以下与原 crowdTerrain 完全相同（置换检验 + 局部象限 + 重心）……
}
```

> **执行时注意**：`terrainOf` 里 `mean` 与离均值数组 `d` 只服务于 Moran's I；
> 局部象限那段必须继续用**原始 `values`**（R2 的教训：离均值看象限会造假冷区）。
> 其余代码从原 `crowdTerrain` 原样搬，只把 `tone[i]` 全换成 `values[i]`、
> 把 `tone` 数组换成 `values`，`toneOf()` 那一行删掉。

原来的 `crowdTerrain` 改为薄封装：

```js
/** 一次检查的地形。tone 由 presets 的 reaction.tone 给出，未判定为 0。 */
export function crowdTerrain(presetId, keys, bytes, opts = {}) {
  const judged = new Uint8Array(bytes.length);
  const values = new Float64Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    if (!bytes[i]) continue;
    judged[i] = 1;
    values[i] = PRESETS[presetId].reactions[keys[bytes[i] - 1]]?.tone ?? 0;
  }
  return terrainOf(values, judged, opts);
}
```

文件末尾新增：

```js
/**
 * 两版之差。返回一张"态度差"场（tone_新 - tone_旧 ∈ {-2..2}）与它的空间统计。
 *
 * 只统计**两版都判定到**的人：只被一版排到的人不是"变得中立了"，而是"这次没轮到"，
 * 混进来会得出"你改完稿子几千人不看了"这种结论错误的说法。覆盖差异另计为
 * onlyBefore / onlyAfter，由界面单独一句话说明。
 *
 * codes 打包给界面：code = delta + 3（delta ∈ {-2..2} ⇒ 1..5），0 = 不可比。
 * 于是"一格差值为 0"（3）和"这一格没被两版同时看到"（0）分得开。
 */
export function crowdDelta(presetId, keys, before, after, { versionId = '', grid = 100, maxCluster = 400 } = {}) {
  const size = before.length;
  const judged = new Uint8Array(size);
  const values = new Float64Array(size);
  const codes = new Uint8Array(size);
  let both = 0;
  let onlyBefore = 0;
  let onlyAfter = 0;
  let up = 0;
  let down = 0;
  let net = 0;
  const tone = (bytes, i) => PRESETS[presetId].reactions[keys[bytes[i] - 1]]?.tone ?? 0;
  for (let i = 0; i < size; i++) {
    const a = before[i];
    const b = after[i];
    if (a && b) {
      const delta = tone(after, i) - tone(before, i);
      judged[i] = 1;
      values[i] = delta;
      codes[i] = delta + 3;
      both += 1;
      net += delta;
      if (delta > 0) up += 1;
      else if (delta < 0) down += 1;
    } else if (a) onlyBefore += 1;
    else if (b) onlyAfter += 1;
  }
  return { both, onlyBefore, onlyAfter, up, down, net, codes, terrain: terrainOf(values, judged, { versionId: `delta:${versionId}`, grid, maxCluster }) };
}
```

- [ ] **Step 4: 跑测试**

Run: `node --test "test/spatial.test.js"`
Expected: PASS —— `# pass 14`（原 8 + 新 6）。**原有 8 个用例必须仍全绿**——那 8 个就是
`terrainOf` 抽出的安全网。

- [ ] **Step 5: 提交**

```bash
git add public/shared/spatial.js test/spatial.test.js
git commit -m "feat: crowdDelta 把两版折成态度差场，并复用 Moran I 判差分是成片还是零散"
```

---

### Task 2: `grid.js` 的 `drawDelta` —— 发散配色差分地图

**Files:**
- Modify: `public/grid.js`
- Test: `test/grid.test.js`

- [ ] **Step 1: 先写失败测试**

`test/grid.test.js` 末尾追加（桩件里 `TOKENS` 需要补两个令牌）：

```js
test('drawDelta：只画有差值的格子，0 铺底板、不可比也是底板', () => {
  const canvas = newRun();
  const codes = new Uint8Array(10000); // 0 = 不可比
  codes[5] = 4;   // +1
  codes[7] = 5;   // +2
  codes[9] = 2;   // -1
  codes[11] = 1;  // -2
  drawDelta(canvas, codes);
  assert.equal(calls.length, 5, '底板 1 次 + 4 个有差值的格子');
  assert.equal(calls[0].fill, TOKENS['--map-well'], '先铺底板');
  const painted = calls.slice(1).map((c) => c.fill);
  assert.equal(new Set(painted).size, 4, '两档幅度 × 两个方向 = 四种颜色');
});

test('drawDelta：同号同幅度同色，异号异色（发散配色）', () => {
  const canvas = newRun();
  const codes = new Uint8Array(10000);
  codes[1] = 4; codes[2] = 4;      // 两个 +1
  codes[3] = 2; codes[4] = 2;      // 两个 -1
  drawDelta(canvas, codes);
  const at = (id) => calls.find((c) => c.x === (id % 100) * 4 && c.y === Math.floor(id / 100) * 4).fill;
  assert.equal(at(1), at(2), '同号同幅度必须同色');
  assert.equal(at(3), at(4));
  assert.notEqual(at(1), at(3), '正负必须异色');
});

test('drawDelta：全部不可比时只铺底板', () => {
  const canvas = newRun();
  drawDelta(canvas, new Uint8Array(10000));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fill, TOKENS['--map-well']);
});
```

桩件的 `TOKENS` 补上墨水：

```js
const TOKENS = { '--map-well': '#0a0d13', '--map-green': '#3ddc84', '--map-red': '#ff5c5c' };
```
（已是这个值，无需改；`drawDelta` 用 `--map-green` / `--map-red`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test "test/grid.test.js"` —— Expected: FAIL（`drawDelta` 未导出）

- [ ] **Step 3: 实现 `drawDelta`**

`public/grid.js` 末尾追加：

```js
// 两版之差的发散配色：绿=变好、红=变差，幅度大的画满、幅度小的与底板掺半。
// 墨水仍取主题数据墨水，所以四个主题各自成立；不用 LOOKS——那是"是什么反应"的色板，
// 这里是"变了多少"的量表，语义不同。
const mixHex = (a, b, t) => {
  const at = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const bt = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${at.map((v, i) => Math.round(v + (bt[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

/**
 * 差分地图：codes 来自 shared/spatial.js 的 crowdDelta（code = delta + 3，0 = 不可比）。
 * 返回画了几个格子。走独立绘制路径，不登记进 drawn——它没有悬停档案，
 * 主题切换时随对比区重渲染即可。
 */
export function drawDelta(canvas, codes) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = GRID * CELL * dpr;
  canvas.height = GRID * CELL * dpr;
  canvas.style.width = `${GRID * CELL}px`;
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const well = cssVar('--map-well', '#0a0d13');
  ctx.fillStyle = well;
  ctx.fillRect(0, 0, GRID * CELL, GRID * CELL);
  const green = cssVar('--map-green', '#3ddc84');
  const red = cssVar('--map-red', '#ff5c5c');
  // 四个格子色：+2 满绿、+1 半绿、-1 半红、-2 满红
  const inks = [null, mixHex(well, red, 1), mixHex(well, red, 0.5), null, mixHex(well, green, 0.5), mixHex(well, green, 1)];
  let touched = 0;
  for (let id = 0; id < codes.length; id++) {
    const ink = inks[codes[id]];
    if (!ink) continue;
    ctx.fillStyle = ink;
    ctx.fillRect((id % GRID) * CELL, Math.floor(id / GRID) * CELL, CELL - 1, CELL - 1);
    touched += 1;
  }
  return touched;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test "test/grid.test.js"` —— Expected: PASS —— `# pass 13`

- [ ] **Step 5: 提交**

```bash
git add public/grid.js test/grid.test.js
git commit -m "feat: 差分地图画在四主题上——发散配色，幅度大的画满"
```

---

### Task 3: 报告段落 + 对比区接线

**Files:**
- Modify: `public/shared/labels.js`、`public/render.js`、`public/app.js`、`public/index.html`、`public/styles.css`

- [ ] **Step 1: `labels.js` 加差分中文（单源）**

末尾追加：

```js
/** 两版之差（shared/spatial.js 的 crowdDelta）的中文，渲染层只从这里取。 */
export const DELTA_SAY_ZH = {
  clustered: '翻盘是成片的——你改的这几个词，把一整片人从划走推到了点赞那边。',
  scattered: '翻盘是零散的——没有哪一片人整齐地改了主意，你多哄到的是零散几个。',
  unclear: '看不出成片：改动落在地图上是随机的，没有哪一片人整齐地转过来。',
};
```

- [ ] **Step 2: `render.js` 加 `renderDelta`**

import 补 `crowdDelta`（来自 `./shared/spatial.js`）、`drawDelta`（`./grid.js`）、
`DELTA_SAY_ZH`（`./shared/labels.js`）。文件末尾新增导出：

```js
/**
 * 两版之差：改一版再发之后，"你改的这几个词让谁改了主意"。
 * 全部在浏览器里算——两版的 looks 本来就都在内存里，不新增 Jev 调用。
 */
export function renderDelta(el, after, before) {
  if (!before || before.post.preset !== after.post.preset) {
    el.innerHTML = '';
    return;
  }
  const presetId = after.post.preset;
  const keys = Object.keys(PRESETS[presetId].reactions);
  const d = crowdDelta(presetId, keys, decodeBytes(before.looks), decodeBytes(after.looks), {
    versionId: `${after.post.id}-${before.post.id}`,
  });
  if (!d.both) {
    el.innerHTML = '<h3>两版之差</h3><div class="delta-read"><p class="hint">两版没有任何一个人被同时判定到，没有可比的差分。</p></div>';
    return;
  }
  const reach = d.onlyBefore || d.onlyAfter
    ? `这一版比上一版${d.onlyAfter > d.onlyBefore ? '多' : '少'}排到了 ${Math.abs(d.onlyAfter - d.onlyBefore).toLocaleString()} 个人。`
    : '两版的传播范围一样大。';
  const verdict = TERRAIN_VERDICT_ZH[d.terrain.verdict] ?? d.terrain.verdict;
  const where = [
    d.terrain.hot.length ? `成片变好在地图${directionZh(d.terrain.hotAt)}（${d.terrain.hot.length} 格）` : '',
    d.terrain.cold.length ? `成片变差在${directionZh(d.terrain.coldAt)}（${d.terrain.cold.length} 格）` : '',
  ].filter(Boolean).join('；');
  el.innerHTML = `<h3>两版之差</h3>
    <div class="delta-read">
      <div class="stats">
        ${stat(d.up.toLocaleString(), '变好的人')}
        ${stat(d.down.toLocaleString(), '变差的人')}
        ${stat(d.net.toLocaleString(), '净态度变化')}
        ${stat(d.both.toLocaleString(), '两版都看到的人')}
      </div>
      <div class="terrain-say">改动的分布<em>${verdict}</em>。${DELTA_SAY_ZH[d.terrain.verdict] ?? ''}</div>
      <div class="hint">差分只统计两版都被判定到的 ${d.both.toLocaleString()} 人（只被一版排到的人不算"变中立"）。${esc(reach)}${where ? ` ${esc(where)}。` : ''} 差场的 Moran's I = ${d.terrain.morans === null ? '不可比' : d.terrain.morans.toFixed(3)}</div>
    </div>
    <div class="map-bar"><span class="hint">差分图：绿=变好，红=变差，颜色越满变化越大；底色=两版都没排到或没有变化。</span></div>
    <div class="map-wrap"><canvas class="grid diff" role="img" aria-label="差分地图：这一版相对上一版，哪些人变好、哪些人变差"></canvas><div class="legend delta-legend">${deltaLegend()}</div></div>`;
  drawDelta(el.querySelector('canvas.diff'), d.codes);
}

/** 差分图例：两档幅度 × 两个方向。 */
function deltaLegend() {
  return '<span class="dot" style="background:color-mix(in srgb, var(--map-green) 50%, var(--map-well))"></span>小幅变好'
    + '<span class="dot" style="background:var(--map-green)"></span>大幅变好'
    + '<span class="dot" style="background:color-mix(in srgb, var(--map-red) 50%, var(--map-well))"></span>小幅变差'
    + '<span class="dot" style="background:var(--map-red)"></span>大幅变差';
}
```

- [ ] **Step 3: `app.js` 对比区接线**

`showResult` 里载入第 1 版的监听器，替换为：

```js
    slot.querySelector('#loadCompare').addEventListener('click', async () => {
      slot.textContent = '载入中……';
      try {
        const v1 = await getJSON(`/api/post/${current.post}?v=1`);
        // renderCheck 会清空容器，所以第 1 版渲染进子节点，差分卡才不会被一起清掉
        const diff = document.createElement('div');
        const v1card = document.createElement('div');
        slot.replaceChildren(diff, v1card);
        renderCheck(v1card, v1);
        renderDelta(diff, view, v1);
      } catch (error) {
        slot.innerHTML = `<span class="error">${esc(error.message)}</span>`;
      }
    });
```

import 行加上 `renderDelta`（与 `renderCheck` 同一个 import 语句）。

- [ ] **Step 4: `index.html` 改对比区标题**

```html
    <section id="compare" class="plate" hidden>
      <h2>两版对比</h2>
    </section>
```

- [ ] **Step 5: `styles.css` 加差分样式**

在人群地形那节之后追加：

```css
/* 两版之差 */
.delta-read { margin: 4px 0 6px; }
.delta-read .terrain-say { margin: 14px 0 6px; font-size: 14.5px; }
.delta-read .terrain-say em {
  font-style: normal;
  font-weight: 700;
  padding: 0 4px;
  background: linear-gradient(transparent 62%, var(--accent-soft) 0);
}
.delta-legend { min-width: 0; }
canvas.grid.diff { cursor: default; }
```

- [ ] **Step 6: 跑门禁**

Run: `npm run lint && npm test` —— Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add public/shared/labels.js public/render.js public/app.js public/index.html public/styles.css
git commit -m "feat: 对比区给出两版之差——谁改了主意、成片还是零散"
```

---

### Task 4: 验证与反思

- [ ] **Step 1: 门禁**

Run: `npm run lint && npm test && npm run bench` —— Expected: 全绿

- [ ] **Step 2: 端到端核对（无头 Edge + CDP 驱动一次真实的"改一版再发"）**

- 跑一次检查拿到 v1 → 点「改一版再发」→ 改几个词 → 再发 → 载入第 1 版对比
- 「两版之差」段出现，统计与差分图都在
- 切四个主题：差分图两种墨色各自成立，图例跟着走
- 375px 无横向溢出，控制台无错误

- [ ] **Step 3: 文档**

- `README.md`「每次检查产出什么」加一条**两版之差**
- `docs/modules/frontend.md` 写差分段的职责
- `docs/modules/shared-engine.md` 的 `spatial.js` 小节补 `crowdDelta` / `terrainOf`
- `docs/MEMORY.md` 顶部加一条 R5 事实

- [ ] **Step 4: 收尾提交**

```bash
git add -A
git commit -m "docs: 记录两版之差的口径、决定与验证方式"
```

---

## 自检

1. **范围**：Worker / API / schema / D1 **零改动**；新增只在 `shared/spatial.js`（纯函数）、
   `grid.js`（新增导出）、`render.js`（新增导出）、`app.js`（对比区接线）。
   不新增 Jev 调用、不新增依赖。✅
2. **占位符**：所有代码步骤带完整代码与精确命令、预期输出。✅
3. **命名一致**：`terrainOf` / `crowdDelta` / `drawDelta` / `renderDelta` / `deltaLegend` /
   `DELTA_SAY_ZH` / `codes` / `onlyBefore` / `onlyAfter` 在 Task 1–3 中拼写一致。✅
4. **确定性**：`terrainOf` 的置换用 `hash32('spatial', \`delta:${versionId}\`)` 播种，
   同 versionId 必得同结果；`crowdDelta` 无随机。✅
5. **已知取舍**：差分只对**同预设**的两版有意义（`renderDelta` 里判了，不一致就不渲染）。
   存档示例的两条（v1/v2）是两张独立回放卡，不串成差分——留给以后决定。

---

## 执行期修正（计划本身写错、被测试或核对当场抓住的地方）

1. **计划里"reach 相等时"的文案会造病句**：`这一版比上一版少排到了 0 个人`——
   `onlyBefore === onlyAfter > 0` 时两版各自排到了对方没排到的一样多人。改成
   "两版各有 N 个人只被自己排到"。
2. **`terrainOf` 的象限坑在差场上会翻倍**：计划只提醒"局部象限用原始 values"，
   但差场本身可正可负，`hot`/`cold` 的语义随之变成"成片变好/成片变差"——
   `renderDelta` 的 `where` 文案按这个语义写，没有照抄地形那句"成片的乐见/反感"。
3. **"主题切换时随对比区重渲染即可"不成立**：对比区没有任何东西会因主题切换而重渲染，
   差分画布于是留着上一个主题的墨水。修正为 `drawDelta` 把画布登记进另册 `deltas`，
   `redrawMaps` 一并重画（回归用例兜底）。
4. **375px 整页横向溢出（R3 留下的既有缺陷，本轮 E2E 抓出）**：`.examples .card`
   是网格项，自动最小尺寸 = 内容 min-content，被 ≤560px 的 nowrap 目录撑到 634px，
   整页出现横向滚动条。修法是给网格项 `min-width: 0`（目录自己内部横滑）。
