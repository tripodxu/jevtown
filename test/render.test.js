// render.js 的视图冒烟：全部视图都是纯字符串构造器，却长期零测试——LOOKS 缺 import
// （R30 起）与十档 NaN 炸报告两颗地雷都住在这一层，坏的时候只有人工 E2E 才看得见。
//
// 数据不造假：用真实 mock 管线（runCheck + replayToView）产出与线上一致形状的 payload，
// 再逐个视图渲染。断言三条底线：不抛异常、输出里没有 NaN / undefined / [object Object]、
// 该有内容的视图确实有内容。文案对不对由 labels/summary 的既有用例管，这里只抓"渲染层
// 把坏数据写进页面"和"引用了不存在的变量"这两类事故。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runCheck } from '../public/shared/check.js';
import { createMockAsk } from '../public/shared/mock.js';
import { replayToView } from '../public/shared/replay.js';
import { DEFAULT_PRICES, PRESETS } from '../public/shared/presets.js';
import * as view from '../public/render.js';

/** 跑一次真的 mock 检查（maxWaves 1 = 600 人，快）并回放成报告视图的 payload。 */
async function viewOf(presetId, text, options = {}) {
  const result = await runCheck({
    send: createMockAsk(),
    presetId,
    pool: 'zh',
    text,
    versionId: `render-test-${presetId}`,
    prices: options.prices,
    maxWaves: 1,
    blocking: true,
  });
  assert.equal(result.blocked.length, 0, '冒烟文本不该被审核拦下');
  return replayToView(result);
}

const BAD = ['NaN', 'undefined', '[object Object]'];
const assertClean = (name, html) => {
  assert.equal(typeof html, 'string', `${name} 该是字符串`);
  for (const bad of BAD) assert.ok(!html.includes(bad), `${name} 的输出里出现了 ${bad}：${html.slice(0, 120)}`);
};

test('视图冒烟（post）：真实 mock 检查 → 全部视图渲染干净', async () => {
  const result = await viewOf('post', '视图冒烟：楼下修车摊开了十八年，师傅说要收摊了，问他最舍不得什么。');
  const sections = {
    brief: view.briefView(result),
    overview: '',
    report: view.reportView(result),
    decisions: view.decisionsView(result),
    terrain: view.terrainView(result),
    waves: view.wavesView(result, 900),
    mix: view.waveMixView(result),
    away: view.awayBar(result),
    counts: view.countsView(result),
    reading: view.jevReading(result),
    bands: view.bandsView(result),
    audience: view.audienceView(result),
    segments: view.segmentsView(result),
    said: view.saidView(result),
    followUp: view.followUpView(result, 900),
    voices: view.voicesView(result),
    heatmap: view.heatmapView(result, 900),
  };
  for (const [name, html] of Object.entries(sections)) assertClean(name, html);
  // 恒在的几节必须有内容：空字符串说明渲染层把好数据吞了。
  for (const name of ['brief', 'waves', 'counts', 'bands', 'voices', 'heatmap']) {
    assert.ok(sections[name].length > 0, `${name} 不该为空`);
  }
  // 存档回放的调用报告天然缺席：report 靠 batches 流水聚合，存档不存流水，重建不出来。
  assert.equal(sections.report, '', '回放没有调用报告（存档无 batches）');
  // decisions 曾被 replayToView 丢掉（首页示例卡凭空缺这一节）：现在透传，mock 管线 10 条全在。
  assert.ok(sections.decisions.includes('决策现场'), '回放该带出决策现场');
  assert.equal((result.decisions ?? []).length, 10, 'mock 管线的决策样本该有 10 条');
});

test('视图冒烟（product）：价格阶梯追问与需求曲线的路径', async () => {
  const result = await viewOf('product', '视图冒烟：316 不锈钢保温杯，保温 12 小时，89 元。', { prices: DEFAULT_PRICES });
  assertClean('followUp(product)', view.followUpView(result, 900));
  assert.ok(view.followUpView(result, 900).includes('追问'), '商品帖该有追问节');
  assert.deepEqual(result.prices, DEFAULT_PRICES, 'runCheck 现在回传 prices（CLI 存档与 versions.prices 同口径）');
});

test('away 视图：JS 注释不会漏进渲染输出（曾在模板字符串里，每行都带一行注释文本）', () => {
  const away = {
    sentences: [
      { i: 1, part: '电池 86%', mean: 0.0003, spread: 0.62, strong: 9, readable: true, top: { id: 'interest:parenting', delta: 0.445 }, bottom: { id: 'interest:student', delta: -0.175 }, deltas: [] },
      { i: 2, part: '无维修', mean: -0.0068, spread: 0.31, strong: 4, readable: false, top: { id: 'interest:games', delta: 0.21 }, bottom: { id: 'field:it', delta: -0.1 }, deltas: [] },
    ],
    noise: 0.0046,
    worded: 0.011,
    settled: true,
    groups: 83,
  };
  const html = view.awayBar({ away, post: { state: 'done' } });
  assertClean('away', html);
  assert.ok(!html.includes('//'), 'JS 注释不该出现在渲染输出里');
  assert.ok(html.includes('第 1 句') && html.includes('第 2 句'));
});

// 真实旧档回放：两份首页示例存档的决策样本全坏（引擎老 bug 存了答案包装对象、reaction
// 是垃圾键名）——replayToView 要把它们还原成能渲染的形状，示例卡才有「决策现场」节。
test('旧存档回放：坏的 decisions 被还原，真实示例 JSON 能渲染出决策现场', () => {
  for (const file of ['iphone-listing-v1.json', 'iphone-listing-v2.json']) {
    const saved = JSON.parse(fs.readFileSync(new URL(`../public/examples/${file}`, import.meta.url), 'utf8'));
    const result = replayToView(saved);
    assert.equal(result.decisions.length, 10, `${file} 该有 10 条决策样本`);
    for (const d of result.decisions) {
      assert.ok(d.probabilities.probabilities === undefined, `${file} 概率表该已解开包装层`);
      assert.ok(Object.keys(d.probabilities).length >= 2, `${file} 概率表该是真分布`);
      for (const value of Object.values(d.probabilities)) assert.equal(typeof value, 'number', `${file} 概率该是数字`);
      assert.ok(PRESETS[saved.presetId].reactions[d.reaction], `${file} reaction 该落在预设词表里：${d.reaction}`);
    }
    const html = view.decisionsView(result);
    assertClean(`decisions(${file})`, html);
    assert.ok(html.includes('决策现场'), `${file} 该渲染出决策现场节`);
  }
});
