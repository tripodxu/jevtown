# Jevtown 中文小镇 · Step 2（功能打磨）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已跑通的 Step 1 核心闭环（Worker + D1 + 静态前端 + mock 全流程）之上，补齐参考产品的四个核心功能：商品/闲置的追问阶段（买家会问什么、价格阶梯与需求曲线）、同帖多版本（改文案再发、并排对比）、收尾提问的人头展示、首页纯静态示例回放。

**Architecture:** 引擎全部来自 `public/shared/`（上游 MIT 代码已含 `followUpRequest`/`priceLadder`/`rankedAnswers`/`demandCurve`，本阶段主要是 Worker 编排补齐与前端展示）。新增代码集中在：`worker/index.js`（follow-up 阶段、版本参数化、`POST /api/version`）、`public/shared/bytes.js`（地图字节编解码）、`public/shared/replay.js`（存档回放）、`public/render.js`（视图渲染，app 与 showcase 共用）、`public/showcase.js`（首页示例）。Worker 集成测试用 `wrangler` 自带的 `unstable_dev` 起真实本地环境（含 D1 与 assets）。

**Tech Stack:** Cloudflare Workers + D1（wrangler 4 / `unstable_dev`）、无框架 ES Module 前端、`node:test`、mock 供应器（`public/shared/mock.js`，全程离线零花费）。

**现状基线（执行前请先验证）：**

```bash
cd E:\mimo\temp\ttemp\jev_games\jevtown
npm test        # 期望：24 pass, 0 fail
npm run dev     # 期望：http://localhost:5191 可访问，mock 模式全流程可跑
```

---

## 里程碑路线图（本计划只细化 Step 2）

| 里程碑 | 内容 | 状态 | 计划文件 |
|---|---|---|---|
| Step 1 · 核心闭环 | 中文小镇引擎、Worker API、D1、前端、mock 全流程 | ✅ 已完成 | —（README） |
| **Step 2 · 功能打磨** | **追问阶段、价格阶梯、多版本对比、示例回放** | **← 本计划** | 本文 |
| Step 3 · 真实模型联调 | TypeSafe/OpenRouter key 实测、成本与延迟记录 | 未开始 | 启动时另写 `2026-XX-XX-step3-real-model.md` |
| Step 4 · 上线准备 | 人格打包管线（省 CPU）、CAS 锁、d1 create + secret、部署 | 未开始 | 启动时另写 |
| Step 5 · 生态（可选） | MCP 服务器、居民系统 /me、分享卡片、OG 图 | 未开始 | 启动时另写 |

### Step 3-5 纲要（占位到启动时细化）

- **Step 3 · 真实模型联调**：前置 = 拿到 TypeSafe 或 OpenRouter key。任务轮廓：① `.dev.vars` 接真实 key 跑通一次转让帖全城检查，记录每阶段请求数/token/花费；② 扩展 `scripts/check.js` 输出 measurements 风格摘要（参照上游 `docs/measurements.md` 的口径）；③ 复核上游 F1 开放问题（网关保真度：同一请求直连 `api.typesafe.ai` 与 OpenRouter 各跑一次对比概率）。验收：一份真实检查的成本报告落入 `output/`。
- **Step 4 · 上线准备**：任务轮廓：① 人格打包管线（仿上游 `pack.js` + `scripts/build-crowd.js`，把 1 万人格属性压成 `crowd-zh.bin`，把 Worker 每请求的 `crowd()` 现算换成查表——免费档 10ms CPU 的硬门槛）；② `POST /api/wave` 加 CAS 锁（仿上游 `worker/town.js` 的 `json_set(plan,'$.asking',...)` 比较并交换）；③ `wrangler d1 create` + `wrangler secret put` + 部署 workers.dev 验证。验收：连续 3 次全城检查无 CPU 超限。
- **Step 5 · 生态**：MCP（复用 `runCheck`，仿上游 `mcp/server.js` 的双工具 + 预算护栏）、居民系统（最大件，独立计划）、浏览器画卡（canvas → PNG）。

---

## Task 0: git 基线

**Files:**
- Create: `.gitignore`（已存在，无需改）

- [ ] **Step 1: 初始化仓库并提交基线**

```bash
cd E:\mimo\temp\ttemp\jev_games\jevtown
git init -b main
git add .
git commit -m "chore: Step 1 baseline - working mock pipeline (worker + D1 + static frontend)"
```

Expected: 提交成功；`node_modules/ .wrangler/ output/ .dev.vars` 不入库（`.gitignore` 已覆盖）。

- [ ] **Step 2: 建工作分支**

```bash
git checkout -b feat/step2-polish
```

---

## Task 1: 迁移 0002 —— versions 表加 follow_up 与 prices 列

**Files:**
- Create: `migrations/0002_follow_up.sql`

- [ ] **Step 1: 写迁移文件**

```sql
-- 追问阶段的结果：{ answers, asked, totals }（answers 是题面，totals 是各答案概率和）。
ALTER TABLE versions ADD COLUMN follow_up TEXT;
-- 商品预设的价格阶梯（JSON 数组，如 [9,19,39,79]），需求曲线按它展开。
ALTER TABLE versions ADD COLUMN prices TEXT;
```

- [ ] **Step 2: 应用到本地 D1 并验证**

```bash
npx wrangler d1 migrations apply jevtown --local
npx wrangler d1 execute jevtown --local --command "PRAGMA table_info(versions)"
```

