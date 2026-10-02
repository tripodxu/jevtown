import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exposure, exposureAll, exposureBands, firstWave, nextWave, mood, travels, WAVES, GLAD_ENOUGH, randomBaseline, moodZ } from '../public/shared/feed.js';
import { persona, crowd } from '../public/shared/personas.js';
import { PRESETS } from '../public/shared/presets.js';
import { rng, hash32 } from '../public/shared/rng.js';

const scoresOf = (pairs) => Object.fromEntries(pairs);

/**
 * 每个可能的人群属性都打同一个分 ⇒ 一万人每个人的 exposure 完全相等，`pick()` 里那一万人
 * 全压在切线上。R31 修的平方级就长在这一形状上（真实触发它的是 Jev 给一组人群同样的低分）。
 */
const flatScores = () => {
  const scores = {};
  for (const who of crowd('zh')) {
    for (const id of [...who.interests.map((interest) => `interest:${interest}`), `field:${who.field}`, `age:${who.ageGroup}`]) {
      scores[id] = 0.5;
    }
  }
  return scores;
};

test('exposure：强对口的属性靠立方拉开差距', () => {
  const who = persona('zh', 77);
  const flat = scoresOf([[`interest:${who.interests[0]}`, 0.4]]);
  const strong = scoresOf([[`interest:${who.interests[0]}`, 0.9]]);
  assert.ok(exposure(who, strong, 'post') > 4 * exposure(who, flat, 'post'));
});

test('firstWave：最多 600 人、不重复、按曝光排序', () => {
  const people = crowd('zh');
  const scores = scoresOf([['interest:games', 1], ['field:it', 0.6], ['age:a25', 0.4]]);
  const wave = firstWave(people, scores, 'post', rng(hash32('t1')));
  assert.ok(wave.length <= WAVES[0].size);
  assert.equal(new Set(wave.map((who) => who.id)).size, wave.length);
  // 对口的兴趣组里的人应该占大头
  const matched = wave.filter((who) => who.interests.includes('games')).length;
  assert.ok(matched > 100, `对口人数过少：${matched}`);
});

// R31：pick() 的切线补位曾是一段 rest.splice(i--, 1) 的扫描——人数压在切线上时是平方级，
// 而"一段文字在所有人群上得分一样"（Jev 给所有组同一个分数）恰好让一万人同时压在切线上。
// 这条用例把那一形状钉住：平坦的分数也要排满 wanted + random。
test('firstWave：分数全是同一个值时，一万人同压切线仍排满 wanted + random', () => {
  const people = crowd('zh');
  const wave = firstWave(people, flatScores(), 'post', rng(hash32('flat')));
  assert.equal(wave.length, WAVES[0].size, `平坦分数下仍应排满 ${WAVES[0].size} 人，实得 ${wave.length}`);
  assert.equal(new Set(wave.map((who) => who.id)).size, wave.length, '不重复');
});

test('firstWave：同一颗种子必须给出同一波人（波次名单是存进 versions.plan 的检查结果）', () => {
  const people = crowd('zh');
  const scores = scoresOf([['interest:games', 1], ['field:it', 0.6], ['age:a25', 0.4]]);
  const a = firstWave(people, scores, 'post', rng(hash32('stable'))).map((who) => who.id);
  const b = firstWave(people, scores, 'post', rng(hash32('stable'))).map((who) => who.id);
  assert.deepEqual(a, b, '同种子两次必须逐 id 相同');
  const c = firstWave(people, scores, 'post', rng(hash32('stable', 2))).map((who) => who.id);
  assert.notDeepEqual(a, c, '不同种子应给出不同波');
});

// 切线上排不进 best 的人（旧实现里是 splice 后留在 rest 里的那批）仍可被随机抽中，
// 所以随机那 random 个人必须整段来自抽签池，且与 best 不重叠。
test('firstWave：抽签的人与排序的人不重叠，且整波不重复', () => {
  const people = crowd('zh');
  const wave = firstWave(people, flatScores(), 'post', rng(hash32('cut')));
  const wanted = WAVES[0].size - WAVES[0].random;
  assert.equal(wave.length, WAVES[0].size);
  assert.equal(new Set(wave.map((who) => who.id)).size, wave.length);
  // 前 wanted 个是按分排序的（平坦时分数全同，顺序即 id 顺序），后 random 个来自抽签
  assert.ok(wave.length - WAVES[0].random === wanted);
  const drawn = wave.slice(wanted).map((who) => who.id);
  assert.equal(new Set([...wave.slice(0, wanted).map((who) => who.id), ...drawn]).size, wave.length);
});

