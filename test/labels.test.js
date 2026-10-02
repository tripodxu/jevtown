// labels.js 的中文单源断言：R29 新增 zSayZh 的三档边界、R33 新增 signed 的符号字形，
// 以及既有的 directionZh 九宫格。这些字符串被 render.js 拼进报告，错了没人报错，
// 所以在这里钉死。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zSayZh, directionZh, Z_SAY_ZH, signed, signedCount } from '../public/shared/labels.js';

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

// R33：正负号字形。这页所有显示正负的数字都从这里出（之前是每处自己拼，
// 于是 ASCII 连字符 '-' 和真减号 '−' 混排）。负号必须是 U+2212：它与数字同宽，
// 连字符不是——同一栏数字排一起时，连字符那一列会因为字宽不同而看着在跳。
test('signed：正数显式加号，负数用真减号，0 不带符号', () => {
  assert.equal(signed(0.0234, 4), '+0.0234');
  assert.equal(signed(-0.0498, 4), '−0.0498');
  assert.equal(signed(0, 2), '+0.00', '0 归到正号那一档——它不是负数');
  assert.equal(signed(-0.1, 1), '−0.1');
  assert.equal(signed(2.335), '+2.3350', '默认四位小数（逐句承重的均值就是四位）');
});

test('signed：输出里不出现 ASCII 连字符，且符号与数字同长', () => {
  for (const v of [-9.87, -0.5, -0.0004, 0, 0.5, 9.87]) {
    const text = signed(v, 4);
    assert.ok(!text.includes('-'), `signed(${v}) 里混进了 ASCII 连字符：${text}`);
    // 1 个符号 + 'd.dddd' 六字符。真减号与数字同宽，所以整串与一个七位数字等宽——
    // 这正是选它而不选连字符的理由（连字符窄，一列数字会看得出一列在缩进）。
    assert.equal([...text].length, 7, `signed(${v}, 4) 应是 1 个符号 + 6 个字符：${text}`);
    assert.equal([...text].length, [...String(Math.abs(v).toFixed(4))].length + 1);
    assert.ok(text.startsWith(v >= 0 ? '+' : '−'));
  }
});

test('signedCount：人计数带千分位，符号字形与 signed 一致', () => {
  assert.equal(signedCount(1204), '+1,204');
  assert.equal(signedCount(-1204), '−1,204');
  assert.equal(signedCount(-9), '−9');
  assert.ok(!signedCount(-1204).includes('-'));
});