Expected: 迁移 ✅；输出列里能看到 `follow_up` 和 `prices`（type TEXT）。

- [ ] **Step 3: Commit**

```bash
git add migrations/0002_follow_up.sql
git commit -m "feat: migration 0002 - versions.follow_up and versions.prices"
```

---

## Task 2: Worker 集成测试基建（unstable_dev）

**Files:**
- Create: `test/helper.js`
- Create: `test/worker.test.js`

- [ ] **Step 1: 写测试助手 `test/helper.js`**

```js
// Worker 集成测试基建：用 wrangler 的 unstable_dev 起真实本地环境（D1 + assets + .dev.vars）。
import { execSync } from 'node:child_process';
import { unstable_dev } from 'wrangler';

export async function startWorker() {
  // 迁移是幂等的；--local 复用 .wrangler/state 的本地 D1。
  execSync('npx wrangler d1 migrations apply jevtown --local', { stdio: 'pipe' });
  return unstable_dev('worker/index.js', {
    config: 'wrangler.jsonc',
    port: 0,
    vars: { CROWD_DAILY_LIMIT: '0', CROWD_DAILY_BUDGET_USD: '0' }, // 测试不受限额
  });
}

/** 把一个版本跑完：batch 到 done，再 wave 到 done。 */
export async function runToDone(worker, post, version = 1) {
  for (;;) {
    for (;;) {
      const res = await worker.fetch(`/api/batch?post=${post}&v=${version}`);
      const batch = await res.json();
      if (batch.done) break;
    }
    const res = await worker.fetch(`/api/wave?post=${post}&v=${version}`, { method: 'POST' });
    const wave = await res.json();
    if (wave.done) return wave;
  }
}

export const postJSON = (worker, path, body) =>
  worker.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
```

- [ ] **Step 2: 写冒烟测试 `test/worker.test.js`**

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startWorker } from './helper.js';

const worker = await startWorker();
after(async () => { await worker.stop(); });

test('worker 起来了：feed 为空数组，check 开局返回第一波 600 人', async () => {
  const feed = await (await worker.fetch('/api/feed')).json();
  assert.ok(Array.isArray(feed.posts));

  const res = await postJSON(worker, '/api/check', { preset: 'listing', text: '出 iPhone 13，128G，电池 86%，1400 元，可小刀，包邮，联系我' });
  assert.equal(res.status, 200);
  const opening = await res.json();
  assert.equal(opening.state, 'running');
  assert.equal(opening.wave.total, 600);
});
```

- [ ] **Step 3: 跑测试确认通过**

```bash
npm test
```

Expected: 原 24 个测试 + 新 1 个全过（`unstable_dev` 首次启动约 5-15 秒）。若 `unstable_dev` 报配置错误，先单独运行 `node --test test/worker.test.js` 看完整报错；常见问题是 `config` 相对路径——在仓库根目录跑 `npm test` 即可。

- [ ] **Step 4: Commit**

```bash
git add test/helper.js test/worker.test.js
git commit -m "test: worker integration harness via unstable_dev"
```

---

## Task 3: 追问阶段（listing 买家会问什么 / product 价格阶梯）

**Files:**
- Modify: `worker/index.js`（导入、`runCheck`、新增 `runFollowUp`、`closeWave` 完成分支、`addSpend` 签名）
- Test: `test/worker.test.js`

- [ ] **Step 1: 写失败测试（追加到 `test/worker.test.js`）**

```js
test('product：跑完后有价格阶梯追问，GET /api/post 能拿到 followUp', async () => {
  const res = await postJSON(worker, '/api/check', {
    preset: 'product',
    text: '一款不臭的跑步袜，速干抗菌，99 元三双',
    prices: [9, 19, 39, 79],
  });
  const opening = await res.json();
  const summary = await runToDone(worker, opening.post, opening.version);

  assert.ok(summary.reach > 600, `reach=${summary.reach}`);
  const detail = await (await worker.fetch(`/api/post/${opening.post}?v=${opening.version}`)).json();
  assert.ok(detail.followUp, 'followUp 缺失');
  assert.ok(detail.followUp.asked > 0);
  assert.deepEqual(Object.keys(detail.followUp.totals).sort(), ['p0', 'p1', 'p2', 'p3']);
  assert.deepEqual(detail.prices, [9, 19, 39, 79]);
}, { timeout: 120_000 });

