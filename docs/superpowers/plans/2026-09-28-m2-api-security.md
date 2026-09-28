# M2 API 安全与并发正确性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 堵上三个已确认的运行时缺口：写操作无身份校验与预算闸、收波无 CAS 锁、批次认领非原子。

**Architecture:** 全部改动集中在 `worker/index.js` 单文件 + 一次 D1 迁移（0005 加 `posts.author` 列）+ 前端 `authHeaders` 扩展 + 测试夹具（`test/helper.js`）与 `test/worker.test.js` 调用点同步。身份令牌走**请求头 `x-jev-author`**（与既有 `x-jev-provider`/`x-jev-key` BYOK 约定同族），不用 cookie：前端 `authHeaders()` 已是现成注入点，测试无需解析 set-cookie。读操作（`GET /api/post/:id`、`/api/feed`）保持公开。

**Tech Stack:** Cloudflare Worker + D1（SQLite，JSON 函数）、node:test + wrangler `unstable_dev`。

---

## Phase 0 · 事实基线（已采集，执行前无需重新调研）

| 事实 | 出处 |
|---|---|
| 路由分发与 try/catch 包装 | `worker/index.js:98-117` |
| `runCheck` 限额/预算检查与 posts INSERT、响应形状 | `worker/index.js:121-190`（限额 `:133-141`，INSERT `:158`/`:174`，响应 `:181-189`） |
| `runVersion` 检查顺序：404→409→限额→预算→INSERT | `worker/index.js:195-246`（409 在 `:204`，限额 `:207-215`） |
| `runBatch` 无身份/预算闸；plan 读-改-写；reactions INSERT 与 versions 更新在同一 `env.DB.batch` | `worker/index.js:250-299` |
| `closeWave` 先读 state 再行动；推进路径只更新 `versions.plan`（不动 posts.state）；收尾路径置 `state='done'`；收尾提问循环内有软预算检查 | `worker/index.js:303-391`（状态检查 `:308`，推进 `:331-339`，软预算 `:356-357`，done `:388`） |
| 小助手：`fail/json/today/newId/round2/providerOf/loadPost/loadVersion/addSpend/spentToday/reactionsMap` | `worker/index.js:36-94` |
| 测试基建：`startWorker(vars)`（默认限额/预算为 '0'）、`runToDone(worker,post,version)`、`postJSON(worker,path,body)` 返回 Response | `test/helper.js:5-30` |
| 现有 8 个 worker 集成用例清单与调用点 | `test/worker.test.js:8-141` |
| 断言风格：`node:assert/strict` 的 `ok/equal/deepEqual`；GET 不带 headers | `test/worker.test.js:1-3` |
| 前端 `authHeaders()` 与 `getJSON/postJSON` 注入点 | `public/app.js:21-42` |
| 前端对 state 的消费仅两处：`opening.state==='blocked'`、feed 文案映射 | `public/app.js:154`、`public/app.js:245` |
| D1 迁移目录与"只增不改"约定 | `migrations/0001-0004`、`docs/CONVENTIONS.md` |
| `console.log` 仅存于 CLI `scripts/check.js`（合法） | grep 全仓库 |

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `migrations/0005_author.sql` | Create | `posts.author` 列（写操作身份令牌） |
| `worker/index.js` | Modify | 新增 `overBudget`/`authorOk` 助手；四个路由接线；closeWave 拆分为 claim + settleWave；runBatch 认领制 |
| `public/app.js` | Modify | `authHeaders` 带 `x-jev-author`；开局响应存 author；feed 的 state 映射改宽容 |
| `test/helper.js` | Modify | `postJSON` 支持附加 headers；`runToDone` 带 author；新增 `authorOf`/`runBatches` |
| `test/worker.test.js` | Modify | 既有调用点补 author；新增 4 个用例（预算闸/作者校验/收波 CAS/批次认领） |
| `docs/modules/worker-api.md` | Modify | 横切关注点补身份/预算/CAS 三节 |
| `docs/TESTING.md` | Modify | 用例表补 4 个新用例 |
| `docs/MEMORY.md` | Modify | 合入记录（最新置顶） |

---

### Task A: 预算闸 —— batch/wave 也受全站日预算约束

**Files:**
- Modify: `worker/index.js`（新增 `overBudget`；`runCheck`/`runVersion` 改为复用它；`runBatch`/`closeWave` 入口接线）
- Test: `test/worker.test.js`（新增 1 个用例）

- [ ] **Step 1: 写失败测试**

在 `test/worker.test.js` 顶部 import 行补 `execSync`：

```js
import { execSync } from 'node:child_process';
```

（插在 `import assert from 'node:assert/strict';` 之后。）

