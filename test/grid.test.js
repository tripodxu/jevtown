// 地图绘制：全量与增量的行为约定，外加聚集地形的描环。Node 里没有 canvas，
// 用最小桩件记录 fillRect / strokeRect 调用，断言「画了几格」「底板有没有重铺」
// ——这正是实时监控每批刷图的契约。
import { test } from 'node:test';
import assert from 'node:assert/strict';

// grid.js 只在调用时才碰 DOM/canvas：先装桩，再动态导入。
const calls = [];
const strokes = [];
const canvases = [];
const makeCanvas = () => {
  let fill = '';
  let stroke = '';
  const ctx = {
    scale() {},
    set fillStyle(value) { fill = value; },
    get fillStyle() { return fill; },
    fillRect: (x, y, w, h) => calls.push({ x, y, w, h, fill }),
    lineWidth: 1,
    set strokeStyle(value) { stroke = value; },
    get strokeStyle() { return stroke; },
    strokeRect: (x, y, w, h) => strokes.push({ x, y, w, h, color: stroke }),
  };
  const canvas = { isConnected: true, width: 0, height: 0, style: {}, getContext: () => ctx, addEventListener() {} };
  canvases.push(canvas);
  return canvas;
};

globalThis.window = { devicePixelRatio: 2 };
// 令牌按名给值：真实页面里不同令牌是不同的颜色，桩件不能一律返回同一个。
const TOKENS = { '--map-well': '#0a0d13', '--map-green': '#3ddc84', '--map-red': '#ff5c5c' };
globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => ` ${TOKENS[name] ?? '#000000'} ` });
globalThis.document = { getElementById: () => null, createElement: () => ({}), body: { append() {} } };

const { drawGrid, paintDelta, redrawMaps, drawDelta, clampTip } = await import('../public/grid.js');

