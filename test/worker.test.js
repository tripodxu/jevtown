import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startWorker, postJSON, runToDone } from './helper.js';

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
  // priceLadder 的答案键：p0 = 哪档都不买，p1..p4 = 四档价格（与 prices 数组等长）。
  assert.deepEqual(Object.keys(detail.followUp.totals).sort(), ['p0', 'p1', 'p2', 'p3', 'p4']);
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