在文件末尾（限额用例之后）追加：

```js
test('预算闸：当天已花超后，/api/batch 与 /api/wave 都被 429 拦下', async () => {
  // 1. 用默认 worker（预算 0 = 不限）正常开一个局
  const opening = await (await postJSON(worker, '/api/check', { preset: 'post', text: '预算闸验证：一条普通帖子' })).json();
  assert.equal(opening.state, 'running');

  // 2. 直接往本地 D1 插一笔"今天已花 9.99"的探测流水（finally 里清除）
  const day = new Date().toISOString().slice(0, 10);
  const probe = `budgetprobe-${Date.now()}`;
  execSync(
    `npx wrangler d1 execute jevtown --local --command "INSERT OR REPLACE INTO batches (post, number, stage, n, usd, tokens, day) VALUES ('${probe}', 1, 'opening', 0, 9.99, 0, '${day}')"`,
    { stdio: 'pipe' },
  );

  // 3. 起一个日预算 0.5 的 worker：batch 与 wave 都应 429
  const gated = await startWorker({ CROWD_DAILY_BUDGET_USD: '0.5' });
  try {
    const batch = await gated.fetch(`/api/batch?post=${opening.post}&v=1`);
    assert.equal(batch.status, 429, `batch=${batch.status}`);
    const wave = await gated.fetch(`/api/wave?post=${opening.post}&v=1`, { method: 'POST' });
    assert.equal(wave.status, 429, `wave=${wave.status}`);
  } finally {
    await gated.stop();
    execSync(`npx wrangler d1 execute jevtown --local --command "DELETE FROM batches WHERE post = '${probe}'"`, { stdio: 'pipe' });
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test 2>&1 | tail -20`
Expected: 新用例 FAIL（`batch=200` 而非 429；断言消息 `batch=200`）；其余 41 个用例仍 PASS。

- [ ] **Step 3: 实现 overBudget 助手并接线**

在 `worker/index.js` 的 `spentToday` 定义之后（当前 `:88` 附近）新增：

```js
/** 全站日预算闸：超过 CROWD_DAILY_BUDGET_USD 就拒后续写操作（0 = 不限）。 */
const overBudget = async (env) => {
  const budget = Number(env.CROWD_DAILY_BUDGET_USD ?? 0);
  return budget > 0 && (await spentToday(env.DB, today())) >= budget;
};
```

`runCheck` 中把这两行（当前 `:140-141`）：

```js
  const budget = Number(env.CROWD_DAILY_BUDGET_USD ?? 0);
  if (budget > 0 && (await spentToday(env.DB, day)) >= budget) return fail('today’s budget is spent', 429);
```

替换为：

```js
  if (await overBudget(env)) return fail('today’s budget is spent', 429);
```

`runVersion` 中把这两行（当前 `:214-215`）：

```js
  const budget = Number(env.CROWD_DAILY_BUDGET_USD ?? 0);
  if (budget > 0 && (await spentToday(env.DB, today())) >= budget) return fail('today’s budget is spent', 429);
```

同样替换为 `if (await overBudget(env)) return fail('today’s budget is spent', 429);`

`runBatch` 中在状态检查（`if (post.state !== 'running') return fail('the check is not running', 409);`，当前 `:255`）之后插入：

```js
  if (await overBudget(env)) return fail('today’s budget is spent', 429);
```

`closeWave` 中在状态检查（`if (post.state !== 'running') return fail('the check is not running', 409);`，当前 `:308`）之后插入同一行。