test('listing：跑完后有买家问题追问', async () => {
  const res = await postJSON(worker, '/api/check', { preset: 'listing', text: '出 iPhone 13，128G，电池 86%，无维修，1400 元，可小刀，包邮，联系我' });
  const opening = await res.json();
  await runToDone(worker, opening.post, opening.version);
  const detail = await (await worker.fetch(`/api/post/${opening.post}?v=${opening.version}`)).json();
  assert.ok(detail.followUp.asked > 0);
  assert.ok('negotiable' in detail.followUp.totals, '买家问题里应有砍价');
}, { timeout: 120_000 });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/worker.test.js
```

Expected: 两个新用例 FAIL（`detail.followUp` 为 null）。

- [ ] **Step 3: 改 `worker/index.js` —— ① 导入与 addSpend**

导入区（第 12-16 行附近）改为：

```js
import { openingRequest, openingAnswers, reactionRequest, questionId, MAX_TEXT_CHARS, followUpRequest } from '../public/shared/requests.js';
import { counters, segments, topSegments, voicesOf, rankedAnswers, demandCurve } from '../public/shared/summary.js';
import { PRESETS, CANT_TELL, priceLadder } from '../public/shared/presets.js';
```

`addSpend` 整体替换（number 参数化，为 Task 4 铺路）：

```js
const addSpend = (db, { post, number = 1, stage, n = 0, usd = 0, tokens = 0, day }) =>
  db.prepare(
    'INSERT INTO batches (post, number, stage, n, usd, tokens, day) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(post, number, stage, n, round2(usd), Math.round(tokens), day);
```

注意：现有 4 处 `addSpend(env.DB, {...})` 调用不用改（`number` 有默认值 1），但**从 batch 数组里单独执行的**那处（`closeWave` 里 `stage: 'ask'`）要加 `.run()` 之外无变化——它已经在用 `.run()`。其余在 `db.batch([...])` 内的保持语句形态即可。

- [ ] **Step 4: ② `runCheck` 接收 prices 并写库**

`runCheck` 中，`const text = String(body.text ?? '').trim();` 之后加：

```js
  const prices = presetId === 'product'
    ? (Array.isArray(body.prices) && body.prices.every((n) => Number.isFinite(n) && n > 0) && body.prices.length >= 2 ? body.prices.map(Number) : null)
    : null;
  if (presetId === 'product' && !prices) return fail('product 需要 prices：至少两个正数的数组，如 [9,19,39,79]');
```

两处 `INSERT INTO versions`（blocked 与 running 分支）都改为含 `prices`：

```sql
INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, plan, prices, usd, tokens) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

对应 bind 在原参数基础上，于 `plan`（running 分支）或 `blocked`（blocked 分支）之后插入 `prices ? JSON.stringify(prices) : null`。blocked 分支没有 plan 列，写法为：

```js
      env.DB.prepare(
        'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, prices, usd, tokens) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, text, stored.scores, stored.checks, stored.unlisted, stored.blocked, prices ? JSON.stringify(prices) : null, round2(usd), tokens),
```

- [ ] **Step 5: ③ 新增 `runFollowUp` 函数（放在 `closeWave` 之后）**

```js
/** 追问阶段：闲置帖问停下的人"会问卖家什么"；商品帖问价格阶梯。结果存 versions.follow_up。 */
async function runFollowUp(env, post, version, provider, reached, people, number) {
  const preset = PRESETS[post.preset];
  if (!preset.followUp) return null;
  const prices = version.prices ? JSON.parse(version.prices) : null;
  const answers = preset.followUp.answers ?? priceLadder(prices ?? [9, 19, 39, 79], '¥');
  const stopped = [...reached.entries()].filter(([, reaction]) => preset.reactions[reaction]?.stopped).map(([id]) => id);
  const totals = Object.fromEntries(Object.keys(answers).map((id) => [id, 0]));
  let asked = 0;
  let usd = 0;
  let tokens = 0;
  for (let i = 0; i < stopped.length; i += PER_REQUEST) {
    const batchPeople = stopped.slice(i, i + PER_REQUEST).map((pid) => people[pid]);
    const { answers: batchAnswers, usd: batchUsd, tokens: batchTokens } =
      await provider.ask(followUpRequest(post.preset, version.text, batchPeople, answers));
    usd += batchUsd;
    tokens += batchTokens;
    for (const who of batchPeople) {
      const probabilities = batchAnswers[questionId(who)]?.probabilities ?? {};
      asked += 1;
      for (const [id, value] of Object.entries(probabilities)) totals[id] = (totals[id] ?? 0) + value;
    }
  }
  const followUp = { answers, asked, totals };
  await env.DB.batch([
    env.DB.prepare('UPDATE versions SET follow_up = ?, usd = usd + ?, tokens = tokens + ? WHERE post = ? AND number = ?')
      .bind(JSON.stringify(followUp), round2(usd), tokens, post.id, number),
    addSpend(env.DB, { post: post.id, number, stage: 'followup', usd, tokens, day: today() }),
  ]);
  return followUp;
}
```

- [ ] **Step 6: ④ `closeWave` 完成分支调用它**

`closeWave` 收尾注释（"检查收尾：把收尾提问…"）之前插入：

```js
  const followUp = await runFollowUp(env, post, version, provider, reached, people, 1);
```

`closeWave` 的返回值里带上（供 runToDone 之外的调用方使用）：

```js
  return json({ wave: waveInfo, travels: false, done: true, reach: reached.size, followUp: followUp && { asked: followUp.asked } });
```

注意：`closeWave` 里已有一行 `const provider = providerOf(env);`，`runFollowUp` 直接用它。

- [ ] **Step 7: ⑤ `showPost` 返回 followUp 与 prices**

`showPost` 的返回 JSON（`return json({...base, counters: ...})` 块）中追加两个字段：

```js
    followUp: version.follow_up ? JSON.parse(version.follow_up) : null,
    prices: version.prices ? JSON.parse(version.prices) : null,
```

- [ ] **Step 8: 跑测试确认通过**

```bash
npm test
```

Expected: 全部 PASS（含两个新追问用例；mock 供应器已支持 `'negotiable' in criteria` 与 `'p0' in criteria` 两种追问形状，无需改 mock）。

- [ ] **Step 9: Commit**

```bash
git add worker/index.js test/worker.test.js
git commit -m "feat: follow-up stage for listing/product with price ladder storage"
```

---

## Task 4: 版本 API（同帖多版本、v 参数化）