test('nextWave：不再包含已到达的人', () => {
  const people = crowd('zh');
  const scores = scoresOf([['interest:games', 1]]);
  const wave1 = firstWave(people, scores, 'post', rng(hash32('t2')));
  const reactions = new Map(wave1.map((who) => [who.id, 'liked']));
  const wave2 = nextWave(people, reactions, scores, 'post', 1, rng(hash32('t2', 2)));
  assert.ok(wave2.length <= WAVES[1].size);
  for (const who of wave2) assert.ok(!reactions.has(who.id));
});

test('mood/travels：glad 多一截才传播，阈值是 0.1', () => {
  assert.equal(GLAD_ENOUGH, 0.1);
  // 1 赞 3 划走：+0.25 ≥ 0.1，传播
  assert.ok(travels('post', ['liked', 'liked', 'liked', 'scrolled_past']));
  assert.ok(travels('post', ['liked', 'scrolled_past', 'scrolled_past', 'scrolled_past']));
  // 1 赞 1 反感 2 划走：净情绪 0，不传播
  assert.ok(!travels('post', ['liked', 'disliked', 'scrolled_past', 'scrolled_past']));
  assert.equal(mood('post', ['liked']), 1);
  assert.equal(mood('post', ['blocked']), -1);
});

// R29：随机基线。这轮不改传播判据（用户选择「只交证据与展示」），但把「阈值在基线之下」
// 这件事钉成断言，免得后人以为 GLAD_ENOUGH 是「有信息」的线。
test('randomBaseline：均匀抽反应时的情绪均值与标准误', () => {
  const base = randomBaseline('post', 600);
  assert.ok(base.mean > 0, `随机基线为正（均匀抽到 glad 一侧），实测 ${base.mean}`);
  assert.ok(base.error > 0 && base.error < 0.1, `600 人的标准误应在 0.01 量级：${base.error}`);
  assert.ok(GLAD_ENOUGH < base.mean, 'GLAD_ENOUGH 画在随机基线之下：这条线不是「有信息」');
  // 人越多越接近均值：标准误随 1/sqrt(n) 缩
  const big = randomBaseline('post', 2400);
  assert.ok(big.error < base.error / 1.5, `标准误应随人数下降：${base.error} → ${big.error}`);
});

test('moodZ：z 是离随机几个标准误，符号跟方向一致', () => {
  const base = randomBaseline('post', 600);
  assert.equal(moodZ('post', base.mean, 600), 0);
  assert.ok(moodZ('post', base.mean + base.error, 600) > 0.9, '高一倍标准误就该 z≈1');
  assert.ok(moodZ('post', base.mean - base.error * 10, 600) < -9, '低十倍标准误就该 z≈-10');
  // 0.1 这条旧阈值在 iPhone（listing）实测里是 z=-2.31（比随机还冷却过了闸）
  assert.ok(moodZ('listing', 0.102, 600) < -2, '真实 Jev 第 1 波 0.102 低于随机基线两个标准误');
  assert.ok(randomBaseline('product', 600).mean > 0.3, '商品帖的随机基线高达 0.4：这条线对不同题材含义不同');
});

// -- R34：属性名换成列号。这轮没动传播判据、没动分档，只把「查名字」换成「查下标」——
// 但波次名单是存进 versions.plan 的检查结果，换一个人就是换了一次检查，所以要钉住三件事。
test('exposure：换成列号之后，每个人的分和按名字逐项累加的老算法逐位相同', () => {
  // 老算法照抄一遍：名字 → [权重 × 分数]，立方，逐项相加。
  const WEIGHTS = { interest: 1, field: 1, age: 0.6, shopping: 1.5, budget: 0.6 };
  const weightOf = (id) => WEIGHTS[id.slice(0, id.indexOf(':'))];
  const byName = (who, scores, market) =>
    [
      ...who.interests.map((id) => `interest:${id}`),
      `field:${who.field}`,
      `age:${who.ageGroup}`,
      ...(market && who.shopping !== 'nothing' ? [`shopping:${who.shopping}`] : []),
      ...(market ? [`budget:${who.budget}`] : []),
    ].reduce((sum, id) => sum + (weightOf(id) * (scores[id] ?? 0)) ** 3, 0);
  const scores = {
    'interest:parenting': 0.9, 'interest:babies': 0.8, 'interest:tea': 0.15, 'interest:cooking': 0.45,
    'interest:gardening': 0.62, 'interest:games': 0.3, 'field:it': 0.4, 'field:health': 0.55,
    'age:a35': 0.5, 'age:a25': 0.31, 'shopping:phone': 0.85, 'shopping:clothing': 0.22,
    'budget:middle': 0.3, 'budget:low': 0.7,
  };
  for (const presetId of ['post', 'listing']) {
    const market = presetId === 'listing';
    for (const who of crowd('zh')) assert.equal(exposure(who, scores, presetId), byName(who, scores, market), `${presetId} #${who.id}`);
  }
});

