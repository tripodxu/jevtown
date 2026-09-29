# segments() 预编译分组 实施计划（R4 · 优化）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本轮按目标约定**不使用子代理**，在当前会话内按 executing-plans 逐条执行。

**Goal:** 把报告页每个请求的头号开销（`segments()` 实测 19.1ms）降到个位数毫秒，行为逐字节不变。

**Architecture:** 分组名 `` `${attribute}:${value}` `` 与"这一维取哪些值"的形状是**人群的常量**，
与一次检查无关。把它按 `people` 数组身份预编译成一张 CSR（压缩行）表——每人一段连续的分组号——
之后 `segments()` 的热路径只剩整数读写：`segments()` 的调用方（Worker 的 `showPost`、
浏览器的 `replay.js`）**一行都不用改**。

**Tech Stack:** 原生 ESM、无框架、`node:test`、无新依赖。

---

## 取证：先剖析，再优化

`showPost` 里每请求跑一次的纯计算，逐项热态实测（Node 24.9，10 000 格全判定）：

| 项 | 耗时 | 备注 |
|---|---|---|
| `crowd()` | **111 ms** | isolate 级缓存，**每进程只一次**，不计入单请求 |
| **`segments()`** | **19.13 ms** | ★ 每请求都跑，唯一的头号开销 |
| `crowdTerrain()` | 8.48 ms | R2 新增，见下方取舍 |
| `voicesOf()` | 1.16 ms | |
| `counters()` | 0.40 ms | |
| `encodeBytes()` | 0.23 ms | |
| `topSegments()` ×3 | 0.03 ms | |

单请求纯计算合计 ≈ **29.4 ms**——Cloudflare 免费档每请求 10ms CPU，所以这里已经超了约 3 倍。
`segments()` 占其中 **65%**。

**为什么 `segments()` 这么贵**（`summary.js:49-80`）：热路径在"对 10 000 个人"的外层循环里，
而循环体每次都重做三件本该只做一次的事：

1. `Object.entries(SEGMENTS)` —— **对每一个人**新建一次 7 项数组 → 10 000 次分配；
2. `valuesOf(who)` —— 每个维度一次函数调用 + 一次数组字面量 → 70 000 次分配；
3. `` const id = `${attribute}:${value}` `` + `tallies.get(id)` —— **70 000 次**字符串拼接与哈希。

真正逐请求变化的只有 `reactions[who.id]` 这一个字节。把不变的部分搬出循环即可。

**为什么不改 `crowd()`**：111ms 是 isolate 缓存的一次性成本，Worker 的模块作用域跨请求存活，
热身后每请求 0ms。动它属于路线图 Step 4 的"人格打包管线"，是另一件事，不在本轮。

**为什么不砍 `crowdTerrain()` 的置换次数**：8.5ms 换来的是统计显著性。R2 已按人数把次数
收缩到 199/99/49，再砍就动到结论本身了。真要省，正确做法是 Worker 侧缓存（按 `post.v` 记），
不在本轮。

## 文件结构

| 路径 | 动作 | 职责 |
|---|---|---|
| `public/shared/summary.js` | 改 | 新增 `groupTable(people)`（WeakMap 缓存）+ 重写 `segments()` 热路径 |
| `test/summary.test.js` | **新建** | 预编译表 vs 旧写法的逐字段对拍 + 缓存与不变量 |
| `docs/MEMORY.md`、`docs/modules/shared-engine.md` | 改 | 记录剖析数字与改法 |

---

### Task 1: 先把旧实现钉成"参照实现"，写对拍测试

**Files:**
- Test: `test/summary.test.js`

- [ ] **Step 1: 写测试（对拍是本轮的安全网，前两轮都靠它抓过 bug）**

`test/summary.test.js`：

