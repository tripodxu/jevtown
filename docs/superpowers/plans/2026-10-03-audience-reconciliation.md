# 这段话是给谁的 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让作者在发帖时写一句「这段话是给谁的」并从 115 项人群清单里挑出他说的那几组，报告在「谁停下了」之前给一张对账表（对上了 / 没等到 / 没说的 / 两边都冷），新增花费 $0。

**Architecture:** 纯函数 `reconcileAudience(all, picked, {presetId})` 放在 `public/shared/summary.js`，吃 `segments()` 的输出（Worker 与 `replay.js` 已共用），返回四个状态各自的有序行数组 + 一句结论。清单 `pickableGroups()` 也从同一个文件的 `SEGMENTS` 导出（不另写一份）。存储是 `versions.audience` 一列 TEXT，形状与 R32 的 `away` 相同；清洗在 Worker 入口做（作者令牌只在这一层出现）。前端：表单一行（自述输入 + 过滤输入 + 已选标签），报告一节（`audienceView`）。

**Tech Stack:** Cloudflare Worker + D1、框架less 静态前端（ES modules）、`node --test`、`node scripts/lint.mjs`。无新依赖。

**Spec:** `docs/superpowers/specs/2026-10-03-audience-reconciliation-design.md`

---

## File Structure

| 文件 | 责任 |
|---|---|
| `migrations/0009_audience.sql` | 新建。`ALTER TABLE versions ADD COLUMN audience TEXT;`，与 `0008_away.sql` 同形 |
| `public/shared/summary.js` | 修改。导出 `SEGMENT_DIMS`（七维）、`pickableGroups(people)`、`reconcileAudience(all, picked, opts)` |
| `public/shared/labels.js` | 修改。加 `AUDIENCE_ZH`、`AUDIENCE_STATE_ZH`、`audienceSayZh(summary)` |
| `worker/index.js` | 修改。`cleanAudience(body.audience)`；`runCheck`/`runVersion` 两个 INSERT 加列；`showPost` 的 `base` 回读；`runCheck`/`runVersion` 返回 `audience` |
| `public/index.html` | 修改。`#compose` 表单 textarea 之后加 `#audienceRow` |
| `public/styles.css` | 修改。`.aud-pick` / `.aud-tag` / `.aud-row` 四状态配色 |
| `public/app.js` | 修改。清单过滤、标签增删、提交时带上 `audience` |
| `public/render.js` | 修改。新增 `audienceView(result)`，接进 `renderCheck` |
| `scripts/check.js` | 修改。`--audience` / `--picked`，存档写 `audience` |
| `test/audience.test.js` | 新建。全部断言 |
| `scripts/probe-pickable.js` | 已有（`c050283` 提交）。Task 1 把它当参照，不改 |
| `docs/ARCHITECTURE.md:109-112` | 修改。那段「上游有、这里没接」改口 |
| `docs/MEMORY.md` | 修改。R35 条目 |

---

### Task 1: 清单导出 + 四状态分类（纯函数，全绿前置）

本任务不碰 UI、不碰存储，只把两个纯函数做出来并钉住。**这是整个特性的地基** —— spec 的风险一节明写「清单的维度集合必须直接由 `SEGMENTS` 导出，不能另写一份」。

**Files:**
- Modify: `public/shared/summary.js`（在 `topSegments` 之后追加）
- Create: `test/audience.test.js`

- [ ] **Step 1: 写失败的测试**

新建 `test/audience.test.js`：

