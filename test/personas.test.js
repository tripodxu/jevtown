import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persona, personaLine, crowd, GRID, CROWD, poolFor } from '../public/shared/personas.js';

test('persona(pool, id) 确定性：同一个 id 永远是同一个人', () => {
  const a = persona('zh', 4321);
  const b = persona('zh', 4321);
  assert.deepEqual(a, b);
});

test('人格字段齐全且在合理范围', () => {
  for (const id of [0, 1, 999, 4321, 9999]) {
    const who = persona('zh', id);
    assert.equal(who.id, id);
    assert.equal(who.pool, 'zh');
    assert.ok(who.age >= 18 && who.age <= 80, `age ${who.age}`);
    assert.ok(['female', 'male'].includes(who.gender));
    assert.ok(who.name.zh && who.name.en);
    assert.ok(who.city.zh && who.city.en);
    assert.ok(JOB_OK(who.job));
    assert.ok(who.interests.length >= 1 && who.interests.length <= 3);
    assert.ok(TEMPER_OK(who.temper));
  }
});

test('相邻 id 的人主兴趣更接近（网格聚集）', () => {
  let same = 0;
  const N = 500;
  for (let id = 0; id < N; id++) {
    if (persona('zh', id).interests[0] === persona('zh', id + 1).interests[0]) same += 1;
  }
  assert.ok(same > N * 0.2, `相邻主兴趣相同比例过低：${same}/${N}`);
});

test('personaLine 是一行英文简介，包含名字、年龄、职业', () => {
  const who = persona('zh', 1234);
  const line = personaLine(who);
  assert.ok(!line.includes('\n'));
  assert.ok(line.includes(String(who.age)));
  assert.ok(line.includes(who.name.en));
  assert.ok(line.split(';').length >= 3);
});

test('crowd 一次给出全城', () => {
  const people = crowd('zh');
  assert.equal(people.length, CROWD);
  assert.equal(GRID * GRID, CROWD);
  assert.equal(people[0].id, 0);
  assert.equal(people[9999].id, 9999);
});

test('poolFor 中文永远落回 zh', () => {
  assert.equal(poolFor('这是一条中文帖子'), 'zh');
  assert.equal(poolFor('hello world'), 'zh');
});

import { JOBS, TEMPERS } from '../public/shared/vocab.js';
const JOB_OK = (id) => JOBS.some((job) => job.id === id);
const TEMPER_OK = (id) => TEMPERS.some((temper) => temper.id === id);