```js
// segments() 的预编译版与旧写法必须逐字段一致：把旧实现原样抄进测试当参照实现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crowd, CROWD } from '../public/shared/personas.js';
import { segments, minSegment } from '../public/shared/summary.js';
import { PRESETS, NOT_SHOWN } from '../public/shared/presets.js';

const SEGMENTS = {
  interest: (who) => who.interests,
  field: (who) => [who.field],
  age: (who) => [who.ageGroup],
  temper: (who) => [who.temper],
  budget: (who) => [who.budget],
  shopping: (who) => (who.shopping === 'nothing' ? [] : [who.shopping]),
  city: (who) => [who.city.zh],
};

/** 优化前的原样实现（本轮不删，测试里当参照）。 */
function segmentsReference(presetId, keys, reactions, people) {
  const preset = PRESETS[presetId];
  const counters = (bytes) => {
    const byReaction = Object.fromEntries(keys.map((key) => [key, 0]));
    const totals = { reach: 0, stopped: 0, glad: 0, sorry: 0 };
    for (const byte of bytes) {
      if (byte === NOT_SHOWN) continue;
      const reaction = preset.reactions[keys[byte - 1]];
      byReaction[keys[byte - 1]] += 1;
      totals.reach += 1;
      if (reaction.stopped) totals.stopped += 1;
      if (reaction.tone === 1) totals.glad += 1;
      if (reaction.tone === -1) totals.sorry += 1;
    }
    return totals;
  };
  const all = counters(reactions);
  const tallies = new Map();
  for (const who of people) {
    const byte = reactions[who.id];
    const reaction = byte === NOT_SHOWN ? null : preset.reactions[keys[byte - 1]];
    for (const [attribute, valuesOf] of Object.entries(SEGMENTS)) {
      if (attribute === 'shopping' && !preset.market) continue;
      for (const value of valuesOf(who)) {
        const id = `${attribute}:${value}`;
        let tally = tallies.get(id);
        if (!tally) tallies.set(id, (tally = { attribute, value, size: 0, reached: 0, stopped: 0, glad: 0, sorry: 0 }));
        tally.size += 1;
        if (!reaction) continue;
        tally.reached += 1;
        if (reaction.stopped) tally.stopped += 1;
        if (reaction.tone === 1) tally.glad += 1;
        if (reaction.tone === -1) tally.sorry += 1;
      }
    }
  }
  const lift = (count, size, total) => (total ? count / size / (total / people.length) : 0);
  return [...tallies.values()]
    .filter((tally) => tally.size >= minSegment(people.length))
    .map((tally) => ({
      ...tally,
      stoppedLift: lift(tally.stopped, tally.size, all.stopped),
      gladLift: lift(tally.glad, tally.size, all.glad),
      sorryLift: lift(tally.sorry, tally.size, all.sorry),
    }));
}

const people = crowd('zh');
const keysOf = (presetId) => Object.keys(PRESETS[presetId].reactions);

/** 造一张反应图：reach 覆盖前 reach 个人。 */
const reactionsFor = (presetId, reach) => {
  const bytes = new Uint8Array(CROWD);
  const keys = keysOf(presetId);
  for (let id = 0; id < reach; id++) bytes[id] = 1 + (id * 7) % keys.length;
  return bytes;
};

test('segments：预编译版与旧写法在全城上逐字段一致', () => {
  for (const presetId of ['post', 'listing']) {
    for (const reach of [0, 600, 2100, CROWD]) {
      const bytes = reactionsFor(presetId, reach);
      const a = segments(presetId, keysOf(presetId), bytes, people);
      const b = segmentsReference(presetId, keysOf(presetId), bytes, people);
      assert.deepEqual(a, b, `${presetId} reach=${reach} 不一致`);
    }
  }
});

test('segments：商品预设的 shopping 分组只在该预设下出现', () => {
  const product = 'product';
  const keys = keysOf(product);
  const bytes = reactionsFor(product, 2100);
  const a = segments(product, keys, bytes, people);
  const b = segmentsReference(product, keys, bytes, people);
  assert.deepEqual(a, b);
  // 非市场预设（post）不应带 shopping 分组
  assert.equal(a.some((s) => s.attribute === 'shopping'), true, 'product 是市场预设，应有 shopping 分组');
  assert.equal(
    segments('post', keysOf('post'), reactionsFor('post', 2100), people).some((s) => s.attribute === 'shopping'),
    false,
    'post 不是市场预设，不应有 shopping 分组',
  );
});

test('segments：人少到全部低于最小样本时返回空数组', () => {
  const bytes = reactionsFor('post', 0);
  assert.deepEqual(segments('post', keysOf('post'), bytes, people), []);
});

test('segments：同一 people 数组重复调用结果一致（缓存不能改语义）', () => {
  const bytes = reactionsFor('post', 2100);
  const first = segments('post', keysOf('post'), bytes, people);
  const second = segments('post', keysOf('post'), bytes, people);
  assert.deepEqual(first, second);
});
```

