// 100×100 的小镇地图：一个人格一个点。未到达的人融入底色，到达的按反应上色。
// 颜色分两层：反应六色是数据墨水（presets.js 的 LOOKS，全主题不变）；
// 底板与网格取自主题的 CSS 变量（--map-well），所以切主题时整张地图要重绘。
// 实时地图逐批判定走 paintDelta：只补画新点亮的格子，不刷满一万格；
// 报告地图可再传一个 terrain（shared/spatial.js 的成片格子），给它们描环；
// 传播层（drawReach）把每格换成"第几波看到"的顺序量表，与反应层共用一张画布（mode 区分）。
import { LOOKS, lookOf, PRESETS } from './shared/presets.js';
import { persona } from './shared/personas.js';
import { INTEREST, JOB, TEMPER, BUDGET } from './shared/vocab.js';
import { REACTIONS_ZH } from './shared/labels.js';

const CELL = 4;
const GRID = 100;
// 已画过的画布登记在案：主题切换时逐张重绘；painted = 上次真正画上去的字节快照，
// 实时地图靠它做增量补画，不必每批判定就刷满一万格。
const drawn = new Map();
// 键盘光标格（canvas → 格 id）：paint() 末尾描出来，移动时直接补描，全量重画自动带回来。
const cursorByCanvas = new WeakMap();
// 差分画布另册登记：它没有悬停档案、不走 drawn 的字节快照与增量逻辑，
// 但主题切换时 redrawMaps 必须也按新令牌重画它——否则差分图留着上个主题的墨水。
const deltas = new Map();

const cssVar = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

export function drawGrid(canvas, bytes, presetId, terrain = null) {
  // 修剪掉已断连的旧画布（反复渲染结果区时防泄漏），再登记新的。
  for (const [old] of drawn) if (!old.isConnected) drawn.delete(old);
  drawn.set(canvas, { mode: 'reaction', bytes, presetId, terrain, waveBytes: null, upto: 0, painted: null, well: '' });
  paint(canvas, drawn.get(canvas));
}

/** 主题切换后调用：把登记过的地图全部按新令牌重画一遍。 */
export function redrawMaps() {
  for (const [canvas, entry] of drawn) {
    if (canvas.isConnected) paint(canvas, entry);
  }
  for (const [canvas, codes] of deltas) {
    if (canvas.isConnected) drawDelta(canvas, codes);
  }
}

/**
 * 增量重画：只补画与上次快照不同的格子，返回补画了几格。
 * 画布没登记、换了字节数组或换了预设时退回全量 drawGrid。
 * 传播层画布没有增量路径，也不许被反应全量路径覆写——直接不动。
 */
export function paintDelta(canvas, bytes, presetId, terrain = null) {
  const entry = drawn.get(canvas);
  if (entry && entry.mode !== 'reaction') return 0;
  if (!entry || entry.bytes !== bytes || entry.presetId !== presetId || entry.terrain !== terrain || !entry.painted) {
    drawGrid(canvas, bytes, presetId, terrain);
    return bytes.length;
  }
  const keys = Object.keys(PRESETS[presetId].reactions);
  const ctx = canvas.getContext('2d');
  let touched = 0;
  for (let id = 0; id < bytes.length; id++) {
    if (bytes[id] === entry.painted[id]) continue;
    entry.painted[id] = bytes[id];
    fillCell(ctx, presetId, entry.well, id, bytes[id], keys);
    touched += 1;
  }
  return touched;
}

// 一格：字节 0 铺底板（还没轮到它），否则按反应取数据墨水。
function fillCell(ctx, presetId, well, id, byte, keys) {
  ctx.fillStyle = byte ? (LOOKS[lookOf(presetId, keys[byte - 1])] ?? LOOKS.dark) : well;
  ctx.fillRect((id % GRID) * CELL, Math.floor(id / GRID) * CELL, CELL - 1, CELL - 1);
}