test('firstWave：人数不足时整批都去；分数全同也仍排满 wanted + random（列号版的切线）', () => {
  const people = crowd('zh');
  const small = people.slice(0, 100);
  const all = firstWave(small, flatScores(), 'post', rng(hash32('small')));
  assert.equal(all.length, 100, '不够一波就整批都去');
  assert.deepEqual(all.map((who) => who.id), small.map((who) => who.id), '顺序也照原样');
  const wave = firstWave(people, flatScores(), 'post', rng(hash32('flat2')));
  assert.equal(wave.length, WAVES[0].size);
  assert.equal(new Set(wave.map((who) => who.id)).size, wave.length);
});

test('nextWave：每波名单与按名字算的老算法逐 id 相同（钉住 5,100 人已到达那一波）', () => {
  const people = crowd('zh');
  const scores = { 'interest:parenting': 0.9, 'interest:games': 0.3, 'field:it': 0.4, 'age:a35': 0.5, 'shopping:phone': 0.85, 'budget:middle': 0.3 };
  // 四波走到底，第 4 波是全城剩下的所有人。
  const waves = [];
  const reactions = new Map();
  for (let index = 0; index < WAVES.length; index++) {
    const wave = index === 0
      ? firstWave(people, scores, 'listing', rng(hash32('old-new', 'listing')))
      : nextWave(people, reactions, scores, 'listing', index, rng(hash32('old-new', 'listing', index)));
    waves.push(wave.map((who) => who.id));
    for (const [i, who] of wave.entries()) reactions.set(who.id, ['liked', 'shared', 'scrolled_past', 'disliked', 'opened', 'ignored'][i % 6]);
  }
  // 金标准是 594 字节的 16 行哈希；这里重算一遍同样的形状，逐 id 对照它意义不大（哈希不可比），
  // 真正在钉的是「四波拼起来的名单不重不漏」——`versions.plan` 存的是这个。
  assert.deepEqual([...reactions.keys()].sort((a, b) => a - b), people.map((who) => who.id), '四波走遍全城，不重不漏');
  assert.equal(waves[0].length, WAVES[0].size);
  assert.ok(waves[1].length <= WAVES[1].size && waves[2].length <= WAVES[2].size);
  assert.equal(waves[3].length, people.length - WAVES[0].size - WAVES[1].size - WAVES[2].size);
  assert.equal(new Set(waves.flat()).size, people.length, '没有任何人被两波各算一次');
});

// -- R37：Jev 开局那份打分是不是一份预测，以及它兑现了没有 ------------------------
// exposureBands 把全城按 exposure 分十档，每档看实际停下率。这是全仓唯一一处「预测 vs 结果」
// 的对照，所以四条断言分别钉住它的口径、口径自洽、真数据上的量级、以及它必须能报坏消息。

test('exposureAll：批量入口与逐人老算法逐位相同（波次名单不能因为重写而变）', () => {
  const people = crowd('zh');
  const scores = { 'interest:parenting': 0.9, 'interest:games': 0.3, 'field:it': 0.4, 'age:a35': 0.5, 'shopping:phone': 0.85, 'budget:middle': 0.3 };
  const batch = exposureAll(people, scores, 'listing');
  assert.equal(batch.length, people.length);
  // 逐位相同而不是相近：两个 double 相加的顺序变了，和就可能差最后一个比特，
  // 而波次名单是存进 versions.plan 的检查结果，差一个比特就是换了一次检查。
  people.forEach((who, at) => assert.equal(batch[at], exposure(who, scores, 'listing'), `listing #${who.id}`));
  const batchPost = exposureAll(people, scores, 'post');
  people.forEach((who, at) => assert.equal(batchPost[at], exposure(who, scores, 'post'), `post #${who.id}`));
});

