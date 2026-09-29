// segments() 的预编译版与旧写法必须逐字段一致：把旧实现原样抄进测试当参照实现。
// 参照实现在优化前与被测实现是同一份代码，作用是在重写 segments() 的那一刻把行为钉住。
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
  const countersOf = (bytes) => {
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
  const all = countersOf(reactions);
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
  assert.deepEqual(segments(product, keys, bytes, people), segmentsReference(product, keys, bytes, people));
  assert.equal(
    segments(product, keys, bytes, people).some((s) => s.attribute === 'shopping'),
    true,
    'product 是市场预设，应有 shopping 分组',
  );
  assert.equal(
    segments('post', keysOf('post'), reactionsFor('post', 2100), people).some((s) => s.attribute === 'shopping'),
    false,
    'post 不是市场预设，不应有 shopping 分组',
  );
});

test('segments：一个人都没判定到时，每一组的 reached 都是 0', () => {
  // 注意 size 记的是"这一组有多少人"，不是"多少人看到了"——所以 reach=0 不是空数组
  const keys = keysOf('post');
  const bytes = reactionsFor('post', 0);
  const rows = segments('post', keys, bytes, people);
  assert.deepEqual(rows, segmentsReference('post', keys, bytes, people));
  assert.ok(rows.length > 0, '分组仍应列出（这是"多少人看到了"为 0，不是"没有分组"）');
  for (const row of rows) {
    assert.equal(row.reached, 0);
    assert.equal(row.stopped + row.glad + row.sorry, 0);
  }
});

test('segments：人数太少、每组都低于最小样本时返回空数组', () => {
  const keys = keysOf('post');
  const bytes = reactionsFor('post', 0);
  const tiny = people.slice(0, 10); // minSegment(10) = 15 > 10 ⇒ 全部被滤掉
  assert.deepEqual(segments('post', keys, bytes, tiny), []);
});

test('segments：同一 people 数组重复调用结果一致（缓存不能改语义）', () => {
  const keys = keysOf('post');
  const bytes = reactionsFor('post', 2100);
  assert.deepEqual(segments('post', keys, bytes, people), segments('post', keys, bytes, people));
});

test('segments：换一个 people 数组（子集）也给出同样口径的结果', () => {
  // 缓存按数组身份存：子集必须自建表，不能串味
  const keys = keysOf('post');
  const bytes = reactionsFor('post', 2100);
  const subset = people.filter((who) => who.id % 10 === 0);
  assert.deepEqual(
    segments('post', keys, bytes, subset),
    segmentsReference('post', keys, bytes, subset),
  );
});