- [ ] **Step 2: 跑测试——此时应当全绿（对拍的是同一份实现）**

Run: `node --test "test/summary.test.js"`
Expected: PASS —— `# pass 4`

> 这不是"假绿"：参照实现与被测实现当前是同一份代码，测试的作用是**在重写 `segments()`
> 的那一刻把行为钉住**。Task 2 改完实现后，这 4 条必须仍然全绿，否则就是行为变了。

- [ ] **Step 3: 提交**

```bash
git add test/summary.test.js
git commit -m "test: 把 segments 的旧实现钉成参照实现，为预编译重写对拍"
```

---

### Task 2: 预编译分组表

**Files:**
- Modify: `public/shared/summary.js`（`SEGMENTS` 与 `segments()` 之间新增 `groupTable`；重写 `segments`）

- [ ] **Step 1: 新增 `groupTable`**

`public/shared/summary.js` 的 `SEGMENTS` 定义之后插入：

```js
/**
 * 人群 → 分组号的紧凑表（CSR），按 people 数组身份缓存，只算一次。
 *
 * 原来 `segments()` 每次调用都要在对 10 000 个人的外层循环里重做三件本该只做一次的事：
 * `Object.entries(SEGMENTS)`（10 000 次分配）、每个维度的取值函数与数组字面量（70 000 次）、
 * `` `${attribute}:${value}` `` 拼串再哈希（70 000 次）。这让它成了报告页的头号开销。
 * 编码一次之后，热路径只剩整数读写。
 *
 * 分组号按首次出现顺序分配，所以输出顺序与旧的 Map 插入顺序一致。
 * people 视为不可变（`crowd()` 的产物）；传进来的子集各自成表，随数组一起被 WeakMap 回收。
 */
const GROUP_TABLES = new WeakMap();

function groupTable(people) {
  const cached = GROUP_TABLES.get(people);
  if (cached) return cached;
  const groups = [];
  const index = new Map();
  const slot = (attribute, value) => {
    const key = `${attribute}:${value}`;
    let id = index.get(key);
    if (id === undefined) {
      index.set(key, (id = groups.length));
      groups.push({ attribute, value });
    }
    return id;
  };
  const dimensions = Object.entries(SEGMENTS);
  const ids = new Int32Array(people.length);
  const start = new Int32Array(people.length + 1);
  const owned = [];
  for (let i = 0; i < people.length; i++) {
    const who = people[i];
    ids[i] = who.id;
    for (const [attribute, valuesOf] of dimensions) {
      for (const value of valuesOf(who)) owned.push(slot(attribute, value));
    }
    start[i + 1] = owned.length;
  }
  const table = { ids, start, group: Int32Array.from(owned), groups, shopping: Uint8Array.from(groups, (g) => (g.attribute === 'shopping' ? 1 : 0)) };
  GROUP_TABLES.set(people, table);
  return table;
}
```

- [ ] **Step 2: 重写 `segments()`**

`public/shared/summary.js` 现有的 `segments()` 全体替换为：

```js
export function segments(presetId, keys, reactions, people) {
  const preset = PRESETS[presetId];
  const all = counters(presetId, keys, reactions);
  const { ids, start, group, groups, shopping } = groupTable(people);
  const reactionsOf = preset.reactions;
  const market = Boolean(preset.market);
  const size = groups.length;
  const reach = new Int32Array(size);
  const stopped = new Int32Array(size);
  const glad = new Int32Array(size);
  const sorry = new Int32Array(size);
  const sizes = new Int32Array(size);

  for (let i = 0; i < people.length; i++) {
    const byte = reactions[ids[i]];
    let hit = 0;
    let tone = 0;
    if (byte !== NOT_SHOWN) {
      const reaction = reactionsOf[keys[byte - 1]];
      hit = reaction?.stopped ? 1 : 0;
      tone = reaction?.tone ?? 0;
    }
    for (let k = start[i]; k < start[i + 1]; k++) {
      const g = group[k];
      if (!market && shopping[g]) continue; // 非市场预设不统计"想买"
      sizes[g] += 1;
      if (!byte) continue;
      reach[g] += 1;
      stopped[g] += hit;
      if (tone === 1) glad[g] += 1;
      else if (tone === -1) sorry[g] += 1;
    }
  }

  const floor = minSegment(people.length);
  const lift = (count, sizeOf, total) => (total ? count / sizeOf / (total / people.length) : 0);
  const out = [];
  for (let g = 0; g < size; g++) {
    if (sizes[g] < floor) continue;
    out.push({
      attribute: groups[g].attribute,
      value: groups[g].value,
      size: sizes[g],
      reached: reach[g],
      stopped: stopped[g],
      glad: glad[g],
      sorry: sorry[g],
      stoppedLift: lift(stopped[g], sizes[g], all.stopped),
      gladLift: lift(glad[g], sizes[g], all.glad),
      sorryLift: lift(sorry[g], sizes[g], all.sorry),
    });
  }
  return out;
}
```