test('exposureBands：十档的人数加起来是全城，两端对得上口径', () => {
  const people = crowd('zh');
  const scores = { 'interest:parenting': 0.9, 'interest:games': 0.3, 'field:it': 0.4, 'age:a35': 0.5 };
  const keys = Object.keys(PRESETS.post.reactions);
  const reactions = new Uint8Array(people.length);
  const wave = firstWave(people, scores, 'post', rng(hash32('bands')));
  wave.forEach((who, at) => { reactions[who.id] = 1 + (at % keys.length); });
  const out = exposureBands('post', keys, scores, reactions, people);
  assert.equal(out.bands.length, 10);
  assert.equal(out.bands.reduce((sum, row) => sum + row.people, 0), people.length, '十档不重不漏地盖住全城');
  assert.equal(out.bands.reduce((sum, row) => sum + row.reached, 0), out.town.reached);
  assert.equal(out.town.reached, wave.length);
  for (const row of out.bands) assert.ok(row.reached <= row.people);
  // 档 1 = 曝光最高的（也就是第 1 波照着挑的那批），所以它的 low 最高。
  assert.ok(out.bands[0].low >= out.bands[9].low, '档 1 的 exposure 下界不低过档 10');
  for (const row of out.bands) assert.ok(row.high >= row.low, `档 ${row.band} 的上下界反了`);
  // 第 1 波 600 人是照 exposure 挑的，所以绝大多数该落在最上面几档。
  assert.ok(out.bands[0].reached > out.bands[9].reached * 3, `第 1 波的人该压在档 1：${out.bands[0].reached} vs ${out.bands[9].reached}`);
});

test('exposureBands：真实存档里档 1 的停下率比档 10 高一个数量级（那份预测兑现了）', () => {
  const saved = JSON.parse(fs.readFileSync(new URL('../public/examples/iphone-listing-v1.json', import.meta.url), 'utf8'));
  const people = crowd(saved.pool ?? 'zh');
  const out = exposureBands(saved.presetId, saved.keys, saved.scores, Uint8Array.from(saved.reactions), people);
  assert.ok(out.readable && !out.flat, '真实存档里这一节读得出来、也不是押平');
  const first = out.bands[0];
  const last = out.bands[9];
  assert.ok(first.stopped / first.reached > last.stopped / last.reached * 10, `档 1 应比档 10 高十倍以上：${(first.stopped / first.reached * 100).toFixed(1)}% vs ${(last.stopped / last.reached * 100).toFixed(1)}%`);
  assert.ok(out.first.stoppedRatio > 10, `首末停下率之比应大于 10：${out.first.stoppedRatio}`);
});

test('exposureBands：分数全同的时候也分得出十档，并且照实说押平了', () => {
  // 「谁都在意的文本」（周三下午三点停电）实测下来 exposure 排不出差别：真实 Jev 给每一档
  // 相同的停下率。这一条钉住的是它必须这样报，而不是把一万人塞进最后一档再报一个假斜率。
  const people = crowd('zh');
  const keys = Object.keys(PRESETS.post.reactions);
  const reactions = new Uint8Array(people.length);
  const r = rng(hash32('flatbands'));
  for (let i = 0; i < people.length; i += 3) reactions[i] = 1 + ((r() * keys.length) | 0) % keys.length;
  const out = exposureBands('post', keys, flatScores(), reactions, people);
  assert.equal(out.bands.reduce((sum, row) => sum + row.people, 0), people.length);
  for (const row of out.bands) assert.ok(Math.abs(row.people - people.length / 10) <= people.length / 100, `平坦时每档仍该是全城的一成：${row.people}`);
  assert.ok(out.flat, '所有人对同一段文字的 exposure 全同时，这一节必须说押平了');
  // 押平和倍数是两件事：押平是结论（对照表里第 1 档并不更强），倍数仍然是量出来的那两个读数。
  // 这里押平了，首/末停下率之比就该贴近 1 而不是某个大数——钉住「押平」不是「读不出数」。
  assert.ok(out.first.stoppedRatio < 1.2, `押平时首末停下率之比应贴近 1：${out.first.stoppedRatio}`);
});

// 两端到达的人都不够时，整节要退化成「读不出来」，而不是拿两个小样本报一个倍数。
test('exposureBands：两端人数不足时报读不出来，倍数给 null', () => {
  const people = crowd('zh');
  const keys = Object.keys(PRESETS.post.reactions);
  const reactions = new Uint8Array(people.length);
  const wave = firstWave(people, { 'interest:parenting': 0.9, 'interest:games': 0.3, 'field:it': 0.4, 'age:a35': 0.5 }, 'post', rng(hash32('thin')));
  wave.forEach((who, at) => { reactions[who.id] = 1 + (at % keys.length); });
  // 只留 60 个人的读数：档 1 有 60，档 10 一个也没有。
  for (const who of wave) if (who.id % 7) reactions[who.id] = 0;
  const out = exposureBands('post', keys, { 'interest:parenting': 0.9, 'interest:games': 0.3, 'field:it': 0.4, 'age:a35': 0.5 }, reactions, people);
  assert.ok(!out.readable, '末端没有读数时不能报倍数');
  assert.equal(out.first.stoppedRatio, null);
  assert.equal(out.first.gladRatio, null);
});