```js
// 「这段话是给谁的」的对账：作者挑的组 vs 实际停下的组。
//
// 基数据只用真实存档 public/examples/iphone-listing-v1.json 里 Jev 真的判出来的 10 000 个字节。
// 不用假字节：假反应会让每个组的 lift 都趋近 1，topSegments 恒返回空（scripts/probe-match.js 记着
// 那一版就是这么白跑一遍才得出「0 个显著组」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { crowd } from '../public/shared/personas.js';
import { segments, topSegments, minSegment, SEGMENT_DIMS, pickableGroups, reconcileAudience } from '../public/shared/summary.js';
import { PRESETS } from '../public/shared/presets.js';

const raw = JSON.parse(fs.readFileSync(new URL('../public/examples/iphone-listing-v1.json', import.meta.url), 'utf8'));
const presetId = raw.presetId ?? 'listing';
const keys = Object.keys(PRESETS[presetId].reactions);
const people = crowd(raw.pool ?? 'zh');
const bytes = Uint8Array.from(raw.reactions);
const all = segments(presetId, keys, bytes, people);

test('清单：七维全在，一个都不许漏（spec 的风险一节）', () => {
  assert.deepEqual([...SEGMENT_DIMS], ['interest', 'field', 'age', 'temper', 'budget', 'shopping', 'city']);
  const dims = new Set(pickableGroups(people).map((one) => one.id.split(':')[0]));
  for (const dim of SEGMENT_DIMS) assert.ok(dims.has(dim), `清单漏了 ${dim} 这一维`);
});

test('清单：115 项、每项是 attribute:value 且能在 segments() 里查到', () => {
  const list = pickableGroups(people);
  assert.equal(list.length, 115);
  const found = new Set(all.map((s) => `${s.attribute}:${s.value}`));
  for (const one of list) assert.ok(found.has(one.id), `${one.id} 不在 segments() 的输出里，查不到就永远对不上账`);
});

test('清单：城市项用中文名（personas 里 city 是 {en, zh} 对象，segments() 取 zh）', () => {
  const cities = pickableGroups(people).filter((one) => one.id.startsWith('city:'));
  assert.equal(cities.length, 24);
  assert.ok(cities.every((one) => /^[一-龥]+$/.test(one.value)), '城市项必须是中文名，不是 en');
});

test('对账：挑的 ∧ 显著 = 对上了；挑的 ∧ 不显著 = 没等到', () => {
  const view = reconcileAudience(all, ['shopping:phone', 'age:a25', 'interest:gardening'], { presetId });
  const at = (state, id) => view.rows.find((row) => row.id === id && row.state === state);
  assert.ok(at('对上了', 'shopping:phone'), '手机是 16.81× 的显著组，挑了它就该对上');
  assert.ok(at('对上了', 'age:a25'), '25–34 岁 lift 1.76×，挑了它就该对上');
  // 养花组在真实数据里 lift < 1.3
  const gardening = all.find((s) => s.attribute === 'interest' && s.value === 'gardening');
  assert.ok(gardening && gardening.stoppedLift < 1.3, '前提变了：养花组现在显著了，测试要改');
  assert.ok(at('没等到', 'interest:gardening'), '挑了但不显著的组要进「没等到」');
});

test('对账：没挑的显著组进「没说的」，且不因为不在清单里就被丢掉', () => {
  const view = reconcileAudience(all, ['shopping:phone'], { presetId });
  const said = view.rows.filter((row) => row.state === '没说的');
  const stopped = topSegments(all, 'stopped', 8).filter((s) => s.attribute !== 'shopping' || s.value !== 'phone');
  for (const seg of stopped) {
    assert.ok(said.some((row) => row.id === `${seg.attribute}:${seg.value}`), `${seg.attribute}:${seg.value} 漏了`);
  }
  assert.ok(said.length >= 6);
});

test('对账：两边都冷只收 size ≥ 400 的，且按 lift 降序、最多 8 行', () => {
  const view = reconcileAudience(all, [], { presetId });
  const cold = view.rows.filter((row) => row.state === '两边都冷');
  assert.ok(cold.length > 0 && cold.length <= 8);
  assert.ok(cold.every((row) => row.size >= 400), `出现了 ${cold.length - cold.filter((r) => r.size >= 400).length} 个小组`);
  const lifts = cold.map((row) => row.lift);
  assert.deepEqual(lifts, [...lifts].sort((a, b) => b - a));
});

test('对账：一个组都不挑时，没有「对上了/没等到」，表头说的是「你没挑组」', () => {
  const view = reconcileAudience(all, [], { presetId });
  assert.equal(view.rows.filter((row) => row.state === '对上了' || row.state === '没等到').length, 0);
  assert.equal(view.say, '你没挑组：这一节在说你写的话引来了谁');
});

test('对账：挑的组里有显著的，表头数出「几组里几组」', () => {
  const view = reconcileAudience(all, ['shopping:phone', 'age:a25', 'interest:gardening'], { presetId });
  assert.equal(view.say, '你说的 3 组里有 2 组真停下来了');
});

test('对账：挑的组零显著时，表头说清「实际停下来的是你没挑的」', () => {
  const view = reconcileAudience(all, ['interest:gardening'], { presetId });
  assert.equal(view.say, '你挑的 1 组一个都没显著停下来，实际停下来的是你没挑的');
});

test('对账：挑到不存在的组时不算数，也不让它把结论说歪', () => {
  const view = reconcileAudience(all, ['interest:gardening', 'nosuch:zzz', 'shopping:phone', 'shopping:phone'], { presetId });
  assert.equal(view.picked, 2, '重复的 shopping:phone 只算一次，不认识的 id 不算');
  assert.equal(view.say, '你说的 2 组里有 1 组真停下来了');
});

test('对账：segments() 什么都没收上来时表头说「还没读出人群分布」而不是空表', () => {
  const view = reconcileAudience([], ['shopping:phone'], { presetId });
  assert.deepEqual(view.rows, []);
  assert.equal(view.say, '这次一个组都没读出来，还对不了账');
});

test('对账：floor 以下的组不列（只 15 个人的组停了也是那个比例）', () => {
  const floor = minSegment(bytes.filter(Boolean).length);
  const view = reconcileAudience(all, ['shopping:phone'], { presetId });
  for (const row of view.rows) assert.ok(row.size >= Math.min(floor, 400), `${row.id} 小于小组门槛`);
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/audience.test.js`

Expected: FAIL with `SyntaxError: The requested module '../public/shared/summary.js' does not provide an export named 'SEGMENT_DIMS'`

- [ ] **Step 3: 实现两个纯函数**

在 `public/shared/summary.js` 的 `topSegments` 之后（`MIN_SLICE` 之前）追加：

```js
/** 可挑人群的维度集合：与 SEGMENTS 一一对应，作者能挑的和报告里出现的是同一批维度。
 * 另写一份就会漏——真实存档里「城市：昆明」就是显著停下组（lift 1.56×），漏掉城市就要为一个
 * 作者压根挑不到的组背「你没说的」（scripts/probe-pickable.js）。 */
export const SEGMENT_DIMS = Object.keys(SEGMENTS);

const GROUP_LABELS = new WeakMap();

/**
 * 作者能挑的全量人群清单（≈115 项）：`[{ id: 'interest:games', attribute, value, zh, size }]`。
 * 从 SEGMENTS 直接导出，不另写维度表。zh 是中文名，筛选框按它过滤。
 * 按 people 数组身份缓存，与 groupTable 同一个 WeakMap 口径。
 */
export function pickableGroups(people) {
  const cached = GROUP_LABELS.get(people);
  if (cached) return cached;
  const counts = new Map();
  for (const dimensions of [SEGMENTS]) {
    for (const [attribute, valuesOf] of dimensions) {
      for (const who of people) {
        for (const value of valuesOf(who)) {
          const id = `${attribute}:${value}`;
          const row = counts.get(id);
          if (row) row.size += 1;
          else counts.set(id, { id, attribute, value, size: 1 });
        }
      }
    }
  }
  const list = [...counts.values()];
  GROUP_LABELS.set(people, list);
  return list;
}

/** 对账表里四行以外的行数上限：70 个冷组全列没人往下看。 */
const AUDIENCE_COLD_MAX = 8;
/** 「两边都冷」只收够大到能等得到反应的组：400 人以下停了也是那个比例。 */
const AUDIENCE_COLD_FLOOR = 400;

/**
 * 作者说的（picked）与实际停下的（all 里 lift ≥ 1.3 的组）对账。
 * 四个状态：对上了（挑的 ∧ 显著）、没等到（挑的 ∧ 不显著）、没说的（没挑 ∧ 显著）、
 * 两边都冷（没挑 ∧ 不显著 ∧ size ≥ 400，按 lift 降序取前 8）。
 * → { picked: 有效组数, hit: 显著命中数, say: 一句话结论, rows: [{ id, attribute, value, size, stopped, lift, state }] }
 *
 * 显著门槛与 topSegments 同一个 1.3、口径与 segmentsView 一样：停下的占比要明显高于全城。
 * rows 按状态顺序排，同状态内挑的在前（对上了/没等到）再按 lift 降序（没说的/两边都冷）。
 */
export function reconcileAudience(all, picked, { presetId } = {}) {
  const wanted = new Set((Array.isArray(picked) ? picked : []).filter((id) => typeof id === 'string'));
  const byId = new Map(all.map((segment) => [`${segment.attribute}:${segment.value}`, segment]));
  const known = [...wanted].filter((id) => byId.has(id));
  const significant = topSegments(all, 'stopped', 8);
  const significantIds = new Set(significant.map((segment) => `${segment.attribute}:${segment.value}`));
  const hit = known.filter((id) => significantIds.has(id));

  const line = (segment, state) => ({
    id: `${segment.attribute}:${segment.value}`,
    attribute: segment.attribute,
    value: segment.value,
    size: segment.size,
    stopped: segment.stopped,
    lift: segment.stoppedLift,
    state,
  });
  const rows = [];
  for (const id of known) rows.push(line(byId.get(id), significantIds.has(id) ? '对上了' : '没等到'));
  for (const segment of significant) {
    const id = `${segment.attribute}:${segment.value}`;
    if (!wanted.has(id)) rows.push(line(segment, '没说的'));
  }
  const cold = all
    .filter((segment) => !wanted.has(`${segment.attribute}:${segment.value}`) && segment.size >= AUDIENCE_COLD_FLOOR && !significantIds.has(`${segment.attribute}:${segment.value}`))
    .sort((a, b) => b.stoppedLift - a.stoppedLift)
    .slice(0, AUDIENCE_COLD_MAX);
  for (const segment of cold) rows.push(line(segment, '两边都冷'));

  let say;
  if (!known.length && !all.length) say = '这次一个组都没读出来，还对不了账';
  else if (!known.length) say = '你没挑组：这一节在说你写的话引来了谁';
  else if (!hit.length) say = `你挑的 ${known.length} 组一个都没显著停下来，实际停下来的是你没挑的`;
  else say = `你说的 ${known.length} 组里有 ${hit.length} 组真停下来了`;
  return { picked: known.length, hit: hit.length, say, rows, presetId };
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `node --test test/audience.test.js`

Expected: PASS 12/12. 若 `清单：115 项` 失败并给出别的数，先核对 `SEGMENTS` 是否被改动过 —— 115 是 `scripts/probe-pickable.js` 在 `crowd('zh')` 上量到的（兴趣 40 + 职业 15 + 年龄 5 + 性格 8 + 城市 24 + 预算 4 + 想买 19），人数或词表变了就要同步改这条断言。

- [ ] **Step 5: 提交**

```bash
git add public/shared/summary.js test/audience.test.js
git commit -m "feat: R35 对账的纯函数——清单从 SEGMENTS 直接导出，四状态分类钉在真实存档上"
```

---

### Task 2: 文案表

**Files:**
- Modify: `public/shared/labels.js:263` 之后（文件末尾）
- Modify: `test/audience.test.js`（追加）

- [ ] **Step 1: 写失败的测试**

在 `test/audience.test.js` 末尾追加：

```js
import { AUDIENCE_ZH, AUDIENCE_STATE_ZH, audienceSayZh } from '../public/shared/labels.js';

