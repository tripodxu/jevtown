// 图谱纯函数的边界情况：全部返回 HTML/SVG 字符串，可在 Node 直接验证。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moodLine, demandChart, funnel, reportBars, fmtMs, rollingChart, shareChart } from '../public/charts.js';

test('moodLine：单波给点图而非空白，负情绪不炸', () => {
  const single = moodLine([0.24]);
  assert.ok(single.includes('<svg') && single.includes('唯一一波'));
  assert.ok(moodLine([-0.3, 0.1, -0.05]).includes('<svg'));
  assert.equal(moodLine([]), '');
});

test('demandChart：两档与四档都成立', () => {
  const two = demandChart([
    { price: 9, buyers: 100, revenue: 900 },
    { price: 19, buyers: 60, revenue: 1140 },
  ]);
  assert.ok(two.includes('<svg') && two.includes('100 人'));
  const four = demandChart([9, 19, 39, 79].map((price, i) => ({ price, buyers: 100 - i * 20, revenue: 0 })));
  assert.ok(four.includes('¥79'));
});

test('funnel：空波次返回空，满波次有情绪分层类名', () => {
  assert.equal(funnel([]), '');
  const html = funnel([
    { index: 0, size: 600, asked: 600, mood: 0.24, travels: true },
    { index: 1, size: 1500, asked: 1500, mood: 0.02, travels: false },
  ]);
  assert.ok(html.includes('fgo') && html.includes('fhold'));
});

test('reportBars：全零耗时/费用有除零保护', () => {
  const html = reportBars([{ stage: 'opening', n: 1, usd: 0, tokens: 10, ms: 0 }], (s) => s);
  assert.ok(html.length > 0);
  const costed = reportBars([
    { stage: 'opening', n: 1, usd: 0.01, tokens: 100, ms: 500 },
    { stage: 'wave0', n: 6, usd: 0.02, tokens: 200, ms: 1500 },
  ], (s) => s);
  assert.ok(costed.includes('0.0100') || costed.includes('$'));
});

test('fmtMs：秒与毫秒两种形态', () => {
  assert.equal(fmtMs(88600), '88.6s');
  assert.equal(fmtMs(683), '683ms');
});

test('rollingChart：心电图空态、读数与窗口截取', () => {
  assert.ok(rollingChart([], {}).includes('等待第一批'));
  const one = rollingChart([320], {});
  assert.ok(one.includes('<svg') && one.includes('320'));
  const rolling = rollingChart(Array.from({ length: 80 }, (_, i) => 100 + i), { window: 48 });
  // 窗口截到末尾 48 个点（132..179），峰为窗口内最大值 179
  assert.ok(rolling.includes('峰 179'));
});

test('shareChart：占比归一、单样本给等待文案、judged=0 不炸', () => {
  assert.ok(shareChart([{ glad: 0, sorry: 0, judged: 0 }]).includes('积累样本'));
  const svg = shareChart([
    { glad: 30, sorry: 5, judged: 100 },
    { glad: 80, sorry: 20, judged: 300 },
    { glad: 150, sorry: 40, judged: 600 },
  ]);
  assert.ok(svg.includes('<svg') && svg.includes('乐见') && svg.includes('覆盖 600 人'));
  const zero = shareChart([
    { glad: 0, sorry: 0, judged: 0 },
    { glad: 10, sorry: 2, judged: 50 },
  ]);
  assert.ok(zero.includes('<svg'));
});
