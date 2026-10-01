// labels.js 的中文单源断言：R29 新增 zSayZh 的三档边界，以及既有的 directionZh 九宫格。
// 这些字符串被 render.js 拼进报告，错了没人报错，所以在这里钉死。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zSayZh, directionZh, Z_SAY_ZH } from '../public/shared/labels.js';

test('zSayZh：按 z 分三档，边界取 2 / -2', () => {
  assert.equal(zSayZh(5), Z_SAY_ZH.far);
  assert.equal(zSayZh(2), Z_SAY_ZH.far, 'z=2 就该算「不是碰运气」');
  assert.equal(zSayZh(1.99), Z_SAY_ZH.near);
  assert.equal(zSayZh(0), Z_SAY_ZH.near);
  assert.equal(zSayZh(-2), Z_SAY_ZH.below, 'z=-2 就该算「比随机还冷」');
  assert.equal(zSayZh(-2.01), Z_SAY_ZH.below);
  assert.equal(zSayZh(-9.2), Z_SAY_ZH.below, '实测第 2 波 z=-9.2 落这一档');
});

test('zSayZh：三档互不相同，且都比随机「不」甩锅给模型', () => {
  assert.equal(new Set(Object.values(Z_SAY_ZH)).size, 3);
  // 「比随机差」也是真答案：措辞必须承认这点，不能暗示读不出来
  assert.ok(Z_SAY_ZH.below.includes('真答案'));
});

test('directionZh：格坐标 → 九宫格，边界夹紧', () => {
  assert.equal(directionZh({ x: 5, y: 5 }), '左上');
  assert.equal(directionZh({ x: 50, y: 50 }), '中央');
  assert.equal(directionZh({ x: 95, y: 95 }), '右下');
  assert.equal(directionZh({ x: 50, y: 5 }), '正上');
  assert.equal(directionZh({ x: 99, y: 0 }), '右上', '越界坐标夹进边缘格，不出空串');
  assert.equal(directionZh(null), '');
});
