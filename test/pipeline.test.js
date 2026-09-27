// 全链路集成测试：mock 通道跑一次完整检查（不花钱、不联网），验证引擎与管线咬合。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from '../public/shared/check.js';
import { PRESETS } from '../public/shared/presets.js';
import { createMockAsk } from '../public/shared/mock.js';
import { mockKindOf } from '../public/shared/mock.js';
import { CROWD } from '../public/shared/personas.js';

const mockSend = createMockAsk();

test('mock：opening/wave/closing 三种请求都能回答且概率归一', async () => {
  const opening = await mockSend({
    state: { seen_in: 'a social feed', post: '今天试着跑了五公里，顺便说说我怎么坚持下来的' },
    questions: { 'interest:running': { type: 'score', instructions: 'x', criteria: ['a', 'b', 'c', 'd', 'e'] }, 'unlisted:insult': { type: 'noul', instructions: 'x', criteria: { true: 'y', false: 'n' } } },
  });
  assert.ok(opening.answers['interest:running'].score >= 0 && opening.answers['interest:running'].score <= 4);

  const wave = await mockSend({
    state: { seen_in: 'a social feed', post: '今天试着跑了五公里' },
    questions: {
      p77: {
        type: 'choice',
        instructions: 'Reader: someone. What is the most this reader does with the post?',
        criteria: Object.fromEntries(Object.entries(PRESETS.post.reactions).map(([id, r]) => [id, r.criteria])),
      },
    },
  });
  const probs = Object.values(wave.answers.p77.probabilities);
  const sum = probs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.001, `概率和 ${sum}`);
});

test('runCheck(mock, post)：全流程跑通，反应数合法，收尾有回答', async () => {
  const result = await runCheck({
    send: mockSend,
    presetId: 'post',
    pool: 'zh',
    text: '跑了五公里，坚持跑步三年，说说我怎么把体重和焦虑一起减下来的，附训练计划',
    versionId: 'test.post.1',
    blocking: true,
  });
  assert.equal(result.reactions.length, CROWD);
  assert.ok(result.reach > 300, `reach 太少：${result.reach}`);
  assert.ok(result.waves.length >= 1 && result.waves.length <= 4);
  for (const wave of result.waves) assert.ok(wave.asked > 0 && wave.size === wave.asked);
  // 反应字节都在合法范围
  const keys = Object.keys(PRESETS.post.reactions);
  for (const byte of result.reactions) assert.ok(byte >= 0 && byte <= keys.length);
  // 收尾提问有真实回答
  assert.ok(result.said.lists.scrolled, 'scrolled 列表缺失');
  assert.ok(result.said.lists.hook, 'hook 列表缺失');
  const real = Object.entries(result.said.lists.scrolled.totals).filter(([id]) => id !== 'cant_tell');
  assert.ok(real.length >= 1);
  assert.ok(result.usd === 0, 'mock 不应花钱');
}, { timeout: 120_000 });

test('runCheck(mock, listing)：审核拦截生效', async () => {
  const result = await runCheck({
    send: mockSend,
    presetId: 'listing',
    pool: 'zh',
    text: '你去死吧傻逼，这种东西也敢拿出来卖',
    versionId: 'test.listing.1',
    blocking: true,
  });
  assert.ok(result.blocked.includes('insult'), `blocked: ${result.blocked}`);
  assert.equal(result.reach, 0);
});

test('runCheck(mock, listing)：正常转让帖有人联系卖家', async () => {
  const result = await runCheck({
    send: mockSend,
    presetId: 'listing',
    pool: 'zh',
    text: '出 iPhone 13 手机，128G，电池 86%，无维修，带盒子和充电线，1400 元，可小刀，包邮，联系我',
    versionId: 'test.listing.2',
    maxWaves: 4,
    blocking: true,
  });
  assert.equal(result.blocked.length, 0);
  assert.ok(result.reach >= 600);
  assert.ok(result.said.lists.scrolled, '有人划走就该有为什么');
}, { timeout: 120_000 });
