// 地图绘制：全量与增量的行为约定。Node 里没有 canvas，用最小桩件记录 fillRect 调用，
// 断言「画了几格」与「底板有没有重铺」——这正是实时监控每批刷图的契约。
import { test } from 'node:test';
import assert from 'node:assert/strict';

// grid.js 只在调用时才碰 DOM/canvas：先装桩，再动态导入。
const calls = [];
const canvases = [];
const makeCanvas = () => {
  let fill = '';
  const ctx = {
    scale() {},
    set fillStyle(value) { fill = value; },
    get fillStyle() { return fill; },
    fillRect: (x, y, w, h) => calls.push({ x, y, w, h, fill }),
  };
  const canvas = { isConnected: true, width: 0, height: 0, style: {}, getContext: () => ctx, addEventListener() {} };
  canvases.push(canvas);
  return canvas;
};

globalThis.window = { devicePixelRatio: 2 };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => ' #0a0d13 ' });
globalThis.document = { getElementById: () => null, createElement: () => ({}), body: { append() {} } };

const { drawGrid, paintDelta, redrawMaps } = await import('../public/grid.js');

/** preset 'post' 的反应顺序：scrolled_past / read / liked / disliked / reposted / followed / blocked。 */
const PRESET = 'post';
const byte = (index) => index + 1;
const newRun = () => {
  calls.length = 0;
  for (const canvas of canvases) canvas.isConnected = false; // 清掉上一轮登记的画布
  return makeCanvas();
};

test('drawGrid：全量画一遍，底板一次 + 每个判定格一次', () => {
  const canvas = newRun();
  const bytes = Uint8Array.from([0, byte(1), 0, byte(2), byte(4)]);
  drawGrid(canvas, bytes, PRESET);
  assert.equal(calls.length, 4, '底板 1 次 + 3 个判定格');
  assert.deepEqual([calls[0].x, calls[0].y, calls[0].w, calls[0].h], [0, 0, 400, 400]);
  assert.equal(calls[0].fill, '#0a0d13', '底板取主题令牌 --map-well');
  // id=1 → 行 0 列 1；id=3 → 行 0 列 3；id=4 → 行 0 列 4
  assert.deepEqual([calls[1].x, calls[1].y], [4, 0]);
  assert.deepEqual([calls[2].x, calls[2].y], [12, 0]);
  assert.deepEqual([calls[3].x, calls[3].y], [16, 0]);
  assert.equal(canvas.width, 800, '按 devicePixelRatio 放大画布');
  assert.equal(canvas.style.height, 'auto', '被覆盖掉的 px 死赋值不再出现');
});

test('paintDelta：只补画新点亮的格子，底板不重铺', () => {
  const canvas = newRun();
  const bytes = new Uint8Array(10000);
  drawGrid(canvas, bytes, PRESET);
  calls.length = 0;

  bytes[42] = byte(1);
  bytes[4242] = byte(2);
  assert.equal(paintDelta(canvas, bytes, PRESET), 2);
  assert.equal(calls.length, 2, '只画两格，不是刷满一万格');
  assert.deepEqual([calls[0].x, calls[0].y], [42 * 4, 0]);
  assert.deepEqual([calls[1].x, calls[1].y], [42 * 4, 42 * 4]); // id 4242 → 列 42 行 42
});

test('paintDelta：没有新判定时一格也不画', () => {
  const canvas = newRun();
  const bytes = new Uint8Array(10000);
  drawGrid(canvas, bytes, PRESET);
  bytes[7] = byte(1);
  paintDelta(canvas, bytes, PRESET);
  calls.length = 0;
  assert.equal(paintDelta(canvas, bytes, PRESET), 0);
  assert.equal(calls.length, 0);
});

test('paintDelta：换了字节数组（另一次检查）退回全量，底板重铺', () => {
  const canvas = newRun();
  drawGrid(canvas, new Uint8Array(10000), PRESET);
  calls.length = 0;
  const fresh = Uint8Array.from([byte(1), byte(1)]);
  paintDelta(canvas, fresh, PRESET);
  assert.equal(calls.length, 3, '底板 1 次 + 2 个判定格');
  assert.equal(calls[0].fill, '#0a0d13');
});

test('paintDelta：改判补画一格（字节变了就重画）', () => {
  const canvas = newRun();
  const bytes = new Uint8Array(10000);
  drawGrid(canvas, bytes, PRESET);
  bytes[10] = byte(1);
  paintDelta(canvas, bytes, PRESET);
  calls.length = 0;
  bytes[10] = byte(3); // liked → disliked
  assert.equal(paintDelta(canvas, bytes, PRESET), 1);
  assert.notEqual(calls[0].fill, '#0a0d13', '补画的是数据墨水，不是底板');
});

test('redrawMaps：主题切换按新令牌全量重画', () => {
  const canvas = newRun();
  const bytes = new Uint8Array(10000);
  bytes[3] = byte(1);
  bytes[900] = byte(2);
  drawGrid(canvas, bytes, PRESET);
  calls.length = 0;
  redrawMaps();
  assert.equal(calls.length, 3, '底板 1 次 + 2 个判定格');
  assert.equal(calls[0].fill, '#0a0d13', '整张按当前主题令牌重铺');
});