> 注意 `if (sizes[g] < floor) continue;` 已经把"非市场预设的 shopping 组"挡掉了
> ——它们的 `sizes` 恒为 0，而 `floor ≥ 15`。所以不必再单独判 `market`。

- [ ] **Step 3: 跑对拍——这是本轮的关键门**

Run: `node --test "test/summary.test.js"`
Expected: PASS —— `# pass 4`。**任何一条红都说明行为变了，先查清楚再往下走。**

- [ ] **Step 4: 跑全量门禁**

Run: `npm run lint && npm test`
Expected: lint `✓ 36 个文件通过`；test `# fail 0`，69 → 73

- [ ] **Step 5: 量效果**

```bash
node -e "import('./public/shared/summary.js').then(async (m) => { const p = await import('./public/shared/personas.js'); const pr = await import('./public/shared/presets.js'); const people = p.crowd('zh'); const keys = Object.keys(pr.PRESETS.post.reactions); const bytes = new Uint8Array(p.CROWD); for (let i=0;i<p.CROWD;i++) bytes[i] = 1 + (i*7)%keys.length; for (let i=0;i<3;i++) m.segments('post', keys, bytes, people); const t=process.hrtime.bigint(); for(let i=0;i<20;i++) m.segments('post', keys, bytes, people); console.log('segments() 热态', (Number(process.hrtime.bigint()-t)/1e6/20).toFixed(2), 'ms'); })"
```
Expected: 明显低于 19.13ms（目标 <4ms）。

- [ ] **Step 6: 提交**

```bash
git add public/shared/summary.js
git commit -m "perf: segments() 改走预编译分组表，报告页每请求省掉 7 万次拼串哈希"
```

---

### Task 3: 验证与反思

- [ ] **Step 1: 全量门禁 + 对拍**

Run: `npm run lint && npm test && npm run bench`
Expected: 全绿

- [ ] **Step 2: 端到端核对**

`test/worker.test.js` 已经断言 `/api/post` 的 `segments` 形状（`topSegments` 的三个数组），
全量通过即说明 Worker 侧同构没坏。无需再起浏览器。

- [ ] **Step 3: 文档**

- `docs/modules/shared-engine.md`：在 `summary.js` 小节补一句"分组表按 people 身份缓存，
  传进来的子集各自成表；`people` 视为不可变"。
- `docs/MEMORY.md`：顶部加一条 R4 事实，含剖析表与实测前后数字。

- [ ] **Step 4: 收尾提交**

```bash
git add -A
git commit -m "docs: 记录 segments 预编译的剖析依据、前后数字与不变式"
```

---

## 自检

1. **范围**：只动 `summary.js` 的 `segments()` 与一个新增私有函数；`counters` / `topSegments` /
   `biggestSegments` / `voicesOf` 一行未动；调用方（Worker / replay）零改动。✅
2. **占位符**：所有代码步骤带完整代码与精确命令、预期输出。✅
3. **命名一致**：`groupTable` / `GROUP_TABLES` / `start` / `group` / `groups` / `shopping` / `ids`
   在 Task 2 的实现与 Task 1 的测试里拼写一致。✅
4. **确定性**：输出顺序按首次出现分配分组号，与旧 Map 插入顺序一致；无随机、无日期。✅
5. **风险登记**：`people` 被视为不可变——`crowd()` 的产物本就是不可变的，且 `crowdCache`
   保证同一 pool 拿到同一数组。若将来有人就地改人群，这张表会过期，需一并改 `crowd()`。