**Files:**
- Modify: `worker/index.js`（`runCheck`、`runBatch`、`closeWave`、`showPost`、新增 `runVersion`、路由表）
- Test: `test/worker.test.js`

- [ ] **Step 1: 写失败测试（追加到 `test/worker.test.js`）**

```js
test('版本：同一帖可再发一版，两版各有各的计数，versions 列表齐全', async () => {
  const first = await (await postJSON(worker, '/api/check', { preset: 'post', text: '跑了五公里，说说我怎么坚持下来的，附训练计划' })).json();
  await runToDone(worker, first.post, first.version);
  const v1 = await (await worker.fetch(`/api/post/${first.post}?v=1`)).json();

  const second = await (await postJSON(worker, '/api/version', { post: first.post, text: '五公里跑三年，体重和焦虑一起下来的：我的笨办法' })).json();
  assert.equal(second.version, 2);
  await runToDone(worker, second.post, second.version);

  const v2 = await (await worker.fetch(`/api/post/${second.post}?v=2`)).json();
  assert.equal(v2.post.id, first.post);
  assert.notEqual(v2.counters.reach, undefined);
  assert.deepEqual(v2.versions.map((entry) => entry.number), [1, 2]);
  assert.ok(v2.versions.every((entry) => entry.text.length > 0));
}, { timeout: 240_000 });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/worker.test.js
```

Expected: 新用例 FAIL（`/api/version` 404）。

- [ ] **Step 3: `worker/index.js` 路由表加一行，并实现 `runVersion`**

路由 `fetch` 方法里，`if (request.method === 'POST' && path === '/api/check')` 之后加：

```js
      if (request.method === 'POST' && path === '/api/version') return await runVersion(request, env);
```

新增函数（放在 `runCheck` 之后）：

```js
/** 同帖再发一版：新开一个版本号，重新开局（新文本有新的分数与波次），复用同一 post 的受众池。 */
async function runVersion(request, env) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.post ?? '');
  const text = String(body.text ?? '').trim();
  if (!id) return fail('post is required');
  if (!text) return fail('text is empty');
  if (text.length > MAX_TEXT_CHARS) return fail(`text is longer than ${MAX_TEXT_CHARS} chars`);
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  if (post.state === 'running') return fail('previous version is still running', 409);

  const budget = Number(env.CROWD_DAILY_BUDGET_USD ?? 0);
  if (budget > 0 && (await spentToday(env.DB, today())) >= budget) return fail('today’s budget is spent', 429);

  const row = await env.DB.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS number FROM versions WHERE post = ?').bind(id).first();
  const number = row.number;
  const provider = providerOf(env);
  const pool = post.pool;
  const { answers, usd, tokens } = await provider.ask(openingRequest(post.preset, text));
  const opening = openingAnswers(answers);

  if (opening.blocked.length) {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, usd, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, number, text, JSON.stringify(opening.scores), JSON.stringify(opening.checks), JSON.stringify(opening.unlisted), JSON.stringify(opening.blocked), round2(usd), tokens),
      addSpend(env.DB, { post: id, number, stage: 'opening', usd, tokens, day: today() }),
    ]);
    return json({ post: id, version: number, state: 'blocked', blocked: opening.blocked });
  }

  const people = crowd(pool);
  const random = rng(hash32('waves', pool, `${id}.${number}`));
  const wave0 = firstWave(people, opening.scores, post.preset, random);
  const plan = { wave: 0, answered: 0, history: { 0: wave0.map((who) => who.id) } };
  await env.DB.batch([
    env.DB.prepare('UPDATE posts SET state = ? WHERE id = ?').bind('running', id),
    env.DB.prepare(
      'INSERT INTO versions (post, number, text, scores, checks, unlisted, blocked, plan, usd, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, number, text, JSON.stringify(opening.scores), JSON.stringify(opening.checks), JSON.stringify(opening.unlisted), JSON.stringify(opening.blocked), JSON.stringify(plan), round2(usd), tokens),
    addSpend(env.DB, { post: id, number, stage: 'opening', usd, tokens, day: today() }),
  ]);
  return json({ post: id, version: number, state: 'running', wave: { index: 0, total: wave0.length } });
}
```

- [ ] **Step 4: `runBatch` / `closeWave` / `showPost` 参数化 v**

`runBatch(url, env)` 与 `closeWave(url, env)` 里，取 `post` 之后加一行，并把硬编码的版本号全部换掉：

```js
  const v = Number(url.searchParams.get('v') ?? '1') || 1;
```

具体替换（两个函数里各自）：
- `const version = await loadVersion(env.DB, id);` → `const version = await loadVersion(env.DB, id, v);`
- 反应/批次/更新语句里所有 `number = 1`、`AND number = 1`、bind 里的字面 `1` → 绑定 `v`。例如 reactions 插入变为：

```js
    return env.DB.prepare('INSERT INTO reactions (post, number, id, wave, reaction) VALUES (?, ?, ?, ?, ?)')
      .bind(id, v, pid, plan.wave, reaction);
```

- versions 更新：`WHERE post = ? AND number = 1` → `.bind(..., id, v)`；
- `reactionsMap` 调用改为带版本：把 `const reached = await reactionsMap(env.DB, id);` 换成 `const reached = await reactionsMap(env.DB, id, v);`，并把 `reactionsMap` 改为：

```js
const reactionsMap = async (db, id, number = 1) => {
  const { results } = await db.prepare('SELECT id, reaction FROM reactions WHERE post = ? AND number = ?').bind(id, number).all();
  return new Map(results.map((row) => [row.id, row.reaction]));
};
```