/** preset 'post' 的反应顺序：scrolled_past / read / liked / disliked / reposted / followed / blocked。 */
const PRESET = 'post';
const byte = (index) => index + 1;
const newRun = () => {
  calls.length = 0;
  strokes.length = 0;
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

test('terrain：只给成片格子描环，不碰其他格', () => {
  const canvas = newRun();
  const bytes = new Uint8Array(10000);
  bytes[10] = byte(1);
  bytes[2000] = byte(2);
  drawGrid(canvas, bytes, PRESET, { hot: [10], cold: [2000] });
  assert.equal(strokes.length, 2, '只描两格');
  assert.deepEqual([strokes[0].x, strokes[0].y], [10 * 4 + 0.5, 0.5], '环要内缩半像素，免得被相邻格盖掉');
  assert.deepEqual([strokes[1].x, strokes[1].y], [0.5, 20 * 4 + 0.5]);
  assert.notEqual(strokes[0].color, strokes[1].color, '乐见与反感用不同颜色');
});

test('terrain：没有地形时一环都不描（实时监控走的就是这条）', () => {
  const canvas = newRun();
  drawGrid(canvas, new Uint8Array(10000), PRESET);
  assert.equal(strokes.length, 0);
});

test('terrain：主题重画后环还在（走全量路径）', () => {
  const canvas = newRun();
  const bytes = new Uint8Array(10000);
  bytes[10] = byte(1);
  drawGrid(canvas, bytes, PRESET, { hot: [10], cold: [] });
  strokes.length = 0;
  redrawMaps();
  assert.equal(strokes.length, 1);
});

test('terrain：换了地形就退回全量，不在旧环上叠新环', () => {
  const canvas = newRun();
  const bytes = new Uint8Array(10000);
  bytes[10] = byte(1);
  drawGrid(canvas, bytes, PRESET, { hot: [10], cold: [] });
  calls.length = 0;
  strokes.length = 0;
  drawGrid(canvas, bytes, PRESET, { hot: [20], cold: [] });
  assert.equal(calls.length, 2, '底板 1 次 + 1 个判定格');
  assert.equal(strokes.length, 1);
  assert.deepEqual([strokes[0].x, strokes[0].y], [20 * 4 + 0.5, 0.5]);
});

// -- 差分地图（codes 来自 shared/spatial.js 的 crowdDelta：code = delta + 3，0 = 不可比）

test('drawDelta：只画有差值的格子，0 铺底板', () => {
  const canvas = newRun();
  const codes = new Uint8Array(10000); // 0 = 不可比
  codes[5] = 4;   // +1
  codes[7] = 5;   // +2
  codes[9] = 2;   // -1
  codes[11] = 1;  // -2
  codes[13] = 3;  // 差值为 0（两版态度一样）——不画
  assert.equal(drawDelta(canvas, codes), 4, '只有 4 个格有非零差值');
  assert.equal(calls.length, 5, '底板 1 次 + 4 个有差值的格子');
  assert.equal(calls[0].fill, TOKENS['--map-well'], '先铺底板');
  const painted = calls.slice(1).map((c) => c.fill);
  assert.equal(new Set(painted).size, 4, '两档幅度 × 两个方向 = 四种颜色');
});

test('drawDelta：同号同幅度同色，异号异色（发散配色）', () => {
  const canvas = newRun();
  const codes = new Uint8Array(10000);
  codes[1] = 4; codes[2] = 4; // 两个 +1
  codes[3] = 2; codes[4] = 2; // 两个 -1
  drawDelta(canvas, codes);
  const at = (id) => calls.find((c) => c.x === (id % 100) * 4 && c.y === Math.floor(id / 100) * 4).fill;
  assert.equal(at(1), at(2), '同号同幅度必须同色');
  assert.equal(at(3), at(4));
  assert.notEqual(at(1), at(3), '正负必须异色');
});

test('drawDelta：半档是墨水与底板的中间色（幅度小的画淡一点）', () => {
  const canvas = newRun();
  const codes = new Uint8Array(10000);
  codes[1] = 4; // +1 半档
  codes[2] = 5; // +2 满档
  drawDelta(canvas, codes);
  const at = (id) => calls.find((c) => c.x === (id % 100) * 4 && c.y === Math.floor(id / 100) * 4).fill;
  assert.notEqual(at(1), at(2), '两档必须不同色');
  assert.equal(at(2), TOKENS['--map-green'], '满档就是纯墨水');
});

test('drawDelta：全部不可比时只铺底板', () => {
  const canvas = newRun();
  assert.equal(drawDelta(canvas, new Uint8Array(10000)), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fill, TOKENS['--map-well']);
});

test('drawDelta：登记在案——主题切换后 redrawMaps 按新令牌重画差分图', () => {
  // 差分画布不走 drawn 的增量路径，但主题切换必须重画：否则留着上个主题的墨水。
  const canvas = newRun();
  const codes = new Uint8Array(10000);
  codes[1] = 5; // 大幅变好
  drawDelta(canvas, codes);
  calls.length = 0;
  TOKENS['--map-green'] = '#00ff00'; // 换主题 = 换令牌
  try {
    redrawMaps();
    assert.equal(calls.length, 2, '底板 1 次 + 1 个有差值的格子');
    assert.equal(calls[1].fill, '#00ff00', '差分图跟着新主题的墨水重画');
  } finally {
    TOKENS['--map-green'] = '#3ddc84'; // 还原，不影响后面的用例
  }
});

// -- 悬停提示的视口钳制（纯函数，宽高与视口由调用方量好传入）

test('clampTip：默认落在光标右下（+14px）', () => {
  assert.deepEqual(clampTip(100, 100, 200, 120, 1200, 800), { left: 114, top: 114 });
});

test('clampTip：右缘放不下翻到光标左侧', () => {
  const p = clampTip(1150, 100, 200, 120, 1200, 800);
  assert.equal(p.left, 1150 - 14 - 200);
  assert.equal(p.top, 114, '纵向不受横向溢出影响');
});

test('clampTip：下缘放不下翻到光标上方', () => {
  const p = clampTip(100, 750, 200, 120, 1200, 800);
  assert.equal(p.top, 750 - 14 - 120);
  assert.equal(p.left, 114, '横向不受纵向溢出影响');
});

test('clampTip：右下双溢出各翻各的，互不干扰', () => {
  const p = clampTip(1150, 750, 200, 120, 1200, 800);
  assert.equal(p.left, 1150 - 14 - 200);
  assert.equal(p.top, 750 - 14 - 120);
});

test('clampTip：翻到左侧仍越界时钳进视口边距（tooltip 比视口宽也不出负坐标）', () => {
  const p = clampTip(10, 100, 400, 120, 300, 800);
  assert.equal(p.left, 12);
});

test('clampTip：贴近视口原点时钳到 12px 边距', () => {
  const p = clampTip(0, 0, 200, 120, 1200, 800);
  assert.deepEqual(p, { left: 14, top: 14 });
});
