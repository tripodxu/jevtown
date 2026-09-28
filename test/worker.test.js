import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { startWorker, postJSON, runToDone, runBatches, authorOf } from './helper.js';

const worker = await startWorker();
after(async () => { await worker.stop(); });
// 兜底：清掉历史泄漏的预算探测行（探测行残留会让当天所有写路由被 429 到 UTC 当天结束）。
after(() => execSync(`npx wrangler d1 execute jevtown --local --command "DELETE FROM batches WHERE post LIKE 'budgetprobe-%'"`, { stdio: 'pipe' }));

test('worker 起来了：feed 为空数组，check 开局返回第一波 600 人', async () => {
  const feed = await (await worker.fetch('/api/feed')).json();
  assert.ok(Array.isArray(feed.posts));

  const res = await postJSON(worker, '/api/check', { preset: 'listing', text: '出 iPhone 13，128G，电池 86%，1400 元，可小刀，包邮，联系我' });
  assert.equal(res.status, 200);
  const opening = await res.json();
  assert.equal(opening.state, 'running');
  assert.equal(opening.wave.total, 600);
});

test('product：跑完后有价格阶梯追问，GET /api/post 能拿到 followUp', async () => {
  const res = await postJSON(worker, '/api/check', {
    preset: 'product',
    text: '一款不臭的跑步袜，速干抗菌，99 元三双',
    prices: [9, 19, 39, 79],
  });
  const opening = await res.json();
  const summary = await runToDone(worker, opening.post, opening.version, authorOf(opening));

  assert.ok(summary.reach > 600, `reach=${summary.reach}`);
  const detail = await (await worker.fetch(`/api/post/${opening.post}?v=${opening.version}`)).json();
  assert.ok(detail.followUp, 'followUp 缺失');
  assert.ok(detail.followUp.asked > 0);
  // priceLadder 的答案键：p0 = 哪档都不买，p1..p4 = 四档价格（与 prices 数组等长）。
  assert.deepEqual(Object.keys(detail.followUp.totals).sort(), ['p0', 'p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(detail.prices, [9, 19, 39, 79]);
}, { timeout: 120_000 });

test('调用报告：分阶段次数/耗时/tokens 齐全，provider 记录在案', async () => {
  const opening = await (await postJSON(worker, '/api/check', { preset: 'post', text: '调用报告验证：一条普通的帖子' })).json();
  await runToDone(worker, opening.post, opening.version, authorOf(opening));
  const detail = await (await worker.fetch(`/api/post/${opening.post}?v=1`)).json();

  const report = detail.report;
  assert.ok(report, 'report 缺失');
  assert.equal(report.provider, 'mock');
  const byStage = Object.fromEntries(report.stages.map((s) => [s.stage, s]));
  assert.ok(byStage.opening, '缺 opening 阶段');
  assert.equal(byStage.opening.n, 1);
  const waveStages = report.stages.filter((s) => /^wave\d+$/.test(s.stage));
  assert.ok(waveStages.length >= 1, '缺波次阶段');
  for (const wave of waveStages) {
    assert.ok(wave.n >= 1, `波次应逐批记账，得 ${wave.n}`);
    assert.ok(wave.ms > 0, 'mock 也应记录模拟耗时');
    assert.ok(wave.tokens > 0);
  }
  assert.ok(report.totals.requests >= report.stages.length);
  assert.ok(report.totals.ms > 0);
  // spent 口径 = versions.usd（mock 全为 0）
  assert.equal(report.totals.usd, 0);
  // 决策现场：首批抽样 ≤10 例，每例带 Jev 读到的原句、问题、概率分布与判定结果
  assert.ok(Array.isArray(detail.decisions) && detail.decisions.length === 10, `decisions=${detail.decisions?.length}`);
  for (const d of detail.decisions) {
    assert.ok(d.line.length > 10 && d.ask.length > 10);
    assert.ok(d.reaction.length > 0);
    assert.ok(Object.keys(d.probabilities).length >= 2);
  }
  // 实时监控数据源：/api/batch 响应带本批的逐人判定与调用成本
  const running = await (await postJSON(worker, '/api/check', { preset: 'post', text: '实时监控数据源验证：一条普通帖子' })).json();
  const batchRes = await worker.fetch(`/api/batch?post=${running.post}&v=1`, { headers: { 'x-jev-author': running.author } });
  const batch = await batchRes.json();
  assert.ok(Array.isArray(batch.drawn) && batch.drawn.length === 100, `drawn=${batch.drawn?.length}`);
  for (const pair of batch.drawn) {
    assert.ok(Number.isInteger(pair.id) && pair.id >= 0 && pair.id < 10000);
    assert.ok(typeof pair.reaction === 'string' && pair.reaction.length > 0);
  }
  assert.ok(typeof batch.usd === 'number' && typeof batch.tokens === 'number' && batch.ms >= 0);
}, { timeout: 120_000 });

test('listing：跑完后有买家问题追问', async () => {
  const res = await postJSON(worker, '/api/check', { preset: 'listing', text: '出 iPhone 13，128G，电池 86%，无维修，1400 元，可小刀，包邮，联系我' });
  const opening = await res.json();
  await runToDone(worker, opening.post, opening.version, authorOf(opening));
  const detail = await (await worker.fetch(`/api/post/${opening.post}?v=${opening.version}`)).json();
  assert.ok(detail.followUp.asked > 0);
  assert.ok('negotiable' in detail.followUp.totals, '买家问题里应有砍价');
}, { timeout: 120_000 });

test('版本：同一帖可再发一版，两版各有各的计数，versions 列表齐全', async () => {
  const first = await (await postJSON(worker, '/api/check', { preset: 'post', text: '跑了五公里，说说我怎么坚持下来的，附训练计划' })).json();
  await runToDone(worker, first.post, first.version, authorOf(first));

  const second = await (await postJSON(worker, '/api/version', { post: first.post, text: '五公里跑三年，体重和焦虑一起下来的：我的笨办法' }, { 'x-jev-author': authorOf(first) })).json();
  assert.equal(second.version, 2);
  await runToDone(worker, second.post, second.version, authorOf(first));

  const v2 = await (await worker.fetch(`/api/post/${second.post}?v=2`)).json();
  assert.equal(v2.post.id, first.post);
  assert.ok(v2.counters.reach > 0);
  assert.deepEqual(v2.versions.map((entry) => entry.number), [1, 2]);
  assert.ok(v2.versions.every((entry) => entry.text.length > 0));
  assert.ok(v2.versions.every((entry) => entry.state === 'done'));
}, { timeout: 240_000 });

test('product 缺 prices → 400；上一版还在跑时再发一版 → 409', async () => {
  const noPrices = await postJSON(worker, '/api/check', { preset: 'product', text: '一款不臭的跑步袜' });
  assert.equal(noPrices.status, 400);

  const running = await (await postJSON(worker, '/api/check', { preset: 'post', text: '限流测试：这一版故意不跑完' })).json();
  assert.equal(running.state, 'running');
  const conflict = await postJSON(worker, '/api/version', { post: running.post, text: '另一版' });
  assert.equal(conflict.status, 409);
});

test('blocked 帖的详情页：state=blocked 且没有计数与地图', async () => {
  const opening = await (await postJSON(worker, '/api/check', { preset: 'listing', text: '傻逼东西你去死吧' })).json();
  assert.equal(opening.state, 'blocked');
  const detail = await (await worker.fetch(`/api/post/${opening.post}`)).json();
  assert.equal(detail.post.state, 'blocked');
  assert.equal(detail.counters, undefined);
  assert.equal(detail.looks, undefined);
  assert.ok(detail.blocked.includes('insult'));
});

test('每日限额：/api/check 与 /api/version 都会被 429 拦下', async () => {
  const limited = await startWorker({ CROWD_DAILY_LIMIT: '2' });
  try {
    // 共享 D1 里可能已有今天建的帖子：先数一数现状，再验证"超限必 429"。
    const feed = await (await limited.fetch('/api/feed')).json();
    const existing = feed.posts.length;
    assert.ok(existing >= 2, `限额用例需要已有帖子做基数，现仅 ${existing}`);

    const rejected = await postJSON(limited, '/api/check', { preset: 'post', text: '这条应该被每日限额拦住' });
    assert.equal(rejected.status, 429);

    // 已完成的帖子再发一版同样过不了限额门。
    const done = feed.posts.find((post) => post.state === 'done');
    const versionRejected = await postJSON(limited, '/api/version', { post: done.id, text: '限额下不许再发' });
    assert.equal(versionRejected.status, 429);
  } finally {
    await limited.stop();
  }
});

test('预算闸：当天已花超后，/api/batch 与 /api/wave 都被 429 拦下', async () => {
  // 1. 用默认 worker（预算 0 = 不限）正常开一个局
  const opening = await (await postJSON(worker, '/api/check', { preset: 'post', text: '预算闸验证：一条普通帖子' })).json();
  assert.equal(opening.state, 'running');

  // 2. 起一个日预算 0.5 的 worker。探测行的插入与 worker 停止都收进 try/finally：
  //    startWorker 抛异常时还没插过探测行，不会污染本地 D1。
  const gated = await startWorker({ CROWD_DAILY_BUDGET_USD: '0.5' });
  const day = new Date().toISOString().slice(0, 10);
  const probe = `budgetprobe-${Date.now()}`;
  try {
    // 未花超：预算 0.5、当天已花 0 → 放行
    const ok = await gated.fetch(`/api/batch?post=${opening.post}&v=1`, { headers: { 'x-jev-author': opening.author } });
    assert.equal(ok.status, 200, `batch before spend=${ok.status}`);
    // 直接往本地 D1 插一笔"今天已花 9.99"的探测流水
    execSync(
      `npx wrangler d1 execute jevtown --local --command "INSERT OR REPLACE INTO batches (post, number, stage, n, usd, tokens, day) VALUES ('${probe}', 1, 'opening', 0, 9.99, 0, '${day}')"`,
      { stdio: 'pipe' },
    );
    // 已花超：batch 与 wave 都应 429
    const batch = await gated.fetch(`/api/batch?post=${opening.post}&v=1`);
    assert.equal(batch.status, 429, `batch=${batch.status}`);
    const wave = await gated.fetch(`/api/wave?post=${opening.post}&v=1`, { method: 'POST' });
    assert.equal(wave.status, 429, `wave=${wave.status}`);
  } finally {
    await gated?.stop();
    execSync(`npx wrangler d1 execute jevtown --local --command "DELETE FROM batches WHERE post = '${probe}'"`, { stdio: 'pipe' });
  }
});

test('作者校验：没有 x-jev-author 头，batch/wave/version 全部 403；带头放行', async () => {
  const opening = await (await postJSON(worker, '/api/check', { preset: 'post', text: '作者校验验证：一条普通帖子' })).json();
  assert.ok(opening.author, 'check 响应应带回 author 令牌');

  const batch = await worker.fetch(`/api/batch?post=${opening.post}&v=1`);
  assert.equal(batch.status, 403, `batch=${batch.status}`);
  const wave = await worker.fetch(`/api/wave?post=${opening.post}&v=1`, { method: 'POST' });
  assert.equal(wave.status, 403, `wave=${wave.status}`);
  // version 的 409 门（上一版还在跑）排在作者门之前——用 blocked 帖穿过 409 直达作者门
  const blocked = await (await postJSON(worker, '/api/check', { preset: 'listing', text: '傻逼东西你去死吧' })).json();
  assert.equal(blocked.state, 'blocked');
  const version = await postJSON(worker, '/api/version', { post: blocked.post, text: '别人想再发一版' });
  assert.equal(version.status, 403, `version=${version.status}`);

  // 带头就能继续（防止校验把主人关在门外）
  const ok = await worker.fetch(`/api/batch?post=${opening.post}&v=1`, { headers: { 'x-jev-author': opening.author } });
  assert.equal(ok.status, 200, `batch with author=${ok.status}`);
});
