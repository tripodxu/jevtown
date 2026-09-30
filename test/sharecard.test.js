// 分享卡片：canvas 桩件记录绘制调用，断言构图契约（底→卡→快照→文字）。
// sharecard.js 只在调用时碰 DOM/canvas：先装桩，再动态导入。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
const makeCtx = () => ({
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  fillRect: (x, y, w, h) => calls.push({ op: 'fillRect', x, y, w, h }),
  strokeRect: (...args) => calls.push({ op: 'strokeRect', args }),
  fillText: (text) => calls.push({ op: 'fillText', text }),
  drawImage: (source) => calls.push({ op: 'drawImage', source }),
  measureText: (text) => ({ width: text.length * 20 }),
  beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, save() {}, restore() {}, clip() {},
  fill: () => calls.push({ op: 'fill' }),
  stroke: () => calls.push({ op: 'stroke' }),
});
const mapCanvas = { fake: 'map' };
globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => makeCtx(),
  }),
};
globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => ` ${name === '--bg' ? '#0d1017' : '#ffffff'} ` });

const { renderShareCard } = await import('../public/sharecard.js');

const view = {
  post: { id: 'abc123', preset: 'listing', text: '出 iPhone 13，128G，电池 86%，无维修，带盒子和充电线，1400 元，可小刀，包邮，联系我', created_at: 1759000000000 },
  counters: { reach: 2100, stopped: 537, glad: 165, sorry: 12 },
  terrain: { verdict: 'scattered', morans: -0.06 },
};

test('分享卡片：地图快照恰好画一次，来自传入的地图画布', () => {
  calls.length = 0;
  renderShareCard(view, mapCanvas);
  const snaps = calls.filter((c) => c.op === 'drawImage');
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].source, mapCanvas);
});

test('分享卡片：KPI 四个数 + 标题摘录 + 地形判定都上画面', () => {
  calls.length = 0;
  renderShareCard(view, mapCanvas);
  const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.text);
  assert.ok(texts.includes('2,100'), '逐格判定 KPI');
  assert.ok(texts.includes('537'), '停下 KPI');
  assert.ok(texts.includes('这次反应零散'), '地形判定一行（标签来自 labels.js 单源）');
  assert.ok(texts.some((t) => t.includes('iPhone')), '文本摘录');
  assert.ok(texts.some((t) => t.includes('由 Jev 逐格判定')), '出处行');
});

test('分享卡片：没有地形段（morans null）时不画地形行，缺地图画布也不炸', () => {
  calls.length = 0;
  renderShareCard({ ...view, terrain: { verdict: 'unclear', morans: null } }, null);
  const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.text);
  assert.ok(!texts.some((t) => t.startsWith('这次反应')), '判不出的地形不硬造一句话');
  assert.ok(!calls.some((c) => c.op === 'drawImage'), '没有地图也不假画');
  assert.ok(calls.some((c) => c.op === 'fillText'), '卡片其余部分照常');
});