- 种子与花费：`const versionId = \`${id}.1\`;` → `` const versionId = `${id}.${v}`; ``（`closeWave` 里的 `versionId: \`${id}.1\`` 同理）；`closeWave` 里 `runFollowUp(env, post, version, provider, reached, people, 1)` 的末位 `1` → `v`；closeWave 内其余 `addSpend`/`UPDATE versions` 补 `number = v`。

- `closeWave` 完成分支的两条 UPDATE 也按版本：

```js
    env.DB.prepare('UPDATE versions SET said = ? WHERE post = ? AND number = ?').bind(JSON.stringify(said), id, v),
    env.DB.prepare("UPDATE posts SET state = 'done' WHERE id = ?").bind(id),
```

`showPost(path, env)` 改为解析 `?v=`（默认取最大已完成版本）：

```js
async function showPost(path, env, url) {
  const id = path.slice('/api/post/'.length);
  const post = await loadPost(env.DB, id);
  if (!post) return fail('no such post', 404);
  let v = Number(url.searchParams.get('v')) || 0;
  if (!v) {
    const row = await env.DB.prepare('SELECT MAX(number) AS number FROM versions WHERE post = ?').bind(id).first();
    v = row?.number ?? 1;
  }
  const version = await loadVersion(env.DB, id, v);
  // ……以下与原实现相同，但 reactions 查询与 showPost 内所有 `number = 1` 换成 `AND number = ?` 绑定 v，
  // 且 `loadVersion(env.DB, id)` → `loadVersion(env.DB, id, v)`。
```

`showPost` 返回体里加版本列表（供前端对比入口）：

```js
    versions: versionsOf(env.DB, id),
```

并在文件里加：

```js
/** 某帖的全部版本（轻量列表：版本号、文本、派生态）。 */
async function versionsOf(db, id) {
  const { results } = await db.prepare('SELECT number, text, blocked, said, plan FROM versions WHERE post = ? ORDER BY number').bind(id).all();
  return results.map((row) => ({
    number: row.number,
    text: row.text,
    state: row.blocked ? 'blocked' : row.said ? 'done' : 'running',
  }));
}
```

路由行改为传 url：`return await showPost(path.slice('/api/post/'.length), env, url);`

- [ ] **Step 5: 跑测试确认通过**

```bash
npm test
```

Expected: 全部 PASS（含新版本用例；跑两版共约 4-8 秒）。

- [ ] **Step 6: Commit**

```bash
git add worker/index.js test/worker.test.js
git commit -m "feat: per-post versions - POST /api/version, v param across batch/wave/post"
```

---

## Task 5: 共享小件重构（bytes.js、personView、追问中文标签）

**Files:**
- Create: `public/shared/bytes.js`
- Modify: `public/shared/labels.js`（顶部导入区 + 文件末尾追加）
- Modify: `worker/index.js`（import `encodeBytes` 与 `personView`，删除本地同名实现）
- Test: `test/bytes.test.js`

- [ ] **Step 1: 写失败测试 `test/bytes.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBytes, decodeBytes } from '../public/shared/bytes.js';

test('字节往返一致，且 base64 长度约为原 4/3', () => {
  const bytes = new Uint8Array(10000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 8;
  const text = encodeBytes(bytes);
  assert.equal(text.length, Math.ceil(10000 / 3) * 4);
  const back = decodeBytes(text);
  assert.deepEqual(Array.from(back), Array.from(bytes));
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/bytes.test.js
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 新建 `public/shared/bytes.js`**

```js
// 地图字节（人格 0..9999 → 反应序号 1..n，0 = 没看到）的 base64 编解码，Worker 与浏览器共用。
// Worker/Node 22 与浏览器都有全局 btoa/atob。

export function encodeBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function decodeBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
```

- [ ] **Step 4: `labels.js` 末尾追加中文追问标签与人格视图**

```js
/** 闲置转让的追问：买家会先问卖家什么（keys 与 presets.js listing.followUp.answers 一致）。 */
export const FOLLOWUP_LISTING_ZH = {
  available: '还在吗',
  negotiable: '能便宜点吗',
  quick_discount: '今天要能给优惠吗',
  condition: '成色怎么样，有划痕吗',
  defects: '功能都正常吗，修过吗',
  how_old: '用了多久',
  why_selling: '为什么卖',
  original: '是原装的吗',
  documents: '有发票、包装或保修吗',
  included: '都附带什么',
  details: '关键参数（电池、里程、尺寸）',
  photos: '能多发几张图或视频吗',
  delivery: '发物流吗，谁出运费',
  pickup: '哪里自提',
  try_first: '可以先验货吗',
  safe_deal: '支持担保交易或货到付款吗',
  exchange: '可以换物吗',
  hold: '能帮我留几天吗',
  bulk: '多件有优惠吗',
  nothing: '不用问，直接要了',
};