// 聚集地形：给 spatial.js 标出的成片格子描一圈环——绿=成片的乐见，红=成片的反感。
// 环色取主题的数据墨水（--map-green / --map-red），所以换主题重画时环也跟着走。
function ringTerrain(ctx, terrain) {
  if (!terrain) return;
  ctx.lineWidth = 1;
  const ring = (ids, color) => {
    if (!ids?.length) return;
    ctx.strokeStyle = color;
    // 内缩半像素：环正好压在格子边界上，不会被相邻格的填充盖掉
    for (const id of ids) ctx.strokeRect((id % GRID) * CELL + 0.5, Math.floor(id / GRID) * CELL + 0.5, CELL - 1, CELL - 1);
  };
  ring(terrain.hot, cssVar('--map-green', '#3ddc84'));
  ring(terrain.cold, cssVar('--map-red', '#ff5c5c'));
}

function paint(canvas, entry) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = GRID * CELL * dpr;
  canvas.height = GRID * CELL * dpr;
  canvas.style.width = `${GRID * CELL}px`;
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  entry.well = cssVar('--map-well', '#0a0d13');
  ctx.fillStyle = entry.well;
  ctx.fillRect(0, 0, GRID * CELL, GRID * CELL);
  if (entry.mode === 'reach') {
    for (let id = 0; id < entry.waveBytes.length; id++) {
      const wave = entry.waveBytes[id];
      if (!wave || wave > entry.upto) continue;
      ctx.fillStyle = reachInk(wave, entry.well);
      ctx.fillRect((id % GRID) * CELL, Math.floor(id / GRID) * CELL, CELL - 1, CELL - 1);
    }
    entry.painted = null; // 传播层没有增量路径，painted 快照只属于反应层
    return;
  }
  const { bytes, presetId } = entry;
  const keys = Object.keys(PRESETS[presetId].reactions);
  for (let id = 0; id < bytes.length; id++) {
    if (!bytes[id]) continue;
    fillCell(ctx, presetId, entry.well, id, bytes[id], keys);
  }
  ringTerrain(ctx, entry.terrain);
  entry.painted = bytes.slice(); // 快照，供 paintDelta 做增量
  const cursor = cursorByCanvas.get(canvas);
  if (cursor >= 0) {
    // 键盘光标是 UI 不是数据，用主题强调色；全量重画（换主题/换视图）后自动画回来
    ctx.strokeStyle = cssVar('--accent', '#e0604a');
    ctx.lineWidth = 2;
    ctx.strokeRect((cursor % GRID) * CELL + 1, Math.floor(cursor / GRID) * CELL + 1, CELL - 2, CELL - 2);
  }
}

// -- 传播层：一格 = 这个人在第几波看到（0 = 没看到）------------------------------
// 顺序量表用单色渐满编码（--map-blue 对底板 mixHex），刻意不用反应色板——
// 那是"做了什么反应"的类别色，这里是"多晚看到"的顺序色，多色反而暗示类别。
// t 从 0.58 起：mix 后最淡一档对四主题深底板仍过非文字图形 3:1（实测最低 3.17，
// 0.55 只有 2.99——这条是数值复算出来的下限，别凭感觉调回去）。
const REACH_T = [0.58, 0.72, 0.86, 1];

/** 第 wave 波的传播墨水（图例与地图同源；well 由调用方传入以免逐格重读令牌）。 */
export function reachInk(wave, well = cssVar('--map-well', '#0a0d13')) {
  const blue = cssVar('--map-blue', '#6ea8fe');
  return mixHex(well, blue, REACH_T[wave - 1] ?? 1);
}

/**
 * 传播层视图。upto 供重播用：只画到第 N 波；登记进 drawn（mode 'reach'），
 * 主题切换时 redrawMaps 按层重画。返回画了几格。
 */
export function drawReach(canvas, waveBytes, upto = Infinity) {
  for (const [old] of drawn) if (!old.isConnected) drawn.delete(old);
  drawn.set(canvas, { mode: 'reach', bytes: null, presetId: null, terrain: null, waveBytes, upto, painted: null, well: '' });
  paint(canvas, drawn.get(canvas));
  let painted = 0;
  for (const wave of waveBytes) if (wave && wave <= upto) painted += 1;
  return painted;
}

