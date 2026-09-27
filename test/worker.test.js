import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startWorker, postJSON } from './helper.js';

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