/** 人格 → 界面卡片用的干净视图（Worker 的 voices 与回放共用）。 */
export function personView(who) {
  return {
    id: who.id,
    name: who.name.zh,
    age: who.age,
    job: JOB[who.job]?.zh,
    city: who.city.zh,
    temper: TEMPER[who.temper]?.zh,
  };
}
```

（`labels.js` 顶部 import 行扩为 `import { INTEREST, FIELDS, AGE_GROUP, TEMPER, BUDGET, SHOP, JOB } from './vocab.js';`）

- [ ] **Step 5: `worker/index.js` 换用共享件**

- 导入区加：`import { encodeBytes } from '../public/shared/bytes.js';` 与 `import { personView } from '../public/shared/labels.js';`
- 删除文件末尾的本地 `encodeBytes` 函数与 `voiceOf` 函数；
- `showPost` 里 `who: voiceOf(people[voice.id])` → `who: personView(people[voice.id])`；
- `worker/index.js` 导入区第 11 行 `import { JOB, TEMPER } from '../public/shared/vocab.js';` 若因此不再被使用则删除。

- [ ] **Step 6: 跑全部测试确认通过**

```bash
npm test
```

Expected: 全部 PASS（25 + 1 个新用例）。

- [ ] **Step 7: Commit**

```bash
git add public/shared/bytes.js public/shared/labels.js worker/index.js test/bytes.test.js
git commit -m "refactor: shared bytes codec, person view and zh follow-up labels"
```

---

## Task 6: 前端渲染重构 + 版本对比 + 追问展示

**Files:**
- Create: `public/render.js`
- Modify: `public/app.js`（渲染逻辑搬入 render.js；编排加 v 状态、版本提交、对比视图、追问区块）
- Verify: 手动 + `node --check`

- [ ] **Step 1: 新建 `public/render.js` —— 把 app.js 的 `render`/`renderLegend`/`stat`/`esc`/`PRESET_NOUN`/`readCheck` 原样搬来并抽出 `renderCheck`**

`render.js` 的导出面（渲染函数体 = 现 app.js 的 `render` 函数体原样迁移，仅做三处小改，下面全部给出）：

```js
// 视图渲染：app.js（实时检查）与 showcase.js（示例回放）共用。
import { PRESETS, LOOKS, lookOf } from './shared/presets.js';
import { drawGrid, attachTooltip } from './grid.js';
import {
  REACTIONS_ZH, REASONS_ZH, HOOKS_ZH, COMMENTS_ZH, SEGMENT_ZH, segmentValueZh, CHECKS_ZH, LIST_ZH, FOLLOWUP_LISTING_ZH,
} from './shared/labels.js';
import { rankedAnswers, demandCurve } from './shared/summary.js';
import { decodeBytes } from './shared/bytes.js';

export const PRESET_NOUN = (presetId) => ({ post: '帖子', listing: '闲置转让', product: '商品文案', headline: '标题' }[presetId] ?? presetId);
export const readCheck = (p) => (p >= 0.7 ? 'yes' : p <= 0.3 ? 'no' : 'unclear');
export const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const stat = (value, label) => `<div class="stat"><b>${typeof value === 'number' ? value.toLocaleString() : value}</b><span>${label}</span></div>`;
export { stat };

export function renderCheck(el, result) {
  // 与 app.js 原 render(result) 相同的四个区块骨架，内部改为：
  el.hidden = false;
  el.innerHTML = [
    overview(result),
    waves(result),
    counts(result),
    map(result),
    jevReading(result),
    segmentsView(result),
    saidView(result),
    followUpView(result),
    voices(result),
  ].join('');

  const bytes = decodeBytes(result.looks);
  drawGrid(el.querySelector('.grid'), bytes, result.post.preset);
  attachTooltip(el.querySelector('.grid'), bytes, result.post.preset);
  renderLegend(el.querySelector('.legend'), result.post.preset);
}
```

其中每个小区块是 render.js 内的纯函数，内容从原 `render` 的对应 `html.push` 段落**逐段平移**（模板字符串原样保留），仅以下三处差异：

```js
// ① map(result)：canvas 不再靠 id 取，改在容器内查找——
//    原：'<h3>小镇地图</h3><div class="map-wrap"><canvas class="grid" id="grid"></canvas>...'
//    改：'<h3>小镇地图</h3><div class="map-wrap"><canvas class="grid"></canvas><div class="legend"></div></div>'
//     （并删除原 map-wrap 里硬编码的 id）
// ② saidView(result)：每个答案行追加 picks 人数（said.picks[list][answerId]?.length），
//    例如：`<span class="num">${(said.picks?.[list]?.[id] ?? []).length} 人</span>`
// ③ 新增 followUpView(result)：