注意：`closeWave` 内部收尾提问循环的软预算检查（当前 `:356-357`，mock 豁免、标记 `missing[list]='budget'` 后继续）**保持原样**——它防的是"进入收尾后预算在中途被烧穿"，与入口硬闸是两层。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test 2>&1 | tail -8`
Expected: `tests 42` / `pass 42` / `fail 0`。

- [ ] **Step 5: 提交**

```bash
git add worker/index.js test/worker.test.js
git commit -m "feat: apply daily budget gate to batch and wave routes"
```

### Task B: 作者令牌 —— 写操作必须证明"这个检查是我的"

**Files:**
- Create: `migrations/0005_author.sql`
- Modify: `worker/index.js`（`authorOk` 助手；`runCheck` 生成并落库 author、响应带回；`runVersion`/`runBatch`/`closeWave` 校验）
- Modify: `public/app.js`（`authHeaders` 扩展；开局存 author；feed state 映射）
- Modify: `test/helper.js`（`postJSON` 附加 headers；`runToDone` 带 author；新增 `authorOf`/`runBatches`）
- Modify: `test/worker.test.js`（调用点补 author + 新用例）

- [ ] **Step 1: 写失败测试（新用例）**

在 `test/worker.test.js` 末尾追加：

```js
test('作者校验：没有 x-jev-author 头，batch/wave/version 全部 403；带头放行', async () => {
  const opening = await (await postJSON(worker, '/api/check', { preset: 'post', text: '作者校验验证：一条普通帖子' })).json();
  assert.ok(opening.author, 'check 响应应带回 author 令牌');

  const batch = await worker.fetch(`/api/batch?post=${opening.post}&v=1`);
  assert.equal(batch.status, 403, `batch=${batch.status}`);
  const wave = await worker.fetch(`/api/wave?post=${opening.post}&v=1`, { method: 'POST' });
  assert.equal(wave.status, 403, `wave=${wave.status}`);
  const version = await postJSON(worker, '/api/version', { post: opening.post, text: '别人想再发一版' });
  assert.equal(version.status, 403, `version=${version.status}`);

  // 带头就能继续（防止校验把主人关在门外）
  const ok = await worker.fetch(`/api/batch?post=${opening.post}&v=1`, { headers: { 'x-jev-author': opening.author } });
  assert.equal(ok.status, 200, `batch with author=${ok.status}`);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test 2>&1 | tail -20`
Expected: 新用例 FAIL——`opening.author` 为 undefined（第一条断言即失败），或后续 `batch=200`。

- [ ] **Step 3: 建迁移 0005**

创建 `migrations/0005_author.sql`：

```sql
-- 写操作（batch/wave/version）的作者令牌：/api/check 开局时生成，随 x-jev-author 请求头带回。
-- 升级前的旧本地帖 author 为 NULL，其写操作将一律 403——本地开发重开一个检查即可。
ALTER TABLE posts ADD COLUMN author TEXT;
```

- [ ] **Step 4: Worker 生成与校验 author**

在 `worker/index.js` 的 `loadVersion` 定义之后（当前 `:74` 附近）新增：

```js
/** 写操作的作者校验：x-jev-author 头必须与 posts.author 一致（旧帖 author 为 NULL 时一律拒绝）。 */
const authorOk = (request, post) => {
  const sent = String(request?.headers.get('x-jev-author') ?? '');
  return !!post.author && sent === post.author;
};
```

`runCheck` 中在 `const id = newId();`（当前 `:147`）之后增加一行：

```js
  const author = crypto.randomUUID();
```

两处 posts INSERT（当前 `:158` 与 `:174`）的列清单与绑定各加 `author`。以 running 路径（`:174`）为例，将：

```js
    env.DB.prepare('INSERT INTO posts (id, preset, pool, text, state, created_at, day, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, presetId, pool, text, 'running', now, day, ip),
```

替换为：

```js
    env.DB.prepare('INSERT INTO posts (id, preset, pool, text, state, created_at, day, ip, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, presetId, pool, text, 'running', now, day, ip, author),
```

blocked 路径（`:158`）同样处理（列清单加 `author`，绑定末尾加 `author`）。

running 路径的响应（当前 `:181-189`）加一个字段：

```js
  return json({
    post: id,
    version: 1,
    state: 'running',
    author,
    provider: provider.name,
    unlisted: opening.unlisted,
    checks: opening.checks,
    wave: { index: 0, total: wave0.length },
  });
```

`runBatch` 中在 Step A 插入的预算闸之后插入：

```js
  if (!authorOk(request, post)) return fail('this check is not yours', 403);
```

`closeWave` 中同样在预算闸之后插入同一行。

`runVersion` 中在预算闸之后（即 `const row = await env.DB.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS number ...` 之前）插入：

```js
  if (!authorOk(request, post)) return fail('this post is not yours', 403);
```

顺序说明（写进提交信息）：runVersion 的校验顺序为 404→409→限额→预算→作者。限额是全局信息、先返回无害，且保持既有"限额用例期望 429"的语义不被身份校验抢先变成 403。

- [ ] **Step 5: 前端接线**

`public/app.js` 中 `authHeaders`（当前 `:21-24`）替换为：

```js
let currentAuthor = null; // 当前检查的作者令牌（/api/check 响应带回；刷新页面即失效，需重开检查）
const authHeaders = () => {
  const picks = byok();
  return {
    ...(picks ? { 'x-jev-provider': picks.provider, 'x-jev-key': picks.key } : {}),
    ...(currentAuthor ? { 'x-jev-author': currentAuthor } : {}),
  };
};
```

开局响应处理处（当前 `:158-159` 的 `current.post = opening.post; current.version = opening.version;` 之后）插入：

```js
    if (opening.author) {
      currentAuthor = opening.author;
      localStorage.setItem(`jevtown.author.${opening.post}`, opening.author);
    }
```

feed 文案映射（当前 `:245`）将：

```js
`<span class="meta">${esc(PRESET_NOUN_OF(post.preset))} · ${post.state === 'done' ? '已完成' : post.state === 'running' ? '进行中' : '已拒绝'}</span></li>`
```

替换为（blocked 才显示"已拒绝"，其余非 done 一律"进行中"——为 Task C 的 'closing' 中间态兜底）：

```js
`<span class="meta">${esc(PRESET_NOUN_OF(post.preset))} · ${post.state === 'blocked' ? '已拒绝' : post.state === 'done' ? '已完成' : '进行中'}</span></li>`
```

- [ ] **Step 6: 测试夹具支持 author**

`test/helper.js` 的 `postJSON`（当前 `:29-30`）替换为：

```js
export const postJSON = (worker, path, body, headers = {}) =>
  worker.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
```

`runToDone`（当前 `:16-27`）替换为：

```js
/** 把一个版本跑完：batch 到 done，再 wave 到 done。author 经 x-jev-author 头带上。 */
export async function runToDone(worker, post, version = 1, author = '') {
  const headers = author ? { 'x-jev-author': author } : {};
  for (;;) {
    for (;;) {
      const res = await worker.fetch(`/api/batch?post=${post}&v=${version}`, { headers });
      const batch = await res.json();
      if (batch.done) break;
    }
    const res = await worker.fetch(`/api/wave?post=${post}&v=${version}`, { method: 'POST', headers });
    const wave = await res.json();
    if (wave.done) return wave;
  }
}

/** 只把当前波次的批次跑完（不收波），用于构造"可以收波"的中间态。 */
export async function runBatches(worker, post, version = 1, author = '') {
  const headers = author ? { 'x-jev-author': author } : {};
  for (;;) {
    const res = await worker.fetch(`/api/batch?post=${post}&v=${version}`, { headers });
    const batch = await res.json();
    if (batch.done) return batch;
  }
}

/** 从开局响应取作者令牌（测试里代替浏览器存储）。 */
export const authorOf = (opening) => opening.author ?? '';
```

import 行（当前 `:3`）改为：

```js
import { startWorker, postJSON, runToDone, runBatches, authorOf } from './helper.js';
```

- [ ] **Step 7: 更新既有调用点**

`test/worker.test.js` 中逐处修改（以当前文件为准，位置可能因 Task A 的插入而偏移，用搜索定位）：

| 位置（搜索特征） | 改为 |
|---|---|
| `await runToDone(worker, opening.post, opening.version);`（多处） | `await runToDone(worker, opening.post, opening.version, authorOf(opening));` |
| `const batchRes = await worker.fetch(`/api/batch?post=${running.post}&v=1`);` | `const batchRes = await worker.fetch(`/api/batch?post=${running.post}&v=1`, { headers: { 'x-jev-author': running.author } });` |
| 版本用例中 `postJSON(worker, '/api/version', { post: ..., text: ... })` | 追加第四参：`postJSON(worker, '/api/version', { post: first.post, text: '…' }, { 'x-jev-author': authorOf(first) })`（`first` 即该用例自己的开局响应变量，以实际变量名为准） |
| 限额用例中 `postJSON(worker, '/api/version', ...)` | **不改**——限额（429）先于作者校验返回，语义不变 |
| blocked 用例 | 不改——只有 GET |

- [ ] **Step 8: 运行全量测试**

Run: `npm test 2>&1 | tail -8`
Expected: `tests 43` / `pass 43` / `fail 0`。

- [ ] **Step 9: 提交**

```bash
git add migrations/0005_author.sql worker/index.js public/app.js test/helper.js test/worker.test.js
git commit -m "feat: require x-jev-author header on write routes

- 迁移 0005 给 posts 加 author 列；/api/check 开局生成令牌并随响应返回
- batch/wave/version 校验令牌；读操作保持公开
- 前端 authHeaders 扩展；feed 的 state 映射改宽容（为 closing 中间态兜底）
- runVersion 校验顺序 404→409→限额→预算→作者，保持既有 429 用例语义"
```

### Task C: 收波 CAS —— 并发 /api/wave 只有一个能推进

**Files:**
- Modify: `worker/index.js`（`closeWave` 拆为 claim 包装 + `settleWave` 原体；推进路径恢复 `state='running'`；done 路径加状态条件）
- Test: `test/worker.test.js`（新增 1 个用例）

- [ ] **Step 1: 写失败测试**

```js
test('收波 CAS：并发收波只推进一次，且收波后批次还能继续', async () => {
  const opening = await (await postJSON(worker, '/api/check', {
    preset: 'product',
    text: '一款不臭的跑步袜，速干抗菌，99 元三双',
    prices: [9, 19, 39, 79],
  })).json();
  const author = authorOf(opening);
  await runBatches(worker, opening.post, opening.version, author); // 只跑完第 0 波批次，不收波

  // 并发两次收波：真实并发时一个 200 一个 409；若被串行化则两个 200（各自收一波）。
  // 不变量：没有 500；成功的次数与波次推进数一致。
  const settled = await Promise.all([1, 2].map(() =>
    worker.fetch(`/api/wave?post=${opening.post}&v=1`, { method: 'POST', headers: { 'x-jev-author': author } })));
  const codes = settled.map((r) => r.status);
  assert.ok(codes.every((c) => c === 200 || c === 409), `codes=${codes}`);
  const wins = codes.filter((c) => c === 200).length;
  assert.ok(wins >= 1, `codes=${codes}`);

  // 每次成功收波恰好推进一个波次：history 从 {0} 起，推进 k 次后长度为 k+1。
  const detail = await (await worker.fetch(`/api/post/${opening.post}?v=1`)).json();
  assert.equal(detail.waves.length, wins + 1, `waves=${detail.waves.length} wins=${wins}`);

  // 收波把状态还回 running：批次还能继续打（防卡死在 closing）。
  const after = await worker.fetch(`/api/batch?post=${opening.post}&v=1`, { headers: { 'x-jev-author': author } });
  assert.equal(after.status, 200, `batch after close=${after.status}`);

  // 跑完后每个波次都问满了（没有批次被跳过/重复）。
  const final = await runToDone(worker, opening.post, opening.version, author);
  assert.ok(final.reach >= 600, `reach=${final.reach}`);
  const done = await (await worker.fetch(`/api/post/${opening.post}?v=1`)).json();
  for (const wave of done.waves) assert.equal(wave.size, wave.asked, `wave ${wave.index}: ${wave.size}/${wave.asked}`);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test 2>&1 | tail -25`
Expected: 新用例 FAIL。改造前两个并发收波可能双推进（`waves.length` 与 wins 不符）或第二个请求 500；现有 8+2 个用例仍 PASS。

- [ ] **Step 3: 拆分 closeWave 并加 CAS**

把 `worker/index.js` 当前 `closeWave` 函数（`:303-391`，从 `async function closeWave(url, request, env) {` 到函数体结束）整体改造为：

```js
async function closeWave(url, request, env) {
  const id = url.searchParams.get('post');
  const v = Number(url.searchParams.get('v')) || 1;
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  if (post.state !== 'running') return fail('the check is not running', 409);
  if (await overBudget(env)) return fail('today’s budget is spent', 429);
  if (!authorOk(request, post)) return fail('this check is not yours', 403);

  // 原子占位：同一检查的并发收波只有一个能把 running → closing，其余 409。
  const claim = await env.DB.prepare("UPDATE posts SET state = 'closing' WHERE id = ? AND state = 'running'").bind(id).run();
  if (!claim.meta.changes) return fail('the check is already finished', 409);
  try {
    return await settleWave(env, post, id, v);
  } catch (error) {
    // 失败要把占位还回去，否则这个检查会卡在 closing 再也动不了。
    await env.DB.prepare("UPDATE posts SET state = 'running' WHERE id = ? AND state = 'closing'").bind(id).run();
    throw error;
  }
}

/** 收波本体：算情绪定去留；推进则把状态还回 running（批次还要继续），收尾则置 done。 */
async function settleWave(env, post, id, v) {
  const version = await loadVersion(env.DB, id, v);
  const plan = JSON.parse(version.plan);
  const presetId = post.preset;
  const pool = post.pool;
  const preset = PRESETS[presetId];
  const scores = JSON.parse(version.scores);
  const maxWaves = Math.min(Number(env.CROWD_MAX_WAVES ?? WAVES_MAX), WAVES_MAX);
  const provider = providerOf(env, null);

  const waveIndex = plan.wave;
  const order = plan.history[String(waveIndex)];
  const { results: waveRows } = await env.DB.prepare('SELECT reaction FROM reactions WHERE post = ? AND number = ? AND wave = ?')
    .bind(id, v, waveIndex)
    .all();
  const drawn = waveRows.map((row) => row.reaction);
  const waveMood = mood(presetId, drawn);
  const waveTravels = travels(presetId, drawn);
  const waveInfo = { index: waveIndex, asked: order.length, size: drawn.length, mood: round2(waveMood), travels: waveTravels };

  const reached = await reactionsMap(env.DB, id, v);

  // 传播：够 glad，且还有波次与还没看到的人。
  if (waveTravels && waveIndex + 1 < maxWaves && reached.size < CROWD) {
    const people = crowdOf(pool);
    const random = rng(hash32('waves', pool, `${id}.${v}.${waveIndex + 1}`));
    const next = nextWave(people, reached, scores, presetId, waveIndex + 1, random);
    plan.wave = waveIndex + 1;
    plan.answered = 0;
    plan.history[String(waveIndex + 1)] = next.map((who) => who.id);
    await env.DB.batch([
      env.DB.prepare('UPDATE versions SET plan = ? WHERE post = ? AND number = ?').bind(JSON.stringify(plan), id, v),
      env.DB.prepare("UPDATE posts SET state = 'running' WHERE id = ? AND state = 'closing'").bind(id),
    ]);
    return json({ wave: waveInfo, travels: true, next: { index: waveIndex + 1, total: next.length } });
  }
  // ……以下收尾逻辑原样保留（runFollowUp / gatherAsked / asking / 收尾提问循环 / said 落库）……
}
```

收尾段最后的 posts 状态更新（原 `:388`）改为带状态条件：

```js
    env.DB.prepare("UPDATE posts SET state = 'done' WHERE id = ? AND state = 'closing'").bind(id),
```

迁移要点（改完必须逐项核对）：
1. 原 `closeWave` 函数体从 `const version = await loadVersion(...)` 起，整体搬进 `settleWave`，**逻辑一行不改**（含 `providerOf(env, request)` 调用点——settleWave 收不到 request，改为 `providerOf(env, null)`，BYOK 头在 entry 已由 Task B 校验，此处退化为 env 配置/mock；**此为已知取舍**：收波阶段不再透传 BYOK 头。若评审认为不可接受，备选方案是把 request 一并传进 settleWave：`settleWave(env, post, id, v, request)` 且 `providerOf(env, request)`——采用备选则同步修改测试无需改动）。
2. 推进路径的 `UPDATE versions SET plan` 与 `UPDATE posts SET state='running'` 必须同一个 `env.DB.batch`（原子）。
3. 函数头注释（`// -- POST /api/wave：收波、定去留、收尾 ...`）保留在 closeWave 上方。

- [ ] **Step 4: 运行全量测试**

Run: `npm test 2>&1 | tail -8`
Expected: `tests 44` / `pass 44` / `fail 0`。

- [ ] **Step 5: 提交**

```bash
git add worker/index.js test/worker.test.js
git commit -m "fix: CAS lock on wave close via posts.state claim

- closeWave 入口原子占位 running→closing，并发收波只有一个进
- 推进路径在同一 batch 内把状态还回 running（批次继续）；done 路径带状态条件
- 失败回滚占位，防检查卡死；settleWave 拆分自原 closeWave，逻辑原样搬运"
```

### Task D: 批次认领 —— plan.answered 原子递增，防并发批次问同一批人

**Files:**
- Modify: `worker/index.js`（`runBatch` 改认领制）
- Test: `test/worker.test.js`（新增 1 个用例）

- [ ] **Step 1: 先验证 D1 的 JSON 函数可用（make-plan：先证后用）**

创建临时文件 `probe.sql`（内容一行，不要入库）：

```sql
SELECT json_set('{"answered":3}', '$.answered', 5) AS plan;
```

Run: `npx wrangler d1 execute jevtown --local --file probe.sql`
Expected: 输出包含 `{"plan":"{\"answered\":5}"}`。随后 `Remove-Item probe.sql`。
若 JSON 函数不可用（报 no such function），停止本任务并上报主控——备选设计是迁移 0006 给 versions 加 `answered INTEGER` 列并改以列为准（需要同步改 showPost/closeWave 对 plan.answered 的读取），不要硬编码绕过。

- [ ] **Step 2: 写失败测试**

```js
test('批次认领：并发 /api/batch 不错位，第 0 波恰好问满 600 人', async () => {
  const opening = await (await postJSON(worker, '/api/check', { preset: 'post', text: '批次认领验证：一条普通帖子' })).json();
  const headers = { 'x-jev-author': authorOf(opening) };

  // 并发打批：改造前两个请求读到同一 answered=0，问同一批人 → reactions 主键碰撞 → 500。
  const results = await Promise.all([1, 2, 3, 4].map(() =>
    worker.fetch(`/api/batch?post=${opening.post}&v=1`, { headers })));
  const codes = results.map((r) => r.status);
  assert.ok(codes.every((c) => c === 200 || c === 409), `codes=${codes}`);
  assert.ok(codes.includes(200), `codes=${codes}`);

  // 跑完后第 0 波必须恰好 600 人各判一次（认领制不错位、不重问）。
  await runToDone(worker, opening.post, opening.version, authorOf(opening));
  const detail = await (await worker.fetch(`/api/post/${opening.post}?v=1`)).json();
  assert.equal(detail.waves[0].size, 600, `wave0=${detail.waves[0].size}`);
  assert.equal(detail.waves[0].asked, 600);
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npm test 2>&1 | tail -25`
Expected: 新用例 FAIL（并发请求出现 500，或 wave0 size < 600 / > 600）；其余用例 PASS。
注意：若并发被 dev server 串行化导致测试偶尔通过，属环境竞态——以 `codes` 无 500 与 wave0=600 两条不变量为准，人工复跑 3 次确认。

- [ ] **Step 4: runBatch 改认领制**

把 `worker/index.js` 当前 `runBatch` 函数体（`:250-299`）中从 `const version = await loadVersion(env.DB, id, v);` 到 `await env.DB.batch(statements);` 的部分，按下列结构重组（**只改认领与写库两处，Jev 调用与决策采样逻辑原样保留**）：

```js
async function runBatch(url, request, env) {
  const id = url.searchParams.get('post');
  const v = Number(url.searchParams.get('v') ?? '1') || 1;
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  if (post.state !== 'running') return fail('the check is not running', 409);
  if (await overBudget(env)) return fail('today’s budget is spent', 429);
  if (!authorOk(request, post)) return fail('this check is not yours', 403);
  const version = await loadVersion(env.DB, id, v);
  const plan = JSON.parse(version.plan);
  const order = plan.history[String(plan.wave)];
  const start = plan.answered;
  if (start >= order.length) return json({ done: true, answered: start, total: order.length });

  const presetId = post.preset;
  const pool = post.pool;
  const batch = order.slice(start, start + PER_REQUEST);
  const people = batch.map((pid) => persona(pool, pid));
  const provider = providerOf(env, request);

  // 原子认领本批：只有 answered 仍等于 start 时才 +batch.length，防两个并发批次问同一批人。
  const claim = await env.DB.prepare(
    "UPDATE versions SET plan = json_set(plan, '$.answered', json_extract(plan, '$.answered') + ?) WHERE post = ? AND number = ? AND json_extract(plan, '$.answered') = ?",
  ).bind(batch.length, id, v, start).run();
  if (!claim.meta.changes) return fail('this batch was already claimed, retry', 409);

  let answers;
  let usd;
  let tokens;
  let ms;
  try {
    ({ answers, usd, tokens, ms } = await provider.ask(reactionRequest(presetId, version.text, people)));
  } catch (error) {
    // 问 Jev 失败：把认领还回去，下一批（或重试）会问回这批人。
    await env.DB.prepare(
      "UPDATE versions SET plan = json_set(plan, '$.answered', json_extract(plan, '$.answered') - ?) WHERE post = ? AND number = ?",
    ).bind(batch.length, id, v).run();
    throw error;
  }

  const versionId = `${id}.${v}`;
  // 决策样本：只采第一波的第一批（曝光最靠前的人），留存 Jev 读到的原句与它给出的分布。
  let decisionSamples = null;
  const drawnPairs = [];
  const statements = batch.map((pid, index) => {
    const probabilities = answers[questionId(people[index])]?.probabilities ?? {};
    const reaction = drawReaction(probabilities, pool, pid, versionId) ?? CANT_TELL;
    drawnPairs.push({ id: pid, reaction });
    if (start === 0 && !version.decisions && decisionSamples?.length !== 10) {
      (decisionSamples ??= []).push({
        id: pid,
        line: personaLine(people[index], PRESETS[presetId]),
        ask: PRESETS[presetId].ask,
        probabilities,
        reaction,
      });
    }
    return env.DB.prepare('INSERT INTO reactions (post, number, id, wave, reaction) VALUES (?, ?, ?, ?, ?)')
      .bind(id, v, pid, plan.wave, reaction);
  });
  if (decisionSamples) statements.push(env.DB.prepare('UPDATE versions SET decisions = ? WHERE post = ? AND number = ?').bind(JSON.stringify(decisionSamples), id, v));
  statements.push(
    // answered 已在认领时推进，这里只累加花费与 tokens。
    env.DB.prepare('UPDATE versions SET usd = usd + ?, tokens = tokens + ? WHERE post = ? AND number = ?')
      .bind(round2(usd), tokens, id, v),
    addSpend(env.DB, { post: id, number: v, stage: `wave${plan.wave}`, n: start, usd, tokens, ms, day: today() }),
  );
  await env.DB.batch(statements);
  // drawn = 这批人各自被 Jev 判定成了什么（前端实时点亮地图用）；usd/tokens/ms = 本批调用成本。
  return json({ answered: start + batch.length, total: order.length, wave: plan.wave, drawn: drawnPairs, usd: round2(usd), tokens, ms });
}
```

与现状的差异只有三处：① 认领语句（`claim`）插在 Jev 调用前；② Jev 失败时回滚认领；③ 末尾 `env.DB.batch` 里删掉原来的 `plan` 更新（answered 已由认领推进），`UPDATE versions` 只留 usd/tokens。

- [ ] **Step 5: 运行全量测试**

Run: `npm test 2>&1 | tail -8`
Expected: `tests 45` / `pass 45` / `fail 0`。

- [ ] **Step 6: 提交**

```bash
git add worker/index.js test/worker.test.js
git commit -m "fix: atomic batch claim on versions.plan.answered

- 认领制：json_set 条件递增，并发批次只有一个成功，其余 409 重试
- Jev 调用失败回滚认领，语义与改造前一致（失败批次可重问）
- D1 JSON 函数可用性已用 probe.sql 验证（见计划 Step 1）"
```

### Task E: 收尾 —— 文档同步与 MEMORY

**Files:**
- Modify: `docs/modules/worker-api.md`、`docs/TESTING.md`、`docs/MEMORY.md`

- [ ] **Step 1: 更新 worker-api.md 横切关注点**

在 `docs/modules/worker-api.md`「横切关注点」节补三条（插在限额条之后）：

```markdown
4. **身份（作者令牌）**：`/api/check` 开局生成 `author`（迁移 0005 的 `posts.author` 列）并随响应返回；
   `runBatch`/`closeWave`/`runVersion` 校验请求头 `x-jev-author` 一致，不一致 403。
   读操作（`/api/post/:id`、`/api/feed`）保持公开——分享链接可看，不可烧钱。
   `runVersion` 的校验顺序：404 → 409 → 限额 → 预算 → 作者。
5. **预算闸**：`overBudget(env)` 对 check/version/batch/wave 四个写路由一致生效；
   closeWave 收尾提问循环内的软检查（mock 豁免、标记 budget 后继续）是第二层，防中途烧穿。
6. **CAS 与原子性**：closeWave 入口原子占位 `posts.state: running → closing`（并发只有一个进，
   失败回滚）；推进路径同 batch 内还回 `running`，收尾置 `done`。runBatch 用
   `json_set(plan,'$.answered', …+N)` 条件递增认领批次，Jev 失败回滚认领。
```

- [ ] **Step 2: 更新 TESTING.md**

在「测试布局」表 `test/worker.test.js` 行补充：新增预算闸 429 双路、作者校验 403 双路 + 放行、
收波 CAS 不变量（waves.length = wins + 1、收波后批次可继续）、批次认领（wave0 恰好 600）四个用例；
总用例数改为 45（以 `npm test` 输出为准）。

- [ ] **Step 3: MEMORY 置顶一条**

```markdown
## <今天日期> · M2 API 安全与并发正确性落地

- 预算闸：overBudget 对 check/version/batch/wave 四路一致（0.5 美元即熔断，有探测用例）。
- 作者令牌：迁移 0005 加 posts.author；写操作校验 x-jev-author 头，读操作公开；
  刷新页面丢 author（in-memory），需重开检查——已知限制。
- 收波 CAS：posts.state 原子占位 + 失败回滚；推进路径同 batch 还回 running。
  取舍：settleWave 不再透传 BYOK 头（entry 已校验身份），收波阶段用 env 通道/mock。
- 批次认领：plan.answered 条件递增；Jev 失败回滚认领。D1 JSON 函数已实测可用。
- 测试 45 用例全绿（mock 通道）。
```

- [ ] **Step 4: 提交**

```bash
git add docs/
git commit -m "docs: sync worker-api, testing, memory for M2 security work"
```

---

## Self-Review（写计划者已自查）

1. **发现覆盖**：F4（batch 无身份/预算）→ Task A+B；F5（收波无 CAS）→ Task C；F6（answered 非原子）→ Task D；文档同步 → Task E。✓
2. **占位符扫描**：每个代码步骤给出完整可抄代码；Task C 的"收尾逻辑原样保留"是明确的搬运指令而非占位；Task D 的 probe 验证先于实现。✓
3. **签名一致性**：`overBudget(env)` / `authorOk(request, post)` / `authorOf(opening)` / `runBatches(worker, post, version, author)` 在各任务间命名与参数一致；`settleWave` 的 request 透传问题已显式给出主选与备选。✓
4. **顺序风险**：Task B 会批量更新 Task A 新增的用例调用点（预算闸用例里的 batch/wave 也要带 author）——执行 Task B Step 7 时一并处理，属预期修改量。✓
5. **回滚安全**：每个任务独立分支独立提交；0005 迁移只增不改；既有 8 个用例在每步之后都必须保持 PASS。✓
