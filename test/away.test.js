import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentences, ablationRequest, ablationScores, ablationStats, runAblation, MAX_ABLATION_SENTENCES, SPREAD_OVER_NOISE, STRONG_OVER_NOISE } from '../public/shared/away.js';
import { groupsOf } from '../public/shared/requests.js';
import { createMockAsk } from '../public/shared/mock.js';

test('切句：逗号多的一段再切一刀，过短碎片并进上一句而不是放弃拆分', () => {
  const parts = sentences('出 iPhone 13，128G，电池 86%，无维修，带盒子和充电线，1400 元，可小刀，包邮，联系我');
  assert.deepEqual(parts, ['出 iPhone 13，128G，', '电池 86%，无维修，', '带盒子和充电线，', '1400 元，可小刀，包邮，联系我']);
  // 「电池 86%」自己撑不起一句，它和「128G，」是同一件事
  assert.ok(parts.every((part) => part.replace(/\s/g, '').length >= 6));
});

test('切句上限：超出的句全部并进最后一句，请求数因此有上界', () => {
  const many = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳。'.repeat(8);
  const parts = sentences(many);
  assert.equal(parts.length, MAX_ABLATION_SENTENCES);
  assert.equal(parts.join(''), many, '并进最后一句而不是丢掉——删句实验丢字就等于改了文本');
});

test('切句：空文本回退成一个句子，不返回空数组（0 句就没法做消融）', () => {
  assert.deepEqual(sentences(''), ['']);
  assert.deepEqual(sentences('   '), ['   ']);
});

test('请求：一路的 83 组题在同一个请求里，state 就是被删掉之后的话', () => {
  const request = ablationRequest('listing', '甲乙丙。丁戊己。', 'Suppose the first one was left out. ');
  assert.equal(Object.keys(request.questions).length, groupsOf(true).length);
  for (const [id, question] of Object.entries(request.questions)) {
    assert.equal(question.type, 'score', id);
    assert.equal(question.criteria.length, 5, 'CARE 五档，与 exposureRequest 同一套');
    assert.ok(question.instructions.startsWith('Suppose the first one was left out. '), `${id} 的消融措辞没进 instructions`);
  }
  assert.equal(request.state.listing, '甲乙丙。丁戊己。');
  assert.ok(request.state.seen_in.length > 10, '场景照旧给 Jev');
});

test('读数：score 是 0..4 档，归一到 0..1', () => {
  const groups = groupsOf(true);
  const answers = Object.fromEntries(groups.map(([id], i) => [id, { score: i % 5 }]));
  const scores = ablationScores(answers, 'listing');
  // 按 key 顺序重算一遍期望值，别拿「第几组」当「第几档」——groupsOf 的顺序会变。
  groups.forEach(([id], i) => assert.equal(scores[id], (i % 5) / 4, id));
  assert.ok(Object.values(scores).every((v) => v >= 0 && v <= 1));
});

test('门槛：组间差距压不过 6 倍噪声的句子被标成读不出来', () => {
  const groups = groupsOf(true);
  const flat = (value) => Object.fromEntries(groups.map(([id]) => [id, value]));
  const ids = groups.map(([id]) => id);
  // 噪声 = |CONTROL − NOISE| 的平均。CONTROL 与 BASE 同为 0.5，所以 base=control=0.5，
  // 噪声由 NOISE 这一路的整体平移量决定；gap 是消融路给第一组/最后一组的落差。
  const build = (gap, jitter) => {
    const gone = flat(0.5);
    gone[ids[0]] = 0.5 - gap; // 删掉这句后这组更在乎 → 承重 +gap
    gone[ids[ids.length - 1]] = 0.5 + gap; // 这组掉头 → 承重 −gap
    return { base: flat(0.5), control: flat(0.5), noise: flat(0.5 + jitter), gone: [gone] };
  };
  const wide = ablationStats(['甲。'], build(0.2, 0));
  assert.equal(wide.noise, 0, '复读两次同分 = 零噪声');
  assert.ok(wide.sentences[0].readable, '拉得开就该标读得出来');

  const tight = ablationStats(['甲。'], build(0.05, 0.02));
  assert.ok(tight.noise > 0, `噪声底应大于 0，得 ${tight.noise}`);
  assert.ok(tight.sentences[0].spread < tight.noise * SPREAD_OVER_NOISE);
  assert.equal(tight.sentences[0].readable, false, '拉不开就该标读不出来');
});

test('判定：strong 数的是压过 3 倍噪声的组，deltas 一条不落', () => {
  const groups = groupsOf(true);
  const ids = groups.map(([id]) => id);
  const gone = Object.fromEntries(groups.map(([id]) => [id, 0.5]));
  gone[ids[0]] = 0.3; // 承重 +0.2
  gone[ids[1]] = 0.7; // 承重 −0.2
  const flat = (value) => Object.fromEntries(groups.map(([id]) => [id, value]));
  const stats = ablationStats(['甲。'], { base: flat(0.5), control: flat(0.5), noise: flat(0.5), gone: [gone] });
  const one = stats.sentences[0];
  assert.equal(one.deltas.length, groups.length, '前端的条要按组画，deltas 必须全带');
  assert.equal(one.top.id, ids[0]);
  assert.equal(one.top.delta, 0.2);
  assert.equal(one.bottom.id, ids[1]);
  assert.equal(one.bottom.delta, -0.2);
  assert.equal(one.strong, 2, '只有这两组的变化是 0.2，其余都是 0');
});

test('端到端：mock 通道跑满四路，句数 = 切句数，每句带 deltas', async () => {
  const send = createMockAsk();
  const result = await runAblation(send, { presetId: 'listing', text: '出 iPhone 13，128G，电池 86%，无维修，带盒子和充电线，联系我' });
  const expected = sentences('出 iPhone 13，128G，电池 86%，无维修，带盒子和充电线，联系我').length;
  assert.equal(result.sentences.length, expected);
  assert.equal(result.groups, groupsOf(true).length);
  assert.equal(result.requests, expected + 3, 'N 句消融 + BASE / CONTROL / NOISE');
  assert.equal(result.settled, true);
  assert.ok(Number.isFinite(result.noise) && Number.isFinite(result.worded));
  for (const one of result.sentences) {
    assert.equal(one.deltas.length, result.groups);
    assert.ok(one.i >= 1 && one.i <= expected);
    assert.ok(one.part.length > 0);
  }
});

test('中断：failed 的那一路不会算成「全都没差」，已读到的部分照样交出来', async () => {
  const calls = { n: 0 };
  const send = async (request) => {
    calls.n += 1;
    if (calls.n === 4) throw new Error('boom');
    return createMockAsk()(request);
  };
  const result = await runAblation(send, { presetId: 'listing', text: '甲乙丙，丁戊己，庚辛壬。' });
  assert.equal(result.settled, false);
  assert.ok(result.sentences.length >= 1, '前几句不该被丢掉');
  assert.ok(result.requests >= 4);
});

test('上限：maxCalls 之内跑不完就抛 fatal，不把半成品当成功', async () => {
  const send = createMockAsk();
  await assert.rejects(
    () => runAblation(send, { presetId: 'listing', text: '甲乙丙，丁戊己，庚辛壬。', maxCalls: 3 }),
    (error) => error.fatal === true && /too many calls/.test(error.message),
  );
});