function followUpView(result) {
  const f = result.followUp;
  if (!f || !f.asked) return '';
  const presetId = result.post.preset;
  const html = ['<h3>追问阶段</h3>'];
  if (presetId === 'listing') {
    html.push(`<div class="said-row"><span class="what">问过 ${f.asked} 个停下的人，他们会先问卖家：</span></div>`);
    for (const row of rankedAnswers(f).slice(0, 5)) {
      html.push(`<div class="seg"><span class="label">${esc(FOLLOWUP_LISTING_ZH[row.id] ?? row.text)}</span>` +
        `<span class="bar2"><i style="width:${Math.round(row.share * 100)}%;background:var(--accent)"></i></span>` +
        `<span class="num">${Math.round(row.share * 100)}%</span></div>`);
    }
  } else if (presetId === 'product' && result.prices) {
    html.push('<div class="seg"><span class="label">价格阶梯</span><span class="bar2"></span><span class="num">买的人 / 收入</span></div>');
    for (const step of demandCurve(f, result.prices)) {
      const most = demandCurve(f, result.prices).at(-1).revenue || 1;
      html.push(`<div class="seg"><span class="label">¥${step.price}</span>` +
        `<span class="bar2"><i style="width:${Math.round((step.revenue / most) * 100)}%;background:var(--glad)"></i></span>` +
        `<span class="num">${step.buyers} 人 · ¥${step.revenue}</span></div>`);
    }
  }
  return html.join('');
}
```

`renderLegend(el, presetId)` 与原函数相同，只是往传入的 `el.innerHTML` 写。

- [ ] **Step 2: `app.js` 改编排（删掉搬走的渲染代码）**

- 顶部导入：`import { renderCheck, PRESET_NOUN } from './render.js';`（删除 `drawGrid/attachTooltip` 与渲染函数本体、`decodeBytes`）。
- 提交流程加编辑状态与 v：

```js
let current = { post: null, version: 1, base: null }; // base：做对比时的原版完整视图

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('text').value.trim();
  const preset = $('preset').value;
  if (!text) return;
  $('go').disabled = true;
  try {
    status(current.post ? '再发一版：小镇重新掂量……' : '开局：小镇在掂量这段文字是写给谁的……', 0.02);
    const opening = current.post
      ? await postJSON('/api/version', { post: current.post, text })
      : await postJSON('/api/check', { preset, text, prices: preset === 'product' ? [9, 19, 39, 79] : undefined });
    if (opening.state === 'blocked') {
      status(`小镇拒绝发布：${opening.blocked.map((id) => BLOCKED_ZH[id] ?? id).join('、')}`, 1);
      return;
    }
    current.post = opening.post;
    current.version = opening.version;

    let done = false;
    while (!done) {
      for (;;) {
        const batch = await getJSON(`/api/batch?post=${current.post}&v=${current.version}`);
        status(`第 ${batch.wave + 1} 波：${batch.answered} / ${batch.total} 人被问过`, batch.answered / Math.max(1, batch.total));
        if (batch.done) break;
      }
      const wave = await postJSON(`/api/wave?post=${current.post}&v=${current.version}`);
      if (wave.done) { done = true; status('收尾完成。', 0.98); }
      else status(`第 ${wave.wave.index + 1} 波完成，情绪 ${wave.wave.mood >= 0 ? '+' : ''}${wave.wave.mood}——继续第 ${wave.next.index + 1} 波（${wave.next.total} 人）`, 0.5);
    }

    const view = await getJSON(`/api/post/${current.post}?v=${current.version}`);
    showResult(view);
    await loadFeed();
  } catch (error) {
    $('statusLine').innerHTML = `<span class="error">${esc(error.message)}</span>`;
  } finally {
    $('go').disabled = false;
  }
});

function showResult(view) {
  const el = $('result');
  renderCheck(el, view);
  // 版本 ≥2 时并排对比：左边旧版、右边新版（各占一张卡）；单版本时隐藏对比卡。
  const aside = document.getElementById('compare');
  if (current.version > 1) {
    getJSON(`/api/post/${current.post}?v=1`).then((v1) => {
      renderCheck(aside, v1);
      aside.hidden = false;
    });
  } else {
    aside.hidden = true;
  }
  el.scrollIntoView({ behavior: 'smooth' });
}
```

- 结果区上方加"改一版再发"按钮：`index.html` 的 `#result` 卡片末尾加 `<button id="revise" type="button">改一版再发</button>`；app.js 加：

```js
$('revise').addEventListener('click', () => {
  const latest = current;
  getJSON(`/api/post/${latest.post}?v=${latest.version}`).then((view) => {
    $('text').value = view.post.text;
    $('preset').value = view.post.preset;
    $('text').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
```

`index.html` 的 `<main>` 里 `#result` 之后加对比容器：`<section id="compare" class="card" hidden><h2>第 1 版（对比）</h2></section>`。

- [ ] **Step 3: 语法检查 + 手动验证**

```bash
node --check public/render.js
node --check public/app.js
npm run dev
```

浏览器打开 http://localhost:5191 ：① 发一条闲置帖跑完 → 看到"追问阶段：买家会先问什么"条形；② 点"改一版再发"改两个词再发 → 完成后出现"第 1 版（对比）"卡片，两版并排；③ 发一条商品文案（prices 默认 9/19/39/79）→ 看到"价格阶梯"四档收入条。悬停地图人格档案正常。

- [ ] **Step 4: Commit**

```bash
git add public/render.js public/app.js public/index.html
git commit -m "feat: side-by-side versions, follow-up views and shared render module"
```

---

## Task 7: 首页示例回放（纯静态 showcase）

**Files:**
- Create: `public/shared/replay.js`
- Create: `public/examples/iphone-listing-v1.json`、`public/examples/iphone-listing-v2.json`（由命令生成）
- Create: `public/showcase.js`
- Modify: `public/index.html`（引入 showcase）

- [ ] **Step 1: 写 `public/shared/replay.js`**

