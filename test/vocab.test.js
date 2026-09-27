import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTERESTS, INTEREST_COLUMNS, FIELDS, JOBS, AGE_GROUPS, TEMPERS, BUDGETS, SPENDING, SHOPPING, POOLS, JOB, TEMPER } from '../public/shared/vocab.js';

test('兴趣是 8 列 × 5 行 = 40 个，id 唯一', () => {
  assert.equal(INTERESTS.length, 40);
  assert.equal(INTERESTS.length % INTEREST_COLUMNS, 0);
  assert.equal(new Set(INTERESTS.map((item) => item.id)).size, INTERESTS.length);
});

test('每个兴趣的 field 都存在于 FIELDS，shopping 都有对应项', () => {
  for (const interest of INTERESTS) {
    if (interest.field) assert.ok(FIELDS[interest.field], `interest ${interest.id} 的 field ${interest.field} 不存在`);
  }
  const jobs = new Set(JOBS.map((job) => job.id));
  assert.ok(jobs.size >= 30);
});

test('每个职业的 field 都存在于 FIELDS', () => {
  for (const job of JOBS) assert.ok(FIELDS[job.field], `job ${job.id} 的 field ${job.field} 不存在`);
});

test('中文名字池：每个名字是 [拼音, 汉字]，城市带权重', () => {
  const pool = POOLS.zh;
  for (const gender of ['female', 'male']) {
    assert.ok(pool[gender].length >= 20, `${gender} 名字太少`);
    for (const [en, zh] of pool[gender]) {
      assert.equal(typeof en, 'string');
      assert.equal(typeof zh, 'string');
    }
  }
  for (const [en, zh, weight] of pool.cities) {
    assert.ok(weight > 0, `city ${en} 权重缺失`);
    assert.equal(typeof zh, 'string');
  }
});

test('性格权重总和为正，id 唯一', () => {
  const total = TEMPERS.reduce((sum, item) => sum + item.weight, 0);
  assert.ok(total > 0);
  assert.equal(new Set(TEMPERS.map((t) => t.id)).size, TEMPERS.length);
  assert.equal(new Set(BUDGETS.map((b) => b.id)).size, BUDGETS.length);
  assert.equal(new Set(SPENDING.map((s) => s.id)).size, SPENDING.length);
  assert.ok(AGE_GROUPS[0].from === 18);
});

test('byId 索引可用：TEMPER/JOB 反查', () => {
  assert.equal(TEMPER.skeptic.en, 'skeptic');
  assert.ok(JOB.developer.field === 'it');
});