/** 悬停提示：id → 人格档案 + 它的反应。 */
export function attachTooltip(canvas, bytes, presetId) {
  const keys = Object.keys(PRESETS[presetId].reactions);
  let tooltip = document.getElementById('tooltip');
  if (!tooltip) {
    tooltip = Object.assign(document.createElement('div'), { id: 'tooltip', role: 'status' });
    document.body.append(tooltip);
  }
  // 触摸点开的格子：同格再点=收起（触摸屏没有 mouseleave 可走）
  let pinned = -1;

  const cellAt = (event) => {
    const rect = canvas.getBoundingClientRect();
    const scale = GRID / rect.width; // CSS 压缩后的实际比例
    const x = Math.floor((event.clientX - rect.left) * scale);
    const y = Math.floor((event.clientY - rect.top) * scale);
    return x >= 0 && x < GRID && y >= 0 && y < GRID ? y * GRID + x : -1;
  };

  const render = (id) => {
    const who = persona('zh', id);
    const byte = bytes[id];
    const reaction = byte ? REACTIONS_ZH[keys[byte - 1]] ?? keys[byte - 1] : '没看到这条';
    tooltip.innerHTML =
      `<b>${who.name.zh}</b>，${who.age}岁，${JOB[who.job]?.zh ?? who.job}，${who.city.zh}<br>` +
      `兴趣：${who.interests.map((i) => INTEREST[i]?.zh ?? i).join('、')}<br>` +
      `${TEMPER[who.temper]?.zh} · ${BUDGET[who.budget]?.zh}<br>` +
      `Jev 判定：<b>${reaction}</b>`;
    tooltip.style.display = 'block';
  };

  // innerHTML 与 display 先行，offsetWidth/offsetHeight 此刻已可读；钳位只动 left/top
  const place = (event) => {
    const pos = clampTip(
      event.clientX, event.clientY,
      tooltip.offsetWidth, tooltip.offsetHeight,
      window.innerWidth, window.innerHeight,
    );
    tooltip.style.left = `${pos.left}px`;
    tooltip.style.top = `${pos.top}px`;
  };

  const show = (event) => { render(cellAt(event)); place(event); };
  const hide = () => { pinned = -1; tooltip.style.display = 'none'; };
  // 画布可被别的图层借用（传播层显示波次不是反应），tipOff=1 时悬停档案整个关闭
  const off = () => canvas.dataset.tipOff === '1';

  // 悬停走 pointermove（区分得了输入源）：手指拖动不算悬停，触摸档案走 pointerdown 的点按
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    pinned = -1;
    if (off() || cellAt(event) < 0) { tooltip.style.display = 'none'; return; }
    show(event);
  });
  // 触摸屏没有 hover：点一下出档案，同格再点收起
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    if (off()) { tooltip.style.display = 'none'; return; }
    const id = cellAt(event);
    if (id >= 0 && id === pinned) { hide(); return; }
    pinned = id;
    if (id < 0) { tooltip.style.display = 'none'; return; }
    show(event);
  });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

  // 键盘导航：tabindex 在画布上（render.js 给报告地图加了 tabindex="0"），方向键逐格移动、
  // 每步揭示档案（tooltip 的 role="status" 让屏幕阅读器逐格播报）；光标格用 --accent 描边。
  const drawCursor = (id, stroke) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect((id % GRID) * CELL + 1, Math.floor(id / GRID) * CELL + 1, CELL - 2, CELL - 2);
  };
  const revealCell = (id) => {
    render(id);
    // 光标可能落在视口外：clampTip 把 tooltip 钳回视口边（能看见，代价是不贴格）
    const rect = canvas.getBoundingClientRect();
    place({
      clientX: rect.left + ((id % GRID) + 0.5) * (rect.width / GRID),
      clientY: rect.top + (Math.floor(id / GRID) + 0.5) * (rect.height / GRID),
    });
  };
  canvas.addEventListener('keydown', (event) => {
    if (off()) return;
    if (event.key === 'Escape') { tooltip.style.display = 'none'; return; }
    const delta = { ArrowUp: -GRID, ArrowDown: GRID, ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const start = cursorByCanvas.get(canvas) ?? -1;
    if (start < 0) {
      // 首次按键先把光标落在 0 格（任何方向），再按才是移动
      cursorByCanvas.set(canvas, 0);
      drawCursor(0, cssVar('--accent', '#e0604a'));
      revealCell(0);
      return;
    }
    const next = stepCell(start, event.key);
    if (next < 0) return; // 出界不动
    cursorByCanvas.set(canvas, next);
    drawCursor(next, cssVar('--accent', '#e0604a'));
    revealCell(next);
  });
  canvas.addEventListener('blur', () => { tooltip.style.display = 'none'; });
}