```js
// 从存档 JSON（scripts/check.js 的 output/checks 格式）回放一页视图，不调任何 API。
// 这也是"纯静态部署"的可行证明：回放全部发生在浏览器。
import { PRESETS } from './presets.js';
import { crowd } from './personas.js';
import { counters, segments, topSegments, voicesOf } from './summary.js';
import { encodeBytes } from './bytes.js';
import { personView } from './labels.js';

export function replayToView(saved) {
  const presetId = saved.presetId;
  const keys = Object.keys(PRESETS[presetId].reactions);
  const bytes = Uint8Array.from(saved.reactions);
  const people = crowd(saved.pool ?? 'zh');
  const all = segments(presetId, keys, bytes, people);
  return {
    post: { id: saved.versionId, preset: presetId, text: saved.text, state: 'done' },
    counters: counters(presetId, keys, bytes),
    waves: saved.waves,
    looks: encodeBytes(bytes),
    said: saved.said ?? null,
    followUp: saved.followUp ?? null,
    prices: saved.prices ?? null,
    checks: saved.checks ?? {},
    unlisted: saved.unlisted ?? [],
    segments: { stopped: topSegments(all, 'stopped'), glad: topSegments(all, 'glad'), sorry: topSegments(all, 'sorry') },
    voices: voicesOf(saved.versionId, presetId, bytes).map((voice) => ({ ...voice, who: personView(people[voice.id]) })),
    spent: { usd: saved.usd ?? 0, tokens: 0 },
  };
}
```

- [ ] **Step 2: 生成两份示例存档**

`scripts/check.js` 的存档里补两个键（存档前加一行）：编辑 `scripts/check.js`，在 `JSON.stringify(` 的对象里、`usd: result.usd,` 之后加 `followUp: result.followUp,`（`runCheck` 的返回已含 followUp，mock 也有）。

```bash
npm run check -- --preset listing "出 iPhone 13，128G，电池 86%，无维修，带盒子和充电线，1400 元，可小刀，包邮，联系我"
# 把 output/checks/ 下最新文件复制为 public/examples/iphone-listing-v1.json
npm run check -- --preset listing "iPhone 13 128G，电池健康 86%，全程带壳贴膜无维修，1400 可小刀，箱说齐全，可验货可发顺丰"
# 复制为 public/examples/iphone-listing-v2.json
node --check public/shared/replay.js
```

Expected: 两个 JSON 均含 `reactions`（10000 个数）、`keys`、`waves`、`said`。

- [ ] **Step 3: 写 `public/showcase.js` 并挂到首页**

```js
// 首页示例：两条真实检查的存档，纯浏览器回放——访客先看到小镇会做什么，再决定写不写。
import { renderCheck } from './render.js';
import { replayToView } from './shared/replay.js';

const shown = [fetch('/examples/iphone-listing-v1.json').then((r) => r.json()), fetch('/examples/iphone-listing-v2.json').then((r) => r.json())];

Promise.allSettled(shown).then(([a, b]) => {
  const host = document.getElementById('showcase');
  if (!a.value) return;
  host.hidden = false;
  renderCheck(host.querySelector('.example-a'), replayToView(a.value));
  if (b.value) renderCheck(host.querySelector('.example-b'), replayToView(b.value));
});
```

`index.html`：`<main>` 开头（`#compose` 之前）插入

```html
    <section id="showcase" class="card" hidden>
      <h2>示例：同一条手机转让帖，两种写法</h2>
      <p class="hint">以下是保存下来的真实检查结果，纯浏览器回放，不花一分钱。</p>
      <div class="examples">
        <div class="card example-a"></div>
        <div class="card example-b"></div>
      </div>
    </section>
    <script type="module" src="/showcase.js"></script>
```

（`<script>` 行放进现有脚本标签旁边；`styles.css` 追加 `.examples { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } @media (max-width: 800px) { .examples { grid-template-columns: 1fr; } }`）

- [ ] **Step 4: 手动验证 + 全量测试**

```bash
npm test
npm run dev
```

Expected: 测试全过；首页无需任何输入即展示两版对比（地图、计数、小镇在说），后续发帖流程不受影响。

- [ ] **Step 5: Commit**

```bash
git add public/shared/replay.js public/showcase.js public/index.html public/styles.css public/examples scripts/check.js
git commit -m "feat: static showcase replays two saved checks on the home page"
```

---

## Task 8: 收尾 —— README 勾选与全量验证

**Files:**
- Modify: `README.md`（步骤清单勾选 Step 2，目录表加 `render.js`/`showcase.js`/`bytes.js`/`replay.js`）

- [ ] **Step 1: README 的"步骤清单"勾掉 Step 2，"与上游的差异"补一句：追问阶段、版本对比、示例回放已按上游思路实现，密钥仍走 mock/本地**
- [ ] **Step 2: 全量验证**

```bash
npm test        # 期望 0 fail
npm run dev     # 手动跑一遍：示例回放 → 发帖 → 改一版再发 → 对比
```

- [ ] **Step 3: Commit 并合回 main**

```bash
git add README.md
git commit -m "docs: step 2 done"
git checkout main
git merge --no-ff feat/step2-polish -m "merge: step 2 - follow-up, versions, showcase"
```

---

## 风险与注意

- **`unstable_dev` 是 wrangler 的实验性 API**：若某版本启动失败，锁版本或改用 `miniflare` 直接构造（选项同名平移）；测试跑在仓库根目录（`config: 'wrangler.jsonc'` 相对路径）。
- **测试时长**：mock 全城检查约 1-2 秒/版，worker.test.js 全文件 < 30 秒；不要在测试里并发跑多个 worker（共享本地 D1 状态）。
- **回放存档体积**：一份检查 JSON ≈ 100 KB（10000 个反应数字），两份示例 ≈ 200 KB 入库，可接受；将来接真实数据时再考虑反应串压缩。
- **版本并发**：`POST /api/version` 的"上一版必须完成"检查与 close 的 CAS 依赖单用户本地场景；上线前（Step 4）补锁。
- **Jev 读英文、界面读中文的边界不变**：`labels.js` 只进界面，`personaLine` 只进 Jev。