test('文案：四个状态各有中文，结论句由标签表给出而不是渲染层拼', () => {
  assert.deepEqual(Object.keys(AUDIENCE_STATE_ZH), ['对上了', '没等到', '没说的', '两边都冷']);
  assert.equal(audienceSayZh({ picked: 3, hit: 2, say: '' }), AUDIENCE_ZH.hit.replace('%1', '3').replace('%2', '2'));
  assert.equal(audienceSayZh({ picked: 1, hit: 0, say: '' }), AUDIENCE_ZH.miss);
  assert.equal(audienceSayZh({ picked: 0, hit: 0, say: '' }), AUDIENCE_ZH.none);
  assert.equal(audienceSayZh({ picked: 0, hit: 0, say: '这次一个组都没读出来，还对不了账' }), '这次一个组都没读出来，还对不了账');
});

test('文案：表头与表单提示全在标签表里（AGENTS.md：界面文案单点）', () => {
  for (const key of ['title', 'saidLabel', 'pickLabel', 'filterLabel', 'hint', 'coldNote']) {
    assert.ok(typeof AUDIENCE_ZH[key] === 'string' && AUDIENCE_ZH[key].length > 0, `AUDIENCE_ZH.${key} 缺`);
  }
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/audience.test.js`

Expected: FAIL with `SyntaxError: ... does not provide an export named 'AUDIENCE_ZH'`

- [ ] **Step 3: 实现**

在 `public/shared/labels.js` 末尾追加：

```js
/**
 * 「这段话是给谁的」（summary.js 的 reconcileAudience）的中文，渲染层只从这里取。
 * 三个结论：hit（挑的组里有显著的）、miss（挑的零显著）、none（一个都没挑）。
 * `audienceSayZh` 让「还没读出人群分布」那种空表走自己的句子，不落进三条常规结论里。
 */
export const AUDIENCE_ZH = {
  title: '这段话是给谁的',
  saidLabel: '你说的是',
  pickLabel: '你挑的',
  filterLabel: '加一组人群',
  hint: '从小镇的人群里挑几组。挑不挑都行——挑了才有一张对账表。',
  coldNote: '以下组既没被你挑，也没人特别停下来',
  hit: '你说的 %1 组里有 %2 组真停下来了',
  miss: '你挑的 %1 组一个都没显著停下来，实际停下来的是你没挑的',
  none: '你没挑组：这一节在说你写的话引来了谁',
};

export const AUDIENCE_STATE_ZH = {
  对上了: '对上了',
  没等到: '没等到',
  没说的: '没说的',
  两边都冷: '两边都冷',
};

/** 一句表头结论：summary.js 给的口径（几个里几个）由标签表说成话。 */
export function audienceSayZh(summary) {
  if (!summary.picked && !summary.rows.length) return '这次一个组都没读出来，还对不了账';
  if (!summary.picked) return AUDIENCE_ZH.none;
  if (!summary.hit) return AUDIENCE_ZH.miss.replace('%1', String(summary.picked));
  return AUDIENCE_ZH.hit.replace('%1', String(summary.picked)).replace('%2', String(summary.hit));
}
```

**注意**：`audienceSayZh` 的第一分支判断 `!summary.picked && !summary.rows.length` —— 空 `all` 时 `reconcileAudience` 返回空 rows 且 picked 0（因为 byId 空 → known 空），所以「这次一个组都没读出来」成立；但「一个都没挑且有数据」时 rows 非空 → 走 `none`。

- [ ] **Step 4: 跑测试，确认通过**

Run: `node --test test/audience.test.js`

Expected: PASS 14/14

- [ ] **Step 5: 提交**

```bash
git add public/shared/labels.js test/audience.test.js
git commit -m "feat: R35 对账的中文文案表：结论句由标签说成话，渲染层不拼句子"
```

---

### Task 3: 存储与 Worker

**Files:**
- Create: `migrations/0009_audience.sql`
- Modify: `worker/index.js:165-230`（`runCheck`）、`:235-278`（`runVersion`）、`:585-608`（`showPost` 的 `base`）
- Modify: `test/worker.test.js`（追加）

- [ ] **Step 1: 写失败的测试**

在 `test/worker.test.js` 末尾追加（先看该文件已有的 import 与 helper 名字，按其实际写法对齐）：

```js
test('/api/check：audience 原样入库再读回，picked 里的陌生 id 被丢掉', async () => {
  const worker = makeWorker();
  const opening = await post(worker, '/api/check', {
    preset: 'listing',
    text: '出 iPhone 13，128G，电池 86%，无维修，带盒子和充电线，1400 元，可小刀，包邮，联系我',
    audience: { said: '给刚生孩子的年轻父母', picked: ['shopping:phone', 'nosuch:zzz', 'shopping:phone'] },
  });
  assert.equal(opening.audience.picked.length, 1, `没清洗干净：${JSON.stringify(opening.audience)}`);
  assert.equal(opening.audience.picked[0], 'shopping:phone');
  const view = await get(worker, `/api/post/${opening.post}?v=1`, opening.author);
  assert.equal(view.audience.said, '给刚生孩子的年轻父母');
  assert.deepEqual(view.audience.picked, ['shopping:phone']);
});

test('/api/check：没传 audience 时是 null，既有报告一字不变', async () => {
  const worker = makeWorker();
  const opening = await post(worker, '/api/check', { preset: 'post', text: '我把每周例会砍到 15 分钟之后。' });
  assert.equal(opening.audience, null);
  const view = await get(worker, `/api/post/${opening.post}?v=1`, opening.author);
  assert.equal(view.audience, null);
});

test('/api/check：只写自述不挑组也要存（那是一个合法答案）', async () => {
  const worker = makeWorker();
  const opening = await post(worker, '/api/check', { preset: 'post', text: '给所有人看的公告。', audience: { said: '给所有人', picked: [] } });
  const view = await get(worker, `/api/post/${opening.post}?v=1`, opening.author);
  assert.equal(view.audience.said, '给所有人');
  assert.deepEqual(view.audience.picked, []);
});
```

若该文件没有 `post`/`get`/`makeWorker` 这三个 helper（实际是 `test/helper.js` 里的 `runToDone` / `runBatches` 一类），按该文件现有写法改写调用，断言内容不变。

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/worker.test.js`

Expected: FAIL with `Cannot read properties of undefined (reading 'picked')` 或 `assert.equal(undefined, null)` —— 响应里还没有 `audience` 键。

- [ ] **Step 3: 加迁移**

Create `migrations/0009_audience.sql`：

```sql
-- 作者说的「这段话是给谁的」：一句自述 + 他从人群清单里挑的组 id。
-- 一列 TEXT 存 JSON，与 versions.away（哪一句在撑）同形；NULL = 作者没填这一项，
-- 报告里整节不渲染，所以旧存档与旧版截图一字不变。
ALTER TABLE versions ADD COLUMN audience TEXT;
```

- [ ] **Step 4: Worker 清洗函数**

在 `worker/index.js` 的 `runCheck` 之前（`// -- POST /api/check：开局` 注释上方）插入：

```js
// -- 作者说的「这段话是给谁的」 ----------------------------------------------------

/** 自述上限：比正文短得多，它是一句「给谁看」，不是第二段正文。 */
const MAX_AUDIENCE_SAID = 200;

/**
 * 收下作者挑的组，只留小镇真有的：id 必须能在选定的池子里查到。
 * 不认识的 id 静默丢掉而不是整份拒收——前端是本地清单，但存档与 CLI 能塞进任何字符串。
 * 返回 null 表示「作者没填这一项」，与空数组（填了自述但没挑组）是两件事。
 */
function cleanAudience(input, pool) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const said = typeof input.said === 'string' ? input.said.trim().slice(0, MAX_AUDIENCE_SAID) : '';
  const wanted = Array.isArray(input.picked) ? input.picked : [];
  const known = new Set(pickableGroups(crowdOf(pool)).map((one) => one.id));
  const picked = [...new Set(wanted.filter((id) => typeof id === 'string' && known.has(id)))];
  if (!said && !picked.length) return null; // 什么都没说：与旧存档同形，报告里整节不渲染
  return { said, picked };
}
```

同时在 `worker/index.js` 顶部 import 里加上：

```js
import { counters, segments, topSegments, voicesOf, pickableGroups } from '../public/shared/summary.js';
```

- [ ] **Step 5: `runCheck` 收下并入库**

在 `runCheck` 的 `const prices = ...` 之后（`:175` 那行 `if (presetId === 'product' && !prices)` 下方）加：

```js
  const audience = cleanAudience(body.audience, pool);
```

把 `pool` 的定义（`:182` `const pool = 'zh';`）**上移到** `:171` 之前，让 `audience` 能用它。改后 `:171` 附近应为：

```js
  if (text.length > MAX_TEXT_CHARS) return fail(`text is longer than ${MAX_TEXT_CHARS} chars`);
  const pool = 'zh';
  const audience = cleanAudience(body.audience, pool);
  const prices = presetId === 'product'
```

并删掉原来 `:182` 的 `const pool = 'zh';`。

正常分支的 INSERT（`:215-217`）改为：

```js
    env.DB.prepare(
      'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, plan, prices, provider, usd, tokens, audience) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, text, stored.scores, stored.checks, stored.unlisted, stored.blocked, JSON.stringify(plan), prices ? JSON.stringify(prices) : null, provider.name, round4(usd), tokens, audience ? JSON.stringify(audience) : null),
```

正常分支的 `return json({...})`（`:220-229`）加一行 `audience,`：

```js
  return json({
    post: id,
    version: 1,
    state: 'running',
    author,
    provider: provider.name,
    unlisted: opening.unlisted,
    checks: opening.checks,
    audience,
    wave: { index: 0, total: wave0.length },
  });
```

**blocked 分支不动** —— 被拒的文本没有受众可言，少写一列就是 NULL。

- [ ] **Step 6: `runVersion` 同上**

`pool` 已在 `:252` 定义，在 `:254` `const opening = openingAnswers(answers);` 之后加：

```js
  const audience = cleanAudience(body.audience, pool);
```

INSERT（`:272-274`）改为：

```js
      'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, plan, provider, usd, tokens, audience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, number, text, JSON.stringify(opening.scores), JSON.stringify(opening.checks), JSON.stringify(opening.unlisted), JSON.stringify(opening.blocked), JSON.stringify(plan), provider.name, round4(usd), tokens, audience ? JSON.stringify(audience) : null),
```

`return json`（`:277`）改为：

```js
  return json({ post: id, version: number, state: 'running', audience, wave: { index: 0, total: wave0.length } });
```

- [ ] **Step 7: `showPost` 回读**

`worker/index.js:604` `away: JSON.parse(version.away ?? 'null'),` 之后加：

```js
    audience: JSON.parse(version.audience ?? 'null'),
```

- [ ] **Step 8: 跑测试，确认通过**

Run: `npm test`

Expected: PASS。worker 测试里 D1 用本地迁移建表；若报 `no such column: audience`，说明本地库还没应用 0009 —— 跑 `npm run dev`（它会先 `wrangler d1 migrations apply jevtown --local`）后再 `npm test`。

- [ ] **Step 9: 提交**

```bash
git add migrations/0009_audience.sql worker/index.js test/worker.test.js
git commit -m "feat: R35 存住作者说的受众——versions 加一列 TEXT，入口清洗陌生 id，旧存档走 null"
```

---

### Task 4: 表单（自述 + 清单过滤 + 标签）

**Files:**
- Modify: `public/index.html:58-60`（textarea 之后）
- Modify: `public/styles.css`（`.source-text` 之前追加）
- Modify: `public/app.js`（import 区 + 提交处理器 + 新增一段）
- Modify: `test/audience.test.js`（追加过滤逻辑的断言）

- [ ] **Step 1: 写失败的测试**

在 `test/audience.test.js` 末尾追加（过滤逻辑放 `summary.js` 旁边的 `labels.js` 不合适——它要 zh，zh 在 labels 里，所以过滤函数放 `summary.js`，用 `segmentValueZh`）：

```js
import { filterGroups } from '../public/shared/summary.js';

test('过滤：输入「年轻」只给年龄段，命中的是中文名不是 id', () => {
  const list = pickableGroups(people);
  const hits = filterGroups(list, '年轻');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((one) => one.attribute === 'age'), `混进了别的维度：${hits.map((h) => h.id).join(' ')}`);
});

test('过滤：输入「昆明」只给那个城市；输入 id 本身也认', () => {
  const list = pickableGroups(people);
  assert.deepEqual(filterGroups(list, '昆明').map((one) => one.id), ['city:昆明']);
  assert.ok(filterGroups(list, 'shopping:phone').some((one) => one.id === 'shopping:phone'));
});

test('过滤：空输入返回空数组（不是全量——115 项一次全展出来没人勾得完）', () => {
  assert.deepEqual(filterGroups(pickableGroups(people), ''), []);
  assert.deepEqual(filterGroups(pickableGroups(people), '   '), []);
});

test('过滤：输入没有对应项时返回空数组，UI 就显示「没找到」而不是空框', () => {
  assert.deepEqual(filterGroups(pickableGroups(people), '外星人'), []);
});

test('过滤：命中超过 40 项时截断并标出总数（不让一次搜索刷出 115 行）', () => {
  const hits = filterGroups(pickableGroups(people), 'a');
  assert.ok(hits.length <= 40);
  assert.ok(hits.total >= hits.length);
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/audience.test.js`

Expected: FAIL with `does not provide an export named 'filterGroups'`

- [ ] **Step 3: 实现过滤函数**

在 `summary.js` 的 `reconcileAudience` 之后追加：

```js
/** 搜索一次最多给多少项：115 项一次全展出来没人勾得完。 */
const GROUP_SEARCH_MAX = 40;

/**
 * 清单的本地过滤：输入框打几个字，只给对得上的组。匹配中文名（'年轻' → 5 个年龄段）、
 * 段 id（'shopping:phone'）与英文 id（'games'）。零花费、零延迟。
 * → 数组 + `total`（命中总数，截断时用来告诉作者还有多少）
 */
export function filterGroups(list, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return { list: [], total: 0 };
  const hits = list.filter((one) => `${one.zh} ${one.id} ${one.value}`.toLowerCase().includes(q));
  return { list: hits.slice(0, GROUP_SEARCH_MAX), total: hits.length };
}
```

**注意**：`pickableGroups` 产出的项要有 `zh` 字段。在 Task 1 的 `pickableGroups` 里补上 `zh: segmentValueZh(attribute, value)` —— 需要在 `summary.js` 顶部 import 里加 `segmentValueZh`（当前它从 `./labels.js` 只 import 了 `REACTIONS_ZH`）。

- [ ] **Step 4: 跑测试，确认通过**

Run: `node --test test/audience.test.js`

Expected: PASS 19/19

- [ ] **Step 5: 改 `public/index.html`**

在 `:57` `</textarea>` 之后、`:61` `<div class="row between">` 之前插入：

```html
        <!-- 「这段话是给谁的」：一句自述 + 一个即时过滤的清单输入框。
             清单从 summary.js 的 SEGMENTS 导出（约 115 项），所以本地匹配就够，零花费。 -->
        <div id="audienceRow" class="aud-pick">
          <div class="row">
            <label for="audienceSaid">给谁看</label>
            <input id="audienceSaid" maxlength="200" type="text"
              placeholder="一句自述，比如：给刚生孩子的年轻父母">
          </div>
          <div class="row">
            <label class="sr-only" for="audienceFilter">加一组人群</label>
            <input id="audienceFilter" type="search" autocomplete="off"
              placeholder="加一组人群：输入「年轻」「摄影」「手机」或 shopping:phone"
              aria-describedby="audienceHint" aria-controls="audienceList">
            <span class="hint" id="audienceCount" aria-live="polite"></span>
          </div>
          <ul id="audienceList" class="aud-list" hidden></ul>
          <div id="audienceTags" class="aud-tags" role="list" aria-label="你挑的人群"></div>
          <span class="hint" id="audienceHint">从小镇的人群里挑几组。挑不挑都行——挑了才有一张对账表。</span>
        </div>
```

- [ ] **Step 6: 改 `public/styles.css`**

在 `.source-text`（`:978`）之前插入：

```css
/* 「这段话是给谁���」：自述 + 清单输入 + 已选标签。窄屏逐项落下，不做成横向标签墙。 */
.aud-pick {
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px dashed var(--hairline);
  border-radius: var(--r-ctrl);
  background: var(--card-2);
}
.aud-pick .row { margin: 4px 0; }
.aud-pick input[type='text'],
.aud-pick input[type='search'] {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--r-ctrl);
  background: var(--card);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.aud-list { list-style: none; margin: 6px 0 0; padding: 0; max-height: 208px; overflow-y: auto; }
.aud-list li + li { margin-top: 2px; }
.aud-list button {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 5px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-ctrl);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.aud-list button:hover, .aud-list button:focus-visible { border-color: var(--face-stopped); }
.aud-list button i { color: var(--muted); font-family: var(--font-mono); font-size: 11.5px; font-style: normal; }
.aud-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.aud-tags:empty { display: none; }
.aud-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px 3px 10px;
  border: 1px solid var(--face-stopped);
  border-radius: var(--r-chip);
  color: var(--text);
  font-size: 12.5px;
}
.aud-tag button {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}
.aud-tag button:hover { color: var(--bad); }
```

- [ ] **Step 7: 改 `public/app.js`**

import 区（`:5`）改为：

```js
import { BLOCKED_ZH, AWAY_ZH, AUDIENCE_ZH, SEGMENT_ZH, segmentValueZh, presetNoun as PRESET_NOUN_OF, signed } from './shared/labels.js';
```

并加一行：

```js
import { pickableGroups, filterGroups } from './shared/summary.js';
```

在 `const $ = (id) => document.getElementById(id);` 之后加：

```js
// -- 「这段话是给谁的」：一句自述 + 从清单里挑组 ---------------------------------------

// 作者挑中的组 id（`attribute:value`）。清单是 summary.js 的 SEGMENTS 派生的，与报告里
// 出现的段同一套 id，所以挑中的 id 在对账表里查得到。
const pickedGroups = new Set();
const crowdForList = crowd('zh');
const pickable = pickableGroups(crowdForList);

/** 作者写了自述或挑了组才带这个字段：都没做就传 null，报告里整节不渲染。 */
const audienceInput = () => {
  const said = $('audienceSaid').value.trim();
  const picked = [...pickedGroups];
  return said || picked.length ? { said, picked } : null;
};

function renderAudienceTags() {
  const box = $('audienceTags');
  box.replaceChildren(
    ...[...pickedGroups].map((id) => {
      const [attribute, value] = id.split(':');
      const tag = document.createElement('span');
      tag.className = 'aud-tag';
      tag.setAttribute('role', 'listitem');
      tag.append(`${SEGMENT_ZH[attribute] ?? attribute}：${segmentValueZh(attribute, value)}`);
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.textContent = '×';
      drop.setAttribute('aria-label', `去掉 ${segmentValueZh(attribute, value)}`);
      drop.addEventListener('click', () => {
        pickedGroups.delete(id);
        renderAudienceTags();
      });
      tag.append(drop);
      return tag;
    }),
  );
  $('audienceCount').textContent = pickedGroups.size ? `已选 ${pickedGroups.size} 组` : '';
}

$('audienceFilter').addEventListener('input', () => {
  const { list, total } = filterGroups(pickable, $('audienceFilter').value);
  const box = $('audienceList');
  if (!$('audienceFilter').value.trim()) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren(
    ...(list.length ? list : []).map((one) => {
      const item = document.createElement('li');
      const add = document.createElement('button');
      add.type = 'button';
      add.append(document.createTextNode(`${SEGMENT_ZH[one.attribute] ?? one.attribute}：${one.zh}`));
      const size = document.createElement('i');
      size.textContent = `${one.size.toLocaleString()} 人`;
      add.append(size);
      add.addEventListener('click', () => {
        pickedGroups.add(one.id);
        renderAudienceTags();
        $('audienceFilter').value = '';
        box.hidden = true;
      });
      item.append(add);
      return item;
    }),
  );
  if (!list.length) {
    const item = document.createElement('li');
    item.className = 'hint';
    item.textContent = '没找到这一组——换个人群的叫法试试（词表里是「设计文案传媒」不是「做创意的」）。';
    box.append(item);
  } else if (total > list.length) {
    const item = document.createElement('li');
    item.className = 'hint';
    item.textContent = `还有 ${total - list.length} 项没显示，输入得更具体一点。`;
    box.append(item);
  }
});
```

还需要在 import 里加 `crowd`：

```js
import { crowd, CROWD } from './shared/personas.js';
```

（`:11` 已是 `import { CROWD } from './shared/personas.js';` → 改为 `import { crowd, CROWD } from './shared/personas.js';`）

提交处理器（`:230-232`）改为：

```js
    const audience = audienceInput();
    const opening = current.post
      ? await postJSON('/api/version', { post: current.post, text, audience })
      : await postJSON('/api/check', { preset, text, prices: preset === 'product' ? [9, 19, 39, 79] : undefined, audience });
```

- [ ] **Step 8: 跑测试与 lint**

Run: `npm test` → PASS；Run: `npm run lint` → ✓（`scripts/lint.mjs` 对 `scripts/` 豁免 `console.log`，本任务不碰 `scripts/`）

- [ ] **Step 9: 提交**

```bash
git add public/index.html public/styles.css public/app.js public/shared/summary.js test/audience.test.js
git commit -m "feat: R35 表单加一行——一句自述 + 115 项人群清单的本地过滤，挑的是段 id 不是猜作者的话"
```

---

### Task 5: 报告里的对账表

**Files:**
- Modify: `public/render.js:59` 前后（`segmentsView` 调用处）
- Modify: `test/audience.test.js`（追加渲染断言，用 DOM 桩）

- [ ] **Step 1: 写失败的测试**

渲染断言需要一个 DOM 桩。追加到 `test/audience.test.js`：

```js
import { audienceView } from '../public/render.js';

test('渲染：没有 audience 时整节不渲染（旧存档一字不变）', () => {
  assert.equal(audienceView({ post: { preset: presetId }, segments: { stopped: [] } }), '');
});

test('渲染：四状态各有行，标签与 lift 都在行里', () => {
  const view = reconcileAudience(all, ['shopping:phone', 'interest:gardening'], { presetId });
  const html = audienceView({ post: { preset: presetId, audience: { said: '给想买手机的人', picked: ['shopping:phone', 'interest:gardening'] } }, audience: view });
  assert.match(html, /<h3>/);
  assert.match(html, /给想买手机的人/);
  for (const state of ['对上了', '没等到', '没说的', '两边都冷']) assert.ok(html.includes(state), `缺 ${state}`);
  assert.match(html, /16\.81/, 'lift 要在行里');
});
```

`audienceView` 必须是纯字符串函数（不碰 DOM），这样测试不需要桩。若 `render.js` 顶部有只在浏览器成立的 import，`node --test` 会在 import 期报错——若如此，本步改为在 `public/shared/labels.js` 放 `audienceHtml(summary, audience)`（纯函数，`render.js` 只做包 `<h3>` 与外层 div），测试打 `labels.js` 的那个。

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/audience.test.js`

Expected: FAIL with `does not provide an export named 'audienceView'`

- [ ] **Step 3: 实现**

在 `public/render.js` 的 `segmentsView`（`:351`）之前插入：

```js
import { reconcileAudience } from './shared/summary.js';
import { AUDIENCE_ZH, AUDIENCE_STATE_ZH, audienceSayZh } from './shared/labels.js';
```

（`render.js` 顶部 import 区已有 `./shared/labels.js` 的若干名字，合并进那一条即可。）

```js
/**
 * 「这段话是给谁的」的对账表：作者挑的组 vs 实际停下的组。
 * 读数全部来自 segments() 已有分布（`result.audienceRows` 由 Worker/replay 算好），
 * 渲染层不重算——重算就要在这里再拿一次 bytes，而 segments() 是全城 10 000 人的开销。
 */
function audienceView(result) {
  if (!result.audience) return '';
  const summary = result.audience;
  if (!summary.rows?.length && !summary.said) return '';
  const html = [`<h3>${AUDIENCE_ZH.title}</h3>`];
  if (summary.said) html.push(`<div class="source-text">${AUDIENCE_ZH.saidLabel}：${esc(summary.said)}</div>`);
  html.push(`<p class="hint">${esc(audienceSayZh(summary))}</p>`);
  let state = null;
  for (const row of summary.rows) {
    if (row.state !== state) {
      state = row.state;
      html.push(`<div class="aud-state">${esc(AUDIENCE_STATE_ZH[state] ?? state)}</div>`);
    }
    const share = row.size ? row.stopped / row.size : 0;
    html.push(
      `<div class="seg"><span class="label">${esc(SEGMENT_ZH[row.attribute] ?? row.attribute)}：${esc(segmentValueZh(row.attribute, row.value))}</span>` +
      `<span class="bar2"><i style="width:${Math.round(share * 100)}%;background:var(--face-stopped)"></i></span>` +
      `<span class="num">${row.stopped} / ${row.size}（${Math.round(share * 100)}% · ${row.lift.toFixed(2)}×）</span></div>`,
    );
  }
  return html.join('');
}
```

- [ ] **Step 4: 接进 `renderCheck`**

`public/render.js:59` `html.push(segmentsView(result));` 之前加一行：

```js
  html.push(audienceView(result));
```

（位置在 `jevReading(result)`（`:58`）之后、`segmentsView`（`:59`）之前 —— 对账表讲的是「谁停下了」，紧挨着它才读得通。）

- [ ] **Step 5: 数据从哪来**

`summary.js` 的 `reconcileAudience` 必须在 Worker 与 `replay.js` 两侧都算一次，键名统一为 `audience`：

`worker/index.js` 的 `showPost` 返回体（`:663` `return json({ ...base, ... })`）在 `segments` 之后加：

```js
    audience: version.audience
      ? { ...JSON.parse(version.audience), ...reconcileAudience(all, JSON.parse(version.audience).picked, { presetId }) }
      : null,
```

（`all` 已在 `:656` 算出，`presetId` 在 `:596`。读两次 JSON 很难看——所以先把 `version.audience` 解析一次存进局部变量，再拼。）

`public/shared/replay.js:28` 的 `segments: {…}` 之后加：

```js
    audience: saved.audience ? { ...saved.audience, ...reconcileAudience(all, saved.audience.picked, { presetId }) } : null,
```

并加 import：

```js
import { counters, segments, topSegments, voicesOf, reconcileAudience } from './summary.js';
```

- [ ] **Step 6: 跑测试与 lint**

Run: `npm test` → PASS；Run: `npm run lint` → ✓

- [ ] **Step 7: 提交**

```bash
git add public/render.js public/shared/replay.js worker/index.js test/audience.test.js
git commit -m "feat: R35 报告里加对账表——四状态逐行，结论句在表头，读数仍来自 segments()"
```

---

### Task 6: CLI 与存档

**Files:**
- Modify: `scripts/check.js:33`（`positional` 正则）、`:56-65`（`runCheck`）、`:104-132`（存档）
- Modify: `test/audience.test.js`（追加一条，不新开文件）

- [ ] **Step 1: 改参数解析**

`scripts/check.js:33` 的正则要认新的两个选项，否则 `--audience "给谁看"` 的值会被当成位置参数混进正文：

```js
const positional = args.filter((arg, index) => !arg.startsWith('--') && !/^--(preset|prices|max-waves|audience|picked)$/.test(args[index - 1] ?? ''));
const presetId = option('preset') ?? 'post';
const prices = (option('prices') ?? '9,19,39,79').split(',').map(Number);
const maxWaves = Number(option('max-waves') ?? 4);
const audienceSaid = option('audience') ?? '';
const audiencePicked = (option('picked') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
```

- [ ] **Step 2: 传给 `runCheck` 并写存档**

`:56-65` 的 `runCheck({...})` 加两行（`check.js` 的 `runCheck` 是引擎版，**不收 `audience`**——它只管 Jev 与波次。所以 audience 只进存档与摘要，不进 `runCheck`）：

`:87` 附近（波次摘要之后）加：

```js
if (audienceSaid || audiencePicked.length) {
  const summary = reconcileAudience(segmentsOf(result), audiencePicked, { presetId });
  console.log(`  作者说的：${audienceSaid || '（没写）'} · 挑了 ${audiencePicked.length} 组`);
  console.log(`  ${audienceSayZh(summary)}`);
  for (const row of summary.rows.slice(0, 10)) {
    console.log(`    ${row.state}  ${row.id.padEnd(24)} ${row.stopped} / ${row.size} · ${row.lift.toFixed(2)}×`);
  }
}
```

需要 import 与一个 `segmentsOf` 辅助（CLI 里没有现成的 segments 调用）：

```js
import { segments, reconcileAudience } from '../public/shared/summary.js';
import { crowd } from '../public/shared/personas.js';
import { audienceSayZh } from '../public/shared/labels.js';
```

```js
/** CLI 里 results.reactions 是字节数组，segments() 要的也是字节数组 + 同一批 keys。 */
const segmentsOf = (run) => segments(presetId, keys, Uint8Array.from(run.reactions), crowd('zh'));
```

（`keys` 与 `presetId` 在 `:69` 定义，而 `:87` 在其后，顺序可用。）

存档写入（`:110-131`）的 JSON 对象加一行：

```js
      audience: audienceSaid || audiencePicked.length ? { said: audienceSaid, picked: audiencePicked } : null,
```

- [ ] **Step 3: 跑 CLI 验证**

Run: `MOCK=1 node scripts/check.js --preset listing --audience "给想买手机的人" --picked shopping:phone,interest:gardening "出 iPhone 13，128G，电池 86%，无维修，带盒子和充电线，1400 元，可小刀，包邮，联系我"`

Expected: 打印 `作者说的：给想买手机的人 · 挑了 2 组` + 一句结论 + 若干行；存档 `output/checks/*.json` 里 `audience` 非 null。再跑一次不带 `--audience` 的同命令，Expected: 不打印「作者说的」那两行，存档里 `audience: null`。

- [ ] **Step 4: 提交**

```bash
git add scripts/check.js test/audience.test.js
git commit -m "feat: R35 CLI 加 --audience/--picked，存档带出作者说的受众与对账摘要"
```

---

### Task 7: 文档与全量验证

**Files:**
- Modify: `docs/ARCHITECTURE.md:109-112`
- Modify: `docs/MEMORY.md`（顶部）
- Modify: `test/theme.test.js`（追加对账表配色的对比度断言）

- [ ] **Step 1: 加对比度断言**

`test/theme.test.js` 追加：

```js
test('对账表：四个状态的墨水在四主题的面版上 ≥ 4.5:1', () => {
  for (const theme of Object.keys(THEMES)) {
    for (const ink of ['--face-stopped', '--muted', '--bad']) {
      const ratio = contrast(tokensOf(theme)[ink], tokensOf(theme)['--card-2']);
      assert.ok(ratio >= 4.5, `${theme} 的 ${ink} 在 --card-2 上只有 ${ratio.toFixed(2)}:1`);
    }
  }
});
```

按 `test/theme.test.js` 里已有的 `tokensOf` / 对比度函数与 `THEMES` 的实际名字改写（本计划不假设它们叫什么，读一下再写）。**若该文件的辅助函数不接受 theme 名而是返回全表，就改成遍历它已有的主题列表。**

- [ ] **Step 2: 跑测试**

Run: `npm test` → PASS（`--card-2` 上的对比度断言可能第一次就挂：那是真的——按实算值把墨水调深或换令牌，记进 MEMORY）

- [ ] **Step 3: 改 `docs/ARCHITECTURE.md`**

把 `:109-112` 那一段改成：

```markdown
> 引擎里留着两处**上游有、这里没接**的能力：`check.js` 的 `audience`（"只给某类人看"，
> 含 `rateAudience` / `partsOf` / `audienceOf`）与 `feed.js` 的 `partsOf` / `audienceMask`。
> Worker 与前端都没走这条路；`summary.js` 的 `inAudience` 同理是备而不用。
> **R35 量过了，结论仍是不接**：`scripts/probe-audience.js` 拿 12 条中文描述问真实 Jev，
> 分与镇子里真比例的秩相关只有 **rho = 0.264**（996 个配对），噪声底平均绝对差 0.007–0.013，
> 而 `PART_FROM = 0.5` 与读数的间距同量级；「给刚生孩子的年轻父母」在五道 `part:*` noul 上
> 读出 0.24/0.20/0.14/0.08/0.17，全在 `NAMED_FROM = 0.5` 之下 → `partsOf` 返回 `null`，
> 同一条描述换个问法现闸门只留下 21 人（镇子一万）。那三个阈值从没量过（注释里的
> `scripts/probe.js` 从不存在），拿它们当闸门等于拿猜测当闸门。
> R35 走的是另一条路：作者自己挑组（`summary.js` 的 `pickableGroups` / `reconcileAudience`），
> 新增花费 $0，只做对账不改分发。
```

- [ ] **Step 4: 加 `docs/MEMORY.md` 条目**

在文件顶部（`# MEMORY` 之后的第一个 `## ` 之前）插入 R35 条目，包含：方向（用户从三条里选了「这段话是给谁的」）、三个探针的数（rho 0.264 / 噪声 0.007–0.013 / partsOf 作废 / 21 人；8 个显著组；50% 撞词表；115 项 vs 84 项的修正）、设计（一句自述 + 挑组 + 对账表，$0）、四个状态、三个坑（假反应字节让 `topSegments` 恒空；`city` 是 `{en, zh}` 对象所以段 id 用 zh；探针要放 `scripts/`）、验证数字（`npm test` 通过数与 `npm run lint` 的文件数）、以及「提交必须 `run_in_background` + `job_output(wait:true)`，GPG 会阻塞非交互 shell」这条已有纪律仍然有效。

- [ ] **Step 5: 全量验证**

Run: `npm test *> fulltest.log` 然后 `Get-Content fulltest.log -Tail 20`

Expected: 0 fail。Run: `npm run lint` → ✓

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: R35 创意——这段话是给谁的：作者挑的组 vs 实际停下的人，一张 $0 的对账表"
```

---

## Self-Review

**Spec coverage**

| spec 小节 | 覆盖任务 |
|---|---|
| 一、算什么（segments() 已有分布，$0） | Task 1（`reconcileAudience`）、Task 5（读数不重算） |
| 二、作者的话怎么变成组（115 项清单 + 本地过滤） | Task 1（`pickableGroups`）、Task 4（`filterGroups` + 表单） |
| 三、存哪怎么传（`versions.audience` TEXT + 三处 + CLI） | Task 3（迁移 + Worker）、Task 4（app.js）、Task 6（CLI） |
| 四、报告长什么样（四个状态 + 三种口径 + 表头结论） | Task 1（分类 + say）、Task 2（文案）、Task 5（渲染） |
| 五、四个状态定义 | Task 1 Step 1 四条断言 |
| 明确不做（不改分发、不删上游代码、不改判据） | Task 3 Step 5（blocked 分支不动）、Task 5 Step 5（不碰 feed.js） |
| 测试清单 | Task 1/2/4/5/6/7 的断言；Task 7 的对比度 |
| 落地清单 14 项 | Task 1–7 逐项对应 |

**占位符扫描**：无 TBD/TODO；Task 3/5/6 的 helper 名字标注了「按该文件现有写法对齐」的具体位置与依据，不是留给实现者猜。

**类型一致性**：`reconcileAudience(all, picked, { presetId })` 的返回 `{ picked, hit, say, rows }` 在 Task 1（测试）、Task 2（`audienceSayZh` 吃 `{picked, hit, rows}`）、Task 5（渲染吃 `{said, picked, rows, say}`）、Task 6（CLI 打印）四处一致。`row` 字段 `{ id, attribute, value, size, stopped, lift, state }` 在测试与渲染两处一致。`pickableGroups` 产出 `{ id, attribute, value, size, zh }` 在 Task 4 的过滤与标签渲染两处一致。