/** 方向键走一格：越界返回 -1（不动）。纯函数，边界有单测。 */
export function stepCell(id, key) {
  const delta = { ArrowUp: -GRID, ArrowDown: GRID, ArrowLeft: -1, ArrowRight: 1 }[key];
  if (delta === undefined) return -1;
  const next = id + delta;
  // 左右越界 = 跨行（列号溢出）；上下越界 = 出地图
  if (next < 0 || next >= GRID * GRID) return -1;
  if ((key === 'ArrowLeft' && next % GRID === GRID - 1) || (key === 'ArrowRight' && next % GRID === 0)) return -1;
  return next;
}

/**
 * 视口钳制：tooltip 默认落在光标右下（+14px）；右缘放不下翻到光标左侧，
 * 下缘放不下翻到光标上方；最后钳进视口，四周留 12px 边距。
 * 纯函数：不量 DOM，宽高与视口由调用方量好传入（宽高在 innerHTML 设置后立即可读）。
 */
export function clampTip(x, y, w, h, vw, vh) {
  const GAP = 14;
  const PAD = 12;
  let left = x + GAP;
  let top = y + GAP;
  if (left + w > vw - PAD) left = x - GAP - w; // 右缘放不下 → 翻到光标左侧
  if (top + h > vh - PAD) top = y - GAP - h;   // 下缘放不下 → 翻到光标上方
  return {
    left: Math.min(Math.max(left, PAD), Math.max(PAD, vw - PAD - w)),
    top: Math.min(Math.max(top, PAD), Math.max(PAD, vh - PAD - h)),
  };
}

// -- 两版之差的发散配色 ----------------------------------------------------------
// 绿=变好、红=变差，幅度大的画满、幅度小的与底板掺半。
// 墨水仍取主题数据墨水（--map-green / --map-red），所以四个主题各自成立。
// 刻意不用 LOOKS：那是"这个人做了什么反应"的色板，这里是"相对上一版变了多少"的量表，
// 语义不同——用同一套颜色会让读者把"变了"误读成"是哪种反应"。

/** 两个 #rrggbb 按 t（0..1）线性掺，返回 #rrggbb。t=0 全 a，t=1 全 b。 */
const mixHex = (a, b, t) => {
  const left = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const right = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${left.map((v, i) => Math.round(v + (right[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

/**
 * 差分地图。codes 来自 shared/spatial.js 的 crowdDelta（code = delta + 3，0 = 不可比）：
 * 1 = 大幅变差、2 = 小幅变差、3 = 没变、4 = 小幅变好、5 = 大幅变好。
 * 返回画了几个格子。
 *
 * 画布登记进 deltas（不进 drawn）：没有"这个人是谁"的档案可悬停、没有增量路径，
 * 但主题切换时 redrawMaps 要按新令牌把它重画一遍。
 */
export function drawDelta(canvas, codes) {
  for (const [old] of deltas) if (!old.isConnected) deltas.delete(old); // 清掉已断连的旧画布
  deltas.set(canvas, codes);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = GRID * CELL * dpr;
  canvas.height = GRID * CELL * dpr;
  canvas.style.width = `${GRID * CELL}px`;
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const well = cssVar('--map-well', '#0a0d13');
  ctx.fillStyle = well;
  ctx.fillRect(0, 0, GRID * CELL, GRID * CELL);
  const green = cssVar('--map-green', '#3ddc84');
  const red = cssVar('--map-red', '#ff5c5c');
  // 下标即 code：0 不可比、3 无变化，两头留给"半档"与"满档"
  const inks = [null, mixHex(well, red, 1), mixHex(well, red, 0.5), null, mixHex(well, green, 0.5), mixHex(well, green, 1)];
  let touched = 0;
  for (let id = 0; id < codes.length; id++) {
    const ink = inks[codes[id]];
    if (!ink) continue;
    ctx.fillStyle = ink;
    ctx.fillRect((id % GRID) * CELL, Math.floor(id / GRID) * CELL, CELL - 1, CELL - 1);
    touched += 1;
  }
  return touched;
}
